// Where the Audio Session API exists (iOS/macOS Safari), the app must declare
// media playback so the silent switch does not mute the preview. Where it does
// not exist (e.g. Chromium) nothing may break. Prints which case ran.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';
(async () => {
  const name = process.env.VM_BROWSER || 'chromium';
  const browser = await ({ chromium, webkit }[name]).launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(baseUrl + 'index.html');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ has: !!navigator.audioSession, type: navigator.audioSession ? navigator.audioSession.type : null }));
  assert.deepEqual(errors, []);
  if (r.has) assert.equal(r.type, 'playback', 'audioSession.type must be playback');
  console.log(`Audio session PASS (${name}: API ${r.has ? 'present, type=' + r.type : 'absent, left untouched'})`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
