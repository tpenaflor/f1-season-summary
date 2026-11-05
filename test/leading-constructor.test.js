const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScriptExports() {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
    const scriptMatch = html.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) throw new Error('No script in index.html');
    const mockElements = {};
    const sandbox = {
        document: {
            getElementById: (id) => {
                if (!mockElements[id]) {
                    mockElements[id] = { textContent: '', style: {} };
                }
                return mockElements[id];
            },
            addEventListener: () => {}
        },
        window: { addEventListener: () => {} },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        Chart: function() { this.destroy = () => {}; this.resize = () => {}; },
        module: { exports: {} },
        exports: {},
        console
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptMatch[1], sandbox);
    return { exports: sandbox.module.exports, mockElements };
}

test('Issue #10: Pre-1958 seasons show explicit explanatory badge for no WCC', () => {
    const { exports: f1App, mockElements } = loadScriptExports();
    f1App.renderStatsSummary([], [], 1950);
    assert.equal(mockElements['statLeadingConstructor'].textContent, 'None (Inaugurated 1958)');
    assert.equal(mockElements['statLeadingConstructorPts'].textContent, 'No WCC prior to 1958');

    f1App.renderStatsSummary([], [], '1957');
    assert.equal(mockElements['statLeadingConstructor'].textContent, 'None (Inaugurated 1958)');
    assert.equal(mockElements['statLeadingConstructorPts'].textContent, 'No WCC prior to 1958');
});

test('Issue #10: Divergent split championships (2021) correctly identify Constructors Champion', () => {
    const { exports: f1App, mockElements } = loadScriptExports();
    const driverStandings = [
        { position: '1', Driver: { code: 'VER' }, Constructors: [{ name: 'Red Bull' }], points: '395.5' },
        { position: '2', Driver: { code: 'HAM' }, Constructors: [{ name: 'Mercedes' }], points: '387.5' }
    ];
    const constructorStandings = [
        { position: '1', Constructor: { name: 'Mercedes' }, points: '613.5' },
        { position: '2', Constructor: { name: 'Red Bull' }, points: '585.5' }
    ];

    f1App.renderStatsSummary(driverStandings, constructorStandings, 2021);
    assert.equal(mockElements['statLeadingConstructor'].textContent, 'Mercedes', 'Constructor champion must be Mercedes, not Red Bull');
    assert.equal(mockElements['statLeadingConstructorPts'].textContent, '613.5 PTS');
});

test('Issue #10: Divergent split championships (2008 & 1999)', () => {
    const { exports: f1App, mockElements } = loadScriptExports();
    const cStandings2008 = [
        { position: '1', Constructor: { name: 'Ferrari' }, points: '172' }
    ];
    f1App.renderStatsSummary([], cStandings2008, 2008);
    assert.equal(mockElements['statLeadingConstructor'].textContent, 'Ferrari');
    assert.equal(mockElements['statLeadingConstructorPts'].textContent, '172 PTS');

    const cStandings1999 = [
        { position: '1', Constructor: { name: 'Ferrari' }, points: '128' }
    ];
    f1App.renderStatsSummary([], cStandings1999, 1999);
    assert.equal(mockElements['statLeadingConstructor'].textContent, 'Ferrari');
    assert.equal(mockElements['statLeadingConstructorPts'].textContent, '128 PTS');
});
