const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScriptExports(customFetch = async () => ({ ok: true, json: async () => ({}) })) {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
    const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) throw new Error('No script in index.html');

    // Parse elements with an id from real index.html markup
    const realElements = {};
    function createMockElement(id, tagName = 'div') {
        const el = {
            id,
            tagName: tagName.toUpperCase(),
            _textContent: '',
            get textContent() {
                return this._textContent;
            },
            set textContent(val) {
                this._textContent = String(val);
            },
            _innerHTML: '',
            get innerHTML() {
                return this._innerHTML;
            },
            set innerHTML(val) {
                this._innerHTML = String(val);
                // When innerHTML is set, parse child elements with an id and register them
                const childIdRegex = /<([a-zA-Z0-9-]+)[^>]*\bid=["']([^"']+)["'][^>]*>/g;
                let cMatch;
                while ((cMatch = childIdRegex.exec(val)) !== null) {
                    const cId = cMatch[2];
                    if (!realElements[cId]) {
                        realElements[cId] = createMockElement(cId, cMatch[1]);
                    }
                }
            },
            style: {},
            classList: {
                classes: new Set(),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            },
            addEventListener: () => {},
            getContext: () => ({
                canvas: {},
                clearRect: () => {},
                beginPath: () => {},
                stroke: () => {},
                fill: () => {}
            })
        };
        return el;
    }

    const markupBeforeScript = html.substring(0, scriptMatch.index);
    const idRegex = /<([a-zA-Z0-9-]+)[^>]*\bid=["']([^"']+)["'][^>]*>/g;
    let match;
    while ((match = idRegex.exec(markupBeforeScript)) !== null) {
        const tagName = match[1];
        const id = match[2];
        realElements[id] = createMockElement(id, tagName);
    }

    const doc = {
        getElementById: (id) => {
            // Strictly returns elements that actually exist in the DOM, otherwise null
            return realElements[id] || null;
        },
        querySelectorAll: () => [],
        addEventListener: () => {}
    };

    const mockStorage = {
        store: {},
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = String(v); },
        removeItem(k) { delete this.store[k]; },
        clear() { this.store = {}; }
    };

    const sandbox = {
        document: doc,
        window: { addEventListener: () => {} },
        fetch: customFetch,
        Chart: function() {
            this.destroy = () => {};
            this.resize = () => {};
            this.update = () => {};
            this.data = { datasets: [] };
        },
        module: { exports: {} },
        exports: {},
        localStorage: mockStorage,
        setTimeout: (fn) => setTimeout(fn, 0),
        console: { ...console, warn: () => {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(scriptMatch[1], sandbox);
    return {
        exports: sandbox.module.exports,
        mockElements: realElements,
        realElements,
        document: doc,
        localStorage: mockStorage,
        html
    };
}

test('Issue #19: #statLeadingConstructor and #statLeadingConstructorPts exist in index.html markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
    assert.ok(html.includes('id="statLeadingConstructor"'), 'index.html must include id="statLeadingConstructor"');
    assert.ok(html.includes('id="statLeadingConstructorPts"'), 'index.html must include id="statLeadingConstructorPts"');

    const pillsMatch = html.match(/<div[^>]*id=["']chart-stat-pills["'][^>]*>([\s\S]*?)<\/div>/i);
    assert.ok(pillsMatch, '#chart-stat-pills container must exist in index.html');
    assert.ok(pillsMatch[0].includes('id="statLeadingConstructor"'), '#statLeadingConstructor must be inside chart stats pills container');
    assert.ok(pillsMatch[0].includes('id="statLeadingConstructorPts"'), '#statLeadingConstructorPts must be inside chart stats pills container');
});

test('Issue #19: Real DOM presence verified via getElementById without auto-generated dummy mocks', () => {
    const { document: doc } = loadScriptExports();
    const leadingConstructorEl = doc.getElementById('statLeadingConstructor');
    const leadingConstructorPtsEl = doc.getElementById('statLeadingConstructorPts');

    assert.ok(leadingConstructorEl !== null, '#statLeadingConstructor element must exist in real DOM');
    assert.ok(leadingConstructorPtsEl !== null, '#statLeadingConstructorPts element must exist in real DOM');
    assert.equal(doc.getElementById('nonExistentIdXYZ'), null, 'Non-existent element ID must return null');
});

test('Issue #19: updateChartStatsPills includes stats pills and calls renderStatsSummary during progression update', () => {
    const { exports: f1App, realElements } = loadScriptExports();
    const seasonData = {
        season: '2021',
        races: [{ raceName: 'Abu Dhabi Grand Prix' }],
        drivers: [
            { name: 'Max Verstappen', latestPoints: 395.5 },
            { name: 'Lewis Hamilton', latestPoints: 387.5 }
        ],
        constructorStandings: [
            { position: '1', Constructor: { name: 'Mercedes' }, points: '613.5' },
            { position: '2', Constructor: { name: 'Red Bull' }, points: '585.5' }
        ]
    };

    f1App.updateChartStatsPills(seasonData);
    assert.equal(realElements['statLeadingConstructor'].textContent, 'Mercedes');
    assert.equal(realElements['statLeadingConstructorPts'].textContent, '613.5 PTS');
});

test('Issue #19: progression lifecycle renders pre-1958 WCC disclaimer when updated', () => {
    const { exports: f1App, realElements } = loadScriptExports();
    const seasonData1950 = {
        season: '1950',
        races: [{ raceName: 'British Grand Prix' }],
        drivers: [
            { name: 'Nino Farina', latestPoints: 30 }
        ],
        constructorStandings: []
    };

    f1App.updateChartStatsPills(seasonData1950);
    assert.equal(realElements['statLeadingConstructor'].textContent, 'None (Inaugurated 1958)');
    assert.equal(realElements['statLeadingConstructorPts'].textContent, 'No WCC prior to 1958');
});

test('Issue #19: loadSeasonStandingsProgression fetches constructor standings and calls renderStatsSummary', async () => {
    const mockRacesResp = {
        MRData: {
            RaceTable: {
                Races: [
                    { round: '1', raceName: 'Bahrain Grand Prix' }
                ]
            }
        }
    };
    const mockStandingsResp = {
        MRData: {
            StandingsTable: {
                StandingsLists: [
                    {
                        round: '1',
                        DriverStandings: [
                            {
                                position: '1',
                                points: '25',
                                Driver: { driverId: 'verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                                Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }]
                            }
                        ]
                    }
                ]
            }
        }
    };
    const mockConstructorResp = {
        MRData: {
            StandingsTable: {
                StandingsLists: [
                    {
                        ConstructorStandings: [
                            {
                                position: '1',
                                points: '44',
                                Constructor: { constructorId: 'mercedes', name: 'Mercedes' }
                            }
                        ]
                    }
                ]
            }
        }
    };

    const customFetch = async (url) => {
        if (url.includes('/constructorStandings.json')) {
            return { ok: true, json: async () => mockConstructorResp };
        }
        if (url.includes('/races.json')) {
            return { ok: true, json: async () => mockRacesResp };
        }
        if (url.includes('/driverStandings.json')) {
            return { ok: true, json: async () => mockStandingsResp };
        }
        return { ok: true, json: async () => ({}) };
    };

    const { exports: f1App, realElements } = loadScriptExports(customFetch);
    await f1App.loadSeasonStandingsProgression('2021', true);

    assert.equal(realElements['statLeadingConstructor'].textContent, 'Mercedes');
    assert.equal(realElements['statLeadingConstructorPts'].textContent, '44 PTS');
});

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
