// M6: numeric evaluation of reference matching v2 against the current (v1)
// method. The reference is the current mix passed through a known EQ, level
// and width change, so a perfect match would undo exactly that. Reports the
// remaining 1/3-octave error (Mid and Side, level-normalised, 63 Hz-12.5 kHz)
// and checks v2 invariants: FIR response accuracy and that amount 0 returns
// the input unchanged (Mid/Side split and latency compensation are exact).
// Needs the local server on port 8765.
const path = require('path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(baseUrl);
    await page.waitForFunction(() => typeof analyzeReferenceMatchV2 === 'function' && typeof audioCtx !== 'undefined');
    const result = await page.evaluate(async () => {
      const sr = 48000, seconds = 20, n = sr * seconds;
      let seed = 6;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      // Stereo mix: centred vocal-like line, wide pad, kick, panned hats.
      const L = new Float32Array(n), R = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f0 = [220, 247, 262, 294, 330][Math.floor(t / 2) % 5];
        ph += 2 * Math.PI * f0 / sr;
        let v = 0;
        for (let h = 1; h <= 14; h++) v += Math.sin(h * ph) / (h * 0.9);
        const env = (t % 2) < 1.7 ? 1 : 0.1;
        const beat = t % 0.5;
        const kick = Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 9);
        const hat = (rnd() * 2 - 1) * Math.exp(-((t + 0.25) % 0.5) * 40) * 0.25;
        const padL = 0.25 * Math.sin(2 * Math.PI * 110 * t) + 0.12 * Math.sin(2 * Math.PI * 440.5 * t);
        const padR = 0.25 * Math.sin(2 * Math.PI * 110.7 * t + 1) + 0.12 * Math.sin(2 * Math.PI * 439.3 * t);
        const section = (t % 8) < 4 ? 0.4 : 1;
        L[i] = section * (0.18 * env * v + 0.6 * kick + hat + padL);
        R[i] = section * (0.18 * env * v + 0.6 * kick + 0.4 * hat + padR);
      }
      const current = audioCtx.createBuffer(2, n, sr);
      current.copyToChannel(L, 0); current.copyToChannel(R, 1);

      // Reference: known EQ, -4 dB, Side x1.3.
      const refCtx = new OfflineAudioContext(2, n, sr);
      const src = refCtx.createBufferSource(); src.buffer = current;
      const eq = [['lowshelf', 200, -3, 0.7], ['peaking', 3000, 4, 1.4], ['highshelf', 9000, 5, 0.7]].map(([type, f, g, q]) => {
        const b = refCtx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = g; b.Q.value = q; return b;
      });
      let node = src; for (const b of eq) { node.connect(b); node = b; }
      node.connect(refCtx.destination); src.start();
      const eqd = await refCtx.startRendering();
      const reference = audioCtx.createBuffer(2, n, sr);
      {
        const a = eqd.getChannelData(0), b = eqd.getChannelData(1), g = 10 ** (-4 / 20);
        const outL = new Float32Array(n), outR = new Float32Array(n);
        for (let i = 0; i < n; i++) { const m = (a[i] + b[i]) / 2, s = (a[i] - b[i]) / 2 * 1.3; outL[i] = g * (m + s); outR[i] = g * (m - s); }
        reference.copyToChannel(outL, 0); reference.copyToChannel(outR, 1);
      }

      // Metric: whole-signal Mid/Side 1/3-octave band levels, level-normalised.
      const bandsOf = buf => {
        const size = 8192, half = size / 2, ws = createSpectrumWorkspace(size, sr);
        const a = buf.getChannelData(0), b = buf.getChannelData(1);
        const mid = new Float32Array(size), side = new Float32Array(size);
        const pm = new Float64Array(half), ps = new Float64Array(half);
        for (let s0 = 0; s0 + size <= n; s0 += size / 2) {
          for (let i = 0; i < size; i++) { mid[i] = (a[s0 + i] + b[s0 + i]) / 2; side[i] = (a[s0 + i] - b[s0 + i]) / 2; }
          let m = magnitudeSpectrumInto(mid, ws); for (let k = 0; k < half; k++) pm[k] += m[k] * m[k];
          m = magnitudeSpectrumInto(side, ws); for (let k = 0; k < half; k++) ps[k] += m[k] * m[k];
        }
        const centers = []; for (let f = 63; f <= 12600; f *= 2 ** (1 / 3)) centers.push(f);
        const band = (p, f) => {
          const lo = Math.floor(f / 2 ** (1 / 6) / (sr / size)), hi = Math.ceil(f * 2 ** (1 / 6) / (sr / size));
          let sum = 0; for (let k = lo; k <= hi; k++) sum += p[k];
          return 10 * Math.log10(sum / (hi - lo + 1));
        };
        return { mid: centers.map(f => band(pm, f)), side: centers.map(f => band(ps, f)) };
      };
      const refBands = bandsOf(reference);
      const error = buf => {
        const b = bandsOf(buf);
        const d = b.mid.map((v, i) => refBands.mid[i] - v);
        const offset = d.reduce((x, y) => x + y, 0) / d.length;
        const ds = b.side.map((v, i) => refBands.side[i] - v - offset);
        const rms = arr => Math.sqrt(arr.reduce((x, y) => x + y * y, 0) / arr.length);
        const max = arr => Math.max(...arr.map(Math.abs));
        const dm = d.map(v => v - offset);
        return { midRmsDb: +rms(dm).toFixed(3), midMaxDb: +max(dm).toFixed(3), sideRmsDb: +rms(ds).toFixed(3) };
      };

      // v1, exactly as the btnApplyReference handler does it.
      const v1 = async amount => {
        const refSpec = await computeAverageSpectrumDbFromBuffer(reference);
        const curSpec = await computeAverageSpectrumDbFromBuffer(current);
        const refB = computeBandLevels(refSpec), curB = computeBandLevels(curSpec);
        const avg = arr => arr.reduce((s, b) => s + b.db, 0) / arr.length;
        const offset = avg(refB) - avg(curB);
        const diffs = refB.map((b, i) => ({ centerHz: b.centerHz, diffDb: b.db - (curB[i].db + offset) }));
        const ctx = new OfflineAudioContext(2, n, sr);
        const s = ctx.createBufferSource(); s.buffer = current;
        let nd = s;
        for (const d of diffs) {
          const gainDb = Math.max(-6, Math.min(6, d.diffDb * amount));
          if (Math.abs(gainDb) < 0.2) continue;
          const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = d.centerHz; f.Q.value = 1.0; f.gain.value = gainDb;
          nd.connect(f); nd = f;
        }
        nd.connect(ctx.destination); s.start();
        return ctx.startRendering();
      };
      const match = await analyzeReferenceMatchV2(reference, current);
      const out = { none: error(current) };
      for (const amount of [0.5, 1]) {
        out[`v1_${amount * 100}`] = error(await v1(amount));
        out[`v2_${amount * 100}`] = error(await applyReferenceMatchV2(current, match, amount));
      }

      // Invariant: amount 0 is the identity.
      const same = await applyReferenceMatchV2(current, match, 0);
      let maxDiff = 0;
      for (let ch = 0; ch < 2; ch++) {
        const a = current.getChannelData(ch), b = same.getChannelData(ch);
        for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
      }
      out.identityMaxDiff = maxDiff;

      // Invariant: FIR magnitude follows the curve (60 Hz-16 kHz).
      const fir = buildReferenceMatchFirV2(match.gridHz, match.midDb, sr);
      const size = 65536, re = new Float64Array(size), im = new Float64Array(size);
      re.set(fir); fft(re, im);
      let firErr = 0;
      for (let g = 0; g < match.gridHz.length; g++) {
        const f = match.gridHz[g]; if (f < 60 || f > 16000) continue;
        const k = Math.round(f / sr * size);
        firErr = Math.max(firErr, Math.abs(20 * Math.log10(Math.hypot(re[k], im[k])) - match.midDb[g]));
      }
      out.firMaxErrorDb = +firErr.toFixed(3);
      out.sections = match.sections;
      out.levelOffsetDb = +match.levelOffsetDb.toFixed(2);
      return out;
    });
    console.log(JSON.stringify(result, null, 1));
    assert.deepEqual(errors, []);
    assert.ok(result.identityMaxDiff < 1e-4, `amount 0 is not the identity (max diff ${result.identityMaxDiff})`);
    assert.ok(result.firMaxErrorDb < 0.5, `FIR deviates ${result.firMaxErrorDb} dB from the target curve`);
    assert.ok(result.v2_100.midRmsDb < result.v1_100.midRmsDb, 'v2 does not match better than v1 at 100 %');
    console.log('Reference match v2 evaluation PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
