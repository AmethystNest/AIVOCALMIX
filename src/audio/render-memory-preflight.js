function estimateHarmonyRenderPeakMemory(buffer, targetSr) {
  if (!buffer) return { peakBytes: 0, monoBytes: 0, targetFrames: 0 };

  const sr = Number(targetSr) > 0 ? Number(targetSr) : buffer.sampleRate;
  const targetFrames = Math.max(1, Math.ceil(buffer.duration * sr));
  const monoBytes = targetFrames * 4;

  // D285: resample/timing補正/mono処理/OfflineAudio source/stereo widenの
  // 一時領域を保守的に見積もる。D281でtrim専用mono配列は削除済み。
  const peakBytes = Math.ceil(monoBytes * 4.5 * 1.15);
  return { peakBytes, monoBytes, targetFrames, sampleRate: sr };
}

function validateHarmonyRenderMemory(buffer, targetSr) {
  const estimate = estimateHarmonyRenderPeakMemory(buffer, targetSr);
  const limit = getWavExportMemoryLimit();

  if (estimate.peakBytes > limit) {
    const deviceHint = VM_RESOURCE_POLICY && VM_RESOURCE_POLICY.deviceMemoryGB
      ? ` / 端末メモリ目安${VM_RESOURCE_POLICY.deviceMemoryGB}GB`
      : '';
    const err = new Error(
      `Harmony処理の一時メモリが安全上限を超える見込みです ` +
      `(推定${formatBytes(estimate.peakBytes)} / 上限${formatBytes(limit)}${deviceHint})。` +
      `Harmony音源を短くするか、Sample Rateを下げて再度お試しください`
    );
    err.code = 'VM_HARMONY_RENDER_MEMORY_LIMIT';
    err.estimate = estimate;
    err.limit = limit;
    throw err;
  }
  return estimate;
}

function estimateFinalExportPeakMemory(buffer, bitDepth, targetSampleRate, finishMode) {
  if (!buffer) return { peakBytes: 0 };

  const channels = Math.max(2, buffer.numberOfChannels || 1);
  const sourceFrames = Math.max(1, buffer.length || Math.ceil(buffer.duration * buffer.sampleRate));
  const targetSr = Number(targetSampleRate) > 0 ? Number(targetSampleRate) : buffer.sampleRate;
  const targetFrames = Math.max(1, Math.ceil(buffer.duration * targetSr));
  const bytesPerSample = Number(bitDepth) === 24 ? 3 : 2;

  const sourceBytes = sourceFrames * channels * 4;
  const targetBytes = targetFrames * channels * 4;
  const wavBytes = 44 + targetFrames * channels * bytesPerSample;

  // The already-rendered mix stays in state while assembleFullSong builds the
  // instrumental mix and the limiter output. OfflineAudioContext and source
  // copies can coexist until the browser collects them. The limiter also
  // allocates one full-length Float32 window per channel.
  const assemblyPeak = sourceBytes * 5;
  // The retained mix and assembled result can both survive the sample-rate
  // conversion and chunked WAV encoding; the Blob can retain its PCM parts.
  // YouTube applies gain in place, so it needs no additional full-song copy.
  const encodingPeak = sourceBytes * 2 + targetBytes + wavBytes;
  const peakBytes = Math.ceil(Math.max(assemblyPeak, encodingPeak) * 1.20);

  return { peakBytes, assemblyPeak, encodingPeak, sourceBytes, targetBytes, wavBytes, targetFrames, channels, sampleRate: targetSr };
}

function validateFinalExportMemory(buffer, bitDepth, targetSampleRate, finishMode) {
  const estimate = estimateFinalExportPeakMemory(buffer, bitDepth, targetSampleRate, finishMode);
  const limit = getWavExportMemoryLimit();
  if (estimate.peakBytes > limit) {
    const deviceHint = VM_RESOURCE_POLICY && VM_RESOURCE_POLICY.deviceMemoryGB
      ? ` / 端末メモリ目安${VM_RESOURCE_POLICY.deviceMemoryGB}GB`
      : '';
    const err = new Error(
      `最終書き出し処理の一時メモリが安全上限を超える見込みです ` +
      `(推定${formatBytes(estimate.peakBytes)} / 上限${formatBytes(limit)}${deviceHint})。` +
      `Sample Rateを下げるか、音源を短くして再度お試しください`
    );
    err.code = 'VM_FINAL_EXPORT_MEMORY_LIMIT';
    err.estimate = estimate;
    err.limit = limit;
    throw err;
  }
  return estimate;
}
