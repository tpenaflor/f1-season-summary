const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const tabButtons = [];
  const listeners = {};

  function createMockElement(id, tagName = 'div') {
    return {
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

  const tabIds = [
    'tabBtnAll',
    'tabBtnLapChart',
    'tabBtnFinishingGap',
    'tabBtnProfiler',
    'tabBtnConstructors',
    'tabBtnSprint',
    'tabBtnClinch',
    'tabBtnPitStops',
    'tabBtnReliability',
    'tabBtnTelemetry',
    'tabBtnProgression',
    'tabBtnResults'
  ];
  tabIds.forEach(id => {
    const tabEl = getOrCreateEl(id);
    if (id === 'tabBtnAll') tabEl.classList.add('active');
    tabButtons.push(tabEl);
  });

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
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
      return createMockElement('created_' + tag, tag);
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
    tabButtons
  };
}

// Sample race telemetry data for testing metrics calculation
function createSampleRaceData() {
  return [
    {
      round: '1',
      raceName: 'Bahrain Grand Prix',
      Results: [
        {
          number: '1',
          position: '1',
          laps: '57',
          status: 'Finished',
          Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          number: '11',
          position: '2',
          laps: '57',
          status: '+1.500',
          Driver: { driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          number: '4',
          position: '3',
          laps: '57',
          status: 'Finished',
          Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          number: '81',
          position: '4',
          laps: '56',
          status: '+1 Lap',
          Driver: { driverId: 'piastri', code: 'PIA', givenName: 'Oscar', familyName: 'Piastri' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          number: '16',
          position: '5',
          laps: '56',
          status: '+1 Lap',
          Driver: { driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          number: '55',
          position: '6',
          laps: '30',
          status: 'Engine',
          Driver: { driverId: 'sainz', code: 'SAI', givenName: 'Carlos', familyName: 'Sainz' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          number: '38',
          position: '7',
          laps: '56',
          status: '+1 Lap',
          Driver: { driverId: 'bearman', code: 'BEA', givenName: 'Oliver', familyName: 'Bearman' },
          Constructor: { constructorId: 'haas', name: 'Haas' }
        }
      ]
    },
    {
      round: '2',
      raceName: 'Saudi Arabian Grand Prix',
      Results: [
        {
          number: '1',
          position: '1',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          number: '11',
          position: '2',
          laps: '10',
          status: 'Collision',
          Driver: { driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          number: '4',
          position: '3',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          number: '81',
          position: '4',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'piastri', code: 'PIA', givenName: 'Oscar', familyName: 'Piastri' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          number: '16',
          position: '5',
          laps: '50',
          status: 'Finished',
          Driver: { driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          number: '55',
          position: '6',
          laps: '45',
          status: 'Spun off',
          Driver: { driverId: 'sainz', code: 'SAI', givenName: 'Carlos', familyName: 'Sainz' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          number: '27',
          position: '7',
          laps: '25',
          status: 'Disqualified',
          Driver: { driverId: 'hulkenberg', code: 'HUL', givenName: 'Nico', familyName: 'Hulkenberg' },
          Constructor: { constructorId: 'haas', name: 'Haas' }
        }
      ]
    },
    {
      round: '3',
      raceName: 'Australian Grand Prix',
      Results: [
        {
          number: '1',
          position: '1',
          laps: '58',
          status: 'Finished',
          Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          number: '11',
          position: '2',
          laps: '58',
          status: 'Finished',
          Driver: { driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez' },
          Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
        },
        {
          number: '4',
          position: '3',
          laps: '58',
          status: 'Finished',
          Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          number: '81',
          position: '4',
          laps: '58',
          status: 'Finished',
          Driver: { driverId: 'piastri', code: 'PIA', givenName: 'Oscar', familyName: 'Piastri' },
          Constructor: { constructorId: 'mclaren', name: 'McLaren' }
        },
        {
          number: '16',
          position: '5',
          laps: '12',
          status: 'Gearbox',
          Driver: { driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          number: '55',
          position: '6',
          laps: '58',
          status: 'Finished',
          Driver: { driverId: 'sainz', code: 'SAI', givenName: 'Carlos', familyName: 'Sainz' },
          Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
        },
        {
          number: '27',
          position: '7',
          laps: '57',
          status: '+1 Lap',
          Driver: { driverId: 'hulkenberg', code: 'HUL', givenName: 'Nico', familyName: 'Hulkenberg' },
          Constructor: { constructorId: 'haas', name: 'Haas' }
        }
      ]
    }
  ];
}

describe('Issue #12: Module Exports & State Initialization', () => {
  test('exports all required reliability functions, constants, and state objects', () => {
    const { exports: f1App } = createTestEnv();

    assert.equal(typeof f1App.categorizeReliabilityStatus, 'function');
    assert.equal(typeof f1App.categorizeStatus, 'function');
    assert.equal(typeof f1App.computeReliabilityMetrics, 'function');
    assert.equal(typeof f1App.loadReliabilityData, 'function');
    assert.equal(typeof f1App.onReliabilitySeasonChange, 'function');
    assert.equal(typeof f1App.refreshReliabilityData, 'function');
    assert.equal(typeof f1App.setReliabilityViewScope, 'function');
    assert.equal(typeof f1App.setReliabilityReserveFilter, 'function');
    assert.equal(typeof f1App.toggleReliabilityReserveFilter, 'function');
    assert.equal(typeof f1App.renderReliabilityView, 'function');
    assert.equal(typeof f1App.renderReliabilityKpis, 'function');
    assert.equal(typeof f1App.renderReliabilityChart, 'function');
    assert.equal(typeof f1App.renderReliabilityTable, 'function');
    assert.equal(typeof f1App.fetchSeasonStatus, 'function');

    assert.equal(typeof f1App.RELIABILITY_BUCKETS, 'object');
    assert.equal(typeof f1App.RELIABILITY_FALLBACK_2024, 'object');
    assert.equal(typeof f1App.reliabilityState, 'object');
  });

  test('reliabilityState initializes with correct default configuration', () => {
    const { exports: f1App } = createTestEnv();

    assert.equal(f1App.reliabilityState.season, '2024');
    assert.equal(f1App.reliabilityState.viewScope, 'constructors');
    assert.equal(f1App.reliabilityState.excludeReserves, false);
  });

  test('RELIABILITY_BUCKETS defines all 4 required standardized failure buckets', () => {
    const { exports: f1App } = createTestEnv();
    const buckets = f1App.RELIABILITY_BUCKETS;

    assert.equal(buckets.FINISHED, 'Finished/Classified');
    assert.equal(buckets.MECHANICAL, 'Mechanical');
    assert.equal(buckets.INCIDENT, 'Incident');
    assert.equal(buckets.TECHNICAL, 'Technical/Operational/DNS/DSQ');
  });
});

describe('Issue #12 Requirement 1: Ergast/Jolpica Status Categorization into 4 Buckets', () => {
  test('maps Finished and classified lap deficits (+N Laps) to Finished/Classified', () => {
    const { exports: f1App } = createTestEnv();
    const cat = f1App.categorizeReliabilityStatus;

    assert.equal(cat('Finished'), 'Finished/Classified');
    assert.equal(cat('finished'), 'Finished/Classified');
    assert.equal(cat('+1 Lap'), 'Finished/Classified');
    assert.equal(cat('+2 Laps'), 'Finished/Classified');
    assert.equal(cat('+10 Laps'), 'Finished/Classified');
    assert.equal(cat('+26 Laps'), 'Finished/Classified');
    assert.equal(cat('Classified'), 'Finished/Classified');
  });

  test('maps mechanical failures (Engine, Gearbox, Hydraulics, Brakes, Suspension, etc.) to Mechanical', () => {
    const { exports: f1App } = createTestEnv();
    const cat = f1App.categorizeReliabilityStatus;

    assert.equal(cat('Engine'), 'Mechanical');
    assert.equal(cat('Engine fire'), 'Mechanical');
    assert.equal(cat('Gearbox'), 'Mechanical');
    assert.equal(cat('Transmission'), 'Mechanical');
    assert.equal(cat('Clutch'), 'Mechanical');
    assert.equal(cat('Hydraulics'), 'Mechanical');
    assert.equal(cat('Electrical'), 'Mechanical');
    assert.equal(cat('Electronics'), 'Mechanical');
    assert.equal(cat('Radiator'), 'Mechanical');
    assert.equal(cat('Suspension'), 'Mechanical');
    assert.equal(cat('Brakes'), 'Mechanical');
    assert.equal(cat('Brake duct'), 'Mechanical');
    assert.equal(cat('Differential'), 'Mechanical');
    assert.equal(cat('Overheating'), 'Mechanical');
    assert.equal(cat('Mechanical'), 'Mechanical');
    assert.equal(cat('Tyre'), 'Mechanical');
    assert.equal(cat('Puncture'), 'Mechanical');
    assert.equal(cat('Driveshaft'), 'Mechanical');
    assert.equal(cat('Halfshaft'), 'Mechanical');
    assert.equal(cat('Oil pressure'), 'Mechanical');
    assert.equal(cat('Water pressure'), 'Mechanical');
    assert.equal(cat('Fuel pressure'), 'Mechanical');
    assert.equal(cat('Oil leak'), 'Mechanical');
    assert.equal(cat('Water leak'), 'Mechanical');
    assert.equal(cat('Fuel leak'), 'Mechanical');
    assert.equal(cat('Fuel pump'), 'Mechanical');
    assert.equal(cat('Throttle'), 'Mechanical');
    assert.equal(cat('Steering'), 'Mechanical');
    assert.equal(cat('Power Unit'), 'Mechanical');
    assert.equal(cat('Power loss'), 'Mechanical');
    assert.equal(cat('ERS'), 'Mechanical');
    assert.equal(cat('Battery'), 'Mechanical');
    assert.equal(cat('Exhaust'), 'Mechanical');
    assert.equal(cat('Turbo'), 'Mechanical');
    assert.equal(cat('Vibration'), 'Mechanical');
    assert.equal(cat('Ignition'), 'Mechanical');
    assert.equal(cat('Wheel'), 'Mechanical');
    assert.equal(cat('Wheel nut'), 'Mechanical');
    assert.equal(cat('Broken wing'), 'Mechanical');
  });

  test('maps accidents, collisions, spins, and track incidents to Incident', () => {
    const { exports: f1App } = createTestEnv();
    const cat = f1App.categorizeReliabilityStatus;

    assert.equal(cat('Accident'), 'Incident');
    assert.equal(cat('Fatal accident'), 'Incident');
    assert.equal(cat('Collision'), 'Incident');
    assert.equal(cat('Collision damage'), 'Incident');
    assert.equal(cat('Spun off'), 'Incident');
    assert.equal(cat('Spin'), 'Incident');
    assert.equal(cat('Crash'), 'Incident');
    assert.equal(cat('Debris'), 'Incident');
    assert.equal(cat('Off track'), 'Incident');
    assert.equal(cat('Damage'), 'Incident');
  });

  test('maps disqualifications, withdrawals, illness, and technical exclusions to Technical/Operational/DNS/DSQ', () => {
    const { exports: f1App } = createTestEnv();
    const cat = f1App.categorizeReliabilityStatus;

    assert.equal(cat('Disqualified'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('DSQ'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Excluded'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Did not qualify'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Failed to qualify'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Did not prequalify'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Not classified'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Retired'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Withdrew'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Driver unwell'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Illness'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Injury'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Underweight'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('107% Rule'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('DNS'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Did not start'), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Out of fuel'), 'Technical/Operational/DNS/DSQ');
  });

  test('handles null, undefined, empty, and unusual status strings safely', () => {
    const { exports: f1App } = createTestEnv();
    const cat = f1App.categorizeReliabilityStatus;

    assert.equal(cat(null), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat(undefined), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat(''), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('   '), 'Technical/Operational/DNS/DSQ');
    assert.equal(cat('Unknown Reason'), 'Technical/Operational/DNS/DSQ');
  });
});

describe('Issue #12 Requirement 3: Metrics Engine & Lap Tabulation (computeReliabilityMetrics)', () => {
  test('falls back to RELIABILITY_FALLBACK_2024 when empty results are passed for 2024', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeReliabilityMetrics([], { season: '2024' });

    assert.ok(metrics);
    assert.equal(metrics.season, '2024');
    assert.ok(metrics.constructors.length > 0);
    assert.ok(metrics.drivers.length > 0);
  });

  test('accurately aggregates constructor entries, classified finishes, mechanical, and incident DNFs', () => {
    const { exports: f1App } = createTestEnv();
    const sampleRaces = createSampleRaceData();
    const metrics = f1App.computeReliabilityMetrics(sampleRaces, { season: '2024' });

    // McLaren: 6 entries (Norris: 3, Piastri: 3), all 6 finished
    const mclaren = metrics.constructors.find(c => c.id === 'mclaren');
    assert.ok(mclaren);
    assert.equal(mclaren.totalEntries, 6);
    assert.equal(mclaren.finished, 6);
    assert.equal(mclaren.mechanical, 0);
    assert.equal(mclaren.incident, 0);
    assert.equal(mclaren.technical, 0);
    assert.equal(mclaren.finishedPct, 100);

    // Red Bull: 6 entries (Verstappen: 3 finishes; Perez: 2 finishes, 1 collision)
    const redBull = metrics.constructors.find(c => c.id === 'red_bull');
    assert.ok(redBull);
    assert.equal(redBull.totalEntries, 6);
    assert.equal(redBull.finished, 5);
    assert.equal(redBull.incident, 1);
    assert.equal(redBull.mechanical, 0);

    // Ferrari: 6 entries (Sainz: 1 engine, 1 spun off, 1 finish; Leclerc: 2 finishes, 1 gearbox)
    const ferrari = metrics.constructors.find(c => c.id === 'ferrari');
    assert.ok(ferrari);
    assert.equal(ferrari.totalEntries, 6);
    assert.equal(ferrari.finished, 3);
    assert.equal(ferrari.mechanical, 2); // Sainz R1 Engine + Leclerc R3 Gearbox
    assert.equal(ferrari.incident, 1);   // Sainz R2 Spun off
    assert.equal(ferrari.technical, 0);
  });

  test('accurately tabulates laps completed vs total possible season laps and calculates lapCompletionPct', () => {
    const { exports: f1App } = createTestEnv();
    const sampleRaces = createSampleRaceData();
    const metrics = f1App.computeReliabilityMetrics(sampleRaces, { season: '2024' });

    // Round 1 max laps = 57, Round 2 max laps = 50, Round 3 max laps = 58
    // Total season calendar laps = 57 + 50 + 58 = 165
    assert.equal(metrics.totalSeasonLapsPossible, 165);

    // McLaren: 2 cars in 3 races -> possible = 2 * (57 + 50 + 58) = 330 laps
    // Laps completed:
    // R1: Norris 57 + Piastri 56 = 113
    // R2: Norris 50 + Piastri 50 = 100
    // R3: Norris 58 + Piastri 58 = 116
    // Total done = 113 + 100 + 116 = 329
    const mclaren = metrics.constructors.find(c => c.id === 'mclaren');
    assert.equal(mclaren.possibleLaps, 330);
    assert.equal(mclaren.lapsCompleted, 329);
    const expectedPct = (329 / 330) * 100;
    assert.equal(mclaren.lapCompletionPct.toFixed(2), expectedPct.toFixed(2));
  });

  test('accurately aggregates driver metrics and tags reserve drivers (<3 entries)', () => {
    const { exports: f1App } = createTestEnv();
    const sampleRaces = createSampleRaceData();
    const metrics = f1App.computeReliabilityMetrics(sampleRaces, { season: '2024' });

    // Verstappen: 3 entries -> isReserve: false
    const ver = metrics.drivers.find(d => d.id === 'max_verstappen');
    assert.ok(ver);
    assert.equal(ver.totalEntries, 3);
    assert.equal(ver.isReserve, false);
    assert.equal(ver.lapsCompleted, 57 + 50 + 58);
    assert.equal(ver.lapCompletionPct, 100);

    // Bearman: entered only Round 1 (1 entry) -> isReserve: true
    const bea = metrics.drivers.find(d => d.id === 'bearman');
    assert.ok(bea);
    assert.equal(bea.totalEntries, 1);
    assert.equal(bea.isReserve, true);
    assert.equal(bea.lapsCompleted, 56);
    assert.equal(bea.possibleLaps, 57);

    // Hulkenberg: entered Round 2 and Round 3 (2 entries) -> isReserve: true (<3 entries)
    const hul = metrics.drivers.find(d => d.id === 'hulkenberg');
    assert.ok(hul);
    assert.equal(hul.totalEntries, 2);
    assert.equal(hul.isReserve, true);
    assert.equal(hul.technical, 1); // Disqualified in R2
  });

  test('stores failure events with round, race name, status, bucket, and lap info', () => {
    const { exports: f1App } = createTestEnv();
    const sampleRaces = createSampleRaceData();
    const metrics = f1App.computeReliabilityMetrics(sampleRaces, { season: '2024' });

    const ferrari = metrics.constructors.find(c => c.id === 'ferrari');
    assert.equal(ferrari.failures.length, 3);

    const f1 = ferrari.failures[0];
    assert.equal(f1.round, '1');
    assert.equal(f1.raceName, 'Bahrain Grand Prix');
    assert.equal(f1.driverCode, 'SAI');
    assert.equal(f1.status, 'Engine');
    assert.equal(f1.bucket, 'Mechanical');
    assert.equal(f1.laps, 30);
  });
});

describe('Issue #12 Requirement 2: Horizontal 100% Stacked Bar Chart & Scope/Reserve Filters', () => {
  test('renderReliabilityChart initializes Chart.js with horizontal 100% stacked bar configuration', () => {
    const env = createTestEnv();
    const metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });

    env.exports.renderReliabilityChart(metrics);

    assert.ok(env.chartInstances.length > 0);
    const chart = env.chartInstances[env.chartInstances.length - 1];

    assert.equal(chart.type, 'bar');
    assert.equal(chart.options.indexAxis, 'y');
    assert.equal(chart.options.scales.x.stacked, true);
    assert.equal(chart.options.scales.y.stacked, true);
    assert.equal(chart.options.scales.x.min, 0);
    assert.equal(chart.options.scales.x.max, 100);
    assert.equal(chart.data.datasets.length, 4);

    const dsLabels = JSON.parse(JSON.stringify(chart.data.datasets.map(d => d.label)));
    assert.deepEqual(dsLabels, [
      'Finished/Classified',
      'Mechanical',
      'Incident',
      'Technical/Operational/DNS/DSQ'
    ]);
  });

  test('setReliabilityViewScope toggles between Constructors and Drivers and updates UI elements', () => {
    const env = createTestEnv();
    env.exports.reliabilityState.metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });

    // Switch to Drivers
    env.exports.setReliabilityViewScope('drivers');
    assert.equal(env.exports.reliabilityState.viewScope, 'drivers');
    assert.equal(env.elements['relPillScopeDrivers'].classList.contains('active'), true);
    assert.equal(env.elements['relPillScopeConstructors'].classList.contains('active'), false);
    assert.equal(env.elements['reliabilityReserveFilterGroup'].style.display, 'flex');
    assert.equal(env.elements['reliabilityColName'].textContent, 'Driver');

    // Switch back to Constructors
    env.exports.setReliabilityViewScope('constructors');
    assert.equal(env.exports.reliabilityState.viewScope, 'constructors');
    assert.equal(env.elements['relPillScopeConstructors'].classList.contains('active'), true);
    assert.equal(env.elements['relPillScopeDrivers'].classList.contains('active'), false);
    assert.equal(env.elements['reliabilityReserveFilterGroup'].style.display, 'none');
    assert.equal(env.elements['reliabilityColName'].textContent, 'Constructor');
  });

  test('setReliabilityReserveFilter filters out reserve drivers (<3 entries) when activated', () => {
    const env = createTestEnv();
    const metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });
    env.exports.reliabilityState.metrics = metrics;
    env.exports.setReliabilityViewScope('drivers');

    // Initially all drivers are included (including Bearman with 1 entry, Hulkenberg with 2 entries)
    env.exports.setReliabilityReserveFilter(false);
    assert.equal(env.exports.reliabilityState.excludeReserves, false);
    const chartAll = env.chartInstances[env.chartInstances.length - 1];
    const hasBearmanAll = chartAll.data.labels.some(l => l.includes('Bearman'));
    assert.equal(hasBearmanAll, true);

    // Exclude reserve drivers (<3 entries)
    env.exports.setReliabilityReserveFilter(true);
    assert.equal(env.exports.reliabilityState.excludeReserves, true);
    assert.equal(env.elements['relPillReserveExclude'].classList.contains('active'), true);
    assert.equal(env.elements['relPillReserveAll'].classList.contains('active'), false);

    const chartFiltered = env.chartInstances[env.chartInstances.length - 1];
    const hasBearmanFiltered = chartFiltered.data.labels.some(l => l.includes('Bearman'));
    assert.equal(hasBearmanFiltered, false);
    const hasHulkenbergFiltered = chartFiltered.data.labels.some(l => l.includes('Hulkenberg'));
    assert.equal(hasHulkenbergFiltered, false);

    // Regular drivers remain
    const hasVerstappen = chartFiltered.data.labels.some(l => l.includes('Verstappen'));
    assert.equal(hasVerstappen, true);
  });

  test('toggleReliabilityReserveFilter alternates reserve filter state', () => {
    const env = createTestEnv();
    env.exports.reliabilityState.metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });
    env.exports.setReliabilityViewScope('drivers');

    assert.equal(env.exports.reliabilityState.excludeReserves, false);
    env.exports.toggleReliabilityReserveFilter();
    assert.equal(env.exports.reliabilityState.excludeReserves, true);
    env.exports.toggleReliabilityReserveFilter();
    assert.equal(env.exports.reliabilityState.excludeReserves, false);
  });

  test('renderReliabilityChart destroys previous chart instance before re-creating', () => {
    const env = createTestEnv();
    const metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });

    env.exports.renderReliabilityChart(metrics);
    const firstChart = env.chartInstances[0];
    assert.equal(firstChart.destroyed, false);

    env.exports.renderReliabilityChart(metrics);
    assert.equal(firstChart.destroyed, true);
    assert.equal(env.chartInstances.length, 2);
  });
});

describe('Issue #12 Requirement 4: Tooltips Listing Specific GP Rounds for Retirements', () => {
  test('tooltip callbacks format competitor title, bucket percentage, and specific failure rounds', () => {
    const env = createTestEnv();
    const sampleRaces = createSampleRaceData();
    const metrics = env.exports.computeReliabilityMetrics(sampleRaces, { season: '2024' });

    env.exports.renderReliabilityChart(metrics);
    const chart = env.chartInstances[env.chartInstances.length - 1];
    const callbacks = chart.options.plugins.tooltip.callbacks;

    assert.equal(typeof callbacks.title, 'function');
    assert.equal(typeof callbacks.label, 'function');
    assert.equal(typeof callbacks.afterLabel, 'function');

    // Title callback returns label
    const title = callbacks.title([{ label: 'Ferrari' }]);
    assert.equal(title, 'Ferrari');

    // Find Ferrari index
    const ferrariIdx = chart.data.labels.indexOf('Ferrari');
    assert.ok(ferrariIdx >= 0);

    // Label callback for Mechanical dataset
    const mechCtx = {
      dataIndex: ferrariIdx,
      dataset: chart.data.datasets[1], // Mechanical dataset
      parsed: { x: 33.3 }
    };
    const labelText = callbacks.label(mechCtx);
    assert.ok(labelText.includes('Mechanical: 2 / 6 entries'));

    // AfterLabel callback for Mechanical dataset lists specific GP rounds and failures
    const afterLabelText = callbacks.afterLabel(mechCtx);
    assert.ok(afterLabelText.includes('R01 Bahrain Grand Prix [SAI]: Engine (Lap 30)'));
    assert.ok(afterLabelText.includes('R03 Australian Grand Prix [LEC]: Gearbox (Lap 12)'));

    // Finished dataset afterLabel shows classified finish summary
    const finCtx = {
      dataIndex: ferrariIdx,
      dataset: chart.data.datasets[0], // Finished dataset
      parsed: { x: 50.0 }
    };
    const finAfterLabel = callbacks.afterLabel(finCtx);
    assert.ok(finAfterLabel.includes('Classified finish rate: 50.0%'));
  });

  test('tooltip afterLabel displays clean message when competitor has zero retirements in bucket', () => {
    const env = createTestEnv();
    const sampleRaces = createSampleRaceData();
    const metrics = env.exports.computeReliabilityMetrics(sampleRaces, { season: '2024' });

    env.exports.renderReliabilityChart(metrics);
    const chart = env.chartInstances[env.chartInstances.length - 1];
    const callbacks = chart.options.plugins.tooltip.callbacks;

    // McLaren has 0 mechanical failures in sample data
    const mclarenIdx = chart.data.labels.indexOf('McLaren');
    const mechCtx = {
      dataIndex: mclarenIdx,
      dataset: chart.data.datasets[1], // Mechanical
      parsed: { x: 0 }
    };
    const afterLabel = callbacks.afterLabel(mechCtx);
    assert.ok(afterLabel.includes('No Mechanical retirements'));
  });
});

describe('Issue #12 Requirement 3: Table Rendering (renderReliabilityTable)', () => {
  test('renders table rows with ranks, competitor names, entries, finished, DNFs, and laps completed vs possible', () => {
    const env = createTestEnv();
    const metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });

    env.exports.renderReliabilityTable(metrics);
    const tbody = env.elements['reliabilityTableBody'].innerHTML;

    assert.ok(tbody.includes('McLaren'));
    assert.ok(tbody.includes('Ferrari'));
    assert.ok(tbody.includes('Red Bull Racing'));
    // Laps column format
    assert.ok(tbody.includes('329'));
    assert.ok(tbody.includes('/ 330'));
    // Percentage format
    assert.ok(tbody.includes('99.7%'));
    // Progress bar markup
    assert.ok(tbody.includes('rel-completion-bar'));
    assert.ok(tbody.includes('rel-completion-fill'));
  });

  test('renderReliabilityTable highlights mechanical, incident, and tech counts when >0', () => {
    const env = createTestEnv();
    const metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });

    env.exports.renderReliabilityTable(metrics);
    const tbody = env.elements['reliabilityTableBody'].innerHTML;

    // Ferrari has 2 mechanical failures
    assert.ok(tbody.includes('2 (33.3%)'));
    // Red Bull has 1 incident DNF
    assert.ok(tbody.includes('1 (16.7%)'));
  });

  test('renders empty state message when no items match filters', () => {
    const env = createTestEnv();
    env.exports.renderReliabilityTable({ constructors: [], drivers: [] });

    const tbody = env.elements['reliabilityTableBody'].innerHTML;
    assert.ok(tbody.includes('No reliability data available'));
  });
});

describe('Issue #12 KPI Summary Cards (renderReliabilityKpis)', () => {
  test('populates all 4 reliability KPI cards with overall season metrics', () => {
    const env = createTestEnv();
    const metrics = env.exports.computeReliabilityMetrics(createSampleRaceData(), { season: '2024' });

    env.exports.renderReliabilityKpis(metrics);

    assert.ok(env.elements['relKpiFinishedVal'].textContent.includes('%'));
    assert.ok(env.elements['relKpiFinishedSub'].textContent.includes('entries'));
    assert.ok(parseInt(env.elements['relKpiMechanicalVal'].textContent, 10) >= 0);
    assert.ok(parseInt(env.elements['relKpiIncidentsVal'].textContent, 10) >= 0);
    assert.ok(env.elements['relKpiLapsVal'].textContent.includes('%'));
    assert.ok(env.elements['relKpiLapsSub'].textContent.includes('laps'));
  });
});

describe('Issue #12: Main Navigation Tab Switching Integration (switchMainTab)', () => {
  test('switchMainTab("reliability") displays reliability section and hides all other sections', () => {
    const env = createTestEnv();

    env.exports.switchMainTab('reliability');

    assert.equal(env.elements['reliability-matrix-section'].style.display, 'block');
    assert.equal(env.elements['lap-chart-section'].style.display, 'none');
    assert.equal(env.elements['finishing-gap-section'].style.display, 'none');
    assert.equal(env.elements['circuit-profiler-section'].style.display, 'none');
    assert.equal(env.elements['constructor-atr-section'].style.display, 'none');
    assert.equal(env.elements['sprint-disparity-section'].style.display, 'none');
    assert.equal(env.elements['clinch-engine-section'].style.display, 'none');
    assert.equal(env.elements['pitstop-matrix-section'].style.display, 'none');
    assert.equal(env.elements['teammate-telemetry-section'].style.display, 'none');
    assert.equal(env.elements['tabBtnReliability'].classList.contains('active'), true);
    assert.equal(env.elements['tabBtnConstructors'].classList.contains('active'), false);
  });

  test('switchMainTab hides reliability section when navigating to another tab', () => {
    const env = createTestEnv();

    env.exports.switchMainTab('reliability');
    assert.equal(env.elements['reliability-matrix-section'].style.display, 'block');

    env.exports.switchMainTab('constructors');
    assert.equal(env.elements['reliability-matrix-section'].style.display, 'none');
    assert.equal(env.elements['constructor-atr-section'].style.display, 'block');
    assert.equal(env.elements['tabBtnReliability'].classList.contains('active'), false);
  });

  test('switchMainTab("all") displays reliability section alongside others', () => {
    const env = createTestEnv();

    env.exports.switchMainTab('all');

    assert.equal(env.elements['reliability-matrix-section'].style.display, 'block');
    assert.equal(env.elements['lap-chart-section'].style.display, 'block');
    assert.equal(env.elements['constructor-atr-section'].style.display, 'block');
    assert.equal(env.elements['tabBtnAll'].classList.contains('active'), true);
  });
});

describe('Issue #12: JOLPICA F1 API Integration & Fallback', () => {
  test('loadReliabilityData falls back to RELIABILITY_FALLBACK_2024 when API call fails or is empty', async () => {
    const failingFetch = async () => {
      throw new Error('HTTP 429 Too Many Requests');
    };
    const env = createTestEnv(failingFetch);

    const metrics = await env.exports.loadReliabilityData('2024', false);

    assert.ok(metrics);
    assert.equal(metrics.season, '2024');
    assert.ok(metrics.constructors.length > 0);
    assert.ok(metrics.drivers.length > 0);
  });

  test('loadReliabilityData caches results in localStorage and reads cached data', async () => {
    const env = createTestEnv();
    const fakeMetrics = {
      season: '2023',
      totalRaces: 22,
      totalEntries: 440,
      totalFinished: 400,
      totalMechanical: 20,
      totalIncident: 20,
      totalTechnical: 0,
      overallReliabilityPct: 90.9,
      constructors: [],
      drivers: []
    };
    env.storage.setItem('f1_reliability_2023', JSON.stringify(fakeMetrics));

    const metrics = await env.exports.loadReliabilityData('2023', false);
    assert.equal(metrics.season, '2023');
    assert.equal(metrics.totalRaces, 22);
  });

  test('onReliabilitySeasonChange updates season and triggers data loading', () => {
    const env = createTestEnv();

    env.exports.onReliabilitySeasonChange('2023');
    assert.equal(env.exports.reliabilityState.season, '2023');
  });

  test('refreshReliabilityData triggers force refresh', () => {
    const env = createTestEnv();
    env.elements['reliabilitySeasonSelect'].value = '2022';

    env.exports.refreshReliabilityData();
    assert.equal(env.exports.reliabilityState.season, '2022');
  });

  test('DOMContentLoaded triggers loadReliabilityData if dropdown is present', () => {
    const env = createTestEnv();
    env.elements['reliabilitySeasonSelect'].value = '2024';

    const domListener = env.listeners['DOMContentLoaded']?.[0];
    assert.ok(typeof domListener === 'function');
    domListener();

    assert.equal(env.exports.reliabilityState.season, '2024');
  });
});
