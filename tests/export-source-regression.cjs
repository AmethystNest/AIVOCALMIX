const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const name of ['finalExportPreflightSource', 'fireLitPreflightSource']) {
  assert.match(html, new RegExp(`const ${name} = getLatestSongBuffer\\(\\);`));
}
const exportHandlers = html.slice(html.indexOf("document.getElementById('btnExport').addEventListener"));
assert.ok(exportHandlers.length > 0, 'Export handler missing');
assert.doesNotMatch(exportHandlers, /getLatestSongBuffer\(\) \|\| state\.(mixedSongBuffer|vocalBuffer)/,
  'Export must not fall back to obsolete or unprocessed audio');
const start = html.indexOf('async function exportBufferAsWav(');
const end = html.indexOf('function updateExportPlan()', start);
assert.ok(start > 0 && end > start, 'WAV export function missing');
const memoryError = Object.assign(new Error('iPhone memory limit'), { code: 'VM_WAV_MEMORY_LIMIT' });
const context = {
  validateWavExportMemory() { throw memoryError; },
  console: { warn() {} }
};
vm.runInNewContext(html.slice(start, end), context);
(async () => {
  const status = { textContent: '', className: '' };
  await assert.rejects(context.exportBufferAsWav({}, 'final', status, { bitDepth: 24, targetSr: 48000 }),
    error => error === memoryError);
  assert.equal(status.className, 'status-line error');
  assert.equal(status.textContent, memoryError.message);
  console.log('Export source and memory failure propagation regression PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
