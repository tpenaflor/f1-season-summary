const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv() {
  const elements = {};
  const createEl = (tag, id = '') => ({
    id,
    tagName: (tag || 'DIV').toUpperCase(),
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    style: { display: '' },
    className: '',
    children: [],
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener: () => {},
    getContext: () => ({})
  });

  const elementsProxy = new Proxy(elements, {
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (!target[prop]) {
        target[prop] = createEl('DIV', String(prop));
      }
      return target[prop];
    }
  });

  const mockDoc = {
    getElementById: (id) => elementsProxy[id],
    querySelectorAll: () => [],
    createElement: (tag) => createEl(tag),
    addEventListener: () => {}
  };

  const mockStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  function MockChart() {
    this.destroy = () => {};
    this.update = () => {};
    this.resize = () => {};
  }

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
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
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console: { ...console, warn: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    Math,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);

  return {
    html,
    exports: context.module.exports,
    elements: elementsProxy
  };
}

describe('Issue #27: Limit Data Analysis to the Past 3 Years', () => {
  test('exports 3-year analysis limit constant and helper functions', () => {
    const { exports } = createTestEnv();
    assert.strictEqual(exports.ANALYSIS_YEARS_LIMIT, 3);
    assert.strictEqual(typeof exports.getRecentSeasons, 'function');
    assert.strictEqual(typeof exports.isSeasonWithinAnalysisLimit, 'function');
    assert.strictEqual(typeof exports.filterDataToPastThreeYears, 'function');
    assert.strictEqual(typeof exports.populateAllSeasonDropdowns, 'function');
  });

  test('getRecentSeasons returns strictly the past 3 seasons', () => {
    const { exports } = createTestEnv();
    assert.deepStrictEqual(exports.getRecentSeasons(2026), ['2026', '2025', '2024']);
    assert.deepStrictEqual(exports.getRecentSeasons(2024), ['2024', '2023', '2022']);
  });

  test('isSeasonWithinAnalysisLimit validates whether a season is within the 3-year window', () => {
    const { exports } = createTestEnv();
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('2026', 2026), true);
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('2025', 2026), true);
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('2024', 2026), true);
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('current', 2026), true);
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('2023', 2026), false);
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('2021', 2026), false);
    assert.strictEqual(exports.isSeasonWithinAnalysisLimit('1950', 2026), false);
  });

  test('filterDataToPastThreeYears filters JOLPICA race/season records to the past 3 years', () => {
    const { exports } = createTestEnv();
    const records = [
      { season: '2026', round: '1', raceName: 'Australian Grand Prix' },
      { season: '2025', round: '1', raceName: 'Bahrain Grand Prix' },
      { season: '2024', round: '1', raceName: 'Bahrain Grand Prix' },
      { season: '2023', round: '1', raceName: 'Bahrain Grand Prix' },
      { season: '2021', round: '22', raceName: 'Abu Dhabi Grand Prix' },
      { date: '2024-05-26', raceName: 'Monaco Grand Prix' },
      { date: '2019-03-17', raceName: 'Australian Grand Prix' }
    ];

    const filtered = exports.filterDataToPastThreeYears(records, 2026);
    assert.strictEqual(filtered.length, 4);
    assert.deepStrictEqual(
      filtered.map(r => r.season || r.date.slice(0, 4)),
      ['2026', '2025', '2024', '2024']
    );
  });

  test('populateSeasonDropdown defaults to the past 3 years (2026, 2025, 2024)', () => {
    const env = createTestEnv();
    env.exports.populateSeasonDropdown();

    const seasonSel = env.elements['seasonSelect'];
    const resultsSel = env.elements['resultsSeasonSelect'];

    assert.strictEqual(seasonSel.children.length, 3);
    assert.deepStrictEqual(seasonSel.children.map(o => o.value), ['2026', '2025', '2024']);
    assert.strictEqual(resultsSel.children.length, 3);
    assert.deepStrictEqual(resultsSel.children.map(o => o.value), ['2026', '2025', '2024']);
  });

  test('populateQualifyingSeasonDropdown defaults to the past 3 years (2026, 2025, 2024)', () => {
    const env = createTestEnv();
    env.elements['qualifyingSeasonSelect'].value = '2024';
    env.exports.populateQualifyingSeasonDropdown();

    const qualSel = env.elements['qualifyingSeasonSelect'];
    assert.strictEqual(qualSel.children.length, 3);
    assert.deepStrictEqual(qualSel.children.map(o => o.value), ['2026', '2025', '2024']);
    assert.strictEqual(qualSel.value, '2024');
  });

  test('populateAllSeasonDropdowns limits all 14 season selectors to 3 years', () => {
    const env = createTestEnv();
    env.exports.populateAllSeasonDropdowns(2026);

    const dropdownIds = [
      'seasonSelect',
      'resultsSeasonSelect',
      'qualifyingSeasonSelect',
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
      'telemetrySeasonSelect'
    ];

    for (const id of dropdownIds) {
      const sel = env.elements[id];
      assert.strictEqual(sel.children.length, 3, `${id} should have exactly 3 season options`);
      assert.deepStrictEqual(sel.children.map(o => o.value), ['2026', '2025', '2024']);
    }
  });

  test('static HTML season dropdowns in index.html only include the past 3 seasons (2026, 2025, 2024)', () => {
    const { html } = createTestEnv();
    const dropdownIds = [
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
      'telemetrySeasonSelect',
      'seasonSelect',
      'resultsSeasonSelect'
    ];

    for (const id of dropdownIds) {
      const regex = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`);
      const match = html.match(regex);
      assert.ok(match, `Dropdown #${id} must exist in index.html`);
      const optionValues = [...match[1].matchAll(/<option[^>]*value="(\d{4})"[^>]*>/g)].map(m => m[1]);
      assert.strictEqual(optionValues.length, 3, `#${id} should have 3 season options in HTML, got: ${optionValues.join(', ')}`);
      assert.deepStrictEqual(optionValues, ['2026', '2025', '2024'], `#${id} options must be 2026, 2025, 2024`);
    }
  });
});
