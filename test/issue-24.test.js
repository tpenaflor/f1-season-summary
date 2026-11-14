const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTestEnv(customFetch) {
  const elements = {};
  const listeners = {};
  const queriedUrls = [];

  function createMockElement(id, tag = 'div') {
    const classSet = new Set();
    return {
      id,
      tagName: tag.toUpperCase(),
      classes: classSet,
      classList: {
        classes: classSet,
        add(...cls) { cls.forEach(c => classSet.add(c)); },
        remove(...cls) { cls.forEach(c => classSet.delete(c)); },
        toggle(c, force) {
          if (force !== undefined) {
            force ? classSet.add(c) : classSet.delete(c);
          } else {
            classSet.has(c) ? classSet.delete(c) : classSet.add(c);
          }
        },
        contains(c) { return classSet.has(c); }
      },
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val);
        if (val === '') {
          this.children = [];
          this.options = [];
        }
      },
      textContent: '',
      value: '',
      style: { display: 'none' },
      children: [],
      options: [],
      appendChild(child) {
        this.children.push(child);
        if (this.tagName === 'SELECT' || child.tagName === 'OPTION') {
          this.options.push(child);
          if (child.selected || this.options.length === 1) {
            this.value = child.value;
          }
        }
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
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k] || null; }
    };
  }

  function getOrCreateEl(id) {
    if (!elements[id]) {
      const tag = id.toLowerCase().includes('select') ? 'select' : (id.toLowerCase().includes('chart') ? 'canvas' : 'div');
      elements[id] = createMockElement(id, tag);
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
          getOrCreateEl('tabBtnSprint'),
          getOrCreateEl('tabBtnClinch'),
          getOrCreateEl('tabBtnPitStops'),
          getOrCreateEl('tabBtnReliability'),
          getOrCreateEl('tabBtnTelemetry'),
          getOrCreateEl('tabBtnProgression'),
          getOrCreateEl('tabBtnResults')
        ];
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    createElement: (tag) => createMockElement('created_' + tag, tag)
  };

  class MockChart {
    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.type = config?.type;
      this.data = config?.data || { labels: [], datasets: [] };
      this.options = config?.options || {};
      this.destroyed = false;
      this.resized = false;
      this.updated = false;
    }
    destroy() { this.destroyed = true; }
    resize() { this.resized = true; }
    update() { this.updated = true; }
  }

  const activeFetch = async (url, opts) => {
    queriedUrls.push(url);
    if (customFetch) {
      const res = await customFetch(url, opts);
      if (res && res.ok !== undefined) return res;
      return {
        ok: true,
        status: 200,
        json: async () => res
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ MRData: { RaceTable: { Races: [] }, total: '0', limit: '100' } })
    };
  };

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
      Chart: MockChart
    },
    document: mockDoc,
    Chart: MockChart,
    fetch: activeFetch,
    console: { ...console, warn: () => {}, error: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    module: { exports: {} },
    exports: {}
  };
  context.window.document = mockDoc;

  vm.createContext(context);
  vm.runInContext(scriptCode, context);

  return {
    context,
    elements,
    queriedUrls,
    html
  };
}

describe('Issue #24: Driver Stint Length & Lap Time Degradation Pace Evolution Profiler', () => {

  test('Module exports all required Stint Degradation Profiler functions and state', () => {
    const { context } = createTestEnv();
    const exp = context.module.exports;

    assert.equal(typeof exp.loadStintDegradationData, 'function');
    assert.equal(typeof exp.processStintDegradationData, 'function');
    assert.equal(typeof exp.calculateOLSLinearRegression, 'function');
    assert.equal(typeof exp.detectAnomalousPitStops, 'function');
    assert.equal(typeof exp.filterOutlierLaps, 'function');
    assert.equal(typeof exp.extractDriverStints, 'function');
    assert.equal(typeof exp.parseLapTimeToSeconds, 'function');
    assert.equal(typeof exp.formatLapTime, 'function');
    assert.equal(typeof exp.calculateMedian, 'function');
    assert.equal(typeof exp.onStintSeasonChange, 'function');
    assert.equal(typeof exp.onStintRoundChange, 'function');
    assert.equal(typeof exp.refreshStintData, 'function');
    assert.equal(typeof exp.toggleStintFuelCorrection, 'function');
    assert.equal(typeof exp.onStintDriverFilterChange, 'function');
    assert.equal(typeof exp.setStintDriverFilter, 'function');
    assert.equal(typeof exp.populateStintRoundSelector, 'function');
    assert.equal(typeof exp.renderStintDegradationView, 'function');
    assert.equal(typeof exp.renderStintKpis, 'function');
    assert.equal(typeof exp.renderStintDegradationChart, 'function');
    assert.equal(typeof exp.renderStintLengthBars, 'function');
    assert.equal(typeof exp.renderTeamPaceMatrix, 'function');
    assert.ok(exp.stintDegradationState);
    assert.ok(exp.STINT_DEGRADATION_FALLBACK_2024);
  });

  test('Helper functions: parseLapTimeToSeconds and formatLapTime', () => {
    const { context } = createTestEnv();
    const { parseLapTimeToSeconds, formatLapTime } = context.module.exports;

    assert.equal(parseLapTimeToSeconds('1:34.567'), 94.567);
    assert.equal(parseLapTimeToSeconds('1:04.120'), 64.120);
    assert.equal(parseLapTimeToSeconds('92.450'), 92.45);
    assert.equal(parseLapTimeToSeconds(92.45), 92.45);
    assert.equal(parseLapTimeToSeconds(''), null);
    assert.equal(parseLapTimeToSeconds(null), null);

    assert.equal(formatLapTime(94.567), '1:34.567');
    assert.equal(formatLapTime(64.12), '1:04.120');
    assert.equal(formatLapTime(45.5), '45.500');
    assert.equal(formatLapTime(null), 'N/A');
  });

  test('calculateMedian computes exact medians for odd, even, and empty arrays', () => {
    const { context } = createTestEnv();
    const { calculateMedian } = context.module.exports;

    assert.equal(calculateMedian([90, 92, 95]), 92);
    assert.equal(calculateMedian([90, 92, 94, 96]), 93);
    assert.equal(calculateMedian([100]), 100);
    assert.equal(calculateMedian([]), 0);
  });

  test('Requirement (4): calculateOLSLinearRegression accurately calculates slope, base intercept, r, and r2', () => {
    const { context } = createTestEnv();
    const { calculateOLSLinearRegression } = context.module.exports;

    // Line: y = 0.05 * x + 90.0
    // x = 0, 1, 2, 3, 4
    // y = 90.0, 90.05, 90.10, 90.15, 90.20
    const xVals = [0, 1, 2, 3, 4];
    const yVals = [90.0, 90.05, 90.10, 90.15, 90.20];

    const reg = calculateOLSLinearRegression(xVals, yVals);
    assert.equal(reg.slope, 0.05);
    assert.equal(reg.intercept, 90.0);
    assert.equal(reg.r, 1.0);
    assert.equal(reg.r2, 1.0);
    assert.equal(reg.count, 5);

    // Negative slope (wet/drying conditions)
    const yValsNeg = [95.0, 94.0, 93.0, 92.0];
    const regNeg = calculateOLSLinearRegression([0, 1, 2, 3], yValsNeg);
    assert.equal(regNeg.slope, -1.0);
    assert.equal(regNeg.r, -1.0);
    assert.ok(regNeg.r < -0.4);
  });

  test('Requirement (1): Concurrent loading of results.json, pitstops.json, and paginated laps.json with memoization', async () => {
    const queried = [];
    const mockResults = {
      MRData: {
        RaceTable: {
          Races: [{
            round: '1',
            raceName: 'Bahrain Grand Prix',
            Results: [
              { position: '1', Driver: { driverId: 'max_verstappen', code: 'VER', givenName: 'Max', familyName: 'Verstappen' }, Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, laps: '57' },
              { position: '2', Driver: { driverId: 'perez', code: 'PER', givenName: 'Sergio', familyName: 'Pérez' }, Constructor: { constructorId: 'red_bull', name: 'Red Bull' }, laps: '57' }
            ]
          }]
        }
      }
    };

    const mockPitStops = {
      MRData: {
        RaceTable: {
          Races: [{
            round: '1',
            PitStops: [
              { driverId: 'max_verstappen', lap: '15', stop: '1', duration: '24.1' }
            ]
          }]
        }
      }
    };

    // First page of laps has total = 3, limit = 2 -> triggers second page fetch
    const mockLapsPage1 = {
      MRData: {
        total: '3',
        limit: '2',
        offset: '0',
        RaceTable: {
          Races: [{
            round: '1',
            Laps: [
              { number: '1', Timings: [{ driverId: 'max_verstappen', position: '1', time: '1:40.000' }, { driverId: 'perez', position: '2', time: '1:41.000' }] },
              { number: '2', Timings: [{ driverId: 'max_verstappen', position: '1', time: '1:35.000' }, { driverId: 'perez', position: '2', time: '1:36.000' }] }
            ]
          }]
        }
      }
    };

    const mockLapsPage2 = {
      MRData: {
        total: '3',
        limit: '2',
        offset: '2',
        RaceTable: {
          Races: [{
            round: '1',
            Laps: [
              { number: '3', Timings: [{ driverId: 'max_verstappen', position: '1', time: '1:35.100' }, { driverId: 'perez', position: '2', time: '1:36.100' }] }
            ]
          }]
        }
      }
    };

    const customFetch = async (url) => {
      queried.push(url);
      if (url.includes('results.json')) return mockResults;
      if (url.includes('pitstops.json')) return mockPitStops;
      if (url.includes('offset=2')) return mockLapsPage2;
      if (url.includes('laps.json')) return mockLapsPage1;
      return {};
    };

    const { context } = createTestEnv(customFetch);
    const exp = context.module.exports;

    // Initial load
    const metrics1 = await exp.loadStintDegradationData('2024', '1', false);
    assert.ok(metrics1);
    assert.equal(metrics1.season, '2024');
    assert.equal(metrics1.round, '1');

    // Confirm concurrent fetch URLs queried
    assert.ok(queried.some(u => u.includes('/2024/1/results.json')));
    assert.ok(queried.some(u => u.includes('/2024/1/pitstops.json')));
    assert.ok(queried.some(u => u.includes('/2024/1/laps.json?limit=2000')));
    assert.ok(queried.some(u => u.includes('offset=2'))); // Verified pagination

    const initialFetchCount = queried.length;

    // Repeated call without forceRefresh: should use memoized cache without additional fetch calls
    const metricsCached = await exp.loadStintDegradationData('2024', '1', false);
    assert.equal(queried.length, initialFetchCount, 'Memoization should prevent new network calls');
    assert.equal(metricsCached.season, '2024');

    // Forced refresh call: should re-query network
    await exp.loadStintDegradationData('2024', '1', true);
    assert.ok(queried.length > initialFetchCount, 'forceRefresh=true should bypass memoization cache');
  });

  test('Requirement (2): Stint extraction partitions by pit stops and tags in-lap / out-lap', () => {
    const { context } = createTestEnv();
    const { extractDriverStints } = context.module.exports;

    // Driver completed 10 laps, pitted on lap 5
    const driverLaps = [];
    for (let i = 1; i <= 10; i++) {
      driverLaps.push({
        driverId: 'verstappen',
        lapNumber: i,
        rawTimeSec: 90.0 + i * 0.05,
        rawTimeStr: `1:30.${i * 50}`,
        flags: [],
        isValidForDegradation: true
      });
    }

    const pitStops = [{ driverId: 'verstappen', lap: '5', stop: '1' }];

    const stints = extractDriverStints(driverLaps, pitStops, { fuelCorrection: false });
    assert.equal(stints.length, 2, 'Should partition into 2 stints around lap 5 pit stop');

    // Stint 1: Laps 1 to 5
    assert.equal(stints[0].startLap, 1);
    assert.equal(stints[0].endLap, 5);
    assert.equal(stints[0].totalLaps, 5);

    // Verify In-lap tagged on Lap 5 and excluded from baseline degradation
    const lap5 = stints[0].laps.find(l => l.lapNumber === 5);
    assert.ok(lap5.isInLap);
    assert.ok(lap5.flags.includes('IN_LAP'));
    assert.equal(lap5.isValidForDegradation, false);

    // Stint 2: Laps 6 to 10
    assert.equal(stints[1].startLap, 6);
    assert.equal(stints[1].endLap, 10);
    assert.equal(stints[1].totalLaps, 5);

    // Verify Out-lap tagged on Lap 6 and excluded from baseline degradation
    const lap6 = stints[1].laps.find(l => l.lapNumber === 6);
    assert.ok(lap6.isOutLap);
    assert.ok(lap6.flags.includes('OUT_LAP'));
    assert.equal(lap6.isValidForDegradation, false);
  });

  test('Requirement (2): Pre-2012 missing pitstops via >18s inter-lap delta anomaly detection & UI banner', () => {
    const { context, elements } = createTestEnv();
    const { detectAnomalousPitStops, processStintDegradationData, renderStintDegradationView } = context.module.exports;

    // Construct driver laps with an anomaly: lap 12 is 90s, lap 13 is 114s (+24s pit stop!)
    const laps = [];
    for (let i = 1; i <= 20; i++) {
      const time = (i === 13) ? 114.0 : 90.0 + i * 0.04;
      laps.push({
        driverId: 'alonso',
        lapNumber: i,
        rawTimeSec: time,
        flags: [],
        isValidForDegradation: true
      });
    }

    const syntheticStops = detectAnomalousPitStops(laps, {});
    assert.equal(syntheticStops.length, 1);
    assert.equal(syntheticStops[0].lap, '13');
    assert.equal(syntheticStops[0].inferred, true);

    // Verify full pipeline with empty pitstops array triggers inferredPitStops and UI banner
    const resultsData = [
      { position: '1', Driver: { driverId: 'alonso', code: 'ALO', givenName: 'Fernando', familyName: 'Alonso' }, Constructor: { constructorId: 'renault', name: 'Renault' }, laps: '20' }
    ];
    const lapsData = laps.map(l => ({
      number: String(l.lapNumber),
      Timings: [{ driverId: 'alonso', position: '1', time: `${Math.floor(l.rawTimeSec / 60)}:${(l.rawTimeSec % 60).toFixed(3)}` }]
    }));

    const metrics = processStintDegradationData(resultsData, [], lapsData, { season: '2005', round: '1' });
    assert.equal(metrics.inferredPitStops, true);

    renderStintDegradationView(metrics);
    const banner = elements['stintAnomalyBanner'];
    assert.equal(banner.style.display, 'flex', 'Pre-2012 anomaly banner should be visible when pitstops inferred');
  });

  test('Requirement (2): Wet / negative degradation (r < -0.4) and Short Stints (<4 valid laps)', () => {
    const { context } = createTestEnv();
    const { extractDriverStints } = context.module.exports;

    // Case 1: Short stint (< 4 valid laps)
    // Driver completes 4 total laps (lap 1 is standing start, lap 4 is pit in-lap -> only 2 valid laps)
    const shortLaps = [
      { lapNumber: 1, rawTimeSec: 96.0, flags: ['STANDING_START'], isValidForDegradation: false },
      { lapNumber: 2, rawTimeSec: 90.0, flags: [], isValidForDegradation: true },
      { lapNumber: 3, rawTimeSec: 90.1, flags: [], isValidForDegradation: true },
      { lapNumber: 4, rawTimeSec: 115.0, flags: ['IN_LAP'], isValidForDegradation: false }
    ];
    const shortStints = extractDriverStints(shortLaps, [{ lap: '4' }], {});
    assert.equal(shortStints[0].isShortStint, true);
    assert.equal(shortStints[0].statusTag, 'SHORT_STINT');
    assert.equal(shortStints[0].slope, null);

    // Case 2: Wet / Drying track evolution with negative degradation slope (r < -0.4)
    const wetLaps = [];
    for (let i = 2; i <= 10; i++) {
      wetLaps.push({
        lapNumber: i,
        rawTimeSec: 105.0 - (i * 0.8), // Times improving significantly: 103.4, 102.6, 101.8...
        flags: [],
        isValidForDegradation: true
      });
    }
    const wetStints = extractDriverStints(wetLaps, [], {});
    assert.equal(wetStints[0].isShortStint, false);
    assert.ok(wetStints[0].slope < 0, 'Slope should be negative');
    assert.ok(wetStints[0].r < -0.4, 'Pearson r should be < -0.4');
    assert.equal(wetStints[0].statusTag, 'WET_DEGRADATION');
  });

  test('Requirement (3): Outlier & Safety Car filtering (>107% of rolling median, field median surge >10%, Standing start)', () => {
    const { context } = createTestEnv();
    const { filterOutlierLaps } = context.module.exports;

    // Create a 15-lap race where lap 8 has a field median surge > 10% (Safety Car)
    // and lap 4 has a personal outlier for driver 1 (>107% of rolling median)
    const fieldLapsByLap = {};
    for (let lap = 1; lap <= 15; lap++) {
      if (lap === 8) {
        fieldLapsByLap[lap] = [125.0, 126.0, 127.0]; // Surge from ~90s to ~126s (>40% surge)
      } else {
        fieldLapsByLap[lap] = [90.0, 90.5, 91.0];
      }
    }

    const driverLaps = [];
    for (let lap = 1; lap <= 15; lap++) {
      let time = 90.0;
      if (lap === 1) time = 96.0; // Standing start
      else if (lap === 4) time = 102.0; // 102 / 90 = 1.13 (> 107% of rolling median)
      else if (lap === 8) time = 126.0; // Field SC
      driverLaps.push({
        driverId: 'norris',
        lapNumber: lap,
        rawTimeSec: time,
        flags: [],
        isValidForDegradation: true
      });
    }

    const result = filterOutlierLaps(driverLaps, fieldLapsByLap);
    const laps = result.laps;

    // Lap 1: Flagged as STANDING_START
    assert.ok(laps[0].flags.includes('STANDING_START'));
    assert.equal(laps[0].isValidForDegradation, false);

    // Lap 4: Personal outlier >107% of rolling median -> NEUTRALIZED_LAP
    assert.ok(laps[3].flags.includes('NEUTRALIZED_LAP'));
    assert.equal(laps[3].isValidForDegradation, false);

    // Lap 8: Field median surge >10% -> NEUTRALIZED_LAP
    assert.ok(laps[7].flags.includes('NEUTRALIZED_LAP'));
    assert.equal(laps[7].isValidForDegradation, false);

    // Clean lap (Lap 5): Valid for degradation
    assert.equal(laps[4].isValidForDegradation, true);
  });

  test('Requirement (4): Fuel burn weight correction (~0.035 s/lap) toggle normalization', () => {
    const { context } = createTestEnv();
    const { extractDriverStints } = context.module.exports;

    // If actual raw lap times are flat: 90.0, 90.0, 90.0, 90.0, 90.0
    // Without fuel correction, degradation slope is 0.0 s/lap.
    // With fuel correction, tire degradation pace is revealed as car burned fuel:
    // corrected time = rawTime + (lapNumber - 1) * 0.035 s/lap
    const cleanLaps = [];
    for (let i = 2; i <= 6; i++) {
      cleanLaps.push({
        lapNumber: i,
        rawTimeSec: 90.0,
        flags: [],
        isValidForDegradation: true
      });
    }

    // Toggle OFF
    const stintsUncorrected = extractDriverStints(cleanLaps.map(l => ({ ...l })), [], { fuelCorrection: false });
    assert.equal(stintsUncorrected[0].slope, 0.0);

    // Toggle ON
    const stintsCorrected = extractDriverStints(cleanLaps.map(l => ({ ...l })), [], { fuelCorrection: true, fuelBurnRate: 0.035 });
    assert.equal(stintsCorrected[0].slope, 0.035, 'Normalized slope should reflect +0.035 s/lap tire degradation');
  });

  test('Requirement (5): UI Tab integration into switchMainTab, elements existence, and resizing', () => {
    const { context, elements, html } = createTestEnv();

    // Check HTML tab button and section exists in source HTML
    assert.ok(html.includes('id="tabBtnStints"'));
    assert.ok(html.includes('id="stint-profiler-section"'));
    assert.ok(html.includes('id="stintDegradationChart"'));
    assert.ok(html.includes('id="stintLengthBarChart"'));
    assert.ok(html.includes('id="teamPaceDegradationTable"'));

    // Test switchMainTab('stints')
    context.switchMainTab('stints');
    assert.equal(elements['stint-profiler-section'].style.display, 'block');
    assert.equal(elements['lap-chart-section'].style.display, 'none');
    assert.equal(elements['finishing-gap-section'].style.display, 'none');
    assert.ok(elements['tabBtnStints'].classList.contains('active'));

    // Test switchMainTab('degradation')
    context.switchMainTab('degradation');
    assert.equal(elements['stint-profiler-section'].style.display, 'block');

    // Test switchMainTab('lap-chart') hides stint section
    context.switchMainTab('lap-chart');
    assert.equal(elements['stint-profiler-section'].style.display, 'none');
    assert.equal(elements['lap-chart-section'].style.display, 'block');

    // Test switchMainTab('all') shows stint section
    context.switchMainTab('all');
    assert.equal(elements['stint-profiler-section'].style.display, 'block');
  });

  test('Requirement (5): View rendering of Stint Degradation Chart, Team Pace Matrix, and Stint Length Bars', () => {
    const { context, elements } = createTestEnv();
    const exp = context.module.exports;

    // Use fallback 2024 data
    const metrics = exp.processStintDegradationData(
      exp.STINT_DEGRADATION_FALLBACK_2024.resultsData,
      exp.STINT_DEGRADATION_FALLBACK_2024.pitStopsData,
      exp.STINT_DEGRADATION_FALLBACK_2024.lapsData,
      { season: '2024', round: '1', fuelCorrection: false }
    );

    exp.renderStintDegradationView(metrics);

    // Verify Chart.js instances created
    assert.ok(exp.stintDegradationState.degradationChartInstance);
    assert.ok(exp.stintDegradationState.barsChartInstance);

    // Verify Team Pace Degradation Matrix table rows rendered
    const tbody = elements['teamPaceDegradationTableBody'];
    assert.ok(tbody.innerHTML.includes('Max Verstappen'));
    assert.ok(tbody.innerHTML.includes('Stint 1'));
    assert.ok(tbody.innerHTML.includes('s/lap'));
    assert.ok(tbody.innerHTML.includes('stint-badge'));

    // Verify Stint Length Bars container populated
    const barsContainer = elements['stintLengthBarsContainer'];
    assert.ok(barsContainer.innerHTML.includes('stint-bar-segment'));
    assert.ok(barsContainer.innerHTML.includes('P1 VER'));

    // Verify KPI summary cards
    assert.ok(elements['kpiAvgFieldDegradation'].textContent.includes('s/lap'));
    assert.ok(elements['kpiLongestStint'].textContent.includes('Laps'));

    // Test Driver Filter selection updates view
    exp.setStintDriverFilter('winner');
    assert.ok(elements['btnStintFilterWinner'].classList.contains('active'));

    exp.onStintDriverFilterChange('max_verstappen');
    assert.equal(exp.stintDegradationState.selectedDriver, 'max_verstappen');

    // Toggle Fuel Correction
    exp.toggleStintFuelCorrection(true);
    assert.equal(exp.stintDegradationState.fuelCorrection, true);
  });

  test('Pre-2012 anomaly banner is hidden when official pit stops are present', () => {
    const { context, elements } = createTestEnv();
    const exp = context.module.exports;

    const metricsWithOfficialPits = exp.processStintDegradationData(
      exp.STINT_DEGRADATION_FALLBACK_2024.resultsData,
      exp.STINT_DEGRADATION_FALLBACK_2024.pitStopsData, // Official pit stops provided
      exp.STINT_DEGRADATION_FALLBACK_2024.lapsData,
      { season: '2024', round: '1' }
    );

    assert.equal(metricsWithOfficialPits.inferredPitStops, false);
    exp.renderStintDegradationView(metricsWithOfficialPits);

    const banner = elements['stintAnomalyBanner'];
    assert.equal(banner.style.display, 'none', 'Banner should be hidden when official pit stops exist');
  });

  test('Driver with 3 pit stops: partitions into 4 stints, all in-laps and out-laps excluded', () => {
    const { context } = createTestEnv();
    const { extractDriverStints } = context.module.exports;

    const laps = [];
    for (let i = 1; i <= 40; i++) {
      laps.push({
        driverId: 'hamilton',
        lapNumber: i,
        rawTimeSec: 92.0 + (i % 10) * 0.05,
        flags: [],
        isValidForDegradation: true
      });
    }

    const pitStops = [
      { driverId: 'hamilton', lap: '10', stop: '1' },
      { driverId: 'hamilton', lap: '20', stop: '2' },
      { driverId: 'hamilton', lap: '30', stop: '3' }
    ];

    const stints = extractDriverStints(laps, pitStops, { fuelCorrection: false });
    assert.equal(stints.length, 4, '3 pit stops should yield 4 stints');
    assert.equal(stints[0].startLap, 1);
    assert.equal(stints[0].endLap, 10);
    assert.equal(stints[1].startLap, 11);
    assert.equal(stints[1].endLap, 20);
    assert.equal(stints[2].startLap, 21);
    assert.equal(stints[2].endLap, 30);
    assert.equal(stints[3].startLap, 31);
    assert.equal(stints[3].endLap, 40);

    // In-laps on 10, 20, 30
    [10, 20, 30].forEach(lapNum => {
      const l = laps.find(x => x.lapNumber === lapNum);
      assert.ok(l.isInLap);
      assert.equal(l.isValidForDegradation, false);
    });

    // Out-laps on 11, 21, 31
    [11, 21, 31].forEach(lapNum => {
      const l = laps.find(x => x.lapNumber === lapNum);
      assert.ok(l.isOutLap);
      assert.equal(l.isValidForDegradation, false);
    });
  });

  test('Red flag lap (>200s) is tagged and excluded from degradation slope calculation', () => {
    const { context } = createTestEnv();
    const { filterOutlierLaps, extractDriverStints } = context.module.exports;

    const laps = [];
    for (let i = 1; i <= 10; i++) {
      const time = (i === 6) ? 320.0 : 90.0 + i * 0.05; // Lap 6 red flag suspended lap
      laps.push({
        driverId: 'leclerc',
        lapNumber: i,
        rawTimeSec: time,
        flags: [],
        isValidForDegradation: true
      });
    }

    filterOutlierLaps(laps, {});
    const lap6 = laps.find(l => l.lapNumber === 6);
    assert.ok(lap6.flags.includes('RED_FLAG'));
    assert.ok(lap6.flags.includes('NEUTRALIZED_LAP'));
    assert.equal(lap6.isValidForDegradation, false);

    const stints = extractDriverStints(laps, [], {});
    // Check that lap 6 was not included in validLaps
    assert.ok(!stints[0].validLaps.some(l => l.lapNumber === 6));
  });

  test('populateStintRoundSelector populates option elements correctly', () => {
    const { context, elements } = createTestEnv();
    const { populateStintRoundSelector } = context.module.exports;

    const rounds = [
      { round: '1', raceName: 'Bahrain Grand Prix' },
      { round: '2', raceName: 'Saudi Arabian Grand Prix' },
      { round: '3', raceName: 'Australian Grand Prix' }
    ];

    populateStintRoundSelector(rounds, '2');
    const select = elements['stintRoundSelect'];
    assert.equal(select.options.length, 3);
    assert.equal(select.value, '2');
  });

  test('Fallback resilience when fetch fails', async () => {
    const failingFetch = async () => {
      throw new Error('Network timeout');
    };

    const { context } = createTestEnv(failingFetch);
    const exp = context.module.exports;

    const result = await exp.loadStintDegradationData('2024', '1', false);
    assert.ok(result, 'Should return fallback metrics when API fails for 2024');
    assert.equal(result.season, '2024');
    assert.ok(result.drivers.length > 0);
  });
});
