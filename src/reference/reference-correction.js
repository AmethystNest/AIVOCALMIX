// Applies a stored reference-matching correction to a song buffer. Used by the
// 補正を適用 button and by Export, which rebuilds the song from the stems and
// therefore has to apply the same correction again.
//
// correction: { version: 1, diffs, amount } (existing band EQ) or
//             { version: 2, match, amount } (src/reference/reference-match-v2.js)
// Returns { rendered, applied } where applied is the number of v1 bands used.
async function applyReferenceCorrection(source, correction) {
  if (correction.version === 2) {
    return { rendered: await applyReferenceMatchV2(source, correction.match, correction.amount), applied: 0 };
  }
  const sr = source.sampleRate;
  const amount = correction.amount;
  let applied = 0;
  // Moved unchanged from the btnApplyReference handler.
  const offlineCtx = new OfflineAudioContext(source.numberOfChannels, source.length, sr);

  // 以前はsource全体を別AudioBufferへcopyToChannelしていたため、
  // 長尺曲では入力PCMを丸ごと1コピー余分に保持していた。
  // AudioBufferはBufferSourceへ直接渡せるためコピーを廃止する。
  const src = offlineCtx.createBufferSource();
  src.buffer = source;

  let node = src;
  for (const d of correction.diffs) {
    // 極端な補正で破綻しないよう、1バンドあたり±6dBまでに制限する
    const gainDb = Math.max(-6, Math.min(6, d.diffDb * amount));
    if (Math.abs(gainDb) < 0.2) continue; // 誤差程度なら触らない
    const f = offlineCtx.createBiquadFilter();
    f.type = 'peaking'; f.frequency.value = d.centerHz; f.Q.value = 1.0; f.gain.value = gainDb;
    node.connect(f); node = f;
    applied++;
  }
  node.connect(offlineCtx.destination);
  src.start();
  return { rendered: await offlineCtx.startRendering(), applied };
}

// Working memory for one correction pass: the rendered result plus, for v2,
// the latency-trimmed copy. Throws before rendering when it would exceed the
// device's export memory limit (same guard as the apply button).
function validateReferenceCorrectionMemory(source, correction) {
  const sourceBytes = source.length * source.numberOfChannels * 4;
  const workingBytes = sourceBytes * (correction.version === 2 ? 3 : 2);
  const limit = getWavExportMemoryLimit();
  if (workingBytes > limit) {
    throw new Error(
      `リファレンス補正時の一時メモリが安全上限を超える見込みです ` +
      `(推定${formatBytes(workingBytes)} / 上限${formatBytes(limit)})。`
    );
  }
}
