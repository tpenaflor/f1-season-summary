'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainScript = (() => {
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    if (match[1].includes('renderTeammateH2H')) return match[1];
  }
  throw new Error('Main script containing renderTeammateH2H not found in index.html');
})();

function createMockStorage() {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

function createTestEnv(fetchImpl) {
  const elements = {};

  function makeElement(id, tag = 'div') {
    const classes = new Set();
    return {
      id,
      tagName: tag.toUpperCase(),
      style: {
        display: '',
        setProperty(k, v) { this[k] = v; },
        getPropertyValue(k) { return this[k] || ''; }
      },
      className: '',
      innerHTML: '',
      textContent: '',
      value: '',
      options: [],
      children: [],
      classList: {
        add: (...cls) => cls.forEach(c => classes.add(c)),
        remove: (...cls) => cls.forEach(c => classes.delete(c)),
        toggle: (c, force) => {
          const on = force !== undefined ? force : !classes.has(c);
          on ? classes.add(c) : classes.delete(c);
        },
        contains: (c) => classes.has(c)
      },
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

  const getEl = (id) => {
    if (!elements[id]) {
      const tag = id.toLowerCase().includes('select') ? 'select' : (id.toLowerCase().includes('chart') ? 'canvas' : 'div');
      elements[id] = makeElement(id, tag);
    }
    return elements[id];
  };

  const mockDoc = {
    getElementById: getEl,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: (tag) => makeElement('created_' + tag, tag)
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.data = config?.data || {};
    }
    destroy() {}
    resize() {}
    update() {}
  }

  const defaultFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } })
  });

  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    document: mockDoc,
    window: { document: mockDoc, addEventListener() {}, removeEventListener() {}, Chart: MockChart },
    Chart: MockChart,
    localStorage: createMockStorage(),
    fetch: fetchImpl || defaultFetch,
    module: { exports: {} },
    exports: {}
  };

  vm.createContext(context);
  vm.runInContext(mainScript, context);
  return { exp: context.module.exports, context, elements };
}

function makeEntry({ driverId, code, givenName, familyName, constructorId, constructorName, position, grid = '1', points = '0', status = 'Finished', q1, q2, q3 }) {
  const entry = {
    position: position !== undefined ? String(position) : undefined,
    grid: String(grid),
    points: String(points),
    status,
    Driver: {
      driverId,
      code,
      givenName,
      familyName,
      permanentNumber: '1'
    },
    Constructor: {
      constructorId,
      name: constructorName
    }
  };
  if (q1) entry.Q1 = q1;
  if (q2) entry.Q2 = q2;
  if (q3) entry.Q3 = q3;
  return entry;
}

describe('Issue #31: renderTeammateH2H DOM rendering and multi-driver round pairing', () => {
  test('#teammateH2HContainer exists inside #teammate-telemetry-section in index.html', () => {
    const sectionStart = htmlContent.indexOf('id="teammate-telemetry-section"');
    const sectionEnd = htmlContent.indexOf('</section>', sectionStart);
    assert.ok(sectionStart !== -1 && sectionEnd !== -1, '#teammate-telemetry-section must exist');
    const sectionSlice = htmlContent.slice(sectionStart, sectionEnd);
    assert.ok(sectionSlice.includes('id="teammateH2HContainer"'), '#teammateH2HContainer must live inside #teammate-telemetry-section');
  });

  test('renders explicit empty-state HTML into #teammateH2HContainer when cards.length === 0', () => {
    const { exp, elements } = createTestEnv();

    const cards = exp.renderTeammateH2H([]);
    assert.equal(cards.length, 0);
    const containerHtml = elements.teammateH2HContainer.innerHTML;
    assert.ok(containerHtml.includes('teammate-h2h-empty'), 'empty-state element class must be rendered');
    assert.ok(!containerHtml.includes('teammate-h2h-card'), 'no H2H cards should be rendered on empty data');
    assert.match(containerHtml, /No teammate head-to-head/i);
  });

  test('renders empty-state when constructors only field a single driver per round', () => {
    const { exp, elements } = createTestEnv();
    const races = [
      {
        round: '1',
        raceName: 'Bahrain Grand Prix',
        Results: [
          makeEntry({ driverId: 'driver_a', code: 'AAA', givenName: 'Driver', familyName: 'Alpha', constructorId: 'solo_team', constructorName: 'Solo Team', position: 1, points: 25 })
        ]
      },
      {
        round: '2',
        raceName: 'Saudi Arabian Grand Prix',
        Results: [
          makeEntry({ driverId: 'driver_b', code: 'BBB', givenName: 'Driver', familyName: 'Beta', constructorId: 'solo_team', constructorName: 'Solo Team', position: 2, points: 18 })
        ]
      }
    ];

    const cards = exp.renderTeammateH2H(races);
    assert.equal(cards.length, 0, 'drivers in different rounds should not be falsely paired');
    assert.ok(elements.teammateH2HContainer.innerHTML.includes('teammate-h2h-empty'));
  });

  test('renders H2H cards into #teammateH2HContainer for standard 2-driver constructors', () => {
    const { exp, elements } = createTestEnv();
    const races = [
      {
        round: '1',
        raceName: 'Bahrain Grand Prix',
        Results: [
          makeEntry({ driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 1, points: 25 }),
          makeEntry({ driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 2, points: 18 })
        ],
        QualifyingResults: [
          makeEntry({ driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 1, q1: '1:30.000', q3: '1:29.100' }),
          makeEntry({ driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 5, q1: '1:30.400', q3: '1:29.500' })
        ]
      },
      {
        round: '2',
        raceName: 'Saudi Arabian Grand Prix',
        Results: [
          makeEntry({ driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 1, points: 25 }),
          makeEntry({ driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 2, points: 18 })
        ],
        QualifyingResults: [
          makeEntry({ driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 1, q1: '1:28.000', q3: '1:27.400' }),
          makeEntry({ driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Perez', constructorId: 'red_bull', constructorName: 'Red Bull Racing', position: 3, q1: '1:28.200', q3: '1:27.700' })
        ]
      }
    ];

    const cards = exp.renderTeammateH2H(races);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].constructorId, 'red_bull');
    assert.equal(cards[0].sharedRounds, 2);
    assert.equal(cards[0].raceWins1, 2);
    assert.equal(cards[0].raceWins2, 0);
    assert.equal(cards[0].qualWins1, 2);
    assert.equal(cards[0].qualWins2, 0);
    assert.equal(cards[0].points1, 50);
    assert.equal(cards[0].points2, 36);

    const htmlOut = elements.teammateH2HContainer.innerHTML;
    assert.ok(htmlOut.includes('teammate-h2h-card'));
    assert.ok(htmlOut.includes('Red Bull Racing'));
    assert.ok(htmlOut.includes('VER'));
    assert.ok(htmlOut.includes('PER'));
    assert.ok(htmlOut.includes('2 Shared Rds'));
  });

  test('preserves 3rd+ drivers on mid-season swaps and pairs teammates per round (4-driver team)', () => {
    const { exp, elements } = createTestEnv();

    // RB / AlphaTauri scenario with 4 drivers:
    // R1-R2: TSU + DEV
    // R3:    TSU + RIC
    // R4:    TSU + LAW
    // R5:    RIC + LAW (3rd and 4th drivers paired together!)
    const races = [
      {
        round: '1',
        raceName: 'Bahrain Grand Prix',
        Results: [
          makeEntry({ driverId: 'tsunoda', code: 'TSU', givenName: 'Yuki', familyName: 'Tsunoda', constructorId: 'rb', constructorName: 'RB Cash App', position: 10, points: 1 }),
          makeEntry({ driverId: 'de_vries', code: 'DEV', givenName: 'Nyck', familyName: 'de Vries', constructorId: 'rb', constructorName: 'RB Cash App', position: 14, points: 0 })
        ]
      },
      {
        round: '2',
        raceName: 'Saudi Arabian Grand Prix',
        Results: [
          makeEntry({ driverId: 'tsunoda', code: 'TSU', givenName: 'Yuki', familyName: 'Tsunoda', constructorId: 'rb', constructorName: 'RB Cash App', position: 11, points: 0 }),
          makeEntry({ driverId: 'de_vries', code: 'DEV', givenName: 'Nyck', familyName: 'de Vries', constructorId: 'rb', constructorName: 'RB Cash App', position: 15, points: 0 })
        ]
      },
      {
        round: '3',
        raceName: 'Hungarian Grand Prix',
        Results: [
          makeEntry({ driverId: 'tsunoda', code: 'TSU', givenName: 'Yuki', familyName: 'Tsunoda', constructorId: 'rb', constructorName: 'RB Cash App', position: 12, points: 0 }),
          makeEntry({ driverId: 'ricciardo', code: 'RIC', givenName: 'Daniel', familyName: 'Ricciardo', constructorId: 'rb', constructorName: 'RB Cash App', position: 10, points: 1 })
        ]
      },
      {
        round: '4',
        raceName: 'Dutch Grand Prix',
        Results: [
          makeEntry({ driverId: 'tsunoda', code: 'TSU', givenName: 'Yuki', familyName: 'Tsunoda', constructorId: 'rb', constructorName: 'RB Cash App', position: 13, points: 0 }),
          makeEntry({ driverId: 'lawson', code: 'LAW', givenName: 'Liam', familyName: 'Lawson', constructorId: 'rb', constructorName: 'RB Cash App', position: 9, points: 2 })
        ]
      },
      {
        round: '5',
        raceName: 'Italian Grand Prix',
        Results: [
          makeEntry({ driverId: 'ricciardo', code: 'RIC', givenName: 'Daniel', familyName: 'Ricciardo', constructorId: 'rb', constructorName: 'RB Cash App', position: 11, points: 0 }),
          makeEntry({ driverId: 'lawson', code: 'LAW', givenName: 'Liam', familyName: 'Lawson', constructorId: 'rb', constructorName: 'RB Cash App', position: 8, points: 4 })
        ]
      }
    ];

    const cards = exp.renderTeammateH2H(races);
    const pairTags = cards.map(c => `${c.d1.code}-${c.d2.code}`);

    // All 4 active pairings must be present, including 3rd/4th driver pairing RIC-LAW
    assert.equal(cards.length, 4);
    assert.ok(pairTags.includes('TSU-DEV'), 'primary + 2nd driver pairing expected');
    assert.ok(pairTags.includes('TSU-RIC'), 'primary + 3rd driver pairing expected');
    assert.ok(pairTags.includes('TSU-LAW'), 'primary + 4th driver pairing expected');
    assert.ok(pairTags.includes('RIC-LAW') || pairTags.includes('LAW-RIC'), '3rd + 4th driver round pairing expected');

    // Drivers who never shared a round (DEV with RIC or LAW) must NOT be fabricated
    assert.ok(!pairTags.includes('DEV-RIC') && !pairTags.includes('RIC-DEV'));
    assert.ok(!pairTags.includes('DEV-LAW') && !pairTags.includes('LAW-DEV'));

    const tsuDev = cards.find(c => c.d1.code === 'TSU' && c.d2.code === 'DEV');
    assert.equal(tsuDev.sharedRounds, 2);
    assert.equal(tsuDev.raceWins1, 2);
    assert.equal(tsuDev.raceWins2, 0);

    const ricLaw = cards.find(c => (c.d1.code === 'RIC' && c.d2.code === 'LAW') || (c.d1.code === 'LAW' && c.d2.code === 'RIC'));
    assert.equal(ricLaw.sharedRounds, 1);

    const htmlOut = elements.teammateH2HContainer.innerHTML;
    assert.ok(htmlOut.includes('data-pair="TSU-DEV"'));
    assert.ok(htmlOut.includes('data-pair="TSU-RIC"'));
    assert.ok(htmlOut.includes('data-pair="TSU-LAW"'));
    assert.ok(htmlOut.includes('data-pair="LAW-RIC"') || htmlOut.includes('data-pair="RIC-LAW"'));
  });

  test('processSeasonTelemetry pairs all active multi-driver combinations per round and respects separate qualInput', () => {
    const { exp } = createTestEnv();
    const resRounds = exp.mergeRacesByRound([
      {
        round: '1',
        raceName: 'Bahrain Grand Prix',
        Results: [
          makeEntry({ driverId: 'albon', code: 'ALB', givenName: 'Alex', familyName: 'Albon', constructorId: 'williams', constructorName: 'Williams', position: 10, points: 1 }),
          makeEntry({ driverId: 'sargeant', code: 'SAR', givenName: 'Logan', familyName: 'Sargeant', constructorId: 'williams', constructorName: 'Williams', position: 16, points: 0 })
        ]
      },
      {
        round: '2',
        raceName: 'Italian Grand Prix',
        Results: [
          makeEntry({ driverId: 'albon', code: 'ALB', givenName: 'Alex', familyName: 'Albon', constructorId: 'williams', constructorName: 'Williams', position: 9, points: 2 }),
          makeEntry({ driverId: 'colapinto', code: 'COL', givenName: 'Franco', familyName: 'Colapinto', constructorId: 'williams', constructorName: 'Williams', position: 12, points: 0 })
        ]
      }
    ], 'Results');

    const qualRounds = exp.mergeRacesByRound([
      {
        round: '2',
        raceName: 'Italian Grand Prix',
        QualifyingResults: [
          makeEntry({ driverId: 'albon', code: 'ALB', givenName: 'Alex', familyName: 'Albon', constructorId: 'williams', constructorName: 'Williams', position: 9, q1: '1:20.200', q3: '1:19.800' }),
          makeEntry({ driverId: 'colapinto', code: 'COL', givenName: 'Franco', familyName: 'Colapinto', constructorId: 'williams', constructorName: 'Williams', position: 18, q1: '1:21.000' })
        ]
      }
    ], 'QualifyingResults');

    const processed = exp.processSeasonTelemetry('2024', qualRounds, resRounds);
    const williams = processed.constructors.williams;
    assert.equal(williams.drivers.length, 3);
    assert.equal(williams.pairings.length, 2);

    const cards = exp.renderTeammateH2H(processed);
    assert.equal(cards.length, 2);
    const colCard = cards.find(c => c.d2.code === 'COL' || c.d1.code === 'COL');
    assert.ok(colCard, '3rd driver Colapinto pairing card must be rendered');
    assert.equal(colCard.qualWins1, 1);
    assert.equal(colCard.qualWins2, 0);
  });

  test('loadTelemetrySeason populates #teammateH2HContainer and clears to empty state on fetch error', async () => {
    let failNext = false;
    const { exp, elements } = createTestEnv(async (url) => {
      if (failNext) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      if (url.includes('/qualifying.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MRData: {
              total: '2',
              limit: '100',
              RaceTable: {
                Races: [{
                  round: '1',
                  raceName: 'Bahrain Grand Prix',
                  QualifyingResults: [
                    makeEntry({ driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc', constructorId: 'ferrari', constructorName: 'Ferrari', position: 2, q1: '1:30.000', q3: '1:29.400' }),
                    makeEntry({ driverId: 'sainz', code: 'SAI', givenName: 'Carlos', familyName: 'Sainz', constructorId: 'ferrari', constructorName: 'Ferrari', position: 4, q1: '1:30.100', q3: '1:29.500' })
                  ]
                }]
              }
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          MRData: {
            total: '3',
            limit: '100',
            RaceTable: {
              Races: [{
                round: '1',
                raceName: 'Bahrain Grand Prix',
                Results: [
                  makeEntry({ driverId: 'sainz', code: 'SAI', givenName: 'Carlos', familyName: 'Sainz', constructorId: 'ferrari', constructorName: 'Ferrari', position: 3, points: 15 }),
                  makeEntry({ driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc', constructorId: 'ferrari', constructorName: 'Ferrari', position: 4, points: 12 }),
                  makeEntry({ driverId: 'bearman', code: 'BEA', givenName: 'Oliver', familyName: 'Bearman', constructorId: 'ferrari', constructorName: 'Ferrari', position: 7, points: 6 })
                ]
              }]
            }
          }
        })
      };
    });

    await exp.loadTelemetrySeason('2024', true);
    assert.notEqual(elements.telemetryError.style.display, 'block');
    const rendered = elements.teammateH2HContainer.innerHTML;
    assert.ok(rendered.includes('teammate-h2h-card'));
    assert.ok(rendered.includes('Ferrari'));
    assert.ok(rendered.includes('BEA'), '3rd driver Bearman must be rendered in #teammateH2HContainer');

    // Now simulate an errored season switch and confirm stale cards are replaced with empty state
    failNext = true;
    await exp.loadTelemetrySeason('2026', true);
    assert.equal(elements.telemetryError.style.display, 'block');
    assert.ok(elements.teammateH2HContainer.innerHTML.includes('teammate-h2h-empty'));
    assert.ok(!elements.teammateH2HContainer.innerHTML.includes('teammate-h2h-card'));
  });

  test('respects excludeMechanicalDnfs toggle, qualifying position fallback, and escapes HTML', () => {
    const { exp, elements } = createTestEnv();
    const races = [
      {
        round: '1',
        raceName: 'Bahrain Grand Prix',
        Results: [
          makeEntry({ driverId: 'd1', code: 'ONE', givenName: 'Driver', familyName: '<One>', constructorId: 'mclaren', constructorName: 'McLaren & Co', position: 1, points: 25, status: 'Finished' }),
          makeEntry({ driverId: 'd2', code: 'TWO', givenName: 'Driver', familyName: 'Two', constructorId: 'mclaren', constructorName: 'McLaren & Co', position: 19, points: 0, status: 'Engine' })
        ],
        QualifyingResults: [
          makeEntry({ driverId: 'd1', code: 'ONE', givenName: 'Driver', familyName: '<One>', constructorId: 'mclaren', constructorName: 'McLaren & Co', position: 3 }),
          makeEntry({ driverId: 'd2', code: 'TWO', givenName: 'Driver', familyName: 'Two', constructorId: 'mclaren', constructorName: 'McLaren & Co', position: 1 })
        ]
      }
    ];

    // Default excludeMechanicalDnfs = true excludes Engine retirement from race H2H
    const excludedCards = exp.renderTeammateH2H(races);
    assert.equal(excludedCards.length, 1);
    assert.equal(excludedCards[0].qualWins1, 0);
    assert.equal(excludedCards[0].qualWins2, 1);
    assert.equal(excludedCards[0].raceWins1, 0);
    assert.equal(excludedCards[0].raceWins2, 0);
    assert.equal(excludedCards[0].mechExcludedCount, 1);
    assert.ok(elements.teammateH2HContainer.innerHTML.includes('&lt;One&gt;'));
    assert.ok(elements.teammateH2HContainer.innerHTML.includes('McLaren &amp; Co'));

    // Toggle mechanical DNF exclusion off
    exp.onMechDnfToggleChange(false);
    const includedCards = exp.renderTeammateH2H(races);
    assert.equal(includedCards[0].raceWins1, 1);
    assert.equal(includedCards[0].raceWins2, 0);
    assert.equal(includedCards[0].mechExcludedCount, 0);
  });
});
