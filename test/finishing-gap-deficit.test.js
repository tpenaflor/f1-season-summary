const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const tierPills = [];
  const tabButtons = [];
  const listeners = {};

  function createMockElement(id) {
    const el = {
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
      children: [],
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = val;
        if (val === '') this.children = [];
      },
      textContent: '',
      value: '',
      className: '',
      options: id === 'finishingGapVenueSelect' ? [{ value: 'all' }] : [],
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
    return el;
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

  // Setup tier pills
  ['all', 'contenders', 'midfield', 'backmarkers'].forEach(tier => {
    const pill = createMockElement('pill_' + tier);
    pill['data-tier'] = tier;
    pill.getAttribute = (k) => (k === 'data-tier' ? tier : null);
    if (tier === 'all') pill.classList.add('active');
    tierPills.push(pill);
  });

  // Setup main navigation tab buttons
  const tabIds = [
    'tabBtnAll',
    'tabBtnFinishingGap',
    'tabBtnProfiler',
    'tabBtnConstructors',
    'tabBtnSprint',
    'tabBtnClinch',
    'tabBtnPitStops',
    'tabBtnTelemetry',
    'tabBtnProgression',
    'tabBtnResults'
  ];
  tabIds.forEach(id => {
    const tabEl = getOrCreateEl(id);
    if (id === 'tabBtnAll') tabEl.classList.add('active');
    tabButtons.push(tabEl);
  });

  // Pre-seed common UI elements
  getOrCreateEl('finishingGapSeasonSelect').value = '2024';
  getOrCreateEl('finishingGapVenueSelect').value = 'all';
  getOrCreateEl('fgPillScopeConstructors').classList.add('active');
  getOrCreateEl('fgPillScopeDrivers').classList.remove('active');

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
      if (selector && selector.includes('finishing-gap-tier-pill')) {
        return tierPills;
      }
      if (selector && selector.includes('tab-btn')) {
        return tabButtons;
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => {
      const el = createMockElement('created_' + tag + '_' + Math.random().toString(36).substring(2, 7));
      el.tagName = tag.toUpperCase();
      return el;
    }
  };

  let chartInstances = [];
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
    tierPills,
    tabButtons
  };
}

// Sample realistic multi-round Grand Prix race results
function createSampleRaceResults() {
  return [
    {
      round: '1',
      raceName: 'Bahrain Grand Prix',
      Results: [
        {
          position: '1',
          positionText: '1',
          laps: '57',
          status: 'Finished',
          Time: { time: '1:31:44.742', millis: '5504742' },
          Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
        },
        {
          position: '2',
          positionText: '2',
          laps: '57',
          status: 'Finished',
          Time: { time: '+22.457', millis: '5527199' },
          Driver: { driverId: 'perez', givenName: 'Sergio', familyName: 'Perez', code: 'PER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
        },
        {
          position: '3',
          positionText: '3',
          laps: '57',
          status: 'Finished',
          Time: { time: '+25.110', millis: '5529852' },
          Driver: { driverId: 'sainz', givenName: 'Carlos', familyName: 'Sainz', code: 'SAI' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '4',
          positionText: '4',
          laps: '57',
          status: 'Finished',
          Time: { time: '+39.669', millis: '5544411' },
          Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '5',
          positionText: '5',
          laps: '57',
          status: 'Finished',
          Time: { time: '+46.735', millis: '5551477' },
          Driver: { driverId: 'russell', givenName: 'George', familyName: 'Russell', code: 'RUS' },
          Constructor: { constructorId: 'mercedes', name: 'Mercedes' }
        },
        {
          position: '6',
          positionText: '6',
          laps: '57',
          status: 'Finished',
          Time: { time: '+48.458', millis: '5553200' },
          Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          position: '7',
          positionText: '7',
          laps: '56',
          status: '+1 Lap',
          Driver: { driverId: 'alonso', givenName: 'Fernando', familyName: 'Alonso', code: 'ALO' },
          Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' }
        },
        {
          position: '8',
          positionText: '8',
          laps: '55',
          status: '+2 Laps',
          Driver: { driverId: 'albon', givenName: 'Alexander', familyName: 'Albon', code: 'ALB' },
          Constructor: { constructorId: 'williams', name: 'Williams' }
        },
        {
          position: '9',
          positionText: 'R',
          laps: '12',
          status: 'Accident',
          Driver: { driverId: 'gasly', givenName: 'Pierre', familyName: 'Gasly', code: 'GAS' },
          Constructor: { constructorId: 'alpine', name: 'Alpine' }
        }
      ]
    },
    {
      round: '2',
      raceName: 'Saudi Arabian Grand Prix',
      Results: [
        {
          position: '1',
          positionText: '1',
          laps: '50',
          status: 'Finished',
          Time: { time: '1:20:43.273', millis: '4843273' },
          Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
        },
        {
          position: '2',
          positionText: '2',
          laps: '50',
          status: 'Finished',
          Time: { time: '+13.643', millis: '4856916' },
          Driver: { driverId: 'perez', givenName: 'Sergio', familyName: 'Perez', code: 'PER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
        },
        {
          position: '3',
          positionText: '3',
          laps: '50',
          status: 'Finished',
          Time: { time: '+18.639', millis: '4861912' },
          Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '4',
          positionText: '4',
          laps: '50',
          status: 'Finished',
          Time: { time: '+32.007', millis: '4875280' },
          Driver: { driverId: 'piastri', givenName: 'Oscar', familyName: 'Piastri', code: 'PIA' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          position: '5',
          positionText: '5',
          laps: '50',
          status: 'Finished',
          Time: { time: '+35.708', millis: '4878981' },
          Driver: { driverId: 'alonso', givenName: 'Fernando', familyName: 'Alonso', code: 'ALO' },
          Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' }
        },
        {
          position: '6',
          positionText: '6',
          laps: '50',
          status: 'Finished',
          Time: { time: '+45.709', millis: '4888982' },
          Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          position: '7',
          positionText: '7',
          laps: '49',
          status: '+1 Lap',
          Driver: { driverId: 'albon', givenName: 'Alexander', familyName: 'Albon', code: 'ALB' },
          Constructor: { constructorId: 'williams', name: 'Williams' }
        }
      ]
    },
    {
      round: '3',
      raceName: 'Italian Grand Prix',
      Results: [
        {
          position: '1',
          positionText: '1',
          laps: '53',
          status: 'Finished',
          Time: { time: '1:14:40.789', millis: '4480789' },
          Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '2',
          positionText: '2',
          laps: '53',
          status: 'Finished',
          Time: { time: '+0.525', millis: '4481314' },
          Driver: { driverId: 'piastri', givenName: 'Oscar', familyName: 'Piastri', code: 'PIA' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          position: '3',
          positionText: '3',
          laps: '53',
          status: 'Finished',
          Time: { time: '+6.154', millis: '4486943' },
          Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          position: '4',
          positionText: '4',
          laps: '53',
          status: 'Finished',
          Time: { time: '+37.932', millis: '4518721' },
          Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
        },
        {
          position: '5',
          positionText: '5',
          laps: '52',
          status: '+1 Lap',
          Driver: { driverId: 'alonso', givenName: 'Fernando', familyName: 'Alonso', code: 'ALO' },
          Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' }
        },
        {
          position: '6',
          positionText: '6',
          laps: '51',
          status: '+2 Laps',
          Driver: { driverId: 'albon', givenName: 'Alexander', familyName: 'Albon', code: 'ALB' },
          Constructor: { constructorId: 'williams', name: 'Williams' }
        }
      ]
    }
  ];
}

describe('Issue #15: Finishing Gap Module Exports, Global Constants, & Initial State', () => {
  test('exports all required finishing gap handlers, helpers, constants, and state objects', () => {
    const { exports: f1App } = createTestEnv();

    assert.equal(typeof f1App.computeFinishingGapMetrics, 'function');
    assert.equal(typeof f1App.parseFinishingTimeToSeconds, 'function');
    assert.equal(typeof f1App.formatFinishingGap, 'function');
    assert.equal(typeof f1App.loadFinishingGapData, 'function');
    assert.equal(typeof f1App.onFinishingGapSeasonChange, 'function');
    assert.equal(typeof f1App.refreshFinishingGapData, 'function');
    assert.equal(typeof f1App.setFinishingGapViewScope, 'function');
    assert.equal(typeof f1App.setFinishingGapTierFilter, 'function');
    assert.equal(typeof f1App.setFinishingGapVenueFilter, 'function');
    assert.equal(typeof f1App.renderFinishingGapView, 'function');
    assert.equal(typeof f1App.renderFinishingGapKpis, 'function');
    assert.equal(typeof f1App.renderFinishingGapChart, 'function');
    assert.equal(typeof f1App.renderFinishingGapTable, 'function');
    assert.equal(typeof f1App.switchMainTab, 'function');

    assert.equal(typeof f1App.finishingGapState, 'object');
    assert.equal(typeof f1App.FINISHING_GAP_TIERS, 'object');
    assert.equal(typeof f1App.FINISHING_GAP_FALLBACK_2024, 'object');
    assert.equal(typeof f1App.FINISHING_GAP_FALLBACK_DRIVERS_2024, 'object');
    assert.ok(Array.isArray(f1App.FINISHING_GAP_FALLBACK_ROUNDS_2024));
  });

  test('FINISHING_GAP_TIERS defines contender, midfield, and backmarker boundaries and CSS classes', () => {
    const { exports: f1App } = createTestEnv();
    const tiers = f1App.FINISHING_GAP_TIERS;

    assert.ok(tiers.contenders, 'contenders tier must exist');
    assert.equal(tiers.contenders.maxGap, 15.0);
    assert.equal(tiers.contenders.cssClass, 'tier-contender');

    assert.ok(tiers.midfield, 'midfield tier must exist');
    assert.equal(tiers.midfield.minGap, 15.0);
    assert.equal(tiers.midfield.maxGap, 65.0);
    assert.equal(tiers.midfield.cssClass, 'tier-midfield');

    assert.ok(tiers.backmarkers, 'backmarkers tier must exist');
    assert.equal(tiers.backmarkers.minGap, 65.0);
    assert.equal(tiers.backmarkers.cssClass, 'tier-backmarker');
  });

  test('finishingGapState initializes with correct default configuration', () => {
    const { exports: f1App } = createTestEnv();
    const state = f1App.finishingGapState;

    assert.equal(state.season, '2024');
    assert.equal(state.scope, 'constructors');
    assert.equal(state.tier, 'all');
    assert.equal(state.venueRound, 'all');
    assert.ok(Array.isArray(state.results));
    assert.equal(state.isLoading, false);
  });

  test('FINISHING_GAP_FALLBACK_2024 and DRIVERS fallback contain valid 2024 baseline telemetry', () => {
    const { exports: f1App } = createTestEnv();
    const cFallback = f1App.FINISHING_GAP_FALLBACK_2024;
    const dFallback = f1App.FINISHING_GAP_FALLBACK_DRIVERS_2024;

    assert.equal(cFallback.scope, 'constructors');
    assert.equal(cFallback.competitors.length, 10);
    assert.ok(cFallback.benchmarkLeader);
    assert.equal(cFallback.benchmarkLeader.id, 'mclaren');
    assert.ok(cFallback.fieldMedianGap > 0);
    assert.ok(cFallback.spread > 0);
    assert.equal(cFallback.rounds.length, 24);

    assert.equal(dFallback.scope, 'drivers');
    assert.equal(dFallback.competitors.length, 10);
    assert.ok(dFallback.benchmarkLeader);
    assert.equal(dFallback.benchmarkLeader.id, 'max_verstappen');
  });
});

describe('Issue #15: Delta Parsing & Formatting Engine (parseFinishingTimeToSeconds & formatFinishingGap)', () => {
  test('parses milliseconds from string and numeric millis parameters accurately', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    assert.equal(parse(null, '5501438'), 5501.438);
    assert.equal(parse('+4.850', '4850'), 4.85);
    assert.equal(parse(undefined, 12345), 12.345);
  });

  test('parses raw numeric inputs directly', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    assert.equal(parse(42.5), 42.5);
    assert.equal(parse(0), 0);
  });

  test('strips leading + signs and trims whitespace', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    assert.equal(parse('  +4.850  '), 4.85);
    assert.equal(parse('+0.525'), 0.525);
  });

  test('parses ss.sss timing strings accurately', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    assert.equal(parse('12.345'), 12.345);
    assert.equal(parse('+0.000'), 0);
    assert.equal(parse('58.912'), 58.912);
  });

  test('parses mm:ss.sss timing strings to total seconds', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    // 1m 24.567s = 60 + 24.567 = 84.567
    assert.equal(parse('1:24.567'), 84.567);
    // 02:15.100 = 120 + 15.100 = 135.1
    assert.equal(parse('+02:15.100'), 135.1);
  });

  test('parses hh:mm:ss.sss timing strings to total seconds', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    // 1h 32m 45.678s = 3600 + 1920 + 45.678 = 5565.678
    assert.equal(parse('1:32:45.678'), 5565.678);
  });

  test('returns 0 for bare + or whitespace and null for empty strings or invalid values', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    assert.equal(parse('+'), 0);
    assert.equal(parse('   '), 0);
    assert.equal(parse(''), null);
  });

  test('returns null for non-string, non-numeric, or malformed time values', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    assert.equal(parse(null), null);
    assert.equal(parse(undefined), null);
    assert.equal(parse({}), null);
    assert.equal(parse('DNF'), null);
    assert.equal(parse('invalid:time'), null);
  });

  test('formatFinishingGap formats 0 and near-zero values as 0.000s (P1)', () => {
    const { exports: f1App } = createTestEnv();
    const fmt = f1App.formatFinishingGap;

    assert.equal(fmt(0), '0.000s (P1)');
    assert.equal(fmt(0.00005), '0.000s (P1)');
  });

  test('formatFinishingGap formats positive delta values with + prefix and 3 decimals', () => {
    const { exports: f1App } = createTestEnv();
    const fmt = f1App.formatFinishingGap;

    assert.equal(fmt(4.85), '+4.850s');
    assert.equal(fmt(0.525), '+0.525s');
    assert.equal(fmt(73.6), '+73.600s');
  });

  test('formatFinishingGap returns N/A for null, undefined, or NaN inputs', () => {
    const { exports: f1App } = createTestEnv();
    const fmt = f1App.formatFinishingGap;

    assert.equal(fmt(null), 'N/A');
    assert.equal(fmt(undefined), 'N/A');
    assert.equal(fmt(NaN), 'N/A');
    assert.equal(fmt('not-a-number'), 'N/A');
  });
});

describe('Issue #15: Lead Lap Finishers vs Lapped Runners & Status Classification', () => {
  test('race winner (position === 1) is classified with 0.000s gap', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const redBull = metrics.competitors.find(c => c.id === 'red_bull');
    assert.ok(redBull);
    assert.equal(redBull.roundGaps['1'].gap, 0.0);
    assert.equal(redBull.roundGaps['2'].gap, 0.0);
  });

  test('lead lap finisher with direct delta string or millis is parsed accurately', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'drivers');

    const perez = metrics.competitors.find(c => c.id === 'perez');
    assert.ok(perez);
    assert.equal(perez.roundGaps['1'].gap, 22.457);
    assert.equal(perez.roundGaps['2'].gap, 13.643);
  });

  test('lapped finisher with +1 Lap computes gap from winner average lap time', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    // In Round 1, winner time = 5504.742, laps = 57 -> winnerAvgLap = 5504.742 / 57 ≈ 96.574s
    const winnerAvgLapR1 = 5504.742 / 57;
    const metrics = f1App.computeFinishingGapMetrics(results, 'drivers');

    const alonso = metrics.competitors.find(c => c.id === 'alonso');
    assert.ok(alonso);
    const expectedGapR1 = parseFloat((1 * winnerAvgLapR1).toFixed(3));
    assert.equal(alonso.roundGaps['1'].gap, expectedGapR1);
  });

  test('lapped finisher with +2 Laps computes gap from 2 * winnerAvgLap', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const winnerAvgLapR1 = 5504.742 / 57;
    const metrics = f1App.computeFinishingGapMetrics(results, 'drivers');

    const albon = metrics.competitors.find(c => c.id === 'albon');
    assert.ok(albon);
    const expectedGapR1 = parseFloat((2 * winnerAvgLapR1).toFixed(3));
    assert.equal(albon.roundGaps['1'].gap, expectedGapR1);
  });

  test('lapped finisher with lap count deficit calculates gap using difference in completed laps', () => {
    const { exports: f1App } = createTestEnv();
    const customRound = [
      {
        round: '1',
        raceName: 'Test GP',
        Results: [
          {
            position: '1',
            laps: '50',
            status: 'Finished',
            Time: { time: '5000.000', millis: '5000000' },
            Driver: { driverId: 'winner' },
            Constructor: { constructorId: 'team_a' }
          },
          {
            position: '2',
            laps: '48',
            status: 'Track Limit Penalty', // Generic non-"Lap" status
            Driver: { driverId: 'runner' },
            Constructor: { constructorId: 'team_b' }
          }
        ]
      }
    ];

    const metrics = f1App.computeFinishingGapMetrics(customRound, 'drivers');
    const runner = metrics.competitors.find(c => c.id === 'runner');
    assert.ok(runner);
    // Winner avg lap = 5000 / 50 = 100s. Laps down = 50 - 48 = 2. Expected gap = 200s
    assert.equal(runner.roundGaps['1'].gap, 200.0);
  });

  test('falls back to 90.0s lap baseline when winner race duration or lap count is missing', () => {
    const { exports: f1App } = createTestEnv();
    const missingTimeRound = [
      {
        round: '1',
        raceName: 'Fallback Lap GP',
        Results: [
          {
            position: '1',
            laps: '0', // No laps specified
            status: 'Finished',
            Driver: { driverId: 'winner' },
            Constructor: { constructorId: 'team_a' }
          },
          {
            position: '2',
            laps: '0',
            status: '+1 Lap',
            Driver: { driverId: 'lapped' },
            Constructor: { constructorId: 'team_b' }
          }
        ]
      }
    ];

    const metrics = f1App.computeFinishingGapMetrics(missingTimeRound, 'drivers');
    const lapped = metrics.competitors.find(c => c.id === 'lapped');
    assert.ok(lapped);
    // Baseline is 90.0s
    assert.equal(lapped.roundGaps['1'].gap, 90.0);
  });

  test('excludes retired / DNF runners with < 90% distance from classified results', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'drivers');

    // Gasly retired on lap 12 out of 57 in Round 1 (Accident)
    const gasly = metrics.competitors.find(c => c.id === 'gasly');
    assert.ok(gasly);
    assert.equal(gasly.classifiedCount, 0);
    assert.equal(gasly.roundGaps['1'], undefined);
    assert.equal(gasly.medianGap, 999.0);
  });
});

describe('Issue #15: Competitiveness Deficit Metrics Engine (computeFinishingGapMetrics)', () => {
  test('falls back to FINISHING_GAP_FALLBACK_2024 when null or empty race rounds provided', () => {
    const { exports: f1App } = createTestEnv();

    const fallbackNull = f1App.computeFinishingGapMetrics(null, 'constructors');
    assert.equal(fallbackNull.scope, 'constructors');
    assert.equal(fallbackNull.competitors.length, 10);

    const fallbackEmpty = f1App.computeFinishingGapMetrics([], 'constructors');
    assert.equal(fallbackEmpty.scope, 'constructors');
    assert.equal(fallbackEmpty.competitors.length, 10);
  });

  test('falls back to FINISHING_GAP_FALLBACK_DRIVERS_2024 when scope is drivers and empty rounds provided', () => {
    const { exports: f1App } = createTestEnv();

    const fallbackDrivers = f1App.computeFinishingGapMetrics([], 'drivers');
    assert.equal(fallbackDrivers.scope, 'drivers');
    assert.equal(fallbackDrivers.benchmarkLeader.id, 'max_verstappen');
  });

  test('constructor scope aggregates multiple drivers per team and selects minimum gap per round', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const mclaren = metrics.competitors.find(c => c.id === 'mclaren');
    assert.ok(mclaren);

    // In Round 1: Norris +48.458s -> mclaren minGap is 48.458s
    assert.equal(mclaren.roundGaps['1'].gap, 48.458);
    // In Round 2: Piastri +32.007s, Norris +45.709s -> mclaren minGap is 32.007s
    assert.equal(mclaren.roundGaps['2'].gap, 32.007);
    // In Round 3: Piastri +0.525s, Norris +6.154s -> mclaren minGap is 0.525s
    assert.equal(mclaren.roundGaps['3'].gap, 0.525);
  });

  test('computes exact median gap for odd number of classified rounds', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults(); // 3 rounds
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const mclaren = metrics.competitors.find(c => c.id === 'mclaren');
    assert.ok(mclaren);
    // Gaps: [0.525, 32.007, 48.458]. Sorted mid is index 1 -> 32.007s
    assert.equal(mclaren.medianGap, 32.007);
  });

  test('computes exact median gap for even number of classified rounds', () => {
    const { exports: f1App } = createTestEnv();
    const evenRounds = [
      {
        round: '1',
        Results: [
          { position: '1', laps: '50', status: 'Finished', Time: { time: '5000', millis: '5000000' }, Constructor: { constructorId: 'team_a' } },
          { position: '2', laps: '50', status: 'Finished', Time: { time: '+10.000', millis: '5010000' }, Constructor: { constructorId: 'team_b' } }
        ]
      },
      {
        round: '2',
        Results: [
          { position: '1', laps: '50', status: 'Finished', Time: { time: '5000', millis: '5000000' }, Constructor: { constructorId: 'team_a' } },
          { position: '2', laps: '50', status: 'Finished', Time: { time: '+20.000', millis: '5020000' }, Constructor: { constructorId: 'team_b' } }
        ]
      },
      {
        round: '3',
        Results: [
          { position: '1', laps: '50', status: 'Finished', Time: { time: '5000', millis: '5000000' }, Constructor: { constructorId: 'team_a' } },
          { position: '2', laps: '50', status: 'Finished', Time: { time: '+30.000', millis: '5030000' }, Constructor: { constructorId: 'team_b' } }
        ]
      },
      {
        round: '4',
        Results: [
          { position: '1', laps: '50', status: 'Finished', Time: { time: '5000', millis: '5000000' }, Constructor: { constructorId: 'team_a' } },
          { position: '2', laps: '50', status: 'Finished', Time: { time: '+40.000', millis: '5040000' }, Constructor: { constructorId: 'team_b' } }
        ]
      }
    ];

    const metrics = f1App.computeFinishingGapMetrics(evenRounds, 'constructors');
    const teamB = metrics.competitors.find(c => c.id === 'team_b');
    assert.ok(teamB);
    // Gaps: [10, 20, 30, 40]. Even median = (20 + 30) / 2 = 25.0s
    assert.equal(teamB.medianGap, 25.0);
  });

  test('calculates mean gap across all classified rounds', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const mclaren = metrics.competitors.find(c => c.id === 'mclaren');
    assert.ok(mclaren);
    // Gaps: [48.458, 32.007, 0.525]. Sum = 80.990. Mean = 80.990 / 3 = 26.997s
    const expectedMean = parseFloat(((48.458 + 32.007 + 0.525) / 3).toFixed(3));
    assert.equal(mclaren.meanGap, expectedMean);
  });

  test('identifies season best gap and corresponding Grand Prix venue', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const mclaren = metrics.competitors.find(c => c.id === 'mclaren');
    assert.ok(mclaren);
    assert.equal(mclaren.bestGap, 0.525);
    assert.equal(mclaren.bestVenue, 'Italian Grand Prix');
  });

  test('calculates Competitiveness Deficit Index (CDI) score clamped between 30 and 100', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const ferrari = metrics.competitors.find(c => c.id === 'ferrari');
    assert.ok(ferrari);
    // Formula: Math.max(30, Math.min(100, Math.round(100 - (medianGap * 0.75))))
    const expectedFerrariCDI = Math.max(30, Math.min(100, Math.round(100 - (ferrari.medianGap * 0.75))));
    assert.equal(ferrari.cdi, expectedFerrariCDI);
    assert.equal(ferrari.score, expectedFerrariCDI);
    assert.equal(ferrari.competitivenessIndex, expectedFerrariCDI);

    // Test extreme backmarker clamping to 30
    const hugeGapRound = [
      {
        round: '1',
        Results: [
          { position: '1', laps: '50', status: 'Finished', Time: { time: '5000', millis: '5000000' }, Constructor: { constructorId: 'leader' } },
          { position: '2', laps: '50', status: 'Finished', Time: { time: '+200.000', millis: '5200000' }, Constructor: { constructorId: 'slow' } }
        ]
      }
    ];
    const extremeMetrics = f1App.computeFinishingGapMetrics(hugeGapRound, 'constructors');
    const slow = extremeMetrics.competitors.find(c => c.id === 'slow');
    assert.equal(slow.cdi, 30);
  });

  test('computes deficit percentage relative to season average race duration', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const ferrari = metrics.competitors.find(c => c.id === 'ferrari');
    assert.ok(ferrari);
    const expectedPct = parseFloat(((ferrari.medianGap / metrics.avgRaceDuration) * 100).toFixed(2));
    assert.equal(ferrari.deficitPct, expectedPct);
  });

  test('categorizes competitors into Contender, Midfield, and Backmarker tiers', () => {
    const { exports: f1App } = createTestEnv();
    const tierRounds = [
      {
        round: '1',
        Results: [
          { position: '1', laps: '50', status: 'Finished', Time: { time: '5000', millis: '5000000' }, Constructor: { constructorId: 'team_p1' } },
          { position: '2', laps: '50', status: 'Finished', Time: { time: '+12.000', millis: '5012000' }, Constructor: { constructorId: 'team_contender' } },
          { position: '3', laps: '50', status: 'Finished', Time: { time: '+45.000', millis: '5045000' }, Constructor: { constructorId: 'team_midfield' } },
          { position: '4', laps: '50', status: 'Finished', Time: { time: '+75.000', millis: '5075000' }, Constructor: { constructorId: 'team_backmarker' } }
        ]
      }
    ];

    const metrics = f1App.computeFinishingGapMetrics(tierRounds, 'constructors');
    const contender = metrics.competitors.find(c => c.id === 'team_contender');
    const midfield = metrics.competitors.find(c => c.id === 'team_midfield');
    const backmarker = metrics.competitors.find(c => c.id === 'team_backmarker');

    assert.equal(contender.tier, 'contenders');
    assert.equal(contender.tierLabel, 'Contender');
    assert.equal(contender.tierClass, 'tier-contender');

    assert.equal(midfield.tier, 'midfield');
    assert.equal(midfield.tierLabel, 'Midfield');
    assert.equal(midfield.tierClass, 'tier-midfield');

    assert.equal(backmarker.tier, 'backmarkers');
    assert.equal(backmarker.tierLabel, 'Backmarker');
    assert.equal(backmarker.tierClass, 'tier-backmarker');
  });

  test('sorts competitors ascending by median gap and assigns sequential ranks', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    for (let i = 0; i < metrics.competitors.length - 1; i++) {
      assert.ok(metrics.competitors[i].medianGap <= metrics.competitors[i + 1].medianGap);
      assert.equal(metrics.competitors[i].rank, i + 1);
    }
  });

  test('computes field median gap, deficit percentage, and competitiveness spread', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    assert.ok(typeof metrics.fieldMedianGap === 'number');
    assert.ok(typeof metrics.fieldMedianPct === 'number');
    assert.ok(typeof metrics.spread === 'number');
    assert.ok(metrics.spread > 0);
  });

  test('accurately tracks closest Grand Prix finish margin and runner-up', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    // In Round 3 (Italian GP), P2 Piastri was +0.525s behind Leclerc
    assert.equal(metrics.closestFinish.round, '3');
    assert.equal(metrics.closestFinish.raceName, 'Italian Grand Prix');
    assert.equal(metrics.closestFinish.gap, 0.525);
    assert.equal(metrics.closestFinish.runnerUp, 'Oscar Piastri');
  });
});

describe('Issue #15: Classification Table Rendering (renderFinishingGapTable)', () => {
  test('populates table rows with position, competitor name, color pill, and team name', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    f1App.renderFinishingGapTable(metrics);
    const tbody = elements['finishingGapTableBody'];
    assert.ok(tbody.children.length > 0, 'Table body should have generated rows');

    const firstRowHtml = tbody.children[0].innerHTML;
    assert.ok(firstRowHtml.includes('pos-cell'));
    assert.ok(firstRowHtml.includes(metrics.competitors[0].name));
  });

  test('applies .tabular-num-timing and .telemetry-delta-value styling to delta cells', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    f1App.renderFinishingGapTable(metrics);
    const tbody = elements['finishingGapTableBody'];
    const rowHtml = tbody.children[0].innerHTML;

    assert.ok(rowHtml.includes('tabular-num-timing'));
    assert.ok(rowHtml.includes('telemetry-delta-value'));
  });

  test('renders CDI score badge with .score-badge and deficit percentage badge', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    f1App.renderFinishingGapTable(metrics);
    const tbody = elements['finishingGapTableBody'];
    const rowHtml = tbody.children[0].innerHTML;

    assert.ok(rowHtml.includes('score-badge'));
    assert.ok(rowHtml.includes('deficit-pct-badge'));
  });

  test('renders best Grand Prix gap with venue name tag', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    f1App.renderFinishingGapTable(metrics);
    const tbody = elements['finishingGapTableBody'];
    const rowHtml = tbody.children[0].innerHTML;

    assert.ok(rowHtml.includes(metrics.competitors[0].bestVenue));
  });

  test('displays classified count over total races in table cell', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    f1App.renderFinishingGapTable(metrics);
    const tbody = elements['finishingGapTableBody'];
    const rowHtml = tbody.children[0].innerHTML;

    assert.ok(rowHtml.includes(`${metrics.competitors[0].classifiedCount} / ${metrics.competitors[0].totalRaces}`));
  });

  test('renders tier badge with appropriate CSS class', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    f1App.renderFinishingGapTable(metrics);
    const tbody = elements['finishingGapTableBody'];
    const rowHtml = tbody.children[0].innerHTML;

    assert.ok(rowHtml.includes('tier-badge'));
    assert.ok(rowHtml.includes(metrics.competitors[0].tierClass));
  });

  test('updates #finishingGapFilterBadge text with correct competitor count and noun', () => {
    const { exports: f1App, elements } = createTestEnv();
    const results = createSampleRaceResults();

    f1App.finishingGapState.scope = 'constructors';
    const cMetrics = f1App.computeFinishingGapMetrics(results, 'constructors');
    f1App.renderFinishingGapTable(cMetrics);
    assert.equal(elements['finishingGapFilterBadge'].textContent, `Showing ${cMetrics.competitors.length} Teams`);

    f1App.finishingGapState.scope = 'drivers';
    const dMetrics = f1App.computeFinishingGapMetrics(results, 'drivers');
    f1App.renderFinishingGapTable(dMetrics);
    assert.equal(elements['finishingGapFilterBadge'].textContent, `Showing ${dMetrics.competitors.length} Drivers`);
  });
});

describe('Issue #15: Tier & Venue Filtering (setFinishingGapTierFilter & setFinishingGapVenueFilter)', () => {
  test('setFinishingGapTierFilter updates state and toggles active class on tier pills', () => {
    const { exports: f1App, tierPills } = createTestEnv();

    f1App.setFinishingGapTierFilter('contenders');
    assert.equal(f1App.finishingGapState.tier, 'contenders');

    const contenderPill = tierPills.find(p => p['data-tier'] === 'contenders');
    const allPill = tierPills.find(p => p['data-tier'] === 'all');
    assert.ok(contenderPill.classList.contains('active'));
    assert.ok(!allPill.classList.contains('active'));
  });

  test('filters table rows and chart data when specific tier is selected', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.finishingGapState.metrics = f1App.FINISHING_GAP_FALLBACK_2024;
    f1App.finishingGapState.tier = 'all';

    // 10 teams in fallback total
    f1App.renderFinishingGapTable();
    assert.equal(elements['finishingGapTableBody'].children.length, 10);

    // Filter to contenders (4 teams in fallback: McLaren, Ferrari, Red Bull, Mercedes)
    f1App.setFinishingGapTierFilter('contenders');
    assert.equal(elements['finishingGapTableBody'].children.length, 4);

    // Filter to backmarkers (2 teams: Williams, Sauber)
    f1App.setFinishingGapTierFilter('backmarkers');
    assert.equal(elements['finishingGapTableBody'].children.length, 2);
  });

  test('restores all competitors when all tier filter is selected', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.finishingGapState.metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.setFinishingGapTierFilter('midfield');
    assert.equal(elements['finishingGapTableBody'].children.length, 4);

    f1App.setFinishingGapTierFilter('all');
    assert.equal(elements['finishingGapTableBody'].children.length, 10);
  });

  test('setFinishingGapVenueFilter updates chart title to venue-specific header', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.finishingGapState.metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.setFinishingGapVenueFilter('16');
    assert.equal(f1App.finishingGapState.venueRound, '16');
    assert.ok(elements['fgChartTitle'].textContent.includes('Italian'));

    f1App.setFinishingGapVenueFilter('all');
    assert.equal(elements['fgChartTitle'].textContent, 'Median Finishing Gap to Winner (Seconds)');
  });

  test('re-ranks table rows and chart data by round gap when specific venue is filtered', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.finishingGapState.tier = 'all';
    f1App.finishingGapState.metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    // Filter to Round 16 Italian GP where Ferrari won (0 gap) and McLaren was 2nd (0.525s)
    f1App.setFinishingGapVenueFilter('16');
    const tbody = elements['finishingGapTableBody'];
    assert.ok(tbody.children.length > 0);

    // First row should be Ferrari (0.000s)
    const firstRowHtml = tbody.children[0].innerHTML;
    assert.ok(firstRowHtml.includes('Ferrari'));
  });
});

describe('Issue #15: High-Level KPI Cards Rendering (renderFinishingGapKpis)', () => {
  test('populates Benchmark Leader KPI card with team name, gap, bar color, and description', () => {
    const { exports: f1App, elements } = createTestEnv();
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;
    f1App.finishingGapState.venueRound = 'all';

    f1App.renderFinishingGapKpis(metrics);

    assert.equal(elements['fgKpiBenchmarkTeam'].textContent, 'McLaren');
    assert.equal(elements['fgKpiBenchmarkGap'].textContent, '+4.850s');
    assert.equal(elements['fgKpiBenchmarkBar'].style.background, '#FF8000');
    assert.equal(elements['fgKpiBenchmarkTag'].textContent, 'Minimal Gap');
    assert.ok(elements['fgKpiBenchmarkDesc'].textContent.includes('Lowest season median'));
  });

  test('populates Field Median Deficit KPI card with gap in seconds and percentage', () => {
    const { exports: f1App, elements } = createTestEnv();
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapKpis(metrics);

    assert.equal(elements['fgKpiFieldMedianGap'].textContent, '+38.600s');
    assert.equal(elements['fgKpiFieldMedianPct'].textContent, '+0.71%');
  });

  test('populates Closest Grand Prix Finish KPI card with round, gap, and runner-up driver', () => {
    const { exports: f1App, elements } = createTestEnv();
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapKpis(metrics);

    assert.equal(elements['fgKpiClosestRound'].textContent, 'R16 Italian GP');
    assert.equal(elements['fgKpiClosestFinish'].textContent, '+0.525s');
    assert.equal(elements['fgKpiClosestDriver'].textContent, 'Oscar Piastri');
  });

  test('populates Competitiveness Spread KPI card with span delta and tier category', () => {
    const { exports: f1App, elements } = createTestEnv();
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapKpis(metrics);

    assert.equal(elements['fgKpiSpread'].textContent, '+73.650s');
    assert.equal(elements['fgKpiSpreadTier'].textContent, 'High Delta'); // > 60s
  });

  test('updates spread tier label dynamically based on spread magnitude', () => {
    const { exports: f1App, elements } = createTestEnv();

    const tightMetrics = {
      ...f1App.FINISHING_GAP_FALLBACK_2024,
      spread: 25.5
    };
    f1App.renderFinishingGapKpis(tightMetrics);
    assert.equal(elements['fgKpiSpreadTier'].textContent, 'Tight Field');

    const modMetrics = {
      ...f1App.FINISHING_GAP_FALLBACK_2024,
      spread: 45.0
    };
    f1App.renderFinishingGapKpis(modMetrics);
    assert.equal(elements['fgKpiSpreadTier'].textContent, 'Moderate Delta');
  });
});

describe('Issue #15: Chart Rendering & Lifecycle (renderFinishingGapChart)', () => {
  test('destroys prior chart instance before creating new one', () => {
    const { exports: f1App, chartInstances } = createTestEnv();
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapChart(metrics);
    assert.equal(chartInstances.length, 1);
    const firstChart = chartInstances[0];

    f1App.renderFinishingGapChart(metrics);
    assert.equal(chartInstances.length, 2);
    assert.ok(firstChart.destroyed, 'Prior chart instance should be destroyed');
  });

  test('initializes Chart.js horizontal bar chart (indexAxis: y) with competitor labels and gaps', () => {
    const { exports: f1App, chartInstances } = createTestEnv();
    f1App.finishingGapState.tier = 'all';
    f1App.finishingGapState.venueRound = 'all';
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapChart(metrics);
    const chart = chartInstances[chartInstances.length - 1];

    assert.equal(chart.type, 'bar');
    assert.equal(chart.options?.indexAxis, 'y');
    assert.equal(chart.data.labels.length, 10);
    assert.equal(chart.data.labels[0], 'McLaren');
    assert.equal(chart.data.datasets[0].data[0], 4.85);
  });

  test('colors chart bars using competitor theme colors with transparency', () => {
    const { exports: f1App, chartInstances } = createTestEnv();
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapChart(metrics);
    const chart = chartInstances[chartInstances.length - 1];
    const dataset = chart.data.datasets[0];

    assert.ok(dataset.backgroundColor[0].includes('#FF8000'));
    assert.equal(dataset.borderColor[0], '#FF8000');
  });

  test('respects active tier filter when building chart datasets', () => {
    const { exports: f1App, chartInstances } = createTestEnv();
    f1App.finishingGapState.tier = 'contenders';
    const metrics = f1App.FINISHING_GAP_FALLBACK_2024;

    f1App.renderFinishingGapChart(metrics);
    const chart = chartInstances[chartInstances.length - 1];

    assert.equal(chart.data.labels.length, 4);
    assert.deepEqual([...chart.data.labels], ['McLaren', 'Ferrari', 'Red Bull', 'Mercedes']);
  });
});

describe('Issue #15: View Scope & User Interactions', () => {
  test('setFinishingGapViewScope(drivers) toggles active pills and switches to driver scope', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.setFinishingGapViewScope('drivers');
    assert.equal(f1App.finishingGapState.scope, 'drivers');
    assert.ok(elements['fgPillScopeDrivers'].classList.contains('active'));
    assert.ok(!elements['fgPillScopeConstructors'].classList.contains('active'));
  });

  test('setFinishingGapViewScope(constructors) toggles active pills and switches to constructor scope', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.setFinishingGapViewScope('drivers');
    f1App.setFinishingGapViewScope('constructors');
    assert.equal(f1App.finishingGapState.scope, 'constructors');
    assert.ok(elements['fgPillScopeConstructors'].classList.contains('active'));
    assert.ok(!elements['fgPillScopeDrivers'].classList.contains('active'));
  });

  test('ignores invalid scope inputs', () => {
    const { exports: f1App } = createTestEnv();
    f1App.finishingGapState.scope = 'constructors';

    f1App.setFinishingGapViewScope('invalid_scope');
    assert.equal(f1App.finishingGapState.scope, 'constructors');
  });

  test('onFinishingGapSeasonChange updates state season and loads season telemetry', () => {
    const { exports: f1App } = createTestEnv();

    f1App.onFinishingGapSeasonChange('2023');
    assert.equal(f1App.finishingGapState.season, '2023');
  });

  test('refreshFinishingGapData forces telemetry reload bypassing cache', () => {
    const { exports: f1App, elements } = createTestEnv();
    elements['finishingGapSeasonSelect'].value = '2024';

    assert.doesNotThrow(() => {
      f1App.refreshFinishingGapData();
    });
  });
});

describe('Issue #15: Main Navigation Tab Switching Integration (switchMainTab)', () => {
  test('switchMainTab(finishing-gap) displays finishing gap section and hides all other sections', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.switchMainTab('finishing-gap');

    assert.equal(elements['finishing-gap-section'].style.display, 'block');
    assert.equal(elements['circuit-profiler-section'].style.display, 'none');
    assert.equal(elements['constructor-atr-section'].style.display, 'none');
    assert.equal(elements['sprint-disparity-section'].style.display, 'none');
    assert.equal(elements['clinch-engine-section'].style.display, 'none');
    assert.equal(elements['pitstop-matrix-section'].style.display, 'none');
    assert.equal(elements['teammate-telemetry-section'].style.display, 'none');
    assert.equal(elements['progression-section'].style.display, 'none');
    assert.equal(elements['latest-race-section'].style.display, 'none');
    assert.equal(elements['standings-table-section'].style.display, 'none');

    assert.ok(elements['tabBtnFinishingGap'].classList.contains('active'));
  });

  test('hides finishing gap section when switching to other tabs (profiler, constructors, etc.)', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.switchMainTab('profiler');
    assert.equal(elements['finishing-gap-section'].style.display, 'none');
    assert.equal(elements['circuit-profiler-section'].style.display, 'block');

    f1App.switchMainTab('constructors');
    assert.equal(elements['finishing-gap-section'].style.display, 'none');
    assert.equal(elements['constructor-atr-section'].style.display, 'block');
  });

  test('shows finishing gap section when switching to all tab', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.switchMainTab('all');
    assert.equal(elements['finishing-gap-section'].style.display, 'block');
    assert.equal(elements['circuit-profiler-section'].style.display, 'block');
    assert.equal(elements['constructor-atr-section'].style.display, 'block');
  });
});

describe('Issue #15: Jolpica API Integration, Caching, & Error Handling (loadFinishingGapData)', () => {
  test('loads cached telemetry from localStorage without initiating network request', async () => {
    const { exports: f1App, elements, storage } = createTestEnv();
    const sampleResults = createSampleRaceResults();

    storage.setItem('f1_finishing_gap_2024', JSON.stringify({ results: sampleResults }));

    await f1App.loadFinishingGapData('2024', false);

    assert.equal(elements['finishingGapCacheBadge'].textContent, '⚡ Cached Telemetry');
    assert.ok(elements['finishingGapCacheBadge'].className.includes('cached'));
    assert.equal(f1App.finishingGapState.results.length, sampleResults.length);
  });

  test('falls back to fallback telemetry gracefully on network error with offline badge', async () => {
    const failingFetch = async () => {
      throw new Error('Network error (Simulated 500/offline)');
    };
    const { exports: f1App, elements } = createTestEnv(failingFetch);

    await f1App.loadFinishingGapData('2024', true);

    assert.equal(elements['finishingGapCacheBadge'].textContent, '⚠️ Live Telemetry Offline');
    assert.ok(elements['finishingGapCacheBadge'].className.includes('no-data'));
    assert.ok(f1App.finishingGapState.metrics, 'Metrics should fall back to valid dataset');
    assert.equal(f1App.finishingGapState.isLoading, false);
  });

  test('DOMContentLoaded listener automatically initializes finishing gap telemetry', () => {
    const { exports: f1App, elements, listeners } = createTestEnv();

    assert.ok(listeners['DOMContentLoaded'], 'DOMContentLoaded listener should be registered');
    elements['finishingGapSeasonSelect'].value = '2024';

    assert.doesNotThrow(() => {
      listeners['DOMContentLoaded'].forEach(fn => fn());
    });
  });
});

describe('Issue #18: Cumulative Time.millis vs Delta Time.time Fix', () => {
  test('parseFinishingTimeToSeconds prioritizes delta Time.time string over cumulative Time.millis', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    // In Jolpica API, P2 has time: "+22.457", millis: "5527199" (cumulative total race millis)
    assert.equal(parse('+22.457', '5527199'), 22.457);
    assert.equal(parse('+13.643', '4856916'), 13.643);
    assert.equal(parse('+0.525', '4481314'), 0.525);
    assert.equal(parse('+1:05.123', '5569865'), 65.123);
  });

  test('parseFinishingTimeToSeconds calculates difference between driver millis and winner millis when timeStr is missing', () => {
    const { exports: f1App } = createTestEnv();
    const parse = f1App.parseFinishingTimeToSeconds;

    // Winner: 5504742 ms, Driver: 5527199 ms -> Delta = 22.457s
    assert.equal(parse(null, '5527199', '5504742'), 22.457);
    assert.equal(parse(undefined, 5527199, 5504742), 22.457);
    assert.equal(parse('', '4856916', '4843273'), 13.643);
  });

  test('computeFinishingGapMetrics produces accurate sub-minute gaps and avoids multi-thousand-second inflation', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    // Verify all competitors have realistic median gaps under 200s (no 5000s+ gaps)
    metrics.competitors.forEach(c => {
      if (c.classifiedCount > 0) {
        assert.ok(c.medianGap < 300, `Competitor ${c.name} has unrealistic gap: ${c.medianGap}`);
      }
    });

    // Red Bull won 2 races and finished P4 in round 3 (+37.932s) -> median gap is 0.0s
    const redBull = metrics.competitors.find(c => c.id === 'red_bull');
    assert.ok(redBull);
    assert.equal(redBull.medianGap, 0.0);
    assert.equal(redBull.tier, 'contenders');

    // Ferrari had gaps: R1 25.110, R2 18.639, R3 0.000 -> median is 18.639s
    const ferrari = metrics.competitors.find(c => c.id === 'ferrari');
    assert.ok(ferrari);
    assert.equal(ferrari.medianGap, 18.639);
    assert.equal(ferrari.tier, 'midfield');

    // Closest finish margin is 0.525s at Italian GP (Piastri vs Leclerc)
    assert.equal(metrics.closestFinish.gap, 0.525);
    assert.equal(metrics.closestFinish.round, '3');
    assert.equal(metrics.closestFinish.runnerUp, 'Oscar Piastri');
  });

  test('maintains proper tier classifications and CDI scores without being crushed to backmarker tier', () => {
    const { exports: f1App } = createTestEnv();
    const results = createSampleRaceResults();
    const metrics = f1App.computeFinishingGapMetrics(results, 'constructors');

    const contenders = metrics.competitors.filter(c => c.tier === 'contenders');
    const midfield = metrics.competitors.filter(c => c.tier === 'midfield');

    assert.ok(contenders.length > 0, 'Should have at least one contender');
    assert.ok(midfield.length > 0, 'Should have midfield teams');

    // Ensure CDI scores reflect true competitiveness (not all clamped to 30)
    const nonClamped = metrics.competitors.filter(c => c.cdi > 30);
    assert.ok(nonClamped.length >= 3, 'Multiple teams should have CDI > 30');
  });
});
