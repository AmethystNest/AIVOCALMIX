// M0 baseline recorder. Records sizes, stage timings, analysis/decision
// output and exported WAV fingerprints for a fixed synthetic input, so later
// refactors can be compared against the same numbers.
//
//   node tests/baseline-metrics.cjs                 print JSON
//   node tests/baseline-metrics.cjs --write <file>  also save it
//   node tests/baseline-metrics.cjs --check <file>  fail if outputs differ
//
// --check compares exported WAV hashes and the analysis/decision snapshot.
// Hashes are only comparable on the same Chromium version.
//
// Requires the local server used by smoke.cjs (port 8765). Chromium numbers do
// not represent iPhone Safari; timings are informational, not assertions.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
function loadChromium() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
  return playwright.chromium;
}
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';
const root = path.join(__dirname, '..');

// Deterministic PRNG so every run feeds the app identical bytes.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function wav16(channels, rate) {
  const frames = channels[0].length, n = channels.length;
  const data = Buffer.alloc(44 + frames * n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(n, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * n * 2, 28);
  data.writeUInt16LE(n * 2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * n * 2, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < n; c++) {
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    data.writeInt16LE(Math.round(v * 32767), 44 + (i * n + c) * 2);
  }
  return data;
}

// 12 s sung-like vocal: harmonic tone with vibrato, phrase gaps, breath noise
// and a sibilant burst; instrumental: stereo chord pad plus a kick pulse.
// opts varies the material for decision fixtures; the defaults produce the
// baseline input byte-for-byte.
function syntheticInputs(rate = 44100, seconds = 12, opts = {}) {
  const { vocalGain = 1, sibilance = 0.12, hiss = 0, boxiness = 0, instGain = 1 } = opts;
  const rnd = mulberry32(438);
  const frames = rate * seconds;
  const vocal = new Float32Array(frames);
  const notes = [220, 246.94, 261.63, 293.66, 329.63, 293.66];
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const note = notes[Math.floor(t / 2) % notes.length];
    const f0 = note * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t));
    phase += 2 * Math.PI * f0 / rate;
    const inPhrase = (t % 2) < 1.7;
    const env = inPhrase ? Math.min(1, (t % 2) / 0.05, (1.7 - (t % 2)) / 0.1) : 0;
    let s = 0;
    for (let h = 1; h <= 12; h++) s += Math.sin(h * phase) / (h * h * 0.6 + 0.4);
    const breath = !inPhrase && (t % 2) > 1.8 ? (rnd() * 2 - 1) * 0.04 : 0;
    const sib = (t % 4) > 1.5 && (t % 4) < 1.62 ? (rnd() * 2 - 1) * sibilance : 0;
    const box = boxiness ? boxiness * env * Math.sin(2 * Math.PI * 350 * t) : 0;
    const noise = hiss ? (rnd() * 2 - 1) * hiss : 0;
    vocal[i] = vocalGain * (0.35 * env * s + breath + sib + box) + noise;
  }
  const instL = new Float32Array(frames), instR = new Float32Array(frames);
  const chord = [110, 138.59, 164.81, 220];
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    let pad = 0;
    chord.forEach((f, k) => { pad += Math.sin(2 * Math.PI * f * t + k) * 0.08; });
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 12) * 0.5;
    const hat = (rnd() * 2 - 1) * Math.exp(-((t + 0.25) % 0.5) * 60) * 0.06;
    instL[i] = instGain * (pad + kick + hat);
    instR[i] = instGain * (pad * 0.9 + kick + hat * 0.7);
  }
  return { vocal: wav16([vocal], rate), inst: wav16([instL, instR], rate) };
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function pcmStats(output) {
  let offset = 12, fmt, data;
  while (offset + 8 <= output.length) {
    const id = output.toString('ascii', offset, offset + 4), len = output.readUInt32LE(offset + 4);
    if (id === 'fmt ') fmt = output.subarray(offset + 8, offset + 8 + len);
    if (id === 'data') data = output.subarray(offset + 8, offset + 8 + len);
    offset += 8 + len + (len % 2);
  }
  const channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), bits = fmt.readUInt16LE(14);
  const bytes = bits / 8, count = data.length / bytes;
  let peak = 0, sum = 0;
  for (let i = 0; i < count; i++) {
    const v = bits === 16 ? data.readInt16LE(i * 2) / 32768 : data.readIntLE(i * 3, 3) / 8388608;
    peak = Math.max(peak, Math.abs(v)); sum += v * v;
  }
  return { channels, sampleRate: rate, bits, frames: count / channels,
    samplePeakDb: +(20 * Math.log10(peak || 1e-12)).toFixed(3),
    rmsDb: +(10 * Math.log10(sum / count || 1e-24)).toFixed(3) };
}

function staticSizes() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .reduce((n, m) => n + Buffer.byteLength(m[1]), 0);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .reduce((n, m) => n + Buffer.byteLength(m[1]), 0);
  const wasmBase64 = [...html.matchAll(/(VM_[A-Z0-9_]*WASM[A-Z0-9_]*)\s*=\s*['"`]([A-Za-z0-9+/=]+)['"`]/g)]
    .map(m => ({ name: m[1], base64Bytes: m[2].length }));
  const srcFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else srcFiles.push([path.relative(root, p), fs.statSync(p).size]);
    }
  })(path.join(root, 'src'));
  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  const shellList = sw.slice(sw.indexOf('APP_SHELL = ['), sw.indexOf('];', sw.indexOf('APP_SHELL = [')));
  const shell = [...shellList.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(f => f && f !== 'index.html');
  const shellBytes = shell.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  return {
    indexHtmlBytes: Buffer.byteLength(html), inlineScriptBytes: inlineScripts, inlineStyleBytes: styles,
    wasmBase64, srcFiles: Object.fromEntries(srcFiles.sort()),
    appShellFiles: shell.length + 1, appShellBytes: shellBytes + Buffer.byteLength(html)
  };
}

// Keep only JSON-safe scalars/short arrays from analysis objects.
const SNAPSHOT_FN = `(function snap(v, depth) {
  if (v == null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? +v.toPrecision(7) : String(v);
  if (depth > 4) return undefined;
  if (ArrayBuffer.isView(v) || v instanceof AudioBuffer) return undefined;
  if (Array.isArray(v)) return v.length > 64 ? undefined : v.map(x => snap(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) { const s = snap(v[k], depth + 1); if (s !== undefined) out[k] = s; }
    return out;
  }
  return undefined;
})`;

async function runOnce(browser, inputs, runTag) {
  // Service workers are blocked: the first-install controllerchange reload
  // would otherwise interrupt the run. smoke.cjs covers the offline path.
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
  // Reverb IR noise uses Math.random and the WAV TPDF dither is seeded from
  // crypto.getRandomValues. Seed both so exported WAVs are comparable
  // bit-for-bit between runs; the app itself is unchanged.
  await context.addInitScript(() => {
    let seed = 438;
    const next = () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return (t ^ t >>> 14) >>> 0;
    };
    Math.random = () => next() / 4294967296;
    crypto.getRandomValues = array => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = next() & 255;
      return array;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  let heapPeak = 0;
  const sampleHeap = async () => {
    try {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const m = metrics.find(x => x.name === 'JSHeapUsedSize');
      if (m) heapPeak = Math.max(heapPeak, m.value);
    } catch (_) {}
  };
  const timer = setInterval(sampleHeap, 100);
  const wall = {};
  const time = async (name, fn) => { const t = Date.now(); await fn(); wall[name] = Date.now() - t; };
  const download = async (setup, button = '#btnExport') => {
    await page.locator('.tab-btn[data-screen="export"]').click();
    await setup();
    const d = page.waitForEvent('download', { timeout: 120000 });
    await page.locator(button).click();
    const file = await d;
    const buf = fs.readFileSync(await file.path());
    if (process.env.VM_BASELINE_DUMP) fs.writeFileSync(path.join(process.env.VM_BASELINE_DUMP, `${runTag}-${file.suggestedFilename()}`), buf);
    return { file: file.suggestedFilename(), sha256: sha256(buf), bytes: buf.length, ...pcmStats(buf) };
  };
  try {
    await page.goto(baseUrl);
    // Tab handlers attach after load; retry until the Upload screen is shown.
    await page.waitForFunction(async () => {
      document.querySelector('.tab-btn[data-screen="upload"]')?.click();
      await new Promise(r => setTimeout(r, 100));
      return document.body.dataset.screen === 'upload';
    }, null, { timeout: 30000, polling: 250 });
    await time('upload', async () => {
      await page.locator('#fileVocal').setInputFiles({ name: 'vocal.wav', mimeType: 'audio/wav', buffer: inputs.vocal });
      await page.locator('#fileInst').setInputFiles({ name: 'inst.wav', mimeType: 'audio/wav', buffer: inputs.inst });
      await page.waitForFunction(() => !document.querySelector('#btnAnalyze').disabled, null, { timeout: 60000 });
    });
    await time('analyze', async () => {
      await page.locator('#btnAnalyze').click();
      await page.waitForFunction(() => document.body.dataset.screen === 'analysis' && !state.isAnalyzing, null, { timeout: 180000 });
    });
    await page.locator('.tab-btn[data-screen="mix"]').click();
    await time('mix', async () => {
      await page.locator('#btnRenderMix').click();
      await page.waitForFunction(() => !document.querySelector('#btnDownloadMix').disabled && !state.isRendering, null, { timeout: 180000 });
    });
    const snapshot = await page.evaluate(`(() => { const snap = ${SNAPSHOT_FN}; return {
      audioContextSampleRate: state.vocalBuffer && state.vocalBuffer.sampleRate,
      vocalAnalysis: snap(state.vocalAnalysis, 0),
      rel: snap(state.rel, 0),
      chain: snap(state.chain, 0),
      latestRenderSummary: snap(state.latestRenderSummary, 0),
      mixedSong: (() => { const b = getLatestSongBuffer(); if (!b) return null;
        let peak = 0, sum = 0, n = 0;
        for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c);
          for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; n++; } }
        return { sampleRate: b.sampleRate, length: b.length, channels: b.numberOfChannels,
          samplePeakDb: +(20 * Math.log10(peak || 1e-12)).toFixed(3), rmsDb: +(10 * Math.log10(sum / n)).toFixed(3) }; })()
    }; })()`);
    const exports = {};
    await time('exportNormal', async () => {
      exports.normal = await download(async () => {
        await page.locator('#exportFinishMode').selectOption('normal');
        await page.locator('#exportSampleRate').selectOption('44100');
      });
    });
    await time('exportYouTube', async () => {
      exports.youtube = await download(async () => {
        await page.locator('#exportFinishMode').selectOption('youtube');
        await page.locator('#exportSampleRate').selectOption('44100');
      });
    });
    await time('exportPremaster', async () => {
      exports.premaster = await download(async () => {
        await page.locator('#exportSampleRate').selectOption('44100');
      }, '#btnExportMaster');
    });
    const stageTimings = await page.evaluate(() => (state.stageTimings || []).map(s => ({ ...s })));
    await sampleHeap();
    return { wallMs: wall, stageTimings, jsHeapPeakMB: +(heapPeak / 1048576).toFixed(1), snapshot, exports, errors };
  } finally {
    clearInterval(timer);
    await context.close();
  }
}

module.exports = { syntheticInputs, wav16 };

if (require.main === module) (async () => {
  const inputs = syntheticInputs();
  const browser = await loadChromium().launch({ headless: true });
  try {
    const first = await runOnce(browser, inputs, 'run1');
    const second = await runOnce(browser, inputs, 'run2');
    const deterministic = {
      normal: first.exports.normal.sha256 === second.exports.normal.sha256,
      youtube: first.exports.youtube.sha256 === second.exports.youtube.sha256,
      premaster: first.exports.premaster.sha256 === second.exports.premaster.sha256,
      analysis: JSON.stringify(first.snapshot) === JSON.stringify(second.snapshot)
    };
    const result = {
      recordedAt: new Date().toISOString(),
      git: require('child_process').execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(),
      browser: `chromium ${browser.version()} headless`,
      input: { vocal: { sha256: sha256(inputs.vocal), seconds: 12, channels: 1, rate: 44100 },
        inst: { sha256: sha256(inputs.inst), seconds: 12, channels: 2, rate: 44100 } },
      static: staticSizes(),
      deterministic,
      run1: first,
      run2Timing: { wallMs: second.wallMs, jsHeapPeakMB: second.jsHeapPeakMB }
    };
    const json = JSON.stringify(result, null, 2);
    const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
    if (arg('--write')) fs.writeFileSync(arg('--write'), json + '\n');
    const checkFile = arg('--check');
    if (!checkFile) console.log(json);
    if (first.errors.length || second.errors.length) process.exitCode = 1;
    if (!Object.values(deterministic).every(Boolean)) {
      console.error('Non-deterministic output between two runs', deterministic);
      process.exitCode = 1;
    }
    if (checkFile) {
      const expected = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
      if (expected.browser !== result.browser) console.warn(`Browser differs: baseline ${expected.browser}, now ${result.browser}`);
      const diffs = [];
      if (expected.input.vocal.sha256 !== result.input.vocal.sha256 || expected.input.inst.sha256 !== result.input.inst.sha256) diffs.push('input');
      for (const k of Object.keys(expected.run1.exports)) {
        if (expected.run1.exports[k].sha256 !== first.exports[k]?.sha256) diffs.push(`export.${k}`);
      }
      for (const k of Object.keys(expected.run1.snapshot)) {
        if (JSON.stringify(expected.run1.snapshot[k]) !== JSON.stringify(first.snapshot[k])) diffs.push(`snapshot.${k}`);
      }
      if (diffs.length) { console.error('Baseline mismatch:', diffs.join(', ')); process.exitCode = 1; }
      else console.log(`Baseline match (${checkFile}): exports ${Object.keys(first.exports).join('/')}, analysis/decision snapshot`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
