const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML_PATH = path.resolve(__dirname, '../index.html');
const INDEX_HTML = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

function extractMainScript(html) {
    const scripts = [];
    const re = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
        if (match[1] && match[1].includes('function switchMainTab(')) {
            scripts.push(match[1]);
        }
    }
    assert.ok(scripts.length > 0, 'Main application <script> block not found in index.html');
    return scripts[scripts.length - 1];
}

function createMockElement(id = '', initialValue = '') {
    const classes = new Set();
    const listeners = {};
    const children = [];
    return {
        id,
        value: initialValue,
        checked: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        style: {},
        children,
        classList: {
            add: (...cls) => cls.forEach(c => classes.add(c)),
            remove: (...cls) => cls.forEach(c => classes.delete(c)),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (classes.has(c)) classes.delete(c);
                    else classes.add(c);
                } else if (force) {
                    classes.add(c);
                } else {
                    classes.delete(c);
                }
            },
            contains: (c) => classes.has(c)
        },
        addEventListener: (evt, cb) => {
            listeners[evt] = listeners[evt] || [];
            listeners[evt].push(cb);
        },
        dispatchEvent: (evt) => {
            const cbs = listeners[evt.type] || [];
            cbs.forEach(cb => cb(evt));
        },
        appendChild: (child) => {
            children.push(child);
            return child;
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        getContext: () => ({})
    };
}

function createAppHarness(options = {}) {
    const scriptContent = extractMainScript(INDEX_HTML);
    const elements = new Map();
    if (options.initialElements) {
        Object.entries(options.initialElements).forEach(([id, val]) => {
            elements.set(id, createMockElement(id, val));
        });
    }

    const domListeners = {};
    const storageMap = new Map();

    const document = {
        getElementById: (id) => {
            if (!elements.has(id)) {
                elements.set(id, createMockElement(id, ''));
            }
            return elements.get(id);
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        createElement: (tag) => createMockElement(tag, ''),
        addEventListener: (evt, cb) => {
            domListeners[evt] = domListeners[evt] || [];
            domListeners[evt].push(cb);
        }
    };

    const localStorage = {
        getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
        setItem: (k, v) => { storageMap.set(k, String(v)); },
        removeItem: (k) => { storageMap.delete(k); },
        clear: () => { storageMap.clear(); }
    };

    class MockChart {
        constructor() {
            this.data = { labels: [], datasets: [] };
            this.options = {};
        }
        resize() {}
        destroy() {}
        update() {}
    }

    const sandbox = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        Date,
        Math,
        JSON,
        Number,
        String,
        Array,
        Object,
        Set,
        Map,
        RegExp,
        Error,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined,
        Chart: MockChart,
        document,
        localStorage,
        addEventListener: () => {},
        fetch: options.fetch || (async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                MRData: {
                    total: '0',
                    limit: '100',
                    RaceTable: { Races: [] },
                    StandingsTable: { StandingsLists: [] }
                }
            })
        }))
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scriptContent, sandbox);

    return {
        sandbox,
        document,
        elements,
        localStorage,
        storageMap,
        triggerDOMContentLoaded: () => {
            (domListeners.DOMContentLoaded || []).forEach(cb => cb());
        }
    };
}

function okJson(payload) {
    return {
        ok: true,
        status: 200,
        json: async () => payload
    };
}

function rateLimitResponse(retryAfterValue) {
    return {
        ok: false,
        status: 429,
        headers: retryAfterValue !== undefined
            ? { get: (name) => (String(name).toLowerCase() === 'retry-after' ? String(retryAfterValue) : null) }
            : undefined,
        json: async () => ({ message: 'Too Many Requests' })
    };
}

test('fetchWithRetry honors numeric Retry-After on HTTP 429 and retries transient errors cleanly', async () => {
    const delays = [];
    let attempts = 0;

    const { sandbox } = createAppHarness({
        fetch: async () => {
            attempts++;
            if (attempts === 1) {
                return rateLimitResponse('0.03'); // 30ms > 5ms base delay
            }
            if (attempts === 2) {
                return rateLimitResponse(); // falls back to doubled exponential backoff (10ms)
            }
            return okJson({ MRData: { RaceTable: { Races: [{ round: '1' }] } } });
        }
    });

    const realSetTimeout = setTimeout;
    sandbox.setTimeout = (fn, ms) => {
        delays.push(ms);
        return realSetTimeout(fn, 1);
    };
    vm.runInContext('setTimeout = globalThis.setTimeout;', sandbox);

    const data = await sandbox.fetchWithRetry('https://api.jolpi.ca/ergast/f1/2024/results.json', {}, 2, 5);
    assert.equal(attempts, 3);
    assert.equal(data.MRData.RaceTable.Races.length, 1);
    assert.equal(delays[0], 30, 'First retry should respect Retry-After seconds in ms');
    assert.equal(delays[1], 10, 'Second retry without Retry-After should use doubled delay');
});

test('fetchWithRetry throws immediately without retrying on non-transient 404 responses', async () => {
    let attempts = 0;
    const { sandbox } = createAppHarness({
        fetch: async () => {
            attempts++;
            return { ok: false, status: 404, json: async () => ({}) };
        }
    });

    await assert.rejects(
        () => sandbox.fetchWithRetry('https://api.jolpi.ca/ergast/f1/2024/missing.json', {}, 3, 5),
        /status: 404/
    );
    assert.equal(attempts, 1);
});

test('fetchAllJolpicaPages routes through fetchWithRetry, paces pages, and recovers from HTTP 429 across pages', async () => {
    const callCounts = new Map();
    const fetchedUrls = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const { sandbox } = createAppHarness({
        fetch: async (url) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            try {
                fetchedUrls.push(url);
                const count = (callCounts.get(url) || 0) + 1;
                callCounts.set(url, count);
                await new Promise(r => setTimeout(r, 2));

                if (url.includes('offset=0')) {
                    if (count === 1) return rateLimitResponse('0.01');
                    return okJson({
                        MRData: {
                            total: '4',
                            limit: '2',
                            RaceTable: {
                                Races: [
                                    { round: '1', raceName: 'Bahrain GP', Results: [{ driver: 'max' }, { driver: 'checo' }] }
                                ]
                            }
                        }
                    });
                }

                if (url.includes('offset=2')) {
                    if (count === 1) return rateLimitResponse('0.01');
                    return okJson({
                        MRData: {
                            total: '4',
                            limit: '2',
                            RaceTable: {
                                Races: [
                                    { round: '2', raceName: 'Saudi GP', Results: [{ driver: 'max' }, { driver: 'leclerc' }] }
                                ]
                            }
                        }
                    });
                }

                return okJson({ MRData: { total: '0', limit: '100', RaceTable: { Races: [] } } });
            } finally {
                inFlight--;
            }
        }
    });

    let retryWrapperCalls = 0;
    const origFetchWithRetry = sandbox.fetchWithRetry;
    sandbox.fetchWithRetry = async (url, opts, retries = 2, delay = 5) => {
        retryWrapperCalls++;
        return origFetchWithRetry(url, opts, retries, Math.min(delay, 5));
    };

    const races = await sandbox.fetchAllJolpicaPages('2024', 'results', 'Results');
    assert.equal(retryWrapperCalls, 2, 'Both paginated requests must route through fetchWithRetry');
    assert.equal(maxInFlight, 1, 'Paginated loop must not issue overlapping concurrent requests');
    assert.equal(races.length, 2, 'Both rounds must be present without truncation after 429 recovery');
    assert.equal(races[0].round, '1');
    assert.equal(races[1].round, '2');
    assert.equal(fetchedUrls.length, 4, 'Initial + 1 retry per page = 4 total HTTP calls');
});

test('fetchLapPositions routes initial and paginated requests through fetchWithRetry and recovers from HTTP 429', async () => {
    const attemptByUrl = new Map();

    const { sandbox } = createAppHarness({
        fetch: async (url) => {
            const attempt = (attemptByUrl.get(url) || 0) + 1;
            attemptByUrl.set(url, attempt);

            if (!url.includes('offset=')) {
                if (attempt === 1) return rateLimitResponse('0.01');
                return okJson({
                    MRData: {
                        total: '4',
                        limit: '2',
                        RaceTable: {
                            Races: [{
                                Laps: [
                                    { number: '1', Timings: [{ driverId: 'verstappen', position: '1', time: '1:35.0' }] },
                                    { number: '2', Timings: [{ driverId: 'verstappen', position: '1', time: '1:34.5' }] }
                                ]
                            }]
                        }
                    }
                });
            }

            if (url.includes('offset=2')) {
                if (attempt === 1) return rateLimitResponse('0.01');
                return okJson({
                    MRData: {
                        total: '4',
                        limit: '2',
                        RaceTable: {
                            Races: [{
                                Laps: [
                                    { number: '3', Timings: [{ driverId: 'norris', position: '1', time: '1:34.2' }] },
                                    { number: '4', Timings: [{ driverId: 'norris', position: '1', time: '1:34.1' }] }
                                ]
                            }]
                        }
                    }
                });
            }

            return okJson({ MRData: { total: '0', limit: '2', RaceTable: { Races: [] } } });
        }
    });

    let retryWrapperCalls = 0;
    const origFetchWithRetry = sandbox.fetchWithRetry;
    sandbox.fetchWithRetry = async (url, opts, retries = 2, delay = 5) => {
        retryWrapperCalls++;
        return origFetchWithRetry(url, opts, retries, Math.min(delay, 5));
    };

    const laps = await sandbox.fetchLapPositions('2024', '1');
    assert.equal(retryWrapperCalls, 2, 'Initial and paginated lap fetches must go through fetchWithRetry');
    assert.deepEqual(laps.map(l => l.number), ['1', '2', '3', '4'], 'All 4 laps recovered without truncation');
});

test('loadSprintData routes sprint, results, and driverStandings.json through fetchWithRetry without failing on 429', async () => {
    const attempts = new Map();

    const { sandbox } = createAppHarness({
        fetch: async (url) => {
            const count = (attempts.get(url) || 0) + 1;
            attempts.set(url, count);

            if (url.includes('/sprint.json')) {
                if (count === 1) return rateLimitResponse('0.01');
                return okJson({
                    MRData: {
                        total: '1',
                        limit: '100',
                        RaceTable: {
                            Races: [{
                                round: '5',
                                raceName: 'Chinese Grand Prix',
                                Circuit: { circuitName: 'Shanghai International Circuit' },
                                SprintResults: [{
                                    position: '1',
                                    points: '8',
                                    grid: '4',
                                    Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                                    Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                                }]
                            }]
                        }
                    }
                });
            }

            if (url.includes('/results.json')) {
                if (count === 1) return rateLimitResponse('0.01');
                return okJson({
                    MRData: {
                        total: '1',
                        limit: '100',
                        RaceTable: {
                            Races: [{
                                round: '5',
                                raceName: 'Chinese Grand Prix',
                                Results: [{
                                    position: '1',
                                    points: '25',
                                    grid: '1',
                                    Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                                    Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                                }]
                            }]
                        }
                    }
                });
            }

            if (url.includes('/driverStandings.json')) {
                if (count === 1) return rateLimitResponse('0.01');
                return okJson({
                    MRData: {
                        StandingsTable: {
                            StandingsLists: [{
                                DriverStandings: [{
                                    position: '1',
                                    points: '110',
                                    Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                                    Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }]
                                }]
                            }]
                        }
                    }
                });
            }

            return okJson({ MRData: { RaceTable: { Races: [] } } });
        }
    });

    const retriedUrls = [];
    const origFetchWithRetry = sandbox.fetchWithRetry;
    sandbox.fetchWithRetry = async (url, opts, retries = 2, delay = 5) => {
        retriedUrls.push(url);
        return origFetchWithRetry(url, opts, retries, Math.min(delay, 5));
    };

    await sandbox.loadSprintData('2024', true);
    assert.equal(retriedUrls.length, 3, 'sprint, results, and driverStandings.json must all route through fetchWithRetry');
    assert.ok(retriedUrls.some(u => u.includes('/driverStandings.json')), 'driverStandings.json must use fetchWithRetry');

    const state = vm.runInContext('sprintState', sandbox);
    assert.equal(state.sprints.length, 1);
    assert.equal(state.results.length, 1);
    assert.equal(state.standings.length, 1, 'Driver standings must be populated after recovering from HTTP 429');
    assert.equal(state.dataLoaded, true);
    assert.equal(state.isLoading, false);
});

test('loadSeasonLapsLed processes rounds sequentially without unbounded Promise.all bursts and recovers from 429', async () => {
    let inFlightLaps = 0;
    let maxInFlightLaps = 0;
    const roundAttempts = new Map();
    const totalRounds = 8;

    const { sandbox } = createAppHarness({
        fetch: async (url) => {
            if (url.includes('/results.json')) {
                const races = Array.from({ length: totalRounds }, (_, i) => ({
                    round: String(i + 1),
                    raceName: `Round ${i + 1} GP`,
                    Results: [{
                        position: '1',
                        Driver: { driverId: 'verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                        Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                    }]
                }));
                return okJson({ MRData: { total: String(totalRounds), limit: '100', RaceTable: { Races: races } } });
            }

            if (url.includes('/laps.json')) {
                inFlightLaps++;
                maxInFlightLaps = Math.max(maxInFlightLaps, inFlightLaps);
                try {
                    const m = url.match(/\/(\d+)\/laps\.json/);
                    const rnd = m ? m[1] : '0';
                    const count = (roundAttempts.get(rnd) || 0) + 1;
                    roundAttempts.set(rnd, count);
                    await new Promise(r => setTimeout(r, 3));

                    if (count === 1 && Number(rnd) % 2 === 0) {
                        return rateLimitResponse('0.01');
                    }

                    return okJson({
                        MRData: {
                            total: '2',
                            limit: '2000',
                            RaceTable: {
                                Races: [{
                                    Laps: [
                                        { number: '1', Timings: [{ driverId: 'verstappen', position: '1', time: '1:33.0' }] },
                                        { number: '2', Timings: [{ driverId: 'verstappen', position: '1', time: '1:32.8' }] }
                                    ]
                                }]
                            }
                        }
                    });
                } finally {
                    inFlightLaps--;
                }
            }

            return okJson({ MRData: { RaceTable: { Races: [] } } });
        }
    });

    const origFetchWithRetry = sandbox.fetchWithRetry;
    sandbox.fetchWithRetry = async (url, opts, retries = 2, delay = 5) => {
        return origFetchWithRetry(url, opts, retries, Math.min(delay, 5));
    };

    const ledData = await sandbox.loadSeasonLapsLed('2024');
    assert.equal(maxInFlightLaps, 1, 'loadSeasonLapsLed must pace round requests sequentially (maxInFlight === 1)');
    assert.equal(ledData.totalLapsLed, totalRounds * 2, 'All rounds must contribute laps led with zero 429 drops');
    assert.equal(ledData.leader.driverId, 'verstappen');
    assert.equal(ledData.leader.lapsLed, totalRounds * 2);
});

test('DOMContentLoaded avoids startup stampede and switchMainTab lazy-loads inactive tabs once', async () => {
    const fetchedUrls = [];
    const secondaryEndpoints = [
        '/qualifying.json',
        '/sprint.json',
        '/pitstops.json',
        '/status.json',
        '/laps.json',
        'results.json?limit=1000'
    ];

    const { sandbox, triggerDOMContentLoaded } = createAppHarness({
        initialElements: {
            seasonSelect: '2024',
            resultsSeasonSelect: '2024',
            sprintSeasonSelect: '2023',
            reliabilitySeasonSelect: '2024'
        },
        fetch: async (url) => {
            fetchedUrls.push(url);
            if (url.includes('/races.json')) {
                return okJson({ MRData: { RaceTable: { Races: [] } } });
            }
            if (url.includes('/driverStandings.json')) {
                return okJson({
                    MRData: {
                        StandingsTable: {
                            StandingsLists: [{
                                season: '2023',
                                DriverStandings: [{
                                    position: '1',
                                    points: '100',
                                    Driver: { driverId: 'verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                                    Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }]
                                }]
                            }]
                        }
                    }
                });
            }
            if (url.includes('/sprint.json')) {
                return okJson({
                    MRData: {
                        total: '1',
                        limit: '100',
                        RaceTable: {
                            Races: [{
                                round: '4',
                                raceName: 'Azerbaijan Grand Prix',
                                Circuit: { circuitName: 'Baku City Circuit' },
                                SprintResults: [{
                                    position: '1',
                                    points: '8',
                                    grid: '2',
                                    Driver: { driverId: 'verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                                    Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                                }]
                            }]
                        }
                    }
                });
            }
            if (url.includes('/results.json')) {
                return okJson({
                    MRData: {
                        total: '1',
                        limit: '100',
                        RaceTable: {
                            Races: [{
                                round: '4',
                                raceName: 'Azerbaijan Grand Prix',
                                Results: [{
                                    position: '1',
                                    points: '25',
                                    grid: '2',
                                    status: 'Finished',
                                    Driver: { driverId: 'verstappen', givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
                                    Constructor: { constructorId: 'red_bull', name: 'Red Bull' }
                                }]
                            }]
                        }
                    }
                });
            }
            return okJson({ MRData: { RaceTable: { Races: [] } } });
        }
    });

    triggerDOMContentLoaded();
    await new Promise(r => setTimeout(r, 40));

    secondaryEndpoints.forEach(endpoint => {
        assert.equal(
            fetchedUrls.some(u => u.includes(endpoint)),
            false,
            `DOMContentLoaded must NOT stampede inactive module endpoint ${endpoint}`
        );
    });
    assert.ok(
        fetchedUrls.some(u => u.includes('/2026/last/results.json')) &&
        fetchedUrls.some(u => u.includes('/2026/driverStandings.json')),
        'DOMContentLoaded must preserve default overview startup requests'
    );

    const sprintStateAfterBoot = vm.runInContext('sprintState', sandbox);
    assert.equal(sprintStateAfterBoot.season, '2023', 'Pre-selected dropdown value should sync to state on boot');
    assert.equal(sprintStateAfterBoot.dataLoaded, false, 'Inactive sprint tab must not be loaded on boot');

    const inactiveStatesLoaded = vm.runInContext(`({
        clinch: clinchState.dataLoaded,
        sprint: sprintState.dataLoaded,
        constructorAtr: constructorAtrState.dataLoaded,
        constructorMomentum: constructorMomentumState.dataLoaded,
        pitStop: pitStopState.dataLoaded,
        finishingGap: finishingGapState.dataLoaded,
        circuitProfiler: circuitProfilerState.dataLoaded,
        lapChart: lapChartState.dataLoaded,
        reliability: reliabilityState.dataLoaded,
        stintDegradation: stintDegradationState.dataLoaded,
        qualifying: qualifyingCorrelationState.dataLoaded,
        overtake: overtakeIndexState.dataLoaded,
        telemetry: telemetryDataLoaded
    })`, sandbox);
    Object.entries(inactiveStatesLoaded).forEach(([tabName, loaded]) => {
        assert.equal(loaded, false, `Inactive module "${tabName}" must remain unloaded on DOMContentLoaded`);
    });

    // First visit to sprint tab lazy-loads its telemetry for the synced season ('2023')
    const countBeforeSprintSwitch = fetchedUrls.length;
    sandbox.switchMainTab('sprint');
    await new Promise(r => setTimeout(r, 140));

    const sprintUrls = fetchedUrls.slice(countBeforeSprintSwitch);
    assert.ok(sprintUrls.some(u => u.includes('/2023/sprint.json')), 'switchMainTab("sprint") must lazy-load sprint data');
    assert.equal(vm.runInContext('sprintState.dataLoaded', sandbox), true);

    // Switching away and back must NOT refetch already loaded sprint tab
    const countBeforeRepeatSwitch = fetchedUrls.length;
    sandbox.switchMainTab('results');
    sandbox.switchMainTab('sprint');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(fetchedUrls.length, countBeforeRepeatSwitch, 'Revisiting an already loaded tab must not re-fetch');
});

test('switchMainTab safely handles secondary tabs in minimal isolated contexts without ReferenceErrors', () => {
    const match = INDEX_HTML.match(/function switchMainTab\([\s\S]*?\n        \}/);
    assert.ok(match, 'switchMainTab function not found in index.html');

    const dummyEl = createMockElement('dummy', '');
    const isolatedContext = {
        document: {
            querySelectorAll: () => [],
            getElementById: () => dummyEl
        },
        setTimeout: () => 0,
        qualifyingCorrelationState: { season: '2024', dataLoaded: true, loading: false },
        overtakeIndexState: { season: '2024', dataLoaded: true, loading: false },
        loadQualifyingCorrelationData: () => {},
        loadOvertakeIndexData: () => {}
    };
    vm.createContext(isolatedContext);
    vm.runInContext(match[0], isolatedContext);

    const tabs = [
        'lap-chart', 'stints', 'degradation', 'finishing-gap', 'profiler',
        'constructors', 'momentum', 'sprint', 'clinch', 'pitstops',
        'reliability', 'qualifying', 'overtake', 'telemetry',
        'progression', 'results', 'all'
    ];
    tabs.forEach(tabId => {
        assert.doesNotThrow(() => isolatedContext.switchMainTab(tabId), `switchMainTab('${tabId}') threw in minimal context`);
    });
});
