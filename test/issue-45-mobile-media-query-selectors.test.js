const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');

/**
 * Extract all balanced `@media (max-width: 640px) { ... }` blocks from CSS.
 */
function extractMax640MediaBlocks(source) {
    const blocks = [];
    const regex = /@media\s*\(max-width:\s*640px\)\s*\{/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        let depth = 1;
        let idx = match.index + match[0].length;
        while (idx < source.length && depth > 0) {
            if (source[idx] === '{') depth++;
            else if (source[idx] === '}') depth--;
            idx++;
        }
        blocks.push(source.slice(match.index + match[0].length, idx - 1));
    }
    return blocks;
}

test('Issue #45: Dead selectors are removed from @media (max-width: 640px)', () => {
    const deadSelectors = [
        '.teammate-comparison-card',
        '.telemetry-radar-wrapper',
        '.sprint-disparity-layout',
    ];
    for (const sel of deadSelectors) {
        assert.equal(
            html.includes(sel),
            false,
            `Dead selector "${sel}" must not exist in index.html`
        );
    }
});

test('Issue #45: Every class selector in @media (max-width: 640px) matches actual DOM/template classes', () => {
    const blocks = extractMax640MediaBlocks(html);
    assert.ok(blocks.length >= 2, 'Expected @media (max-width: 640px) blocks in index.html');

    // Collect all class="..." attributes in HTML and JS template strings
    const domClasses = new Set();
    const classAttrRegex = /class\s*=\s*["'`]([^"'`]+)["'`]/g;
    let m;
    while ((m = classAttrRegex.exec(html)) !== null) {
        // Strip template literal expressions like ${...} before splitting
        const cleaned = m[1].replace(/\$\{[^}]+\}/g, ' ');
        for (const token of cleaned.split(/\s+/)) {
            if (token) domClasses.add(token);
        }
    }

    // Collect all class selectors used inside @media (max-width: 640px)
    const mediaClassSelectors = new Set();
    for (const block of blocks) {
        // Strip property bodies `{ ... }` so we only inspect selector lists
        const selectorsOnly = block.replace(/\{[^}]*\}/g, ' ');
        const classSelRegex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
        let s;
        while ((s = classSelRegex.exec(selectorsOnly)) !== null) {
            mediaClassSelectors.add(s[1]);
        }
    }

    assert.ok(mediaClassSelectors.size > 0, 'Expected class selectors inside @media (max-width: 640px)');

    for (const cls of mediaClassSelectors) {
        assert.ok(
            domClasses.has(cls),
            `CSS selector ".${cls}" in @media (max-width: 640px) does not match any DOM or template class`
        );
    }
});

test('Issue #45: Mobile stacking and responsive table rules remain intact in @media (max-width: 640px)', () => {
    const blocks = extractMax640MediaBlocks(html);
    const combined = blocks.join('\n');

    assert.match(combined, /flex-direction:\s*column/);
    assert.match(combined, /grid-template-columns:\s*1fr/);
    assert.match(combined, /overflow-x:\s*auto/);
    assert.match(combined, /-webkit-overflow-scrolling:\s*touch/);
    assert.match(combined, /\.clinch-table\s*\{[^}]*min-width:\s*640px/);
});
