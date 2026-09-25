// YouTube mastering for export (-14 LUFS target capped by true peak,
// -1.5 dBTP ceiling). Moved verbatim from the main app script in index.html;
// loaded before it. Uses src/audio/*.js and yieldToBrowser at call time.
// YouTube向け最終マスタリング。
// 目標はIntegrated -14 LUFS / True Peak -1.0 dBTP。
// MIXそのもののEQ/コンプ/FXは変えず、最終ラウドネスと天井だけを調整する。
async function masterForYouTube(buffer, statusEl, shouldCancel) {
  const targetLufs = -14.0;
  // Keep additional mastering limiting shallow: forcing -14 LUFS on an already
  // peak-limited mix can produce audible distortion despite a safe true peak.
  const ceilingDb = -1.5;
  const maxAdditionalLimitingDb = 1.0;
  const channels = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));

  if (statusEl) {
    statusEl.textContent = 'YouTube用マスタリング: LUFSを測定中...';
    statusEl.className = 'status-line busy';
  }
  await yieldToBrowser();

  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('export cancelled');
    err.code = 'VM_EXPORT_CANCELLED';
    throw err;
  }

  const before = await computeIntegratedLufsCooperative(channels, buffer.sampleRate, shouldCancel);
  if (!isFinite(before.lufs)) return await enforcePostResampleTruePeakCeiling(buffer, ceilingDb, shouldCancel).then(result => result.buffer);

  // 過度なブーストは避ける。通常の歌ってみたMIXならこの範囲で十分。
  let gainDb = targetLufs - before.lufs;
  gainDb = Math.max(-18, Math.min(10, gainDb));
  // Do not trade large amounts of transient reduction for an arbitrary LUFS
  // target. YouTube can normalize quieter masters at playback.
  const inputTruePeak = await measureTruePeakBuffer(buffer, shouldCancel);
  const inputTruePeakDb = dbfs(inputTruePeak);
  const maxSafeBoostDb = Math.max(0, ceilingDb - inputTruePeakDb + maxAdditionalLimitingDb);
  const loudnessLimited = gainDb > maxSafeBoostDb;
  gainDb = Math.min(gainDb, maxSafeBoostDb);

  if (statusEl) statusEl.textContent = `YouTube用マスタリング: ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}dB調整中...`;
  let gained = await applyBufferGainInPlaceCooperative(buffer, gainDb, shouldCancel);

  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('export cancelled');
    err.code = 'VM_EXPORT_CANCELLED';
    throw err;
  }

  if (statusEl) statusEl.textContent = 'YouTube用マスタリング: True Peak -1.5dBTPへ調整中...';
  // The full mix was already lookahead-limited at assembly. Avoid another
  // full-song limiter pass; correct only any remaining true-peak overshoot.
  let mastered = (await enforcePostResampleTruePeakCeiling(gained, ceilingDb, shouldCancel)).buffer;

  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('export cancelled');
    err.code = 'VM_EXPORT_CANCELLED';
    throw err;
  }

  // リミッター後の実LUFSを再確認し、音圧が高すぎる場合だけ安全側へ微調整。
  const afterChannels = [];
  for (let ch = 0; ch < mastered.numberOfChannels; ch++) afterChannels.push(mastered.getChannelData(ch));
  const after = await computeIntegratedLufsCooperative(afterChannels, mastered.sampleRate, shouldCancel);
  if (isFinite(after.lufs) && after.lufs > targetLufs + 0.15) {
    mastered = await applyBufferGainInPlaceCooperative(mastered, targetLufs - after.lufs, shouldCancel);
  }

  const finalChannels = [];
  for (let ch = 0; ch < mastered.numberOfChannels; ch++) finalChannels.push(mastered.getChannelData(ch));
  const finalLufs = (await computeIntegratedLufsCooperative(finalChannels, mastered.sampleRate, shouldCancel)).lufs;

  if (statusEl) {
    statusEl.textContent = isFinite(finalLufs)
      ? `YouTube用マスタリング完了: 約 ${finalLufs.toFixed(1)} LUFS / True Peak ≤ -1.5 dBTP${loudnessLimited ? '（音割れ防止のため音圧上昇を制限）' : ''}`
      : 'YouTube用マスタリング完了';
    statusEl.className = 'status-line';
  }
  return mastered;
}
