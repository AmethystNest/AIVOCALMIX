// The app is split into classic scripts that share one global scope. A
// top-level name declared twice either throws (let/const/class across
// scripts) or silently lets the later script's function win, so moving code
// between files could change which definition runs. This keeps every
// top-level declaration unique across the app script and src/.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sources = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m, i) => [`index.html inline #${i}`, m[1]]);
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) sources.push([path.relative(root, p), fs.readFileSync(p, 'utf8')]);
  }
})(path.join(root, 'src'));

const seen = new Map();
for (const [file, text] of sources) {
  for (const m of text.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)|^(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) {
    const name = m[1] || m[2];
    if (!seen.has(name)) seen.set(name, []);
    seen.get(name).push(file);
  }
}
const dupes = [...seen].filter(([, files]) => files.length > 1).map(([n, files]) => `${n} (${files.join(', ')})`);
assert.deepEqual(dupes, [], `top-level names declared more than once: ${dupes.join('; ')}`);
console.log(`Declaration uniqueness PASS (${seen.size} top-level names in ${sources.length} scripts)`);
