const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv() {
  const elements = {};
  const battlePills = [];
  const listeners = {};

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
      appendChild(child) { return child; },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
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

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: (selector) => {
      if (selector && selector.includes('atr-battle-pill')) {
        return battlePills;
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => createMockElement('created_' + tag)
  };

  ['all', 'title', 'podium', 'midfield', 'rebuild'].forEach(g => {
    const pill = createMockElement('pill_' + g);
    pill['data-group'] = g;
    pill.getAttribute = (k) => (k === 'data-group' ? g : null);
    if (g === 'all') pill.classList.add('active');
    battlePills.push(pill);
  });

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

  const storage = {};
  const mockStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

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

  const context = {
    window: mockWindow,
    document: mockDoc,
    localStorage: mockStorage,
    Chart: MockChart,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
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
    elements: elementsProxy
  };
}

function parseTableRows(tbodyHtml) {
  const rows = [];
  const rowMatches = tbodyHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const rowHtml of rowMatches) {
    const cidMatch = rowHtml.match(/data-cid="([^"]+)"/);
    const cells = [];
    const cellMatches = rowHtml.match(/<td\b[^>]*>([\s\S]*?)<\/td>/g) || [];
    for (const cellHtml of cellMatches) {
      cells.push(cellHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    }
    rows.push({
      cid: cidMatch ? cidMatch[1] : null,
      rank: cells[0],
      team: cells[1],
      pts: cells[2],
      gapLeader: cells[3],
      gapAhead: cells[4]
    });
  }
  return rows;
}

describe('Issue #42: Constructor ATR Battle Group filter Gap Ahead calculation', () => {
  const sampleStandings = [
    { position: '1', points: '666', wins: '6', Constructor: { constructorId: 'mclaren', name: 'McLaren' } },
    { position: '2', points: '652', wins: '5', Constructor: { constructorId: 'ferrari', name: 'Ferrari' } },
    { position: '3', points: '589', wins: '9', Constructor: { constructorId: 'red_bull', name: 'Red Bull' } },
    { position: '4', points: '468', wins: '4', Constructor: { constructorId: 'mercedes', name: 'Mercedes' } },
    { position: '5', points: '94', wins: '0', Constructor: { constructorId: 'aston_martin', name: 'Aston Martin' } },
    { position: '6', points: '65', wins: '0', Constructor: { constructorId: 'alpine', name: 'Alpine' } },
    { position: '7', points: '58', wins: '0', Constructor: { constructorId: 'haas', name: 'Haas' } },
    { position: '8', points: '46', wins: '0', Constructor: { constructorId: 'rb', name: 'RB' } },
    { position: '9', points: '17', wins: '0', Constructor: { constructorId: 'williams', name: 'Williams' } },
    { position: '10', points: '4', wins: '0', Constructor: { constructorId: 'sauber', name: 'Kick Sauber' } }
  ];

  test('midfield (P6-P8) computes P6 Gap Ahead from P5 instead of P1', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderConstructorAtrTable(sampleStandings, {}, 'midfield');
    const rows = parseTableRows(elements['constructorAtrTableBody'].innerHTML);

    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.cid), ['alpine', 'haas', 'rb']);

    // P6 Alpine (65 pts) vs P5 Aston Martin (94 pts) => -29 PTS, vs P1 McLaren (666 pts) => -601 PTS
    assert.equal(rows[0].gapLeader, '-601 PTS');
    assert.equal(rows[0].gapAhead, '-29 PTS');

    // P7 Haas (58 pts) vs P6 Alpine (65 pts) => -7 PTS
    assert.equal(rows[1].gapLeader, '-608 PTS');
    assert.equal(rows[1].gapAhead, '-7 PTS');

    // P8 RB (46 pts) vs P7 Haas (58 pts) => -12 PTS
    assert.equal(rows[2].gapLeader, '-620 PTS');
    assert.equal(rows[2].gapAhead, '-12 PTS');
  });

  test('rebuild (P9+) computes P9 Gap Ahead from P8 instead of P1', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderConstructorAtrTable(sampleStandings, {}, 'rebuild');
    const rows = parseTableRows(elements['constructorAtrTableBody'].innerHTML);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.cid), ['williams', 'sauber']);

    // P9 Williams (17 pts) vs P8 RB (46 pts) => -29 PTS, vs P1 McLaren (666 pts) => -649 PTS
    assert.equal(rows[0].gapLeader, '-649 PTS');
    assert.equal(rows[0].gapAhead, '-29 PTS');

    // P10 Kick Sauber (4 pts) vs P9 Williams (17 pts) => -13 PTS
    assert.equal(rows[1].gapLeader, '-662 PTS');
    assert.equal(rows[1].gapAhead, '-13 PTS');
  });

  test('podium (P3-P5) computes P3 Gap Ahead from P2 instead of P1', () => {
    const { exports: f1App, elements } = createTestEnv();

    f1App.renderConstructorAtrTable(sampleStandings, {}, 'podium');
    const rows = parseTableRows(elements['constructorAtrTableBody'].innerHTML);

    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.cid), ['red_bull', 'mercedes', 'aston_martin']);

    // P3 Red Bull (589 pts) vs P2 Ferrari (652 pts) => -63 PTS, vs P1 McLaren (666 pts) => -77 PTS
    assert.equal(rows[0].gapLeader, '-77 PTS');
    assert.equal(rows[0].gapAhead, '-63 PTS');

    // P4 Mercedes (468 pts) vs P3 Red Bull (589 pts) => -121 PTS
    assert.equal(rows[1].gapLeader, '-198 PTS');
    assert.equal(rows[1].gapAhead, '-121 PTS');

    // P5 Aston Martin (94 pts) vs P4 Mercedes (468 pts) => -374 PTS
    assert.equal(rows[2].gapLeader, '-572 PTS');
    assert.equal(rows[2].gapAhead, '-374 PTS');
  });

  test('setConstructorBattleGroup preserves identical Gap Ahead & Gap to Leader as "all" view for every row', () => {
    const { exports: f1App, elements } = createTestEnv();
    f1App.constructorAtrState.standings = sampleStandings;

    f1App.setConstructorBattleGroup('all');
    const allRows = parseTableRows(elements['constructorAtrTableBody'].innerHTML);
    const byCid = Object.fromEntries(allRows.map(r => [r.cid, r]));

    assert.equal(byCid['mclaren'].gapLeader, 'LEADER');
    assert.equal(byCid['mclaren'].gapAhead, '—');

    for (const group of ['title', 'podium', 'midfield', 'rebuild']) {
      f1App.setConstructorBattleGroup(group);
      const groupRows = parseTableRows(elements['constructorAtrTableBody'].innerHTML);
      assert.ok(groupRows.length > 0, `Expected rows for group ${group}`);
      for (const row of groupRows) {
        assert.equal(row.gapLeader, byCid[row.cid].gapLeader, `Gap to Leader mismatch for ${row.cid} in ${group}`);
        assert.equal(row.gapAhead, byCid[row.cid].gapAhead, `Gap Ahead mismatch for ${row.cid} in ${group}`);
      }
    }
  });
});
