// M2: checks the app's Integrated LUFS and True Peak meters against external
// references.
//  1. EBU Tech 3341 integrated-loudness cases 1-5 (stereo 1 kHz sine
//     sequences, expected -23.0 / -33.0 LUFS, tolerance +-0.1 LU).
//  2. True Peak of sines whose continuous peak is known analytically
//     (includes Tech 3341 case 15: fs/4, 0 deg, 0.5 FS -> -6.0 dBTP), tolerance
//     +0.2/-0.4 dB as in Tech 3341.
//  3. A deterministic music-like signal: loudness against libebur128 (MIT,
//     +-0.01 LU since both implement the same BS.1770 filter) and
//     true peak against a high-precision band-limited reconstruction; the
//     reference values were measured once and are recorded below.
// Both the WASM path (…Cooperative) and the JS path are measured.
// Requires the local server used by smoke.cjs (port 8765).
const path = require('path');
const assert = require('node:assert/strict');
function loadChromium() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
  return playwright.chromium;
}
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';

// Deterministic stereo "mix": harmonic vocal line, chord pad, kick and noise
// hats, driven into a soft clipper so inter-sample peaks exceed sample peaks.
function musicLikeSignal(rate, seconds) {
  let seed = 3341;
  const rnd = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const n = rate * seconds, L = new Float32Array(n), R = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f0 = [220, 247, 262, 294, 330][Math.floor(t / 2) % 5] * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t));
    phase += 2 * Math.PI * f0 / rate;
    let v = 0;
    for (let h = 1; h <= 10; h++) v += Math.sin(h * phase) / h;
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 10);
    const hat = (rnd() * 2 - 1) * Math.exp(-((t + 0.25) % 0.5) * 50) * 0.3;
    const pad = 0.2 * (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 165 * t + 1));
    const section = (t % 8) < 4 ? 0.5 : 1.0;
    L[i] = Math.tanh(1.6 * section * (0.35 * v + kick + hat + pad));
    R[i] = Math.tanh(1.6 * section * (0.3 * v + kick + 0.7 * hat + 0.9 * pad));
  }
  return [L, R];
}

// Reference values for musicLikeSignal(rate, 20), measured once:
//  lufs:       libebur128 67b33ab, EBUR128_MODE_I.
//  truePeakDb: band-limited peak from a Kaiser(beta 12) windowed sinc with
//              1024 taps per side at 64x oversampling (docs/M2_LOUDNESS_REFERENCE.md).
//              libebur128's true peak read -0.03 dBTP here, 0.26-0.52 dB low,
//              so it is not used as the true-peak reference.
const REFERENCE = {
  48000: { lufs: -6.3680, truePeakDb: 0.2321 },
  44100: { lufs: -6.3638, truePeakDb: 0.4944 }
};

const db = v => 20 * Math.log10(v);

(async () => {
  if (process.argv[2] === '--dump-music') {
    // Writes the music-like signal as interleaved float32 for libebur128.
    const rate = Number(process.argv[3]);
    const [L, R] = musicLikeSignal(rate, 20);
    const out = Buffer.alloc(L.length * 8);
    for (let i = 0; i < L.length; i++) { out.writeFloatLE(L[i], i * 8); out.writeFloatLE(R[i], i * 8 + 4); }
    process.stdout.write(out);
    return;
  }
  const browser = await loadChromium().launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let failures = 0;
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}`);
    if (!ok) failures++;
  };
  try {
    await page.goto(baseUrl);
    await page.waitForFunction(() => typeof computeIntegratedLufsCooperative === 'function' &&
      typeof measureTruePeakBuffer === 'function');

    // 1. EBU Tech 3341 cases 1-5.
    const cases = [
      { name: 'EBU 3341 case 1', segments: [[-23, 20]], expected: -23 },
      { name: 'EBU 3341 case 2', segments: [[-33, 20]], expected: -33 },
      { name: 'EBU 3341 case 3', segments: [[-36, 10], [-23, 60], [-36, 10]], expected: -23 },
      { name: 'EBU 3341 case 4', segments: [[-72, 10], [-36, 10], [-23, 20], [-36, 10], [-72, 10]], expected: -23 },
      { name: 'EBU 3341 case 5', segments: [[-26, 20], [-20, 20.1], [-26, 20]], expected: -23 }
    ];
    for (const rate of [48000, 44100]) {
      for (const c of cases) {
        const r = await page.evaluate(async ({ segments, rate }) => {
          const total = Math.round(segments.reduce((n, s) => n + s[1], 0) * rate);
          const x = new Float32Array(total);
          let i = 0;
          for (const [level, seconds] of segments) {
            const a = 10 ** (level / 20), end = i + Math.round(seconds * rate);
            for (; i < end; i++) x[i] = a * Math.sin(2 * Math.PI * 1000 * i / rate);
          }
          const wasm = await computeIntegratedLufsCooperative([x, x], rate);
          const js = computeIntegratedLufs([x, x], rate);
          return { wasm: wasm.lufs, js: js.lufs };
        }, { segments: c.segments, rate });
        for (const path of ['wasm', 'js']) {
          check(`${c.name} ${rate} Hz ${path}`, Math.abs(r[path] - c.expected) <= 0.1,
            `${r[path].toFixed(3)} LUFS (expected ${c.expected} +-0.1)`);
        }
      }
    }

    // 2. True Peak of sines with an analytically known continuous peak.
    const sines = [
      { name: 'EBU 3341 case 15 (fs/4, 0 deg)', ratio: 1 / 4, phaseDeg: 0, amp: 0.5 },
      { name: 'fs/4, 45 deg', ratio: 1 / 4, phaseDeg: 45, amp: 0.5 },
      { name: 'fs/6, 60 deg', ratio: 1 / 6, phaseDeg: 60, amp: 0.5 },
      { name: 'fs/8, 67.5 deg', ratio: 1 / 8, phaseDeg: 67.5, amp: 0.5 },
      { name: '0.21 fs, 17 deg', ratio: 0.21, phaseDeg: 17, amp: 0.5 },
      { name: '997 Hz, 0.9 FS', hz: 997, phaseDeg: 30, amp: 0.9 }
    ];
    for (const rate of [48000, 44100]) {
      for (const s of sines) {
        const r = await page.evaluate(async ({ s, rate }) => {
          const n = rate, fade = Math.round(0.01 * rate), f = s.hz || s.ratio * rate;
          const x = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const g = Math.min(1, i / fade, (n - 1 - i) / fade);
            x[i] = g * s.amp * Math.sin(2 * Math.PI * f * i / rate + s.phaseDeg * Math.PI / 180);
          }
          const ctx = new OfflineAudioContext(2, n, rate);
          const buffer = ctx.createBuffer(2, n, rate);
          buffer.copyToChannel(x, 0); buffer.copyToChannel(x, 1);
          return {
            export8x: await measureTruePeakBuffer(buffer),
            wasm4x: await estimateTruePeakCooperative(x, 4, 8),
            js4x: estimateTruePeak(x, 4, 8)
          };
        }, { s, rate });
        const expected = db(s.amp);
        for (const [path, v] of Object.entries(r)) {
          const d = db(v) - expected;
          check(`TP ${s.name} ${rate} Hz ${path}`, d <= 0.2 && d >= -0.4,
            `${db(v).toFixed(3)} dBTP (expected ${expected.toFixed(2)} +0.2/-0.4)`);
        }
      }
    }

    // 3. Music-like signal vs libebur128.
    for (const rate of [48000, 44100]) {
      const ref = REFERENCE[rate];
      const r = await page.evaluate(async ({ rate, src }) => {
        const make = new Function(`return (${src})`)();
        const [L, R] = make(rate, 20);
        const ctx = new OfflineAudioContext(2, L.length, rate);
        const buffer = ctx.createBuffer(2, L.length, rate);
        buffer.copyToChannel(L, 0); buffer.copyToChannel(R, 1);
        const peak4x = Math.max(await estimateTruePeakCooperative(L, 4, 8), await estimateTruePeakCooperative(R, 4, 8));
        return {
          lufsWasm: (await computeIntegratedLufsCooperative([L, R], rate)).lufs,
          lufsJs: computeIntegratedLufs([L, R], rate).lufs,
          export8x: await measureTruePeakBuffer(buffer),
          wasm4x: peak4x
        };
      }, { rate, src: musicLikeSignal.toString() });
      for (const path of ['lufsWasm', 'lufsJs']) {
        check(`music ${rate} Hz ${path} vs libebur128`, Math.abs(r[path] - ref.lufs) <= 0.01,
          `${r[path].toFixed(3)} vs ${ref.lufs} LUFS (diff ${(r[path] - ref.lufs).toFixed(3)})`);
      }
      for (const path of ['export8x', 'wasm4x']) {
        const d = db(r[path]) - ref.truePeakDb;
        check(`music ${rate} Hz true peak ${path}`, d <= 0.2 && d >= -0.4,
          `${db(r[path]).toFixed(3)} vs ${ref.truePeakDb} dBTP (diff ${d.toFixed(3)}, +0.2/-0.4)`);
      }
    }
    assert.deepEqual(errors, [], 'Browser emitted uncaught errors');
    assert.equal(failures, 0, `${failures} loudness/true-peak checks failed`);
    console.log('Loudness reference regression PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
