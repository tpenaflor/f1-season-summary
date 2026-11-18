const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

test('Issue #32: Clinch Engine table is wrapped in clinch-table-wrapper and table-responsive', () => {
    const wrapperMatch = html.match(/<div\s+class="([^"]*clinch-table-wrapper[^"]*)"[^>]*>\s*<table[^>]*id="clinchScenarioMatrixTable"/);
    assert.ok(wrapperMatch, 'clinchScenarioMatrixTable must be directly wrapped in a .clinch-table-wrapper div');
    const classes = wrapperMatch[1].split(/\s+/);
    assert.ok(classes.includes('clinch-table-wrapper'), 'Wrapper must have clinch-table-wrapper class');
    assert.ok(classes.includes('table-responsive'), 'Wrapper must also have table-responsive class');
});

test('Issue #32: .clinch-table-wrapper CSS enforces bounded width and touch horizontal scroll', () => {
    const cssMatch = html.match(/\.clinch-table-wrapper\s*\{([^}]+)\}/);
    assert.ok(cssMatch, '.clinch-table-wrapper CSS rule must exist');
    const rule = cssMatch[1];
    assert.match(rule, /overflow-x:\s*auto/);
    assert.match(rule, /width:\s*100%/);
    assert.match(rule, /max-width:\s*100%/);
    assert.match(rule, /-webkit-overflow-scrolling:\s*touch/);
});

test('Issue #32: @media (max-width: 640px) enforces scroll wrapper and min-width on .clinch-table', () => {
    const mediaMatches = [...html.matchAll(/@media\s*\(max-width:\s*640px\)\s*\{/g)];
    assert.ok(mediaMatches.length > 0, '@media (max-width: 640px) block must exist');
    const hasClinchMobileRules = mediaMatches.some((m) => {
        const mediaSlice = html.slice(m.index, m.index + 1200);
        return (
            /\.clinch-table-wrapper\s*\{[^}]*overflow-x:\s*auto/.test(mediaSlice) &&
            /\.clinch-table-wrapper\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/.test(mediaSlice) &&
            /\.clinch-table-wrapper\s*\{[^}]*max-width:\s*100%/.test(mediaSlice) &&
            /\.clinch-table\s*\{[^}]*min-width:\s*640px/.test(mediaSlice)
        );
    });
    assert.ok(hasClinchMobileRules, '@media (max-width: 640px) must enforce scroll wrapper and min-width: 640px on .clinch-table');
});
