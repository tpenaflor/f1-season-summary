const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPaginatedTestEnv(customFetch) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];

  function createMockElement(id, tag = 'div') {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      classes: new Set(),
      classList: {
        add(...cls) { cls.forEach(c => this.classes.add(c)); },
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
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
      disabled: false,
      style: {},
      children: [],
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
        listeners[id] = listeners[id] || {};
        listeners[id][event] = listeners[id][event] || [];
        listeners[id][event].push(fn);
      },
      dispatchEvent(event) {
        const type = event.type || event;
        (listeners[id]?.[type] || []).forEach(fn => fn({ target: this, type }));
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
    return el;
  }

  function getOrCreateEl(id) {
    if (!elements[id]) elements[id] = createMockElement(id);
    return elements[id];
  }

  const elementsProxy = new Proxy(elements, {
    get(target, prop) {
      if (typeof prop === 'string') return getOrCreateEl(prop);
      return target[prop];
    }
  });

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: () => [],
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => createMockElement('created_' + tag + '_' + Math.random().toString(36).substring(2, 7), tag)
  };

  const storage = {};
  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.data = config?.data || { labels: [], datasets: [] };
    }
    destroy() {}
    resize() {}
    update() {}
  }

  const activeFetch = async (url, opts) => {
    queriedUrls.push(url);
    if (customFetch) {
      return customFetch(url, opts);
    }
    return { ok: true, status: 200, json: async () => ({ MRData: {} }) };
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
      localStorage: mockStorage,
      Chart: MockChart
    },
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: activeFetch,
    console: { ...console, warn: () => {}, error: () => {} },
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
    queriedUrls,
    storage
  };
}

// Helper: build 24 rounds of mock race results
function buildMockSeasonRaces(numRounds = 24, resultsPerRound = 20) {
  const races = [];
  const grandPrixNames = [
    'Bahrain Grand Prix', 'Saudi Arabian Grand Prix', 'Australian Grand Prix', 'Japanese Grand Prix',
    'Chinese Grand Prix', 'Miami Grand Prix', 'Emilia Romagna Grand Prix', 'Monaco Grand Prix',
    'Canadian Grand Prix', 'Spanish Grand Prix', 'Austrian Grand Prix', 'British Grand Prix',
    'Hungarian Grand Prix', 'Belgian Grand Prix', 'Dutch Grand Prix', 'Italian Grand Prix',
    'Azerbaijan Grand Prix', 'Singapore Grand Prix', 'United States Grand Prix', 'Mexico City Grand Prix',
    'São Paulo Grand Prix', 'Las Vegas Grand Prix', 'Qatar Grand Prix', 'Abu Dhabi Grand Prix'
  ];

  for (let round = 1; round <= numRounds; round++) {
    const raceName = grandPrixNames[round - 1] || `Round ${round} Grand Prix`;
    const results = [];
    for (let pos = 1; pos <= resultsPerRound; pos++) {
      const driverId = pos === 1 ? 'max_verstappen' : pos === 2 ? 'norris' : `driver_${pos}`;
      results.push({
        position: String(pos),
        positionText: String(pos),
        grid: String(pos),
        laps: '57',
        status: 'Finished',
        Driver: {
          driverId,
          givenName: pos === 1 ? 'Max' : pos === 2 ? 'Lando' : `Driver`,
          familyName: pos === 1 ? 'Verstappen' : pos === 2 ? 'Norris' : `${pos}`,
          code: pos === 1 ? 'VER' : pos === 2 ? 'NOR' : `D${pos}`
        },
        Constructor: {
          constructorId: pos === 1 ? 'red_bull' : pos === 2 ? 'mclaren' : 'ferrari',
          name: pos === 1 ? 'Red Bull Racing' : pos === 2 ? 'McLaren' : 'Ferrari'
        }
      });
    }

    races.push({
      season: '2024',
      round: String(round),
      raceName,
      Circuit: { circuitId: `circuit_${round}`, circuitName: `${raceName} Circuit` },
      date: `2024-${String(Math.min(12, Math.ceil(round / 2))).padStart(2, '0')}-15`,
      Results: results
    });
  }
  return races;
}

// Helper: slice races into pages respecting Jolpica 100 results per page cap
function paginateRacesBy100Results(races, pageLimit = 100) {
  // Flatten results into { raceMeta, result }
  const flat = [];
  races.forEach(r => {
    (r.Results || []).forEach(res => {
      flat.push({
        season: r.season,
        round: r.round,
        raceName: r.raceName,
        Circuit: r.Circuit,
        date: r.date,
        result: res
      });
    });
  });

  const total = flat.length;
  const pages = [];

  for (let offset = 0; offset < total; offset += pageLimit) {
    const slice = flat.slice(offset, offset + pageLimit);
    const roundMap = {};
    slice.forEach(item => {
      const rnd = String(item.round);
      if (!roundMap[rnd]) {
        roundMap[rnd] = {
          season: item.season,
          round: rnd,
          raceName: item.raceName,
          Circuit: item.Circuit,
          date: item.date,
          Results: []
        };
      }
      roundMap[rnd].Results.push(item.result);
    });

    pages.push({
      offset,
      limit: pageLimit,
      total,
      races: Object.values(roundMap)
    });
  }

  return { total, pageLimit, pages };
}

describe('Issue #25: Jolpica API 100-record pagination & season rounds completeness', () => {

  test('fetchSeasonResults retrieves all 24 rounds when Jolpica caps limit at 100', async () => {
    const fullRaces = buildMockSeasonRaces(24, 20); // 24 * 20 = 480 results
    const { total, pageLimit, pages } = paginateRacesBy100Results(fullRaces, 100);

    const customFetch = async (url) => {
      if (url.includes('/results.json')) {
        const urlObj = new URL(url);
        const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
        const page = pages.find(p => p.offset === offset);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: String(total),
              limit: String(pageLimit),
              offset: String(offset),
              RaceTable: {
                season: '2024',
                Races: page ? page.races : []
              }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const env = createPaginatedTestEnv(customFetch);
    const races = await env.exports.fetchSeasonResults('2024');

    // Must retrieve all 24 rounds, not truncated to 5-6
    assert.strictEqual(races.length, 24, 'Must return all 24 rounds');
    assert.strictEqual(races[0].round, '1');
    assert.strictEqual(races[0].raceName, 'Bahrain Grand Prix');
    assert.strictEqual(races[23].round, '24');
    assert.strictEqual(races[23].raceName, 'Abu Dhabi Grand Prix');

    // Check pagination offsets queried
    const resultsQueries = env.queriedUrls.filter(u => u.includes('/results.json'));
    assert.strictEqual(resultsQueries.length, 5, 'Should make 5 paginated requests for 480 items (100 per page)');
    assert.ok(resultsQueries[0].includes('offset=0'));
    assert.ok(resultsQueries[1].includes('offset=100'));
    assert.ok(resultsQueries[2].includes('offset=200'));
    assert.ok(resultsQueries[3].includes('offset=300'));
    assert.ok(resultsQueries[4].includes('offset=400'));
  });

  test('fetchSeasonResults merges split race results when a round crosses a 100-item page boundary', async () => {
    // 6 rounds with 20 drivers = 120 results -> Page 1 gets 100 (R1-R5), Page 2 gets 20 (R6)
    // If round 5 has 25 drivers and round 1-4 have 20 drivers: 80 + 25 = 105 results.
    // Round 5 has 20 results on page 1, 5 on page 2.
    const customFetch = async (url) => {
      const urlObj = new URL(url);
      const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);

      if (offset === 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '120',
              limit: '100',
              offset: '0',
              RaceTable: {
                season: '2024',
                Races: [
                  { round: '1', raceName: 'Bahrain GP', Results: new Array(20).fill({ position: '1' }) },
                  { round: '2', raceName: 'Saudi GP', Results: new Array(20).fill({ position: '1' }) },
                  { round: '3', raceName: 'Australian GP', Results: new Array(20).fill({ position: '1' }) },
                  { round: '4', raceName: 'Japanese GP', Results: new Array(20).fill({ position: '1' }) },
                  { round: '5', raceName: 'Chinese GP', Results: [{ position: '1', Driver: { driverId: 'max_verstappen' } }] }
                ]
              }
            }
          })
        };
      } else {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '120',
              limit: '100',
              offset: '100',
              RaceTable: {
                season: '2024',
                Races: [
                  { round: '5', raceName: 'Chinese GP', Results: [{ position: '2', Driver: { driverId: 'norris' } }] },
                  { round: '6', raceName: 'Miami GP', Results: new Array(18).fill({ position: '1' }) }
                ]
              }
            }
          })
        };
      }
    };

    const env = createPaginatedTestEnv(customFetch);
    const races = await env.exports.fetchSeasonResults('2024');

    assert.strictEqual(races.length, 6, 'Must consolidate into 6 unique rounds');
    const r5 = races.find(r => r.round === '5');
    assert.ok(r5);
    assert.strictEqual(r5.Results.length, 2, 'Round 5 must have results from both pages merged');
    assert.strictEqual(r5.Results[0].Driver.driverId, 'max_verstappen');
    assert.strictEqual(r5.Results[1].Driver.driverId, 'norris');
  });

  test('#lapRoundSelect populates all 24 rounds for the active season', async () => {
    const fullRaces = buildMockSeasonRaces(24, 20);
    const { total, pageLimit, pages } = paginateRacesBy100Results(fullRaces, 100);

    const customFetch = async (url) => {
      if (url.includes('/results.json')) {
        const urlObj = new URL(url);
        const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
        const page = pages.find(p => p.offset === offset);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: String(total),
              limit: String(pageLimit),
              offset: String(offset),
              RaceTable: {
                season: '2024',
                Races: page ? page.races : []
              }
            }
          })
        };
      }
      if (url.includes('/laps.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '57',
              limit: '2000',
              RaceTable: {
                Races: [{
                  Laps: [
                    { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] }
                  ]
                }]
              }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const env = createPaginatedTestEnv(customFetch);
    await env.exports.loadLapTelemetry('2024', '1', true);

    const roundSelect = env.elements['lapRoundSelect'];
    assert.ok(roundSelect);
    assert.strictEqual(roundSelect.children.length, 24, '#lapRoundSelect must have 24 options for all rounds');
    assert.strictEqual(roundSelect.children[0].value, '1');
    assert.ok(roundSelect.children[0].textContent.includes('Round 1 - Bahrain Grand Prix'));
    assert.strictEqual(roundSelect.children[23].value, '24');
    assert.ok(roundSelect.children[23].textContent.includes('Round 24 - Abu Dhabi Grand Prix'));
    assert.strictEqual(roundSelect.value, '1');
  });

  test('loadLapTelemetry correctly loads a round beyond the first page (Round 15)', async () => {
    const fullRaces = buildMockSeasonRaces(24, 20);
    const { total, pageLimit, pages } = paginateRacesBy100Results(fullRaces, 100);

    const customFetch = async (url) => {
      if (url.includes('/results.json')) {
        const urlObj = new URL(url);
        const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
        const page = pages.find(p => p.offset === offset);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: String(total),
              limit: String(pageLimit),
              offset: String(offset),
              RaceTable: {
                season: '2024',
                Races: page ? page.races : []
              }
            }
          })
        };
      }
      if (url.includes('/15/laps.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '72',
              limit: '2000',
              RaceTable: {
                Races: [{
                  Laps: [
                    { number: '1', Timings: [{ driverId: 'norris', position: '1' }] },
                    { number: '2', Timings: [{ driverId: 'norris', position: '1' }] }
                  ]
                }]
              }
            }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ MRData: {} }) };
    };

    const env = createPaginatedTestEnv(customFetch);
    const state = await env.exports.loadLapTelemetry('2024', '15', true);

    assert.strictEqual(state.round, '15');
    const venueTitle = env.elements['lapChartVenueTitle'];
    assert.ok(venueTitle.textContent.includes('Dutch Grand Prix'), 'Title must display Dutch GP for round 15');

    const roundSelect = env.elements['lapRoundSelect'];
    assert.strictEqual(roundSelect.children.length, 24);
    assert.strictEqual(roundSelect.value, '15');
  });

  test('loadSeasonLapsLed iterates across all 24 rounds and aggregates full season leaderboard', async () => {
    const fullRaces = buildMockSeasonRaces(24, 20);
    const { total, pageLimit, pages } = paginateRacesBy100Results(fullRaces, 100);
    const lapsQueriedRounds = [];

    const customFetch = async (url) => {
      if (url.includes('/results.json')) {
        const urlObj = new URL(url);
        const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
        const page = pages.find(p => p.offset === offset);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: String(total),
              limit: String(pageLimit),
              offset: String(offset),
              RaceTable: {
                season: '2024',
                Races: page ? page.races : []
              }
            }
          })
        };
      }
      if (url.includes('/laps.json')) {
        const roundMatch = url.match(/\/2024\/(\d+)\/laps\.json/);
        const rnd = roundMatch ? roundMatch[1] : '1';
        lapsQueriedRounds.push(rnd);
        const leader = parseInt(rnd, 10) % 2 === 0 ? 'norris' : 'max_verstappen';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '10',
              limit: '2000',
              RaceTable: {
                Races: [{
                  round: rnd,
                  Laps: [
                    { number: '1', Timings: [{ driverId: leader, position: '1' }] },
                    { number: '2', Timings: [{ driverId: leader, position: '1' }] }
                  ]
                }]
              }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const env = createPaginatedTestEnv(customFetch);
    const ledData = await env.exports.loadSeasonLapsLed('2024');

    assert.ok(ledData);
    assert.strictEqual(ledData.totalRounds, 24, 'Total rounds must be 24');
    assert.strictEqual(ledData.loadedRounds.length, 24, 'All 24 rounds must be loaded');

    // Check that all 24 rounds had their laps fetched
    assert.strictEqual(new Set(lapsQueriedRounds).size, 24, 'Must query laps across all 24 distinct rounds');

    // Button state
    const btnLoadAll = env.elements['btnLoadAllSeasonLaps'];
    assert.strictEqual(btnLoadAll.textContent, '✓ Full Season Loaded');
    assert.strictEqual(btnLoadAll.disabled, true);

    // Leaderboard must have aggregated leaders
    assert.ok(ledData.leaderboard.length >= 2);
    assert.strictEqual(ledData.leaderboard[0].lapsLed + ledData.leaderboard[1].lapsLed, 48, '24 rounds * 2 laps = 48 total laps led');
  });

  test('loadLapTelemetry falls back to round-specific results when fetchSeasonResults fails', async () => {
    const customFetch = async (url) => {
      // Season results fail
      if (url.includes('/2024/results.json')) {
        return { ok: false, status: 500 };
      }
      // Round-specific results succeed
      if (url.includes('/2024/7/results.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              RaceTable: {
                season: '2024',
                Races: [{
                  round: '7',
                  raceName: 'Emilia Romagna Grand Prix',
                  Circuit: { circuitId: 'imola', circuitName: 'Autodromo Enzo e Dino Ferrari' },
                  Results: [
                    {
                      position: '1',
                      Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' },
                      Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' },
                      status: 'Finished'
                    }
                  ]
                }]
              }
            }
          })
        };
      }
      if (url.includes('/2024/7/laps.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '63',
              limit: '2000',
              RaceTable: {
                Races: [{
                  Laps: [
                    { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }] }
                  ]
                }]
              }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const env = createPaginatedTestEnv(customFetch);
    const state = await env.exports.loadLapTelemetry('2024', '7', true);

    assert.strictEqual(state.round, '7');
    const venueTitle = env.elements['lapChartVenueTitle'];
    assert.ok(venueTitle.textContent.includes('Emilia Romagna Grand Prix'));
  });

});
