const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MOCK_STATUS_DATA = {
  MRData: {
    xmlns: 'http://ergast.com/mrd/1.5',
    series: 'f1',
    url: 'https://api.jolpi.ca/ergast/f1/2024/status.json?limit=100',
    limit: '100',
    offset: '0',
    total: '5',
    StatusTable: {
      season: '2024',
      Status: [
        { statusId: '1', count: '380', status: 'Finished' },
        { statusId: '11', count: '15', status: '+1 Lap' },
        { statusId: '5', count: '8', status: 'Engine' },
        { statusId: '3', count: '6', status: 'Accident' },
        { statusId: '4', count: '4', status: 'Collision' }
      ]
    }
  }
};

function createTestEnv(customFetch) {
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
      style: {},
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
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(JSON.stringify(MOCK_STATUS_DATA))
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
    window: context.window,
    queriedUrls
  };
}

describe('Issue #26: fetchSeasonStatus handles parsed JSON from fetchWithRetry', () => {
  test('returns Status array when fetchWithRetry provides parsed JSON', async () => {
    const { exports: f1App, queriedUrls } = createTestEnv();

    const statusList = await f1App.fetchSeasonStatus('2024');

    assert(Array.isArray(statusList), 'Expected statusList to be an array');
    assert.equal(statusList.length, 5);
    assert.deepEqual(statusList[0], { statusId: '1', count: '380', status: 'Finished' });
    assert.deepEqual(statusList[2], { statusId: '5', count: '8', status: 'Engine' });

    assert.equal(queriedUrls.length, 1);
    assert.equal(queriedUrls[0], 'https://api.jolpi.ca/ergast/f1/2024/status.json?limit=100');
  });

  test('defaults to 2024 season if no season parameter is passed', async () => {
    const { exports: f1App, queriedUrls } = createTestEnv();

    const statusList = await f1App.fetchSeasonStatus();

    assert(Array.isArray(statusList), 'Expected statusList to be an array');
    assert.equal(statusList.length, 5);
    assert.equal(queriedUrls[0], 'https://api.jolpi.ca/ergast/f1/2024/status.json?limit=100');
  });

  test('constructs correct URL for a different season (e.g. 2023)', async () => {
    const { exports: f1App, queriedUrls } = createTestEnv();

    const statusList = await f1App.fetchSeasonStatus('2023');

    assert(Array.isArray(statusList), 'Expected statusList to be an array');
    assert.equal(queriedUrls[0], 'https://api.jolpi.ca/ergast/f1/2023/status.json?limit=100');
  });

  test('returns null when API returns data without StatusTable.Status', async () => {
    const customFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ MRData: { StatusTable: {} } })
    });
    const { exports: f1App } = createTestEnv(customFetch);

    const result = await f1App.fetchSeasonStatus('2024');
    assert.equal(result, null);
  });

  test('returns null when API returns empty object or unexpected payload', async () => {
    const customFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({})
    });
    const { exports: f1App } = createTestEnv(customFetch);

    const result = await f1App.fetchSeasonStatus('2024');
    assert.equal(result, null);
  });

  test('returns null when fetchWithRetry encounters an HTTP error', async () => {
    const customFetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not found' })
    });
    const { exports: f1App } = createTestEnv(customFetch);

    const result = await f1App.fetchSeasonStatus('2024');
    assert.equal(result, null);
  });

  test('returns null when network request throws an error', async () => {
    const customFetch = async () => {
      throw new Error('Network error');
    };
    const { exports: f1App } = createTestEnv(customFetch);

    const result = await f1App.fetchSeasonStatus('2024');
    assert.equal(result, null);
  });

  test('falls back to raw fetch when fetchWithRetry is not defined', async () => {
    let rawFetchCalled = false;
    let requestedUrl = '';
    const customFetch = async (url) => {
      rawFetchCalled = true;
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(JSON.stringify(MOCK_STATUS_DATA))
      };
    };

    const { context } = createTestEnv();

    const subContext = vm.createContext({
      BASE_URL: 'https://api.jolpi.ca/ergast/f1',
      fetch: customFetch
    });

    const fn = vm.runInContext(`(${context.window.fetchSeasonStatus.toString()})`, subContext);
    const result = await fn('2024');

    assert.equal(rawFetchCalled, true);
    assert.equal(requestedUrl, 'https://api.jolpi.ca/ergast/f1/2024/status.json?limit=100');
    assert(Array.isArray(result));
    assert.equal(result.length, 5);
    assert.deepEqual(result[0], { statusId: '1', count: '380', status: 'Finished' });
  });

  test('fallback fetch returns null if response.ok is false', async () => {
    const customFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    });

    const { context } = createTestEnv();

    const subContext = vm.createContext({
      BASE_URL: 'https://api.jolpi.ca/ergast/f1',
      fetch: customFetch
    });

    const fn = vm.runInContext(`(${context.window.fetchSeasonStatus.toString()})`, subContext);
    const result = await fn('2024');

    assert.equal(result, null);
  });

  test('fallback fetch returns null if fetch throws an error', async () => {
    const customFetch = async () => {
      throw new Error('Fallback fetch failed');
    };

    const { context } = createTestEnv();

    const subContext = vm.createContext({
      BASE_URL: 'https://api.jolpi.ca/ergast/f1',
      fetch: customFetch
    });

    const fn = vm.runInContext(`(${context.window.fetchSeasonStatus.toString()})`, subContext);
    const result = await fn('2024');

    assert.equal(result, null);
  });

  test('handles case where fetchWithRetry returns a Response object instead of parsed JSON', async () => {
    const { context } = createTestEnv();

    const subContext = vm.createContext({
      BASE_URL: 'https://api.jolpi.ca/ergast/f1',
      fetchWithRetry: async () => ({
        ok: true,
        json: async () => JSON.parse(JSON.stringify(MOCK_STATUS_DATA))
      })
    });

    const fn = vm.runInContext(`(${context.window.fetchSeasonStatus.toString()})`, subContext);
    const result = await fn('2024');

    assert(Array.isArray(result));
    assert.equal(result.length, 5);
    assert.deepEqual(result[0], { statusId: '1', count: '380', status: 'Finished' });
  });
});
