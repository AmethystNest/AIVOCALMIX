// Android install offer: shown only after beforeinstallprompt, "追加" calls the
// browser prompt, "あとで" is remembered, appinstalled hides it.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';
const fire = (page, outcome) => page.evaluate((o) => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  window.__prompted = 0;
  e.prompt = async () => { window.__prompted++; };
  e.userChoice = Promise.resolve({ outcome: o });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}, outcome);
(async () => {
  const browser = await ({ chromium, webkit }[process.env.VM_BROWSER || 'chromium']).launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await ctx.newPage();
  const shown = () => page.evaluate(() => !document.getElementById('pwaInstallBox').hidden);
  await page.goto(baseUrl + 'index.html');
  await page.waitForTimeout(800);
  assert.equal(await shown(), false, 'hidden until the browser offers install');
  assert.equal(await fire(page, 'accepted'), true, 'default mini-infobar suppressed');
  assert.equal(await shown(), true);
  const box = await page.locator('#pwaInstallBox').boundingBox();
  const nav = await page.locator('nav.tabs').boundingBox();
  assert.ok(box.y + box.height <= nav.y, 'does not cover the bottom navigation');
  await page.click('#btnPwaInstall');
  assert.equal(await page.evaluate(() => window.__prompted), 1);
  assert.equal(await shown(), false);
  await fire(page, 'accepted');
  await page.click('#btnPwaInstallLater');
  assert.equal(await shown(), false);
  await page.reload(); await page.waitForTimeout(800);
  await fire(page, 'accepted');
  assert.equal(await shown(), false, '"later" is remembered');
  await ctx.clearCookies(); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(800);
  await fire(page, 'accepted');
  assert.equal(await shown(), true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  assert.equal(await shown(), false, 'hidden after install');
  await browser.close();
  console.log('Install prompt PASS');
})().catch(e => { console.error(e); process.exit(1); });
