const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('async function masterForYouTube(');
const end = html.indexOf('// True Peak計測とゲイン適用', start);
assert.ok(start > 0 && end > start);
assert.match(html.slice(start, end), /True Peak -1\.5dBTPへ調整中/);
const gains = [];
const context = {
  yieldToBrowser: async () => {},
  dbfs: value => 20 * Math.log10(Math.max(value, 1e-12)),
  computeIntegratedLufsCooperative: async channels => ({ lufs: -20 + 20 * Math.log10(channels[0][0] / context.originalPeak) }),
  measureTruePeakBuffer: async buffer => Math.max(...buffer.getChannelData(0).map(Math.abs)),
  applyBufferGainInPlaceCooperative: async (buffer, gainDb) => {
    gains.push(gainDb);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] *= 10 ** (gainDb / 20);
    return buffer;
  },
  enforcePostResampleTruePeakCeiling: async (buffer, ceilingDb) => {
    const peak = Math.max(...buffer.getChannelData(0).map(Math.abs));
    const limit = 10 ** (ceilingDb / 20);
    if (peak > limit) await context.applyBufferGainInPlaceCooperative(buffer, 20 * Math.log10(limit / peak));
    return { buffer };
  }
};
vm.runInNewContext(html.slice(start, end), context);
async function test(peak, expectedBoostLimit) {
  gains.length = 0;
  context.originalPeak = peak;
  const data = new Float32Array([peak, -peak / 2]);
  const buffer = { sampleRate: 44100, numberOfChannels: 1, getChannelData: () => data };
  const status = { textContent: '', className: '' };
  await context.masterForYouTube(buffer, status, () => false);
  assert.ok(gains[0] <= expectedBoostLimit + 0.02, `excessive gain: ${gains[0]}`);
  assert.ok(Math.max(...data.map(Math.abs)) <= 10 ** (-1.5 / 20) + 1e-6);
  return status.textContent;
}
(async () => {
  const loud = await test(10 ** (-1 / 20), 1);
  assert.match(loud, /音割れ防止/);
  const quiet = await test(10 ** (-12 / 20), 6.01);
  assert.doesNotMatch(quiet, /音割れ防止/);
  console.log('YouTube mastering regression PASS (loud/quiet inputs, gain cap, peak ceiling)');
})().catch(err => { console.error(err); process.exitCode = 1; });
