const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ids = ['fileVocal', 'fileInst', 'fileHarmony', 'fileReference'];
for (const id of ids) {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  assert.ok(tag, `${id} input missing`);
  assert.doesNotMatch(tag, /\baccept\s*=/, `${id} restricts iOS picker`);
}
const start = html.indexOf('function setupDrop(');
const end = html.indexOf('function checkUploadsReady()', start);
assert.ok(start >= 0 && end > start);
const listeners = {};
const input = { disabled: false, value: 'chosen', files: [], click() { this.clicks++; }, clicks: 0,
  setAttribute() {}, addEventListener(name, fn) { listeners[`input:${name}`] = fn; } };
const label = { textContent: '' };
const drop = { classList: { add() {}, remove() {} }, setAttribute() {},
  addEventListener(name, fn) { listeners[`drop:${name}`] = fn; } };
const status = { textContent: '', className: '' };
const elements = { fileVocal: input, dropVocal: drop, dropVocalLabel: label, uploadStatus: status };
const context = { document: { getElementById(id) { return elements[id]; } },
  state: { inputLoadGeneration: {}, activeLoads: 0, vocalBuffer: { stale: true }, vocalSamples: new Float32Array(1), inputBufferBytes: { vocal: 100 } },
  invalidateForSourceChange(kind) { assert.equal(kind, 'vocal'); },
  commitInputResourceUsage(kind, bytes) { context.state.inputBufferBytes[kind] = bytes; },
  setBusyByInputLoad() {} };
vm.runInNewContext(`${html.slice(start, end)}; setupDrop('dropVocal','fileVocal','dropVocalLabel','waveVocal',()=>{},'vocal');`, context);
listeners['drop:click']({ target: input });
assert.equal(input.clicks, 0, 'native input click reopened the picker');
listeners['drop:click']({ target: drop });
assert.equal(input.clicks, 1, 'card click did not open the picker');
listeners['input:change']();
input.files = [{ name: 'unsupported.txt' }];
listeners['input:change']();
assert.match(label.textContent, /unsupported\.txt/);
assert.equal(status.className, 'status-line error');
assert.equal(input.value, '');
assert.equal(context.state.activeLoads, 0, 'unsupported file entered decode');
assert.equal(context.state.vocalBuffer, null, 'unsupported replacement retained stale audio');
assert.equal(context.state.vocalSamples, null, 'unsupported replacement retained stale samples');
assert.equal(context.state.inputBufferBytes.vocal, 0, 'unsupported replacement retained memory accounting');
console.log('upload picker regression PASS (4 inputs, click guard, unsupported file)');
