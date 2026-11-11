const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv() {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];

  function createMockElement(id, tag = 'div') {
    return {
      id,
      tagName: tag.toUpperCase(),
      classes: new Set(),
      classList: {
        add(...cls) { cls.forEach(c => this.classes.add(c)); },
        remove(...cls) { cls.forEach(c => this.classes.delete(c)); },
        contains(c) { return this.classes.has(c); }
      },
      innerHTML: '',
      textContent: '',
      value: '',
      disabled: false,
      style: {},
      children: [],
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(event, fn) {
        listeners[id] = listeners[id] || {};
        listeners[id][event] = listeners[id][event] || [];
        listeners[id][event].push(fn);
      },
      dispatchEvent(event) {
        const type = event.type || event;
        (listeners[id]?.[type] || []).forEach(fn => fn({ target: this, type }));
      }
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
    createElement: (tag) => createMockElement('created_' + tag, tag)
  };

  const activeFetch = async (url) => {
    queriedUrls.push(url);
    if (url.includes('/races.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          MRData: {
            RaceTable: {
              season: '2023',
              Races: [
                { round: '1', raceName: 'Bahrain Grand Prix' },
                { round: '2', raceName: 'Saudi Arabian Grand Prix' }
              ]
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
            RaceTable: {
              Races: [
                {
                  round: '1',
                  Laps: [
                    { number: '1', Timings: [{ driverId: 'alonso', position: '1' }] },
                    { number: '2', Timings: [{ driverId: 'alonso', position: '1' }] }
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

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  const scriptCode = scriptMatch[1];

  const context = {
    window: { document: mockDoc, addEventListener: () => {}, removeEventListener: () => {}, Chart: class MockChart { update() {} destroy() {} resize() {} } },
    document: mockDoc,
    localStorage: { getItem: () => null, setItem: () => {} },
    Chart: class MockChart { update() {} destroy() {} resize() {} },
    fetch: activeFetch,
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
    queriedUrls
  };
}

describe('Issue #20: Season Laps Led leaderboard aggregation & 2024 fallback isolation', () => {
  test('computeSeasonLapsLed for historical seasons (2023) does not leak 2024 fallback on empty data', () => {
    const { computeSeasonLapsLed, SEASON_LAPS_LED_FALLBACK_2024 } = createTestEnv().exports;
    const res = computeSeasonLapsLed([], [], '2023');
    assert.strictEqual(res.isFallback, false);
    assert.strictEqual(res.leaderboard.length, 0);
    assert.strictEqual(res.leader, null);
    assert.notStrictEqual(res, SEASON_LAPS_LED_FALLBACK_2024);
  });

  test('computeSeasonLapsLed for 2024 retains 2024 fallback on empty data', () => {
    const { computeSeasonLapsLed, SEASON_LAPS_LED_FALLBACK_2024 } = createTestEnv().exports;
    const res = computeSeasonLapsLed([], [], '2024');
    assert.strictEqual(res.totalLapsLed, SEASON_LAPS_LED_FALLBACK_2024.totalLapsLed);
    assert.strictEqual(res.leader.driverId, 'max_verstappen');
  });

  test('renderSeasonLapsLedLeaderboard shows clean no-telemetry state for empty historical season', () => {
    const env = createTestEnv();
    const { renderSeasonLapsLedLeaderboard } = env.exports;
    const emptyData = {
      leaderboard: [],
      totalLapsLed: 0,
      leader: null,
      season: '2022',
      loadedRounds: [],
      totalRounds: 22,
      isFallback: false
    };
    renderSeasonLapsLedLeaderboard(emptyData);

    const topDriver = env.elements['lapsLedTopDriverName'];
    const badge = env.elements['lapsLedCardBadge'];
    assert.strictEqual(topDriver.textContent, '—');
    assert.ok(badge.textContent.includes('NO TELEMETRY') || badge.textContent.includes('ROUND TELEMETRY'));
  });

  test('loadSeasonLapsLed fetches rounds and computes aggregate for requested season', async () => {
    const env = createTestEnv();
    const { loadSeasonLapsLed } = env.exports;
    const result = await loadSeasonLapsLed('2023');
    assert.ok(result);
    assert.strictEqual(result.season, '2023');
  });
});
