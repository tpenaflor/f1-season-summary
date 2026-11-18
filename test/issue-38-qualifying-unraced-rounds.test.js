const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Issue #38: Qualifying Correlation must not treat unraced (qualifying-only) rounds
// as DNS/P20 losses or unconverted poles.

function createEnv(customFetch) {
    const elements = {};
    const storage = {};
    function el(id) {
        return {
            id, style: {}, innerHTML: '', textContent: '', value: '', className: '', children: [],
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            appendChild(c) { this.children.push(c); return c; },
            addEventListener() {}, removeEventListener() {},
            setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] || null; },
            getContext() { return { canvas: {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {} }; }
        };
    }
    const getEl = (id) => (elements[id] = elements[id] || el(id));
    const doc = {
        getElementById: getEl, querySelectorAll: () => [], querySelector: () => null,
        createElement: () => el('created'), addEventListener() {}
    };
    const ls = {
        getItem: (k) => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; }
    };
    class MockChart { constructor(c, cfg) { this.config = cfg; } destroy() {} update() {} resize() {} }
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const scriptCode = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i)[1];
    const context = {
        window: { document: doc, addEventListener() {}, removeEventListener() {}, localStorage: ls, Chart: MockChart },
        document: doc, localStorage: ls, Chart: MockChart, fetch: customFetch || (async () => { throw new Error('offline'); }),
        console: { ...console, log() {}, warn() {}, error() {} },
        setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
        module: { exports: {} }, exports: {}
    };
    vm.createContext(context);
    vm.runInContext(scriptCode, context);
    return { exports: context.module.exports, elements, storage };
}

const DRIVERS = [
    { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
    { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
    { driverId: 'leclerc', givenName: 'Charles', familyName: 'Leclerc', code: 'LEC' }
];
const CONS = [
    { constructorId: 'red_bull', name: 'Red Bull' },
    { constructorId: 'mclaren', name: 'McLaren' },
    { constructorId: 'ferrari', name: 'Ferrari' }
];

// Rounds 1-2 raced; round 3 has qualifying only (race not yet run). Norris on pole in R3.
function qualifying() {
    return [1, 2, 3].map(round => {
        const order = round === 3 ? [1, 0, 2] : [0, 1, 2];
        return {
            season: '2026', round: String(round), raceName: `Round ${round} GP`, date: `2026-0${round}-10`,
            QualifyingResults: order.map((di, i) => ({
                position: String(i + 1), Driver: DRIVERS[di], Constructor: CONS[di], Q1: '1:30.000', Q2: '1:29.500', Q3: '1:29.000'
            }))
        };
    });
}
function results() {
    return [1, 2].map(round => ({
        season: '2026', round: String(round), raceName: `Round ${round} GP`, date: `2026-0${round}-10`,
        Results: DRIVERS.map((d, i) => ({
            position: String(i + 1), positionText: String(i + 1), grid: String(i + 1), laps: '57',
            status: 'Finished', points: '0', Driver: d, Constructor: CONS[i]
        }))
    }));
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
const races = (list) => ok({ MRData: { RaceTable: { Races: list }, total: String(list.length), limit: '1000' } });

describe('Issue #38: unraced qualifying rounds in Qualifying Correlation', () => {
    const env = createEnv();
    const compute = env.exports.computeQualifyingCorrelationMetrics;

    test('qualifying-only round produces no scatter points, DNS or losses', () => {
        const m = compute(qualifying(), results(), { season: '2026' });
        assert.equal(m.totalRaces, 2);
        assert.equal(m.points.length, 6);
        assert.ok(m.points.every(p => p.round !== '3'));
        assert.equal(m.points.filter(p => p.isDns).length, 0);
        assert.equal(m.lostCount, 0);
        assert.equal(m.parityCount, 6);
    });

    test('qualifying-only pole is not counted as an unconverted pole', () => {
        const m = compute(qualifying(), results(), { season: '2026' });
        assert.equal(m.totalPoles, 2);
        assert.equal(m.convertedWins, 2);
        assert.equal(m.unconvertedPoles, 0);
        assert.equal(m.poleConversionRate, 100);
        assert.ok(m.poleSitters.every(p => p.round !== '3'));
        const nor = m.drivers.find(d => d.driverId === 'norris');
        assert.equal(nor.poles, 0);
        assert.equal(nor.starts, 2);
        assert.equal(nor.dnfCount, 0);
        assert.equal(nor.avgFinish, 2);
    });

    test('pending rounds are reported separately', () => {
        const m = compute(qualifying(), results(), { season: '2026' });
        assert.equal(m.pendingRoundCount, 1);
        assert.equal(m.pendingRounds[0].round, '3');
        assert.equal(m.pendingRounds[0].raceName, 'Round 3 GP');
    });

    test('round with an empty Results array is treated as unraced', () => {
        const res = results();
        res.push({ season: '2026', round: '3', raceName: 'Round 3 GP', Results: [] });
        const m = compute(qualifying(), res, { season: '2026' });
        assert.equal(m.totalRaces, 2);
        assert.equal(m.totalPoles, 2);
        assert.equal(m.pendingRoundCount, 1);
    });

    test('genuine DNS in a completed race is still scored', () => {
        const res = results();
        res[1].Results[2] = { ...res[1].Results[2], position: '3', positionText: 'W', status: 'Did not start', grid: '0' };
        const m = compute(qualifying(), res, { season: '2026' });
        const dns = m.points.filter(p => p.isDns);
        assert.equal(dns.length, 1);
        assert.equal(dns[0].round, '2');
    });

    test('2024 offline fallback is unaffected', () => {
        const fb = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
        const m = compute(fb.qualifying, fb.results, { season: '2024' });
        assert.equal(m.totalRaces, 24);
        assert.equal(m.pendingRoundCount, 0);
    });

    test('cache: snapshots with pending rounds or legacy winnerless poles are rejected', () => {
        const v = env.exports.isValidQualifyingCorrelationCache;
        assert.equal(v({ season: '2026', totalRaces: 2, points: [], pendingRoundCount: 1, pendingRounds: [{ round: '3' }] }), false);
        assert.equal(v({ season: '2026', totalRaces: 3, points: [], poleSitters: [{ round: '3', winnerDriverId: null }] }), false);
        assert.equal(v({ season: '2026', totalRaces: 2, points: [], pendingRoundCount: 0, poleSitters: [{ round: '1', winnerDriverId: 'max_verstappen' }] }), true);
    });

    test('live Jolpica load renders pending note and does not cache the in-progress snapshot', async () => {
        const live = createEnv(async (url) => {
            if (url.includes('/qualifying')) return races(qualifying());
            if (url.includes('/results')) return races(results());
            return races([]);
        });
        const m = await live.exports.loadQualifyingCorrelationData('2026', true);
        assert.equal(m.totalPoles, 2);
        assert.equal(m.unconvertedPoles, 0);
        assert.match(live.elements.qualSubConversion.textContent, /2 of 2 Poles Converted to Win \(1 upcoming race pending\)/);
        assert.equal(live.storage.f1_qualifying_correlation_2026, undefined);
    });

    test('fully completed live season is cached', async () => {
        const res = results();
        res.push({
            season: '2026', round: '3', raceName: 'Round 3 GP',
            Results: [1, 0, 2].map((di, i) => ({
                position: String(i + 1), positionText: String(i + 1), grid: String(i + 1), laps: '57',
                status: 'Finished', Driver: DRIVERS[di], Constructor: CONS[di]
            }))
        });
        const live = createEnv(async (url) => {
            if (url.includes('/qualifying')) return races(qualifying());
            if (url.includes('/results')) return races(res);
            return races([]);
        });
        const m = await live.exports.loadQualifyingCorrelationData('2026', true);
        assert.equal(m.totalRaces, 3);
        assert.equal(m.totalPoles, 3);
        assert.equal(m.convertedWins, 3);
        assert.ok(live.storage.f1_qualifying_correlation_2026);
    });
});
