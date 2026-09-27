// Stamps ?v=<cache version> on every ./src/ and ./styles/ reference in
// index.html and in the service worker's APP_SHELL, using the version part of
// CACHE_NAME. index.html is fetched network-first but these files are served
// cache-first, so without a per-release URL a new index.html could run with
// scripts/styles from the previous release until the user taps Update.
//
//   node tools/asset-version.cjs   (after bumping CACHE_NAME)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const swPath = path.join(root, 'service-worker.js');
const htmlPath = path.join(root, 'index.html');

function cacheVersion(sw) {
  const m = sw.match(/const CACHE_NAME = `\$\{CACHE_PREFIX\}([^`]+)`;/);
  if (!m) throw new Error('CACHE_NAME not found in service-worker.js');
  return m[1];
}

const ASSET_RE = /(\.\/(?:src|styles)\/[A-Za-z0-9_./-]+\.(?:js|css))(?:\?v=[A-Za-z0-9_.-]+)?/g;

function stamp(text, version) {
  return text.replace(ASSET_RE, (_, url) => `${url}?v=${version}`);
}

if (require.main === module) {
  const sw = fs.readFileSync(swPath, 'utf8');
  const version = cacheVersion(sw);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const start = sw.indexOf('const APP_SHELL = [');
  const end = sw.indexOf('];', start);
  const newSw = sw.slice(0, start) + stamp(sw.slice(start, end), version) + sw.slice(end);
  fs.writeFileSync(swPath, newSw);
  fs.writeFileSync(htmlPath, stamp(html, version));
  console.log('stamped ?v=' + version);
}

module.exports = { cacheVersion };
