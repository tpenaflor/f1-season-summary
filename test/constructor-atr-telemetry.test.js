const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const battlePills = [];
  const listeners = {};

  function createMockElement(id) {
    return {
      id,
      style: { display: 'none' },
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) {
            force ? this.classes.add(c) : this.classes.delete(c);
          } else {
            this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c);
          }
        },
        contains(c) { return this.classes.has(c); }
      },
      innerHTML: '',
      textContent: '',
      value: '',
      className: '',
      appendChild(child) { return child; },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      removeEventListener() {},
      getContext() {
        return {
          canvas: {},
          clearRect() {},
          beginPath() {},
          stroke() {},
          fill() {}
        };
      },
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
      if (selector && selector.includes('atr-battle-pill')) {
        return battlePills;
      }
      if (selector && selector.includes('tab-btn')) {
        return [
          getOrCreateEl('tabBtnAll'),
          getOrCreateEl('tabBtnConstructors'),
          getOrCreateEl('tabBtnSprint')
        ];
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => {
      const el = createMockElement('created_' + tag);
      return el;
    }
  };

  ['all', 'title', 'podium', 'midfield', 'rebuild'].forEach(g => {
    const pill = createMockElement('pill_' + g);
    pill['data-group'] = g;
    pill.getAttribute = (k) => k === 'data-group' ? g : null;
    if (g === 'all') pill.classList.add('active');
    battlePills.push(pill);
  });

  let chartInstances = [];
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

  const storage = {};
  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const mockWindow = {
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart
  };

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');
  const scriptCode = scriptMatch[1];

  const context = {
    window: mockWindow,
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: customFetch,
    console: { ...console, warn: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(scriptCode, context);

  return {
    context,
    exports: context.module.exports,
    elements: elementsProxy,
    listeners,
    storage: mockStorage,
    chartInstances,
    battlePills
  };
}

describe('Issue #17: Bug: Uncaught ReferenceError on DOMContentLoaded Fix', () => {
  test('DOMContentLoaded executes without ReferenceError and triggers loadConstructorAtrData', () => {
    const { elements, listeners, exports: f1App } = createTestEnv();

    elements['constructorSeasonSelect'].value = '2024';
    assert.equal(typeof f1App.loadConstructorAtrData, 'function');
    assert.equal(typeof f1App.onConstructorSeasonChange, 'function');
    assert.equal(typeof f1App.refreshConstructorAtrData, 'function');
    assert.equal(typeof f1App.setConstructorBattleGroup, 'function');

    // Trigger DOMContentLoaded listeners
    assert.ok(listeners['DOMContentLoaded'], 'DOMContentLoaded listener should be registered');
    assert.doesNotThrow(() => {
      listeners['DOMContentLoaded'].forEach(fn => fn());
    });
  });

  test('Exports all required ATR handlers and state', () => {
    const { exports: f1App } = createTestEnv();
    assert.ok(f1App.constructorAtrState, 'constructorAtrState must be exported');
    assert.equal(typeof f1App.loadConstructorAtrData, 'function');
    assert.equal(typeof f1App.onConstructorSeasonChange, 'function');
    assert.equal(typeof f1App.refreshConstructorAtrData, 'function');
    assert.equal(typeof f1App.setConstructorBattleGroup, 'function');
    assert.equal(typeof f1App.toggleConstructorTrajectory, 'function');
    assert.equal(typeof f1App.renderConstructorAtrView, 'function');
    assert.equal(typeof f1App.renderConstructorAtrTable, 'function');
    assert.equal(typeof f1App.renderConstructorTrajectoryChart, 'function');
    assert.equal(typeof f1App.renderConstructorKpis, 'function');
    assert.equal(typeof f1App.getAtrTierInfo, 'function');
  });
});

describe('Issue #17: FIA Appendix 7 ATR Sliding Scale Calculations', () => {
  test('P1 gets 70% baseline, 28 runs/wk, 1400 CFD items, restricted tier', () => {
    const { exports: f1App } = createTestEnv();
    const p1 = f1App.getAtrTierInfo(1);
    assert.equal(p1.pct, 70);
    assert.equal(p1.runs, 28);
    assert.equal(p1.cfd, 1400);
    assert.equal(p1.tier, 'restricted');
    assert.equal(p1.tierClass, 'chip-restricted');
  });

  test('P7 gets 100% baseline, 40 runs/wk, 2000 CFD items, parity tier', () => {
    const { exports: f1App } = createTestEnv();
    const p7 = f1App.getAtrTierInfo(7);
    assert.equal(p7.pct, 100);
    assert.equal(p7.runs, 40);
    assert.equal(p7.cfd, 2000);
    assert.equal(p7.tier, 'neutral');
    assert.equal(p7.tierClass, 'chip-neutral');
  });

  test('P10 gets 115% baseline, 46 runs/wk, 2300 CFD items, boosted tier (+45% vs P1)', () => {
    const { exports: f1App } = createTestEnv();
    const p10 = f1App.getAtrTierInfo(10);
    assert.equal(p10.pct, 115);
    assert.equal(p10.runs, 46);
    assert.equal(p10.cfd, 2300);
    assert.equal(p10.tier, 'boosted');
    assert.equal(p10.tierClass, 'chip-boosted');
    assert.equal(p10.pct - f1App.getAtrTierInfo(1).pct, 45);
  });
});

describe('Issue #17: Battle Group Filtering', () => {
  const sampleStandings = [
    { position: '1', points: '666', wins: '6', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
    { position: '2', points: '652', wins: '5', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
    { position: '3', points: '589', wins: '9', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
    { position: '4', points: '468', wins: '4', Constructor: { constructorId: 'mercedes', name: 'Mercedes' } },
    { position: '5', points: '94', wins: '0', Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' } },
    { position: '6', points: '65', wins: '0', Constructor: { constructorId: 'alpine', name: 'Alpine' } },
    { position: '7', points: '58', wins: '0', Constructor: { constructorId: 'haas', name: 'Haas' } },
    { position: '8', points: '46', wins: '0', Constructor: { constructorId: 'rb', name: 'RB' } },
    { position: '9', points: '17', wins: '0', Constructor: { constructorId: 'williams', name: 'Williams' } },
    { position: '10', points: '4', wins: '0', Constructor: { constructorId: 'sauber', name: 'Kick Sauber' } }
  ];

  test('Filters standings by Title, Podium, Midfield, Rebuild and updates count badge', () => {
    const { exports: f1App, elements, battlePills } = createTestEnv();
    f1App.constructorAtrState.standings = sampleStandings;

    f1App.setConstructorBattleGroup('title');
    assert.equal(f1App.constructorAtrState.battleGroup, 'title');
    assert.equal(elements['atrFilterCountBadge'].textContent, 'Showing 2 / 10 Teams');
    assert.ok(elements['constructorAtrTableBody'].innerHTML.includes('McLaren'));
    assert.ok(elements['constructorAtrTableBody'].innerHTML.includes('Ferrari'));
    assert.ok(!elements['constructorAtrTableBody'].innerHTML.includes('Aston Martin'));

    f1App.setConstructorBattleGroup('podium');
    assert.equal(elements['atrFilterCountBadge'].textContent, 'Showing 3 / 10 Teams');
    assert.ok(elements['constructorAtrTableBody'].innerHTML.includes('Red Bull'));
    assert.ok(elements['constructorAtrTableBody'].innerHTML.includes('Mercedes'));
    assert.ok(elements['constructorAtrTableBody'].innerHTML.includes('Aston Martin'));
    assert.ok(!elements['constructorAtrTableBody'].innerHTML.includes('McLaren'));

    f1App.setConstructorBattleGroup('all');
    assert.equal(elements['atrFilterCountBadge'].textContent, 'Showing 10 / 10 Teams');
    assert.ok(elements['constructorAtrTableBody'].innerHTML.includes('Kick Sauber'));
  });
});

describe('Issue #17: High-Level KPI Cards Rendering', () => {
  const sampleStandings = [
    { position: '1', points: '666', wins: '6', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
    { position: '2', points: '652', wins: '5', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
    { position: '10', points: '4', wins: '0', Constructor: { constructorId: 'sauber', name: 'Kick Sauber' } }
  ];

  test('renderConstructorKpis populates WCC leader, points gap, and maximum handicap team', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.renderConstructorKpis(sampleStandings);

    assert.equal(elements['atrKpiLeaderTeam'].textContent, 'McLaren');
    assert.equal(elements['atrKpiLeaderWins'].textContent, '6 Wins');
    assert.equal(elements['atrKpiLeaderPts'].textContent, '666 PTS');

    assert.equal(elements['atrKpiGapPoints'].textContent, '+14 PTS');
    assert.equal(elements['atrKpiGapContext'].textContent, 'McLaren (666) vs Ferrari (652)');

    assert.equal(elements['atrKpiPeriodStatus'].textContent, 'Jan 1 & Jun 30 Resets');

    assert.equal(elements['atrKpiMaxTeam'].textContent, 'Kick Sauber');
    assert.equal(elements['atrKpiMaxRank'].textContent, 'P10');
    assert.ok(elements['atrKpiMaxAllowance'].textContent.includes('46 wind tunnel runs/wk'));
    assert.ok(elements['atrKpiMaxAllowance'].textContent.includes('2,300 CFD items'));
    assert.ok(elements['atrKpiMaxAllowance'].textContent.includes('+45% vs P1'));
  });
});

describe('Issue #17: Main Tab Switching Support for Constructors', () => {
  test('switchMainTab("constructors") shows constructor section and hides others', () => {
    const { context, elements } = createTestEnv();

    context.switchMainTab('constructors');
    assert.equal(elements['constructor-atr-section'].style.display, 'block');
    assert.equal(elements['sprint-disparity-section'].style.display, 'none');
    assert.equal(elements['clinch-engine-section'].style.display, 'none');
    assert.equal(elements['pitstop-matrix-section'].style.display, 'none');

    context.switchMainTab('sprint');
    assert.equal(elements['constructor-atr-section'].style.display, 'none');
    assert.equal(elements['sprint-disparity-section'].style.display, 'block');

    context.switchMainTab('all');
    assert.equal(elements['constructor-atr-section'].style.display, 'block');
    assert.equal(elements['sprint-disparity-section'].style.display, 'block');
  });
});

describe('Issue #17: JOLPICA F1 API Integration & Telemetry Loading', () => {
  test('loadConstructorAtrData queries Jolpica constructorStandings and populates state', async () => {
    const mockStandingsResp = {
      MRData: {
        StandingsTable: {
          season: '2024',
          StandingsLists: [{
            ConstructorStandings: [
              { position: '1', points: '666', wins: '6', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
              { position: '2', points: '652', wins: '5', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } }
            ]
          }]
        }
      }
    };

    const mockFetch = async (url) => {
      if (url.includes('constructorStandings.json')) {
        return { ok: true, json: async () => mockStandingsResp };
      }
      if (url.includes('results.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              total: '1',
              limit: '100',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    raceName: 'Bahrain Grand Prix',
                    Results: [
                      { position: '1', points: '25', Constructor: { constructorId: 'mclaren', name: 'McLaren' } }
                    ]
                  }
                ]
              }
            }
          })
        };
      }
      return { ok: true, json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } }) };
    };

    const { exports: f1App, elements, storage } = createTestEnv(mockFetch);
    const state = await f1App.loadConstructorAtrData('2024');

    assert.equal(state.season, '2024');
    assert.equal(state.standings.length, 2);
    assert.equal(state.standings[0].Constructor.name, 'McLaren');
    assert.equal(elements['constructorCacheBadge'].textContent, '⚡ Live Telemetry');

    // Cached retrieval
    const cachedState = await f1App.loadConstructorAtrData('2024', false);
    assert.equal(elements['constructorCacheBadge'].textContent, '⚡ Cached (Instant)');
  });
});
