const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = async () => { throw new Error('offline'); }) {
  const elements = {};
  const pillElements = [];
  const storage = {};

  function createMockElement(id) {
    const classes = new Set();
    return {
      id,
      style: { display: 'none' },
      classList: {
        classes,
        add(...cls) { cls.forEach(c => classes.add(c)); },
        remove(...cls) { cls.forEach(c => classes.delete(c)); },
        toggle(c, force) {
          if (force !== undefined) {
            force ? classes.add(c) : classes.delete(c);
          } else {
            classes.has(c) ? classes.delete(c) : classes.add(c);
          }
        },
        contains(c) { return classes.has(c); }
      },
      innerHTML: '',
      textContent: '',
      value: '',
      className: '',
      addEventListener() {},
      removeEventListener() {},
      getContext() { return {}; },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; }
    };
  }

  function getOrCreateEl(id) {
    if (!elements[id]) {
      elements[id] = createMockElement(id);
    }
    return elements[id];
  }

  const elementsProxy = new Proxy(elements, {
    get(target, prop) {
      if (typeof prop === 'string') {
        return getOrCreateEl(prop);
      }
      return target[prop];
    }
  });

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
      if (selector && selector.includes('sprint-venue-pill')) {
        return pillElements;
      }
      return [];
    },
    addEventListener: () => {},
    createElement: (tag) => {
      const el = createMockElement('created_' + tag);
      if (tag === 'button') pillElements.push(el);
      return el;
    }
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.data = config?.data || { labels: [], datasets: [] };
    }
    destroy() {}
    resize() {}
    update() {}
  }

  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');

  const context = {
    window: {
      addEventListener: () => {},
      document: mockDoc,
      localStorage: mockStorage,
      Chart: MockChart
    },
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: customFetch,
    console: { ...console, log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);

  return {
    exports: context.module.exports,
    elements: elementsProxy,
    mockStorage
  };
}

describe('Issue #40: Sprint Disparity Sprint Weekends Only scope in fallback mode', () => {
  let env;

  beforeEach(() => {
    env = createTestEnv(async () => {
      throw new Error('fetch failed (offline)');
    });
  });

  test('Full Season GP Share derives full-season gpPts = standingsTotalPts - sprintPts in 2024 fallback mode', async () => {
    const { loadSprintData, computeSprintDisparityMetrics, sprintState, SPRINT_FALLBACK_2024 } = env.exports;

    await loadSprintData('2024', true);

    assert.equal(sprintState.scope, 'season');
    assert.equal(sprintState.results.length, 0);
    assert.equal(sprintState.sprints.length, SPRINT_FALLBACK_2024.sprints.length);

    const metrics = computeSprintDisparityMetrics();
    assert.equal(metrics.numSprintSessions, 6);
    assert.equal(metrics.numGpSessions, 24);
    assert.equal(metrics.gpPtsAvailablePerDriver, 624);
    assert.equal(metrics.weekendGpResultsUnavailable, false);

    const ver = metrics.rows.find(r => r.driverId === 'max_verstappen');
    assert.ok(ver);
    assert.equal(ver.sprintPts, 38);
    assert.equal(ver.gpPts, 437 - 38);
    assert.equal(ver.totalPts, 437);

    const alo = metrics.rows.find(r => r.driverId === 'alonso');
    assert.ok(alo);
    assert.equal(alo.sprintPts, 0);
    assert.equal(alo.gpPts, 70);
  });

  test('Sprint Weekends Only scope in fallback mode does NOT assign full-season GP points and displays notice', async () => {
    const {
      loadSprintData,
      setSprintComparisonScope,
      computeSprintDisparityMetrics,
      sprintState
    } = env.exports;
    const { sprintFormulaSubtitle, btnSprintScopeSeason, btnSprintScopeWeekends } = env.elements;

    await loadSprintData('2024', true);
    setSprintComparisonScope('weekends');

    assert.equal(sprintState.scope, 'weekends');
    assert.equal(btnSprintScopeWeekends.classList.contains('active'), true);
    assert.equal(btnSprintScopeSeason.classList.contains('active'), false);

    const metrics = computeSprintDisparityMetrics();
    assert.equal(metrics.numSprintSessions, 6);
    assert.equal(metrics.numGpSessions, 6);
    assert.equal(metrics.gpPtsAvailablePerDriver, 156);
    assert.equal(metrics.weekendGpResultsUnavailable, true);

    for (const row of metrics.rows) {
      assert.equal(row.gpPts, 0, `${row.driverId} should have 0 gpPts in weekend-only fallback mode`);
      assert.equal(row.totalPts, row.sprintPts, `${row.driverId} totalPts should equal sprintPts`);
      assert.ok(
        row.gpPts <= metrics.gpPtsAvailablePerDriver,
        `${row.driverId} must never exceed 100% GP capture (${row.gpPts} <= ${metrics.gpPtsAvailablePerDriver})`
      );
      if (row.sprintPts > 0) {
        assert.equal(row.sdiDisplay, '100% Sprint');
      } else {
        assert.equal(row.sdiDisplay, 'N/A (0 PTS)');
      }
    }

    assert.match(
      sprintFormulaSubtitle.textContent,
      /Round-level GP results unavailable in offline fallback/i
    );
  });

  test('Switching back from Sprint Weekends Only to Full Season restores standings-derived GP totals and SDI formula', async () => {
    const {
      loadSprintData,
      setSprintComparisonScope,
      computeSprintDisparityMetrics
    } = env.exports;
    const { sprintFormulaSubtitle } = env.elements;

    await loadSprintData('2024', true);
    setSprintComparisonScope('weekends');
    assert.match(sprintFormulaSubtitle.textContent, /Round-level GP results unavailable/i);

    setSprintComparisonScope('season');
    const metrics = computeSprintDisparityMetrics();
    assert.equal(metrics.weekendGpResultsUnavailable, false);
    assert.equal(metrics.numGpSessions, 24);

    const ver = metrics.rows.find(r => r.driverId === 'max_verstappen');
    assert.equal(ver.sprintPts, 38);
    assert.equal(ver.gpPts, 399);
    assert.equal(ver.totalPts, 437);

    assert.equal(
      sprintFormulaSubtitle.textContent,
      'SDI = (Sprint Pts Earned / Sprint Pts Available) ÷ (GP Pts Earned / GP Pts Available)'
    );
  });

  test('When round-level Jolpica GP results are present, Sprint Weekends Only aggregates strictly from sprintRoundSet', async () => {
    const mockFetch = async (url) => {
      if (url.includes('/sprint.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              total: '2',
              limit: '1000',
              offset: '0',
              RaceTable: {
                Races: [
                  {
                    round: '5',
                    raceName: 'Chinese Grand Prix',
                    Circuit: { circuitName: 'Shanghai International Circuit', Location: { locality: 'Shanghai' } },
                    SprintResults: [
                      {
                        position: '1',
                        points: '8',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                      },
                      {
                        position: '2',
                        points: '7',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                      }
                    ]
                  },
                  {
                    round: '6',
                    raceName: 'Miami Grand Prix',
                    Circuit: { circuitName: 'Miami International Autodrome', Location: { locality: 'Miami' } },
                    SprintResults: [
                      {
                        position: '1',
                        points: '8',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                      },
                      {
                        position: '2',
                        points: '7',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                      }
                    ]
                  }
                ]
              }
            }
          })
        };
      }
      if (url.includes('/results.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              total: '3',
              limit: '1000',
              offset: '0',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    raceName: 'Bahrain Grand Prix',
                    Results: [
                      {
                        position: '1',
                        points: '26',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                      },
                      {
                        position: '6',
                        points: '8',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                      }
                    ]
                  },
                  {
                    round: '5',
                    raceName: 'Chinese Grand Prix',
                    Results: [
                      {
                        position: '1',
                        points: '25',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                      },
                      {
                        position: '2',
                        points: '18',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                      }
                    ]
                  },
                  {
                    round: '6',
                    raceName: 'Miami Grand Prix',
                    Results: [
                      {
                        position: '2',
                        points: '18',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                      },
                      {
                        position: '1',
                        points: '25',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                      }
                    ]
                  }
                ]
              }
            }
          })
        };
      }
      if (url.includes('/driverStandings.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              StandingsTable: {
                StandingsLists: [{
                  DriverStandings: [
                    {
                      position: '1',
                      points: '437',
                      Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                      Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }]
                    },
                    {
                      position: '2',
                      points: '374',
                      Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                      Constructors: [{ constructorId: 'mclaren', name: 'McLaren' }]
                    }
                  ]
                }]
              }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const liveEnv = createTestEnv(mockFetch);
    const {
      loadSprintData,
      setSprintComparisonScope,
      computeSprintDisparityMetrics
    } = liveEnv.exports;
    const { sprintFormulaSubtitle } = liveEnv.elements;

    await loadSprintData('2024', true);
    setSprintComparisonScope('weekends');

    const metrics = computeSprintDisparityMetrics();
    assert.equal(metrics.numSprintSessions, 2);
    assert.equal(metrics.numGpSessions, 2);
    assert.equal(metrics.sprintPtsAvailablePerDriver, 16);
    assert.equal(metrics.gpPtsAvailablePerDriver, 52);
    assert.equal(metrics.weekendGpResultsUnavailable, false);

    // Round 1 (non-sprint GP) must be excluded; only Rounds 5 and 6 count
    const ver = metrics.rows.find(r => r.driverId === 'max_verstappen');
    assert.equal(ver.sprintPts, 16);
    assert.equal(ver.gpPts, 25 + 18); // 43, excludes Round 1's 26
    assert.equal(ver.totalPts, 59);
    const expectedVerSdi = (16 / 16) / (43 / 52);
    assert.ok(Math.abs(ver.sdi - expectedVerSdi) < 1e-9);
    assert.equal(ver.sdiDisplay, expectedVerSdi.toFixed(2));

    const nor = metrics.rows.find(r => r.driverId === 'norris');
    assert.equal(nor.sprintPts, 14);
    assert.equal(nor.gpPts, 18 + 25); // 43, excludes Round 1's 8
    assert.equal(nor.totalPts, 57);
    const expectedNorSdi = (14 / 16) / (43 / 52);
    assert.ok(Math.abs(nor.sdi - expectedNorSdi) < 1e-9);

    assert.equal(
      sprintFormulaSubtitle.textContent,
      'SDI = (Sprint Pts Earned / Sprint Pts Available) ÷ (GP Pts Earned / GP Pts Available)'
    );
  });
});
