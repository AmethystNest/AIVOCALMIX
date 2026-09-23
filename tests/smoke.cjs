const path = require('path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright')); }
const { chromium } = playwright;
const fs = require('fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';

function wav(frequency) {
  const rate = 44100, frames = rate * 3;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 2);
  }
  return data;
}

function pcm16WavSamples(output) {
  assert.equal(output.toString('ascii', 0, 4), 'RIFF');
  assert.equal(output.toString('ascii', 8, 12), 'WAVE');
  let offset = 12, format, data;
  while (offset + 8 <= output.length) {
    const id = output.toString('ascii', offset, offset + 4);
    const length = output.readUInt32LE(offset + 4);
    if (offset + 8 + length > output.length) throw new Error('Invalid WAV chunk length');
    if (id === 'fmt ') format = output.subarray(offset + 8, offset + 8 + length);
    if (id === 'data') data = output.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  assert.ok(format && data, 'WAV fmt/data chunks missing');
  assert.equal(format.readUInt16LE(0), 1, 'Expected PCM WAV');
  assert.equal(format.readUInt16LE(14), 16, 'Expected 16-bit WAV');
  assert.ok([44100, 48000].includes(format.readUInt32LE(4)), 'Unexpected WAV sample rate');
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { samples, channels: format.readUInt16LE(2), sampleRate: format.readUInt32LE(4) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { console.log('dialog', dialog.message()); await dialog.accept(); });
  try {
    await page.goto(baseUrl);
    console.log('initial', await page.title(), 'screens', await page.locator('.tab-btn').count());
    for (const screen of ['upload', 'analysis', 'mix', 'preview', 'fx', 'export', 'home']) {
      await page.locator(`.tab-btn[data-screen="${screen}"]`).click();
      console.log('navigation', screen, await page.locator('body').getAttribute('data-screen'));
    }
    await page.locator('.tab-btn[data-screen="upload"]').click();
    await page.locator('#fileVocal').setInputFiles({ name: 'vocal.wav', mimeType: 'audio/wav', buffer: wav(440) });
    await page.locator('#fileInst').setInputFiles({ name: 'inst.wav', mimeType: 'audio/wav', buffer: wav(220) });
    await page.waitForFunction(() => !document.querySelector('#btnAnalyze').disabled, null, { timeout: 30000 });
    console.log('upload ready');
    await page.locator('#btnAnalyze').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'analysis', null, { timeout: 120000 });
    console.log('analyzed');
    await page.locator('.tab-btn[data-screen="mix"]').click();
    await page.locator('#btnRenderMix').click();
    await page.waitForFunction(() => !document.querySelector('#btnDownloadMix').disabled, null, { timeout: 120000 });
    console.log('mix rendered');
    const previewReference = await page.evaluate(() => {
      const buffer = getLatestSongBuffer();
      if (!buffer) throw new Error('Preview MIX buffer missing');
      return {
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
        samples: Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
          Array.from(buffer.getChannelData(ch)))
      };
    });
    await page.locator('.tab-btn[data-screen="preview"]').click();
    await page.locator('#btnPlay').click();
    console.log('preview clicked');
    await page.locator('#btnStop').click();
    await page.locator('.tab-btn[data-screen="export"]').click();
    // Avoid conflating the waveform comparison with the separate resampler
    // regression: use the actual rendered Preview buffer sample rate.
    await page.locator('#exportSampleRate').selectOption(String(previewReference.sampleRate));
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#btnExport').click();
    try {
      const download = await downloadPromise;
      console.log('export', download.suggestedFilename());
      const output = fs.readFileSync(await download.path());
      if (output.toString('ascii', 0, 4) !== 'RIFF' || output.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Export is not a WAV file');
      }
      let peak = 0;
      for (let i = 44; i + 1 < output.length; i += 2) peak = Math.max(peak, Math.abs(output.readInt16LE(i)));
      if (peak === 0 || peak >= 32767) throw new Error(`Unexpected WAV peak: ${peak}`);
      console.log('wav bytes', output.length, 'pcm peak', peak);
      const decoded = pcm16WavSamples(output);
      assert.equal(decoded.channels, previewReference.channels, 'Preview/Export channel count mismatch');
      assert.equal(previewReference.sampleRate, 48000, 'Unexpected rendered Preview sample rate');
      // Export may apply the final True Peak ceiling. Compare the waveform after
      // fitting a single gain rather than expecting bit-for-bit identity.
      const count = previewReference.samples[0].length;
      assert.equal(decoded.samples.length / decoded.channels, count, 'Preview/Export duration mismatch');
      for (let ch = 0; ch < decoded.channels; ch++) {
        let dot = 0, energy = 0, residual = 0;
        for (let i = 0; i < count; i++) {
          const x = previewReference.samples[ch][i], y = decoded.samples[i * decoded.channels + ch];
          dot += x * y;
          energy += x * x;
        }
        assert.ok(energy > 1e-5, `Preview channel ${ch} is silent`);
        const gain = dot / energy;
        for (let i = 0; i < count; i++) {
          const x = previewReference.samples[ch][i], y = decoded.samples[i * decoded.channels + ch];
          residual += (y - gain * x) ** 2;
        }
        const normalizedError = Math.sqrt(residual / energy);
        console.log('full-song preview/export waveform', 'channel', ch, 'gain', gain.toFixed(4), 'normalized error', normalizedError.toFixed(5));
        assert.ok(gain > 0.01 && normalizedError < 0.1, `Preview/Export channel ${ch} waveform mismatch`);
      }
      // Also exercise the default 44.1 kHz resampling route, which is distinct
      // from the 48 kHz waveform identity check above.
      await page.locator('#exportSampleRate').selectOption('44100');
      const resampledDownload = page.waitForEvent('download', { timeout: 60000 });
      await page.locator('#btnExport').click();
      const resampled = pcm16WavSamples(fs.readFileSync(await (await resampledDownload).path()));
      assert.equal(resampled.sampleRate, 44100, '44.1 kHz resampling was not applied');
      assert.equal(resampled.channels, decoded.channels, 'Resampling changed channel count');
      const expectedFrames = Math.round(count * 44100 / previewReference.sampleRate);
      const actualFrames = resampled.samples.length / resampled.channels;
      assert.ok(Math.abs(actualFrames - expectedFrames) <= 2, 'Resampling changed song duration');
      let resampledPeak = 0;
      for (const sample of resampled.samples) resampledPeak = Math.max(resampledPeak, Math.abs(sample));
      assert.ok(resampledPeak > 0.01 && resampledPeak < 1, 'Resampled WAV is silent or clipped');
      console.log('44.1 kHz resample', actualFrames, 'frames, peak', resampledPeak.toFixed(4));
      // Exercise the real FX button and ensure its rendered result reaches Export.
      await page.locator('.tab-btn[data-screen="fx"]').click();
      await page.locator('details').filter({ has: page.locator('#fxReverbMix') }).locator('summary').click();
      await page.locator('#fxReverbMix').fill('0.65');
      await page.locator('#fxReverbMix').dispatchEvent('change');
      await page.locator('#btnRenderFx').click();
      await page.waitForFunction(() => state.fxSongBuffer &&
        state.fxRenderedRevision === state.fxConfigRevision &&
        !document.querySelector('#btnRenderFx').disabled, null, { timeout: 120000 });
      const fxReference = await page.evaluate(() => {
        const b = getLatestSongBuffer();
        if (b !== state.fxSongBuffer) throw new Error('FX buffer is not used by Preview');
        return { sampleRate: b.sampleRate, channels: b.numberOfChannels,
          samples: Array.from({ length: b.numberOfChannels }, (_, ch) => Array.from(b.getChannelData(ch))) };
      });
      assert.equal(fxReference.sampleRate, previewReference.sampleRate);
      let fxDifference = 0, baselineEnergy = 0;
      for (let i = 0; i < previewReference.samples[0].length; i++) {
        const original = previewReference.samples[0][i];
        const changed = fxReference.samples[0][i] || 0;
        fxDifference += (changed - original) ** 2;
        baselineEnergy += original ** 2;
      }
      assert.ok(fxDifference / baselineEnergy > 0.00001, 'FX did not change the rendered waveform');
      await page.locator('.tab-btn[data-screen="export"]').click();
      await page.locator('#exportSampleRate').selectOption(String(fxReference.sampleRate));
      const fxDownload = page.waitForEvent('download', { timeout: 60000 });
      await page.locator('#btnExport').click();
      const fxWav = pcm16WavSamples(fs.readFileSync(await (await fxDownload).path()));
      assert.equal(fxWav.channels, fxReference.channels);
      const fxFrames = fxWav.samples.length / fxWav.channels;
      assert.equal(fxFrames, fxReference.samples[0].length, 'FX Preview/Export duration mismatch');
      for (let ch = 0; ch < fxWav.channels; ch++) {
        let dot = 0, energy = 0, residual = 0;
        for (let i = 0; i < fxFrames; i++) {
          const x = fxReference.samples[ch][i], y = fxWav.samples[i * fxWav.channels + ch];
          dot += x * y;
          energy += x * x;
        }
        const gain = dot / energy;
        for (let i = 0; i < fxFrames; i++) {
          const x = fxReference.samples[ch][i], y = fxWav.samples[i * fxWav.channels + ch];
          residual += (y - gain * x) ** 2;
        }
        const error = Math.sqrt(residual / energy);
        console.log('FX Preview/Export', ch, 'gain', gain.toFixed(4), 'error', error.toFixed(5));
        assert.ok(gain > 0.01 && error < 0.1, `FX Preview/Export mismatch on channel ${ch}`);
      }
      // YouTube mastering must also export the FX result, at the resampled rate.
      await page.locator('#exportFinishMode').selectOption('youtube');
      await page.locator('#exportSampleRate').selectOption('44100');
      const youtubeDownload = page.waitForEvent('download', { timeout: 90000 });
      await page.locator('#btnExport').click();
      const youtubeFile = await youtubeDownload;
      assert.match(youtubeFile.suggestedFilename(), /youtube_master.*44100hz\.wav$/);
      const youtubeWav = pcm16WavSamples(fs.readFileSync(await youtubeFile.path()));
      assert.equal(youtubeWav.sampleRate, 44100);
      assert.equal(youtubeWav.channels, fxReference.channels);
      assert.ok(Math.abs(youtubeWav.samples.length / youtubeWav.channels -
        fxFrames * 44100 / fxReference.sampleRate) <= 2, 'YouTube export duration mismatch');
      let youtubePeak = 0;
      for (const sample of youtubeWav.samples) youtubePeak = Math.max(youtubePeak, Math.abs(sample));
      assert.ok(youtubePeak > 0.01 && youtubePeak <= 10 ** (-1.5 / 20) + 0.0001,
        `YouTube exported PCM exceeds -1.5 dBFS sample peak: ${youtubePeak}`);
      console.log('YouTube FX 44.1 kHz export peak', youtubePeak.toFixed(5));
      // Measure the actual decoded, resampled WAV rather than the pre-export buffer.
      // The app's 4x interpolated true-peak meter catches inter-sample overshoot.
      const exportedTruePeak = await page.evaluate(async ({ samples, channels }) => {
        const peaks = [];
        for (let ch = 0; ch < channels; ch++) {
          const channel = new Float32Array(samples.length / channels);
          for (let i = 0; i < channel.length; i++) channel[i] = samples[i * channels + ch];
          peaks.push(await estimateTruePeakCooperative(channel, 4, 8));
        }
        return Math.max(...peaks);
      }, { samples: Array.from(youtubeWav.samples), channels: youtubeWav.channels });
      assert.ok(Number.isFinite(exportedTruePeak) && exportedTruePeak <= 10 ** (-1.5 / 20) + 0.0002,
        `YouTube decoded WAV exceeds -1.5 dBTP: ${exportedTruePeak}`);
      console.log('YouTube FX 44.1 kHz decoded true peak', (20 * Math.log10(exportedTruePeak)).toFixed(3), 'dBTP');
      // Fire Lit premaster follows a separate unmastered assembly path.
      // Exercise the real button after FX rendering and inspect the saved PCM.
      await page.locator('#exportFinishMode').selectOption('normal');
      const premasterDownload = page.waitForEvent('download', { timeout: 90000 });
      await page.locator('#btnExportMaster').click();
      const premasterFile = await premasterDownload;
      assert.match(premasterFile.suggestedFilename(), /retsu_premaster.*44100hz\.wav$/);
      const premasterWav = pcm16WavSamples(fs.readFileSync(await premasterFile.path()));
      assert.equal(premasterWav.sampleRate, 44100);
      assert.equal(premasterWav.channels, fxReference.channels);
      assert.ok(Math.abs(premasterWav.samples.length / premasterWav.channels -
        fxFrames * 44100 / fxReference.sampleRate) <= 2, 'Premaster export duration mismatch');
      let premasterPeak = 0;
      for (const sample of premasterWav.samples) premasterPeak = Math.max(premasterPeak, Math.abs(sample));
      assert.ok(premasterPeak > 0.01 && premasterPeak < 1, 'Premaster is silent or clipped');
      const premasterTruePeak = await page.evaluate(async ({ samples, channels }) => {
        let peak = 0;
        for (let ch = 0; ch < channels; ch++) {
          const channel = new Float32Array(samples.length / channels);
          for (let i = 0; i < channel.length; i++) channel[i] = samples[i * channels + ch];
          peak = Math.max(peak, await estimateTruePeakCooperative(channel, 4, 8));
        }
        return peak;
      }, { samples: Array.from(premasterWav.samples), channels: premasterWav.channels });
      assert.ok(Number.isFinite(premasterTruePeak) && premasterTruePeak <= 10 ** (-4 / 20) + 0.0002,
        `Fire Lit decoded WAV exceeds -4 dBTP: ${premasterTruePeak}`);
      console.log('Fire Lit FX 44.1 kHz decoded true peak', (20 * Math.log10(premasterTruePeak)).toFixed(3), 'dBTP');
      // Changing an FX parameter must invalidate the rendered FX so Preview
      // cannot silently keep playing an obsolete version of the mix.
      await page.locator('.tab-btn[data-screen="fx"]').click();
      await page.locator('#fxReverbMix').fill('0.15');
      await page.locator('#fxReverbMix').dispatchEvent('change');
      const invalidated = await page.evaluate(() => ({
        stale: state.fxRenderedRevision !== state.fxConfigRevision,
        latestIsOldFx: getLatestSongBuffer() === state.fxSongBuffer && !!state.fxSongBuffer,
        latestExists: !!getLatestSongBuffer()
      }));
      assert.ok(invalidated.stale && !invalidated.latestIsOldFx && invalidated.latestExists,
        'Changing FX settings left obsolete FX active in Preview');
    } catch (error) {
      console.log('export status', await page.locator('#exportStatus').textContent());
      console.log('export button disabled', await page.locator('#btnExport').isDisabled());
      console.log('page errors', JSON.stringify(errors));
      console.log('state', await page.evaluate(() => ({screen: document.body.dataset.screen, exporting: state.isExporting, mixed: !!state.mixedSongBuffer, final: !!state.finalBuffer})));
      throw error;
    }
    console.log('errors', JSON.stringify(errors));
    assert.deepEqual(errors, [], 'Browser emitted uncaught errors during online smoke');
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
    await page.context().setOffline(true);
    await page.reload();
    const offlineCodec = await page.evaluate(() => typeof encodeWavBlobAsync);
    console.log('offline', await page.title(), offlineCodec);
    console.log('offline errors', JSON.stringify(errors));
    assert.equal(offlineCodec, 'function', 'Offline WAV encoder unavailable');
    assert.deepEqual(errors, [], 'Browser emitted uncaught errors during offline smoke');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
