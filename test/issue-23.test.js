const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toPlain = (val) => JSON.parse(JSON.stringify(val));

function createTestEnv(customFetch, initialStorage = {}) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];
  const storageData = { ...initialStorage };

  const mockStorage = {
    getItem: (key) => storageData[key] !== undefined ? storageData[key] : null,
    setItem: (key, val) => { storageData[key] = String(val); },
    removeItem: (key) => { delete storageData[key]; },
    clear: () => { Object.keys(storageData).forEach(k => delete storageData[k]); }
  };

  function createMockElement(id, tag = 'div') {
    const classSet = new Set();
    return {
      id,
      tagName: tag.toUpperCase(),
      classes: classSet,
      classList: {
        classes: classSet,
        add(...cls) { cls.forEach(c => classSet.add(c)); },
        remove(...cls) { cls.forEach(c => classSet.delete(c)); },
        toggle(c, force) {
          if (force !== undefined) {
            force ? classSet.add(c) : classSet.delete(c);
          } else {
            classSet.has(c) ? classSet.delete(c) : classSet.add(c);
          }
        },
        contains(c) { return classSet.has(c); }
      },
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        if (val === '') {
          this.children = [];
          this.options = [];
        }
      },
      textContent: '',
      value: '',
      style: { display: 'none' },
      children: [],
      options: [],
      appendChild(child) {
        this.children.push(child);
        if (this.tagName === 'SELECT' || child.tagName === 'OPTION') {
          this.options.push(child);
          if (child.selected || this.options.length === 1) {
            this.value = child.value;
          }
        }
        return child;
      },
      addEventListener(event, fn) {
        listeners[id] = listeners[id] || {};
        listeners[id][event] = listeners[id][event] || [];
        listeners[id][event].push(fn);
      },
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
      const tag = id.toLowerCase().includes('select') ? 'select' : (id.toLowerCase().includes('chart') ? 'canvas' : 'div');
      elements[id] = createMockElement(id, tag);
    }
    return elements[id];
  }

  const tabBtnIds = [
    'tabBtnAll', 'tabBtnLapChart', 'tabBtnStints', 'tabBtnFinishingGap',
    'tabBtnProfiler', 'tabBtnConstructors', 'tabBtnMomentum', 'tabBtnSprint',
    'tabBtnClinch', 'tabBtnPitStops', 'tabBtnReliability', 'tabBtnTelemetry',
    'tabBtnProgression', 'tabBtnResults'
  ];

  const sectionIds = [
    'lap-chart-section', 'stint-profiler-section', 'finishing-gap-section',
    'circuit-profiler-section', 'constructor-atr-section', 'constructor-momentum-section',
    'sprint-disparity-section', 'clinch-engine-section', 'pitstop-matrix-section',
    'reliability-matrix-section', 'teammate-telemetry-section', 'progression-section',
    'latest-race-section', 'standings-table-section'
  ];

  tabBtnIds.forEach(id => getOrCreateEl(id));
  sectionIds.forEach(id => getOrCreateEl(id));

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
      if (selector === '.tab-btn') {
        return tabBtnIds.map(id => getOrCreateEl(id));
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => createMockElement('created_' + tag, tag)
  };

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
    }
    destroy() { this.destroyed = true; }
    resize() { this.resized = true; }
    update() { this.updated = true; }
  }

  const activeFetch = async (url, opts) => {
    queriedUrls.push(url);
    if (customFetch) {
      const res = await customFetch(url, opts);
      if (res && res.ok !== undefined) return res;
      return {
        ok: true,
        status: 200,
        json: async () => res
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ MRData: { RaceTable: { Races: [] }, total: '0', limit: '100' } })
    };
  };

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');
  const scriptCode = scriptMatch[1];

  const context = {
    window: {
      document: mockDoc,
      addEventListener: () => {},
      removeEventListener: () => {},
      Chart: MockChart,
      localStorage: mockStorage
    },
    document: mockDoc,
    Chart: MockChart,
    fetch: activeFetch,
    localStorage: mockStorage,
    console: { ...console, warn: () => {}, error: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };
  context.window.document = mockDoc;

  vm.createContext(context);
  vm.runInContext(scriptCode, context);

  Object.assign(context, context.module.exports);
  Object.assign(context, context.window);

  const elementsProxy = new Proxy(elements, {
    get(target, prop) {
      if (typeof prop === 'string') {
        return getOrCreateEl(prop);
      }
      return target[prop];
    }
  });

  return {
    context,
    elements: elementsProxy,
    queriedUrls,
    html,
    storage: mockStorage
  };
}

describe('Issue #23: Constructor Points Momentum & In-Season Development Trajectory Tracker', () => {

  describe('1. computeRollingAverage logic & expanding window handling', () => {
    test('computes rolling 3-race average with expanding window for rounds 1 and 2', () => {
      const { context } = createTestEnv();
      const fn = context.computeRollingAverage;
      assert.equal(typeof fn, 'function', 'computeRollingAverage should be exported');

      // Round 1 only (1-race window)
      const res1 = fn([25]);
      assert.deepEqual(toPlain(res1), [25]);

      // Rounds 1-2 (1-race, then 2-race window)
      const res2 = fn([25, 15]);
      assert.deepEqual(toPlain(res2), [25, 20]); // (25 + 15) / 2 = 20

      // Rounds 1-3 (1-race, 2-race, 3-race window)
      const res3 = fn([25, 15, 20]);
      assert.deepEqual(toPlain(res3), [25, 20, 20]); // (25 + 15 + 20) / 3 = 20

      // Rounds 1-5 (sliding 3-race window for rounds 4 and 5)
      const res5 = fn([25, 15, 20, 30, 40]);
      // R1: 25
      // R2: (25+15)/2 = 20
      // R3: (25+15+20)/3 = 20
      // R4: (15+20+30)/3 = 21.67
      // R5: (20+30+40)/3 = 30
      assert.deepEqual(toPlain(res5), [25, 20, 20, 21.67, 30]);
    });

    test('gracefully handles empty and invalid inputs', () => {
      const { context } = createTestEnv();
      const fn = context.computeRollingAverage;

      assert.deepEqual(toPlain(fn([])), []);
      assert.deepEqual(toPlain(fn(null)), []);
      assert.deepEqual(toPlain(fn(undefined)), []);
      assert.deepEqual(toPlain(fn('invalid')), []);
    });

    test('supports custom window size', () => {
      const { context } = createTestEnv();
      const fn = context.computeRollingAverage;

      // 2-race window
      const res = fn([10, 20, 30, 40], 2);
      // R1: 10
      // R2: (10+20)/2 = 15
      // R3: (20+30)/2 = 25
      // R4: (30+40)/2 = 35
      assert.deepEqual(toPlain(res), [10, 15, 25, 35]);
    });
  });

  describe('2. aggregateConstructorPoints from Grand Prix and Sprint sessions', () => {
    test('aggregates points per round from both GP Results and SprintResults', () => {
      const { context } = createTestEnv();
      const aggregate = context.aggregateConstructorPoints;
      assert.equal(typeof aggregate, 'function', 'aggregateConstructorPoints should be exported');

      const raceRounds = [
        {
          round: '1',
          raceName: 'Bahrain Grand Prix',
          Results: [
            { points: '25', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
            { points: '18', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
            { points: '15', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } } // teammate points
          ]
        },
        {
          round: '2',
          raceName: 'Saudi Arabian Grand Prix',
          Results: [
            { points: '25', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
            { points: '18', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
            { points: '15', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } }
          ]
        },
        {
          round: '3',
          raceName: 'Chinese Grand Prix',
          Results: [
            { points: '25', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
            { points: '18', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
            { points: '15', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } }
          ]
        }
      ];

      // Round 3 has a Sprint session
      const sprintRounds = [
        {
          round: '3',
          raceName: 'Chinese Grand Prix',
          SprintResults: [
            { points: '8', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
            { points: '7', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
            { points: '6', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } }
          ]
        }
      ];

      const aggregated = aggregate(raceRounds, sprintRounds);

      assert.equal(aggregated.rounds.length, 3);
      assert.equal(aggregated.rounds[0].hasSprint, false);
      assert.equal(aggregated.rounds[2].hasSprint, true);

      // Red Bull points:
      // R1: 25 GP, 0 Sprint = 25
      // R2: 25+18 = 43 GP, 0 Sprint = 43
      // R3: 18 GP + 8 Sprint = 26
      // Total: 25 + 43 + 26 = 94
      const rb = aggregated.constructors['red_bull'];
      assert.ok(rb, 'Red Bull should be present');
      assert.deepEqual(toPlain(rb.roundPoints), [25, 43, 26]);
      assert.equal(rb.gpPoints, 86);
      assert.equal(rb.sprintPoints, 8);
      assert.equal(rb.totalPoints, 94);

      // Ferrari points:
      // R1: 18+15 = 33 GP = 33
      // R2: 15 GP = 15
      // R3: 15 GP + 6 Sprint = 21
      // Total: 33 + 15 + 21 = 69
      const fer = aggregated.constructors['ferrari'];
      assert.ok(fer, 'Ferrari should be present');
      assert.deepEqual(toPlain(fer.roundPoints), [33, 15, 21]);
      assert.equal(fer.totalPoints, 69);

      // McLaren points:
      // R1: 0 (didn't score in top results)
      // R2: 0
      // R3: 25 GP + 7 Sprint = 32
      const mcl = aggregated.constructors['mclaren'];
      assert.ok(mcl, 'McLaren should be present');
      assert.deepEqual(toPlain(mcl.roundPoints), [0, 0, 32]);
      assert.equal(mcl.totalPoints, 32);
    });

    test('handles pre-2021 seasons gracefully when sprintRounds is empty or missing', () => {
      const { context } = createTestEnv();
      const aggregate = context.aggregateConstructorPoints;

      const raceRounds = [
        {
          round: '1',
          raceName: 'Austrian Grand Prix',
          Results: [
            { points: '25', Constructor: { constructorId: 'mercedes', name: 'Mercedes' } },
            { points: '18', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } }
          ]
        }
      ];

      const aggregated = aggregate(raceRounds, []);
      assert.equal(aggregated.rounds.length, 1);
      assert.equal(aggregated.rounds[0].hasSprint, false);
      assert.equal(aggregated.constructors['mercedes'].totalPoints, 25);
      assert.equal(aggregated.constructors['mercedes'].sprintPoints, 0);
    });
  });

  describe('3. computeConstructorMomentumMetrics and KPI computation', () => {
    test('computes rolling averages, latest average, and momentum delta', () => {
      const { context } = createTestEnv();
      const compute = context.computeConstructorMomentumMetrics;
      assert.equal(typeof compute, 'function');

      const aggregatedData = {
        rounds: [
          { round: '1', raceName: 'R1', hasSprint: false },
          { round: '2', raceName: 'R2', hasSprint: false },
          { round: '3', raceName: 'R3', hasSprint: false },
          { round: '4', raceName: 'R4', hasSprint: false }
        ],
        constructors: {
          'team_surge': {
            id: 'team_surge',
            name: 'Surging Team',
            roundPoints: [10, 10, 20, 40],
            totalPoints: 80,
            gpPoints: 80,
            sprintPoints: 0
          },
          'team_slump': {
            id: 'team_slump',
            name: 'Slumping Team',
            roundPoints: [40, 30, 20, 0],
            totalPoints: 90,
            gpPoints: 90,
            sprintPoints: 0
          }
        }
      };

      const metrics = compute(aggregatedData, 3);

      const surge = metrics.constructors['team_surge'];
      assert.equal(surge.latestAvg, 23.33);
      assert.equal(surge.prevAvg, 13.33);
      assert.equal(surge.momentumDelta, 10.0);

      const slump = metrics.constructors['team_slump'];
      assert.equal(slump.latestAvg, 16.67);
      assert.equal(slump.prevAvg, 30.0);
      assert.equal(slump.momentumDelta, -13.33);

      // KPIs
      assert.equal(metrics.topGainer.id, 'team_surge');
      assert.equal(metrics.topGainer.momentumDelta, 10.0);
      assert.equal(metrics.topLoser.id, 'team_slump');
      assert.equal(metrics.topLoser.momentumDelta, -13.33);
      assert.equal(metrics.momentumLeader.id, 'team_surge');
      assert.equal(metrics.totalRounds, 4);
    });

    test('handles single round gracefully without error', () => {
      const { context } = createTestEnv();
      const compute = context.computeConstructorMomentumMetrics;

      const data = {
        rounds: [{ round: '1', raceName: 'R1', hasSprint: false }],
        constructors: {
          'mclaren': {
            id: 'mclaren',
            name: 'McLaren',
            roundPoints: [25],
            totalPoints: 25,
            gpPoints: 25,
            sprintPoints: 0
          }
        }
      };

      const metrics = compute(data, 3);
      assert.equal(metrics.topGainer.id, 'mclaren');
      assert.equal(metrics.topGainer.momentumDelta, 0);
      assert.equal(metrics.topGainer.latestAvg, 25);
      assert.equal(metrics.momentumLeader.id, 'mclaren');
    });
  });

  describe('4. Historical seasons & pre-2021 sprint endpoint handling', () => {
    test('fetches paginated results and sprints for 2024 season', async () => {
      const queried = [];
      const customFetch = async (url) => {
        queried.push(url);
        if (url.includes('/results.json')) {
          return {
            MRData: {
              total: '1',
              limit: '1000',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    raceName: 'Bahrain GP',
                    Results: [
                      { points: '25', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } }
                    ]
                  }
                ]
              }
            }
          };
        }
        if (url.includes('/sprint.json')) {
          return {
            MRData: {
              total: '0',
              limit: '1000',
              RaceTable: { Races: [] }
            }
          };
        }
        return { MRData: { total: '0', RaceTable: { Races: [] } } };
      };

      const { context } = createTestEnv(customFetch);
      await context.loadConstructorMomentumData('2024', true);

      assert.ok(queried.some(u => u.includes('/2024/results.json')), 'Should fetch 2024 results');
      assert.ok(queried.some(u => u.includes('/2024/sprint.json')), 'Should fetch 2024 sprint');
      assert.equal(context.constructorMomentumState.season, '2024');
      assert.ok(context.constructorMomentumState.metrics.sortedConstructors.length > 0);
    });

    test('pre-2021 season (2020) handles absence of sprint races gracefully', async () => {
      const queried = [];
      const customFetch = async (url) => {
        queried.push(url);
        if (url.includes('/results.json')) {
          return {
            MRData: {
              total: '1',
              limit: '1000',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    raceName: 'Austrian GP',
                    Results: [
                      { points: '25', Constructor: { constructorId: 'mercedes', name: 'Mercedes' } }
                    ]
                  }
                ]
              }
            }
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };

      const { context, elements } = createTestEnv(customFetch);
      await context.loadConstructorMomentumData('2020', true);

      assert.ok(queried.some(u => u.includes('/2020/results.json')), 'Should fetch results');
      const badge = elements['momentumCacheBadge'];
      assert.ok(badge.textContent.includes('Pre-Sprint') || badge.textContent.includes('GP Only'));
      assert.equal(context.constructorMomentumState.metrics.sprintRoundsCount, 0);
    });

    test('handles 404 or empty sprint gracefully in 2021-2024 without throwing', async () => {
      const customFetch = async (url) => {
        if (url.includes('/results.json')) {
          return {
            MRData: {
              total: '1',
              limit: '1000',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    raceName: 'Bahrain GP',
                    Results: [
                      { points: '25', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } }
                    ]
                  }
                ]
              }
            }
          };
        }
        if (url.includes('/sprint.json')) {
          return {
            ok: false,
            status: 404,
            json: async () => { throw new Error('404 Not Found'); }
          };
        }
        return { MRData: { total: '0', RaceTable: { Races: [] } } };
      };

      const { context } = createTestEnv(customFetch);
      const res = await context.loadConstructorMomentumData('2023', true);
      assert.ok(res.metrics, 'Metrics should be computed despite 404 on sprint');
    });
  });

  describe('5. Error fallback and caching resilience', () => {
    test('falls back to CONSTRUCTOR_MOMENTUM_FALLBACK_2024 when network fails on 2024', async () => {
      const customFetch = async () => {
        throw new Error('Network offline');
      };

      const { context, elements } = createTestEnv(customFetch);
      await context.loadConstructorMomentumData('2024', true);

      assert.ok(context.constructorMomentumState.metrics, 'Metrics should be populated with fallback');
      assert.equal(context.constructorMomentumState.metrics.totalRounds, 24);
      assert.equal(context.constructorMomentumState.metrics.sortedConstructors.length, 10);

      const badge = elements['momentumCacheBadge'];
      assert.ok(badge.textContent.includes('Offline Fallback') || badge.textContent.includes('Cached'));
    });

    test('shows graceful error message on network failure for historical season', async () => {
      const customFetch = async () => {
        throw new Error('Network error');
      };

      const { context, elements } = createTestEnv(customFetch);
      await context.loadConstructorMomentumData('2019', true);

      const errEl = elements['momentumError'];
      assert.equal(errEl.style.display, 'block');
      assert.ok(errEl.textContent.includes('2019'));
    });

    test('stores and loads cached data from localStorage', async () => {
      const initialCache = {
        'f1_constructor_momentum_2024': JSON.stringify({
          rounds: [{ round: '1', raceName: 'Cached GP', hasSprint: false }],
          constructors: {
            'cached_team': {
              id: 'cached_team',
              name: 'Cached Team',
              roundPoints: [25],
              totalPoints: 25,
              gpPoints: 25,
              sprintPoints: 0
            }
          }
        })
      };

      const queried = [];
      const customFetch = async (url) => {
        queried.push(url);
        return { MRData: { total: '0', RaceTable: { Races: [] } } };
      };

      const { context, elements } = createTestEnv(customFetch, initialCache);
      await context.loadConstructorMomentumData('2024', false); // forceRefresh = false

      assert.equal(queried.length, 0, 'Should not query network if cached');
      assert.ok(context.constructorMomentumState.constructors['cached_team']);
      assert.equal(elements['momentumCacheBadge'].textContent, '⚡ Cached Telemetry');
    });
  });

  describe('6. Interactive UI tab integration & switchMainTab', () => {
    test('switchMainTab activates momentum tab and hides other sections', () => {
      const { context, elements } = createTestEnv();

      // Switch to momentum tab
      context.switchMainTab('momentum');

      // Verify active button
      assert.ok(elements['tabBtnMomentum'].classList.contains('active'), 'tabBtnMomentum should have active class');
      assert.ok(!elements['tabBtnConstructors'].classList.contains('active'), 'tabBtnConstructors should not have active class');

      // Verify section visibility
      assert.equal(elements['constructor-momentum-section'].style.display, 'block', 'momentum section should be displayed');
      assert.equal(elements['constructor-atr-section'].style.display, 'none', 'constructor ATR section should be hidden');
      assert.equal(elements['lap-chart-section'].style.display, 'none', 'lap chart section should be hidden');
      assert.equal(elements['latest-race-section'].style.display, 'none', 'results section should be hidden');
    });

    test('switchMainTab("all") displays momentum section along with other sections', () => {
      const { context, elements } = createTestEnv();

      context.switchMainTab('all');

      assert.equal(elements['constructor-momentum-section'].style.display, 'block', 'momentum section displayed in all view');
      assert.equal(elements['constructor-atr-section'].style.display, 'block');
      assert.equal(elements['lap-chart-section'].style.display, 'block');
    });

    test('switchMainTab to another tab hides momentum section', () => {
      const { context, elements } = createTestEnv();

      context.switchMainTab('constructors');
      assert.equal(elements['constructor-momentum-section'].style.display, 'none');
      assert.equal(elements['constructor-atr-section'].style.display, 'block');

      context.switchMainTab('results');
      assert.equal(elements['constructor-momentum-section'].style.display, 'none');
      assert.equal(elements['latest-race-section'].style.display, 'block');
    });
  });

  describe('7. Interactive team legend toggles & Chart.js rendering', () => {
    test('toggleMomentumConstructor toggles hiddenTeams set and updates chart dataset visibility', () => {
      const { context } = createTestEnv();

      const metrics = context.computeConstructorMomentumMetrics(context.CONSTRUCTOR_MOMENTUM_FALLBACK_2024);
      context.constructorMomentumState.metrics = metrics;
      context.renderMomentumChart();

      assert.equal(context.constructorMomentumState.hiddenTeams.has('mclaren'), false);

      // Toggle McLaren hidden
      context.toggleMomentumConstructor('mclaren');
      assert.equal(context.constructorMomentumState.hiddenTeams.has('mclaren'), true);

      // Toggle McLaren back visible
      context.toggleMomentumConstructor('mclaren');
      assert.equal(context.constructorMomentumState.hiddenTeams.has('mclaren'), false);
    });

    test('legend pills render with team names and muted class when hidden', () => {
      const { context, elements } = createTestEnv();

      const metrics = context.computeConstructorMomentumMetrics(context.CONSTRUCTOR_MOMENTUM_FALLBACK_2024);
      context.constructorMomentumState.metrics = metrics;
      context.renderMomentumChart();

      const pillsHtml = elements['momentumTeamLegendPills'].innerHTML;
      assert.ok(pillsHtml.includes('McLaren'), 'Pills should include McLaren');
      assert.ok(pillsHtml.includes('Ferrari'), 'Pills should include Ferrari');
      assert.ok(pillsHtml.includes('Red Bull'), 'Pills should include Red Bull');

      // Hide Red Bull
      context.toggleMomentumConstructor('red_bull');
      const updatedPills = elements['momentumTeamLegendPills'].innerHTML;
      assert.ok(updatedPills.includes('muted'), 'Muted class should appear on hidden team');
    });
  });

  describe('8. Momentum KPIs & Table DOM Rendering', () => {
    test('renders KPI cards with top gainer, top loser, and momentum leader', () => {
      const { context, elements } = createTestEnv();

      const metrics = context.computeConstructorMomentumMetrics(context.CONSTRUCTOR_MOMENTUM_FALLBACK_2024);
      context.renderMomentumKpis(metrics);

      const gainerTeam = elements['momentumKpiGainerTeam'].textContent;
      const gainerDelta = elements['momentumKpiGainerDelta'].textContent;
      const loserTeam = elements['momentumKpiLoserTeam'].textContent;
      const leaderTeam = elements['momentumKpiLeaderTeam'].textContent;

      assert.ok(gainerTeam.length > 0 && gainerTeam !== '—', 'Gainer team should be rendered');
      assert.ok(gainerDelta.includes('PTS/RACE'), 'Gainer delta should include unit');
      assert.ok(loserTeam.length > 0 && loserTeam !== '—', 'Loser team should be rendered');
      assert.ok(leaderTeam.length > 0 && leaderTeam !== '—', 'Leader team should be rendered');

      const roundsCount = elements['momentumKpiRoundsCount'].textContent;
      assert.equal(roundsCount, '24 Rounds');
    });

    test('renders development trajectory breakdown table rows', () => {
      const { context, elements } = createTestEnv();

      const metrics = context.computeConstructorMomentumMetrics(context.CONSTRUCTOR_MOMENTUM_FALLBACK_2024);
      context.renderMomentumTable(metrics);

      const tbodyHtml = elements['constructorMomentumTableBody'].innerHTML;
      assert.ok(tbodyHtml.includes('McLaren'), 'Table should include McLaren');
      assert.ok(tbodyHtml.includes('Ferrari'), 'Table should include Ferrari');
      assert.ok(tbodyHtml.includes('P1'), 'Table should include P1 rank');
      assert.ok(tbodyHtml.includes('pts/race'), 'Table should include rolling avg');
      assert.ok(tbodyHtml.includes('GP'), 'Table should include GP points');
      assert.ok(tbodyHtml.includes('Sprint'), 'Table should include Sprint points');
    });
  });

  describe('9. Season dropdown and refresh controls', () => {
    test('onMomentumSeasonChange triggers data reload for chosen season', () => {
      const { context } = createTestEnv();
      let reloadedSeason = null;
      context.loadConstructorMomentumData = (season) => {
        reloadedSeason = season;
      };

      context.onMomentumSeasonChange('2023');
      assert.equal(context.constructorMomentumState.season, '2023');
      assert.equal(reloadedSeason, '2023');
    });

    test('refreshMomentumData forces reload with forceRefresh = true', () => {
      const { context, elements } = createTestEnv();
      let calledForce = null;
      context.loadConstructorMomentumData = (season, force) => {
        calledForce = force;
      };

      elements['momentumSeasonSelect'].value = '2024';
      context.refreshMomentumData();
      assert.equal(calledForce, true);
    });
  });

  describe('10. HTML structure validation in index.html', () => {
    test('HTML contains all required elements for Issue #23', () => {
      const indexPath = path.join(__dirname, '..', 'index.html');
      const html = fs.readFileSync(indexPath, 'utf8');

      // Nav Tab Button
      assert.ok(html.includes('id="tabBtnMomentum"'), 'Nav tab button #tabBtnMomentum must exist');
      assert.ok(html.includes("switchMainTab('momentum')"), 'tabBtnMomentum must call switchMainTab("momentum")');

      // Section Container
      assert.ok(html.includes('id="constructor-momentum-section"'), 'Section #constructor-momentum-section must exist');

      // Season Selector & Controls
      assert.ok(html.includes('id="momentumSeasonSelect"'), 'Season select #momentumSeasonSelect must exist');
      assert.ok(html.includes('id="momentumCacheBadge"'), 'Badge #momentumCacheBadge must exist');
      assert.ok(html.includes('id="btnMomentumRefresh"'), 'Refresh button #btnMomentumRefresh must exist');
      assert.ok(html.includes('id="momentumError"'), 'Error banner #momentumError must exist');

      // KPIs
      assert.ok(html.includes('id="momentumKpiGainerTeam"'), 'Gainer KPI team must exist');
      assert.ok(html.includes('id="momentumKpiGainerDelta"'), 'Gainer KPI delta must exist');
      assert.ok(html.includes('id="momentumKpiLoserTeam"'), 'Loser KPI team must exist');
      assert.ok(html.includes('id="momentumKpiLoserDelta"'), 'Loser KPI delta must exist');
      assert.ok(html.includes('id="momentumKpiLeaderTeam"'), 'Leader KPI team must exist');
      assert.ok(html.includes('id="momentumKpiLeaderAvg"'), 'Leader KPI avg must exist');

      // Chart & Legend Pills
      assert.ok(html.includes('id="momentumTeamLegendPills"'), 'Pills container #momentumTeamLegendPills must exist');
      assert.ok(html.includes('id="constructorMomentumChart"'), 'Canvas #constructorMomentumChart must exist');

      // Table
      assert.ok(html.includes('id="constructorMomentumTable"'), 'Table #constructorMomentumTable must exist');
      assert.ok(html.includes('id="constructorMomentumTableBody"'), 'Table body #constructorMomentumTableBody must exist');
    });
  });
});
