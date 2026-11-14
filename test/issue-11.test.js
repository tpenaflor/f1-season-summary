const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnvironment(customFetch) {
    const elements = {};
    const listeners = {};
    const storage = {};

    function createMockElement(id, tag = 'div') {
        const classes = new Set();
        return {
            id,
            tagName: tag.toUpperCase(),
            classList: {
                add: (...cls) => cls.forEach(c => classes.add(c)),
                remove: (...cls) => cls.forEach(c => classes.delete(c)),
                toggle: (c, force) => {
                    if (force !== undefined) {
                        force ? classes.add(c) : classes.delete(c);
                    } else {
                        classes.has(c) ? classes.delete(c) : classes.add(c);
                    }
                },
                contains: (c) => classes.has(c)
            },
            style: { display: '' },
            innerHTML: '',
            textContent: '',
            value: '',
            checked: false,
            children: [],
            appendChild(child) {
                this.children.push(child);
                return child;
            },
            addEventListener(event, fn) {
                listeners[id] = listeners[id] || {};
                listeners[id][event] = listeners[id][event] || [];
                listeners[id][event].push(fn);
            },
            getContext() {
                return {
                    canvas: {},
                    clearRect() {},
                    beginPath() {},
                    stroke() {},
                    fill() {}
                };
            }
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
        querySelectorAll: (selector) => {
            if (selector === '.tab-btn') {
                return [
                    getOrCreateEl('tabBtnAll'),
                    getOrCreateEl('tabBtnLapChart'),
                    getOrCreateEl('tabBtnStints'),
                    getOrCreateEl('tabBtnFinishingGap'),
                    getOrCreateEl('tabBtnProfiler'),
                    getOrCreateEl('tabBtnConstructors'),
                    getOrCreateEl('tabBtnMomentum'),
                    getOrCreateEl('tabBtnSprint'),
                    getOrCreateEl('tabBtnClinch'),
                    getOrCreateEl('tabBtnPitStops'),
                    getOrCreateEl('tabBtnReliability'),
                    getOrCreateEl('tabBtnQualifying'),
                    getOrCreateEl('tabBtnOvertake'),
                    getOrCreateEl('tabBtnTelemetry'),
                    getOrCreateEl('tabBtnProgression'),
                    getOrCreateEl('tabBtnResults')
                ];
            }
            return [];
        },
        createElement: (tag) => createMockElement('created_' + Math.random().toString(36).substring(7), tag),
        addEventListener: (event, fn) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        }
    };

    const mockStorage = {
        getItem: (k) => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: (k) => { delete storage[k]; },
        clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
    };

    const createdCharts = [];
    class MockChart {
        constructor(ctx, config) {
            this.ctx = ctx;
            this.config = config;
            this.data = config?.data || { datasets: [] };
            this.options = config?.options || {};
            this.destroyed = false;
            this.resized = false;
            this.updated = false;
            createdCharts.push(this);
        }
        destroy() { this.destroyed = true; }
        resize() { this.resized = true; }
        update() { this.updated = true; }
    }

    const activeFetch = customFetch || (async () => {
        return {
            ok: true,
            status: 200,
            json: async () => ({ MRData: { RaceTable: { Races: [] }, total: '0', limit: '100' } })
        };
    });

    const indexPath = path.join(__dirname, '..', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const scriptMatch = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) throw new Error('Could not find <script> in index.html');
    const scriptCode = scriptMatch[1];

    const context = {
        window: {
            document: mockDoc,
            addEventListener: () => {},
            removeEventListener: () => {},
            localStorage: mockStorage,
            Chart: MockChart
        },
        document: mockDoc,
        localStorage: mockStorage,
        Chart: MockChart,
        fetch: activeFetch,
        console: { ...console, warn: () => {}, error: () => {} },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
        module: { exports: {} },
        exports: {}
    };

    vm.createContext(context);
    vm.runInContext(scriptCode, context);

    return {
        html,
        exports: context.module.exports,
        window: context.window,
        elements,
        storage,
        createdCharts,
        mockDoc
    };
}

describe('Issue #11: Grid Position vs Race Finish Delta (Positions Gained / Lost & Season Overtake Index)', () => {
    describe('calculatePositionDelta / computeGridFinishDelta', () => {
        test('computes positive delta when driver gains positions from starting grid', () => {
            const env = createTestEnvironment();
            const res = env.exports.calculatePositionDelta(17, 1);

            assert.strictEqual(res.isValid, true);
            assert.strictEqual(res.delta, 16);
            assert.strictEqual(res.positionsGained, 16);
            assert.strictEqual(res.positionsLost, 0);
            assert.strictEqual(res.category, 'gained');
            assert.strictEqual(res.formatted, '+16');
            assert.strictEqual(res.badgeClass, 'delta-gained');
        });

        test('computes negative delta when driver loses positions from starting grid', () => {
            const env = createTestEnvironment();
            const res = env.exports.calculatePositionDelta({
                grid: '2',
                position: '7',
                status: 'Finished'
            });

            assert.strictEqual(res.isValid, true);
            assert.strictEqual(res.delta, -5);
            assert.strictEqual(res.positionsGained, 0);
            assert.strictEqual(res.positionsLost, 5);
            assert.strictEqual(res.category, 'lost');
            assert.strictEqual(res.formatted, '-5');
            assert.strictEqual(res.badgeClass, 'delta-lost');
        });

        test('computes zero parity delta when grid equals finishing position', () => {
            const env = createTestEnvironment();
            const res = env.exports.calculatePositionDelta('1', '1');

            assert.strictEqual(res.isValid, true);
            assert.strictEqual(res.delta, 0);
            assert.strictEqual(res.positionsGained, 0);
            assert.strictEqual(res.positionsLost, 0);
            assert.strictEqual(res.category, 'parity');
            assert.strictEqual(res.formatted, '0');
            assert.strictEqual(res.badgeClass, 'delta-parity');
        });

        test('handles DNS / Withdrawn and pit-lane grid starts accurately', () => {
            const env = createTestEnvironment();
            const dnsRes = env.exports.calculatePositionDelta({
                grid: '10',
                position: '20',
                positionText: 'W',
                status: 'Withdrew'
            });
            assert.strictEqual(dnsRes.isDns, true);
            assert.strictEqual(dnsRes.isValid, false);
            assert.strictEqual(dnsRes.delta, 0);

            const pitLaneRes = env.exports.calculatePositionDelta(
                { grid: '0', position: '8', status: 'Finished' },
                { pitLaneGrid: 20 }
            );
            assert.strictEqual(pitLaneRes.isPitLaneStart, true);
            assert.strictEqual(pitLaneRes.isValid, true);
            assert.strictEqual(pitLaneRes.effectiveGrid, 20);
            assert.strictEqual(pitLaneRes.delta, 12);
            assert.strictEqual(pitLaneRes.positionsGained, 12);
        });
    });

    describe('calculateOvertakeIndex / computeOvertakeIndex', () => {
        test('calculates positive Overtake Index for net gainers and negative for losers', () => {
            const env = createTestEnvironment();
            const gainIdx = env.exports.calculateOvertakeIndex(16, 0, 2);
            const parityIdx = env.exports.calculateOvertakeIndex(0, 0, 2);
            const lossIdx = env.exports.calculateOvertakeIndex(0, 10, 2);

            assert.ok(gainIdx > 0, 'Overtake Index should be > 0 for net position gainer');
            assert.strictEqual(parityIdx, 0, 'Overtake Index should be 0 for zero gain/loss');
            assert.ok(lossIdx < 0, 'Overtake Index should be < 0 for net position loser');
            assert.ok(gainIdx > parityIdx && parityIdx > lossIdx);
        });

        test('supports object and array inputs', () => {
            const env = createTestEnvironment();
            const fromObj = env.exports.calculateOvertakeIndex({
                positionsGained: 12,
                positionsLost: 4,
                starts: 4
            });
            const fromArr = env.exports.calculateOvertakeIndex([
                { grid: '10', position: '4', status: 'Finished' },
                { grid: '12', position: '6', status: 'Finished' },
                { grid: '3', position: '5', status: 'Finished' },
                { grid: '4', position: '6', status: 'Finished' }
            ]);
            assert.strictEqual(fromObj, fromArr);
            assert.strictEqual(fromObj, 2.75);
        });
    });

    describe('computeOvertakeIndexMetrics', () => {
        const mockRaces = [
            {
                round: '1',
                raceName: 'Bahrain Grand Prix',
                Results: [
                    {
                        position: '1',
                        grid: '5',
                        status: 'Finished',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                    },
                    {
                        position: '4',
                        grid: '1',
                        status: 'Finished',
                        Driver: { driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc' },
                        Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
                    },
                    {
                        position: '2',
                        grid: '2',
                        status: 'Finished',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                    }
                ]
            },
            {
                round: '2',
                raceName: 'Saudi Arabian Grand Prix',
                Results: [
                    {
                        position: '1',
                        grid: '10',
                        status: 'Finished',
                        Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                    },
                    {
                        position: '18',
                        grid: '3',
                        status: 'Engine',
                        Driver: { driverId: 'leclerc', code: 'LEC', givenName: 'Charles', familyName: 'Leclerc' },
                        Constructor: { constructorId: 'ferrari', name: 'Ferrari' }
                    },
                    {
                        position: '2',
                        grid: '4',
                        status: 'Finished',
                        Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                        Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                    }
                ]
            }
        ];

        test('aggregates driver positions gained, lost, net delta, and Overtake Index across rounds', () => {
            const env = createTestEnvironment();
            const metrics = env.exports.computeOvertakeIndexMetrics(mockRaces, { season: '2024' });

            assert.strictEqual(metrics.totalRaces, 2);
            assert.strictEqual(metrics.totalPositionsGained, 15); // VER: +4 +9 = 13, NOR: 0 +2 = 2
            assert.strictEqual(metrics.totalPositionsLost, 18); // LEC: -3 -15 = 18

            const ver = metrics.drivers.find(d => d.driverId === 'max_verstappen');
            const nor = metrics.drivers.find(d => d.driverId === 'norris');
            const lec = metrics.drivers.find(d => d.driverId === 'leclerc');

            assert.strictEqual(ver.positionsGained, 13);
            assert.strictEqual(ver.positionsLost, 0);
            assert.strictEqual(ver.netDelta, 13);
            assert.strictEqual(ver.avgGrid, 7.5);
            assert.strictEqual(ver.avgFinish, 1);
            assert.strictEqual(ver.bestGain, 9);
            assert.ok(ver.overtakeIndex > nor.overtakeIndex);
            assert.ok(nor.overtakeIndex > lec.overtakeIndex);

            assert.strictEqual(metrics.overtakeLeader.driverId, 'max_verstappen');
            assert.strictEqual(metrics.biggestSingleRaceMover.driverId, 'max_verstappen');
            assert.strictEqual(metrics.biggestSingleRaceMover.delta, 9);
        });

        test('supports excludeDnf option and roundFilter option', () => {
            const env = createTestEnvironment();
            const noDnfMetrics = env.exports.computeOvertakeIndexMetrics(mockRaces, {
                season: '2024',
                excludeDnf: true
            });
            const lec = noDnfMetrics.drivers.find(d => d.driverId === 'leclerc');
            assert.strictEqual(lec.starts, 1);
            assert.strictEqual(lec.dnfCount, 1);
            assert.strictEqual(lec.positionsLost, 3);

            const round1Metrics = env.exports.computeOvertakeIndexMetrics(mockRaces, {
                season: '2024',
                roundFilter: '1'
            });
            assert.strictEqual(round1Metrics.totalRaces, 1);
            const verR1 = round1Metrics.drivers.find(d => d.driverId === 'max_verstappen');
            assert.strictEqual(verR1.positionsGained, 4);
        });

        test('supports constructor scope aggregation', () => {
            const env = createTestEnvironment();
            const conMetrics = env.exports.computeOvertakeIndexMetrics(mockRaces, {
                season: '2024',
                scope: 'constructors'
            });
            assert.strictEqual(conMetrics.scope, 'constructors');
            assert.strictEqual(conMetrics.rows[0].constructorId, 'red_bull');
            assert.strictEqual(conMetrics.rows[0].positionsGained, 13);
        });
    });

    describe('UI Rendering, Tab Navigation, and Latest Race Integration', () => {
        test('loads fallback/API data and renders KPIs, charts, and leaderboard table', async () => {
            const env = createTestEnvironment();
            const metrics = await env.exports.loadOvertakeIndexData('2024', true);

            assert.ok(metrics.drivers.length > 0);
            assert.ok(env.elements['overtakeValLeader'].textContent.includes('('));
            assert.ok(env.elements['overtakeValMostGained'].textContent.includes('Positions'));
            assert.ok(env.elements['overtakeValBestMover'].textContent.includes('(+'));
            assert.ok(env.elements['overtakeTableBody'].innerHTML.includes('overtake-index-pill'));
            assert.ok(env.createdCharts.length >= 2);
        });

        test('switchMainTab("overtake") activates tab button and shows overtake-index-section', () => {
            const env = createTestEnvironment();
            env.exports.switchMainTab('overtake');

            assert.strictEqual(env.elements['overtake-index-section'].style.display, 'block');
            assert.strictEqual(env.elements['lap-chart-section'].style.display, 'none');
            assert.strictEqual(env.elements['tabBtnOvertake'].classList.contains('active'), true);
        });

        test('fetchLatestRaceResults renders Grid, +/- Delta badge, and Top Overtaker', async () => {
            const customFetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    MRData: {
                        RaceTable: {
                            Races: [{
                                season: '2024',
                                round: '21',
                                raceName: 'São Paulo Grand Prix',
                                Circuit: { circuitName: 'Interlagos' },
                                date: '2024-11-03',
                                Results: [
                                    {
                                        position: '1',
                                        grid: '17',
                                        laps: '69',
                                        points: '26',
                                        Time: { time: '2:06:54.430' },
                                        Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' },
                                        Constructor: { name: 'Red Bull' }
                                    }
                                ]
                            }]
                        }
                    }
                })
            });

            const env = createTestEnvironment(customFetch);
            await env.exports.fetchLatestRaceResults('2024');
            const html = env.elements['latest-race-results'].innerHTML;

            assert.ok(html.includes('Top Overtaker'));
            assert.ok(html.includes('Max Verstappen (+16)'));
            assert.ok(html.includes('P17'));
            assert.ok(html.includes('delta-gained'));
            assert.ok(html.includes('+16'));
        });
    });
});
