// Visual/style regression for CSS refactors: captures every screen at phone and
// desktop widths (computed style of every element and its ::before/::after,
// plus a screenshot) and compares with a saved capture. Local requests that
// fail or return >= 400 also fail the check.
//
//   node tests/visual-regression.cjs --write <dir>   save a capture
//   node tests/visual-regression.cjs --check <dir>   compare with a capture
//
// Needs the local server on port 8765. Animations are disabled so captures are
// stable; this is a same-browser comparison, not an iPhone check.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';
const SCREENS = ['home', 'upload', 'analysis', 'mix', 'preview', 'fx', 'export'];
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };

async function pixelDiff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { changed: Infinity, total: 1, bbox: ['size', ia.width, ia.height, ib.width, ib.height] };
    const w = ia.width, h = ia.height, canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
    ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h); ctx.drawImage(ib, 0, 0); const db = ctx.getImageData(0, 0, w, h).data;
    let changed = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) {
        changed++; const x = (i / 4) % w, y = Math.floor(i / 4 / w);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { changed, total: w * h, bbox: changed ? [x0, y0, x1, y1] : null };
  }, [a.toString('base64'), b.toString('base64')]);
}

async function capture(dir, compareDir) {
  const browser = await playwright.chromium.launch({ headless: true });
  const diffs = [];
  try {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
      const page = await context.newPage();
      const failed = [];
      page.on('requestfailed', r => { if (r.url().startsWith(baseUrl)) failed.push(r.url()); });
      page.on('response', r => { if (r.url().startsWith(baseUrl) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      await page.goto(baseUrl);
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      for (const screen of SCREENS) {
        await page.waitForFunction(async s => {
          document.querySelector(`.tab-btn[data-screen="${s}"]`)?.click();
          await new Promise(r => setTimeout(r, 50));
          return document.body.dataset.screen === s;
        }, screen, { timeout: 30000, polling: 200 });
        // Let tap-feedback classes expire and images finish decoding.
        await page.waitForTimeout(1200);
        await page.evaluate(() => Promise.all([...document.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))));
        await page.evaluate(() => Promise.all([...document.images].filter(img => img.complete && img.naturalWidth).map(img => img.decode().catch(() => {}))));
        const styles = await page.evaluate(() => {
          const out = [];
          // Skip elements that are never rendered, so moving CSS between
          // <style> and <link> does not shift the element list.
          const skip = new Set(['HEAD', 'STYLE', 'LINK', 'SCRIPT', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE']);
          const all = [document.documentElement, ...document.querySelectorAll('*')].filter(el => !skip.has(el.tagName));
          all.forEach((el, i) => {
            for (const pe of [null, '::before', '::after']) {
              const cs = getComputedStyle(el, pe);
              // Chrome enumerates custom properties in varying order; sort by name.
              const props = [];
              for (let k = 0; k < cs.length; k++) props.push(cs[k] + ':' + cs.getPropertyValue(cs[k]));
              const text = props.sort().join(';');
              out.push(`${i}:${el.tagName}#${el.id}${pe || ''} ${text}`);
            }
          });
          return out;
        });
        const shot = await page.screenshot({ fullPage: true });
        const key = `${vpName}-${screen}`;
        if (dir) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${key}.png`), shot);
          fs.writeFileSync(path.join(dir, `${key}.styles.json`), JSON.stringify(styles));
        } else {
          const expectedStyles = JSON.parse(fs.readFileSync(path.join(compareDir, `${key}.styles.json`), 'utf8'));
          const expectedShot = fs.readFileSync(path.join(compareDir, `${key}.png`));
          let styleDiff = expectedStyles.length !== styles.length ? `element count ${expectedStyles.length} -> ${styles.length}` : '';
          if (!styleDiff) {
            const i = styles.findIndex((v, k) => v !== expectedStyles[k]);
            if (i >= 0) {
              const a = new Map(expectedStyles[i].split(' ').slice(1).join(' ').split(';').map(p => [p.split(':')[0], p]));
              const changed = styles[i].split(' ').slice(1).join(' ').split(';').filter(p => a.get(p.split(':')[0]) !== p);
              styleDiff = `first difference at ${styles[i].split(' ')[0]}: ${changed.slice(0, 3).join(' | ').slice(0, 200)}`;
            }
          }
          const px = Buffer.compare(shot, expectedShot) === 0 ? { changed: 0, total: 1 } : await pixelDiff(page, shot, expectedShot);
          // Computed styles (which include resolved url()s) must match exactly.
          // Screenshots also vary with JS-drawn content and scrollbar timing
          // (seen up to ~1.2 %), so they only fail above 5 %.
          const shotOk = px.changed <= px.total * 0.05;
          console.log(`${styleDiff || !shotOk ? 'DIFF' : 'SAME'} ${key} (${styles.length} element styles, ${px.changed} px differ${px.bbox ? ' at ' + px.bbox.join(',') : ''}) ${styleDiff}`);
          if (styleDiff || !shotOk) diffs.push(key);
        }
      }
      if (failed.length) diffs.push(`${vpName}: failed requests ${failed.join(', ')}`);
      await context.close();
    }
  } finally { await browser.close(); }
  if (compareDir) {
    assert.deepEqual(diffs, [], `visual differences: ${diffs.join(', ')}`);
    console.log('Visual regression PASS');
  } else console.log('captured', dir);
}

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
if (arg('--write')) capture(arg('--write'), null).catch(e => { console.error(e); process.exitCode = 1; });
else if (arg('--check')) capture(null, arg('--check')).catch(e => { console.error(e); process.exitCode = 1; });
else { console.error('usage: --write <dir> | --check <dir>'); process.exitCode = 1; }
