const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/audio/upload-decode.js'), 'utf8');
const context = {
  window: {},
  state: { inputBufferBytes: { vocal: 0, instrumental: 0, harmony: 0, reference: 0 } },
  VM_RESOURCE_POLICY: { maxDurationSec: 20 * 60, maxDecodedInputBytes: 300 * 1024 * 1024 },
  formatBytes: (bytes) => `${Math.ceil(bytes / (1024 * 1024))}MB`,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
vm.runInContext(source, context);

function makePcmWavHeader({ seconds = 1, sampleRate = 48000, channels = 2, bits = 16 } = {}) {
  const blockAlign = channels * bits / 8;
  const dataBytes = Math.floor(seconds * sampleRate) * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (at, value) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true); text(36, 'data'); view.setUint32(40, dataBytes, true);
  return { header, totalBytes: dataBytes + 44 };
}

function makeExtensiblePcmHeader() {
  const fixture = makePcmWavHeader();
  const original = new DataView(fixture.header);
  const dataBytes = fixture.totalBytes - 44;
  const header = new ArrayBuffer(68);
  const view = new DataView(header);
  const text = (at, value) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, dataBytes + 60, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 40, true); view.setUint16(20, 0xFFFE, true);
  view.setUint16(22, 2, true); view.setUint32(24, 48000, true); view.setUint32(28, 192000, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); view.setUint16(36, 22, true);
  view.setUint16(38, 16, true); view.setUint16(44, 1, true);
  text(60, 'data'); view.setUint32(64, dataBytes, true);
  return { header, totalBytes: dataBytes + 68 };
}

const ordinary = makePcmWavHeader();
const estimate = context.vmEstimatePcmWavFromHeader(ordinary.header, ordinary.totalBytes, 48000);
assert.equal(estimate.duration, 1);
assert.equal(estimate.decodedBytes, 48000 * 2 * 4);
assert.equal(context.vmEstimatePcmWavFromHeader(ordinary.header, ordinary.totalBytes, 96000).decodedBytes, 96000 * 2 * 4);
const extensible = makeExtensiblePcmHeader();
assert.equal(context.vmEstimatePcmWavFromHeader(extensible.header, extensible.totalBytes, 48000).formatCode, 1);

const tooLong = makePcmWavHeader({ seconds: 21 * 60, sampleRate: 8000 });
const makeFile = (fixture) => ({
  name: 'fixture.wav', size: fixture.totalBytes,
  slice(_start, end) {
    assert.ok(end <= 1024 * 1024, 'preflight must read no more than 1 MiB');
    return { arrayBuffer: async () => fixture.header };
  }
});
(async () => {
  await assert.rejects(context.vmValidatePcmWavResourceBudget(makeFile(tooLong), 'vocal', 48000), /21\.0/);
  context.VM_RESOURCE_POLICY.maxDecodedInputBytes = 200000;
  await assert.rejects(context.vmValidatePcmWavResourceBudget(makeFile(ordinary), 'vocal', 48000), /上限1MB/);
  context.VM_RESOURCE_POLICY.maxDecodedInputBytes = 300 * 1024 * 1024;
  const unsupported = { ...ordinary, header: ordinary.header.slice(0) };
  new DataView(unsupported.header).setUint16(20, 6, true);
  assert.equal(context.vmEstimatePcmWavFromHeader(unsupported.header, unsupported.totalBytes, 48000), null);
  console.log('iOS WAV preflight regression: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
