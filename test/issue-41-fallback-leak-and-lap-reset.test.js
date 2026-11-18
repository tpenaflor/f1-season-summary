'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];
  const chartInstances = [];
  const clearRectCalls = [];
  const storage = {};

  function createMockElement(id, tag = 'div') {
    const classes = new Set();
    let innerHtmlValue = '';
    const el = {
      id,
      tagName: tag.toUpperCase(),
      classes,
      classList: {
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
      get innerHTML() {
        return innerHtmlValue;
      },
      set innerHTML(val) {
        innerHtmlValue = String(val);
        if (innerHtmlValue === '') {
          this.children = [];
          this.options = [];
        } else if (this.tagName === 'SELECT') {
          this.options = [...innerHtmlValue.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
            .map(m => ({ value: m[1], textContent: m[2] }));
        }
      },
      textContent: '',
      value: '',
      disabled: false,
      style: {},
      children: [],
      options: [],
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(v) {
        classes.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
      },
      appendChild(child) {
        this.children.push(child);
        if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
          this.options.push(child);
          if (child.selected || this.options.length === 1) {
            this.value = child.value;
          }
        }
        return child;
      },
      addEventListener(event, fn) {
        listeners[id] = listeners[id] || {};
        listeners[id][event] = listeners[id][event] || [];
        listeners[id][event].push(fn);
      },
      removeEventListener() {},
      getContext() {
        return {
          canvas: { id },
          clearRect: (x, y, w, h) => clearRectCalls.push({ id, x, y, w, h }),
          beginPath() {},
          stroke() {},
          fill() {}
        };
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; }
    };
    return el;
  }

  function getOrCreateEl(id) {
    if (!elements[id]) {
      const lower = id.toLowerCase();
      const tag = lower.includes('select') ? 'select' : (lower.includes('chart') ? 'canvas' : 'div');
      elements[id] = createMockElement(id, tag);
    }
    return elements[id];
  }

  const elementsProxy = new Proxy(elements, {
    get(target, prop) {
      if (typeof prop === 'string') return getOrCreateEl(prop);
      return target[prop];
    }
  });

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener: () => {},
    createElement: (tag) => createMockElement('created_' + tag + '_' + Math.random().toString(36).slice(2, 6), tag)
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.type = config?.type;
      this.data = config?.data || { labels: [], datasets: [] };
      this.options = config?.options || {};
      this.destroyed = false;
      this.resized = false;
      chartInstances.push(this);
    }
    destroy() { this.destroyed = true; }
    resize() { this.resized = true; }
    update() {}
  }

  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const defaultFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] }, StandingsTable: { StandingsLists: [] } } })
  });

  const activeFetch = async (url, opts) => {
    queriedUrls.push(String(url));
    if (customFetch) return customFetch(url, opts);
    return defaultFetch(url, opts);
  };

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');

  const context = {
    window: {
      document: mockDoc,
      addEventListener: () => {},
      removeEventListener: () => {},
      localStorage: mockStorage,
      Chart: MockChart
    },
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: activeFetch,
    console: { ...console, log() {}, warn() {}, error() {} },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);

  return {
    context,
    exp: context.module.exports,
    elements: elementsProxy,
    queriedUrls,
    chartInstances,
    clearRectCalls,
    storage
  };
}

const emptyFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    MRData: { total: '0', limit: '100', RaceTable: { Races: [] }, StandingsTable: { StandingsLists: [] } }
  })
});

const failingFetch = async () => {
  throw new Error('Network offline');
};

describe('Issue #41: Lap-by-Lap State Reset & 2024 Fallback Isolation', () => {
  test('onLapSeasonChange resets prior 2024 lapChartState and blocks 2024 fallback leaks on 2025/2026/historical seasons', async () => {
    const env = createTestEnv(emptyFetch);
    const { exp, elements, chartInstances } = env;

    // 1. Load 2024 (falls back to 2024 Bahrain telemetry)
    await exp.loadLapTelemetry('2024', '1', true);
    exp.lapChartState.driverVisibility['max_verstappen'] = false;
    exp.lapChartState.seasonLapsByRound['1'] = [{ number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] }];
    exp.lapChartState.seasonResults = [{ season: '2024', round: '1', raceName: 'Bahrain Grand Prix', Results: [] }];
    assert.strictEqual(chartInstances.length, 1);
    assert.strictEqual(elements['lapChartTotalLapsBadge'].textContent, '57 Laps');

    // 2. Switch to 2025 (empty JOLPICA response)
    await exp.onLapSeasonChange('2025');
    assert.strictEqual(exp.lapChartState.season, '2025');
    assert.strictEqual(exp.lapChartState.round, '1');
    assert.deepStrictEqual({ ...exp.lapChartState.seasonLapsByRound }, {});
    assert.strictEqual(exp.lapChartState.seasonResults.length, 0);
    assert.strictEqual(exp.lapChartState.resultsData.length, 0);
    assert.strictEqual(exp.lapChartState.lapsData.length, 0);
    assert.deepStrictEqual({ ...exp.lapChartState.driverVisibility }, {});
    assert.strictEqual(exp.lapChartState.chartInstance, null);
    assert.strictEqual(chartInstances[0].destroyed, true);

    assert.ok(!elements['lapChartVenueTitle'].textContent.includes('Bahrain Grand Prix'));
    assert.ok(!elements['lapChartVenueSubtitle'].textContent.includes('Sakhir Circuit'));
    assert.strictEqual(elements['lapChartTotalLapsBadge'].textContent, '0 Laps');
    assert.strictEqual(elements['lapChartWinnerBadge'].textContent, 'Winner: —');
    assert.strictEqual(elements['roundLeadTimeline'].innerHTML, '');
    assert.strictEqual(elements['roundLapsLedTableBody'].innerHTML, '');
    assert.strictEqual(elements['lapRoundSelect'].children[0].textContent, 'Round 1');
    assert.strictEqual(elements['lapsLedTopDriverName'].textContent, '—');
    assert.strictEqual(exp.lapChartState.seasonLapsLed.isFallback, false);
    assert.strictEqual(exp.lapChartState.seasonLapsLed.leaderboard.length, 0);

    // 3. Switch to 2026 and historical 1988
    for (const yr of ['2026', '1988']) {
      await exp.onLapSeasonChange(yr);
      assert.strictEqual(exp.lapChartState.season, yr);
      assert.strictEqual(elements['lapChartTotalLapsBadge'].textContent, '0 Laps');
      assert.strictEqual(elements['lapChartWinnerBadge'].textContent, 'Winner: —');
      assert.ok(!elements['lapChartVenueTitle'].textContent.includes('Bahrain Grand Prix'));
      assert.strictEqual(exp.lapChartState.seasonLapsLed.leaderboard.length, 0);
    }
  });

  test('loadLapTelemetry catch block resets state and does not leak 2024 Bahrain fallback for non-2024 seasons', async () => {
    const env = createTestEnv(failingFetch);
    const { exp, elements } = env;

    // 2024 retains offline fallback
    await exp.loadLapTelemetry('2024', '1', true);
    assert.strictEqual(elements['lapChartTotalLapsBadge'].textContent, '57 Laps');
    assert.strictEqual(elements['lapChartWinnerBadge'].textContent, 'Winner: Max Verstappen');

    // Direct call to loadLapTelemetry('2025', '2', true) without onLapSeasonChange
    // Wait: fetchSeasonResults/fetchLapPositions catch inside Promise.all, so force throw from render/fetch by rejecting fetchWithRetry
    env.context.fetchSeasonResults = async () => { throw new Error('boom'); };
    await exp.loadLapTelemetry('2025', '2', true);

    assert.strictEqual(exp.lapChartState.season, '2025');
    assert.strictEqual(exp.lapChartState.round, '2');
    assert.deepStrictEqual({ ...exp.lapChartState.seasonLapsByRound }, {});
    assert.strictEqual(elements['lapChartTotalLapsBadge'].textContent, '0 Laps');
    assert.strictEqual(elements['lapChartWinnerBadge'].textContent, 'Winner: —');
    assert.ok(!elements['lapChartVenueTitle'].textContent.includes('Bahrain Grand Prix'));
    assert.strictEqual(elements['roundLeadTimeline'].innerHTML, '');
    assert.strictEqual(elements['roundLapsLedTableBody'].innerHTML, '');
    assert.strictEqual(elements['lapRoundSelect'].children[0].textContent, 'Round 2');
  });

  test('loadSeasonLapsLed resets prior 2024 seasonResults and seasonLapsByRound when called for 2025/2026', async () => {
    const env = createTestEnv(async (url) => {
      if (url.includes('/2025/results.json')) {
        return { ok: true, status: 200, json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } }) };
      }
      return emptyFetch();
    });
    const { exp, queriedUrls } = env;

    // Seed 2024 state
    exp.lapChartState.season = '2024';
    exp.lapChartState.seasonResults = [{ season: '2024', round: '1', raceName: 'Bahrain Grand Prix', Results: [] }];
    exp.lapChartState.seasonLapsByRound = {
      '1': [{ number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] }]
    };

    const res2025 = await exp.loadSeasonLapsLed('2025');
    assert.strictEqual(res2025.season, '2025');
    assert.strictEqual(res2025.totalLapsLed, 0);
    assert.strictEqual(res2025.leaderboard.length, 0);
    assert.strictEqual(res2025.isFallback, false);
    assert.deepStrictEqual({ ...exp.lapChartState.seasonLapsByRound }, {});
    assert.strictEqual(exp.lapChartState.seasonResults.length, 0);
    assert.ok(queriedUrls.some(u => u.includes('/2025/results.json')));
  });

  test('onLapRoundChange preserves seasonLapsByRound across rounds within the same season', async () => {
    const env = createTestEnv(async (url) => {
      if (url.includes('/2025/results.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '2',
              limit: '100',
              RaceTable: {
                Races: [
                  { season: '2025', round: '1', raceName: 'Australian Grand Prix', Results: [{ position: '1', grid: '1', laps: '1', status: 'Finished', Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' }, Constructor: { constructorId: 'mclaren', name: 'McLaren' } }] },
                  { season: '2025', round: '2', raceName: 'Chinese Grand Prix', Results: [{ position: '1', grid: '1', laps: '1', status: 'Finished', Driver: { driverId: 'piastri', givenName: 'Oscar', familyName: 'Piastri', code: 'PIA' }, Constructor: { constructorId: 'mclaren', name: 'McLaren' } }] }
                ]
              }
            }
          })
        };
      }
      if (url.includes('/2025/1/laps.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ MRData: { total: '1', limit: '2000', RaceTable: { Races: [{ Laps: [{ number: '1', Timings: [{ driverId: 'norris', position: '1' }] }] }] } } })
        };
      }
      if (url.includes('/2025/2/laps.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ MRData: { total: '1', limit: '2000', RaceTable: { Races: [{ Laps: [{ number: '1', Timings: [{ driverId: 'piastri', position: '1' }] }] }] } } })
        };
      }
      return emptyFetch();
    });
    const { exp } = env;

    await exp.loadLapTelemetry('2025', '1', true);
    assert.ok(exp.lapChartState.seasonLapsByRound['1']);
    await exp.onLapRoundChange('2');
    assert.ok(exp.lapChartState.seasonLapsByRound['1'], 'Round 1 laps must remain cached for same season');
    assert.ok(exp.lapChartState.seasonLapsByRound['2'], 'Round 2 laps must be stored');
  });
});

describe('Issue #41: Circuit Profiler 2024 Fallback Isolation', () => {
  test('computeProfilerMetrics isolates 2024 fallback from 2025/2026 and historical seasons', () => {
    const { exp } = createTestEnv();

    const fb2024 = exp.computeProfilerMetrics([], [], [], '2024');
    assert.ok(fb2024.teams.length >= 10);
    assert.strictEqual(fb2024.circuits.length, 24);

    for (const yr of ['2025', '2026', '1995']) {
      const empty = exp.computeProfilerMetrics([], [], [], yr);
      assert.strictEqual(empty.season, yr);
      assert.strictEqual(empty.teams.length, 0);
      assert.strictEqual(empty.circuits.length, 0);
      assert.strictEqual(empty.isFallback, false);
    }
  });

  test('loadProfilerData resets stale 2024 UI, destroys radar chart, and avoids caching empty non-2024 seasons', async () => {
    const env = createTestEnv(emptyFetch);
    const { exp, elements, chartInstances, storage } = env;

    await exp.loadProfilerData('2024', true);
    assert.strictEqual(chartInstances.length, 1);
    assert.strictEqual(elements['profilerKpiPowerTeam'].textContent, 'Ferrari');
    assert.ok(elements['profilerTeamPills'].innerHTML.includes('McLaren'));

    await exp.onProfilerSeasonChange('2026');
    assert.strictEqual(exp.circuitProfilerState.season, '2026');
    assert.strictEqual(exp.circuitProfilerState.metrics.teams.length, 0);
    assert.strictEqual(exp.circuitProfilerState.circuits.length, 0);
    assert.strictEqual(chartInstances.length, 1, 'must not create a new radar chart on empty 2026 data');
    assert.strictEqual(chartInstances[0].destroyed, true, 'must destroy stale 2024 radar chart');
    assert.strictEqual(elements['profilerTeamPills'].innerHTML, '');
    assert.strictEqual(elements['profilerKpiPowerTeam'].textContent, '—');
    assert.strictEqual(elements['profilerKpiStreetTeam'].textContent, '—');
    assert.strictEqual(elements['profilerKpiEfficiencyTeam'].textContent, '—');
    assert.strictEqual(elements['profilerKpiDegTeam'].textContent, '—');
    assert.ok(elements['profilerDeltaMatrixBody'].innerHTML.includes('No matrix telemetry available'));
    assert.ok(elements['profilerCircuitsList'].innerHTML.includes('No circuits match this archetype'));
    assert.strictEqual(elements['profilerCacheBadge'].textContent, '⚠️ Live Telemetry Offline');
    assert.strictEqual(storage['f1_circuit_profiler_v1_2026'], undefined);
  });
});

describe('Issue #41: Finishing Gap 2024 Fallback Isolation', () => {
  test('computeFinishingGapMetrics isolates 2024 fallback from 2025/2026 and historical seasons', () => {
    const { exp } = createTestEnv();

    const fbC = exp.computeFinishingGapMetrics([], 'constructors', '2024');
    assert.strictEqual(fbC.competitors.length, 10);
    const fbD = exp.computeFinishingGapMetrics([], 'drivers', '2024');
    assert.strictEqual(fbD.competitors.length, 10);

    for (const yr of ['2025', '2026', '2005']) {
      for (const scope of ['constructors', 'drivers']) {
        const empty = exp.computeFinishingGapMetrics([], scope, yr);
        assert.strictEqual(empty.season, yr);
        assert.strictEqual(empty.scope, scope);
        assert.strictEqual(empty.competitors.length, 0);
        assert.strictEqual(empty.rounds.length, 0);
        assert.strictEqual(empty.benchmarkLeader, null);
        assert.strictEqual(empty.closestFinish, null);
        assert.strictEqual(empty.isFallback, false);
      }
    }
  });

  test('onFinishingGapSeasonChange resets venue filter, rebuilds venue dropdown, and resets stale 2024 KPIs/chart', async () => {
    const env = createTestEnv(emptyFetch);
    const { exp, elements, chartInstances } = env;

    await exp.loadFinishingGapData('2024', true);
    exp.setFinishingGapVenueFilter('16');
    assert.strictEqual(chartInstances.length, 2);
    assert.strictEqual(elements['fgKpiBenchmarkTeam'].textContent, 'Ferrari');
    assert.ok(elements['finishingGapVenueSelect'].options.length > 1);

    await exp.onFinishingGapSeasonChange('2025');
    assert.strictEqual(exp.finishingGapState.season, '2025');
    assert.strictEqual(exp.finishingGapState.venueRound, 'all');
    assert.strictEqual(exp.finishingGapState.metrics.competitors.length, 0);
    assert.strictEqual(chartInstances[chartInstances.length - 1].destroyed, true);
    assert.strictEqual(elements['finishingGapVenueSelect'].options.length, 1);
    assert.strictEqual(elements['fgKpiBenchmarkTeam'].textContent, '—');
    assert.strictEqual(elements['fgKpiClosestRound'].textContent, '—');
    assert.strictEqual(elements['fgKpiClosestDriver'].textContent, '—');
    assert.strictEqual(elements['finishingGapTableBody'].innerHTML, '');
    assert.strictEqual(elements['finishingGapFilterBadge'].textContent, 'Showing 0 Teams');
  });
});

describe('Issue #41: Clinch Engine 2024 Fallback Isolation', () => {
  test('loadClinchEngineData retains 2024 fallback on error but clears state without 2024 fallback on 2025/2026/historical', async () => {
    const env = createTestEnv(failingFetch);
    const { exp, elements } = env;

    await exp.loadClinchEngineData('2024', 'latest', true);
    assert.ok(exp.clinchState.standings.length > 0);
    assert.strictEqual(elements['clinchKpiLeaderName'].textContent, 'Max Verstappen');

    for (const yr of ['2025', '2026', '2010']) {
      await exp.loadClinchEngineData(yr, 'latest', true);
      assert.strictEqual(exp.clinchState.season, yr);
      assert.strictEqual(exp.clinchState.standings.length, 0);
      assert.strictEqual(exp.clinchState.totalRaces, 0);
      assert.strictEqual(elements['clinchKpiLeaderName'].textContent, '—');
      assert.strictEqual(elements['clinchSimControlsGrid'].innerHTML, '');
      assert.strictEqual(elements['clinchScenarioList'].innerHTML, '');
      assert.strictEqual(elements['clinchTiebreakerContent'].innerHTML, '');
      assert.strictEqual(elements['clinchMatrixTableBody'].innerHTML, '');
      assert.strictEqual(elements['clinchCacheBadge'].textContent, '⚠️ Telemetry Unavailable');
      assert.strictEqual(elements['clinchError'].style.display, 'block');
      assert.ok(elements['clinchError'].textContent.includes(yr));
    }
  });
});

describe('Issue #41: Momentum, Reliability, and Stint Non-2024 Failure Reset', () => {
  test('loadConstructorMomentumData catch block clears prior 2024 metrics and destroys chart for non-2024 seasons', async () => {
    const env = createTestEnv(failingFetch);
    const { exp, elements, chartInstances } = env;

    await exp.loadConstructorMomentumData('2024', true);
    assert.strictEqual(exp.constructorMomentumState.sortedConstructors.length, 10);
    assert.strictEqual(chartInstances.length, 1);

    await exp.onMomentumSeasonChange('2025');
    assert.strictEqual(exp.constructorMomentumState.season, '2025');
    assert.strictEqual(exp.constructorMomentumState.sortedConstructors.length, 0);
    assert.strictEqual(chartInstances[0].destroyed, true);
    assert.strictEqual(elements['momentumKpiGainerTeam'].textContent, '—');
    assert.strictEqual(elements['momentumTeamLegendPills'].innerHTML, '');
    assert.ok(elements['constructorMomentumTableBody'].innerHTML.includes('No constructor momentum data'));
  });

  test('loadReliabilityData catch block clears prior 2024 metrics when non-2024 season throws', async () => {
    const env = createTestEnv(failingFetch);
    const { exp, elements, chartInstances } = env;

    await exp.loadReliabilityData('2024', true);
    assert.ok(exp.reliabilityState.metrics.constructors.length > 0);
    assert.strictEqual(chartInstances.length, 1);

    // Force catch path via rejecting fetchAllJolpicaPages
    env.context.fetchAllJolpicaPages = async () => { throw new Error('API down'); };
    const res2026 = await exp.loadReliabilityData('2026', true);
    assert.strictEqual(res2026.season, '2026');
    assert.strictEqual(res2026.constructors.length, 0);
    assert.strictEqual(exp.reliabilityState.metrics.constructors.length, 0);
    assert.strictEqual(chartInstances[0].destroyed, true);
    assert.strictEqual(elements['relKpiFinishedVal'].textContent, '0.0%');
  });

  test('onStintSeasonChange and loadStintDegradationData clear prior 2024 stint data on non-2024 empty/error seasons', async () => {
    const env = createTestEnv(emptyFetch);
    const { exp, elements, chartInstances } = env;

    await exp.loadStintDegradationData('2024', '1', true);
    assert.ok(exp.stintDegradationState.resultsData.length > 0);
    assert.ok(chartInstances.length >= 2);

    await exp.onStintSeasonChange('2026');
    assert.strictEqual(exp.stintDegradationState.season, '2026');
    assert.strictEqual(exp.stintDegradationState.resultsData.length, 0);
    assert.strictEqual(exp.stintDegradationState.lapsData.length, 0);
    assert.strictEqual(elements['stintRoundSelect'].options[0].textContent, 'Round 1');
    assert.strictEqual(elements['kpiLowestDegDriver'].textContent, '--');
    assert.strictEqual(elements['teamPaceDegradationTableBody'].innerHTML, '');
  });
});
