// Fire Lit (Retsu) premaster: overall gain to -4.0 dBTP headroom without a
// final limiter. Moved verbatim from the main app script in index.html;
// loaded before it. Uses src/audio/*.js at call time.
async function prepareFireLitPremaster(buffer, ceilingDb = -4.0, shouldCancel) {
  if (!buffer) throw new Error('Premaster入力がありません');

  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('export cancelled');
    err.code = 'VM_EXPORT_CANCELLED';
    throw err;
  }

  // True Peakを測り、上限を超えている場合だけ曲全体を同じ量だけ下げる。
  // リミッターでピーク形状を変えず、Fire Lit側に渡すダイナミクスを保持する。
  const maxTruePeak = await measureTruePeakBuffer(buffer, shouldCancel);
  const ceilingLin = Math.pow(10, ceilingDb / 20);

  if (!(maxTruePeak > ceilingLin)) {
    return {
      buffer,
      measuredTruePeakDb: dbfs(maxTruePeak),
      finalTruePeakDb: dbfs(maxTruePeak),
      gainDb: 0,
      ceilingDb
    };
  }

  // 補間誤差の余白として0.02dBだけ安全側へ。
  const targetLin = Math.pow(10, (ceilingDb - 0.02) / 20);
  const gainLin = targetLin / Math.max(maxTruePeak, 1e-12);
  let totalGainDb = 20 * Math.log10(gainLin);
  let adjusted = await applyBufferGainInPlaceCooperative(buffer, totalGainDb, shouldCancel);

  // D158: 調整後もTrue Peakを再計測する。
  // 4x補間推定の丸めやチャンネル間差で上限を僅かに超えた場合だけ、
  // 追加の「全体ゲイン低下」で収める。リミッターは使わない。
  let finalTruePeak = await measureTruePeakBuffer(adjusted, shouldCancel);
  if (finalTruePeak > ceilingLin * 1.0005) {
    const verifyTargetLin = Math.pow(10, (ceilingDb - 0.03) / 20);
    const extraGainLin = verifyTargetLin / Math.max(finalTruePeak, 1e-12);
    const extraGainDb = 20 * Math.log10(extraGainLin);
    adjusted = await applyBufferGainInPlaceCooperative(adjusted, extraGainDb, shouldCancel);
    totalGainDb += extraGainDb;
    finalTruePeak = await measureTruePeakBuffer(adjusted, shouldCancel);
  }

  return {
    buffer: adjusted,
    measuredTruePeakDb: dbfs(maxTruePeak),
    finalTruePeakDb: dbfs(finalTruePeak),
    gainDb: totalGainDb,
    ceilingDb
  };
}
