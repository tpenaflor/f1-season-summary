'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractMainScript(html) {
  const match = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'Main <script> block not found in index.html');
  return match[1];
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} not found in index.html`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not find end of ${name}`);
}

const ALL_TAB_BTN_IDS = [
  'tabBtnResults', 'tabBtnProgression', 'tabBtnConstructors', 'tabBtnLapChart', 'tabBtnTelemetry',
  'tabBtnQualifying', 'tabBtnOvertake', 'tabBtnSprint', 'tabBtnStints', 'tabBtnPitStops',
  'tabBtnFinishingGap', 'tabBtnMomentum', 'tabBtnProfiler', 'tabBtnReliability', 'tabBtnClinch', 'tabBtnAll'
];

const ALL_SECTION_IDS = [
  'lap-chart-section', 'stint-profiler-section', 'finishing-gap-section', 'circuit-profiler-section',
  'constructor-atr-section', 'constructor-momentum-section', 'sprint-disparity-section', 'clinch-engine-section',
  'pitstop-matrix-section', 'reliability-matrix-section', 'qualifying-correlation-section',
  'overtake-index-section', 'teammate-telemetry-section', 'progression-section',
  'latest-race-section', 'standings-table-section'
];

function createTestEnv(options = {}) {
  const elements = {};
  const domListeners = {};
  const storage = { ...(options.initialStorage || {}) };
  const fetchedUrls = [];

  function makeEl(id, tag = 'DIV') {
    const classes = new Set();
    const attrs = {};
    return {
      id,
      tagName: tag.toUpperCase(),
      style: { display: '' },
      innerHTML: '',
      textContent: '',
      value: options.initialValues?.[id] || '',
      checked: false,
      children: [],
      classList: {
        add: (...cls) => cls.forEach(c => classes.add(c)),
        remove: (...cls) => cls.forEach(c => classes.delete(c)),
        toggle: (c, force) => {
          if (force !== undefined) force ? classes.add(c) : classes.delete(c);
          else classes.has(c) ? classes.delete(c) : classes.add(c);
        },
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      appendChild: (child) => { return child; },
      addEventListener: () => {},
      getContext: () => ({ canvas: {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {} })
    };
  }

  for (const id of [...ALL_TAB_BTN_IDS, ...ALL_SECTION_IDS, 'tabConfigBtn', 'tabConfigPanel', 'tabConfigCount', 'tabConfigPresets', 'tabConfigList', 'tabConfigNotice']) {
    elements[id] = makeEl(id);
  }
  elements.seasonSelect = makeEl('seasonSelect', 'SELECT');
  elements.seasonSelect.value = '2026';

  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    },
    querySelectorAll(sel) {
      if (sel === '.tab-btn') return ALL_TAB_BTN_IDS.map(id => elements[id]);
      return [];
    },
    createElement(tag) {
      return makeEl(`created-${tag}`, tag);
    },
    addEventListener(evt, fn) {
      domListeners[evt] = domListeners[evt] || [];
      domListeners[evt].push(fn);
    }
  };

  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  function MockChart() {
    this.destroy = () => {};
    this.update = () => {};
    this.resize = () => {};
  }

  const windowObj = {
    addEventListener: () => {},
    document,
    localStorage,
    Chart: MockChart,
    location: { search: options.search || '' }
  };

  const moduleObj = { exports: {} };
  const context = {
    window: windowObj,
    document,
    localStorage,
    Chart: MockChart,
    module: moduleObj,
    exports: moduleObj.exports,
    fetch: async (url) => {
      fetchedUrls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ MRData: { RaceTable: { Races: [] }, StandingsTable: { StandingsLists: [] } } })
      };
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };

  vm.createContext(context);
  vm.runInContext(extractMainScript(INDEX_HTML), context);
  return {
    exports: moduleObj.exports,
    context,
    elements,
    storage,
    fetchedUrls,
    triggerDOMContentLoaded: () => {
      (domListeners.DOMContentLoaded || []).forEach(fn => fn());
    }
  };
}

describe('Issue #30: Optimize and configure application tabs', () => {
  test('HTML reduces default visible tabs to 5 core tabs and marks 11 optional tabs hidden', () => {
    const defaultBtnMatches = [
      'tabBtnResults', 'tabBtnProgression', 'tabBtnConstructors', 'tabBtnLapChart', 'tabBtnTelemetry'
    ];
    for (const btnId of defaultBtnMatches) {
      const regex = new RegExp(`<button[^>]*id="${btnId}"[^>]*>`);
      const match = INDEX_HTML.match(regex);
      assert.ok(match, `${btnId} button must exist in index.html`);
      assert.ok(!match[0].includes('tab-btn-hidden'), `${btnId} should be visible by default`);
    }

    const optionalBtnMatches = [
      'tabBtnQualifying', 'tabBtnOvertake', 'tabBtnSprint', 'tabBtnStints', 'tabBtnPitStops',
      'tabBtnFinishingGap', 'tabBtnMomentum', 'tabBtnProfiler', 'tabBtnReliability', 'tabBtnClinch', 'tabBtnAll'
    ];
    for (const btnId of optionalBtnMatches) {
      const regex = new RegExp(`<button[^>]*id="${btnId}"[^>]*>`);
      const match = INDEX_HTML.match(regex);
      assert.ok(match, `${btnId} button must exist in index.html`);
      assert.ok(match[0].includes('tab-btn-hidden'), `${btnId} should be hidden by default`);
    }

    assert.ok(INDEX_HTML.includes('id="tabConfigBtn"'), 'Configure Tabs trigger button must exist');
    assert.ok(INDEX_HTML.includes('id="tabConfigPanel"'), 'Tab Configuration panel must exist');
  });

  test('TAB_REGISTRY and DEFAULT_ENABLED_TABS expose 16 total tabs with 5 default enabled tabs', () => {
    const { exports: app } = createTestEnv();
    assert.equal(app.TAB_REGISTRY.length, 16);
    assert.deepEqual(Array.from(app.DEFAULT_ENABLED_TABS), [
      'results', 'progression', 'constructors', 'lap-chart', 'telemetry'
    ]);

    assert.equal(app.normalizeTabId('degradation'), 'stints');
    assert.equal(app.normalizeTabId('overtake-index'), 'overtake');
    assert.equal(app.normalizeTabId('grid-delta'), 'overtake');
    assert.equal(app.normalizeTabId('  CLINCH  '), 'clinch');
    assert.equal(app.normalizeTabId('non-existent-tab'), null);
  });

  test('loadTabConfiguration handles empty, corrupted, localStorage-persisted, and query-param configs', () => {
    const envEmpty = createTestEnv();
    assert.deepEqual(Array.from(envEmpty.exports.loadTabConfiguration()), [
      'results', 'progression', 'constructors', 'lap-chart', 'telemetry'
    ]);

    const envBadJson = createTestEnv({
      initialStorage: { f1_tab_config_v1: '{bad-json' }
    });
    assert.deepEqual(Array.from(envBadJson.exports.loadTabConfiguration()), [
      'results', 'progression', 'constructors', 'lap-chart', 'telemetry'
    ]);

    const envSaved = createTestEnv({
      initialStorage: {
        f1_tab_config_v1: JSON.stringify({ version: 1, enabledTabs: ['results', 'clinch', 'unknown'] })
      }
    });
    assert.deepEqual(Array.from(envSaved.exports.loadTabConfiguration()), ['results', 'clinch']);

    const envQuery = createTestEnv({ search: '?tabs=results,degradation,clinch' });
    assert.deepEqual(Array.from(envQuery.exports.loadTabConfiguration()), ['results', 'stints', 'clinch']);

    assert.equal(envQuery.exports.loadTabConfiguration('?tabs=all').length, 16);
    assert.deepEqual(Array.from(envQuery.exports.loadTabConfiguration('?tabs=default')), [
      'results', 'progression', 'constructors', 'lap-chart', 'telemetry'
    ]);
  });

  test('setTabEnabled updates DOM visibility, persists to localStorage, and guards last remaining tab', () => {
    const { exports: app, elements, storage } = createTestEnv();
    app.initTabConfiguration();

    // Initially clinch is hidden and results is active
    assert.equal(app.isTabEnabled('clinch'), false);
    assert.equal(elements.tabBtnClinch.classList.contains('tab-btn-hidden'), true);
    assert.equal(elements.tabBtnClinch.style.display, 'none');
    assert.equal(elements.tabConfigCount.textContent, '5/16');

    // Enable clinch
    const enableRes = app.setTabEnabled('clinch', true);
    assert.equal(enableRes.ok, true);
    assert.equal(app.isTabEnabled('clinch'), true);
    assert.equal(elements.tabBtnClinch.classList.contains('tab-btn-hidden'), false);
    assert.equal(elements.tabBtnClinch.style.display, '');
    assert.equal(elements.tabBtnClinch.getAttribute('aria-hidden'), 'false');
    assert.equal(elements.tabConfigCount.textContent, '6/16');
    assert.ok(storage.f1_tab_config_v1.includes('clinch'));

    // Disabling active tab ('results') switches active tab to next enabled tab
    app.switchMainTab('results');
    const disableResults = app.setTabEnabled('results', false);
    assert.equal(disableResults.ok, true);
    assert.equal(app.isTabEnabled('results'), false);
    assert.equal(app.tabConfigState.activeTab, 'progression');
    assert.equal(elements['progression-section'].style.display, 'block');
    assert.equal(elements['latest-race-section'].style.display, 'none');

    // Disable down to 1 tab, then attempt to disable the final tab
    for (const id of ['constructors', 'lap-chart', 'telemetry', 'clinch']) {
      app.setTabEnabled(id, false);
    }
    assert.deepEqual(Array.from(app.getEnabledTabs()), ['progression']);

    const guardRes = app.setTabEnabled('progression', false);
    assert.equal(guardRes.ok, false);
    assert.equal(guardRes.reason, 'last-tab');
    assert.deepEqual(Array.from(app.getEnabledTabs()), ['progression']);
    assert.equal(elements.tabConfigNotice.style.display, 'block');
    assert.ok(elements.tabConfigNotice.textContent.includes('At least one tab'));
  });

  test('applyTabPreset, resetTabConfiguration, and toggleTabConfigPanel manage presets and panel UI', () => {
    const { exports: app, elements } = createTestEnv();
    app.initTabConfiguration();

    assert.equal(app.toggleTabConfigPanel(), true);
    assert.equal(elements.tabConfigPanel.style.display, 'block');
    assert.equal(elements.tabConfigBtn.getAttribute('aria-expanded'), 'true');
    assert.ok(elements.tabConfigPresets.innerHTML.includes('Race Engineer (8)'));
    assert.ok(elements.tabConfigList.innerHTML.includes('Championship Clinch Engine'));

    assert.equal(app.applyTabPreset('race-engineer'), true);
    assert.equal(app.getEnabledTabs().length, 8);
    assert.equal(app.isTabEnabled('stints'), true);
    assert.equal(app.isTabEnabled('pitstops'), true);
    assert.equal(app.isTabEnabled('finishing-gap'), true);
    assert.equal(elements.tabConfigCount.textContent, '8/16');

    assert.equal(app.applyTabPreset('all'), true);
    assert.equal(app.getEnabledTabs().length, 16);
    assert.equal(app.getDisabledTabs().length, 0);

    assert.equal(app.applyTabPreset('unknown-preset'), false);

    assert.equal(app.resetTabConfiguration(), true);
    assert.deepEqual(Array.from(app.getEnabledTabs()), Array.from(app.DEFAULT_ENABLED_TABS));
    assert.equal(app.toggleTabConfigPanel(false), false);
    assert.equal(elements.tabConfigPanel.style.display, 'none');
  });

  test('DOMContentLoaded activates default results view without triggering optional tab API calls', async () => {
    const { exports: app, elements, fetchedUrls, triggerDOMContentLoaded } = createTestEnv();
    triggerDOMContentLoaded();
    await new Promise(r => setTimeout(r, 20));

    assert.equal(app.tabConfigState.activeTab, 'results');
    assert.equal(elements['latest-race-section'].style.display, 'block');
    assert.equal(elements['standings-table-section'].style.display, 'block');
    assert.equal(elements['clinch-engine-section'].style.display, 'none');
    assert.equal(elements['qualifying-correlation-section'].style.display, 'none');
    assert.equal(elements.tabBtnClinch.style.display, 'none');
    assert.equal(elements.tabBtnResults.style.display, '');

    // Ensure no optional Jolpica endpoints were triggered on startup
    const optionalEndpoints = ['/qualifying.json', '/sprint.json', '/pitstops.json', '/status.json', '/laps.json'];
    for (const ep of optionalEndpoints) {
      assert.equal(fetchedUrls.some(u => u.includes(ep)), false, `Startup must not fetch ${ep}`);
    }
  });

  test('switchMainTab remains safe when extracted in isolation without tabConfigState', () => {
    const match = INDEX_HTML.match(/function switchMainTab\([\s\S]*?\n        \}/);
    assert.ok(match, 'switchMainTab must match expected block indentation');
    const dummyEl = {
      style: { display: '' },
      classList: { add: () => {}, remove: () => {}, contains: () => false }
    };
    const ctx = {
      document: { querySelectorAll: () => [], getElementById: () => dummyEl },
      setTimeout: () => 0,
      qualifyingCorrelationState: { season: '2024', dataLoaded: true, loading: false },
      overtakeIndexState: { season: '2024', dataLoaded: true, loading: false },
      loadQualifyingCorrelationData: () => {},
      loadOvertakeIndexData: () => {}
    };
    vm.createContext(ctx);
    vm.runInContext(extractFunction(INDEX_HTML, 'switchMainTab'), ctx);
    assert.doesNotThrow(() => ctx.switchMainTab('results'));
    assert.doesNotThrow(() => ctx.switchMainTab('all'));
    assert.doesNotThrow(() => ctx.switchMainTab('clinch'));
  });
});
