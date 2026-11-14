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

    const activeFetch = customFetch || (async (url) => {
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
        exports: context.module.exports,
        window: context.window,
        elements,
        storage,
        createdCharts,
        mockDoc
    };
}

describe('Issue #13: Qualifying Pace vs Race Finish Correlation & Pole Conversion Rate Telemetry', () => {

    describe('computeQualifyingCorrelationMetrics', () => {
        test('handles empty qualifying and results data gracefully', () => {
            const env = createTestEnvironment();
            const metrics = env.exports.computeQualifyingCorrelationMetrics([], []);

            assert.strictEqual(metrics.totalRaces, 0);
            assert.strictEqual(metrics.totalPoles, 0);
            assert.strictEqual(metrics.convertedWins, 0);
            assert.strictEqual(metrics.poleConversionRate, 0);
            assert.strictEqual(metrics.points.length, 0);
            assert.strictEqual(metrics.drivers.length, 0);
            assert.strictEqual(metrics.poleSitters.length, 0);
        });

        test('correctly calculates pole-to-win conversion rate for 100% conversion', () => {
            const env = createTestEnvironment();
            const mockQual = [
                {
                    round: '1',
                    raceName: 'Bahrain Grand Prix',
                    QualifyingResults: [
                        {
                            position: '1',
                            Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                            Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
                            Q1: '1:30.0', Q2: '1:29.5', Q3: '1:29.179'
                        }
                    ]
                }
            ];
            const mockRes = [
                {
                    round: '1',
                    raceName: 'Bahrain Grand Prix',
                    Results: [
                        {
                            position: '1',
                            grid: '1',
                            status: 'Finished',
                            Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                            Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                        }
                    ]
                }
            ];

            const metrics = env.exports.computeQualifyingCorrelationMetrics(mockQual, mockRes);
            assert.strictEqual(metrics.totalPoles, 1);
            assert.strictEqual(metrics.convertedWins, 1);
            assert.strictEqual(metrics.poleConversionRate, 100);
            assert.strictEqual(metrics.poleSitters[0].converted, true);
        });

        test('correctly calculates pole-to-win conversion rate when pole sitter loses', () => {
            const env = createTestEnvironment();
            const mockQual = [
                {
                    round: '1',
                    raceName: 'Miami Grand Prix',
                    QualifyingResults: [
                        {
                            position: '1',
                            Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                            Constructor: { constructorId: 'red_bull', name: 'Red Bull' },
                            Q3: '1:27.241'
                        },
                        {
                            position: '5',
                            Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                            Constructor: { constructorId: 'mclaren', name: 'McLaren' },
                            Q3: '1:27.500'
                        }
                    ]
                }
            ];
            const mockRes = [
                {
                    round: '1',
                    raceName: 'Miami Grand Prix',
                    Results: [
                        {
                            position: '1',
                            grid: '5',
                            status: 'Finished',
                            Driver: { driverId: 'norris', code: 'NOR', givenName: 'Lando', familyName: 'Norris' },
                            Constructor: { constructorId: 'mclaren', name: 'McLaren' }
                        },
                        {
                            position: '2',
                            grid: '1',
                            status: 'Finished',
                            Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' },
                            Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                        }
                    ]
                }
            ];

            const metrics = env.exports.computeQualifyingCorrelationMetrics(mockQual, mockRes);
            assert.strictEqual(metrics.totalPoles, 1);
            assert.strictEqual(metrics.convertedWins, 0);
            assert.strictEqual(metrics.poleConversionRate, 0);
            assert.strictEqual(metrics.poleSitters[0].converted, false);
            assert.strictEqual(metrics.poleSitters[0].winnerDriverId, 'norris');
        });

        test('classifies points relative to diagonal parity line y = x (above=lost, below=gained, on=parity)', () => {
            const env = createTestEnvironment();
            const mockQual = [
                {
                    round: '1',
                    raceName: 'Test GP',
                    QualifyingResults: [
                        { position: '1', Driver: { driverId: 'p1_held' }, Constructor: { constructorId: 'ferrari' }, Q3: '1:20.0' },
                        { position: '10', Driver: { driverId: 'gained_positions' }, Constructor: { constructorId: 'mclaren' }, Q2: '1:21.0' },
                        { position: '2', Driver: { driverId: 'lost_positions' }, Constructor: { constructorId: 'mercedes' }, Q3: '1:20.2' }
                    ]
                }
            ];
            const mockRes = [
                {
                    round: '1',
                    raceName: 'Test GP',
                    Results: [
                        { position: '1', grid: '1', status: 'Finished', Driver: { driverId: 'p1_held' }, Constructor: { constructorId: 'ferrari' } },
                        { position: '4', grid: '10', status: 'Finished', Driver: { driverId: 'gained_positions' }, Constructor: { constructorId: 'mclaren' } },
                        { position: '8', grid: '2', status: 'Finished', Driver: { driverId: 'lost_positions' }, Constructor: { constructorId: 'mercedes' } }
                    ]
                }
            ];

            const metrics = env.exports.computeQualifyingCorrelationMetrics(mockQual, mockRes);

            const heldPt = metrics.points.find(p => p.driverId === 'p1_held');
            assert.strictEqual(heldPt.x, 1);
            assert.strictEqual(heldPt.y, 1);
            assert.strictEqual(heldPt.category, 'parity');
            assert.strictEqual(heldPt.delta, 0);

            // Gained: Qual 10, Finish 4 -> point at (10, 4) is BELOW line y = x
            const gainedPt = metrics.points.find(p => p.driverId === 'gained_positions');
            assert.strictEqual(gainedPt.x, 10);
            assert.strictEqual(gainedPt.y, 4);
            assert.strictEqual(gainedPt.category, 'gained');
            assert.strictEqual(gainedPt.delta, 6);
            assert.ok(gainedPt.deltaStr.includes('+6 position'));

            // Lost: Qual 2, Finish 8 -> point at (2, 8) is ABOVE line y = x
            const lostPt = metrics.points.find(p => p.driverId === 'lost_positions');
            assert.strictEqual(lostPt.x, 2);
            assert.strictEqual(lostPt.y, 8);
            assert.strictEqual(lostPt.category, 'lost');
            assert.strictEqual(lostPt.delta, -6);
            assert.ok(lostPt.deltaStr.includes('-6 position'));
        });

        test('handles DNS and DNF gracefully without breaking chart scales', () => {
            const env = createTestEnvironment();
            const mockQual = [
                {
                    round: '1',
                    raceName: 'Australia GP',
                    QualifyingResults: [
                        { position: '1', Driver: { driverId: 'dnf_driver' }, Constructor: { constructorId: 'red_bull' }, Q3: '1:16.0' },
                        { position: '12', Driver: { driverId: 'dns_driver' }, Constructor: { constructorId: 'williams' }, Q2: '1:17.5' }
                    ]
                }
            ];
            const mockRes = [
                {
                    round: '1',
                    raceName: 'Australia GP',
                    Results: [
                        { position: '19', positionText: 'R', grid: '1', status: 'Brakes', Driver: { driverId: 'dnf_driver' }, Constructor: { constructorId: 'red_bull' } },
                        { position: '0', positionText: 'W', grid: '12', status: 'Did not start', Driver: { driverId: 'dns_driver' }, Constructor: { constructorId: 'williams' } }
                    ]
                }
            ];

            const metrics = env.exports.computeQualifyingCorrelationMetrics(mockQual, mockRes);

            const dnfPt = metrics.points.find(p => p.driverId === 'dnf_driver');
            assert.strictEqual(dnfPt.isDnf, true);
            assert.strictEqual(dnfPt.isDns, false);
            assert.strictEqual(dnfPt.x, 1);
            assert.strictEqual(dnfPt.y, 19);
            assert.ok(dnfPt.y <= metrics.maxGrid);
            assert.ok(!isNaN(dnfPt.x) && !isNaN(dnfPt.y));
            assert.ok(dnfPt.finishDisplay.includes('DNF'));

            const dnsPt = metrics.points.find(p => p.driverId === 'dns_driver');
            assert.strictEqual(dnsPt.isDns, true);
            assert.strictEqual(dnsPt.x, 12);
            assert.strictEqual(dnsPt.y, metrics.maxGrid); // Clamped to maxGrid
            assert.ok(!isNaN(dnsPt.x) && !isNaN(dnsPt.y));
            assert.ok(dnsPt.finishDisplay.includes('DNS'));
        });

        test('selects best Q lap time correctly across Q3, Q2, and Q1', () => {
            const env = createTestEnvironment();
            const mockQual = [
                {
                    round: '1',
                    raceName: 'Time Test GP',
                    QualifyingResults: [
                        { position: '1', Driver: { driverId: 'd_q3' }, Constructor: { constructorId: 'ferrari' }, Q1: '1:30.0', Q2: '1:29.0', Q3: '1:28.0' },
                        { position: '11', Driver: { driverId: 'd_q2' }, Constructor: { constructorId: 'alpine' }, Q1: '1:30.5', Q2: '1:29.8' },
                        { position: '17', Driver: { driverId: 'd_q1' }, Constructor: { constructorId: 'haas' }, Q1: '1:31.2' },
                        { position: '20', Driver: { driverId: 'd_none' }, Constructor: { constructorId: 'sauber' } }
                    ]
                }
            ];
            const mockRes = [
                {
                    round: '1',
                    raceName: 'Time Test GP',
                    Results: [
                        { position: '1', Driver: { driverId: 'd_q3' }, Constructor: { constructorId: 'ferrari' }, status: 'Finished' },
                        { position: '11', Driver: { driverId: 'd_q2' }, Constructor: { constructorId: 'alpine' }, status: 'Finished' },
                        { position: '17', Driver: { driverId: 'd_q1' }, Constructor: { constructorId: 'haas' }, status: 'Finished' },
                        { position: '20', Driver: { driverId: 'd_none' }, Constructor: { constructorId: 'sauber' }, status: 'Finished' }
                    ]
                }
            ];

            const metrics = env.exports.computeQualifyingCorrelationMetrics(mockQual, mockRes);

            const q3Pt = metrics.points.find(p => p.driverId === 'd_q3');
            assert.strictEqual(q3Pt.bestQLap, '1:28.0');
            assert.strictEqual(q3Pt.bestQSegment, 'Q3');

            const q2Pt = metrics.points.find(p => p.driverId === 'd_q2');
            assert.strictEqual(q2Pt.bestQLap, '1:29.8');
            assert.strictEqual(q2Pt.bestQSegment, 'Q2');

            const q1Pt = metrics.points.find(p => p.driverId === 'd_q1');
            assert.strictEqual(q1Pt.bestQLap, '1:31.2');
            assert.strictEqual(q1Pt.bestQSegment, 'Q1');

            const nonePt = metrics.points.find(p => p.driverId === 'd_none');
            assert.strictEqual(nonePt.bestQLap, 'No time');
            assert.strictEqual(nonePt.bestQSegment, 'N/A');
        });

        test('aggregates driver metrics accurately', () => {
            const env = createTestEnvironment();
            const mockQual = [
                {
                    round: '1',
                    QualifyingResults: [
                        { position: '1', Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' }, Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Q3: '1:10.0' }
                    ]
                },
                {
                    round: '2',
                    QualifyingResults: [
                        { position: '4', Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR' }, Constructor: { constructorId: 'mclaren', name: 'McLaren' }, Q3: '1:11.0' }
                    ]
                }
            ];
            const mockRes = [
                {
                    round: '1',
                    Results: [
                        { position: '1', grid: '1', status: 'Finished', Driver: { driverId: 'norris' }, Constructor: { constructorId: 'mclaren' } }
                    ]
                },
                {
                    round: '2',
                    Results: [
                        { position: '2', grid: '4', status: 'Finished', Driver: { driverId: 'norris' }, Constructor: { constructorId: 'mclaren' } }
                    ]
                }
            ];

            const metrics = env.exports.computeQualifyingCorrelationMetrics(mockQual, mockRes);
            const drv = metrics.drivers.find(d => d.driverId === 'norris');

            assert.ok(drv);
            assert.strictEqual(drv.starts, 2);
            assert.strictEqual(drv.poles, 1);
            assert.strictEqual(drv.poleWins, 1);
            assert.strictEqual(drv.poleConvRate, 100);
            assert.strictEqual(drv.avgQual, 2.5); // (1 + 4) / 2
            assert.strictEqual(drv.avgFinish, 1.5); // (1 + 2) / 2
            assert.strictEqual(drv.netDelta, 2); // (1-1) + (4-2) = +2
        });
    });

    describe('QUALIFYING_CORRELATION_FALLBACK_2024', () => {
        test('contains authentic 24 rounds and computes valid 2024 telemetry', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;

            assert.ok(fallback);
            assert.ok(Array.isArray(fallback.qualifying));
            assert.ok(Array.isArray(fallback.results));
            assert.strictEqual(fallback.qualifying.length, 24);
            assert.strictEqual(fallback.results.length, 24);

            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });
            assert.strictEqual(metrics.totalRaces, 24);
            assert.strictEqual(metrics.totalPoles, 24);
            assert.ok(metrics.convertedWins > 5 && metrics.convertedWins < 20);
            assert.ok(metrics.poleConversionRate > 30 && metrics.poleConversionRate < 70);
            assert.ok(metrics.points.length > 100);
            assert.ok(metrics.drivers.length >= 10);
            assert.ok(metrics.topPoleConverter);
        });
    });

    describe('Rendering & Visualization', () => {
        test('renderQualifyingKpis updates KPI cards correctly', () => {
            const env = createTestEnvironment();
            const metrics = {
                poleConversionRate: 58.3,
                convertedWins: 14,
                totalPoles: 24,
                avgDelta: 0.42,
                gainedCount: 50,
                parityCount: 30,
                lostCount: 40,
                points: new Array(120),
                topPoleConverter: { driverName: 'Max Verstappen', poleWins: 8, poles: 12, poleConvRate: 66.7 }
            };

            env.exports.renderQualifyingKpis(metrics);

            assert.strictEqual(env.elements.qualValConversion.textContent, '58.3%');
            assert.ok(env.elements.qualSubConversion.textContent.includes('14 of 24 Poles Converted'));
            assert.strictEqual(env.elements.qualValAvgDelta.textContent, '+0.42 POS');
            assert.strictEqual(env.elements.qualValParity.textContent, '50 / 30 / 40');
            assert.ok(env.elements.qualValTopPole.textContent.includes('Max Verstappen (8)'));
        });

        test('renderPoleConversionGauge initializes semi-circle doughnut chart and displays rate', () => {
            const env = createTestEnvironment();
            const metrics = {
                poleConversionRate: 50.0,
                convertedWins: 12,
                totalPoles: 24
            };

            env.exports.renderPoleConversionGauge(metrics);

            assert.strictEqual(env.elements.gaugeRateDisplay.textContent, '50%');
            assert.ok(env.elements.gaugeSubDisplay.textContent.includes('12 of 24 Poles Converted'));
            assert.ok(env.exports.qualifyingCorrelationState.gaugeChart);
            assert.strictEqual(env.exports.qualifyingCorrelationState.gaugeChart.config.type, 'doughnut');
            assert.strictEqual(env.exports.qualifyingCorrelationState.gaugeChart.options.circumference, 180);
            assert.strictEqual(env.exports.qualifyingCorrelationState.gaugeChart.options.rotation, -90);
        });

        test('renderQualifyingScatterChart configures scatter and parity line datasets', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.renderQualifyingScatterChart(metrics);

            const chart = env.exports.qualifyingCorrelationState.correlationChart;
            assert.ok(chart);
            assert.strictEqual(chart.config.type, 'scatter');
            assert.strictEqual(chart.data.datasets.length, 2);

            // Dataset 0: Scatter Points
            assert.strictEqual(chart.data.datasets[0].type, 'scatter');
            assert.ok(chart.data.datasets[0].data.length > 0);

            // Dataset 1: Parity Reference Line (y = x)
            assert.strictEqual(chart.data.datasets[1].type, 'line');
            assert.strictEqual(chart.data.datasets[1].data[0].x, 1);
            assert.strictEqual(chart.data.datasets[1].data[0].y, 1);
            assert.strictEqual(chart.data.datasets[1].data[1].x, metrics.maxGrid);
            assert.strictEqual(chart.data.datasets[1].data[1].y, metrics.maxGrid);
            assert.strictEqual(chart.data.datasets[1].borderDash[0], 6);
            assert.strictEqual(chart.data.datasets[1].borderDash[1], 6);
        });

        test('scatter chart tooltips format Grand Prix name, best Q lap, starting grid, and final race position', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.renderQualifyingScatterChart(metrics);
            const chart = env.exports.qualifyingCorrelationState.correlationChart;
            const tooltipCallbacks = chart.options.plugins.tooltip.callbacks;

            const samplePoint = metrics.points[0];
            const title = tooltipCallbacks.title([{ raw: samplePoint }]);
            assert.ok(title.includes(samplePoint.raceName));

            const lines = tooltipCallbacks.label({ raw: samplePoint });
            assert.ok(Array.isArray(lines));
            assert.ok(lines.some(l => l.includes('Driver:')));
            assert.ok(lines.some(l => l.includes('Qualifying Rank:')));
            assert.ok(lines.some(l => l.includes('Best Q Lap:')));
            assert.ok(lines.some(l => l.includes('Starting Grid:')));
            assert.ok(lines.some(l => l.includes('Final Race Position:')));
            assert.ok(lines.some(l => l.includes('Delta:')));
        });

        test('isolating an individual driver filters scatter dataset', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.qualifyingCorrelationState.metrics = metrics;
            env.exports.onQualifyingDriverChange('max_verstappen');

            const chart = env.exports.qualifyingCorrelationState.correlationChart;
            assert.ok(chart);
            assert.ok(chart.data.datasets[0].data.every(p => p.driverId === 'max_verstappen'));
            assert.strictEqual(env.exports.qualifyingCorrelationState.selectedDriver, 'max_verstappen');
        });

        test('toggling DNF filter includes/excludes retired drivers', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });
            env.exports.qualifyingCorrelationState.metrics = metrics;

            // Include DNFs
            env.exports.onQualifyingDnfToggle(true);
            const totalWithDnf = env.exports.qualifyingCorrelationState.correlationChart.data.datasets[0].data.length;

            // Exclude DNFs
            env.exports.onQualifyingDnfToggle(false);
            const totalWithoutDnf = env.exports.qualifyingCorrelationState.correlationChart.data.datasets[0].data.length;

            assert.ok(totalWithoutDnf < totalWithDnf);
            assert.ok(env.exports.qualifyingCorrelationState.correlationChart.data.datasets[0].data.every(p => !p.isDnf && !p.isDns));
        });

        test('renderQualifyingDriverTable populates driver leaderboard rows', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.renderQualifyingDriverTable(metrics);
            const tbody = env.elements.qualifyingDriverTableBody;

            assert.ok(tbody.innerHTML.includes('Verstappen'));
            assert.ok(tbody.innerHTML.includes('Norris'));
            assert.ok(tbody.innerHTML.includes('delta-badge'));
        });

        test('renderPoleWinnersList renders round-by-round pole conversions', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.renderPoleWinnersList(metrics);
            const container = env.elements.poleWinnersList;

            assert.ok(container.innerHTML.includes('Bahrain GP'));
            assert.ok(container.innerHTML.includes('WIN'));
            assert.ok(container.innerHTML.includes('pole-round-item'));
        });
    });

    describe('Navigation & Tab Switching (switchMainTab)', () => {
        test('switchMainTab("qualifying") shows qualifying section and hides others', () => {
            const env = createTestEnvironment();

            env.exports.switchMainTab('qualifying');

            assert.strictEqual(env.elements['qualifying-correlation-section'].style.display, 'block');
            assert.strictEqual(env.elements['lap-chart-section'].style.display, 'none');
            assert.strictEqual(env.elements['stint-profiler-section'].style.display, 'none');
            assert.strictEqual(env.elements['finishing-gap-section'].style.display, 'none');
            assert.strictEqual(env.elements['circuit-profiler-section'].style.display, 'none');
            assert.strictEqual(env.elements['constructor-atr-section'].style.display, 'none');
            assert.strictEqual(env.elements['constructor-momentum-section'].style.display, 'none');
            assert.strictEqual(env.elements['sprint-disparity-section'].style.display, 'none');
            assert.strictEqual(env.elements['clinch-engine-section'].style.display, 'none');
            assert.strictEqual(env.elements['pitstop-matrix-section'].style.display, 'none');
            assert.strictEqual(env.elements['reliability-matrix-section'].style.display, 'none');
            assert.strictEqual(env.elements['teammate-telemetry-section'].style.display, 'none');

            assert.ok(env.elements.tabBtnQualifying.classList.contains('active'));
        });

        test('switchMainTab("all") shows qualifying section alongside other dashboard sections', () => {
            const env = createTestEnvironment();

            env.exports.switchMainTab('all');

            assert.strictEqual(env.elements['qualifying-correlation-section'].style.display, 'block');
            assert.strictEqual(env.elements['lap-chart-section'].style.display, 'block');
            assert.strictEqual(env.elements['reliability-matrix-section'].style.display, 'block');
            assert.ok(env.elements.tabBtnAll.classList.contains('active'));
        });

        test('switching to another single tab hides qualifying section', () => {
            const env = createTestEnvironment();

            env.exports.switchMainTab('reliability');

            assert.strictEqual(env.elements['qualifying-correlation-section'].style.display, 'none');
            assert.strictEqual(env.elements['reliability-matrix-section'].style.display, 'block');
            assert.ok(env.elements.tabBtnReliability.classList.contains('active'));
        });
    });

    describe('Caching & Data Loading (loadQualifyingCorrelationData)', () => {
        test('retrieves telemetry from localStorage when cached', async () => {
            const env = createTestEnvironment();
            const cachedMetrics = {
                season: '2023',
                totalRaces: 22,
                totalPoles: 22,
                convertedWins: 15,
                poleConversionRate: 68.2,
                points: [],
                drivers: [],
                poleSitters: []
            };
            env.storage['f1_qualifying_correlation_2023'] = JSON.stringify(cachedMetrics);

            const result = await env.exports.loadQualifyingCorrelationData('2023', false);

            assert.strictEqual(result.totalRaces, 22);
            assert.strictEqual(result.convertedWins, 15);
            assert.strictEqual(env.elements.qualifyingCacheBadge.textContent, '⚡ Instant (Cached)');
        });

        test('forceRefresh bypasses localStorage cache and makes new request', async () => {
            let fetchCount = 0;
            const customFetch = async () => {
                fetchCount++;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ MRData: { RaceTable: { Races: [] }, total: '0', limit: '100' } })
                };
            };
            const env = createTestEnvironment(customFetch);
            env.storage['f1_qualifying_correlation_2024'] = JSON.stringify({ season: '2024', dummy: true });

            await env.exports.loadQualifyingCorrelationData('2024', true);
            assert.ok(fetchCount >= 2); // 1 for qualifying, 1 for results
        });

        test('falls back gracefully to 2024 fallback dataset upon network errors', async () => {
            const networkErrorFetch = async () => {
                throw new Error('Network offline or Jolpica API unavailable');
            };
            const env = createTestEnvironment(networkErrorFetch);

            const result = await env.exports.loadQualifyingCorrelationData('2024', true);

            assert.ok(result);
            assert.strictEqual(result.season, '2024');
            assert.strictEqual(result.totalRaces, 24);
            assert.ok(result.totalPoles > 0);
            assert.strictEqual(env.elements.qualifyingCacheBadge.textContent, '⚠️ Offline Fallback');
        });

        test('onQualifyingSeasonChange updates active season and loads new telemetry', async () => {
            const env = createTestEnvironment();
            env.exports.onQualifyingSeasonChange('2023');

            assert.strictEqual(env.exports.qualifyingCorrelationState.season, '2023');
            assert.strictEqual(env.exports.qualifyingCorrelationState.selectedDriver, 'all');
        });

        test('populateQualifyingSeasonDropdown generates options from current year to 1950', () => {
            const env = createTestEnvironment();
            env.exports.populateQualifyingSeasonDropdown(2026, 1950);

            const select = env.elements.qualifyingSeasonSelect;
            assert.ok(select.children.length >= 75);
            assert.strictEqual(select.children[0].value, '2026');
            assert.strictEqual(select.children[select.children.length - 1].value, '1950');
        });

        test('hovering over a scatter point triggers driver highlighting', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.renderQualifyingScatterChart(metrics);
            const chart = env.exports.qualifyingCorrelationState.correlationChart;

            // Hover over point index 0
            chart.options.onHover.call(chart, {}, [{ datasetIndex: 0, index: 0 }]);
            const hoveredDriver = env.exports.qualifyingCorrelationState.hoveredDriver;
            assert.strictEqual(hoveredDriver, metrics.points[0].driverId);
            assert.strictEqual(chart.updated, true);

            // Hover off elements
            chart.options.onHover.call(chart, {}, []);
            assert.strictEqual(env.exports.qualifyingCorrelationState.hoveredDriver, null);
        });

        test('switchMainTab resizes both scatter and gauge charts', () => {
            const env = createTestEnvironment();
            const fallback = env.exports.QUALIFYING_CORRELATION_FALLBACK_2024;
            const metrics = env.exports.computeQualifyingCorrelationMetrics(fallback.qualifying, fallback.results, { season: '2024' });

            env.exports.renderQualifyingScatterChart(metrics);
            env.exports.renderPoleConversionGauge(metrics);

            const scatterChart = env.exports.qualifyingCorrelationState.correlationChart;
            const gaugeChart = env.exports.qualifyingCorrelationState.gaugeChart;

            env.exports.switchMainTab('qualifying');

            assert.strictEqual(scatterChart.resized, true);
            assert.strictEqual(gaugeChart.resized, true);
        });
    });
});
