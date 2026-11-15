'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainScript = (() => {
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    if (match[1].includes('loadTelemetrySeason')) return match[1];
  }
  throw new Error('Main script not found in index.html');
})();

function createMockStorage() {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

function createTestEnv(fetchImpl) {
  const elements = {};
  const chartInstances = [];
  const clearRectCalls = [];
  const listeners = {};

  function makeElement(id, tag = 'div') {
    const classes = new Set();
    const ctx = {
      canvas: { id },
      clearRect: (x, y, w, h) => {
        clearRectCalls.push({ id, x, y, w, h });
      },
      beginPath() {},
      stroke() {},
      fill() {}
    };
    return {
      id,
      tagName: tag.toUpperCase(),
      width: 400,
      height: 300,
      style: {
        display: '',
        background: '',
        color: '',
        textShadow: '',
        setProperty(k, v) { this[k] = v; },
        getPropertyValue(k) { return this[k] || ''; }
      },
      className: '',
      innerHTML: '',
      textContent: '',
      value: '',
      options: [],
      children: [],
      classList: {
        add: (...cls) => cls.forEach(c => classes.add(c)),
        remove: (...cls) => cls.forEach(c => classes.delete(c)),
        toggle: (c, force) => {
          const on = force !== undefined ? force : !classes.has(c);
          on ? classes.add(c) : classes.delete(c);
        },
        contains: (c) => classes.has(c)
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      removeEventListener() {},
      getContext() {
        return ctx;
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; }
    };
  }

  const getEl = (id) => {
    if (!elements[id]) {
      const tag = id.toLowerCase().includes('select')
        ? 'select'
        : (id.toLowerCase().includes('chart') ? 'canvas' : 'div');
      elements[id] = makeElement(id, tag);
    }
    return elements[id];
  };

  const mockDoc = {
    getElementById: getEl,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => makeElement('created_' + tag, tag)
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.data = config?.data || { labels: [], datasets: [] };
      this.destroyed = false;
      this.resized = false;
      chartInstances.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
    resize() {
      this.resized = true;
    }
    update() {}
  }

  const defaultFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } })
  });

  const mockWindow = {
    document: mockDoc,
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener() {},
    Chart: MockChart
  };

  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    document: mockDoc,
    window: mockWindow,
    Chart: MockChart,
    localStorage: createMockStorage(),
    fetch: fetchImpl || defaultFetch,
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(mainScript, context);
  return {
    exp: context.module.exports,
    context,
    elements,
    chartInstances,
    clearRectCalls,
    listeners
  };
}

function makeTelemetryEntry({ driverId, code, givenName, familyName, constructorId, constructorName, position, grid = '1', points = '0', status = 'Finished', q1, q2, q3 }) {
  const entry = {
    position: String(position),
    grid: String(grid),
    points: String(points),
    status,
    Driver: { driverId, code, givenName, familyName, permanentNumber: '1' },
    Constructor: { constructorId, name: constructorName }
  };
  if (q1) entry.Q1 = q1;
  if (q2) entry.Q2 = q2;
  if (q3) entry.Q3 = q3;
  return entry;
}

describe('Issue #43: Stale Chart.js instances & DOM telemetry cleanup', () => {
  test('renderConstructorTrajectoryChart destroys existing Chart.js instance before early-returning on empty standings', () => {
    const { exp, elements, chartInstances, clearRectCalls, listeners } = createTestEnv();

    exp.constructorAtrState.standings = [
      { position: '1', points: '100', wins: '2', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
      { position: '2', points: '80', wins: '1', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } }
    ];
    exp.constructorAtrState.trajectories = { mclaren: [25, 100], ferrari: [18, 80] };
    exp.constructorAtrState.rounds = [{ round: '1', raceName: 'Bahrain Grand Prix' }, { round: '2', raceName: 'Saudi Arabian Grand Prix' }];

    exp.renderConstructorTrajectoryChart();
    assert.equal(chartInstances.length, 1);
    assert.equal(chartInstances[0].destroyed, false);
    assert.ok(elements.atrTeamLegendPills.innerHTML.includes('McLaren'));

    // Switch to empty standings
    exp.constructorAtrState.standings = [];
    exp.constructorAtrState.trajectories = {};
    exp.constructorAtrState.rounds = [];

    exp.renderConstructorTrajectoryChart();
    assert.equal(chartInstances.length, 1, 'must not create a new chart for empty standings');
    assert.equal(chartInstances[0].destroyed, true, 'must destroy stale trajectory chart on empty standings');
    assert.equal(elements.atrTeamLegendPills.innerHTML, '');
    assert.ok(clearRectCalls.some(c => c.id === 'constructorTrajectoryChart'));

    // Window resize should not touch destroyed instance
    (listeners.resize || []).forEach(fn => fn());
    assert.equal(chartInstances[0].resized, false);

    // Null standings also cleans up cleanly
    exp.constructorAtrState.standings = null;
    assert.doesNotThrow(() => exp.renderConstructorTrajectoryChart());
  });

  test('renderReliabilityChart destroys existing Chart.js instance before early-returning on empty items or null metrics', () => {
    const { exp, chartInstances, clearRectCalls, listeners } = createTestEnv();

    const validMetrics = {
      overallReliabilityPct: 90.0,
      totalFinished: 18,
      totalEntries: 20,
      totalMechanical: 1,
      totalIncident: 1,
      constructors: [
        {
          constructorId: 'mclaren',
          name: 'McLaren',
          color: '#FF8000',
          totalEntries: 2,
          finished: 2,
          mechanical: 0,
          incident: 0,
          technical: 0,
          finishedPct: 100,
          mechanicalPct: 0,
          incidentPct: 0,
          technicalPct: 0,
          lapsCompleted: 114,
          possibleLaps: 114,
          failures: []
        }
      ],
      drivers: [
        {
          driverId: 'bearman',
          code: 'BEA',
          name: 'Oliver Bearman',
          color: '#E8002D',
          isReserve: true,
          totalEntries: 1,
          finished: 1,
          mechanical: 0,
          incident: 0,
          technical: 0,
          finishedPct: 100,
          mechanicalPct: 0,
          incidentPct: 0,
          technicalPct: 0,
          lapsCompleted: 50,
          possibleLaps: 50,
          failures: []
        }
      ]
    };

    exp.reliabilityState.viewScope = 'constructors';
    exp.renderReliabilityChart(validMetrics);
    assert.equal(chartInstances.length, 1);
    assert.equal(chartInstances[0].destroyed, false);

    // Empty constructors list
    exp.renderReliabilityChart({ ...validMetrics, constructors: [] });
    assert.equal(chartInstances.length, 1, 'must not create a new chart when items are empty');
    assert.equal(chartInstances[0].destroyed, true, 'must destroy stale reliability chart on empty items');
    assert.ok(clearRectCalls.some(c => c.id === 'reliabilityChart'));

    // Re-render then test reserve-only driver filter empty result
    exp.renderReliabilityChart(validMetrics);
    assert.equal(chartInstances.length, 2);
    assert.equal(chartInstances[1].destroyed, false);

    exp.reliabilityState.viewScope = 'drivers';
    exp.reliabilityState.excludeReserves = true;
    exp.renderReliabilityChart(validMetrics);
    assert.equal(chartInstances.length, 2);
    assert.equal(chartInstances[1].destroyed, true, 'must destroy stale reliability chart when filtered drivers are empty');

    // Re-render then test null metrics
    exp.reliabilityState.viewScope = 'constructors';
    exp.renderReliabilityChart(validMetrics);
    assert.equal(chartInstances.length, 3);
    exp.reliabilityState.metrics = null;
    exp.renderReliabilityChart(null);
    assert.equal(chartInstances[2].destroyed, true, 'must destroy stale reliability chart when metrics is null');

    (listeners.resize || []).forEach(fn => fn());
    assert.equal(chartInstances[2].resized, false);
  });

  test('renderConstructorKpis resets all KPI cards on empty inputs after prior season data', async () => {
    const { exp, elements } = createTestEnv();

    const standings2024 = [
      { position: '1', points: '666', wins: '6', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
      { position: '2', points: '652', wins: '5', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
      { position: '10', points: '4', wins: '0', Constructor: { constructorId: 'sauber', name: 'Kick Sauber' } }
    ];

    exp.renderConstructorKpis(standings2024);
    assert.equal(elements.atrKpiLeaderTeam.textContent, 'McLaren');
    assert.equal(elements.atrKpiLeaderWins.textContent, '6 Wins');
    assert.equal(elements.atrKpiLeaderPts.textContent, '666 PTS');
    assert.equal(elements.atrKpiGapPoints.textContent, '+14 PTS');
    assert.equal(elements.atrKpiGapContext.textContent, 'McLaren (666) vs Ferrari (652)');
    assert.equal(elements.atrKpiMaxTeam.textContent, 'Kick Sauber');
    assert.equal(elements.atrKpiMaxRank.textContent, 'P10');

    // Empty array resets KPI cards
    exp.renderConstructorKpis([]);
    assert.equal(elements.atrKpiLeaderWins.textContent, '0 Wins');
    assert.equal(elements.atrKpiLeaderTeam.textContent, '--');
    assert.equal(elements.atrKpiLeaderPts.textContent, '-- PTS');
    assert.ok(!elements.atrKpiLeaderSub.textContent.includes('McLaren'));
    assert.equal(elements.atrKpiLeaderBar.style.background, '#334155');
    assert.equal(elements.atrKpiGapPoints.textContent, '-- PTS');
    assert.ok(!elements.atrKpiGapContext.textContent.includes('McLaren'));
    assert.ok(!elements.atrKpiGapContext.textContent.includes('Ferrari'));
    assert.equal(elements.atrKpiMaxTeam.textContent, '--');
    assert.equal(elements.atrKpiMaxRank.textContent, '--');
    assert.ok(!elements.atrKpiMaxAllowance.textContent.includes('wind tunnel'));

    // Null input also resets KPI cards cleanly
    exp.renderConstructorKpis(standings2024);
    exp.renderConstructorKpis(null);
    assert.equal(elements.atrKpiLeaderTeam.textContent, '--');
    assert.equal(elements.atrKpiGapPoints.textContent, '-- PTS');
    assert.equal(elements.atrKpiMaxTeam.textContent, '--');
  });

  test('loadTelemetrySeason catch block hides #telemetryMainContent, destroys & clears charts, and updates error message to supported seasons', async () => {
    let mode = 'success';
    const fetchMock = async (url) => {
      if (mode === 'empty') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } })
        };
      }
      if (mode === 'httpError') {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      if (url.includes('qualifying.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '1',
              limit: '100',
              RaceTable: {
                Races: [{
                  season: '2024',
                  round: '1',
                  raceName: 'Bahrain Grand Prix',
                  QualifyingResults: [
                    makeTelemetryEntry({ driverId: 'verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', constructorName: 'Red Bull', position: 1, q1: '1:30.000', q2: '1:29.500', q3: '1:29.100' }),
                    makeTelemetryEntry({ driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez', constructorId: 'red_bull', constructorName: 'Red Bull', position: 5, q1: '1:30.300', q2: '1:29.800', q3: '1:29.500' })
                  ]
                }]
              }
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          MRData: {
            total: '1',
            limit: '100',
            RaceTable: {
              Races: [{
                season: '2024',
                round: '1',
                raceName: 'Bahrain Grand Prix',
                Results: [
                  makeTelemetryEntry({ driverId: 'verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', constructorName: 'Red Bull', position: 1, grid: 1, points: 25 }),
                  makeTelemetryEntry({ driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez', constructorId: 'red_bull', constructorName: 'Red Bull', position: 2, grid: 5, points: 18 })
                ]
              }]
            }
          }
        })
      };
    };

    const { exp, elements, chartInstances, clearRectCalls } = createTestEnv(fetchMock);

    // 1. Load valid season first
    await exp.loadTelemetrySeason('2024', true);
    assert.equal(elements.telemetryMainContent.style.display, 'block');
    assert.equal(chartInstances.length, 2, 'should create radar and delta charts');
    assert.equal(chartInstances[0].destroyed, false);
    assert.equal(chartInstances[1].destroyed, false);
    assert.ok(elements.telemetryTeamPills.innerHTML.includes('Red Bull'));

    // 2. Switch to an empty season (e.g. 2026 before data exists)
    mode = 'empty';
    clearRectCalls.length = 0;
    await exp.loadTelemetrySeason('2026', true);

    assert.equal(elements.telemetryMainContent.style.display, 'none', '#telemetryMainContent must be hidden in catch block');
    assert.equal(chartInstances[0].destroyed, true, 'telemetryRadarChartInstance must be destroyed in catch block');
    assert.equal(chartInstances[1].destroyed, true, 'telemetryDeltaChartInstance must be destroyed in catch block');
    assert.ok(clearRectCalls.some(c => c.id === 'telemetryRadarChart'), '#telemetryRadarChart canvas must be cleared');
    assert.ok(clearRectCalls.some(c => c.id === 'telemetryDeltaChart'), '#telemetryDeltaChart canvas must be cleared');
    assert.equal(elements.telemetryTeamPills.innerHTML, '');
    assert.equal(elements.driverPairSelectorContainer.style.display, 'none');

    // Error message must reference currently supported seasons and NOT stale "Select 2024 or 2023"
    assert.equal(elements.telemetryError.style.display, 'block');
    assert.ok(!elements.telemetryError.innerHTML.includes('2023'), 'error message must not reference unsupported 2023 season');
    assert.ok(!elements.telemetryError.innerHTML.includes('Select 2024 or 2023'));
    const expectedSupported = exp.getRecentSeasons().filter(s => s !== '2026');
    expectedSupported.forEach(yr => {
      assert.ok(elements.telemetryError.innerHTML.includes(yr), `error message must reference supported season ${yr}`);
    });

    // 3. Reload valid season, then trigger HTTP 500 error
    mode = 'success';
    await exp.loadTelemetrySeason('2024', true);
    assert.equal(elements.telemetryMainContent.style.display, 'block');
    assert.equal(chartInstances.length, 4);

    mode = 'httpError';
    clearRectCalls.length = 0;
    await exp.loadTelemetrySeason('2025', true);
    assert.equal(elements.telemetryMainContent.style.display, 'none');
    assert.equal(chartInstances[2].destroyed, true);
    assert.equal(chartInstances[3].destroyed, true);
    assert.ok(clearRectCalls.some(c => c.id === 'telemetryRadarChart'));
    assert.ok(clearRectCalls.some(c => c.id === 'telemetryDeltaChart'));
    assert.equal(elements.telemetryError.style.display, 'block');
  });
});
