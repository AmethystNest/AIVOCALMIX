// M3 golden test for the analysis layer (src/analysis/*.js): analyze() and
// analyzeRelative() run in Node on the synthetic inputs must reproduce, value
// for value (1e-12 relative), the analysis results the app produced in Chromium
// (tests/fixtures/mix-decision.json, recorded by mix-decision-regression.cjs).
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { syntheticInputs } = require('./baseline-metrics.cjs');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/mix-decision.json'));

// Globals the analysis layer takes from other scripts at call time.
const dsp = read('src/dsp/sample-dsp.js');
const wasmHelpers = dsp.slice(dsp.indexOf('function vmDecodeBase64Bytes('), dsp.indexOf('async function vmEnsureWasmDspRuntime('));
assert.ok(wasmHelpers.length > 0, 'WASM helpers not found');

const context = { console, WebAssembly, atob, performance, setTimeout, yieldToBrowser: async () => {} };
vm.createContext(context);
vm.runInContext(`${wasmHelpers}\n${read('src/analysis/spectrum-core.js')}\n${read('src/analysis/vocal-analysis.js')}\n` +
  'this.api = { analyze, analyzeRelative };', context);
const { analyze, analyzeRelative } = context.api;

const encode = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : { __num: String(value) };
  if (value == null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return { __typed: value.constructor.name, data: Array.from(value, encode) };
  if (Array.isArray(value)) return value.map(encode);
  const out = {};
  for (const k of Object.keys(value)) if (value[k] !== undefined && typeof value[k] !== 'function') out[k] = encode(value[k]);
  return out;
};

// Same samples Chromium hands the app. Its decodeAudioData converts 16-bit PCM
// in float32 as n * (1/32768) for negative and n * (1/32767) for positive
// values (measured; other browsers may differ), and monoFromAudioBuffer
// downmixes stereo as (L + R) / 2 into a Float32Array.
const f32 = Math.fround, NEG = f32(1 / 32768), POS = f32(1 / 32767);
const pcm = n => f32(n * (n < 0 ? NEG : POS));
function pcmToMono(wav) {
  const channels = wav.readUInt16LE(22), frames = (wav.length - 44) / (2 * channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    if (channels === 1) out[i] = pcm(wav.readInt16LE(44 + i * 2));
    else out[i] = (pcm(wav.readInt16LE(44 + i * 4)) + pcm(wav.readInt16LE(46 + i * 4))) / 2;
  }
  return out;
}

// Node and Chromium ship different V8 builds whose Math.cos/sin/hypot can
// differ in the last bit, so numbers are compared with a 1e-12 relative
// tolerance; everything else (keys, array lengths, strings) must match exactly.
function assertClose(actual, expected, where) {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${where}: expected a number`);
    const tol = 1e-12 * Math.max(1, Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= tol, `${where}: ${actual} vs ${expected}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') { assert.equal(actual, expected, where); return; }
  assert.ok(actual !== null && typeof actual === 'object', `${where}: expected an object`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: keys differ`);
  for (const k of Object.keys(expected)) assertClose(actual[k], expected[k], `${where}.${k}`);
}

(async () => {
  for (const [name, input] of Object.entries(fixture.inputs)) {
    const wavs = syntheticInputs(44100, 12, input.opts);
    const vocal = pcmToMono(wavs.vocal), inst = pcmToMono(wavs.inst);
    const analysis = await analyze(vocal, 44100);
    assertClose(JSON.parse(JSON.stringify(encode(analysis))), input.analysis, `${name} analyze()`);
    const rel = await analyzeRelative(vocal, inst, 44100);
    assertClose(JSON.parse(JSON.stringify(encode(rel))), input.rel, `${name} analyzeRelative()`);
    console.log('match', name);
  }
  console.log(`Analysis regression PASS (${Object.keys(fixture.inputs).length} inputs, Node vs recorded Chromium results)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
