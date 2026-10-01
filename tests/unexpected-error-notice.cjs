// Phones have no visible console: an unexpected error outside an operation
// must show a short notice, one inside an operation must not (the operation
// reports it itself), and the notice must disappear on its own.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';
(async () => {
  const browser = await ({ chromium, webkit }[process.env.VM_BROWSER || 'chromium']).launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  const notice = () => page.evaluate(() => { const e = document.getElementById('vmCompatibilityNotice'); return e ? e.textContent : null; });
  await page.goto(baseUrl + 'index.html');
  await page.waitForFunction(() => typeof vmNotifyUnexpectedError === 'function');
  assert.equal(await notice(), null);
  await page.evaluate(() => setTimeout(() => { throw new Error('boom1'); }, 0));
  await page.waitForTimeout(200);
  assert.match(await notice(), /予期しないエラー.*boom1/);
  await page.evaluate(() => { document.getElementById('vmCompatibilityNotice').remove(); Promise.reject(new Error('boom2')); });
  await page.waitForTimeout(200);
  assert.match(await notice(), /boom2/);
  await page.evaluate(() => { document.getElementById('vmCompatibilityNotice').remove(); state.activeOperation = 'x'; setTimeout(() => { throw new Error('inop'); }, 0); });
  await page.waitForTimeout(200);
  assert.equal(await notice(), null, 'no notice during an operation');
  await page.evaluate(() => { state.activeOperation = null; setTimeout(() => { throw new Error('ResizeObserver loop limit exceeded'); }, 0); });
  await page.waitForTimeout(200);
  assert.equal(await notice(), null, 'benign ResizeObserver message ignored');
  await page.evaluate(() => setTimeout(() => { throw new Error('boom3'); }, 0));
  await page.waitForTimeout(10500);
  assert.equal(await notice(), null, 'notice auto-hides');
  await browser.close();
  console.log('Unexpected error notice PASS');
})().catch(e => { console.error(e); process.exit(1); });
