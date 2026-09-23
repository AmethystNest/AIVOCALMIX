const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../src/audio/wav-codec.js'), 'utf8');
const context = vm.createContext({
  Blob, ArrayBuffer, DataView, Float32Array, Uint32Array,
  Math, Date, setTimeout, yieldToBrowser: async () => {}
});
vm.runInContext(code, context);

(async () => {
  const valid = [new Float32Array([0, 0.25, -0.5, 0.75])];
  const blob = await context.encodeWavBlobAsync(valid, 44100, 24);
  const bytes = new DataView(await blob.arrayBuffer());
  assert.equal(bytes.getUint32(24, true), 44100);
  assert.equal(bytes.getUint16(34, true), 24);
  assert.equal(blob.size, 44 + valid[0].length * 3);
  // Decode the exported PCM and compare against input within TPDF dither tolerance.
  const stereo = [new Float32Array([0, 0.25, -0.5, 0.75, -0.9]), new Float32Array([0.5, -0.25, 0.125, -0.75, 0])];
  for (const depth of [16, 24]) {
    const wav = await context.encodeWavBlobAsync(stereo, 48000, depth);
    const data = new DataView(await wav.arrayBuffer());
    const bytesPerSample = depth / 8;
    assert.equal(data.getUint16(22, true), 2);
    assert.equal(data.getUint32(28, true), 48000 * 2 * bytesPerSample);
    assert.equal(data.getUint32(40, true), stereo[0].length * 2 * bytesPerSample);
    for (let frame = 0; frame < stereo[0].length; frame++) {
      for (let ch = 0; ch < 2; ch++) {
        const pos = 44 + (frame * 2 + ch) * bytesPerSample;
        const raw = depth === 16 ? data.getInt16(pos, true) :
          ((data.getUint8(pos) | (data.getUint8(pos + 1) << 8) | (data.getUint8(pos + 2) << 16)) << 8) >> 8;
        const decoded = raw / (depth === 16 ? 32768 : 8388608);
        assert.ok(Math.abs(decoded - stereo[ch][frame]) <= (depth === 16 ? 2 / 32768 : 2 / 8388608),
          `PCM roundtrip mismatch: ${depth}bit frame=${frame} ch=${ch}`);
      }
    }
  }
  await assert.rejects(context.encodeWavBlobAsync([new Float32Array([0, NaN])], 44100, 16), /不正な音声値/);
  await assert.rejects(context.encodeWavBlobAsync([new Float32Array([0, Infinity])], 44100, 16), /不正な音声値/);
  await assert.rejects(context.encodeWavBlobAsync([new Float32Array([0, 1.1])], 44100, 16), /クリッピング/);
  await assert.rejects(context.encodeWavBlobAsync([new Float32Array([0]), new Float32Array([0, 0])], 44100, 16), /チャンネル長/);
  await assert.rejects(context.encodeWavBlobAsync([], 44100, 16), /チャンネル/);
  await assert.rejects(context.encodeWavBlobAsync([new Float32Array(0)], 44100, 16), /空/);
  await assert.rejects(context.encodeWavBlobAsync(valid, 44100, 32), /ビット深度/);
  await assert.rejects(context.encodeWavBlobAsync(valid, 0, 16), /サンプルレート/);
  await assert.rejects(context.encodeWavBlobAsync([{length: 0x80000000}], 44100, 24), /最大サイズ/);
  let cancelChecks = 0;
  await assert.rejects(context.encodeWavBlobAsync(valid, 44100, 16, null, () => ++cancelChecks === 1), e => e.code === 'VM_EXPORT_CANCELLED');
  console.log('WAV integrity regression PASS (16/24-bit stereo PCM roundtrip, headers, invalid input, clipping, cancellation, RIFF limit)');
})().catch(e => { console.error(e); process.exitCode = 1; });
