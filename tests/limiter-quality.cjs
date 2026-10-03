// Final limiter (applyLookaheadLimiter): the peak ceiling must hold, the gain
// must ramp instead of stepping (no broadband splatter on a tone), and in
// stereo both channels must receive the same gain (no image shift).
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const dsp = read('src/dsp/sample-dsp.js');
const wasmHelpers = dsp.slice(dsp.indexOf('function vmDecodeBase64Bytes('), dsp.indexOf('async function vmEnsureWasmDspRuntime('));
const ctx = { console, WebAssembly, atob, performance, setTimeout, Math, yieldToBrowser: async () => {} };
vm.createContext(ctx);
vm.runInContext(`${dsp}\nthis.api = { applyLookaheadLimiter };`, ctx);
const { applyLookaheadLimiter } = ctx.api;

const sr = 44100, N = 65536, ceilingDb = -1, ceiling = Math.pow(10, ceilingDb / 20);
const f = Math.round(1000 * N / sr) * sr / N;
function spectrum(x, off) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) [re[i], re[j]] = [re[j], re[i]]; }
  for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
    const wr = Math.cos(a * k), wi = Math.sin(a * k), ur = re[i + k], ui = im[i + k];
    const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
    re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; } }
  const p = new Float64Array(N / 2); for (let i = 0; i < N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]; return p;
}

(async () => {
  const total = sr * 3, lookahead = Math.round(sr * 0.005);
  // Control signal: a constant 0.5 level (no zero crossings, so the gain can be read back
  // exactly) whose 10 ms bursts reach 1.58 FS (about 5 dB of reduction).
  const mk = (burst) => { const x = new Float32Array(total);
    for (let i = 0; i < total; i++) { const t = i / sr; x[i] = (((t + 0.1) % 0.25) < 0.010 ? 0.5 * burst : 0.5); } return x; };
  const ctrl = mk(Math.pow(10, 10 / 20));
  const limited = await applyLookaheadLimiter(ctrl, sr, ceilingDb, 5, 60);
  let peak = 0; for (const v of limited) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= ceiling * 1.000001, `peak ${peak} exceeds ceiling ${ceiling}`);

  // Gain curve actually applied (output is delayed by the lookahead), measured on a clean carrier.
  const gain = new Float64Array(total - lookahead);
  for (let k = 0; k < gain.length; k++) { const x = ctrl[k]; gain[k] = limited[k + lookahead] / x; }
  let maxStep = 0, last = 1;
  for (let k = 0; k < gain.length; k++) { maxStep = Math.max(maxStep, Math.abs(gain[k] - last)); last = gain[k]; }
  const carrier = new Float32Array(total), y = new Float32Array(total);
  for (let i = 0; i < total; i++) { carrier[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr); const g = i < gain.length ? gain[i] : last; y[i] = carrier[i] * g; }
  const p = spectrum(y, sr), fb = Math.round(f * N / sr); let car = 0, far = 0;
  for (let b = 0; b < N / 2; b++) { const df = Math.abs(b * sr / N - f); if (Math.abs(b - fb) <= 3) car += p[b]; else if (df > 1500) far += p[b]; }
  const splatterDb = 10 * Math.log10(far / car);
  console.log(`far sidebands ${splatterDb.toFixed(1)} dB, largest gain step ${maxStep.toFixed(4)}`);
  assert.ok(splatterDb < -70, `gain modulation splatter ${splatterDb.toFixed(1)} dB (step attack was about -50 dB)`);

  // Stereo link: a left-only peak must reduce the right channel by the same amount.
  const L = new Float32Array(total), R = new Float32Array(total);
  for (let i = 0; i < total; i++) { const t = i / sr, v = 0.4 * Math.sin(2 * Math.PI * f * t); L[i] = v * (((t + 0.1) % 0.25) < 0.010 ? 3.2 : 1); R[i] = v; }
  const outL = await applyLookaheadLimiter(L, sr, ceilingDb, 5, 60, undefined, R);
  const outR = await applyLookaheadLimiter(R, sr, ceilingDb, 5, 60, undefined, L);
  let worst = 0;
  for (let i = 0; i < total - lookahead; i++) if (Math.abs(R[i]) > 0.1) {
    const gl = outL[i + lookahead] / L[i], gr = outR[i + lookahead] / R[i];
    worst = Math.max(worst, Math.abs(20 * Math.log10(gl / gr)));
  }
  console.log(`worst L/R gain difference ${worst.toFixed(4)} dB`);
  assert.ok(worst < 0.01, `L/R gain differs by ${worst} dB`);
  let pk = 0; for (let i = 0; i < total; i++) pk = Math.max(pk, Math.abs(outL[i]), Math.abs(outR[i]));
  assert.ok(pk <= ceiling * 1.000001);
  console.log('Limiter quality PASS (ceiling holds, smooth attack, stereo linked)');
})().catch(e => { console.error(e); process.exit(1); });
