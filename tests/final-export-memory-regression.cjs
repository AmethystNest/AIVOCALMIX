const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/audio/render-memory-preflight.js'), 'utf8');
const context = {
  VM_PLATFORM: { isiOS: true },
  VM_RESOURCE_POLICY: { deviceMemoryGB: null },
  getWavExportMemoryLimit: () => 260 * 1024 * 1024,
  formatBytes: bytes => `${Math.round(bytes / 1024 / 1024)} MiB`
};
vm.runInNewContext(source, context);
const buffer = (seconds, sr = 48000, channels = 2) => ({
  length: seconds * sr,
  duration: seconds,
  sampleRate: sr,
  numberOfChannels: channels
});

for (const mode of ['normal', 'youtube']) {
  const short = context.estimateFinalExportPeakMemory(buffer(60), 24, 48000, mode);
  assert.ok(short.peakBytes < context.getWavExportMemoryLimit(), `60-second ${mode} should fit`);
  assert.equal(short.peakBytes, Math.ceil(Math.max(short.assemblyPeak, short.encodingPeak) * 1.2));
  const long = context.estimateFinalExportPeakMemory(buffer(300), 24, 48000, mode);
  assert.ok(long.assemblyPeak > 260 * 1024 * 1024);
  assert.throws(() => context.validateFinalExportMemory(buffer(300), 24, 48000, mode),
    error => error.code === 'VM_FINAL_EXPORT_MEMORY_LIMIT');
  const upsample = context.estimateFinalExportPeakMemory(buffer(90, 44100), 24, 96000, mode);
  assert.ok(upsample.targetBytes > upsample.sourceBytes);
  assert.ok(upsample.encodingPeak > upsample.sourceBytes * 2 + upsample.wavBytes);
}

console.log('Final export memory regression PASS (iOS limits, normal/YouTube, long audio, upsampling)');
