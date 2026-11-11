const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createMockDriverStandingsData(season = '2024', round = '22') {
  return {
    MRData: {
      StandingsTable: {
        season,
        round,
        StandingsLists: [
          {
            season,
            round,
            DriverStandings: [
              {
                position: '1',
                points: '400',
                wins: '8',
                Driver: {
                  driverId: 'max_verstappen',
                  code: 'VER',
                  givenName: 'Max',
                  familyName: 'Verstappen'
                },
                Constructors: [{ constructorId: 'red_bull', name: 'Red Bull Racing' }]
              },
              {
                position: '2',
                points: '340',
                wins: '4',
                Driver: {
                  driverId: 'norris',
                  code: 'NOR',
                  givenName: 'Lando',
                  familyName: 'Norris'
                },
                Constructors: [{ constructorId: 'mclaren', name: 'McLaren' }]
              },
              {
                position: '3',
                points: '320',
                wins: '3',
                Driver: {
                  driverId: 'leclerc',
                  code: 'LEC',
                  givenName: 'Charles',
                  familyName: 'Leclerc'
                },
                Constructors: [{ constructorId: 'ferrari', name: 'Ferrari' }]
              }
            ]
          }
        ]
      }
    }
  };
}

function createMockConstructorStandingsData(season = '2024', round = '22') {
  return {
    MRData: {
      StandingsTable: {
        season,
        round,
        StandingsLists: [
          {
            season,
            round,
            ConstructorStandings: [
              {
                position: '1',
                points: '600',
                wins: '6',
                Constructor: {
                  constructorId: 'mclaren',
                  name: 'McLaren',
                  nationality: 'British'
                }
              },
              {
                position: '2',
                points: '580',
                wins: '5',
                Constructor: {
                  constructorId: 'ferrari',
                  name: 'Ferrari',
                  nationality: 'Italian'
                }
              }
            ]
          }
        ]
      }
    }
  };
}

function createMockRacesData(season = '2024') {
  return {
    MRData: {
      RaceTable: {
        season,
        Races: [
          { round: '1', raceName: 'Bahrain Grand Prix' },
          { round: '2', raceName: 'Saudi Arabian Grand Prix' },
          { round: '21', raceName: 'São Paulo Grand Prix', Sprint: { date: '2024-11-02' } },
          { round: '22', raceName: 'Las Vegas Grand Prix' },
          { round: '23', raceName: 'Qatar Grand Prix', Sprint: { date: '2024-11-30' } },
          { round: '24', raceName: 'Abu Dhabi Grand Prix' }
        ]
      }
    }
  };
}

function createTestEnv(customFetch = null, customSetTimeout = null) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];
  const delayCalls = [];

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

  const defaultFetch = async (url) => {
    queriedUrls.push(url);
    if (url.includes('/driverStandings.json')) {
      return { ok: true, status: 200, json: async () => createMockDriverStandingsData() };
    }
    if (url.includes('/constructorStandings.json')) {
      return { ok: true, status: 200, json: async () => createMockConstructorStandingsData() };
    }
    if (url.includes('/races.json')) {
      return { ok: true, status: 200, json: async () => createMockRacesData() };
    }
    return { ok: true, status: 200, json: async () => ({ MRData: {} }) };
  };

  const activeFetch = customFetch
    ? async (url, opts) => { queriedUrls.push(url); return customFetch(url, opts); }
    : defaultFetch;

  const activeSetTimeout = customSetTimeout
    ? (fn, ms) => { delayCalls.push(ms); return customSetTimeout(fn, ms); }
    : (fn, ms) => { delayCalls.push(ms); if (typeof fn === 'function') fn(); return 1; };

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
  const scriptCode = scriptMatch[1];

  const context = {
    window: mockWindow,
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: activeFetch,
    console: { ...console, warn: () => {} },
    setTimeout: activeSetTimeout,
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
    delayCalls,
    mockStorage
  };
}

describe('Issue #22: Jolpica API Synchronization & fetchWithRetry Helper', () => {
  describe('Module Exports & Window Binding', () => {
    test('exports fetchWithRetry and loadClinchEngineData as functions', () => {
      const { exports } = createTestEnv();
      assert.strictEqual(typeof exports.fetchWithRetry, 'function', 'fetchWithRetry should be exported as a function');
      assert.strictEqual(typeof exports.loadClinchEngineData, 'function', 'loadClinchEngineData should be exported as a function');
    });

    test('exports clinch state, fallback, and control handlers', () => {
      const { exports } = createTestEnv();
      assert.ok(exports.clinchState, 'clinchState should be exported');
      assert.strictEqual(typeof exports.setClinchChampionshipMode, 'function');
      assert.strictEqual(typeof exports.onClinchSeasonChange, 'function');
      assert.strictEqual(typeof exports.onClinchRoundChange, 'function');
      assert.strictEqual(typeof exports.refreshClinchEngineData, 'function');
      assert.strictEqual(typeof exports.applyClinchPayload, 'function');
      assert.ok(exports.CLINCH_FALLBACK_2024, 'CLINCH_FALLBACK_2024 should be exported');
    });

    test('attaches fetchWithRetry and loadClinchEngineData to window object', () => {
      const { context } = createTestEnv();
      assert.strictEqual(typeof context.window.fetchWithRetry, 'function');
      assert.strictEqual(typeof context.window.loadClinchEngineData, 'function');
    });
  });

  describe('fetchWithRetry Core Functionality', () => {
    test('successfully returns parsed JSON on 1st attempt', async () => {
      const expectedData = { MRData: { status: 'OK', total: '1' } };
      let fetchCount = 0;
      const customFetch = async () => {
        fetchCount++;
        return { ok: true, status: 200, json: async () => expectedData };
      };

      const env = createTestEnv(customFetch);
      const res = await env.exports.fetchWithRetry('https://api.jolpi.ca/test.json');

      assert.strictEqual(fetchCount, 1);
      assert.deepStrictEqual(res, expectedData);
    });

    test('passes request options (headers, method) correctly to fetch', async () => {
      let passedOptions = null;
      const customFetch = async (url, opts) => {
        passedOptions = opts;
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      };

      const env = createTestEnv(customFetch);
      const options = { method: 'POST', headers: { 'X-Custom-Header': 'f1-test' } };
      await env.exports.fetchWithRetry('https://api.jolpi.ca/test.json', options);

      assert.deepStrictEqual(passedOptions, options);
    });

    test('uses default retries = 2 and delay = 500 when options/retries/delay are omitted', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        if (attempts <= 2) {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return { ok: true, status: 200, json: async () => ({ done: true }) };
      };

      const env = createTestEnv(customFetch);
      const res = await env.exports.fetchWithRetry('https://api.jolpi.ca/test.json');

      assert.strictEqual(attempts, 3, 'Default retries=2 should allow up to 3 total attempts');
      assert.deepStrictEqual(res, { done: true });
      assert.deepStrictEqual(env.delayCalls, [500, 1000], 'Delays should follow default exponential backoff [500, 1000]');
    });
  });

  describe('fetchWithRetry Exponential Backoff on Transient Errors', () => {
    test('retries on HTTP 429 rate limit with exponential backoff and succeeds', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        if (attempts === 1) {
          return { ok: false, status: 429, statusText: 'Too Many Requests' };
        }
        return { ok: true, status: 200, json: async () => ({ recovered: true }) };
      };

      const env = createTestEnv(customFetch);
      const res = await env.exports.fetchWithRetry('https://api.jolpi.ca/test.json', {}, 2, 200);

      assert.strictEqual(attempts, 2);
      assert.deepStrictEqual(res, { recovered: true });
      assert.deepStrictEqual(env.delayCalls, [200]);
    });

    test('retries on HTTP 500 and 502 with exponential backoff progression', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        if (attempts === 1) return { ok: false, status: 500 };
        if (attempts === 2) return { ok: false, status: 502 };
        return { ok: true, status: 200, json: async () => ({ serverFixed: true }) };
      };

      const env = createTestEnv(customFetch);
      const res = await env.exports.fetchWithRetry('https://api.jolpi.ca/test.json', {}, 3, 100);

      assert.strictEqual(attempts, 3);
      assert.deepStrictEqual(res, { serverFixed: true });
      assert.deepStrictEqual(env.delayCalls, [100, 200], 'Delay should double on each retry: 100 -> 200');
    });

    test('retries on transient network exceptions (TypeError fetch failed) and recovers', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        if (attempts < 3) {
          throw new TypeError('fetch failed: connection reset by peer');
        }
        return { ok: true, status: 200, json: async () => ({ networkOnline: true }) };
      };

      const env = createTestEnv(customFetch);
      const res = await env.exports.fetchWithRetry('https://api.jolpi.ca/test.json', {}, 2, 50);

      assert.strictEqual(attempts, 3);
      assert.deepStrictEqual(res, { networkOnline: true });
      assert.deepStrictEqual(env.delayCalls, [50, 100]);
    });

    test('throws error when transient error persists past maximum retries', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        return { ok: false, status: 429, statusText: 'Too Many Requests' };
      };

      const env = createTestEnv(customFetch);
      await assert.rejects(
        async () => env.exports.fetchWithRetry('https://api.jolpi.ca/test.json', {}, 2, 50),
        (err) => {
          assert.strictEqual(attempts, 3, 'Should attempt 1 initial + 2 retries');
          assert.match(err.message, /429/);
          assert.strictEqual(err.status, 429);
          return true;
        }
      );
      assert.deepStrictEqual(env.delayCalls, [50, 100]);
    });

    test('respects retries = 0 by failing immediately without delay', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        return { ok: false, status: 500, statusText: 'Internal Server Error' };
      };

      const env = createTestEnv(customFetch);
      await assert.rejects(
        async () => env.exports.fetchWithRetry('https://api.jolpi.ca/test.json', {}, 0, 500),
        /500/
      );

      assert.strictEqual(attempts, 1);
      assert.strictEqual(env.delayCalls.length, 0, 'No delay should be waited when retries = 0');
    });
  });

  describe('fetchWithRetry Non-Transient Errors & Immediate Rejection', () => {
    test('does not retry on HTTP 404 Not Found and throws immediately', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        return { ok: false, status: 404, statusText: 'Not Found' };
      };

      const env = createTestEnv(customFetch);
      await assert.rejects(
        async () => env.exports.fetchWithRetry('https://api.jolpi.ca/invalid.json', {}, 3, 200),
        (err) => {
          assert.strictEqual(attempts, 1, 'Should NOT retry 404');
          assert.strictEqual(err.status, 404);
          return true;
        }
      );
      assert.strictEqual(env.delayCalls.length, 0);
    });

    test('does not retry on HTTP 400 Bad Request and throws immediately', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        return { ok: false, status: 400, statusText: 'Bad Request' };
      };

      const env = createTestEnv(customFetch);
      await assert.rejects(
        async () => env.exports.fetchWithRetry('https://api.jolpi.ca/bad.json', {}, 2, 200),
        (err) => {
          assert.strictEqual(attempts, 1, 'Should NOT retry 400');
          assert.strictEqual(err.status, 400);
          return true;
        }
      );
      assert.strictEqual(env.delayCalls.length, 0);
    });

    test('does not retry on AbortError and throws immediately', async () => {
      let attempts = 0;
      const customFetch = async () => {
        attempts++;
        const abortErr = new Error('The user aborted a request.');
        abortErr.name = 'AbortError';
        throw abortErr;
      };

      const env = createTestEnv(customFetch);
      await assert.rejects(
        async () => env.exports.fetchWithRetry('https://api.jolpi.ca/aborted.json', {}, 2, 100),
        (err) => {
          assert.strictEqual(attempts, 1);
          assert.strictEqual(err.name, 'AbortError');
          return true;
        }
      );
      assert.strictEqual(env.delayCalls.length, 0);
    });
  });

  describe('loadClinchEngineData Live API Synchronization', () => {
    test('fetches live driver standings & races and updates cache badge to Live Verified', async () => {
      const env = createTestEnv();
      const badge = env.elements['clinchCacheBadge'];

      await env.exports.loadClinchEngineData('2024', 'latest', false);

      assert.strictEqual(badge.textContent, '⚡ Live Verified');
      assert.ok(badge.classList.contains('cached'));

      // Check endpoints queried
      assert.ok(env.queriedUrls.some(u => u.includes('/2024/driverStandings.json')));
      assert.ok(env.queriedUrls.some(u => u.includes('/2024/races.json')));

      // Check updated state
      const state = env.exports.clinchState;
      assert.strictEqual(state.season, '2024');
      assert.strictEqual(state.standings.length, 3);
      assert.strictEqual(state.standings[0].id, 'max_verstappen');
      assert.strictEqual(state.standings[0].points, 400);

      // Check KPI element rendering
      assert.strictEqual(env.elements['clinchKpiLeaderName'].textContent, 'Max Verstappen');
      assert.strictEqual(env.elements['clinchKpiDeficitVal'].textContent, '+60 PTS');
    });

    test('synchronizes constructor standings when mode is set to constructors', async () => {
      const env = createTestEnv();
      env.exports.setClinchChampionshipMode('constructors');

      await env.exports.loadClinchEngineData('2024', 'latest', true);

      assert.ok(env.queriedUrls.some(u => u.includes('/2024/constructorStandings.json')));
      const state = env.exports.clinchState;
      assert.strictEqual(state.mode, 'constructors');
      assert.strictEqual(state.standings[0].id, 'mclaren');
      assert.strictEqual(state.standings[0].points, 600);
      assert.strictEqual(env.elements['clinchKpiLeaderName'].textContent, 'McLaren');
    });

    test('caches payload in localStorage on live synchronization', async () => {
      const env = createTestEnv();
      await env.exports.loadClinchEngineData('2024', 'latest', false);

      const cacheKey = 'f1_clinch_v1_2024_drivers_latest';
      const stored = env.mockStorage.getItem(cacheKey);
      assert.ok(stored, 'localStorage should contain cached clinch payload');

      const parsed = JSON.parse(stored);
      assert.strictEqual(parsed.season, '2024');
      assert.strictEqual(parsed.mode, 'drivers');
      assert.strictEqual(parsed.standings[0].id, 'max_verstappen');
    });

    test('loads from localStorage cache and sets badge to Cached (Instant)', async () => {
      const env = createTestEnv();
      const cacheKey = 'f1_clinch_v1_2024_drivers_latest';
      const cachedPayload = {
        season: '2024',
        mode: 'drivers',
        round: 'latest',
        completedRound: 22,
        races: [{ round: '1', raceName: 'Cached GP' }],
        standings: [
          { id: 'norris', name: 'Lando Norris', code: 'NOR', team: 'McLaren', points: 410, wins: 5 }
        ]
      };
      env.mockStorage.setItem(cacheKey, JSON.stringify(cachedPayload));

      await env.exports.loadClinchEngineData('2024', 'latest', false);

      // Verify no network requests were made
      assert.strictEqual(env.queriedUrls.length, 0, 'No fetch calls should be made on cache hit');
      assert.strictEqual(env.elements['clinchCacheBadge'].textContent, '⚡ Cached (Instant)');
      assert.strictEqual(env.exports.clinchState.standings[0].id, 'norris');
      assert.strictEqual(env.elements['clinchKpiLeaderName'].textContent, 'Lando Norris');
    });

    test('bypasses localStorage cache when forceRefresh = true', async () => {
      const env = createTestEnv();
      const cacheKey = 'f1_clinch_v1_2024_drivers_latest';
      const stalePayload = {
        season: '2024',
        mode: 'drivers',
        round: 'latest',
        completedRound: 20,
        races: [],
        standings: [{ id: 'old_leader', name: 'Old Leader', points: 100 }]
      };
      env.mockStorage.setItem(cacheKey, JSON.stringify(stalePayload));

      await env.exports.loadClinchEngineData('2024', 'latest', true);

      assert.ok(env.queriedUrls.length >= 2, 'Should fetch from network when forceRefresh = true');
      assert.strictEqual(env.elements['clinchCacheBadge'].textContent, '⚡ Live Verified');
      assert.strictEqual(env.exports.clinchState.standings[0].id, 'max_verstappen');
    });
  });

  describe('loadClinchEngineData Resilience & Fallback Handling', () => {
    test('recovers transparently from transient 429 using fetchWithRetry without entering fallback', async () => {
      let attempts = 0;
      const customFetch = async (url) => {
        attempts++;
        if (attempts === 1 && url.includes('/driverStandings.json')) {
          return { ok: false, status: 429, statusText: 'Rate Limited' };
        }
        if (url.includes('/driverStandings.json')) {
          return { ok: true, status: 200, json: async () => createMockDriverStandingsData() };
        }
        return { ok: true, status: 200, json: async () => createMockRacesData() };
      };

      const env = createTestEnv(customFetch);
      await env.exports.loadClinchEngineData('2024', 'latest', true);

      assert.strictEqual(env.elements['clinchCacheBadge'].textContent, '⚡ Live Verified');
      assert.strictEqual(env.exports.clinchState.standings[0].id, 'max_verstappen');
    });

    test('falls back gracefully to CLINCH_FALLBACK_2024 with Offline Telemetry badge when network fails', async () => {
      const customFetch = async () => {
        throw new TypeError('fetch failed (network down)');
      };

      const env = createTestEnv(customFetch);
      await env.exports.loadClinchEngineData('2024', 'latest', true);

      assert.strictEqual(env.elements['clinchCacheBadge'].textContent, '⚡ Offline Telemetry');
      const state = env.exports.clinchState;
      assert.strictEqual(state.standings[0].id, 'max_verstappen');
      assert.strictEqual(state.standings[0].points, 437, 'Should match CLINCH_FALLBACK_2024 r24 driver points');
    });

    test('falls back gracefully when API returns empty standings', async () => {
      const customFetch = async (url) => {
        if (url.includes('/driverStandings.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ MRData: { StandingsTable: { StandingsLists: [] } } })
          };
        }
        return { ok: true, status: 200, json: async () => createMockRacesData() };
      };

      const env = createTestEnv(customFetch);
      await env.exports.loadClinchEngineData('2024', 'latest', true);

      assert.strictEqual(env.elements['clinchCacheBadge'].textContent, '⚡ Offline Telemetry');
      assert.ok(env.exports.clinchState.standings.length > 0);
    });
  });

  describe('User Controls & Dropdown Integration', () => {
    test('onClinchSeasonChange updates clinchState and triggers data load', async () => {
      const env = createTestEnv();
      env.exports.onClinchSeasonChange('2023');
      await new Promise(resolve => setImmediate(resolve));

      assert.strictEqual(env.exports.clinchState.season, '2023');
      assert.strictEqual(env.exports.clinchState.round, 'latest');
      assert.ok(env.queriedUrls.some(u => u.includes('/2023/driverStandings.json')));
    });

    test('onClinchRoundChange updates round and triggers round-specific endpoint query', async () => {
      const env = createTestEnv();
      env.exports.onClinchRoundChange('21');
      await new Promise(resolve => setImmediate(resolve));

      assert.strictEqual(env.exports.clinchState.round, '21');
      assert.ok(env.queriedUrls.some(u => u.includes('/2024/21/driverStandings.json')));
    });

    test('refreshClinchEngineData invokes loadClinchEngineData with forceRefresh = true', async () => {
      const env = createTestEnv();
      const cacheKey = 'f1_clinch_v1_2024_drivers_latest';
      env.mockStorage.setItem(cacheKey, JSON.stringify({
        season: '2024',
        mode: 'drivers',
        round: 'latest',
        completedRound: 20,
        races: [],
        standings: [{ id: 'old', points: 10 }]
      }));

      env.exports.refreshClinchEngineData();
      await new Promise(resolve => setImmediate(resolve));

      // forceRefresh bypasses cache
      assert.ok(env.queriedUrls.length > 0);
      assert.strictEqual(env.elements['clinchCacheBadge'].textContent, '⚡ Live Verified');
    });

    test('DOMContentLoaded listener triggers loadClinchEngineData without ReferenceError', () => {
      const env = createTestEnv();
      const domLoadedHandlers = env.listeners['DOMContentLoaded'] || [];
      assert.ok(domLoadedHandlers.length > 0, 'Should register DOMContentLoaded listener');

      assert.doesNotThrow(() => {
        domLoadedHandlers.forEach(handler => handler());
      });
    });
  });
});
