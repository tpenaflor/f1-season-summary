'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function toPlain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createTestEnv(customFetch = globalThis.fetch) {
  const elements = {};
  const listeners = {};
  const chartInstances = [];

  function createMockElement(id, tagName = 'div') {
    return {
      id,
      tagName: tagName.toUpperCase(),
      style: { display: 'block' },
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) force ? this.classes.add(c) : this.classes.delete(c);
          else this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c);
        },
        contains(c) { return this.classes.has(c); }
      },
      children: [],
      innerHTML: '',
      textContent: '',
      value: '',
      className: '',
      options: [],
      appendChild(child) {
        this.children.push(child);
        if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
          this.options.push(child);
          if (child.selected || this.options.length === 1) this.value = child.value;
        }
        return child;
      },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      getContext() {
        return { canvas: {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {} };
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
    createElement: (tag) => createMockElement(`created_${tag}_${Math.random().toString(36).slice(2, 7)}`, tag)
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.type = config?.type;
      this.data = config?.data || { labels: [], datasets: [] };
      this.options = config?.options || {};
      this.destroyed = false;
      chartInstances.push(this);
    }
    destroy() { this.destroyed = true; }
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

  const indexPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch) throw new Error('Could not find <script> in index.html');

  const context = {
    window: {
      addEventListener: () => {},
      document: mockDoc,
      localStorage: mockStorage,
      Chart: MockChart
    },
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
  vm.runInContext(scriptMatch[1], context);

  return {
    exports: context.module.exports,
    elements: elementsProxy,
    storage: mockStorage,
    chartInstances
  };
}

describe('Issue #28: Lap 0 Starting Grid Position in Position Charts', () => {
  test('processLapChartData prepends lap 0 label and uses Jolpica results grid field', () => {
    const { processLapChartData } = createTestEnv().exports;
    const results = [
      {
        round: '1',
        raceName: 'Test Grand Prix',
        Results: [
          {
            position: '1',
            positionText: '1',
            grid: '4',
            laps: '3',
            status: 'Finished',
            Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' },
            Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
          },
          {
            position: '2',
            positionText: '2',
            grid: '1',
            laps: '3',
            status: 'Finished',
            Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
            Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
          },
          {
            position: '3',
            positionText: '3',
            grid: '0', // Pit lane start in Jolpica
            laps: '3',
            status: 'Finished',
            Driver: { driverId: 'hamilton', givenName: 'Lewis', familyName: 'Hamilton', code: 'HAM' },
            Constructor: { constructorId: 'mercedes', name: 'Mercedes' }
          }
        ]
      }
    ];
    const laps = [
      { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }, { driverId: 'leclerc', position: '2' }, { driverId: 'hamilton', position: '3' }] },
      { number: '2', Timings: [{ driverId: 'leclerc', position: '1' }, { driverId: 'max_verstappen', position: '2' }, { driverId: 'hamilton', position: '3' }] },
      { number: '3', Timings: [{ driverId: 'leclerc', position: '1' }, { driverId: 'max_verstappen', position: '2' }, { driverId: 'hamilton', position: '3' }] }
    ];

    const chartData = processLapChartData(laps, results, '1', '2024');
    assert.strictEqual(chartData.maxLaps, 3);
    assert.deepStrictEqual(toPlain(chartData.labels), ['0', '1', '2', '3']);

    const lec = chartData.datasets.find(d => d.driverId === 'leclerc');
    const ver = chartData.datasets.find(d => d.driverId === 'max_verstappen');
    const ham = chartData.datasets.find(d => d.driverId === 'hamilton');

    assert.deepStrictEqual(toPlain(lec.data), [4, 2, 1, 1]);
    assert.deepStrictEqual(toPlain(ver.data), [1, 1, 2, 2]);
    assert.deepStrictEqual(toPlain(ham.data), [null, 3, 3, 3]);
  });

  test('processLapChartData handles Lap 1 retirement (retains Lap 0 grid) vs DNS (null at Lap 0)', () => {
    const { processLapChartData } = createTestEnv().exports;
    const results = [
      {
        round: '1',
        Results: [
          {
            position: '1',
            positionText: '1',
            grid: '1',
            laps: '2',
            status: 'Finished',
            Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
            Constructor: { constructorId: 'mclaren', name: 'McLaren' }
          },
          {
            position: '2',
            positionText: 'R',
            grid: '12',
            laps: '0', // Retired on Lap 1 before crossing line
            status: 'Collision',
            Driver: { driverId: 'perez', givenName: 'Sergio', familyName: 'Perez', code: 'PER' },
            Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
          },
          {
            position: '3',
            positionText: 'W',
            grid: '15',
            laps: '0',
            status: 'Did not start',
            Driver: { driverId: 'stroll', givenName: 'Lance', familyName: 'Stroll', code: 'STR' },
            Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' }
          }
        ]
      }
    ];
    const laps = [
      { number: '1', Timings: [{ driverId: 'norris', position: '1' }] },
      { number: '2', Timings: [{ driverId: 'norris', position: '1' }] }
    ];

    const chartData = processLapChartData(laps, results, '1', '2024');
    const per = chartData.datasets.find(d => d.driverId === 'perez');
    const str = chartData.datasets.find(d => d.driverId === 'stroll');

    assert.deepStrictEqual(toPlain(per.data), [12, null, null]);
    assert.deepStrictEqual(toPlain(str.data), [null, null, null]);
  });

  test('buildDriverLapPositions and cleanRetirementTruncation support lap 0 indexing', () => {
    const { buildDriverLapPositions, cleanRetirementTruncation } = createTestEnv().exports;
    const laps = [
      { number: '1', Timings: [{ driverId: 'ver', position: '2' }] },
      { number: '2', Timings: [{ driverId: 'ver', position: '1' }] },
      { number: '3', Timings: [{ driverId: 'ver', position: '1' }] }
    ];

    const raw = buildDriverLapPositions(laps, 'ver', null, 3, '5');
    assert.deepStrictEqual(toPlain(raw), [5, 2, 1, 1]);

    const truncatedAt1 = cleanRetirementTruncation(raw, 1, 0);
    assert.deepStrictEqual(toPlain(truncatedAt1), [5, 2, null, null]);

    const truncatedAt0 = cleanRetirementTruncation(raw, 0, 0);
    assert.deepStrictEqual(toPlain(truncatedAt0), [5, null, null, null]);
  });

  test('LAP_CHART_FALLBACK_2024 includes lap 0 label and starting grid positions', () => {
    const { LAP_CHART_FALLBACK_2024 } = createTestEnv().exports;
    assert.strictEqual(LAP_CHART_FALLBACK_2024.labels.length, 58);
    assert.strictEqual(LAP_CHART_FALLBACK_2024.labels[0], '0');
    assert.strictEqual(LAP_CHART_FALLBACK_2024.labels[57], '57');

    const norris = LAP_CHART_FALLBACK_2024.datasets.find(d => d.driverId === 'norris');
    assert.strictEqual(norris.data.length, 58);
    assert.strictEqual(norris.data[0], 7); // Norris grid P7 in Bahrain 2024
    assert.strictEqual(norris.data[1], 6);

    const hamilton = LAP_CHART_FALLBACK_2024.datasets.find(d => d.driverId === 'hamilton');
    assert.strictEqual(hamilton.data[0], 9); // Hamilton grid P9
    assert.strictEqual(hamilton.data[1], 7);
  });

  test('renderLapPositionChart formats lap 0 tooltip and X-axis title', () => {
    const env = createTestEnv();
    const { renderLapPositionChart, LAP_CHART_FALLBACK_2024 } = env.exports;
    const chart = renderLapPositionChart(LAP_CHART_FALLBACK_2024);

    assert.strictEqual(chart.options.scales.x.title.text, 'Lap Number (0 = Grid, 1..N)');
    const cb = chart.options.plugins.tooltip.callbacks;

    assert.strictEqual(cb.title([{ label: '0' }]), 'Lap 0 — Starting Grid');
    assert.strictEqual(cb.title([{ label: '12' }]), 'Lap 12 of 57');

    const gridLabel = cb.label({
      label: '0',
      dataIndex: 0,
      dataset: { driverCode: 'NOR', driverName: 'Lando Norris', constructorName: 'McLaren' },
      parsed: { y: 7 }
    });
    assert.strictEqual(gridLabel, ' P7 (Grid) — Lando Norris (McLaren)');

    const pitLaneLabel = cb.label({
      label: '0',
      dataIndex: 0,
      dataset: { driverCode: 'HAM', driverName: 'Lewis Hamilton', constructorName: 'Mercedes' },
      parsed: { y: null }
    });
    assert.strictEqual(pitLaneLabel, ' HAM: Pit Lane / No Grid');
  });

  test('loadLapTelemetry fetches Jolpica results.json grid and renders lap 0 without counting lap 0 in Laps Led', async () => {
    const customFetch = async (url) => {
      if (url.includes('results.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              total: '2',
              limit: '1000',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    raceName: 'Australian Grand Prix',
                    Circuit: { circuitName: 'Albert Park' },
                    Results: [
                      {
                        position: '1',
                        positionText: '1',
                        grid: '3',
                        laps: '2',
                        status: 'Finished',
                        Driver: { driverId: 'sainz', givenName: 'Carlos', familyName: 'Sainz', code: 'SAI' },
                        Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
                      },
                      {
                        position: '2',
                        positionText: '2',
                        grid: '1',
                        laps: '2',
                        status: 'Finished',
                        Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' }
                      }
                    ]
                  }
                ]
              }
            }
          })
        };
      }
      if (url.includes('laps.json')) {
        return {
          ok: true,
          json: async () => ({
            MRData: {
              total: '2',
              limit: '2000',
              RaceTable: {
                Races: [
                  {
                    round: '1',
                    Laps: [
                      { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1' }, { driverId: 'sainz', position: '2' }] },
                      { number: '2', Timings: [{ driverId: 'sainz', position: '1' }, { driverId: 'max_verstappen', position: '2' }] }
                    ]
                  }
                ]
              }
            }
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const env = createTestEnv(customFetch);
    const state = await env.exports.loadLapTelemetry('2024', '1', true);
    const chart = state.chartInstance;

    assert.ok(chart);
    assert.deepStrictEqual(toPlain(chart.data.labels), ['0', '1', '2']);

    const saiDs = chart.data.datasets.find(d => d.driverId === 'sainz');
    const verDs = chart.data.datasets.find(d => d.driverId === 'max_verstappen');
    assert.deepStrictEqual(toPlain(saiDs.data), [3, 2, 1]);
    assert.deepStrictEqual(toPlain(verDs.data), [1, 1, 2]);

    // Season Laps Led should only count race laps 1 and 2 (1 each, not lap 0)
    assert.strictEqual(state.seasonLapsLed.totalLapsLed, 2);
  });

  test('computeSeasonLapsLed and renderLapRoundBreakdown ignore any lap 0 entry', () => {
    const env = createTestEnv();
    const { computeSeasonLapsLed, renderLapRoundBreakdown } = env.exports;
    const lapsWithZero = [
      { number: '0', Timings: [{ driverId: 'leclerc', position: '1' }] },
      { number: '1', Timings: [{ driverId: 'norris', position: '1' }] },
      { number: '2', Timings: [{ driverId: 'norris', position: '1' }] }
    ];
    const results = [
      {
        round: '1',
        Results: [
          { Driver: { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' }, Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
          { Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' }, Constructor: { constructorId: 'mclaren', name: 'McLaren' } }
        ]
      }
    ];

    const ledData = computeSeasonLapsLed(lapsWithZero, results, '2024');
    assert.strictEqual(ledData.totalLapsLed, 2);
    assert.strictEqual(ledData.leader.driverId, 'norris');
    assert.strictEqual(ledData.leader.lapsLed, 2);

    renderLapRoundBreakdown(lapsWithZero, results);
    const timeline = env.elements['roundLeadTimeline'];
    assert.strictEqual(timeline.children.length, 1);
    assert.ok(timeline.children[0].innerHTML.includes('NOR: L1–2 (2 laps)'));
  });
});
