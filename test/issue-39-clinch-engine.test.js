const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = null) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];

  function createMockElement(id, tag = 'div') {
    const classes = new Set();
    return {
      id,
      tagName: tag.toUpperCase(),
      classes,
      classList: {
        add(...cls) { cls.forEach(c => classes.add(c)); },
        remove(...cls) { cls.forEach(c => classes.delete(c)); },
        toggle(c, force) {
          if (force !== undefined) {
            force ? classes.add(c) : classes.delete(c);
          } else {
            classes.has(c) ? classes.delete(c) : classes.add(c);
          }
        },
        contains(c) { return classes.has(c); }
      },
      innerHTML: '',
      textContent: '',
      value: '',
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(v) {
        classes.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
      },
      disabled: false,
      style: {},
      children: [],
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(event, fn) {
        listeners[id] = listeners[id] || {};
        listeners[id][event] = listeners[id][event] || [];
        listeners[id][event].push(fn);
      },
      removeEventListener() {},
      dispatchEvent(event) {
        const type = event.type || event;
        (listeners[id]?.[type] || []).forEach(fn => fn({ target: this, type }));
      },
      getContext() { return {}; },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; }
    };
  }

  function getOrCreateEl(id) {
    if (!elements[id]) elements[id] = createMockElement(id);
    return elements[id];
  }

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: () => [],
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener: () => {},
    createElement: (tag) => createMockElement('created_' + tag, tag)
  };

  const storage = {};
  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const defaultFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ MRData: {} })
  });

  const activeFetch = customFetch
    ? async (url, opts) => { queriedUrls.push(url); return customFetch(url, opts); }
    : async (url, opts) => { queriedUrls.push(url); return defaultFetch(url, opts); };

  class MockChart {
    constructor() {}
    update() {}
    destroy() {}
    resize() {}
  }

  const mockWindow = {
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener: () => {},
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart
  };

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');

  const context = {
    window: mockWindow,
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: activeFetch,
    console: { ...console, warn: () => {} },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);

  return {
    context,
    exports: context.module.exports,
    elements: new Proxy(elements, {
      get(target, prop) {
        if (typeof prop === 'string') return getOrCreateEl(prop);
        return target[prop];
      }
    }),
    queriedUrls,
    mockStorage
  };
}

function makeRaces(count = 24, sprintRounds = [5, 6, 11, 19, 21, 23]) {
  return Array.from({ length: count }, (_, i) => {
    const rnd = i + 1;
    const race = { round: String(rnd), raceName: `Round ${rnd} Grand Prix` };
    if (sprintRounds.includes(rnd)) race.Sprint = { date: '2024-11-02' };
    return race;
  });
}

describe('Issue #39: Clinch Engine WCC Math, Real Countbacks, Tie & Completed-Season States', () => {
  describe('1. WCC vs WDC & Season-Aware Points Ceilings', () => {
    test('getClinchMaxEventPoints distinguishes WDC (1 car) from WCC (2 cars) and FL eras', () => {
      const { exports } = createTestEnv();

      assert.deepStrictEqual({ ...exports.getClinchMaxEventPoints('drivers', '2024') }, {
        cars: 1,
        gp: 26,
        gpNoFl: 25,
        sprint: 8,
        fastestLap: 1
      });
      assert.deepStrictEqual({ ...exports.getClinchMaxEventPoints('constructors', '2024') }, {
        cars: 2,
        gp: 44,
        gpNoFl: 43,
        sprint: 15,
        fastestLap: 1
      });
      // 2025+ discontinued fastest lap point
      assert.deepStrictEqual({ ...exports.getClinchMaxEventPoints('drivers', '2025') }, {
        cars: 1,
        gp: 25,
        gpNoFl: 25,
        sprint: 8,
        fastestLap: 0
      });
      assert.deepStrictEqual({ ...exports.getClinchMaxEventPoints('constructors', '2025') }, {
        cars: 2,
        gp: 43,
        gpNoFl: 43,
        sprint: 15,
        fastestLap: 0
      });
      // 2021 sprint scale [3, 2, 1]
      assert.deepStrictEqual({ ...exports.getClinchMaxEventPoints('constructors', '2021') }, {
        cars: 2,
        gp: 44,
        gpNoFl: 43,
        sprint: 5,
        fastestLap: 1
      });
    });

    test('WCC mode calculates maxPointsRemaining with 44 GP / 15 Sprint (2024) and 43 GP / 15 Sprint (2025)', () => {
      const { exports, elements } = createTestEnv();

      // 2024 Constructors after R22 -> 2 GP (R23 Qatar Sprint + R24 Abu Dhabi) and 1 Sprint remaining
      // Max remaining = 2 * 44 + 1 * 15 = 103 pts
      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, [21, 23]),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 608, wins: 5, p2: 10, p3: 5 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 584, wins: 5, p2: 6, p3: 10 }
        ]
      });

      assert.strictEqual(elements['clinchKpiMaxPoints'].textContent, '103 PTS');
      assert.strictEqual(elements['clinchKpiMaxPointsFormula'].textContent, '(2 × 44) + (1 × 15) Max Scale');
      assert.strictEqual(elements['clinchGaugeP2Ceiling'].textContent, 'P2 (FER) Max Possible Ceiling: 687 PTS');
      // Lead = 24, P2 max ceiling = 687, tiebreak not guaranteed (ferrari can reach 7 wins) -> threshold = 688, magic = 80
      assert.strictEqual(elements['clinchKpiMagicNumber'].textContent, '80 PTS');

      // 2025 Constructors after R22 (no FL point: 43 GP / 15 Sprint) -> 2 * 43 + 1 * 15 = 101 pts
      exports.applyClinchPayload({
        season: '2025',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, [21, 23]),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 608, wins: 5, p2: 10, p3: 5 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 584, wins: 5, p2: 6, p3: 10 }
        ]
      });

      assert.strictEqual(elements['clinchKpiMaxPoints'].textContent, '101 PTS');
      assert.strictEqual(elements['clinchKpiMaxPointsFormula'].textContent, '(2 × 43) + (1 × 15) Max Scale');
      assert.strictEqual(elements['clinchKpiMagicNumber'].textContent, '78 PTS');
    });

    test('WCC next-round clinch scenario checks use 44 GP cap instead of single-driver 26 cap', () => {
      const { exports, elements } = createTestEnv();

      // 2024 Constructors after R22 (no remaining sprints: R23 + R24 are normal GPs -> 88 pts remaining)
      // McLaren leads Ferrari by 15 pts (600 vs 585). Leaving R23, 1 GP (44 pts) remains -> need lead of 45 pts.
      // Required swing at R23 = 45 - 15 = +30 pts. Possible in WCC (30 <= 44), impossible in WDC (30 > 26).
      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, []),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 600, wins: 5, p2: 10, p3: 5 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 585, wins: 5, p2: 6, p3: 10 }
        ]
      });

      const listHtml = elements['clinchScenarioList'].innerHTML;
      assert.match(listHtml, /CLINCH OPPORTUNITY AT ROUND 23 GRAND PRIX/);
      assert.match(listHtml, /\+30 pts/);
      assert.match(listHtml, /43 pts/);
      assert.match(listHtml, /≤ 13 pts/);

      // Now make lead -10 (575 vs 585? no, say 590 vs 585 = +5 -> swing needed = 45 - 5 = +40 <= 44; try +0 lead: swing needed = +45 > 44 -> NO MATHEMATICAL CLINCH)
      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, []),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 585, wins: 6, p2: 10, p3: 5 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 585, wins: 5, p2: 6, p3: 10 }
        ]
      });

      const noClinchHtml = elements['clinchScenarioList'].innerHTML;
      assert.match(noClinchHtml, /NO MATHEMATICAL CLINCH AT ROUND 23 GRAND PRIX/);
      assert.match(noClinchHtml, /P1\+P2 \+ Fastest Lap \(\+44 pts\)/);
      assert.doesNotMatch(noClinchHtml, /\+26 pts/);
    });
  });

  describe('2. Two-Car WCC Simulation Controls', () => {
    test('renderClinchSimControls exposes two car selectors per constructor in WCC mode and one in WDC mode', () => {
      const { exports, elements } = createTestEnv();

      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, []),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 600, wins: 5, p2: 10, p3: 5 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 580, wins: 5, p2: 6, p3: 10 }
        ]
      });

      const wccHtml = elements['clinchSimControlsGrid'].innerHTML;
      assert.match(wccHtml, /data-car-slot="1"/);
      assert.match(wccHtml, /data-car-slot="2"/);
      assert.match(wccHtml, /Car 1 finish position for McLaren/);
      assert.match(wccHtml, /Car 2 finish position for McLaren/);

      exports.applyClinchPayload({
        season: '2024',
        mode: 'drivers',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, []),
        standings: [
          { id: 'max_verstappen', name: 'Max Verstappen', code: 'VER', team: 'Red Bull', constructorId: 'red_bull', points: 400, wins: 8, p2: 4, p3: 1 },
          { id: 'norris', name: 'Lando Norris', code: 'NOR', team: 'McLaren', constructorId: 'mclaren', points: 340, wins: 3, p2: 6, p3: 3 }
        ]
      });

      const wdcHtml = elements['clinchSimControlsGrid'].innerHTML;
      assert.match(wdcHtml, /data-car-slot="1"/);
      assert.doesNotMatch(wdcHtml, /data-car-slot="2"/);
    });

    test('simulating both cars + FL in 2024 WCC adds up to 44 points and increments wins and P2s', () => {
      const { exports, elements } = createTestEnv();

      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, []),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 600, wins: 5, p2: 8, p3: 4 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 580, wins: 5, p2: 6, p3: 9 }
        ]
      });

      exports.onClinchSimPosChange('mclaren', '1', 1);
      exports.onClinchSimPos2Change('mclaren', '2');
      exports.onClinchSimFlChange('mclaren', true);

      assert.strictEqual(exports.getSimulatedDeltaPoints('mclaren'), 44);
      assert.strictEqual(elements['clinchKpiLeaderSub'].textContent, 'McLaren • 644 PTS (6 Wins)');
      assert.match(elements['clinchTiebreakerContent'].innerHTML, /P1: 6 \| P2: 9 \| P3: 4/);
      assert.strictEqual(elements['clinchKpiRemainingEvents'].textContent, '1 GP / 0 SPR');

      // Setting Car 1 to DNF while Car 2 is P2 keeps FL eligible (18 + 1 = 19 pts)
      exports.onClinchSimPosChange('mclaren', 'DNF', 1);
      assert.strictEqual(exports.getSimulatedDeltaPoints('mclaren'), 19);

      // Setting Car 2 to DNF too clears FL (0 pts)
      exports.onClinchSimPosChange('mclaren', 'DNF', 2);
      assert.strictEqual(exports.getSimulatedDeltaPoints('mclaren'), 0);
      assert.strictEqual(exports.clinchState.simFastestLapId, null);
    });

    test('applyClinchSimPreset populates two-car finishes in WCC mode', () => {
      const { exports } = createTestEnv();

      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '22',
        completedRound: 22,
        races: makeRaces(24, []),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 600, wins: 5, p2: 8, p3: 4 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 580, wins: 5, p2: 6, p3: 9 }
        ]
      });

      exports.applyClinchSimPreset('leader_win');
      assert.strictEqual(exports.clinchState.simPositions['mclaren'], '1');
      assert.strictEqual(exports.clinchState.simPositions2['mclaren'], '2');
      assert.strictEqual(exports.clinchState.simPositions['ferrari'], '3');
      assert.strictEqual(exports.clinchState.simPositions2['ferrari'], '4');
      assert.strictEqual(exports.getSimulatedDeltaPoints('mclaren'), 44);
      assert.strictEqual(exports.getSimulatedDeltaPoints('ferrari'), 27);
    });
  });

  describe('3. Real Countbacks from /{season}/results.json', () => {
    test('loadClinchEngineData computes real p2/p3 counts up to completedRound instead of dividing points', async () => {
      const mockFetch = async (url) => {
        if (url.includes('/driverStandings.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              MRData: {
                StandingsTable: {
                  StandingsLists: [{
                    round: '2',
                    DriverStandings: [
                      {
                        position: '1',
                        points: '250', // High points deliberately to expose old points/95 fabrication
                        wins: '2',
                        Driver: { driverId: 'driver_a', code: 'DRA', givenName: 'Driver', familyName: 'Alpha' },
                        Constructors: [{ constructorId: 'team_a', name: 'Team Alpha' }]
                      },
                      {
                        position: '2',
                        points: '200',
                        wins: '0',
                        Driver: { driverId: 'driver_b', code: 'DRB', givenName: 'Driver', familyName: 'Beta' },
                        Constructors: [{ constructorId: 'team_b', name: 'Team Beta' }]
                      }
                    ]
                  }]
                }
              }
            })
          };
        }
        if (url.includes('/races.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              MRData: {
                RaceTable: { Races: makeRaces(4, []) }
              }
            })
          };
        }
        if (url.includes('/results.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              MRData: {
                total: '3',
                limit: '1000',
                RaceTable: {
                  Races: [
                    {
                      round: '1',
                      Results: [
                        { position: '1', positionText: '1', Driver: { driverId: 'driver_a' }, Constructor: { constructorId: 'team_a' } },
                        { position: '2', positionText: '2', Driver: { driverId: 'driver_b' }, Constructor: { constructorId: 'team_b' } },
                        { position: '3', positionText: 'R', Driver: { driverId: 'driver_retired' }, Constructor: { constructorId: 'team_b' } }
                      ]
                    },
                    {
                      round: '2',
                      Results: [
                        { position: '1', positionText: '1', Driver: { driverId: 'driver_a' }, Constructor: { constructorId: 'team_a' } },
                        { position: '3', positionText: '3', Driver: { driverId: 'driver_b' }, Constructor: { constructorId: 'team_b' } }
                      ]
                    },
                    {
                      // Round 3 is beyond completedRound=2 and must be ignored!
                      round: '3',
                      Results: [
                        { position: '2', positionText: '2', Driver: { driverId: 'driver_a' }, Constructor: { constructorId: 'team_a' } },
                        { position: '3', positionText: '3', Driver: { driverId: 'driver_a' }, Constructor: { constructorId: 'team_a' } }
                      ]
                    }
                  ]
                }
              }
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ MRData: {} }) };
      };

      const env = createTestEnv(mockFetch);
      await env.exports.loadClinchEngineData('2024', '2', true);

      assert.ok(env.queriedUrls.some(u => u.includes('/2024/results.json')));
      const [driverA, driverB] = env.exports.clinchState.standings;

      // driver_a won both rounds 1 & 2 and had ZERO P2 or P3 finishes (round 3 excluded)
      assert.strictEqual(driverA.wins, 2);
      assert.strictEqual(driverA.p2, 0);
      assert.strictEqual(driverA.p3, 0);

      // driver_b had 0 wins, 1 P2 (round 1), 1 P3 (round 2)
      assert.strictEqual(driverB.wins, 0);
      assert.strictEqual(driverB.p2, 1);
      assert.strictEqual(driverB.p3, 1);
      assert.strictEqual(env.exports.clinchState.countbackVerified, true);
    });

    test('loadClinchEngineData computes real constructor countbacks including two-car finishes per round', async () => {
      const mockFetch = async (url) => {
        if (url.includes('/constructorStandings.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              MRData: {
                StandingsTable: {
                  StandingsLists: [{
                    round: '2',
                    ConstructorStandings: [
                      {
                        position: '1',
                        points: '195',
                        wins: '2',
                        Constructor: { constructorId: 'mclaren', name: 'McLaren', nationality: 'British' }
                      },
                      {
                        position: '2',
                        points: '195',
                        wins: '0',
                        Constructor: { constructorId: 'ferrari', name: 'Ferrari', nationality: 'Italian' }
                      }
                    ]
                  }]
                }
              }
            })
          };
        }
        if (url.includes('/races.json')) {
          return { ok: true, status: 200, json: async () => ({ MRData: { RaceTable: { Races: makeRaces(2, []) } } }) };
        }
        if (url.includes('/results.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              MRData: {
                total: '2',
                limit: '1000',
                RaceTable: {
                  Races: [
                    {
                      round: '1',
                      Results: [
                        { position: '1', positionText: '1', Driver: { driverId: 'norris' }, Constructor: { constructorId: 'mclaren' } },
                        { position: '2', positionText: '2', Driver: { driverId: 'leclerc' }, Constructor: { constructorId: 'ferrari' } },
                        { position: '3', positionText: '3', Driver: { driverId: 'sainz' }, Constructor: { constructorId: 'ferrari' } },
                        { position: '4', positionText: '4', Driver: { driverId: 'piastri' }, Constructor: { constructorId: 'mclaren' } }
                      ]
                    },
                    {
                      round: '2',
                      Results: [
                        { position: '1', positionText: '1', Driver: { driverId: 'piastri' }, Constructor: { constructorId: 'mclaren' } },
                        { position: '2', positionText: '2', Driver: { driverId: 'sainz' }, Constructor: { constructorId: 'ferrari' } },
                        { position: '3', positionText: '3', Driver: { driverId: 'leclerc' }, Constructor: { constructorId: 'ferrari' } },
                        { position: '4', positionText: '4', Driver: { driverId: 'norris' }, Constructor: { constructorId: 'mclaren' } }
                      ]
                    }
                  ]
                }
              }
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ MRData: {} }) };
      };

      const env = createTestEnv(mockFetch);
      env.exports.setClinchChampionshipMode('constructors');
      await env.exports.loadClinchEngineData('2024', 'latest', true);

      const [mcl, fer] = env.exports.clinchState.standings;
      // McLaren: 2 P1, 0 P2, 0 P3, 2 P4
      assert.strictEqual(mcl.wins, 2);
      assert.strictEqual(mcl.p2, 0);
      assert.strictEqual(mcl.p3, 0);
      assert.deepStrictEqual(Array.from(mcl.countback), [2, 0, 0, 2]);

      // Ferrari: 0 P1, 2 P2, 2 P3
      assert.strictEqual(fer.wins, 0);
      assert.strictEqual(fer.p2, 2);
      assert.strictEqual(fer.p3, 2);
      assert.deepStrictEqual(Array.from(fer.countback), [0, 2, 2]);
    });
  });

  describe('4. Strict Countback Tie-Breaker (No False Clinch on Ties)', () => {
    test('winsTieBreaker uses strict > when remainingRacesForB === 0', () => {
      const { exports } = createTestEnv();

      const a = { wins: 4, p2: 3, p3: 2, countback: [4, 3, 2, 1] };
      const bSame = { wins: 4, p2: 3, p3: 2, countback: [4, 3, 2, 1] };
      const bFewerP3 = { wins: 4, p2: 3, p3: 1, countback: [4, 3, 1, 2] };
      const bFewerP4 = { wins: 4, p2: 3, p3: 2, countback: [4, 3, 2, 0] };

      assert.strictEqual(exports.winsTieBreaker(a, bSame, 0), false, 'Exact countback tie must return false');
      assert.strictEqual(exports.winsTieBreaker(bSame, a, 0), false, 'Reverse exact tie must also return false');
      assert.strictEqual(exports.winsTieBreaker(a, bFewerP3, 0), true, 'More P3 finishes wins countback strictly');
      assert.strictEqual(exports.winsTieBreaker(a, bFewerP4, 0), true, 'More P4 finishes resolves deeper countback strictly');
    });

    test('completed season with exact points and countback tie is NOT marked CLINCHED', () => {
      const { exports, elements } = createTestEnv();

      exports.applyClinchPayload({
        season: '2024',
        mode: 'drivers',
        round: '24',
        completedRound: 24,
        races: makeRaces(24, []),
        standings: [
          { id: 'ver', name: 'Max Verstappen', code: 'VER', team: 'Red Bull', constructorId: 'red_bull', points: 395, wins: 7, p2: 4, p3: 3, countback: [7, 4, 3] },
          { id: 'nor', name: 'Lando Norris', code: 'NOR', team: 'McLaren', constructorId: 'mclaren', points: 395, wins: 7, p2: 4, p3: 3, countback: [7, 4, 3] }
        ]
      });

      assert.strictEqual(elements['clinchKpiMagicNumber'].textContent, '1 PTS');
      assert.doesNotMatch(elements['clinchKpiMagicNumber'].textContent, /CLINCHED/);
      assert.match(elements['clinchScenarioList'].innerHTML, /DEADLOCKED AT SEASON END/);
      assert.doesNotMatch(elements['clinchScenarioList'].innerHTML, /WORLD CHAMPIONSHIP CLINCHED/);
      assert.doesNotMatch(elements['clinchScenarioList'].innerHTML, /CLINCH OPPORTUNITY AT THE FINALE/);
      assert.match(elements['clinchTiebreakerContent'].innerHTML, /deadlocked on countback/i);

      const matrixHtml = elements['clinchMatrixTableBody'].innerHTML;
      assert.doesNotMatch(matrixHtml, />CLINCHED</);
      assert.doesNotMatch(matrixHtml, /MATHEMATICALLY ELIMINATED/);
      assert.strictEqual((matrixHtml.match(/IN CONTENTION/g) || []).length, 2);
    });
  });

  describe('5. Completed-Season Simulation Lock (remainingRaces === 0)', () => {
    test('ignores simulation deltas, wins, and controls when remainingRaces === 0', () => {
      const { exports, elements } = createTestEnv();

      exports.applyClinchPayload({
        season: '2024',
        mode: 'constructors',
        round: '24',
        completedRound: 24,
        races: makeRaces(24, []),
        standings: [
          { id: 'mclaren', name: 'McLaren', code: 'MCL', team: 'McLaren', constructorId: 'mclaren', points: 666, wins: 6, p2: 10, p3: 5 },
          { id: 'ferrari', name: 'Ferrari', code: 'FER', team: 'Ferrari', constructorId: 'ferrari', points: 652, wins: 5, p2: 6, p3: 11 }
        ]
      });

      assert.strictEqual(exports.isClinchSimulationAvailable(), false);
      assert.match(elements['clinchSimControlsGrid'].innerHTML, /disabled/);

      // Attempt handler mutations and preset triggers
      exports.onClinchSimPosChange('ferrari', '1', 1);
      exports.onClinchSimPos2Change('ferrari', '2');
      exports.onClinchSimFlChange('ferrari', true);
      exports.applyClinchSimPreset('p2_win_leader_dnf');

      assert.strictEqual(exports.clinchState.simPositions['ferrari'], '0');
      assert.strictEqual(exports.clinchState.simPositions2['ferrari'], '0');
      assert.strictEqual(exports.clinchState.simFastestLapId, null);

      // Even if state is forcibly mutated externally, math engine must ignore simulation deltas
      exports.clinchState.simPositions['ferrari'] = '1';
      exports.clinchState.simPositions2['ferrari'] = '2';
      exports.clinchState.simFastestLapId = 'ferrari';

      assert.strictEqual(exports.isClinchSimActive(), false);
      assert.strictEqual(exports.getSimulatedDeltaPoints('ferrari'), 0);

      exports.recalculateAndRenderClinchMath();

      assert.strictEqual(elements['clinchKpiLeaderName'].textContent, 'McLaren');
      assert.strictEqual(elements['clinchKpiLeaderSub'].textContent, 'McLaren • 666 PTS (6 Wins)');
      assert.strictEqual(elements['clinchKpiDeficitVal'].textContent, '+14 PTS');
      assert.strictEqual(elements['clinchKpiDeficitSub'].textContent, 'vs Ferrari (652 PTS)');
      assert.strictEqual(elements['clinchKpiMagicNumber'].textContent, 'CLINCHED 🏆');
      assert.strictEqual(elements['clinchSimActiveBadge'].style.display, 'none');
    });
  });
});
