const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Issue #8: Mobile responsive styles and zero horizontal overflow rules', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    assert.ok(html.includes('overflow-x: hidden'), 'Body or container must specify overflow-x: hidden to prevent horizontal page clipping');
    assert.ok(html.includes('.table-responsive'), 'table-responsive class must be present for horizontal scrollable data tables');
    assert.ok(html.includes('-webkit-overflow-scrolling: touch'), 'Touch-friendly momentum scrolling must be enabled for responsive tables');
});

test('Issue #8: Tabular numeric styling for timing deltas', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    assert.ok(html.includes('font-variant-numeric: tabular-nums'), 'CSS must include tabular-nums for timing precision');
    assert.ok(html.includes('tabular-num-timing') || html.includes('delta-val'), 'tabular-nums must be applied to delta timing styles');
    assert.ok(html.includes('font-family: var(--font-mono)'), 'Timing deltas must use monospace tabular font');
});

test('Issue #8: Vertical stacking on mobile viewports (<640px)', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    assert.ok(html.includes('@media (max-width: 640px)'), 'Media query for 640px mobile viewports must exist');
    assert.ok(html.includes('flex-direction: column'), 'Mobile layouts must use vertical stacking');
});

test('Issue #8: Responsive chart resize handlers', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    assert.ok(html.includes("window.addEventListener('resize'") || html.includes('resize'), 'Resize handler must be present');
});
