const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function estimateFireLitPremasterPeakMemory(');
const end = html.indexOf('function validateWavExportMemory(', start);
assert.ok(start > 0 && end > start, 'Fire Lit preflight functions missing');
const context = {
  VM_RESOURCE_POLICY: { deviceMemoryGB: null },
  getWavExportMemoryLimit: () => 260 * 1024 * 1024,
  formatBytes: bytes => `${Math.round(bytes / 1024 / 1024)} MiB`
};
vm.runInNewContext(html.slice(start, end), context);
const buffer = (seconds, sr = 48000) => ({
  length: seconds * sr,
  duration: seconds,
  sampleRate: sr,
  numberOfChannels: 2
});
const short = context.estimateFireLitPremasterPeakMemory(buffer(60), 24, 48000);
assert.ok(short.peakBytes < context.getWavExportMemoryLimit());
assert.equal(short.peakBytes, Math.ceil(Math.max(short.assemblyPeak, short.encodingPeak) * 1.25));
const long = context.estimateFireLitPremasterPeakMemory(buffer(300), 24, 48000);
assert.ok(long.assemblyPeak > 260 * 1024 * 1024);
assert.throws(() => context.validateFireLitPremasterMemory(buffer(300), 24, 48000),
  error => error.code === 'VM_PREMASTER_MEMORY_LIMIT');
const upsample = context.estimateFireLitPremasterPeakMemory(buffer(90, 44100), 24, 96000);
assert.ok(upsample.targetBytes > upsample.rawBytes);
assert.ok(upsample.encodingPeak > upsample.rawBytes * 2 + upsample.wavBytes);
console.log('Fire Lit premaster memory regression PASS (iOS limit, long audio, upsampling)');
