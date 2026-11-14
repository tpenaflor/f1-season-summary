const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------------------------------------------------------------------------
// Issue #33: Post-2012 Pit Stop Telemetry pipeline
// ---------------------------------------------------------------------------

const htmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const mainScript = (() => {
  const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    if (match[1].includes('loadPitStopTelemetry')) return match[1];
  }
  throw new Error('Main script with loadPitStopTelemetry not found');
})();

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

function createTestEnv({ fetchImpl, storage } = {}) {
  const elements = {};
  const fetchCalls = [];
  const chartConfigs = [];

  function createMockElement(id) {
    return {
      id,
      style: { display: 'none' },
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
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
  const getEl = (id) => (elements[id] = elements[id] || createMockElement(id));

  const mockDoc = {
    getElementById: getEl,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: (tag) => createMockElement('created_' + tag)
  };

  const defaultFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout,
    clearTimeout,
    document: mockDoc,
    window: { addEventListener() {}, removeEventListener() {} },
    module: { exports: {} },
    localStorage: storage || createMockStorage(),
    fetch: async (url, opts) => {
      fetchCalls.push(String(url));
      return (fetchImpl || defaultFetch)(String(url), opts);
    },
    Chart: function (ctx, config) {
      chartConfigs.push(config);
      return { destroy() {}, update() {} };
    }
  };
  context.window.document = mockDoc;
  context.addEventListener = () => {};

  vm.createContext(context);
  vm.runInContext(mainScript, context);
  return { context, elements, fetchCalls, chartConfigs, storage: context.localStorage };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const DRIVERS = {
  max_verstappen: { code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', name: 'Red Bull' },
  norris: { code: 'NOR', givenName: 'Lando', familyName: 'Norris', constructorId: 'mclaren', name: 'McLaren' },
  hamilton: { code: 'HAM', givenName: 'Lewis', familyName: 'Hamilton', constructorId: 'mercedes', name: 'Mercedes' }
};

function buildResultsRace(round, raceName) {
  return {
    season: '2024',
    round: String(round),
    raceName,
    date: `2024-03-0${round}`,
    Results: Object.entries(DRIVERS).map(([driverId, d], i) => ({
      position: String(i + 1),
      Driver: { driverId, code: d.code, givenName: d.givenName, familyName: d.familyName },
      Constructor: { constructorId: d.constructorId, name: d.name }
    }))
  };
}

// Round 1 lane times: median 22.2 => baseline 19.6 => stationary 1.9 / 2.4 / 2.8 / 15.4 (critical)
// Round 2 lane times: median 20.95 => baseline 18.35 => stationary 1.8(floor) / 2.45 / 2.75 / 8.15 (warning)
const PIT_ROUND_1 = [
  { driverId: 'max_verstappen', lap: '18', stop: '1', time: '15:30:00', duration: '21.500' },
  { driverId: 'norris', lap: '19', stop: '1', time: '15:31:00', duration: '22.000' },
  { driverId: 'hamilton', lap: '20', stop: '1', time: '15:32:00', duration: '22.400' },
  { driverId: 'max_verstappen', lap: '40', stop: '2', time: '16:00:00', duration: '35.000' }
];
const PIT_ROUND_2 = [
  { driverId: 'max_verstappen', lap: '15', stop: '1', time: '15:30:00', duration: '20.000' },
  { driverId: 'norris', lap: '16', stop: '1', time: '15:31:00', duration: '20.800' },
  { driverId: 'hamilton', lap: '17', stop: '1', time: '15:32:00', duration: '21.100' },
  { driverId: 'norris', lap: '35', stop: '2', time: '16:00:00', duration: '26.500' }
];
const RACE_NAMES = { 1: 'Bahrain Grand Prix', 2: 'Saudi Arabian Grand Prix' };

function pitPage(races, total, limit, offset) {
  return { MRData: { total: String(total), limit: String(limit), offset: String(offset), RaceTable: { season: '2024', Races: races } } };
}

// Simulates Jolpica: season-wide /2024/pitstops.json paginated (limit 4 per page).
function makeSeasonFetch({ seasonPitstopsStatus = 200, perRound = false } = {}) {
  return async (url) => {
    const u = new URL(url);
    const offset = parseInt(u.searchParams.get('offset') || '0', 10);
    if (/\/2024\/results\.json/.test(u.pathname)) {
      return jsonResponse({ MRData: { total: '6', limit: '1000', offset: '0', RaceTable: { Races: [buildResultsRace(1, RACE_NAMES[1]), buildResultsRace(2, RACE_NAMES[2])] } } });
    }
    if (/\/2024\/pitstops\.json/.test(u.pathname)) {
      if (seasonPitstopsStatus !== 200) return jsonResponse({ detail: 'Bad Request' }, seasonPitstopsStatus);
      if (offset === 0) return jsonResponse(pitPage([{ round: '1', raceName: RACE_NAMES[1], PitStops: PIT_ROUND_1 }], 8, 4, 0));
      if (offset === 4) return jsonResponse(pitPage([{ round: '2', raceName: RACE_NAMES[2], PitStops: PIT_ROUND_2 }], 8, 4, 4));
      return jsonResponse(pitPage([], 8, 4, offset));
    }
    const roundMatch = u.pathname.match(/\/2024\/(\d+)\/pitstops\.json/);
    if (perRound && roundMatch) {
      const rnd = roundMatch[1];
      const stops = rnd === '1' ? PIT_ROUND_1 : PIT_ROUND_2;
      return jsonResponse(pitPage([{ round: rnd, raceName: RACE_NAMES[rnd], PitStops: stops }], stops.length, 100, 0));
    }
    return jsonResponse({}, 404);
  };
}

describe('Issue #33: pit stop computation helpers', () => {
  test('parsePitDurationSeconds handles seconds, m:ss and invalid input', () => {
    const { context } = createTestEnv();
    assert.equal(context.parsePitDurationSeconds('22.345'), 22.345);
    assert.equal(context.parsePitDurationSeconds('1:02.500'), 62.5);
    assert.equal(context.parsePitDurationSeconds(24.1), 24.1);
    assert.equal(context.parsePitDurationSeconds('abc'), null);
    assert.equal(context.parsePitDurationSeconds(''), null);
    assert.equal(context.parsePitDurationSeconds(null), null);
  });

  test('computePitQuantile uses linear interpolation', () => {
    const { context } = createTestEnv();
    assert.equal(context.computePitQuantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(context.computePitQuantile([1, 2, 3, 4, 5], 0.25), 2);
    assert.equal(context.computePitQuantile([], 0.5), null);
    assert.equal(context.computePitQuantile([7], 0.75), 7);
  });

  test('normalizePitStopData maps constructors, estimates stationary time and flags outliers', () => {
    const { context } = createTestEnv();
    const results = [buildResultsRace(1, RACE_NAMES[1]), buildResultsRace(2, RACE_NAMES[2])];
    const pits = [
      { round: '1', raceName: RACE_NAMES[1], PitStops: PIT_ROUND_1 },
      { round: '2', raceName: RACE_NAMES[2], PitStops: PIT_ROUND_2 }
    ];
    const { races, stops } = context.normalizePitStopData(pits, results);
    assert.equal(races.length, 2);
    assert.equal(stops.length, 8);

    const verR1 = stops.find(s => s.round === '1' && s.driverId === 'max_verstappen' && s.stop === 1);
    assert.equal(verR1.constructorId, 'red_bull');
    assert.equal(verR1.code, 'VER');
    assert.ok(Math.abs(verR1.stationary - 1.9) < 1e-9);
    assert.equal(verR1.severity, 'clean');

    const penalty = stops.find(s => s.round === '1' && s.stop === 2);
    assert.equal(penalty.severity, 'critical');
    const slow = stops.find(s => s.round === '2' && s.driverId === 'norris' && s.stop === 2);
    assert.equal(slow.severity, 'warning');

    const floored = stops.find(s => s.round === '2' && s.driverId === 'max_verstappen');
    assert.equal(floored.stationary, 1.8, 'stationary estimate floored at physical minimum');
    assert.ok(floored.stationaryRaw < 1.8);
  });

  test('computeCrewBenchmarks honours outlier segregation', () => {
    const { context } = createTestEnv();
    const { stops } = context.normalizePitStopData(
      [{ round: '1', PitStops: PIT_ROUND_1 }, { round: '2', PitStops: PIT_ROUND_2 }],
      [buildResultsRace(1, RACE_NAMES[1]), buildResultsRace(2, RACE_NAMES[2])]
    );
    const segregated = context.computeCrewBenchmarks(stops, true);
    const rbSeg = segregated.find(r => r.constructorId === 'red_bull');
    assert.equal(rbSeg.totalStops, 3);
    assert.equal(rbSeg.stopCount, 2);
    assert.equal(rbSeg.outlierCount, 1);
    assert.equal(rbSeg.criticalCount, 1);
    assert.equal(rbSeg.flawless, 2);
    assert.equal(segregated[0].constructorId, 'red_bull', 'ranked by median stationary time');

    const inclusive = context.computeCrewBenchmarks(stops, false);
    const rbAll = inclusive.find(r => r.constructorId === 'red_bull');
    assert.equal(rbAll.stopCount, 3);
    assert.ok(rbAll.slowest > 10);

    const kpis = context.computePitStopKpis(stops, true);
    assert.equal(kpis.totalStops, 8);
    assert.equal(kpis.includedStops, 6);
    assert.equal(kpis.outliers, 2);
    assert.equal(kpis.critical, 1);
    assert.equal(kpis.warning, 1);
    assert.equal(kpis.fastest.driverId, 'max_verstappen');
    assert.equal(kpis.fastest.round, '2');

    const dhl = context.getPitStopDhlLeaderboard(stops, 10);
    assert.equal(dhl.length, 6);
    assert.ok(dhl.every(s => s.severity === 'clean'));
  });
});

describe('Issue #33: loadPitStopTelemetry post-2012 pipeline', () => {
  test('fetches paginated pitstops.json & results.json, renders widgets and caches', async () => {
    const env = createTestEnv({ fetchImpl: makeSeasonFetch() });
    const { context, elements, fetchCalls, chartConfigs, storage } = env;
    await context.loadPitStopTelemetry('2024');

    const pitCalls = fetchCalls.filter(u => u.includes('/2024/pitstops.json'));
    assert.equal(pitCalls.length, 2, 'two pitstop pages fetched');
    assert.ok(pitCalls[1].includes('offset=4'));
    assert.ok(fetchCalls.some(u => u.includes('/2024/results.json')));

    assert.equal(elements.pitStopPlaceholder.style.display, 'none');
    assert.equal(elements.pitStopMainContent.style.display, 'block');
    assert.ok(elements.pitStopCacheBadge.textContent.includes('Live Telemetry'));

    const roundHtml = elements.pitStopRoundSelect.innerHTML;
    assert.ok(roundHtml.includes('value="all"'));
    assert.ok(roundHtml.includes('Round 1: Bahrain Grand Prix'));
    assert.ok(roundHtml.includes('Round 2: Saudi Arabian Grand Prix'));

    assert.equal(elements.kpiPitFastest.textContent, '1.80 s');
    assert.ok(elements.kpiPitFastestSub.textContent.includes('VER'));
    assert.equal(elements.kpiPitOutliers.textContent, '2');
    assert.ok(elements.kpiPitFlawless.textContent.endsWith('%'));
    assert.ok(elements.pitStopMatrixTableBody.innerHTML.includes('Red Bull'));
    assert.ok(elements.pitStopMatrixTableBody.innerHTML.includes('McLaren'));
    assert.ok(elements.pitStopOdometerGrid.innerHTML.includes('odometer-card'));
    assert.ok(elements.pitStopDhlLeaderboard.innerHTML.includes('dhl-rank-item'));
    assert.ok(elements.pitStopOutliersChips.innerHTML.includes('outlier-chip critical'));
    assert.ok(elements.pitStopOutliersChips.innerHTML.includes('outlier-chip warning'));

    assert.equal(chartConfigs.length, 1);
    assert.equal(chartConfigs[0].options.indexAxis, 'y');
    assert.equal(chartConfigs[0].data.labels.length, 3);

    const cached = JSON.parse(storage.getItem('f1_pitstop_telemetry_v1_2024'));
    assert.equal(cached.stops.length, 8);
  });

  test('uses localStorage cache unless forceRefresh is requested', async () => {
    const storage = createMockStorage();
    const first = createTestEnv({ fetchImpl: makeSeasonFetch(), storage });
    await first.context.loadPitStopTelemetry('2024');

    const second = createTestEnv({ fetchImpl: makeSeasonFetch(), storage });
    await second.context.loadPitStopTelemetry('2024');
    assert.equal(second.fetchCalls.length, 0, 'cache hit performs no network calls');
    assert.ok(second.elements.pitStopCacheBadge.textContent.includes('Cached'));
    assert.equal(second.elements.kpiPitOutliers.textContent, '2');

    await second.context.loadPitStopTelemetry('2024', true);
    assert.ok(second.fetchCalls.some(u => u.includes('/2024/pitstops.json')), 'forceRefresh refetches');
    assert.ok(second.elements.pitStopCacheBadge.textContent.includes('Live Telemetry'));
  });

  test('falls back to per-round pitstops when season-wide endpoint is rejected', async () => {
    const env = createTestEnv({ fetchImpl: makeSeasonFetch({ seasonPitstopsStatus: 400, perRound: true }) });
    await env.context.loadPitStopTelemetry('2024');
    assert.ok(env.fetchCalls.some(u => u.includes('/2024/1/pitstops.json')));
    assert.ok(env.fetchCalls.some(u => u.includes('/2024/2/pitstops.json')));
    assert.equal(env.context.getPitStopTelemetryState().pitstops.length, 8);
    assert.equal(env.elements.kpiPitOutliers.textContent, '2');
  });

  test('surfaces API failure in #pitStopError without throwing', async () => {
    const env = createTestEnv({ fetchImpl: async () => jsonResponse({}, 404) });
    await env.context.loadPitStopTelemetry('2024');
    assert.equal(env.elements.pitStopError.style.display, 'block');
    assert.ok(env.elements.pitStopError.textContent.includes('2024'));
    assert.ok(env.elements.pitStopCacheBadge.textContent.includes('Sync Failed'));
    assert.ok(env.elements.pitStopMatrixTableBody.innerHTML.includes('No pit stop telemetry'));
  });

  test('pre-2012 seasons still short-circuit without network calls', async () => {
    const env = createTestEnv({ fetchImpl: makeSeasonFetch() });
    await env.context.loadPitStopTelemetry('2010');
    assert.equal(env.fetchCalls.length, 0);
    assert.equal(env.elements.pitStopPlaceholder.style.display, 'block');
    assert.equal(env.elements.pitStopMainContent.style.display, 'none');
  });
});

describe('Issue #33: filterPitStopRound & updatePitStopOutlierFilter', () => {
  test('both handlers are defined in index.html', () => {
    const { context } = createTestEnv();
    assert.equal(typeof context.filterPitStopRound, 'function');
    assert.equal(typeof context.updatePitStopOutlierFilter, 'function');
  });

  test('filterPitStopRound scopes KPIs/table to a round and resets invalid rounds', async () => {
    const env = createTestEnv({ fetchImpl: makeSeasonFetch() });
    await env.context.loadPitStopTelemetry('2024');

    const r1 = env.context.onPitStopRoundChange('1');
    assert.equal(r1.stops.length, 4);
    assert.ok(r1.stops.every(s => s.round === '1'));
    assert.equal(env.elements.pitStopRoundSelect.value, '1');
    assert.equal(env.elements.kpiPitOutliers.textContent, '1');
    assert.equal(env.elements.kpiPitFastest.textContent, '1.90 s');
    assert.ok(env.elements.pitStopQuickStatsPills.innerHTML.includes('Bahrain Grand Prix'));

    const bogus = env.context.filterPitStopRound('99');
    assert.equal(bogus.stops.length, 8);
    assert.equal(env.context.getPitStopTelemetryState().round, 'all');
    assert.equal(env.elements.pitStopRoundSelect.value, 'all');
  });

  test('updatePitStopOutlierFilter toggles inclusion of outliers in baseline stats', async () => {
    const env = createTestEnv({ fetchImpl: makeSeasonFetch() });
    await env.context.loadPitStopTelemetry('2024');

    const off = env.context.onPitStopOutlierToggleChange(false);
    assert.equal(env.context.getPitStopTelemetryState().excludeOutliers, false);
    assert.equal(off.kpis.includedStops, 8);
    assert.ok(env.elements.kpiPitMedianSub.textContent.includes('incl. outliers'));
    assert.ok(env.elements.pitStopOutlierIsolationStatus.textContent.includes('Included'));
    assert.ok(!env.elements.pitStopMatrixTableBody.innerHTML.includes('2/3'));

    const on = env.context.updatePitStopOutlierFilter(true);
    assert.equal(on.kpis.includedStops, 6);
    assert.ok(env.elements.pitStopOutlierIsolationStatus.textContent.includes('Segregated'));
    assert.ok(env.elements.pitStopMatrixTableBody.innerHTML.includes('2/3'));
    assert.equal(env.elements.pitStopOutlierToggle.checked, true);
  });
});
