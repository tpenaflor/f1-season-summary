'use strict';

// Issue #34: switchMainTab must hide #qualifying-correlation-section on every
// tab other than 'qualifying' and 'all'.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} not found in index.html`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not find end of ${name}`);
}

const SECTION_IDS = [
  'lap-chart-section',
  'stint-profiler-section',
  'finishing-gap-section',
  'circuit-profiler-section',
  'constructor-atr-section',
  'constructor-momentum-section',
  'sprint-disparity-section',
  'clinch-engine-section',
  'pitstop-matrix-section',
  'reliability-matrix-section',
  'qualifying-correlation-section',
  'overtake-index-section',
  'teammate-telemetry-section',
  'progression-section',
  'latest-race-section',
  'standings-table-section'
];

function makeElement(id) {
  const classes = new Set();
  return {
    id,
    style: { display: '' },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    }
  };
}

function createEnv() {
  const elements = {};
  for (const id of SECTION_IDS) elements[id] = makeElement(id);
  const tabBtns = [];
  const document = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = makeElement(id);
        if (id.startsWith('tabBtn')) tabBtns.push(elements[id]);
      }
      return elements[id];
    },
    querySelectorAll(sel) {
      return sel === '.tab-btn' ? tabBtns.slice() : [];
    }
  };
  const context = {
    document,
    setTimeout: () => 0,
    qualifyingCorrelationState: { dataLoaded: true, loading: false, season: '2024' },
    overtakeIndexState: { dataLoaded: true, loading: false, season: '2024' },
    loadQualifyingCorrelationData: () => {},
    loadOvertakeIndexData: () => {}
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'switchMainTab'), context);
  return { context, elements };
}

const NON_QUALIFYING_TABS = [
  'lap-chart',
  'stints',
  'degradation',
  'finishing-gap',
  'profiler',
  'constructors',
  'momentum',
  'sprint',
  'clinch',
  'pitstops',
  'reliability',
  'overtake',
  'overtake-index',
  'grid-delta',
  'telemetry',
  'progression',
  'results'
];

describe('Issue #34: switchMainTab qualifying-correlation-section visibility', () => {
  for (const tab of NON_QUALIFYING_TABS) {
    test(`hides qualifying-correlation-section on '${tab}' tab after it was visible`, () => {
      const { context, elements } = createEnv();
      const qual = elements['qualifying-correlation-section'];

      context.switchMainTab('qualifying');
      assert.equal(qual.style.display, 'block');

      context.switchMainTab(tab);
      assert.equal(qual.style.display, 'none', `qualifying section should be hidden on '${tab}'`);
    });

    test(`hides qualifying-correlation-section on '${tab}' tab coming from 'all'`, () => {
      const { context, elements } = createEnv();
      const qual = elements['qualifying-correlation-section'];

      context.switchMainTab('all');
      assert.equal(qual.style.display, 'block');

      context.switchMainTab(tab);
      assert.equal(qual.style.display, 'none', `qualifying section should be hidden on '${tab}'`);
    });
  }

  test("shows qualifying-correlation-section on 'qualifying' tab and hides others", () => {
    const { context, elements } = createEnv();
    context.switchMainTab('all');
    context.switchMainTab('qualifying');
    assert.equal(elements['qualifying-correlation-section'].style.display, 'block');
    for (const id of SECTION_IDS) {
      if (id === 'qualifying-correlation-section') continue;
      assert.equal(elements[id].style.display, 'none', `${id} should be hidden on qualifying tab`);
    }
  });

  test("shows qualifying-correlation-section on 'all' tab", () => {
    const { context, elements } = createEnv();
    context.switchMainTab('lap-chart');
    context.switchMainTab('all');
    assert.equal(elements['qualifying-correlation-section'].style.display, 'block');
  });

  test('cycling through every tab never leaves qualifying section visible on a non-qualifying tab', () => {
    const { context, elements } = createEnv();
    const qual = elements['qualifying-correlation-section'];
    for (const tab of NON_QUALIFYING_TABS) {
      context.switchMainTab('qualifying');
      context.switchMainTab(tab);
      assert.equal(qual.style.display, 'none', `leaked on '${tab}'`);
      context.switchMainTab('all');
      assert.equal(qual.style.display, 'block');
    }
  });
});
