const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Issue #37: Empty or failed Jolpica API responses must never be poisoned into
// localStorage for the Qualifying Correlation and Reliability tabs.

function createEnv(customFetch) {
    const elements = {};
    const storage = {};

    function createMockElement(id, tag = 'div') {
        const classes = new Set();
        return {
            id,
            tagName: tag.toUpperCase(),
            classList: {
                add: (...c) => c.forEach(x => classes.add(x)),
                remove: (...c) => c.forEach(x => classes.delete(x)),
                toggle: (c, force) => {
                    if (force === undefined ? !classes.has(c) : force) classes.add(c);
                    else classes.delete(c);
                },
                contains: (c) => classes.has(c)
            },
            style: { display: '' },
            innerHTML: '',
            textContent: '',
            value: '',
            className: '',
            children: [],
            appendChild(child) { this.children.push(child); return child; },
            addEventListener() {},
            removeEventListener() {},
            setAttribute(k, v) { this[k] = v; },
            getAttribute(k) { return this[k] || null; },
            getContext() { return { canvas: {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {} }; }
        };
    }
    const getEl = (id) => (elements[id] = elements[id] || createMockElement(id));

    const mockDoc = {
        getElementById: getEl,
        querySelectorAll: () => [],
        querySelector: () => null,
        createElement: (tag) => createMockElement('created_' + Math.random().toString(36).slice(2), tag),
        addEventListener() {}
    };
    const mockStorage = {
        getItem: (k) => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; },
        clear: () => Object.keys(storage).forEach(k => delete storage[k])
    };
    class MockChart {
        constructor(ctx, config) { this.config = config; this.data = config?.data || { datasets: [] }; this.options = config?.options || {}; }
        destroy() {}
        resize() {}
        update() {}
    }

    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const scriptCode = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i)[1];

    const context = {
        window: { document: mockDoc, addEventListener() {}, removeEventListener() {}, localStorage: mockStorage, Chart: MockChart },
        document: mockDoc,
        localStorage: mockStorage,
        Chart: MockChart,
        fetch: customFetch,
        console: { ...console, log() {}, warn() {}, error() {} },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout() {},
        module: { exports: {} },
        exports: {}
    };
    vm.createContext(context);
    vm.runInContext(scriptCode, context);
    return { exports: context.module.exports, elements, storage };
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const emptyPayload = () => ok({ MRData: { RaceTable: { Races: [] }, total: '0', limit: '100' } });
const racesPayload = (races) => ok({ MRData: { RaceTable: { Races: races }, total: String(races.length), limit: '1000' } });

const DRIVERS = [
    { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
    { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' }
];
const CONSTRUCTORS = [
    { constructorId: 'red_bull', name: 'Red Bull' },
    { constructorId: 'mclaren', name: 'McLaren' }
];

function qualifyingRaces() {
    return [1, 2].map(round => ({
        season: '2023', round: String(round), raceName: `Round ${round} GP`,
        QualifyingResults: DRIVERS.map((d, i) => ({ position: String(i + 1), Driver: d, Constructor: CONSTRUCTORS[i] }))
    }));
}
function resultRaces() {
    return [1, 2].map(round => ({
        season: '2023', round: String(round), raceName: `Round ${round} GP`,
        Results: DRIVERS.map((d, i) => ({
            position: String(i + 1), grid: String(i + 1), laps: i === 1 && round === 2 ? '30' : '57',
            status: i === 1 && round === 2 ? 'Engine' : 'Finished', points: i === 0 ? '25' : '18',
            Driver: d, Constructor: CONSTRUCTORS[i]
        }))
    }));
}

function routedFetch({ qualifying, results, status }) {
    return async (url) => {
        if (url.includes('/qualifying')) return qualifying(url);
        if (url.includes('/results')) return results(url);
        if (url.includes('/status')) return status ? status(url) : emptyPayload();
        return emptyPayload();
    };
}
const fail = async () => { throw new Error('HTTP 503 Service Unavailable'); };

describe('Issue #37: Qualifying Correlation cache poisoning', () => {
    const KEY_2023 = 'f1_qualifying_correlation_2023';
    const KEY_2024 = 'f1_qualifying_correlation_2024';

    test('does not cache empty API responses (non-2024 zeroed metrics)', async () => {
        const env = createEnv(async () => emptyPayload());
        const metrics = await env.exports.loadQualifyingCorrelationData('2023', true);
        assert.ok(metrics);
        assert.equal(metrics.totalRaces, 0);
        assert.equal(env.storage[KEY_2023], undefined);
    });

    test('does not cache the 2024 offline fallback after an empty response', async () => {
        const env = createEnv(async () => emptyPayload());
        const metrics = await env.exports.loadQualifyingCorrelationData('2024', true);
        assert.equal(metrics.totalRaces, 24);
        assert.equal(env.elements.qualifyingCacheBadge.textContent, '⚠️ Offline Fallback');
        assert.equal(env.storage[KEY_2024], undefined);
    });

    test('does not cache when the network fails entirely', async () => {
        const env = createEnv(fail);
        await env.exports.loadQualifyingCorrelationData('2024', true);
        await env.exports.loadQualifyingCorrelationData('2023', true);
        assert.equal(env.storage[KEY_2024], undefined);
        assert.equal(env.storage[KEY_2023], undefined);
    });

    test('does not cache partial data when one endpoint fails', async () => {
        const env = createEnv(routedFetch({ qualifying: async () => racesPayload(qualifyingRaces()), results: fail }));
        const metrics = await env.exports.loadQualifyingCorrelationData('2023', true);
        assert.ok(metrics.totalRaces > 0);
        assert.equal(env.elements.qualifyingCacheBadge.textContent, '⚠️ Partial Jolpica Data');
        assert.equal(env.storage[KEY_2023], undefined);
    });

    test('caches complete live Jolpica data', async () => {
        const env = createEnv(routedFetch({
            qualifying: async () => racesPayload(qualifyingRaces()),
            results: async () => racesPayload(resultRaces())
        }));
        const metrics = await env.exports.loadQualifyingCorrelationData('2023', true);
        assert.equal(metrics.totalRaces, 2);
        assert.equal(env.elements.qualifyingCacheBadge.textContent, '🌐 Live Jolpica API');
        assert.ok(env.storage[KEY_2023]);
        assert.equal(JSON.parse(env.storage[KEY_2023]).totalRaces, 2);
    });

    test('a failed refresh does not overwrite a previously valid cache entry', async () => {
        const env = createEnv(fail);
        const good = JSON.stringify({ season: '2023', totalRaces: 22, totalPoles: 22, points: [], drivers: [], poleSitters: [] });
        env.storage[KEY_2023] = good;
        await env.exports.loadQualifyingCorrelationData('2023', true);
        assert.equal(env.storage[KEY_2023], good);
    });

    test('purges previously poisoned empty entries and refetches', async () => {
        let fetches = 0;
        const env = createEnv(async (url) => { fetches++; return emptyPayload(url); });
        env.storage[KEY_2023] = JSON.stringify({ season: '2023', totalRaces: 0, points: [], drivers: [], poleSitters: [] });
        await env.exports.loadQualifyingCorrelationData('2023', false);
        assert.ok(fetches >= 2, 'poisoned cache must not short-circuit the network');
        assert.equal(env.storage[KEY_2023], undefined);
    });

    test('purges a previously poisoned 2024 offline-fallback entry', async () => {
        const env = createEnv(async () => emptyPayload());
        const fb = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
        const poisoned = env.exports.computeQualifyingCorrelationMetrics(fb.qualifying, fb.results, { season: '2024' });
        env.storage[KEY_2024] = JSON.stringify(poisoned);
        await env.exports.loadQualifyingCorrelationData('2024', false);
        assert.notEqual(env.elements.qualifyingCacheBadge.textContent, '⚡ Instant (Cached)');
        assert.equal(env.storage[KEY_2024], undefined);
    });

    test('purges corrupt JSON-but-invalid entries (null, arrays, objects without races)', () => {
        const env = createEnv(async () => emptyPayload());
        const v = env.exports.isValidQualifyingCorrelationCache;
        assert.equal(v(null), false);
        assert.equal(v([]), false);
        assert.equal(v({ season: '2024', dummy: true }), false);
        assert.equal(v({ season: '2023', totalRaces: 3, points: [], isFallback: true }), false);
        assert.equal(v({ season: '2023', totalRaces: 3, points: [] }), true);
    });
});

describe('Issue #37: Reliability cache poisoning', () => {
    const KEY_2023 = 'f1_reliability_2023';
    const KEY_2024 = 'f1_reliability_2024';

    test('does not cache zeroed metrics from an empty response', async () => {
        const env = createEnv(async () => emptyPayload());
        const metrics = await env.exports.loadReliabilityData('2023', true);
        assert.equal(metrics.totalRaces, 0);
        assert.equal(env.storage[KEY_2023], undefined);
    });

    test('does not cache RELIABILITY_FALLBACK_2024 after an empty or failed response', async () => {
        const envEmpty = createEnv(async () => emptyPayload());
        const m1 = await envEmpty.exports.loadReliabilityData('2024', true);
        assert.ok(m1.constructors.length > 0);
        assert.equal(envEmpty.storage[KEY_2024], undefined);

        const envFail = createEnv(fail);
        const m2 = await envFail.exports.loadReliabilityData('2024', true);
        assert.ok(m2.constructors.length > 0);
        assert.equal(envFail.storage[KEY_2024], undefined);
    });

    test('caches metrics computed from live Jolpica results', async () => {
        const env = createEnv(routedFetch({ qualifying: fail, results: async () => racesPayload(resultRaces()) }));
        const metrics = await env.exports.loadReliabilityData('2023', true);
        assert.equal(metrics.totalRaces, 2);
        assert.ok(env.storage[KEY_2023]);
        assert.equal(JSON.parse(env.storage[KEY_2023]).totalEntries, 4);
    });

    test('a failed refresh does not overwrite a previously valid cache entry', async () => {
        const env = createEnv(fail);
        const good = JSON.stringify({ season: '2023', totalRaces: 22, totalEntries: 440, constructors: [], drivers: [] });
        env.storage[KEY_2023] = good;
        await env.exports.loadReliabilityData('2023', true);
        assert.equal(env.storage[KEY_2023], good);
    });

    test('purges previously poisoned empty and fallback entries on read', async () => {
        let fetches = 0;
        const env = createEnv(async (url) => { fetches++; return emptyPayload(url); });
        env.storage[KEY_2023] = JSON.stringify({ season: '2023', totalRaces: 0, totalEntries: 0, constructors: [], drivers: [] });
        env.storage[KEY_2024] = JSON.stringify(env.exports.RELIABILITY_FALLBACK_2024);

        await env.exports.loadReliabilityData('2023', false);
        assert.ok(fetches >= 1, 'poisoned cache must not short-circuit the network');
        assert.equal(env.storage[KEY_2023], undefined);

        await env.exports.loadReliabilityData('2024', false);
        assert.equal(env.storage[KEY_2024], undefined);
    });

    test('isValidReliabilityCache rejects malformed payloads', () => {
        const env = createEnv(async () => emptyPayload());
        const v = env.exports.isValidReliabilityCache;
        assert.equal(v(null), false);
        assert.equal(v('x'), false);
        assert.equal(v(env.exports.RELIABILITY_FALLBACK_2024), false);
        assert.equal(v({ totalRaces: 2, totalEntries: 0, constructors: [], drivers: [] }), false);
        assert.equal(v({ totalRaces: 2, totalEntries: 40, constructors: {}, drivers: [] }), false);
        assert.equal(v({ totalRaces: 2, totalEntries: 40, constructors: [], drivers: [] }), true);
    });
});
