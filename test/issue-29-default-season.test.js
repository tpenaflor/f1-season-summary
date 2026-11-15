'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');
const INDEX_HTML = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

const ALL_SEASON_DROPDOWN_IDS = [
  'lapSeasonSelect',
  'stintSeasonSelect',
  'finishingGapSeasonSelect',
  'profilerSeasonSelect',
  'constructorSeasonSelect',
  'momentumSeasonSelect',
  'sprintSeasonSelect',
  'clinchSeasonSelect',
  'pitStopSeasonSelect',
  'reliabilitySeasonSelect',
  'qualifyingSeasonSelect',
  'overtakeSeasonSelect',
  'telemetrySeasonSelect',
  'seasonSelect',
  'resultsSeasonSelect'
];

function createMockElement(id = '', tagName = 'DIV') {
  const listeners = {};
  const classes = new Set();
  let innerHtmlValue = '';
  const el = {
    id,
    tagName: tagName.toUpperCase(),
    value: '',
    textContent: '',
    checked: false,
    disabled: false,
    selected: false,
    style: { display: '' },
    children: [],
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        } else if (force) {
          classes.add(c);
        } else {
          classes.delete(c);
        }
      },
      contains: (c) => classes.has(c)
    },
    appendChild(child) {
      this.children.push(child);
      if (child.selected || this.children.length === 1) {
        this.value = child.value;
      }
      return child;
    },
    addEventListener(evt, cb) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    dispatchEvent(evt) {
      (listeners[evt.type] || []).forEach(cb => cb(evt));
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    getContext: () => ({})
  };
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return innerHtmlValue;
    },
    set(val) {
      innerHtmlValue = String(val);
      if (innerHtmlValue === '') {
        this.children.length = 0;
      }
    }
  });
  Object.defineProperty(el, 'options', {
    get() {
      return this.children;
    }
  });
  return el;
}

function createTestEnv(options = {}) {
  const elements = {};
  const getOrCreateEl = (id) => {
    if (!elements[id]) {
      elements[id] = createMockElement(id, id.endsWith('Select') ? 'SELECT' : 'DIV');
    }
    return elements[id];
  };

  if (options.seedStaticHtmlOptions) {
    for (const id of ALL_SEASON_DROPDOWN_IDS) {
      const sel = getOrCreateEl(id);
      for (const yr of ['2026', '2025', '2024']) {
        const opt = createMockElement('', 'OPTION');
        opt.value = yr;
        opt.textContent = `${yr} Season`;
        opt.selected = yr === '2026';
        sel.appendChild(opt);
      }
      sel.value = '2026';
    }
  }

  const domListeners = {};
  const queriedUrls = [];
  const storageMap = new Map();

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => createMockElement('', tag),
    addEventListener: (evt, cb) => {
      domListeners[evt] = domListeners[evt] || [];
      domListeners[evt].push(cb);
    }
  };

  const mockStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  };

  function MockChart() {
    this.destroy = () => {};
    this.update = () => {};
    this.resize = () => {};
  }

  const CustomDate = options.mockYear
    ? class extends Date {
        constructor(...args) {
          if (args.length === 0) {
            super(`${options.mockYear}-06-15T12:00:00Z`);
          } else {
            super(...args);
          }
        }
        static now() {
          return new Date(`${options.mockYear}-06-15T12:00:00Z`).getTime();
        }
      }
    : Date;

  const scriptMatch = INDEX_HTML.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, 'Main <script> block must exist in index.html');

  const context = {
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: async (url) => {
      queriedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          MRData: {
            total: '0',
            limit: '100',
            RaceTable: { Races: [] },
            StandingsTable: { StandingsLists: [] }
          }
        })
      };
    },
    console: { ...console, log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date: CustomDate,
    Math,
    JSON,
    Set,
    Map,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    module: { exports: {} },
    exports: {}
  };
  context.window = {
    addEventListener: () => {},
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);

  return {
    context,
    exports: context.module.exports,
    elements,
    queriedUrls,
    triggerDOMContentLoaded: () => {
      (domListeners.DOMContentLoaded || []).forEach(fn => fn());
    }
  };
}

describe('Issue #29: Set current season as default in drop-downs', () => {
  test('all 15 static HTML season dropdowns in index.html default to current year (2026) selected', () => {
    const expectedYear = String(new Date().getFullYear());
    for (const id of ALL_SEASON_DROPDOWN_IDS) {
      const regex = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`);
      const match = INDEX_HTML.match(regex);
      assert.ok(match, `Season dropdown #${id} must exist in index.html`);

      const selectedOptions = [...match[1].matchAll(/<option[^>]*value="(\d{4})"[^>]*\bselected\b[^>]*>/g)].map(m => m[1]);
      assert.deepStrictEqual(
        selectedOptions,
        [expectedYear],
        `#${id} static HTML must have only "${expectedYear}" selected, got: ${selectedOptions.join(', ')}`
      );
    }
  });

  test('getCurrentSeasonYear dynamically reads new Date().getFullYear()', () => {
    const currentEnv = createTestEnv();
    assert.strictEqual(currentEnv.exports.getCurrentSeasonYear(), new Date().getFullYear());

    const futureEnv = createTestEnv({ mockYear: 2028 });
    assert.strictEqual(futureEnv.exports.getCurrentSeasonYear(), 2028);
  });

  test('populateAllSeasonDropdowns defaults all 15 dropdowns to dynamic current year when uninitialized', () => {
    const env = createTestEnv({ mockYear: 2027 });
    env.exports.populateAllSeasonDropdowns();

    for (const id of ALL_SEASON_DROPDOWN_IDS) {
      const sel = env.elements[id];
      assert.ok(sel, `#${id} should be populated`);
      assert.strictEqual(sel.value, '2027', `#${id}.value should default to 2027`);
      assert.deepStrictEqual(sel.children.map(o => o.value), ['2027', '2026', '2025']);
      assert.strictEqual(sel.children[0].selected, true, `#${id} first option (2027) must be selected`);
      assert.strictEqual(sel.children[1].selected, false);
      assert.strictEqual(sel.children[2].selected, false);
    }
  });

  test('populateQualifyingSeasonDropdown and populateOvertakeSeasonDropdown default empty selects to current year', () => {
    const env = createTestEnv({ mockYear: 2029 });
    env.exports.populateQualifyingSeasonDropdown();
    env.exports.populateOvertakeSeasonDropdown();

    const qualSel = env.elements['qualifyingSeasonSelect'];
    const overtakeSel = env.elements['overtakeSeasonSelect'];

    assert.strictEqual(qualSel.value, '2029');
    assert.deepStrictEqual(qualSel.children.map(o => o.value), ['2029', '2028', '2027']);
    assert.strictEqual(overtakeSel.value, '2029');
    assert.deepStrictEqual(overtakeSel.children.map(o => o.value), ['2029', '2028', '2027']);
  });

  test('DOMContentLoaded overrides stale static HTML options and defaults all 15 dropdowns and states to current year', async () => {
    const env = createTestEnv({ mockYear: 2027, seedStaticHtmlOptions: true });
    env.triggerDOMContentLoaded();
    await new Promise(r => setTimeout(r, 20));

    for (const id of ALL_SEASON_DROPDOWN_IDS) {
      const sel = env.elements[id];
      assert.strictEqual(sel.value, '2027', `DOMContentLoaded must set #${id}.value to 2027`);
      assert.deepStrictEqual(
        sel.children.map(o => o.value),
        ['2027', '2026', '2025'],
        `DOMContentLoaded must update #${id} options to 2027..2025`
      );
      assert.strictEqual(sel.children[0].selected, true, `#${id} 2027 option must be selected`);
    }

    const syncedSeasons = vm.runInContext(`({
      currentTelemetrySeason,
      clinch: clinchState.season,
      sprint: sprintState.season,
      constructorAtr: constructorAtrState.season,
      constructorMomentum: constructorMomentumState.season,
      pitStop: pitStopState.season,
      finishingGap: finishingGapState.season,
      circuitProfiler: circuitProfilerState.season,
      lapChart: lapChartState.season,
      reliability: reliabilityState.season,
      stintDegradation: stintDegradationState.season,
      qualifyingCorrelation: qualifyingCorrelationState.season,
      overtakeIndex: overtakeIndexState.season
    })`, env.context);

    for (const [moduleName, season] of Object.entries(syncedSeasons)) {
      assert.strictEqual(season, '2027', `${moduleName} state season must sync to 2027 on DOMContentLoaded`);
    }

    assert.ok(
      env.queriedUrls.some(u => u.includes('/2027/last/results.json')),
      'Initial JOLPICA race results fetch must target dynamic current season 2027'
    );
    assert.ok(
      env.queriedUrls.some(u => u.includes('/2027/driverStandings.json')),
      'Initial JOLPICA driver standings fetch must target dynamic current season 2027'
    );
  });

  test('onSeasonChange, refreshCurrentSeason, and refreshResultsData fall back to dynamic current year when select value is empty', async () => {
    const env = createTestEnv({ mockYear: 2028 });
    env.elements['seasonSelect'] = createMockElement('seasonSelect', 'SELECT');
    env.elements['resultsSeasonSelect'] = createMockElement('resultsSeasonSelect', 'SELECT');

    await env.exports.refreshCurrentSeason();
    assert.ok(env.queriedUrls.some(u => u.includes('/2028/last/results.json')));
    assert.ok(env.queriedUrls.some(u => u.includes('/2028/driverStandings.json')));

    env.queriedUrls.length = 0;
    await env.exports.refreshResultsData();
    assert.ok(env.queriedUrls.some(u => u.includes('/2028/last/results.json')));

    env.queriedUrls.length = 0;
    await env.exports.onSeasonChange('');
    assert.strictEqual(env.elements['seasonSelect'].value, '2028');
    assert.strictEqual(env.elements['resultsSeasonSelect'].value, '2028');
    assert.ok(env.queriedUrls.some(u => u.includes('/2028/driverStandings.json')));
  });
});
