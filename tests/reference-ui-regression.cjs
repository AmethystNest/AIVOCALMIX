// Reference matching through the real UI: upload, analyze, mix, load a
// reference, "違いを分析", "補正を適用" and export, once with the default
// (v1) method and once with 新方式 (v2) switched on. Prints a hash of the
// v1 result so a refactor can be compared with the previous code
// (--expect-v1 <sha256>; add --rerender-mix to re-render the Mix after loading
// the reference, which code before the reference-upload fix required).
// Also checks that loading a reference keeps the Mix result usable. Random
// sources are seeded as in baseline-metrics.
// Needs the local server on port 8765.
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
const { syntheticInputs, wav16 } = require('./baseline-metrics.cjs');
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';

// Reference: same material, brighter, wider and quieter.
function referenceWav() {
  const { inst } = syntheticInputs(44100, 12, { instGain: 0.8 });
  const frames = (inst.length - 44) / 4, L = new Float32Array(frames), R = new Float32Array(frames);
  let prevL = 0, prevR = 0;
  for (let i = 0; i < frames; i++) {
    const l = inst.readInt16LE(44 + i * 4) / 32768, r = inst.readInt16LE(46 + i * 4) / 32768;
    L[i] = 0.7 * (l + 0.6 * (l - prevL)); R[i] = 0.7 * (r + 0.6 * (r - prevR)) * 0.9 - 0.1 * L[i];
    prevL = l; prevR = r;
  }
  return wav16([L, R], 44100);
}

async function run(browser, useV2, rerenderMix = false) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
  await context.addInitScript(() => {
    let seed = 438;
    const next = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return (t ^ t >>> 14) >>> 0; };
    Math.random = () => next() / 4294967296;
    crypto.getRandomValues = a => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) b[i] = next() & 255; return a; };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl);
  await page.waitForFunction(async () => {
    document.querySelector('.tab-btn[data-screen="upload"]')?.click();
    await new Promise(r => setTimeout(r, 100));
    return document.body.dataset.screen === 'upload';
  }, null, { timeout: 30000, polling: 250 });
  const inputs = syntheticInputs();
  await page.locator('#fileVocal').setInputFiles({ name: 'vocal.wav', mimeType: 'audio/wav', buffer: inputs.vocal });
  await page.locator('#fileInst').setInputFiles({ name: 'inst.wav', mimeType: 'audio/wav', buffer: inputs.inst });
  await page.waitForFunction(() => !document.querySelector('#btnAnalyze').disabled, null, { timeout: 60000 });
  await page.locator('#btnAnalyze').click();
  await page.waitForFunction(() => document.body.dataset.screen === 'analysis' && !state.isAnalyzing, null, { timeout: 180000 });
  await page.locator('.tab-btn[data-screen="mix"]').click();
  await page.locator('#btnRenderMix').click();
  await page.waitForFunction(() => !document.querySelector('#btnDownloadMix').disabled && !state.isRendering, null, { timeout: 180000 });
  await page.locator('.tab-btn[data-screen="preview"]').click();
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { if (d.querySelector('#fileReference')) d.open = true; }));
  await page.locator('#fileReference').setInputFiles({ name: 'reference.wav', mimeType: 'audio/wav', buffer: referenceWav() });
  await page.waitForFunction(() => !!state.referenceBuffer, null, { timeout: 60000 });
  if (rerenderMix) {
    // Needed on code before the reference-upload fix, where loading a reference
    // marked the Mix result as stale. Used to compare v1 output across versions.
    await page.locator('.tab-btn[data-screen="mix"]').click();
    await page.locator('#btnRenderMix').click();
    await page.waitForFunction(() => !document.querySelector('#btnDownloadMix').disabled && !state.isRendering && !!getLatestSongBuffer(), null, { timeout: 180000 });
    await page.locator('.tab-btn[data-screen="preview"]').click();
  } else {
    assert.ok(await page.evaluate(() => !!getLatestSongBuffer()), 'loading a reference invalidated the Mix result');
  }
  if (useV2) await page.locator('#refMatchV2').check();
  await page.locator('#btnAnalyzeReference').click();
  await page.waitForFunction(() => !!state.referenceMatch && !state.referenceBusy, null, { timeout: 120000 })
    .catch(async e => { throw new Error('reference analysis did not finish: ' + await page.locator('#referenceStatus').textContent()); });
  const status = await page.locator('#referenceStatus').textContent();
  await page.locator('#btnApplyReference').click();
  await page.waitForFunction(() => !!state.referenceMatchedBuffer && !state.referenceBusy, null, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const b = state.referenceMatchedBuffer, parts = [];
    for (let ch = 0; ch < b.numberOfChannels; ch++) parts.push(new Uint8Array(b.getChannelData(ch).slice().buffer));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    return { bytes: Array.from(bytes), latestIsMatched: getLatestSongBuffer() === b, hasV2: !!state.referenceMatch.v2,
      applyStatus: document.getElementById('referenceStatus').textContent, length: b.length, channels: b.numberOfChannels };
  });
  const grab = expr => page.evaluate(e => { const b = eval(e); return Array.from({ length: b.numberOfChannels }, (_, ch) => Array.from(b.getChannelData(ch))); }, expr);
  const matched = await grab('state.referenceMatchedBuffer');
  const base = await grab('state.referenceCorrection ? state.referenceCorrection.baseBuffer : state.mixedSongBuffer');
  // Normalised residual after fitting one gain (as in smoke.cjs).
  const fitError = (wav, x) => {
    let offset = 12, data;
    while (offset + 8 <= wav.length) {
      const id = wav.toString('ascii', offset, offset + 4), len = wav.readUInt32LE(offset + 4);
      if (id === 'data') data = wav.subarray(offset + 8, offset + 8 + len);
      offset += 8 + len + (len % 2);
    }
    const frames = Math.min(data.length / 4, x[0].length);
    let dot = 0, energy = 0, residual = 0;
    const y = (i, ch) => data.readInt16LE(i * 4 + ch * 2) / 32768;
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < frames; i++) { dot += x[ch][i] * y(i, ch); energy += x[ch][i] ** 2; }
    const gain = dot / energy;
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < frames; i++) residual += (y(i, ch) - gain * x[ch][i]) ** 2;
    return +Math.sqrt(residual / energy).toFixed(5);
  };
  const exports = {};
  for (const [mode, button] of [['normal', '#btnExport'], ['youtube', '#btnExport'], ['premaster', '#btnExportMaster']]) {
    await page.locator('.tab-btn[data-screen="export"]').click();
    await page.locator('#exportSampleRate').selectOption('44100');
    await page.locator('#exportBitDepth').selectOption('16');
    if (mode !== 'premaster') await page.locator('#exportFinishMode').selectOption(mode);
    const download = page.waitForEvent('download', { timeout: 180000 });
    await page.locator(button).click();
    const file = await download;
    const wav = require('fs').readFileSync(await file.path());
    exports[mode] = { file: file.suggestedFilename(), vsCorrected: fitError(wav, matched), vsUncorrected: fitError(wav, base) };
  }
  // Changing an FX setting makes the corrected song stale: Preview and Export
  // fall back to the uncorrected Mix until FX/correction are applied again.
  await page.locator('.tab-btn[data-screen="fx"]').click();
  await page.evaluate(() => { const el = document.getElementById('fxReverbMix'); el.value = '0.3'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  const invalidated = await page.evaluate(() => getActiveReferenceCorrection() === null && getLatestSongBuffer() !== state.referenceMatchedBuffer);
  const file = { suggestedFilename: () => exports.normal.file };
  const exportError = exports.normal.vsCorrected;
  await context.close();
  const sha = crypto.createHash('sha256').update(Buffer.from(result.bytes)).digest('hex');
  return { sha, status, applyStatus: result.applyStatus, latestIsMatched: result.latestIsMatched, hasV2: result.hasV2,
    exported: file.suggestedFilename(), exportError, exports, invalidated, length: result.length, channels: result.channels, errors };
}

// The corrected audio must be what Preview plays and what every export
// contains: each export is closer to the corrected song than to the
// uncorrected one, and the normal export matches the Preview buffer.
function checkReachesOutput(label, r) {
  assert.ok(r.latestIsMatched, `${label}: Preview does not use the corrected audio`);
  assert.ok(r.invalidated, `${label}: the correction stayed active after an FX setting changed`);
  assert.ok(r.exports.normal.vsCorrected < 0.05, `${label}: normal export differs from the corrected audio (${r.exports.normal.vsCorrected})`);
  for (const [mode, e] of Object.entries(r.exports)) {
    assert.ok(e.vsCorrected < e.vsUncorrected, `${label}: ${mode} export is not the corrected audio (${JSON.stringify(e)})`);
  }
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const rerender = process.argv.includes('--rerender-mix');
    const v1 = await run(browser, false, rerender);
    console.log('v1', JSON.stringify({ ...v1, sha: v1.sha.slice(0, 16) }));
    const expect = process.argv.indexOf('--expect-v1');
    if (expect > 0) assert.equal(v1.sha, process.argv[expect + 1], 'v1 reference match output changed');
    console.log('v1 sha256', v1.sha);
    assert.deepEqual(v1.errors, []);
    assert.ok(!v1.hasV2 && /バンド/.test(v1.applyStatus), 'v1 path not used by default');
    checkReachesOutput('v1', v1);
    // v2 only exists in the new code.
    const hasV2Ui = await (async () => {
      const c = await browser.newContext({ serviceWorkers: 'block' }); const p = await c.newPage();
      await p.goto(baseUrl); const n = await p.locator('#refMatchV2').count(); await c.close(); return n > 0;
    })();
    if (hasV2Ui) {
      const v2 = await run(browser, true, rerender);
      console.log('v2', JSON.stringify({ ...v2, sha: v2.sha.slice(0, 16) }));
      assert.deepEqual(v2.errors, []);
      assert.ok(v2.hasV2 && /新方式/.test(v2.applyStatus), 'v2 path not used');
      checkReachesOutput('v2', v2);

      assert.notEqual(v2.sha, v1.sha, 'v2 produced the same output as v1');
    }
    console.log('Reference UI regression PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
