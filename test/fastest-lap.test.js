const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScriptExports() {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
    const scriptMatch = html.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) throw new Error('No script in index.html');
    const sandbox = {
        document: {
            getElementById: () => ({ style: {}, addEventListener: () => {} }),
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
    return sandbox.module.exports;
}

test('Issue #9: extracts fastest lap from race results when rank === 1', () => {
    const f1App = loadScriptExports();
    const mockResults = [
        {
            position: '1',
            Driver: { givenName: 'Max', familyName: 'Verstappen', code: 'VER' },
            Constructor: { name: 'Red Bull' },
            FastestLap: { rank: '2', lap: '40', Time: { time: '1:28.123' } }
        },
        {
            position: '2',
            Driver: { givenName: 'Lando', familyName: 'Norris', code: 'NOR' },
            Constructor: { name: 'McLaren' },
            FastestLap: { rank: '1', lap: '44', Time: { time: '1:27.428' }, AverageSpeed: { speed: '218.234' } }
        }
    ];

    const fl = f1App.extractFastestLapFromResult(mockResults);
    assert.ok(fl, 'Fastest lap must be extracted');
    assert.equal(fl.driverName, 'Lando Norris');
    assert.equal(fl.driverCode, 'NOR');
    assert.equal(fl.lapTime, '1:27.428');
    assert.equal(fl.lapNum, '44');
});

test('Issue #9: returns null when no results or no FastestLap object exists (pre-2004)', () => {
    const f1App = loadScriptExports();
    const mockPre2004Results = [
        {
            position: '1',
            Driver: { givenName: 'Michael', familyName: 'Schumacher' },
            Constructor: { name: 'Ferrari' }
        }
    ];

    assert.equal(f1App.extractFastestLapFromResult(mockPre2004Results), null);
    assert.equal(f1App.extractFastestLapFromResult([]), null);
    assert.equal(f1App.extractFastestLapFromResult(null), null);
});

test('Issue #9: index.html does not query invalid fastestlaps.json endpoint', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
    assert.ok(!html.includes('/fastestlaps.json'), 'Must not make requests to invalid /fastestlaps.json endpoint');
});
