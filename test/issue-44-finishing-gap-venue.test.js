const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch) {
  const elements = {};
  const storage = {};

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
      children: [],
      _innerHTML: '',
      options: id === 'finishingGapVenueSelect' ? [{ value: 'all' }] : [],
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        if (this._innerHTML === '') {
          this.children = [];
        }
        if (this.id === 'finishingGapVenueSelect') {
          const matches = [...this._innerHTML.matchAll(/<option value="([^"]+)"/g)];
          this.options = matches.map(m => ({ value: m[1] }));
        }
      },
      textContent: '',
      value: id === 'finishingGapVenueSelect' ? 'all' : '',
      className: '',
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener() {},
      removeEventListener() {},
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

  getOrCreateEl('finishingGapVenueSelect');
  getOrCreateEl('fgChartTitle');

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Promise,
    Set,
    Map,
    fetch: customFetch,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem(k, v) { storage[k] = String(v); },
      removeItem(k) { delete storage[k]; }
    },
    Chart: class MockChart {
      constructor(ctx, config) { this.ctx = ctx; this.config = config; }
      destroy() {}
      resize() {}
    },
    document: {
      getElementById: (id) => getOrCreateEl(id),
      createElement: (tag) => createMockElement(tag),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {}
    },
    addEventListener() {},
    removeEventListener() {},
    window: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  const inlineScript = scriptMatches.map(m => m[1]).filter(s => s.includes('loadFinishingGapData')).join('\n');

  vm.createContext(sandbox);
  vm.runInContext(inlineScript, sandbox);

  return { exports: sandbox.window, elements, storage };
}

function makeRaceRound(round, raceName, winnerName = 'Max Verstappen', p2Name = 'Lando Norris') {
  return {
    round: String(round),
    raceName,
    Results: [
      {
        position: '1',
        laps: '57',
        status: 'Finished',
        Driver: { driverId: winnerName.toLowerCase().replace(/\s+/g, '_'), givenName: winnerName.split(' ')[0], familyName: winnerName.split(' ')[1] || 'Driver' },
        Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
        Time: { millis: '5400000', time: '1:30:00.000' }
      },
      {
        position: '2',
        laps: '57',
        status: 'Finished',
        Driver: { driverId: p2Name.toLowerCase().replace(/\s+/g, '_'), givenName: p2Name.split(' ')[0], familyName: p2Name.split(' ')[1] || 'Driver' },
        Constructor: { constructorId: 'mclaren', name: 'McLaren' },
        Time: { millis: '5405250', time: '+5.250' }
      }
    ]
  };
}

function makeJolpicaResponse(season, races) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      MRData: {
        total: String(races.reduce((sum, r) => sum + r.Results.length, 0)),
        limit: '100',
        offset: '0',
        RaceTable: { season: String(season), Races: races }
      }
    })
  };
}

describe('Issue #44: Finishing Gap venue selector updates across seasons and clears stale round selection', () => {
  test('repopulates venue selector when switching from first loaded season to another season', async () => {
    const seasonRounds = {
      '2024': [
        makeRaceRound(1, 'Bahrain Grand Prix'),
        makeRaceRound(2, 'Saudi Arabian Grand Prix'),
        makeRaceRound(16, 'Italian Grand Prix')
      ],
      '2025': [
        makeRaceRound(1, 'Australian Grand Prix'),
        makeRaceRound(2, 'Chinese Grand Prix')
      ]
    };

    const mockFetch = async (url) => {
      const m = String(url).match(/\/(\d{4})\/results/);
      const yr = m ? m[1] : '2024';
      return makeJolpicaResponse(yr, seasonRounds[yr] || []);
    };

    const { exports: f1App, elements } = createTestEnv(mockFetch);

    await f1App.loadFinishingGapData('2024', false);
    const venueSelect = elements['finishingGapVenueSelect'];
    assert.deepEqual(
      venueSelect.options.map(o => o.value),
      ['all', '1', '2', '16']
    );
    assert.ok(venueSelect.innerHTML.includes('R1 Bahrain GP'));
    assert.ok(venueSelect.innerHTML.includes('R16 Italian GP'));

    await f1App.onFinishingGapSeasonChange('2025');
    assert.deepEqual(
      venueSelect.options.map(o => o.value),
      ['all', '1', '2']
    );
    assert.ok(venueSelect.innerHTML.includes('R1 Australian GP'));
    assert.ok(venueSelect.innerHTML.includes('R2 Chinese GP'));
    assert.ok(!venueSelect.innerHTML.includes('Italian GP'));
  });

  test('resets stale round selection and chart title on season change even when round number exists in new season', async () => {
    const seasonRounds = {
      '2024': [
        makeRaceRound(1, 'Bahrain Grand Prix'),
        makeRaceRound(2, 'Saudi Arabian Grand Prix')
      ],
      '2025': [
        makeRaceRound(1, 'Australian Grand Prix'),
        makeRaceRound(2, 'Chinese Grand Prix')
      ]
    };

    const mockFetch = async (url) => {
      const m = String(url).match(/\/(\d{4})\/results/);
      const yr = m ? m[1] : '2024';
      return makeJolpicaResponse(yr, seasonRounds[yr] || []);
    };

    const { exports: f1App, elements } = createTestEnv(mockFetch);

    await f1App.loadFinishingGapData('2024', false);
    f1App.setFinishingGapVenueFilter('2');
    assert.equal(f1App.finishingGapState.venueRound, '2');
    assert.equal(elements['fgChartTitle'].textContent, 'Finishing Gap to Winner — Saudi Arabian Grand Prix (Seconds)');

    // Direct loadFinishingGapData call for a different season must also reset stale round
    await f1App.loadFinishingGapData('2025', false);
    assert.equal(f1App.finishingGapState.season, '2025');
    assert.equal(f1App.finishingGapState.venueRound, 'all');
    assert.equal(elements['finishingGapVenueSelect'].value, 'all');
    assert.equal(elements['fgChartTitle'].textContent, 'Median Finishing Gap to Winner (Seconds)');
  });

  test('renderFinishingGapView resets invalid venueRound and chart title to all when round is missing from metrics', () => {
    const { exports: f1App, elements } = createTestEnv(async () => makeJolpicaResponse('2025', []));

    f1App.finishingGapState.season = '2025';
    f1App.finishingGapState.results = [makeRaceRound(1, 'Australian Grand Prix')];
    f1App.finishingGapState.metrics = f1App.computeFinishingGapMetrics(f1App.finishingGapState.results, 'constructors', '2025');
    f1App.finishingGapState.venueRound = '16';
    elements['fgChartTitle'].textContent = 'Finishing Gap to Winner — Italian Grand Prix (Seconds)';

    f1App.renderFinishingGapView();

    assert.equal(f1App.finishingGapState.venueRound, 'all');
    assert.equal(elements['finishingGapVenueSelect'].value, 'all');
    assert.equal(elements['fgChartTitle'].textContent, 'Median Finishing Gap to Winner (Seconds)');
  });

  test('ignores out-of-order stale season fetch responses when switching seasons rapidly', async () => {
    let resolve2024;
    const promise2024 = new Promise(resolve => { resolve2024 = resolve; });

    const mockFetch = async (url) => {
      if (String(url).includes('/2024/')) {
        await promise2024;
        return makeJolpicaResponse('2024', [makeRaceRound(1, 'Bahrain Grand Prix')]);
      }
      return makeJolpicaResponse('2025', [makeRaceRound(1, 'Australian Grand Prix')]);
    };

    const { exports: f1App, elements } = createTestEnv(mockFetch);

    const load2024 = f1App.onFinishingGapSeasonChange('2024');
    const load2025 = f1App.onFinishingGapSeasonChange('2025');

    await load2025;
    assert.equal(f1App.finishingGapState.season, '2025');
    assert.ok(elements['finishingGapVenueSelect'].innerHTML.includes('Australian GP'));

    resolve2024();
    await load2024;

    assert.equal(f1App.finishingGapState.season, '2025');
    assert.ok(elements['finishingGapVenueSelect'].innerHTML.includes('Australian GP'));
    assert.ok(!elements['finishingGapVenueSelect'].innerHTML.includes('Bahrain GP'));
  });
});
