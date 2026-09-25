// Checks that index.html and the service worker agree: every ./src/ and
// ./styles/ file index.html loads carries ?v=<cache version> and is in
// APP_SHELL with the same URL, every APP_SHELL file exists, and no script in
// src/ is left unreferenced. Fix with: node tools/asset-version.cjs
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cacheVersion } = require('../tools/asset-version.cjs');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const version = cacheVersion(sw);
const shellText = sw.slice(sw.indexOf('const APP_SHELL = ['), sw.indexOf('];', sw.indexOf('const APP_SHELL = [')));
const shell = [...shellText.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);

const refs = [...html.matchAll(/(?:src|href)="(\.\/(?:src|styles)\/[^"]+)"/g)].map(m => m[1]);
assert.ok(refs.length > 0, 'no ./src or ./styles references found');
for (const ref of refs) {
  assert.ok(ref.endsWith(`?v=${version}`), `${ref} is not stamped with ?v=${version}`);
  assert.ok(shell.includes(ref), `${ref} is loaded by index.html but missing from APP_SHELL`);
}
for (const entry of shell) {
  const file = entry.replace(/^\.\//, '').replace(/\?.*$/, '');
  if (!file) continue;
  assert.ok(fs.existsSync(path.join(root, file)), `APP_SHELL entry ${entry} does not exist`);
  if (/^\.\/(src|styles)\//.test(entry)) assert.ok(refs.includes(entry), `APP_SHELL entry ${entry} is not loaded by index.html`);
}
const srcFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) srcFiles.push('./' + path.relative(root, p).split(path.sep).join('/'));
  }
})(path.join(root, 'src'));
const loaded = new Set(refs.map(r => r.replace(/\?.*$/, '')));
const orphans = srcFiles.filter(f => !loaded.has(f));
assert.deepEqual(orphans, [], `scripts in src/ not loaded by index.html: ${orphans.join(', ')}`);
console.log(`App shell consistency PASS (${refs.length} versioned assets, cache ${version})`);
