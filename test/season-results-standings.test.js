const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createMockRaceData(season = '2023', raceName = 'Abu Dhabi Grand Prix') {
  return {
    MRData: {
      RaceTable: {
        season,
        round: '22',
        Races: [
          {
            season,
            round: '22',
            raceName,
            Circuit: {
              circuitId: 'yas_marina',
              circuitName: 'Yas Marina Circuit'
            },
            date: `${season}-11-26`,
            Results: [
              {
                position: '1',
                Driver: {
                  driverId: 'max_verstappen',
                  code: 'VER',
                  givenName: 'Max',
                  familyName: 'Verstappen'
                },
                Constructor: {
                  constructorId: 'red_bull',
                  name: 'Red Bull Racing'
                },
                laps: '58',
                Time: { time: '1:27:02.624' },
                points: '26'
              },
              {
                position: '2',
                Driver: {
                  driverId: 'leclerc',
                  code: 'LEC',
                  givenName: 'Charles',
                  familyName: 'Leclerc'
                },
                Constructor: {
                  constructorId: 'ferrari',
                  name: 'Ferrari'
                },
                laps: '58',
                Time: { time: '+17.993' },
                points: '18'
              },
              {
                position: '3',
                Driver: {
                  driverId: 'russell',
                  code: 'RUS',
                  givenName: 'George',
                  familyName: 'Russell'
                },
                Constructor: {
                  constructorId: 'mercedes',
                  name: 'Mercedes'
                },
                laps: '58',
                Time: { time: '+20.328' },
                points: '15'
              }
            ]
          }
        ]
      }
    }
  };
}

function createMockDriverStandingsData(season = '2023') {
  return {
    MRData: {
      StandingsTable: {
        season,
        StandingsLists: [
          {
            season,
            DriverStandings: [
              {
                position: '1',
                points: '575',
                wins: '19',
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
                points: '285',
                wins: '2',
                Driver: {
                  driverId: 'perez',
                  code: 'PER',
                  givenName: 'Sergio',
                  familyName: 'Perez'
                },
                Constructors: [{ constructorId: 'red_bull', name: 'Red Bull Racing' }]
              },
              {
                position: '3',
                points: '234',
                wins: '0',
                Driver: {
                  driverId: 'hamilton',
                  code: 'HAM',
                  givenName: 'Lewis',
                  familyName: 'Hamilton'
                },
                Constructors: [{ constructorId: 'mercedes', name: 'Mercedes' }]
              }
            ]
          }
        ]
      }
    }
  };
}

function createTestEnv(customFetch = null) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];

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
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(event, fn) {
        listeners[id] = listeners[id] || {};
        listeners[id][event] = listeners[id][event] || [];
        listeners[id][event].push(fn);
      },
      dispatchEvent(event) {
        const type = event.type || event;
        const targetListeners = listeners[id]?.[type] || [];
        targetListeners.forEach(fn => fn({ target: this, type }));
        if (typeof this['on' + type] === 'function') {
          this['on' + type]({ target: this, type });
        }
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

  const tabButtons = ['tabBtnAll', 'tabBtnProgression', 'tabBtnResults'].map(id => getOrCreateEl(id));

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
      const el = createMockElement('created_' + tag, tag);
      return el;
    }
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.data = config?.data || { labels: [], datasets: [] };
      this.destroyed = false;
      this.resized = false;
    }
    destroy() { this.destroyed = true; }
    resize() { this.resized = true; }
    update() {}
  }

  const storage = {};
  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const defaultFetch = async (url) => {
    queriedUrls.push(url);
    if (url.includes('/last/results.json')) {
      const match = url.match(/\/(\d{4}|current)\/last\/results\.json/);
      const s = match ? match[1] : '2023';
      return { ok: true, status: 200, json: async () => createMockRaceData(s) };
    }
    if (url.includes('/driverStandings.json')) {
      const match = url.match(/\/(\d{4}|current)\/driverStandings\.json/);
      const s = match ? match[1] : '2023';
      return { ok: true, status: 200, json: async () => createMockDriverStandingsData(s) };
    }
    if (url.includes('/constructorStandings.json')) {
      return { ok: true, status: 200, json: async () => ({ MRData: { StandingsTable: { StandingsLists: [] } } }) };
    }
    if (url.includes('/races.json')) {
      return { ok: true, status: 200, json: async () => ({ MRData: { RaceTable: { Races: [] } } }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const activeFetch = customFetch
    ? async (url) => { queriedUrls.push(url); return customFetch(url); }
    : defaultFetch;

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
    queriedUrls,
    storage: mockStorage
  };
}

describe('Issue #21: Latest Grand Prix Results & Standings Decoupling Fix', () => {

  describe('Module Exports & Function Availability', () => {
    test('exports all required race results and standings handlers and utilities', () => {
      const { exports } = createTestEnv();
      assert.strictEqual(typeof exports.fetchLatestRaceResults, 'function');
      assert.strictEqual(typeof exports.fetchDriverStandings, 'function');
      assert.strictEqual(typeof exports.onSeasonChange, 'function');
      assert.strictEqual(typeof exports.onResultsSeasonChange, 'function');
      assert.strictEqual(typeof exports.refreshCurrentSeason, 'function');
      assert.strictEqual(typeof exports.refreshResultsData, 'function');
      assert.strictEqual(typeof exports.populateSeasonDropdown, 'function');
    });
  });

  describe('JOLPICA F1 API Endpoint URL Construction', () => {
    test('fetchLatestRaceResults queries correct season last/results.json endpoint', async () => {
      const env = createTestEnv();
      await env.exports.fetchLatestRaceResults('2023');
      const resultsUrl = env.queriedUrls.find(u => u.includes('/2023/last/results.json'));
      assert.ok(resultsUrl, 'Must query https://api.jolpi.ca/ergast/f1/2023/last/results.json');
      assert.strictEqual(resultsUrl, `${env.exports.BASE_URL}/2023/last/results.json`);
    });

    test('fetchDriverStandings queries correct season driverStandings.json endpoint', async () => {
      const env = createTestEnv();
      await env.exports.fetchDriverStandings('2023');
      const standingsUrl = env.queriedUrls.find(u => u.includes('/2023/driverStandings.json'));
      assert.ok(standingsUrl, 'Must query https://api.jolpi.ca/ergast/f1/2023/driverStandings.json');
      assert.strictEqual(standingsUrl, `${env.exports.BASE_URL}/2023/driverStandings.json`);
    });

    test('historical seasons (e.g. 2021) pass target season in the JOLPICA API path', async () => {
      const env = createTestEnv();
      await env.exports.fetchLatestRaceResults('2021');
      await env.exports.fetchDriverStandings('2021');
      assert.ok(env.queriedUrls.some(u => u.includes('/2021/last/results.json')));
      assert.ok(env.queriedUrls.some(u => u.includes('/2021/driverStandings.json')));
    });

    test('defaults to UI season selector value when season parameter is omitted', async () => {
      const env = createTestEnv();
      env.elements['seasonSelect'].value = '2024';
      await env.exports.fetchLatestRaceResults();
      await env.exports.fetchDriverStandings();
      assert.ok(env.queriedUrls.some(u => u.includes('/2024/last/results.json')));
      assert.ok(env.queriedUrls.some(u => u.includes('/2024/driverStandings.json')));
    });
  });

  describe('Race Results & Standings Table UI Rendering', () => {
    test('renders Grand Prix summary metrics and race classification table', async () => {
      const env = createTestEnv();
      await env.exports.fetchLatestRaceResults('2023');

      const resultsHtml = env.elements['latest-race-results'].innerHTML;
      assert.ok(resultsHtml.includes('Abu Dhabi Grand Prix'), 'Includes Grand Prix name');
      assert.ok(resultsHtml.includes('Yas Marina Circuit'), 'Includes Circuit name');
      assert.ok(resultsHtml.includes('Max Verstappen'), 'Includes Winner name');
      assert.ok(resultsHtml.includes('Full Race Classification'), 'Includes Classification heading');
      assert.ok(resultsHtml.includes('Red Bull Racing'), 'Includes Constructor name');
      assert.ok(resultsHtml.includes('pos-1'), 'Applies pos-1 podium class');
      assert.ok(resultsHtml.includes('1:27:02.624'), 'Includes winner finishing time');
    });

    test('renders Driver Standings table with positions, points, and wins', async () => {
      const env = createTestEnv();
      await env.exports.fetchDriverStandings('2023');

      const standingsHtml = env.elements['driver-standings'].innerHTML;
      assert.ok(standingsHtml.includes('Max Verstappen'), 'Includes P1 driver');
      assert.ok(standingsHtml.includes('Sergio Perez'), 'Includes P2 driver');
      assert.ok(standingsHtml.includes('Lewis Hamilton'), 'Includes P3 driver');
      assert.ok(standingsHtml.includes('575'), 'Includes Verstappen points');
      assert.ok(standingsHtml.includes('19'), 'Includes Verstappen wins');
      assert.ok(standingsHtml.includes('pos-1'), 'Applies pos-1 podium badge');
      assert.ok(standingsHtml.includes('pos-2'), 'Applies pos-2 podium badge');
    });

    test('gracefully renders fallback card when race results return 404 or empty', async () => {
      const customFetch = async (url) => {
        if (url.includes('/last/results.json')) {
          return { ok: false, status: 404, json: async () => ({ detail: 'Race round not found' }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const env = createTestEnv(customFetch);
      await env.exports.fetchLatestRaceResults('2099');

      const resultsHtml = env.elements['latest-race-results'].innerHTML;
      assert.ok(
        resultsHtml.includes('No recent Grand Prix data available') || resultsHtml.includes('2099'),
        'Must display user-friendly placeholder message for unavailable seasons'
      );
    });

    test('gracefully renders fallback card when driver standings return 404 or empty', async () => {
      const customFetch = async (url) => {
        if (url.includes('/driverStandings.json')) {
          return { ok: false, status: 404, json: async () => ({ detail: 'Standings not found' }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const env = createTestEnv(customFetch);
      await env.exports.fetchDriverStandings('2099');

      const standingsHtml = env.elements['driver-standings'].innerHTML;
      assert.ok(
        standingsHtml.includes('No driver standings data available') || standingsHtml.includes('2099'),
        'Must display user-friendly placeholder message for unavailable standings'
      );
    });
  });

  describe('UI Coupling: Season Dropdown Selection & Lifecycle', () => {
    test('onSeasonChange updates results, standings, and progression lifecycle', async () => {
      const env = createTestEnv();
      await env.exports.onSeasonChange('2022');

      assert.strictEqual(env.elements['seasonSelect'].value, '2022');
      assert.ok(env.queriedUrls.some(u => u.includes('/2022/last/results.json')), 'Fetched 2022 race results');
      assert.ok(env.queriedUrls.some(u => u.includes('/2022/driverStandings.json')), 'Fetched 2022 driver standings');
    });

    test('changing #seasonSelect fires change event and updates tables', async () => {
      const env = createTestEnv();
      const domLoadedFns = env.listeners['DOMContentLoaded'] || [];
      domLoadedFns.forEach(fn => fn());
      const seasonSelect = env.elements['seasonSelect'];
      seasonSelect.value = '2021';

      seasonSelect.dispatchEvent({ type: 'change' });

      assert.ok(env.queriedUrls.some(u => u.includes('/2021/last/results.json')), 'Change event triggered 2021 results fetch');
      assert.ok(env.queriedUrls.some(u => u.includes('/2021/driverStandings.json')), 'Change event triggered 2021 standings fetch');
    });

    test('synchronizes value across both seasonSelect and resultsSeasonSelect dropdowns', async () => {
      const env = createTestEnv();
      await env.exports.onSeasonChange('2020');

      assert.strictEqual(env.elements['seasonSelect'].value, '2020');
      assert.strictEqual(env.elements['resultsSeasonSelect'].value, '2020');

      await env.exports.onResultsSeasonChange('2019');
      assert.strictEqual(env.elements['seasonSelect'].value, '2019');
      assert.strictEqual(env.elements['resultsSeasonSelect'].value, '2019');
    });

    test('refreshCurrentSeason reloads telemetry and tables for the selected season', async () => {
      const env = createTestEnv();
      env.elements['seasonSelect'].value = '2023';
      env.queriedUrls.length = 0;

      await env.exports.refreshCurrentSeason();

      assert.ok(env.queriedUrls.some(u => u.includes('/2023/last/results.json')), 'Refresh re-fetched 2023 results');
      assert.ok(env.queriedUrls.some(u => u.includes('/2023/driverStandings.json')), 'Refresh re-fetched 2023 standings');
    });

    test('refreshResultsData reloads race results and driver standings', async () => {
      const env = createTestEnv();
      env.elements['resultsSeasonSelect'].value = '2022';
      env.queriedUrls.length = 0;

      await env.exports.refreshResultsData();

      assert.ok(env.queriedUrls.some(u => u.includes('/2022/last/results.json')), 'Refresh re-fetched 2022 results');
      assert.ok(env.queriedUrls.some(u => u.includes('/2022/driverStandings.json')), 'Refresh re-fetched 2022 standings');
    });

    test('populateSeasonDropdown creates options down to 1950 in both selectors', () => {
      const env = createTestEnv();
      const seasonSel = env.elements['seasonSelect'];
      const resultsSel = env.elements['resultsSeasonSelect'];

      env.exports.populateSeasonDropdown(2026, 1950);

      assert.strictEqual(seasonSel.value, '2026');
      assert.strictEqual(resultsSel.value, '2026');
      assert.ok(seasonSel.children.length >= 75, 'Populates comprehensive historical seasons list');
      assert.ok(resultsSel.children.length >= 75, 'Populates comprehensive historical seasons list in results selector');
    });
  });

  describe('Real index.html Markup & Tab Navigation Verification', () => {
    test('index.html contains seasonSelect and resultsSeasonSelect with inline change handlers', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
      assert.ok(html.includes('id="seasonSelect"'), '#seasonSelect exists');
      assert.ok(html.includes('id="resultsSeasonSelect"'), '#resultsSeasonSelect exists');
      assert.ok(html.includes('onSeasonChange(this.value)'), '#seasonSelect has onSeasonChange hook');
      assert.ok(html.includes('onResultsSeasonChange(this.value)'), '#resultsSeasonSelect has onResultsSeasonChange hook');
    });

    test('index.html contains #latest-race-results and #driver-standings target containers', () => {
      const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
      assert.ok(html.includes('id="latest-race-results"'), '#latest-race-results container exists');
      assert.ok(html.includes('id="driver-standings"'), '#driver-standings container exists');
    });

    test('switchMainTab("results") displays results and standings sections', () => {
      const env = createTestEnv();
      env.exports.switchMainTab('results');

      assert.strictEqual(env.elements['latest-race-section'].style.display, 'block');
      assert.strictEqual(env.elements['standings-table-section'].style.display, 'block');
      assert.strictEqual(env.elements['progression-section'].style.display, 'none');
      assert.strictEqual(env.elements['lap-chart-section'].style.display, 'none');
    });
  });
});
