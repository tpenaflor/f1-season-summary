const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const profilerPills = [];
  const tabButtons = [];
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

  ['all', 'high_downforce', 'low_drag', 'balanced', 'high_deg'].forEach(arch => {
    const pill = createMockElement('pill_' + arch);
    pill['data-archetype'] = arch;
    pill.getAttribute = (k) => k === 'data-archetype' ? arch : null;
    if (arch === 'all') pill.classList.add('active');
    profilerPills.push(pill);
  });

  const tabIds = ['tabBtnAll', 'tabBtnProfiler', 'tabBtnConstructors', 'tabBtnSprint', 'tabBtnClinch', 'tabBtnPitStops', 'tabBtnTelemetry', 'tabBtnProgression', 'tabBtnResults'];
  tabIds.forEach(id => {
    const tabEl = getOrCreateEl(id);
    if (id === 'tabBtnAll') tabEl.classList.add('active');
    tabButtons.push(tabEl);
  });

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
      if (selector && selector.includes('profiler-pill')) {
        return profilerPills;
      }
      if (selector && selector.includes('tab-btn')) {
        return tabButtons;
      }
      if (selector && selector.includes('atr-battle-pill')) {
        return battlePills;
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => {
      return createMockElement('created_' + tag);
    }
  };

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
    profilerPills,
    tabButtons
  };
}

describe('Issue #16: Circuit Profiler Module Exports & Initial State', () => {
  test('exports all required profiler handlers, helpers, and state objects', () => {
    const { exports: f1App } = createTestEnv();

    assert.equal(typeof f1App.computeProfilerMetrics, 'function');
    assert.equal(typeof f1App.getCircuitArchetype, 'function');
    assert.equal(typeof f1App.CIRCUIT_ARCHETYPES, 'object');
    assert.equal(typeof f1App.circuitProfilerState, 'object');
    assert.equal(typeof f1App.setProfilerArchetypeFilter, 'function');
    assert.equal(typeof f1App.toggleProfilerTeam, 'function');
    assert.equal(typeof f1App.renderProfilerView, 'function');
    assert.equal(typeof f1App.renderProfilerKpis, 'function');
    assert.equal(typeof f1App.renderProfilerRadarChart, 'function');
    assert.equal(typeof f1App.renderProfilerDeltaMatrix, 'function');
    assert.equal(typeof f1App.renderProfilerFilteredStandings, 'function');
    assert.equal(typeof f1App.renderProfilerCircuitsList, 'function');
    assert.equal(typeof f1App.loadProfilerData, 'function');
    assert.equal(typeof f1App.onProfilerSeasonChange, 'function');
    assert.equal(typeof f1App.refreshProfilerData, 'function');
  });

  test('circuitProfilerState initializes with correct default configuration', () => {
    const { exports: f1App } = createTestEnv();
    const state = f1App.circuitProfilerState;

    assert.equal(state.season, '2024');
    assert.equal(state.activeArchetype, 'all');
    assert.ok(typeof state.hiddenTeams.has === 'function');
    assert.ok(typeof state.hiddenTeams.add === 'function');
    assert.equal(state.hiddenTeams.size, 0);
    assert.equal(state.isLoading, false);
  });
});

describe('Issue #16: Circuit Archetype Categorization (getCircuitArchetype & CIRCUIT_ARCHETYPES)', () => {
  test('CIRCUIT_ARCHETYPES defines 4 archetypes with required metadata properties', () => {
    const { exports: f1App } = createTestEnv();
    const archetypes = f1App.CIRCUIT_ARCHETYPES;

    const expectedKeys = ['high_downforce', 'low_drag', 'balanced', 'high_deg'];
    assert.deepEqual(Object.keys(archetypes), expectedKeys);

    expectedKeys.forEach(key => {
      const arch = archetypes[key];
      assert.equal(arch.id, key);
      assert.ok(typeof arch.name === 'string' && arch.name.length > 0);
      assert.ok(typeof arch.shortName === 'string' && arch.shortName.length > 0);
      assert.ok(typeof arch.color === 'string' && arch.color.startsWith('#'));
      assert.ok(typeof arch.tagClass === 'string');
      assert.ok(Array.isArray(arch.circuits) && arch.circuits.length > 0);
    });
  });

  test('categorizes High Downforce / Street venues correctly by circuitId', () => {
    const { exports: f1App } = createTestEnv();
    ['monaco', 'marina_bay', 'hungaroring', 'zandvoort'].forEach(cid => {
      assert.equal(f1App.getCircuitArchetype(cid), 'high_downforce', `Expected ${cid} to be high_downforce`);
    });
  });

  test('categorizes Low Drag / Power venues correctly by circuitId', () => {
    const { exports: f1App } = createTestEnv();
    ['monza', 'spa', 'baku', 'vegas'].forEach(cid => {
      assert.equal(f1App.getCircuitArchetype(cid), 'low_drag', `Expected ${cid} to be low_drag`);
    });
  });

  test('categorizes High Degradation venues correctly by circuitId', () => {
    const { exports: f1App } = createTestEnv();
    ['bahrain', 'suzuka', 'catalunya', 'silverstone', 'losail', 'shanghai', 'americas'].forEach(cid => {
      assert.equal(f1App.getCircuitArchetype(cid), 'high_deg', `Expected ${cid} to be high_deg`);
    });
  });

  test('categorizes Balanced Downforce venues correctly by circuitId', () => {
    const { exports: f1App } = createTestEnv();
    ['albert_park', 'red_bull_ring', 'imola', 'villeneuve', 'jeddah', 'miami', 'rodriguez', 'interlagos', 'yas_marina'].forEach(cid => {
      assert.equal(f1App.getCircuitArchetype(cid), 'balanced', `Expected ${cid} to be balanced`);
    });
  });

  test('falls back to raceName keyword matching when circuitId is unmapped', () => {
    const { exports: f1App } = createTestEnv();
    assert.equal(f1App.getCircuitArchetype('unknown_track', 'Grand Prix de Monaco'), 'high_downforce');
    assert.equal(f1App.getCircuitArchetype('custom_id', 'Singapore Grand Prix'), 'high_downforce');
    assert.equal(f1App.getCircuitArchetype('custom_id', 'Italian Grand Prix Monza'), 'low_drag');
    assert.equal(f1App.getCircuitArchetype('custom_id', 'Belgian Grand Prix Spa'), 'low_drag');
    assert.equal(f1App.getCircuitArchetype('custom_id', 'British Grand Prix Silverstone'), 'high_deg');
    assert.equal(f1App.getCircuitArchetype('custom_id', 'Japanese Grand Prix Suzuka'), 'high_deg');
    assert.equal(f1App.getCircuitArchetype('custom_id', 'Nonexistent Grand Prix'), 'balanced');
  });
});

describe('Issue #16: Profiler Metrics Engine (computeProfilerMetrics)', () => {
  const sampleRaceRounds = [
    {
      round: '1',
      raceName: 'Bahrain Grand Prix',
      Circuit: { circuitId: 'bahrain', circuitName: 'Bahrain International Circuit', Location: { locality: 'Sakhir', country: 'Bahrain' } },
      Results: [
        { position: '1', points: '25', Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' } },
        { position: '2', points: '18', Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Charles', familyName: 'Leclerc' } },
        { position: '3', points: '15', Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Lando', familyName: 'Norris' } }
      ]
    },
    {
      round: '2',
      raceName: 'Monaco Grand Prix',
      Circuit: { circuitId: 'monaco', circuitName: 'Circuit de Monaco', Location: { locality: 'Monte Carlo', country: 'Monaco' } },
      Results: [
        { position: '1', points: '25', Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Charles', familyName: 'Leclerc' } },
        { position: '2', points: '18', Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Lando', familyName: 'Norris' } },
        { position: '3', points: '15', Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' } }
      ]
    },
    {
      round: '3',
      raceName: 'Italian Grand Prix',
      Circuit: { circuitId: 'monza', circuitName: 'Autodromo Nazionale Monza', Location: { locality: 'Monza', country: 'Italy' } },
      Results: [
        { position: '1', points: '25', Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Charles', familyName: 'Leclerc' } },
        { position: '2', points: '18', Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Oscar', familyName: 'Piastri' } },
        { position: '6', points: '8', Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' } }
      ]
    },
    {
      round: '4',
      raceName: 'Australian Grand Prix',
      Circuit: { circuitId: 'albert_park', circuitName: 'Albert Park Circuit', Location: { locality: 'Melbourne', country: 'Australia' } },
      Results: [
        { position: '1', points: '25', Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Lando', familyName: 'Norris' } },
        { position: '2', points: '18', Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Carlos', familyName: 'Sainz' } },
        { position: '5', points: '10', Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Sergio', familyName: 'Perez' } }
      ]
    }
  ];

  const sampleQualRounds = [
    {
      round: '1',
      QualifyingResults: [
        { Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' }, Q3: '1:29.179' },
        { Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Charles', familyName: 'Leclerc' }, Q3: '1:29.407' },
        { Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Lando', familyName: 'Norris' }, Q3: '1:29.614' }
      ]
    },
    {
      round: '2',
      QualifyingResults: [
        { Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Charles', familyName: 'Leclerc' }, Q3: '1:10.270' },
        { Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Oscar', familyName: 'Piastri' }, Q3: '1:10.424' },
        { Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' }, Q3: '1:10.567' }
      ]
    },
    {
      round: '3',
      QualifyingResults: [
        { Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Lando', familyName: 'Norris' }, Q3: '1:19.327' },
        { Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Charles', familyName: 'Leclerc' }, Q3: '1:19.452' },
        { Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' }, Q3: '1:20.005' }
      ]
    },
    {
      round: '4',
      QualifyingResults: [
        { Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, Driver: { givenName: 'Max', familyName: 'Verstappen' }, Q3: '1:15.915' },
        { Constructor: { constructorId: 'ferrari', name: 'Ferrari' }, Driver: { givenName: 'Carlos', familyName: 'Sainz' }, Q3: '1:16.185' },
        { Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Driver: { givenName: 'Lando', familyName: 'Norris' }, Q3: '1:16.295' }
      ]
    }
  ];

  const sampleStandingsList = [
    { position: '1', points: '86', wins: '2', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
    { position: '2', points: '76', wins: '1', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
    { position: '3', points: '58', wins: '1', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } }
  ];

  test('falls back to CIRCUIT_PROFILER_FALLBACK_2024 when empty data is provided', () => {
    const { exports: f1App } = createTestEnv();
    const fallback = f1App.computeProfilerMetrics([], [], []);
    assert.ok(fallback.teams.length >= 10);
    assert.ok(fallback.circuits.length === 24);
    assert.ok(fallback.medians);
  });

  test('computes qualifying deltas (% to pole) across sessions accurately', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeProfilerMetrics(sampleRaceRounds, sampleQualRounds, sampleStandingsList);

    assert.equal(metrics.teams.length, 3);
    const ferrari = metrics.teams.find(t => t.constructorId === 'ferrari');
    const mclaren = metrics.teams.find(t => t.constructorId === 'mclaren');
    const redBull = metrics.teams.find(t => t.constructorId === 'red_bull');

    assert.ok(ferrari, 'Ferrari should exist in metrics');
    assert.ok(mclaren, 'McLaren should exist in metrics');
    assert.ok(redBull, 'Red Bull should exist in metrics');

    // On Monaco (high_downforce), Ferrari had pole (0.00% delta)
    assert.equal(ferrari.archetypes.high_downforce.avgQualDelta, 0.00);
    // On Bahrain (high_deg), Red Bull had pole (0.00% delta)
    assert.equal(redBull.archetypes.high_deg.avgQualDelta, 0.00);
    // On Monza (low_drag), McLaren had pole (0.00% delta)
    assert.equal(mclaren.archetypes.low_drag.avgQualDelta, 0.00);
  });

  test('accurately computes archetype points, wins, and podiums distribution', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeProfilerMetrics(sampleRaceRounds, sampleQualRounds, sampleStandingsList);

    const ferrari = metrics.teams.find(t => t.constructorId === 'ferrari');
    const mclaren = metrics.teams.find(t => t.constructorId === 'mclaren');
    const redBull = metrics.teams.find(t => t.constructorId === 'red_bull');

    // High Downforce (Monaco R2)
    assert.equal(ferrari.archetypes.high_downforce.points, 25);
    assert.equal(ferrari.archetypes.high_downforce.wins, 1);
    assert.equal(ferrari.archetypes.high_downforce.podiums, 1);
    assert.equal(mclaren.archetypes.high_downforce.points, 18);
    assert.equal(redBull.archetypes.high_downforce.points, 15);

    // Low Drag (Monza R3)
    assert.equal(ferrari.archetypes.low_drag.points, 25);
    assert.equal(ferrari.archetypes.low_drag.wins, 1);
    assert.equal(mclaren.archetypes.low_drag.points, 18);
    assert.equal(redBull.archetypes.low_drag.points, 8);
    assert.equal(redBull.archetypes.low_drag.podiums, 0);

    // High Deg (Bahrain R1)
    assert.equal(redBull.archetypes.high_deg.points, 25);
    assert.equal(redBull.archetypes.high_deg.wins, 1);
    assert.equal(ferrari.archetypes.high_deg.points, 18);
  });

  test('computes archetype medians across constructor pace', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeProfilerMetrics(sampleRaceRounds, sampleQualRounds, sampleStandingsList);

    assert.ok(metrics.medians, 'Medians object must be generated');
    assert.ok(typeof metrics.medians.high_downforce === 'number');
    assert.ok(typeof metrics.medians.low_drag === 'number');
    assert.ok(typeof metrics.medians.balanced === 'number');
    assert.ok(typeof metrics.medians.high_deg === 'number');
  });

  test('calculates normalized efficiency ratings clamped between 30 and 99', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeProfilerMetrics(sampleRaceRounds, sampleQualRounds, sampleStandingsList);

    metrics.teams.forEach(team => {
      ['high_downforce', 'low_drag', 'balanced', 'high_deg'].forEach(archKey => {
        const score = team.archetypes[archKey].score;
        assert.ok(score >= 30 && score <= 99, `Score ${score} for ${team.name} in ${archKey} must be in [30, 99]`);
      });
    });
  });

  test('calculates overall efficiency using harmonic mean across all 4 archetypes', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeProfilerMetrics(sampleRaceRounds, sampleQualRounds, sampleStandingsList);

    metrics.teams.forEach(team => {
      const s1 = team.archetypes.high_downforce.score;
      const s2 = team.archetypes.low_drag.score;
      const s3 = team.archetypes.balanced.score;
      const s4 = team.archetypes.high_deg.score;

      const expectedHarmonic = parseFloat((4 / ((1 / s1) + (1 / s2) + (1 / s3) + (1 / s4))).toFixed(1));
      assert.equal(team.overallScore, expectedHarmonic, `Harmonic efficiency for ${team.name} must match formula`);
    });
  });

  test('computes season average qualifying pace delta across all rounds', () => {
    const { exports: f1App } = createTestEnv();
    const metrics = f1App.computeProfilerMetrics(sampleRaceRounds, sampleQualRounds, sampleStandingsList);

    metrics.teams.forEach(team => {
      assert.ok(typeof team.seasonAvgQualDelta === 'number');
      assert.ok(team.seasonAvgQualDelta >= 0);
    });
  });
});

describe('Issue #16: Archetype Filtering & Circuit Directory (setProfilerArchetypeFilter & renderProfilerCircuitsList)', () => {
  const sampleCircuits = [
    { round: '1', raceName: 'Bahrain Grand Prix', circuitId: 'bahrain', circuitName: 'Bahrain International Circuit', locality: 'Sakhir', country: 'Bahrain', archetype: 'high_deg', winner: 'Max Verstappen', poleTime: '1:29.179' },
    { round: '2', raceName: 'Monaco Grand Prix', circuitId: 'monaco', circuitName: 'Circuit de Monaco', locality: 'Monte Carlo', country: 'Monaco', archetype: 'high_downforce', winner: 'Charles Leclerc', poleTime: '1:10.270' },
    { round: '3', raceName: 'Italian Grand Prix', circuitId: 'monza', circuitName: 'Autodromo Nazionale Monza', locality: 'Monza', country: 'Italy', archetype: 'low_drag', winner: 'Charles Leclerc', poleTime: '1:19.327' },
    { round: '4', raceName: 'Australian Grand Prix', circuitId: 'albert_park', circuitName: 'Albert Park Circuit', locality: 'Melbourne', country: 'Australia', archetype: 'balanced', winner: 'Carlos Sainz', poleTime: '1:15.915' }
  ];

  test('setProfilerArchetypeFilter toggles active filter, badges, and pill states', () => {
    const { exports: f1App, elements, profilerPills } = createTestEnv();
    f1App.circuitProfilerState.circuits = sampleCircuits;

    f1App.setProfilerArchetypeFilter('high_downforce');

    assert.equal(f1App.circuitProfilerState.activeArchetype, 'high_downforce');
    assert.equal(elements['profilerActiveFilterName'].textContent, 'High Downforce / Street');
    assert.ok(elements['profilerFilterCountBadge'].textContent.includes('Showing 1 Circuits in Street & High DF'));

    const hdPill = profilerPills.find(p => p.getAttribute('data-archetype') === 'high_downforce');
    const allPill = profilerPills.find(p => p.getAttribute('data-archetype') === 'all');
    assert.ok(hdPill.classList.contains('active'), 'Selected pill must have active class');
    assert.ok(!allPill.classList.contains('active'), 'Inactive pill must not have active class');

    // Check count badges
    assert.equal(elements['pillBadgeAll'].textContent, '4 Venues');
    assert.equal(elements['pillBadgeStreet'].textContent, '1 Venues');
    assert.equal(elements['pillBadgePower'].textContent, '1 Venues');
    assert.equal(elements['pillBadgeBalanced'].textContent, '1 Venues');
    assert.equal(elements['pillBadgeDeg'].textContent, '1 Venues');
  });

  test('renderProfilerCircuitsList filters circuits by selected archetype and renders circuit cards', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderProfilerCircuitsList(sampleCircuits, 'low_drag');
    const container = elements['profilerCircuitsList'];

    assert.ok(container.innerHTML.includes('Italian Grand Prix'));
    assert.ok(container.innerHTML.includes('Autodromo Nazionale Monza'));
    assert.ok(container.innerHTML.includes('Charles Leclerc'));
    assert.ok(container.innerHTML.includes('1:19.327'));
    assert.ok(!container.innerHTML.includes('Monaco Grand Prix'));

    // Check all circuits view
    f1App.renderProfilerCircuitsList(sampleCircuits, 'all');
    assert.ok(container.innerHTML.includes('Italian Grand Prix'));
    assert.ok(container.innerHTML.includes('Monaco Grand Prix'));
    assert.ok(container.innerHTML.includes('Bahrain Grand Prix'));
    assert.ok(container.innerHTML.includes('Australian Grand Prix'));
  });

  test('renderProfilerCircuitsList displays fallback empty state when no circuits match', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderProfilerCircuitsList([], 'high_deg');
    assert.ok(elements['profilerCircuitsList'].innerHTML.includes('No circuits match this archetype'));
  });
});

describe('Issue #16: Efficiency Ratings & Telemetry Visualizations (KPIs, Radar, Delta Matrix)', () => {
  const sampleMetrics = {
    teams: [
      {
        constructorId: 'mclaren', name: 'McLaren', color: '#FF8000', overallRank: 1, totalPoints: 666, totalWins: 6, totalPodiums: 21,
        seasonAvgQualDelta: 0.14, overallScore: 94.8,
        archetypes: {
          high_downforce: { avgQualDelta: 0.05, score: 96, points: 128, wins: 2, podiums: 5, avgFinish: 2.1 },
          low_drag: { avgQualDelta: 0.16, score: 93, points: 104, wins: 1, podiums: 3, avgFinish: 2.8 },
          balanced: { avgQualDelta: 0.12, score: 95, points: 242, wins: 2, podiums: 7, avgFinish: 2.3 },
          high_deg: { avgQualDelta: 0.18, score: 95, points: 192, wins: 1, podiums: 6, avgFinish: 2.5 }
        }
      },
      {
        constructorId: 'ferrari', name: 'Ferrari', color: '#E80020', overallRank: 2, totalPoints: 652, totalWins: 5, totalPodiums: 20,
        seasonAvgQualDelta: 0.16, overallScore: 93.6,
        archetypes: {
          high_downforce: { avgQualDelta: 0.08, score: 94, points: 122, wins: 2, podiums: 4, avgFinish: 2.3 },
          low_drag: { avgQualDelta: 0.08, score: 97, points: 118, wins: 1, podiums: 4, avgFinish: 2.2 },
          balanced: { avgQualDelta: 0.17, score: 92, points: 236, wins: 1, podiums: 6, avgFinish: 2.6 },
          high_deg: { avgQualDelta: 0.22, score: 91, points: 176, wins: 1, podiums: 6, avgFinish: 2.9 }
        }
      },
      {
        constructorId: 'red_bull', name: 'Red Bull', color: '#1E41FF', overallRank: 3, totalPoints: 589, totalWins: 9, totalPodiums: 19,
        seasonAvgQualDelta: 0.18, overallScore: 92.4,
        archetypes: {
          high_downforce: { avgQualDelta: 0.22, score: 88, points: 96, wins: 1, podiums: 3, avgFinish: 3.4 },
          low_drag: { avgQualDelta: 0.14, score: 94, points: 112, wins: 1, podiums: 4, avgFinish: 2.5 },
          balanced: { avgQualDelta: 0.15, score: 93, points: 228, wins: 3, podiums: 6, avgFinish: 2.4 },
          high_deg: { avgQualDelta: 0.15, score: 96, points: 200, wins: 4, podiums: 6, avgFinish: 1.8 }
        }
      }
    ],
    medians: {
      high_downforce: 0.08,
      low_drag: 0.14,
      balanced: 0.15,
      high_deg: 0.18
    }
  };

  test('renderProfilerKpis populates 4 KPI cards correctly', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderProfilerKpis(sampleMetrics);

    // 1. Low-Drag Speed Master -> Ferrari (0.08% pace)
    assert.equal(elements['profilerKpiPowerTeam'].textContent, 'Ferrari');
    assert.equal(elements['profilerKpiPowerDelta'].textContent, '+0.08% Pace');
    assert.equal(elements['profilerKpiPowerBar'].style.background, '#E80020');

    // 2. High Downforce / Street Specialist -> McLaren (0.05% pace)
    assert.equal(elements['profilerKpiStreetTeam'].textContent, 'McLaren');
    assert.equal(elements['profilerKpiStreetDelta'].textContent, '+0.05% Pace');
    assert.equal(elements['profilerKpiStreetBar'].style.background, '#FF8000');

    // 3. Peak Aero Efficiency Leader -> McLaren (94.8 score)
    assert.equal(elements['profilerKpiEfficiencyTeam'].textContent, 'McLaren');
    assert.equal(elements['profilerKpiEfficiencyScore'].textContent, '94.8 / 100');

    // 4. High Degradation Tyre Master -> Red Bull (200 pts / P1.8 avg finish)
    assert.equal(elements['profilerKpiDegTeam'].textContent, 'Red Bull');
    assert.equal(elements['profilerKpiDegDelta'].textContent, 'P1.8 Avg Finish');
    assert.equal(elements['profilerKpiDegBar'].style.background, '#1E41FF');
  });

  test('renderProfilerRadarChart initializes Chart.js and generates team legend pills', () => {
    const { exports: f1App, elements, chartInstances } = createTestEnv();
    f1App.circuitProfilerState.metrics = sampleMetrics;

    f1App.renderProfilerRadarChart();

    // Check legend pills
    const pillsHtml = elements['profilerTeamPills'].innerHTML;
    assert.ok(pillsHtml.includes('McLaren'));
    assert.ok(pillsHtml.includes('Ferrari'));
    assert.ok(pillsHtml.includes('Red Bull'));
    assert.ok(pillsHtml.includes('94.8'));

    // Check Chart.js instance
    assert.ok(chartInstances.length > 0);
    const lastChart = chartInstances[chartInstances.length - 1];
    assert.equal(lastChart.config.type, 'radar');
    assert.deepEqual([...lastChart.data.labels], [
      'High Downforce / Street',
      'Low Drag / Power',
      'Balanced Aero',
      'High Degradation'
    ]);
    assert.equal(lastChart.data.datasets.length, 3);
  });

  test('toggleProfilerTeam toggles team visibility and updates chart datasets', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.circuitProfilerState.metrics = sampleMetrics;
    f1App.circuitProfilerState.hiddenTeams.clear();

    f1App.toggleProfilerTeam('ferrari');
    assert.ok(f1App.circuitProfilerState.hiddenTeams.has('ferrari'));

    // Pill for Ferrari should be marked muted
    assert.ok(elements['profilerTeamPills'].innerHTML.includes('muted'));

    f1App.toggleProfilerTeam('ferrari');
    assert.ok(!f1App.circuitProfilerState.hiddenTeams.has('ferrari'));
  });

  test('renderProfilerDeltaMatrix generates matrix cells with advantage, parity, and deficit classes', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderProfilerDeltaMatrix(sampleMetrics);
    const tbodyHtml = elements['profilerDeltaMatrixBody'].innerHTML;

    assert.ok(tbodyHtml.includes('data-cid="mclaren"'));
    assert.ok(tbodyHtml.includes('data-cid="ferrari"'));
    assert.ok(tbodyHtml.includes('data-cid="red_bull"'));

    // Ferrari on low_drag: 0.08 vs median 0.14 -> diff = -0.06 (parity)
    // Red Bull on high_downforce: 0.22 vs median 0.08 -> diff = +0.14 -> deficit
    assert.ok(tbodyHtml.includes('matrix-cell-deficit'), 'Deficit class should be applied when >0.10s slower than median');
    assert.ok(tbodyHtml.includes('+0.14%'), 'Season average delta must be displayed');
    assert.ok(tbodyHtml.includes('94.8 / 100'), 'Overall score must be displayed');
  });
});

describe('Issue #16: Standings Impact & Isolated Archetype Standings (renderProfilerFilteredStandings)', () => {
  const sampleMetrics = {
    teams: [
      {
        constructorId: 'mclaren', name: 'McLaren', color: '#FF8000', overallRank: 1, totalPoints: 666, totalWins: 6, totalPodiums: 21,
        seasonAvgQualDelta: 0.14, overallScore: 94.8,
        archetypes: {
          high_downforce: { avgQualDelta: 0.05, score: 96, points: 128, wins: 2, podiums: 5, avgFinish: 2.1 },
          low_drag: { avgQualDelta: 0.16, score: 93, points: 104, wins: 1, podiums: 3, avgFinish: 2.8 },
          balanced: { avgQualDelta: 0.12, score: 95, points: 242, wins: 2, podiums: 7, avgFinish: 2.3 },
          high_deg: { avgQualDelta: 0.18, score: 95, points: 192, wins: 1, podiums: 6, avgFinish: 2.5 }
        }
      },
      {
        constructorId: 'ferrari', name: 'Ferrari', color: '#E80020', overallRank: 2, totalPoints: 652, totalWins: 5, totalPodiums: 20,
        seasonAvgQualDelta: 0.16, overallScore: 93.6,
        archetypes: {
          high_downforce: { avgQualDelta: 0.08, score: 94, points: 122, wins: 2, podiums: 4, avgFinish: 2.3 },
          low_drag: { avgQualDelta: 0.08, score: 97, points: 118, wins: 1, podiums: 4, avgFinish: 2.2 },
          balanced: { avgQualDelta: 0.17, score: 92, points: 236, wins: 1, podiums: 6, avgFinish: 2.6 },
          high_deg: { avgQualDelta: 0.22, score: 91, points: 176, wins: 1, podiums: 6, avgFinish: 2.9 }
        }
      },
      {
        constructorId: 'red_bull', name: 'Red Bull', color: '#1E41FF', overallRank: 3, totalPoints: 589, totalWins: 9, totalPodiums: 19,
        seasonAvgQualDelta: 0.18, overallScore: 92.4,
        archetypes: {
          high_downforce: { avgQualDelta: 0.22, score: 88, points: 96, wins: 1, podiums: 3, avgFinish: 3.4 },
          low_drag: { avgQualDelta: 0.14, score: 94, points: 112, wins: 1, podiums: 4, avgFinish: 2.5 },
          balanced: { avgQualDelta: 0.15, score: 93, points: 228, wins: 3, podiums: 6, avgFinish: 2.4 },
          high_deg: { avgQualDelta: 0.15, score: 96, points: 200, wins: 4, podiums: 6, avgFinish: 1.8 }
        }
      }
    ]
  };

  test('ranks teams by overall points when filter is "all" with neutral rank delta', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderProfilerFilteredStandings(sampleMetrics, 'all');
    const tbody = elements['profilerFilteredStandingsBody'].innerHTML;

    assert.ok(tbody.includes('McLaren'));
    assert.ok(tbody.includes('666 PTS'));
    assert.ok(tbody.includes('rank-delta-neutral'));
    assert.ok(tbody.includes('● ='));
  });

  test('re-ranks teams strictly by points earned in selected archetype and computes rank delta vs overall WCC', () => {
    const { exports: f1App, elements } = createTestEnv();

    // In Low Drag, points are: Ferrari (118), Red Bull (112), McLaren (104)
    // Overall ranks are: McLaren (P1), Ferrari (P2), Red Bull (P3)
    // In Low Drag:
    // Ferrari: archRank = 1, overall = 2 -> diff = +1 (Gain: ▲ +1)
    // Red Bull: archRank = 2, overall = 3 -> diff = +1 (Gain: ▲ +1)
    // McLaren: archRank = 3, overall = 1 -> diff = -2 (Loss: ▼ -2)
    f1App.renderProfilerFilteredStandings(sampleMetrics, 'low_drag');
    const tbody = elements['profilerFilteredStandingsBody'].innerHTML;

    // Check Ferrari gain
    assert.ok(tbody.includes('rank-delta-gain'));
    assert.ok(tbody.includes('▲ +1'));

    // Check McLaren loss
    assert.ok(tbody.includes('rank-delta-loss'));
    assert.ok(tbody.includes('▼ -2'));

    // Check points and share
    assert.ok(tbody.includes('118 PTS'));
    assert.ok(tbody.includes('112 PTS'));
    assert.ok(tbody.includes('104 PTS'));
  });

  test('calculates percentage share of total points awarded within the archetype', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderProfilerFilteredStandings(sampleMetrics, 'high_downforce');
    const tbody = elements['profilerFilteredStandingsBody'].innerHTML;

    // High Downforce points: McLaren (128), Ferrari (122), Red Bull (96) -> Total = 346
    // McLaren share = (128 / 346) * 100 = 37.0%
    assert.ok(tbody.includes('37.0%'));
  });
});

describe('Issue #16: Main Navigation Tab Switching & Lifecycle Integration', () => {
  test('switchMainTab("profiler") displays circuit profiler section and hides others', () => {
    const { context, elements } = createTestEnv();

    context.switchMainTab('profiler');
    assert.equal(elements['circuit-profiler-section'].style.display, 'block');
    assert.equal(elements['constructor-atr-section'].style.display, 'none');
    assert.equal(elements['sprint-disparity-section'].style.display, 'none');
    assert.equal(elements['clinch-engine-section'].style.display, 'none');
    assert.equal(elements['pitstop-matrix-section'].style.display, 'none');

    // Switch to another tab
    context.switchMainTab('constructors');
    assert.equal(elements['circuit-profiler-section'].style.display, 'none');
    assert.equal(elements['constructor-atr-section'].style.display, 'block');

    // Switch back to "all" tab
    context.switchMainTab('all');
    assert.equal(elements['circuit-profiler-section'].style.display, 'block');
    assert.equal(elements['constructor-atr-section'].style.display, 'block');
  });

  test('loadProfilerData loads cached metrics from localStorage when available', async () => {
    const cachedData = {
      teams: [
        {
          constructorId: 'mclaren', name: 'McLaren', color: '#FF8000', overallRank: 1, totalPoints: 666, totalWins: 6, totalPodiums: 21,
          seasonAvgQualDelta: 0.14, overallScore: 94.8,
          archetypes: {
            high_downforce: { avgQualDelta: 0.05, score: 96, points: 128, wins: 2, podiums: 5, avgFinish: 2.1 },
            low_drag: { avgQualDelta: 0.16, score: 93, points: 104, wins: 1, podiums: 3, avgFinish: 2.8 },
            balanced: { avgQualDelta: 0.12, score: 95, points: 242, wins: 2, podiums: 7, avgFinish: 2.3 },
            high_deg: { avgQualDelta: 0.18, score: 95, points: 192, wins: 1, podiums: 6, avgFinish: 2.5 }
          }
        }
      ],
      medians: { high_downforce: 0.05, low_drag: 0.16, balanced: 0.12, high_deg: 0.18 },
      circuits: []
    };

    const { exports: f1App, elements, storage } = createTestEnv();
    storage.setItem('f1_circuit_profiler_v1_2024', JSON.stringify(cachedData));

    const state = await f1App.loadProfilerData('2024', false);

    assert.equal(state.season, '2024');
    assert.equal(state.metrics.teams.length, 1);
    assert.equal(state.metrics.teams[0].name, 'McLaren');
    assert.equal(elements['profilerCacheBadge'].textContent, '⚡ Cached (Instant)');
  });

  test('loadProfilerData fetches live telemetry when cache is bypassed or missing', async () => {
    const mockStandingsResp = {
      MRData: {
        StandingsTable: {
          season: '2024',
          StandingsLists: [{
            ConstructorStandings: [
              { position: '1', points: '666', wins: '6', Constructor: { constructorId: 'mclaren', name: 'McLaren' } }
            ]
          }]
        }
      }
    };

    const mockFetch = async (url) => {
      if (url.includes('constructorStandings.json')) {
        return { ok: true, json: async () => mockStandingsResp };
      }
      return { ok: true, json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } }) };
    };

    const { exports: f1App, elements } = createTestEnv(mockFetch);
    const state = await f1App.loadProfilerData('2024', true);

    assert.equal(state.season, '2024');
    assert.ok(state.metrics);
    assert.equal(elements['profilerCacheBadge'].textContent, '⚡ Live Telemetry');
  });

  test('loadProfilerData falls back to CIRCUIT_PROFILER_FALLBACK_2024 gracefully on network error', async () => {
    const failingFetch = async () => { throw new Error('Network error'); };
    const { exports: f1App, elements } = createTestEnv(failingFetch);

    const state = await f1App.loadProfilerData('2024', true);

    assert.ok(state.metrics);
    assert.ok(state.metrics.teams.length >= 10);
    assert.equal(elements['profilerCacheBadge'].textContent, '⚡ Live Telemetry');
  });

  test('onProfilerSeasonChange updates season and triggers data loading', () => {
    const { exports: f1App } = createTestEnv();
    f1App.onProfilerSeasonChange('2023');
    assert.equal(f1App.circuitProfilerState.season, '2023');
  });

  test('refreshProfilerData reloads telemetry using dropdown season', () => {
    const { exports: f1App, elements } = createTestEnv();
    elements['profilerSeasonSelect'].value = '2022';
    f1App.refreshProfilerData();
    assert.equal(f1App.circuitProfilerState.season, '2022');
  });

  test('DOMContentLoaded listener triggers loadProfilerData without errors', () => {
    const { listeners, elements } = createTestEnv();
    elements['profilerSeasonSelect'].value = '2024';

    assert.ok(listeners['DOMContentLoaded'], 'DOMContentLoaded listener should be registered');
    assert.doesNotThrow(() => {
      listeners['DOMContentLoaded'].forEach(fn => fn());
    });
  });
});
