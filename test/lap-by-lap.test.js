const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function toPlain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const driverPills = [];
  const tabButtons = [];
  const listeners = {};

  function createMockElement(id, tagName = 'div') {
    const el = {
      id,
      tagName: tagName.toUpperCase(),
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
        this._innerHTML = String(val);
        if (val === '') {
          this.children = [];
        }
      },
      _textContent: '',
      get textContent() { return this._textContent; },
      set textContent(val) { this._textContent = String(val); },
      value: '',
      _className: '',
      get className() { return this._className; },
      set className(val) {
        this._className = String(val);
        this.classList.classes.clear();
        this._className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      },
      options: [],
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

  // Setup tab buttons
  const tabIds = [
    'tabBtnAll',
    'tabBtnLapChart',
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

  // Pre-seed common UI elements for Issue #14
  getOrCreateEl('lapSeasonSelect').value = '2024';
  getOrCreateEl('lapRoundSelect').value = '1';
  getOrCreateEl('lap-chart-section').style.display = 'block';

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
      if (selector && selector.includes('tab-btn')) {
        return tabButtons;
      }
      if (selector && selector.includes('lap-driver-pill')) {
        return driverPills;
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => {
      const el = createMockElement('created_' + tag + '_' + Math.random().toString(36).substring(2, 7), tag);
      if (tag.toLowerCase() === 'button' && el.className.includes('lap-driver-pill')) {
        driverPills.push(el);
      }
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
      this.updated = false;
      chartInstances.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
    resize() {
      this.resized = true;
    }
    update() {
      this.updated = true;
    }
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
    tabButtons,
    driverPills
  };
}

// Sample realistic multi-round results
function createSampleRaceResults() {
  return [
    {
      round: '1',
      raceName: 'Bahrain Grand Prix',
      Circuit: { circuitId: 'bahrain', circuitName: 'Bahrain International Circuit' },
      Results: [
        {
          position: '1',
          positionText: '1',
          grid: '1',
          laps: '57',
          status: 'Finished',
          Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          position: '2',
          positionText: '2',
          grid: '5',
          laps: '57',
          status: 'Finished',
          Driver: { driverId: 'perez', givenName: 'Sergio', familyName: 'Perez', code: 'PER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          position: '3',
          positionText: '3',
          grid: '4',
          laps: '57',
          status: 'Finished',
          Driver: { driverId: 'sainz', givenName: 'Carlos', familyName: 'Sainz', code: 'SAI' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '4',
          positionText: '4',
          grid: '2',
          laps: '57',
          status: 'Finished',
          Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '5',
          positionText: '5',
          grid: '7',
          laps: '56',
          status: '+1 Lap',
          Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          position: '6',
          positionText: 'R',
          grid: '6',
          laps: '24',
          status: 'Accident',
          Driver: { driverId: 'alonso', givenName: 'Fernando', familyName: 'Alonso', code: 'ALO' },
          Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' }
        }
      ]
    },
    {
      round: '2',
      raceName: 'Saudi Arabian Grand Prix',
      Circuit: { circuitId: 'jeddah', circuitName: 'Jeddah Corniche Circuit' },
      Results: [
        {
          position: '1',
          positionText: '1',
          grid: '1',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          position: '2',
          positionText: '2',
          grid: '2',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          position: '3',
          positionText: '3',
          grid: '4',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        }
      ]
    }
  ];
}

// Sample 5-lap race with lead changes and retirement
function createSampleLapsData() {
  return [
    {
      number: '1',
      Timings: [
        { driverId: 'max_verstappen', position: '1', time: '1:36.5' },
        { driverId: 'norris', position: '2', time: '1:37.0' },
        { driverId: 'leclerc', position: '3', time: '1:37.4' },
        { driverId: 'alonso', position: '4', time: '1:38.0' }
      ]
    },
    {
      number: '2',
      Timings: [
        { driverId: 'max_verstappen', position: '1', time: '1:35.8' },
        { driverId: 'norris', position: '2', time: '1:36.2' },
        { driverId: 'leclerc', position: '3', time: '1:36.9' },
        { driverId: 'alonso', position: '4', time: '1:37.5' }
      ]
    },
    {
      number: '3',
      Timings: [
        { driverId: 'norris', position: '1', time: '1:35.4' }, // Lead change to NOR
        { driverId: 'max_verstappen', position: '2', time: '1:36.1' },
        { driverId: 'leclerc', position: '3', time: '1:36.7' },
        { driverId: 'alonso', position: '4', time: '1:37.8' }
      ]
    },
    {
      number: '4',
      Timings: [
        { driverId: 'norris', position: '1', time: '1:35.6' },
        { driverId: 'max_verstappen', position: '2', time: '1:35.9' },
        { driverId: 'leclerc', position: '3', time: '1:36.5' },
        { driverId: 'alonso', position: '4', time: '1:38.2' } // Alonso retires after L4
      ]
    },
    {
      number: '5',
      Timings: [
        { driverId: 'max_verstappen', position: '1', time: '1:35.1' }, // Lead change back to VER
        { driverId: 'norris', position: '2', time: '1:35.5' },
        { driverId: 'leclerc', position: '3', time: '1:36.3' }
        // Alonso absent on lap 5 due to retirement
      ]
    }
  ];
}

describe('Issue #14: Lap-by-Lap Module Exports & Initial State', () => {
  const { exports } = createTestEnv();

  test('exports all required Issue #14 handlers, helpers, and constants', () => {
    assert.strictEqual(typeof exports.loadLapTelemetry, 'function');
    assert.strictEqual(typeof exports.onLapSeasonChange, 'function');
    assert.strictEqual(typeof exports.onLapRoundChange, 'function');
    assert.strictEqual(typeof exports.refreshLapData, 'function');
    assert.strictEqual(typeof exports.computeSeasonLapsLed, 'function');
    assert.strictEqual(typeof exports.cleanRetirementTruncation, 'function');
    assert.strictEqual(typeof exports.buildDriverLapPositions, 'function');
    assert.strictEqual(typeof exports.processLapChartData, 'function');
    assert.strictEqual(typeof exports.renderLapPositionChart, 'function');
    assert.strictEqual(typeof exports.renderSeasonLapsLedLeaderboard, 'function');
    assert.strictEqual(typeof exports.renderLapRoundBreakdown, 'function');
    assert.strictEqual(typeof exports.renderLapDriverFilters, 'function');
    assert.strictEqual(typeof exports.toggleLapDriverFilter, 'function');
    assert.strictEqual(typeof exports.setLapDriverFilterAll, 'function');
    assert.strictEqual(typeof exports.setLapDriverFilterTopN, 'function');
    assert.strictEqual(typeof exports.populateLapRoundSelector, 'function');
    assert.strictEqual(typeof exports.fetchSeasonResults, 'function');
    assert.strictEqual(typeof exports.fetchLapPositions, 'function');
    assert.strictEqual(typeof exports.lapChartState, 'object');
    assert.strictEqual(typeof exports.LAP_CHART_FALLBACK_2024, 'object');
    assert.strictEqual(typeof exports.LAP_CHART_FALLBACK_DRIVERS_2024, 'object');
    assert.strictEqual(typeof exports.LAP_CHART_FALLBACK_LAPS_2024, 'object');
    assert.strictEqual(typeof exports.SEASON_LAPS_LED_FALLBACK_2024, 'object');
  });

  test('lapChartState initializes with default configuration', () => {
    const { lapChartState } = exports;
    assert.strictEqual(lapChartState.season, '2024');
    assert.strictEqual(lapChartState.round, '1');
    assert.strictEqual(Array.isArray(lapChartState.rounds), true);
    assert.strictEqual(Array.isArray(lapChartState.lapsData), true);
    assert.strictEqual(Array.isArray(lapChartState.resultsData), true);
    assert.strictEqual(typeof lapChartState.seasonLapsByRound, 'object');
    assert.strictEqual(typeof lapChartState.driverVisibility, 'object');
    assert.strictEqual(lapChartState.isLoading, false);
  });

  test('LAP_CHART_FALLBACK_2024 defines standard 57-lap Bahrain GP fallback dataset', () => {
    const fb = exports.LAP_CHART_FALLBACK_2024;
    assert.strictEqual(fb.maxLaps, 57);
    assert.strictEqual(fb.totalDrivers, 20);
    assert.strictEqual(fb.retirementsCount, 0);
    assert.strictEqual(fb.labels.length, 57);
    assert.strictEqual(fb.datasets.length, 20);
    assert.strictEqual(fb.datasets[0].stepped, true);
    assert.strictEqual(fb.datasets[0].spanGaps, false);
    assert.strictEqual(fb.datasets[0].driverId, 'max_verstappen');
  });

  test('SEASON_LAPS_LED_FALLBACK_2024 contains validated leaderboard and leader', () => {
    const fb = exports.SEASON_LAPS_LED_FALLBACK_2024;
    assert.strictEqual(fb.totalLapsLed, 1440);
    assert.strictEqual(fb.leader.driverId, 'max_verstappen');
    assert.strictEqual(fb.leader.lapsLed, 448);
    assert.strictEqual(fb.leader.percentage, 31.1);
    assert.strictEqual(Array.isArray(fb.leaderboard), true);
    assert.strictEqual(fb.leaderboard.length, 7);
  });
});

describe('Issue #14: Retirement Truncation Engine (cleanRetirementTruncation)', () => {
  const { cleanRetirementTruncation } = createTestEnv().exports;

  test('truncates positions after retirementLap with null', () => {
    const positions = [1, 1, 2, 2, 3, 3, 4, 4];
    const truncated = cleanRetirementTruncation(positions, 4);
    assert.deepEqual(toPlain(truncated), [1, 1, 2, 2, null, null, null, null]);
  });

  test('preserves all positions when retirementLap is null, undefined, or NaN', () => {
    const positions = [1, 2, 3, 4, 5];
    assert.deepEqual(toPlain(cleanRetirementTruncation(positions, null)), [1, 2, 3, 4, 5]);
    assert.deepEqual(toPlain(cleanRetirementTruncation(positions, undefined)), [1, 2, 3, 4, 5]);
    assert.deepEqual(toPlain(cleanRetirementTruncation(positions, NaN)), [1, 2, 3, 4, 5]);
    assert.deepEqual(toPlain(cleanRetirementTruncation(positions, 'invalid')), [1, 2, 3, 4, 5]);
  });

  test('handles retirement on lap 0 (all positions become null)', () => {
    const positions = [5, 6, 7];
    const truncated = cleanRetirementTruncation(positions, 0);
    assert.deepEqual(toPlain(truncated), [null, null, null]);
  });

  test('handles retirement on the final lap (no truncation)', () => {
    const positions = [1, 2, 3];
    const truncated = cleanRetirementTruncation(positions, 3);
    assert.deepEqual(toPlain(truncated), [1, 2, 3]);
  });

  test('handles negative retirementLap safely without crashing', () => {
    const positions = [1, 2, 3];
    assert.deepEqual(toPlain(cleanRetirementTruncation(positions, -1)), [1, 2, 3]);
  });

  test('handles non-array positions input safely', () => {
    assert.deepEqual(toPlain(cleanRetirementTruncation(null, 5)), []);
    assert.deepEqual(toPlain(cleanRetirementTruncation(undefined, 5)), []);
    assert.deepEqual(toPlain(cleanRetirementTruncation('string', 5)), []);
  });

  test('parses string retirement lap correctly', () => {
    const positions = [1, 2, 3, 4, 5];
    const truncated = cleanRetirementTruncation(positions, '2');
    assert.deepEqual(toPlain(truncated), [1, 2, null, null, null]);
  });
});

describe('Issue #14: Driver Lap Positions Builder (buildDriverLapPositions)', () => {
  const { buildDriverLapPositions } = createTestEnv().exports;
  const sampleLaps = createSampleLapsData();

  test('extracts consecutive positions across all laps for a driver', () => {
    const positions = buildDriverLapPositions(sampleLaps, 'norris', null, 5);
    assert.deepEqual(toPlain(positions), [2, 2, 1, 1, 2]);
  });

  test('sets null when driver is absent from lap timings', () => {
    // Alonso retired on lap 4 and has no timing on lap 5
    const positions = buildDriverLapPositions(sampleLaps, 'alonso', null, 5);
    assert.deepEqual(toPlain(positions), [4, 4, 4, 4, null]);
  });

  test('truncates positions with null when explicit retirementLap is passed', () => {
    const positions = buildDriverLapPositions(sampleLaps, 'norris', 2, 5);
    assert.deepEqual(toPlain(positions), [2, 2, null, null, null]);
  });

  test('handles empty laps array or null driver safely', () => {
    assert.deepEqual(toPlain(buildDriverLapPositions([], 'norris', null, 3)), [null, null, null]);
    assert.deepEqual(toPlain(buildDriverLapPositions(null, 'norris', null, 2)), [null, null]);
    assert.deepEqual(toPlain(buildDriverLapPositions(sampleLaps, 'unknown_driver', null, 5)), [null, null, null, null, null]);
  });

  test('handles malformed lap timing objects safely', () => {
    const badLaps = [{ number: '1', Timings: null }, { number: '2' }, { number: '3', Timings: [{ driverId: 'ver' }] }];
    const positions = buildDriverLapPositions(badLaps, 'ver', null, 3);
    assert.deepEqual(toPlain(positions), [null, null, null]);
  });
});

describe('Issue #14: Data Processing & Dataset Generation (processLapChartData)', () => {
  const { processLapChartData } = createTestEnv().exports;
  const sampleLaps = createSampleLapsData();
  const sampleResults = createSampleRaceResults();

  test('falls back to LAP_CHART_FALLBACK_2024 when laps is empty or null', () => {
    const resEmpty = processLapChartData([]);
    assert.strictEqual(resEmpty.maxLaps, 57);
    assert.strictEqual(resEmpty.totalDrivers, 20);

    const resNull = processLapChartData(null);
    assert.strictEqual(resNull.maxLaps, 57);
  });

  test('computes maxLaps, labels, and totalDrivers accurately', () => {
    const res = processLapChartData(sampleLaps, sampleResults, '1');
    assert.strictEqual(res.maxLaps, 5);
    assert.deepEqual(toPlain(res.labels), ['1', '2', '3', '4', '5']);
    assert.strictEqual(res.totalDrivers >= 4, true);
  });

  test('sets stepped multi-line chart flags and team livery colors', () => {
    const res = processLapChartData(sampleLaps, sampleResults, '1');
    const verDs = res.datasets.find(d => d.driverId === 'max_verstappen');
    assert.ok(verDs);
    assert.strictEqual(verDs.stepped, true);
    assert.strictEqual(verDs.spanGaps, false);
    assert.strictEqual(verDs.borderWidth, 2);
    assert.strictEqual(verDs.pointRadius, 1.5);
    assert.ok(verDs.borderColor);
    assert.strictEqual(verDs.borderColor, verDs.backgroundColor);
  });

  test('correctly identifies retirements and cleans truncation without counting classified lapped cars', () => {
    const res = processLapChartData(sampleLaps, sampleResults, '1');
    // Alonso retired on lap 24 (or lap 4 in our sample laps)
    const alonsoDs = res.datasets.find(d => d.driverId === 'alonso');
    assert.ok(alonsoDs);
    assert.strictEqual(alonsoDs.data[4], null); // lap 5 should be null

    // Norris has status "+1 Lap" - must NOT be in retirementsCount
    const norrisDriver = res.drivers.find(d => d.driverId === 'norris');
    assert.ok(norrisDriver);
    assert.strictEqual(norrisDriver.retirementLap, null);

    // Only 1 retirement (Alonso)
    assert.strictEqual(res.retirementsCount, 1);
  });

  test('sorts drivers by final position or grid position', () => {
    const res = processLapChartData(sampleLaps, sampleResults, '1');
    assert.strictEqual(res.drivers[0].driverId, 'max_verstappen'); // P1
    assert.strictEqual(res.drivers[1].driverId, 'perez'); // P2
  });

  test('driver datasets respect driverVisibility filter state', () => {
    const env = createTestEnv();
    env.exports.lapChartState.driverVisibility['leclerc'] = false;
    const res = env.exports.processLapChartData(sampleLaps, sampleResults, '1');
    const lecDs = res.datasets.find(d => d.driverId === 'leclerc');
    assert.ok(lecDs);
    assert.strictEqual(lecDs.hidden, true);
  });
});

describe('Issue #14: Season Laps Led Aggregator (computeSeasonLapsLed)', () => {
  const { computeSeasonLapsLed } = createTestEnv().exports;
  const sampleResults = createSampleRaceResults();

  test('falls back to SEASON_LAPS_LED_FALLBACK_2024 when empty data provided', () => {
    assert.strictEqual(computeSeasonLapsLed([]).leader.driverId, 'max_verstappen');
    assert.strictEqual(computeSeasonLapsLed(null).totalLapsLed, 1440);
    assert.strictEqual(computeSeasonLapsLed({}).leader.lapsLed, 448);
  });

  test('aggregates laps led from array of races with .Laps', () => {
    const races = [
      {
        round: '1',
        Laps: [
          { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] },
          { number: '2', Timings: [{ driverId: 'max_verstappen', position: '1' }] },
          { number: '3', Timings: [{ driverId: 'norris', position: '1' }] }
        ]
      },
      {
        round: '2',
        Laps: [
          { number: '1', Timings: [{ driverId: 'norris', position: '1' }] },
          { number: '2', Timings: [{ driverId: 'norris', position: '1' }] },
          { number: '3', Timings: [{ driverId: 'leclerc', position: '1' }] }
        ]
      }
    ];

    const ledData = computeSeasonLapsLed(races, sampleResults);
    assert.strictEqual(ledData.totalLapsLed, 6);
    assert.strictEqual(ledData.leader.driverId, 'norris'); // 3 laps led
    assert.strictEqual(ledData.leader.lapsLed, 3);
    assert.strictEqual(ledData.leader.percentage, 50.0);

    const verEntry = ledData.leaderboard.find(d => d.driverId === 'max_verstappen');
    assert.strictEqual(verEntry.lapsLed, 2);
    assert.strictEqual(verEntry.percentage, 33.3);

    const lecEntry = ledData.leaderboard.find(d => d.driverId === 'leclerc');
    assert.strictEqual(lecEntry.lapsLed, 1);
    assert.strictEqual(lecEntry.percentage, 16.7);
  });

  test('aggregates laps led from round dictionary (seasonLapsByRound)', () => {
    const roundDict = {
      '1': [
        { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] },
        { number: '2', Timings: [{ driverId: 'max_verstappen', position: '1' }] }
      ],
      '2': [
        { number: '1', Timings: [{ driverId: 'leclerc', position: '1' }] }
      ]
    };

    const ledData = computeSeasonLapsLed(roundDict, sampleResults);
    assert.strictEqual(ledData.totalLapsLed, 3);
    assert.strictEqual(ledData.leader.driverId, 'max_verstappen');
    assert.strictEqual(ledData.leader.lapsLed, 2);
    assert.strictEqual(ledData.leader.rank, 1);
  });

  test('resolves constructor details and driver names from resultsData', () => {
    const laps = [
      { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] }
    ];
    const ledData = computeSeasonLapsLed(laps, sampleResults);
    const ver = ledData.leaderboard[0];
    assert.strictEqual(ver.driverName, 'Max Verstappen');
    assert.strictEqual(ver.constructorName, 'Red Bull Racing');
    assert.strictEqual(ver.driverCode, 'VER');
    assert.ok(ver.color);
  });

  test('handles zero laps with position 1 by falling back gracefully', () => {
    const noLeaderLaps = [
      { number: '1', Timings: [{ driverId: 'ver', position: '2' }] }
    ];
    const ledData = computeSeasonLapsLed(noLeaderLaps, sampleResults);
    assert.strictEqual(ledData.leader.driverId, 'max_verstappen');
  });
});

describe('Issue #14: Interactive Position Chart Visualization (renderLapPositionChart)', () => {
  test('initializes Chart.js with inverted Y-axis, stepped multi-line and tooltips', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    const chart = env.exports.renderLapPositionChart(chartData);

    assert.ok(chart);
    assert.strictEqual(chart.type, 'line');
    assert.strictEqual(chart.options.scales.y.reverse, true);
    assert.strictEqual(chart.options.scales.y.min, 1);
    assert.strictEqual(chart.options.scales.y.ticks.stepSize, 1);
    assert.strictEqual(typeof chart.options.scales.y.ticks.callback, 'function');
    assert.strictEqual(chart.options.scales.y.ticks.callback(1), 'P1');
    assert.strictEqual(chart.options.scales.y.ticks.callback(10), 'P10');
  });

  test('tooltip callback formats lap number, position, and retired status', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    const chart = env.exports.renderLapPositionChart(chartData);

    const tooltipCallbacks = chart.options.plugins.tooltip.callbacks;
    assert.strictEqual(typeof tooltipCallbacks.title, 'function');
    assert.strictEqual(typeof tooltipCallbacks.label, 'function');

    // Title callback
    const title = tooltipCallbacks.title([{ label: '25' }]);
    assert.strictEqual(title, 'Lap 25 of 57');

    // Label callback for active driver
    const mockCtxActive = {
      dataset: { driverCode: 'VER', driverName: 'Max Verstappen', constructorName: 'Red Bull Racing' },
      parsed: { y: 1 }
    };
    const labelActive = tooltipCallbacks.label(mockCtxActive);
    assert.ok(labelActive.includes('P1 — Max Verstappen (Red Bull Racing)'));

    // Label callback for retired driver (parsed.y === null)
    const mockCtxRetired = {
      dataset: { driverCode: 'ALO', driverName: 'Fernando Alonso', constructorName: 'Aston Martin' },
      parsed: { y: null }
    };
    const labelRetired = tooltipCallbacks.label(mockCtxRetired);
    assert.ok(labelRetired.includes('ALO: Retired'));
  });

  test('destroys previous chart instance before instantiating new one', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    const chart1 = env.exports.renderLapPositionChart(chartData);
    assert.strictEqual(chart1.destroyed, false);

    const chart2 = env.exports.renderLapPositionChart(chartData);
    assert.strictEqual(chart1.destroyed, true);
    assert.strictEqual(chart2.destroyed, false);
  });

  test('returns null gracefully when canvas getContext is unavailable', () => {
    const env = createTestEnv();
    env.elements['lapPositionChart'].getContext = null;
    const chart = env.exports.renderLapPositionChart(env.exports.LAP_CHART_FALLBACK_2024);
    assert.strictEqual(chart, null);
  });
});

describe('Issue #14: Driver Visibility Filtering Controls', () => {
  test('renderLapDriverFilters generates interactive driver pills with colors', () => {
    const env = createTestEnv();
    const drivers = [
      { driverId: 'max_verstappen', code: 'VER', color: '#1E41FF' },
      { driverId: 'norris', code: 'NOR', color: '#FF8000' }
    ];
    env.exports.renderLapDriverFilters(drivers);

    const container = env.elements['lapDriverTogglesContainer'];
    assert.strictEqual(container.children.length, 2);

    const p1 = container.children[0];
    assert.strictEqual(p1.id, 'lapDriverPill_max_verstappen');
    assert.strictEqual(p1.classList.contains('active'), true);
    assert.ok(p1.innerHTML.includes('VER'));
  });

  test('toggleLapDriverFilter toggles visibility, updates dataset hidden state, and re-renders', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    env.exports.renderLapPositionChart(chartData);
    env.exports.renderLapDriverFilters(chartData.drivers);

    // Initial state: visible
    assert.strictEqual(env.exports.lapChartState.driverVisibility['max_verstappen'], undefined);

    // Toggle off
    env.exports.toggleLapDriverFilter('max_verstappen');
    assert.strictEqual(env.exports.lapChartState.driverVisibility['max_verstappen'], false);
    const ds = env.exports.lapChartState.chartInstance.data.datasets.find(d => d.driverId === 'max_verstappen');
    assert.strictEqual(ds.hidden, true);
    assert.strictEqual(env.exports.lapChartState.chartInstance.updated, true);

    // Toggle on
    env.exports.toggleLapDriverFilter('max_verstappen');
    assert.strictEqual(env.exports.lapChartState.driverVisibility['max_verstappen'], true);
    assert.strictEqual(ds.hidden, false);
  });

  test('setLapDriverFilterAll toggles all driver datasets and pills', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    env.exports.renderLapPositionChart(chartData);
    env.exports.renderLapDriverFilters(chartData.drivers);

    // Deselect all
    env.exports.setLapDriverFilterAll(false);
    env.exports.lapChartState.chartInstance.data.datasets.forEach(ds => {
      assert.strictEqual(ds.hidden, true);
      assert.strictEqual(env.exports.lapChartState.driverVisibility[ds.driverId], false);
    });

    // Select all
    env.exports.setLapDriverFilterAll(true);
    env.exports.lapChartState.chartInstance.data.datasets.forEach(ds => {
      assert.strictEqual(ds.hidden, false);
      assert.strictEqual(env.exports.lapChartState.driverVisibility[ds.driverId], true);
    });
  });

  test('setLapDriverFilterTopN enables top N drivers and hides remaining', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    env.exports.renderLapPositionChart(chartData);
    env.exports.renderLapDriverFilters(chartData.drivers);

    env.exports.setLapDriverFilterTopN(10);
    env.exports.lapChartState.chartInstance.data.datasets.forEach((ds, idx) => {
      if (idx < 10) {
        assert.strictEqual(ds.hidden, false);
        assert.strictEqual(env.exports.lapChartState.driverVisibility[ds.driverId], true);
      } else {
        assert.strictEqual(ds.hidden, true);
        assert.strictEqual(env.exports.lapChartState.driverVisibility[ds.driverId], false);
      }
    });
  });
});

describe('Issue #14: Season Leaderboard & Round Breakdown UI', () => {
  test('renderSeasonLapsLedLeaderboard populates leader card and table rows', () => {
    const env = createTestEnv();
    const fb = env.exports.SEASON_LAPS_LED_FALLBACK_2024;
    env.exports.renderSeasonLapsLedLeaderboard(fb);

    assert.strictEqual(env.elements['lapsLedTopDriverName'].textContent, 'Max Verstappen');
    assert.strictEqual(env.elements['lapsLedTopDriverCount'].textContent, '448 Laps Led (31.1%)');

    const tbody = env.elements['seasonLapsLedTableBody'];
    assert.strictEqual(tbody.children.length, 7);
    assert.ok(tbody.children[0].innerHTML.includes('Max Verstappen'));
    assert.ok(tbody.children[0].innerHTML.includes('448'));
    assert.ok(tbody.children[0].innerHTML.includes('31.1%'));
  });

  test('renderLapRoundBreakdown generates stint pills and round breakdown table', () => {
    const env = createTestEnv();
    const laps = createSampleLapsData();
    const results = createSampleRaceResults();

    env.exports.renderLapRoundBreakdown(laps, results);

    const timeline = env.elements['roundLeadTimeline'];
    // Stints: VER (L1-2), NOR (L3-4), VER (L5) -> 3 stints
    assert.strictEqual(timeline.children.length, 3);
    assert.ok(timeline.children[0].innerHTML.includes('VER: L1–2 (2 laps)'));
    assert.ok(timeline.children[1].innerHTML.includes('NOR: L3–4 (2 laps)'));
    assert.ok(timeline.children[2].innerHTML.includes('VER: L5–5 (1 laps)'));

    const tbody = env.elements['roundLapsLedTableBody'];
    assert.strictEqual(tbody.children.length, 2); // VER (3 laps) and NOR (2 laps)
    assert.ok(tbody.children[0].innerHTML.includes('3'));
    assert.ok(tbody.children[1].innerHTML.includes('2'));
  });

  test('populateLapRoundSelector populates dropdown options with race names', () => {
    const env = createTestEnv();
    const rounds = [
      { round: '1', raceName: 'Bahrain Grand Prix' },
      { round: '2', raceName: 'Saudi Arabian Grand Prix' }
    ];

    env.exports.populateLapRoundSelector(rounds, '2');
    const select = env.elements['lapRoundSelect'];
    assert.strictEqual(select.children.length, 2);
    assert.strictEqual(select.children[0].value, '1');
    assert.strictEqual(select.children[0].textContent, 'Round 1 - Bahrain Grand Prix');
    assert.strictEqual(select.children[1].value, '2');
    assert.strictEqual(select.children[1].selected, true);
  });
});

describe('Issue #14: Jolpica API Integration, Caching, & Error Handling (loadLapTelemetry)', () => {
  test('loadLapTelemetry loads from localStorage cache when available', async () => {
    const env = createTestEnv();
    const cachedLaps = createSampleLapsData();
    const cachedResults = createSampleRaceResults();
    env.storage.setItem('f1_laps_2024_1', JSON.stringify(cachedLaps));
    env.storage.setItem('f1_results_2024', JSON.stringify(cachedResults));

    const state = await env.exports.loadLapTelemetry('2024', '1', false);
    assert.strictEqual(state.season, '2024');
    assert.strictEqual(state.round, '1');
    assert.deepEqual(toPlain(state.lapsData), toPlain(cachedLaps));
    assert.strictEqual(env.elements['lapCacheBadge'].textContent, '⚡ Cached Telemetry');
  });

  test('loadLapTelemetry fetches live data on cache miss and populates localStorage', async () => {
    const sampleResults = createSampleRaceResults();
    const sampleLaps = createSampleLapsData();

    const customFetch = async (url) => {
      if (url.includes('results.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: { RaceTable: { Races: sampleResults } }
          })
        };
      }
      if (url.includes('laps.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              total: '5',
              limit: '2000',
              RaceTable: { Races: [{ Laps: sampleLaps }] }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const env = createTestEnv(customFetch);
    const state = await env.exports.loadLapTelemetry('2024', '1', true);

    assert.strictEqual(state.isLoading, false);
    assert.strictEqual(env.elements['lapCacheBadge'].textContent, '⚡ Live Telemetry');
    assert.ok(env.storage.getItem('f1_results_2024'));
    assert.ok(env.storage.getItem('f1_laps_2024_1'));
    assert.strictEqual(env.elements['lapChartTotalLapsBadge'].textContent, '5 Laps');
  });

  test('loadLapTelemetry falls back gracefully on network error with offline badge', async () => {
    const customFetch = async () => {
      throw new Error('Network unreachable');
    };

    const env = createTestEnv(customFetch);
    const state = await env.exports.loadLapTelemetry('2024', '1', true);

    assert.strictEqual(state.isLoading, false);
    assert.strictEqual(env.elements['lapCacheBadge'].textContent, '⚠️ Live Telemetry Offline');
    assert.strictEqual(env.elements['lapChartTotalLapsBadge'].textContent, '57 Laps');
    assert.strictEqual(env.elements['lapChartWinnerBadge'].textContent, 'Winner: Max Verstappen');
  });

  test('onLapRoundChange and onLapSeasonChange update state and trigger loading', () => {
    const env = createTestEnv();
    env.exports.onLapRoundChange('3');
    assert.strictEqual(env.exports.lapChartState.round, '3');

    env.exports.onLapSeasonChange('2023');
    assert.strictEqual(env.exports.lapChartState.season, '2023');
    assert.strictEqual(env.exports.lapChartState.round, '1');
  });

  test('refreshLapData reloads telemetry with forceRefresh=true', () => {
    const env = createTestEnv();
    env.exports.refreshLapData();
    assert.strictEqual(env.exports.lapChartState.season, '2024');
    assert.strictEqual(env.exports.lapChartState.round, '1');
  });
});

describe('Issue #14: Main Navigation Tab Switching & Responsive Layout', () => {
  test('switchMainTab("lap-chart") displays lap chart section and hides other tabs', () => {
    const env = createTestEnv();
    env.exports.switchMainTab('lap-chart');

    assert.strictEqual(env.elements['lap-chart-section'].style.display, 'block');
    assert.strictEqual(env.elements['finishing-gap-section'].style.display, 'none');
    assert.strictEqual(env.elements['circuit-profiler-section'].style.display, 'none');
    assert.strictEqual(env.elements['tabBtnLapChart'].classList.contains('active'), true);
  });

  test('switchMainTab to other tab hides lap chart section', () => {
    const env = createTestEnv();
    env.exports.switchMainTab('profiler');

    assert.strictEqual(env.elements['lap-chart-section'].style.display, 'none');
    assert.strictEqual(env.elements['circuit-profiler-section'].style.display, 'block');
    assert.strictEqual(env.elements['tabBtnLapChart'].classList.contains('active'), false);
  });

  test('switchMainTab and window resize trigger lap chart resize safely', () => {
    const env = createTestEnv();
    const chartData = env.exports.LAP_CHART_FALLBACK_2024;
    env.exports.renderLapPositionChart(chartData);

    env.exports.switchMainTab('lap-chart');
    assert.strictEqual(env.exports.lapChartState.chartInstance.resized, true);
  });

  test('DOMContentLoaded listener triggers loadLapTelemetry', () => {
    const env = createTestEnv();
    const domLoadedFns = env.listeners['DOMContentLoaded'] || [];
    assert.ok(domLoadedFns.length > 0);
    // Execute listener without error
    assert.doesNotThrow(() => {
      domLoadedFns.forEach(fn => fn());
    });
  });

  test('Real DOM markup verification in index.html', () => {
    const indexPath = path.join(__dirname, '..', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    const requiredIds = [
      'lap-chart-section',
      'lapSeasonSelect',
      'lapRoundSelect',
      'lapCacheBadge',
      'btnLapRefresh',
      'btnLapSelectAll',
      'btnLapDeselectAll',
      'btnLapTop10',
      'lapDriverTogglesContainer',
      'lapChartVenueTitle',
      'lapChartVenueSubtitle',
      'lapChartTotalLapsBadge',
      'lapChartWinnerBadge',
      'lapChartRetirementsBadge',
      'lapPositionChart',
      'seasonLapsLedCard',
      'lapsLedTopLeaderHighlight',
      'lapsLedTopDriverName',
      'lapsLedTopDriverCount',
      'seasonLapsLedTable',
      'seasonLapsLedTableBody',
      'roundLapsLedCard',
      'roundLapsLedTitle',
      'roundLapsLedSubtitle',
      'roundLeadTimeline',
      'roundLapsLedTable',
      'roundLapsLedTableBody',
      'tabBtnLapChart'
    ];

    requiredIds.forEach(id => {
      const regex = new RegExp(`id=["']${id}["']`);
      assert.ok(regex.test(html), `Missing #${id} in index.html markup`);
    });

    // Check for responsive CSS classes
    assert.ok(html.includes('.lap-chart-section'));
    assert.ok(html.includes('.lap-driver-pill'));
    assert.ok(html.includes('.lap-summary-grid'));
    assert.ok(html.includes('.stint-pill'));
    assert.ok(html.includes('.laps-led-share-bar'));
  });
});
