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
    assert.ok(html.includes('tabular-num-timing'), 'tabular-num-timing class must be defined and styled');
    assert.ok(html.includes('stat-val tabular-num-timing'), 'Teammate pace stat values must use tabular numbers');
    assert.ok(html.includes('pace-delta-badge tabular-num-timing'), 'Pace delta badge must use tabular numbers');
});

test('Issue #8: Vertical stacking on mobile viewports (<640px)', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    assert.ok(html.includes('@media (max-width: 640px)'), 'Media query for 640px mobile viewports must exist');
    assert.ok(html.includes('.teammate-comparison-card'), 'Teammate comparison card must be styled for mobile viewports');
    assert.ok(html.includes('flex-direction: column'), 'Mobile layouts must use vertical stacking');
});

test('Issue #8: Responsive chart resize handlers', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

    assert.ok(html.includes("window.addEventListener('resize'"), 'Resize event listener must be registered for responsive chart redraws');
    assert.ok(html.includes('telemetryRadarChartInstance.resize()'), 'Radar chart must resize on window resize');
    assert.ok(html.includes('telemetryDeltaChartInstance.resize()'), 'Delta chart must resize on window resize');
    assert.ok(html.includes('sprintDisparityChartInstance.resize()'), 'Sprint disparity chart must resize on window resize');
});
