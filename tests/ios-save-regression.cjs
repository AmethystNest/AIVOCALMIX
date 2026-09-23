const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('let vmIosPendingSave = null;');
const end = html.indexOf('function estimateWavExportMemory(', start);
assert.ok(start >= 0 && end > start);

const button = { textContent: '書き出す', disabled: false, dataset: {}, removeAttribute() {} };
const status = { textContent: '', className: '' };
const elements = { btnExport: button, exportStatus: status };
const timers = new Map();
let nextTimer = 0;
let shareCalls = 0;
let shareStartedSynchronously = false;
const context = vm.createContext({
  VM_PLATFORM: { isiOS: true }, vmActiveExportTriggerId: 'btnExport',
  document: { getElementById: id => elements[id], createElement: () => ({}),
    body: { appendChild() {}, removeChild() {} }, addEventListener() {} },
  window: { addEventListener() {} },
  navigator: { userActivation: { isActive: false }, canShare: () => true,
    share: () => { shareCalls++; shareStartedSynchronously = true; return Promise.resolve(); } },
  File: class { constructor(parts, name) { this.parts = parts; this.name = name; } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
  clearTimeout: id => timers.delete(id), Date, console
});
vm.runInContext(html.slice(start, end), context);
(async () => {
  const blob = new Blob(['WAV'], { type: 'audio/wav' });
  const pending = await context.saveBlobToDevice(blob, 'mix.wav');
  assert.equal(pending.method, 'pending-share');
  assert.equal(shareCalls, 0, 'share was attempted after user activation expired');
  for (const [id, timer] of [...timers]) if (timer.delay === 0) { timers.delete(id); timer.fn(); }
  assert.equal(button.textContent, 'iPhoneへ保存する');
  assert.equal(button.dataset.vmIosPendingSave, '1');
  const saving = context.completeIosPendingSaveFromGesture();
  assert.ok(shareStartedSynchronously, 'share was not called synchronously from second tap');
  const result = await saving;
  assert.equal(result.method, 'share');
  assert.equal(button.textContent, '書き出す');
  assert.equal(vm.runInContext('vmIosPendingSave', context), null);
  assert.equal(timers.size, 0, 'pending-save expiry timer was not cleared');
  console.log('iOS pending-save regression PASS (expired activation, second-tap share, cleanup)');
})().catch(error => { console.error(error); process.exitCode = 1; });
