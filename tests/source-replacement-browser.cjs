const assert = require('node:assert/strict');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright')); }

function wav() {
  const frames = 44100;
  const out = Buffer.alloc(44 + frames * 2);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(44100, 24); out.writeUInt32LE(88200, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) out.writeInt16LE(Math.round(8000 * Math.sin(i * 440 * Math.PI * 2 / 44100)), 44 + i * 2);
  return out;
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/');
    await page.evaluate(() => {
      const original = window.vmValidatePcmWavResourceBudget;
      window.__wavPreflightCalls = 0;
      window.vmValidatePcmWavResourceBudget = function (...args) {
        window.__wavPreflightCalls++;
        return original.apply(this, args);
      };
    });
    await page.locator('#fileVocal').setInputFiles({ name: 'vocal.wav', mimeType: 'audio/wav', buffer: wav() });
    await page.locator('#fileInst').setInputFiles({ name: 'inst.wav', mimeType: 'audio/wav', buffer: wav() });
    await page.waitForFunction(() => !document.querySelector('#btnAnalyze').disabled);
    await page.locator('#fileVocal').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('broken') });
    await page.waitForFunction(() => document.querySelector('#dropVocalLabel').textContent.includes('読み込み失敗'));
    assert.equal(await page.locator('#btnAnalyze').isDisabled(), true, 'Analyze used stale Vocal');
    assert.equal(await page.evaluate(() => state.vocalBuffer), null, 'stale Vocal AudioBuffer retained');
    await page.locator('#fileInst').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    await page.waitForFunction(() => document.querySelector('#dropInstLabel').textContent.includes('非対応'));
    assert.equal(await page.evaluate(() => state.instBuffer), null, 'unsupported replacement retained stale Inst');
    assert.equal(await page.locator('#btnAnalyze').isDisabled(), true);
    await page.locator('#fileHarmony').setInputFiles({ name: 'harmony.wav', mimeType: 'audio/wav', buffer: wav() });
    await page.waitForFunction(() => !!state.harmonyBuffer);
    await page.locator('#fileHarmony').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    await page.waitForFunction(() => document.querySelector('#dropHarmonyLabel').textContent.includes('非対応'));
    assert.equal(await page.evaluate(() => state.harmonyBuffer), null, 'unsupported replacement retained stale Harmony');
    await page.locator('#fileReference').setInputFiles({ name: 'reference.wav', mimeType: 'audio/wav', buffer: wav() });
    await page.waitForFunction(() => !!state.referenceBuffer);
    assert.equal(await page.evaluate(() => window.__wavPreflightCalls), 5, 'WAV preflight must run on every WAV upload, including failed decode');
    await page.locator('#fileReference').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
    await page.waitForFunction(() => document.querySelector('#dropReferenceLabel').textContent.includes('非対応'));
    assert.equal(await page.evaluate(() => state.referenceBuffer), null, 'unsupported replacement retained stale Reference');
    assert.deepEqual(errors, []);
    console.log('source replacement browser regression PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
