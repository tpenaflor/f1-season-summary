const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------------------------------------------------------------------------
// Minimal DOM / fetch harness that tracks <select> options faithfully
// ---------------------------------------------------------------------------
function createTestEnv(routeFetch) {
  const elements = {};
  const queriedUrls = [];

  function createMockElement(id, tag = 'div') {
    const classSet = new Set();
    const el = {
      id,
      tagName: tag.toUpperCase(),
      classList: {
        add(...cls) { cls.forEach(c => classSet.add(c)); },
        remove(...cls) { cls.forEach(c => classSet.delete(c)); },
        toggle(c, force) {
          const on = force !== undefined ? force : !classSet.has(c);
          on ? classSet.add(c) : classSet.delete(c);
        },
        contains(c) { return classSet.has(c); }
      },
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        this.children = [];
        this.options = [];
      },
      textContent: '',
      value: '',
      selected: false,
      style: { display: 'none' },
      children: [],
      options: [],
      appendChild(child) {
        this.children.push(child);
        if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
          this.options.push(child);
          if (child.selected || this.options.length === 1) this.value = child.value;
        }
        return child;
      },
      addEventListener() {},
      removeEventListener() {},
      getContext() {
        return { canvas: {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {} };
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

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: (tag) => createMockElement('created_' + tag, tag)
  };

  class MockChart {
    constructor(ctx, config) { this.config = config; this.data = config?.data || {}; }
    destroy() {}
    resize() {}
    update() {}
  }

  const activeFetch = async (url) => {
    queriedUrls.push(url);
    const body = routeFetch ? await routeFetch(url) : null;
    if (body instanceof Error) throw body;
    return {
      ok: true,
      status: 200,
      json: async () => body || { MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } }
    };
  };

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');

  const context = {
    window: { document: mockDoc, addEventListener: () => {}, removeEventListener: () => {}, Chart: MockChart },
    document: mockDoc,
    Chart: MockChart,
    fetch: activeFetch,
    console: { ...console, warn: () => {}, error: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };
  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);

  // Seed the static markup defaults present in index.html
  const roundSel = getOrCreateEl('stintRoundSelect');
  const staticRound = createMockElement('opt', 'option');
  staticRound.value = '1';
  staticRound.textContent = 'Round 1 - Bahrain Grand Prix';
  roundSel.appendChild(staticRound);
  const driverSel = getOrCreateEl('stintDriverSelect');
  const staticDriver = createMockElement('opt', 'option');
  staticDriver.value = 'all';
  driverSel.appendChild(staticDriver);

  return { exp: context.module.exports, elements, queriedUrls };
}

// ---------------------------------------------------------------------------
// Jolpica-shaped mock data
// ---------------------------------------------------------------------------
const SCHEDULES = {
  '2024': [
    { round: '1', raceName: 'Bahrain Grand Prix' },
    { round: '2', raceName: 'Saudi Arabian Grand Prix' },
    { round: '3', raceName: 'Australian Grand Prix' }
  ],
  '2023': [
    { round: '1', raceName: 'Bahrain Grand Prix' },
    { round: '2', raceName: 'Saudi Arabian Grand Prix' }
  ]
};

const DRIVERS = {
  '2024_1': ['max_verstappen', 'perez', 'sainz'],
  '2024_2': ['max_verstappen', 'perez', 'leclerc'],
  '2024_3': ['sainz', 'leclerc', 'norris'],
  '2023_1': ['max_verstappen', 'alonso'],
  '2023_2': ['perez', 'max_verstappen', 'alonso']
};

function resultsFor(key) {
  return (DRIVERS[key] || []).map((id, i) => ({
    position: String(i + 1),
    Driver: { driverId: id, code: id.slice(0, 3).toUpperCase(), givenName: 'G', familyName: id },
    Constructor: { constructorId: 'team_' + i, name: 'Team ' + i }
  }));
}

function lapsFor(key) {
  const ids = DRIVERS[key] || [];
  const laps = [];
  for (let n = 1; n <= 10; n++) {
    laps.push({
      number: String(n),
      Timings: ids.map((id, i) => ({
        driverId: id,
        position: String(i + 1),
        time: `1:3${i}.${String(100 + n * 10).slice(-3)}`
      }))
    });
  }
  return laps;
}

function jolpicaRouter(url) {
  const sched = url.match(/\/(\d{4})\/races\.json/);
  if (sched) {
    const races = SCHEDULES[sched[1]] || [];
    return { MRData: { total: String(races.length), limit: '100', RaceTable: { season: sched[1], Races: races } } };
  }
  const m = url.match(/\/(\d{4})\/(\d+)\/(results|pitstops|laps)\.json/);
  if (!m) return null;
  const key = `${m[1]}_${m[2]}`;
  if (m[3] === 'results') {
    return { MRData: { total: '3', limit: '100', RaceTable: { Races: [{ Results: resultsFor(key) }] } } };
  }
  if (m[3] === 'pitstops') {
    return { MRData: { total: '0', limit: '1000', RaceTable: { Races: [{ PitStops: [] }] } } };
  }
  const laps = lapsFor(key);
  return { MRData: { total: '30', limit: '2000', RaceTable: { Races: [{ Laps: laps }] } } };
}

const optionValues = (sel) => sel.options.map(o => o.value);

// ---------------------------------------------------------------------------
describe('Issue #35: Stint Profiler round selector population', () => {
  test('loadStintDegradationData fetches /{season}/races.json and populates #stintRoundSelect', async () => {
    const { exp, elements, queriedUrls } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '2', false);

    assert.ok(queriedUrls.some(u => /\/2024\/races\.json/.test(u)), 'season schedule should be requested');
    const sel = elements.stintRoundSelect;
    assert.deepEqual(optionValues(sel), ['1', '2', '3']);
    assert.equal(sel.value, '2');
    assert.equal(sel.options[2].textContent, 'Round 3 - Australian Grand Prix');
  });

  test('season schedule is memoized per season (no refetch on round change)', async () => {
    const { exp, queriedUrls } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '1', false);
    await exp.onStintRoundChange('3');
    const scheduleCalls = queriedUrls.filter(u => /\/2024\/races\.json/.test(u));
    assert.equal(scheduleCalls.length, 1);
    assert.equal(exp.stintDegradationState.round, '3');
  });

  test('a round absent from the season schedule falls back to the first scheduled round', async () => {
    const { exp, elements } = createTestEnv(jolpicaRouter);
    const metrics = await exp.loadStintDegradationData('2023', '3', false);
    assert.equal(exp.stintDegradationState.round, '1');
    assert.equal(metrics.round, '1');
    assert.equal(elements.stintRoundSelect.value, '1');
    assert.deepEqual(optionValues(elements.stintRoundSelect), ['1', '2']);
  });

  test('schedule fetch failure keeps the requested round selectable and still renders', async () => {
    const router = (url) => (url.includes('races.json') ? new Error('boom') : jolpicaRouter(url));
    const { exp, elements } = createTestEnv(router);
    const metrics = await exp.loadStintDegradationData('2024', '2', false);
    assert.ok(metrics);
    assert.deepEqual(optionValues(elements.stintRoundSelect), ['2']);
    assert.equal(elements.stintRoundSelect.value, '2');
  });
});

describe('Issue #35: Stint Profiler driver selector rebuilds on every update', () => {
  test('driver options are rebuilt when the round changes (no longer frozen)', async () => {
    const { exp, elements } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '1', false);
    assert.deepEqual(optionValues(elements.stintDriverSelect), ['all', 'max_verstappen', 'perez', 'sainz']);

    await exp.onStintRoundChange('3');
    assert.deepEqual(optionValues(elements.stintDriverSelect), ['all', 'sainz', 'leclerc', 'norris']);
  });

  test('selected driver is preserved across rounds when still present', async () => {
    const { exp, elements } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '1', false);
    exp.onStintDriverFilterChange('perez');

    await exp.onStintRoundChange('2');
    assert.equal(exp.stintDegradationState.selectedDriver, 'perez');
    assert.equal(elements.stintDriverSelect.value, 'perez');
  });

  test('selected driver defaults to "all" when absent from the new round', async () => {
    const { exp, elements } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '1', false);
    exp.onStintDriverFilterChange('perez');

    await exp.onStintRoundChange('3');
    assert.equal(exp.stintDegradationState.selectedDriver, 'all');
    assert.equal(elements.stintDriverSelect.value, 'all');
    assert.ok(elements.btnStintFilterAll.classList.contains('active'));
  });

  test('"top5" preset survives a rebuild and keeps the dropdown on "all"', async () => {
    const { exp, elements } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '1', false);
    exp.setStintDriverFilter('top5');
    await exp.onStintRoundChange('2');
    assert.equal(exp.stintDegradationState.selectedDriver, 'top5');
    assert.equal(elements.stintDriverSelect.value, 'all');
  });

  test('cached (memoized) reloads also rebuild the driver list', async () => {
    const { exp, elements } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '1', false);
    await exp.loadStintDegradationData('2024', '3', false);
    await exp.loadStintDegradationData('2024', '1', false); // cache hit
    assert.deepEqual(optionValues(elements.stintDriverSelect), ['all', 'max_verstappen', 'perez', 'sainz']);
  });
});

describe('Issue #35: onStintSeasonChange resets round and driver', () => {
  test('season change resets round to "1" and selectedDriver to "all"', async () => {
    const { exp, elements, queriedUrls } = createTestEnv(jolpicaRouter);
    await exp.loadStintDegradationData('2024', '2', false);
    exp.onStintDriverFilterChange('max_verstappen');
    assert.equal(exp.stintDegradationState.round, '2');

    await exp.onStintSeasonChange('2023');
    const state = exp.stintDegradationState;
    assert.equal(state.season, '2023');
    assert.equal(state.round, '1');
    assert.equal(state.selectedDriver, 'all');
    assert.ok(queriedUrls.some(u => u.includes('/2023/1/results.json')));
    assert.ok(!queriedUrls.some(u => u.includes('/2023/2/results.json')));
    assert.ok(queriedUrls.some(u => /\/2023\/races\.json/.test(u)));
    assert.deepEqual(optionValues(elements.stintRoundSelect), ['1', '2']);
    assert.equal(elements.stintRoundSelect.value, '1');
    assert.deepEqual(optionValues(elements.stintDriverSelect), ['all', 'max_verstappen', 'alonso']);
    assert.equal(elements.stintDriverSelect.value, 'all');
    assert.ok(elements.btnStintFilterAll.classList.contains('active'));
  });

  test('stale responses from a superseded request do not overwrite the newer render', async () => {
    let releaseSlow;
    const slowGate = new Promise(r => { releaseSlow = r; });
    const router = async (url) => {
      if (url.includes('/2024/1/results.json')) await slowGate;
      return jolpicaRouter(url);
    };
    const { exp, elements } = createTestEnv(router);
    const slow = exp.loadStintDegradationData('2024', '1', false);
    const fast = exp.onStintSeasonChange('2023');
    await fast;
    releaseSlow();
    const slowResult = await slow;

    assert.equal(slowResult, null);
    assert.equal(exp.stintDegradationState.season, '2023');
    assert.deepEqual(optionValues(elements.stintDriverSelect), ['all', 'max_verstappen', 'alonso']);
  });
});
