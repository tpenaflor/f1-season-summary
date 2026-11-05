const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv() {
  const elements = {};

  function createMockElement(id) {
    return {
      id,
      style: { display: 'none' },
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
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

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: (tag) => createMockElement('created_' + tag)
  };

  const htmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
  let match;
  let mainScript = '';
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    if (match[1].includes('pitStopState') || match[1].includes('loadPitStopTelemetry')) {
      mainScript = match[1];
      break;
    }
  }

  const contextObj = {
    console,
    setTimeout,
    clearTimeout,
    document: mockDoc,
    window: {
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    module: { exports: {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    Chart: function() {
      return {
        destroy: () => {},
        update: () => {}
      };
    }
  };
  contextObj.window.document = mockDoc;
  contextObj.addEventListener = () => {};

  vm.createContext(contextObj);
  vm.runInContext(mainScript, contextObj);

  return { context: contextObj, elements, mockDoc };
}

describe('Issue #7: Pre-2012 Seasons Pit Stop Telemetry Fallback', () => {
  test('renderPitStopPlaceholder populates informative fallback card', () => {
    const { context, elements } = createTestEnv();
    context.renderPitStopPlaceholder('2010');
    const placeholder = elements['pitStopPlaceholder'];
    assert.ok(placeholder.innerHTML.includes('2010 Formula 1 Season: No Pit Stop Telemetry'));
    assert.ok(placeholder.innerHTML.includes('2012'));
  });

  test('loadPitStopTelemetry intercepts pre-2012 seasons without making API calls', async () => {
    const { context, elements } = createTestEnv();
    await context.loadPitStopTelemetry('2010');
    
    assert.equal(elements['pitStopPlaceholder'].style.display, 'block');
    assert.equal(elements['pitStopMainContent'].style.display, 'none');
    assert.ok(elements['pitStopCacheBadge'].textContent.includes('No Timing (Pre-2012)'));
  });

  test('loadPitStopTelemetry handles post-2012 seasons by showing main content', async () => {
    const { context, elements } = createTestEnv();
    await context.loadPitStopTelemetry('2024');
    
    assert.equal(elements['pitStopPlaceholder'].style.display, 'none');
    assert.equal(elements['pitStopMainContent'].style.display, 'block');
    assert.ok(elements['pitStopCacheBadge'].textContent.includes('Live Telemetry'));
  });

  test('onPitStopSeasonChange safely triggers telemetry loading without errors', () => {
    const { context, elements } = createTestEnv();
    assert.doesNotThrow(() => {
      context.onPitStopSeasonChange('2008');
    });
    assert.equal(elements['pitStopPlaceholder'].style.display, 'block');
  });
});
