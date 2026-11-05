const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const pillElements = [];

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
      addEventListener() {},
      removeEventListener() {},
      getContext() { return {}; },
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
      if (selector && selector.includes('sprint-venue-pill')) {
        return pillElements;
      }
      return [];
    },
    addEventListener: () => {},
    createElement: (tag) => {
      const el = createMockElement('created_' + tag);
      if (tag === 'button') {
        pillElements.push(el);
      }
      return el;
    }
  };

  let destroyedChartCount = 0;
  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.data = config?.data || { labels: [], datasets: [] };
    }
    destroy() {
      destroyedChartCount++;
    }
    resize() {}
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
    addEventListener: () => {},
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart
  };

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
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
    exports: context.module.exports,
    elements: elementsProxy,
    mockStorage,
    context,
    getDestroyedChartCount: () => destroyedChartCount
  };
}

describe('Issue #6: Pre-2021 Seasons & Sprint Graceful Telemetry', () => {
  let env;

  beforeEach(() => {
    env = createTestEnv();
  });

  describe('JOLPICA F1 API Verification', () => {
    test('exports canonical JOLPICA F1 API base URL', () => {
      assert.equal(env.exports.BASE_URL, 'https://api.jolpi.ca/ergast/f1');
    });

    test('fetchAllJolpicaPages returns empty array for pre-2021 seasons (2019, 2020)', async (t) => {
      try {
        const sprints2020 = await env.exports.fetchAllJolpicaPages('2020', 'sprint', 'SprintResults');
        assert.ok(Array.isArray(sprints2020));
        assert.equal(sprints2020.length, 0, '2020 should have 0 sprint races');

        const sprints2019 = await env.exports.fetchAllJolpicaPages('2019', 'sprint', 'SprintResults');
        assert.ok(Array.isArray(sprints2019));
        assert.equal(sprints2019.length, 0, '2019 should have 0 sprint races');
      } catch (err) {
        if (err.message && (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND') || err.message.includes('429'))) {
          t.skip('Network unreachable or rate limited (429) - skipping live Jolpica API test');
          return;
        }
        throw err;
      }
    });

    test('fetchAllJolpicaPages returns sprint races for 2024 season', async (t) => {
      try {
        const sprints2024 = await env.exports.fetchAllJolpicaPages('2024', 'sprint', 'SprintResults');
        assert.ok(Array.isArray(sprints2024));
        assert.equal(sprints2024.length, 6, '2024 should have 6 sprint host venues');
        assert.ok(sprints2024[0].SprintResults.length > 0, 'Sprint venues should contain SprintResults');
      } catch (err) {
        if (err.message && (err.message.includes('fetch failed') || err.message.includes('ENOTFOUND') || err.message.includes('429'))) {
          t.skip('Network unreachable or rate limited (429) - skipping live Jolpica API test');
          return;
        }
        throw err;
      }
    });
  });

  describe('Pre-2021 Graceful Handling in loadSprintData', () => {
    test('handles 2020 season gracefully with placeholder UI and informational badge', async () => {
      const { loadSprintData, sprintState } = env.exports;
      const { sprintPlaceholder, sprintMainContent, sprintCacheBadge } = env.elements;

      await loadSprintData('2020');

      assert.equal(sprintState.season, '2020');
      assert.equal(sprintState.sprints.length, 0);
      assert.equal(sprintPlaceholder.style.display, 'block');
      assert.equal(sprintMainContent.style.display, 'none');
      assert.equal(sprintCacheBadge.className, 'cache-badge no-sprint');
      assert.match(sprintCacheBadge.textContent, /Sprint format introduced in 2021/i);
      assert.match(sprintPlaceholder.innerHTML, /2020 Formula 1 Season: No Sprint Races/);
      assert.match(sprintPlaceholder.innerHTML, /Sprint format introduced in 2021 — no sprint events for this season/);
    });

    test('handles 2019 season gracefully with placeholder UI and informational badge', async () => {
      const { loadSprintData, sprintState } = env.exports;
      const { sprintPlaceholder, sprintMainContent, sprintCacheBadge } = env.elements;

      await loadSprintData('2019');

      assert.equal(sprintState.season, '2019');
      assert.equal(sprintState.sprints.length, 0);
      assert.equal(sprintPlaceholder.style.display, 'block');
      assert.equal(sprintMainContent.style.display, 'none');
      assert.equal(sprintCacheBadge.className, 'cache-badge no-sprint');
      assert.match(sprintCacheBadge.textContent, /Sprint format introduced in 2021/i);
      assert.match(sprintPlaceholder.innerHTML, /2019 Formula 1 Season: No Sprint Races/);
    });

    test('handles network failure on pre-2021 gracefully without crashing', async () => {
      const networkFailFetch = async () => {
        throw new Error('fetch failed (network down)');
      };
      const failEnv = createTestEnv(networkFailFetch);
      const { loadSprintData, sprintState } = failEnv.exports;
      const { sprintPlaceholder, sprintMainContent, sprintCacheBadge } = failEnv.elements;

      await loadSprintData('2018');

      assert.equal(sprintState.season, '2018');
      assert.equal(sprintState.sprints.length, 0);
      assert.equal(sprintPlaceholder.style.display, 'block');
      assert.equal(sprintMainContent.style.display, 'none');
      assert.equal(sprintCacheBadge.className, 'cache-badge no-sprint');
      assert.match(sprintCacheBadge.textContent, /Sprint format introduced in 2021/i);
    });
  });

  describe('Safe Fallback for Empty Sprint Data Responses', () => {
    test('handles empty sprint results from API on >= 2021 season without crashing', async () => {
      const mockFetch = async (url) => {
        if (url.includes('/sprint.json')) {
          return {
            ok: true,
            json: async () => ({
              MRData: { total: '0', limit: '1000', offset: '0', RaceTable: { Races: [] } }
            })
          };
        }
        if (url.includes('/results.json')) {
          return {
            ok: true,
            json: async () => ({
              MRData: { total: '0', limit: '1000', offset: '0', RaceTable: { Races: [] } }
            })
          };
        }
        if (url.includes('/driverStandings.json')) {
          return {
            ok: true,
            json: async () => ({
              MRData: { StandingsTable: { StandingsLists: [{ DriverStandings: [] }] } }
            })
          };
        }
        return { ok: false, status: 404 };
      };

      const customEnv = createTestEnv(mockFetch);
      const { loadSprintData, sprintState } = customEnv.exports;
      const { sprintPlaceholder, sprintMainContent, sprintCacheBadge } = customEnv.elements;

      await loadSprintData('2022');

      assert.equal(sprintState.season, '2022');
      assert.equal(sprintState.sprints.length, 0);
      assert.equal(sprintPlaceholder.style.display, 'block');
      assert.equal(sprintMainContent.style.display, 'none');
      assert.equal(sprintCacheBadge.className, 'cache-badge no-sprint');
      assert.equal(sprintCacheBadge.textContent, 'ℹ️ No Sprint Events');
    });

    test('renderSprintData falls back to placeholder when sprints array is empty', () => {
      const { renderSprintData, sprintState } = env.exports;
      const { sprintPlaceholder, sprintMainContent, sprintCacheBadge } = env.elements;

      sprintState.season = '2020';
      sprintState.sprints = [];
      renderSprintData();

      assert.equal(sprintPlaceholder.style.display, 'block');
      assert.equal(sprintMainContent.style.display, 'none');
      assert.equal(sprintCacheBadge.className, 'cache-badge no-sprint');
    });
  });

  describe('Active Sprint Season Verification (2024)', () => {
    test('loads 2024 live telemetry with main content visible and placeholder hidden', async () => {
      const { loadSprintData, sprintState } = env.exports;
      const { sprintPlaceholder, sprintMainContent, sprintCacheBadge, sprintKpiPoolVal } = env.elements;

      await loadSprintData('2024');

      assert.equal(sprintState.season, '2024');
      assert.equal(sprintState.sprints.length, 6);
      assert.equal(sprintPlaceholder.style.display, 'none');
      assert.equal(sprintMainContent.style.display, 'block');
      assert.match(sprintCacheBadge.textContent, /Live Verified|Cached|Offline/);
      assert.match(sprintKpiPoolVal.textContent, /PTS/);
    });
  });

  describe('Chart Lifecycle and Transition Safety', () => {
    test('destroys previous chart instance when transitioning from 2024 to 2020', async () => {
      const { loadSprintData, onSprintSeasonChange } = env.exports;
      const { sprintPlaceholder, sprintMainContent } = env.elements;

      // First load 2024 sprint data (creates chart)
      await loadSprintData('2024');
      assert.equal(sprintMainContent.style.display, 'block');

      // Then switch to 2020 (should destroy chart and hide main content)
      await onSprintSeasonChange('2020');
      assert.equal(sprintPlaceholder.style.display, 'block');
      assert.equal(sprintMainContent.style.display, 'none');
      assert.ok(env.getDestroyedChartCount() > 0, 'Chart destroy() should have been called');
    });
  });

  describe('Disparity Metrics Engine Edge Cases', () => {
    test('computeSprintDisparityMetrics gracefully handles 0 sprint sessions', () => {
      const { computeSprintDisparityMetrics, sprintState } = env.exports;

      sprintState.season = '2020';
      sprintState.sprints = [];
      sprintState.results = [];
      sprintState.standings = [];

      const metrics = computeSprintDisparityMetrics();
      assert.equal(metrics.numSprintSessions, 0);
      assert.equal(metrics.sprintPtsAvailablePerDriver, 0);
      assert.equal(metrics.totalSprintPoolContested, 0);
      assert.equal(metrics.rows.length, 0);
    });
  });

  describe('User Controls and Season Dropdown Interaction', () => {
    test('onSprintSeasonChange resets venue round and loads target season', async () => {
      const { onSprintSeasonChange, sprintState } = env.exports;

      sprintState.venueRound = '5';
      await onSprintSeasonChange('2020');

      assert.equal(sprintState.season, '2020');
      assert.equal(sprintState.venueRound, 'all');
      assert.equal(env.elements.sprintPlaceholder.style.display, 'block');
    });

    test('setSprintComparisonScope updates scope and re-renders', () => {
      const { setSprintComparisonScope, sprintState } = env.exports;

      setSprintComparisonScope('weekends');
      assert.equal(sprintState.scope, 'weekends');

      setSprintComparisonScope('season');
      assert.equal(sprintState.scope, 'season');
    });

    test('renderSprintPlaceholder provides switch buttons back to active sprint seasons', () => {
      const { renderSprintPlaceholder } = env.exports;
      const { sprintPlaceholder } = env.elements;

      renderSprintPlaceholder('2019');
      assert.match(sprintPlaceholder.innerHTML, /Switch to 2024 Season/);
      assert.match(sprintPlaceholder.innerHTML, /Switch to Inaugural 2021 Season/);
    });
  });
});
