// Gated loudness, vocal/instrumental combine and limiter helpers (gatedRmsDb* ..
// checkMonoCompatibility). Moved verbatim from index.html's #app-script; loaded
// right before it. They read state/DOM only when called.

// 無音区間(イントロ等)に埋もれた「歌っている区間だけの音量」を測るためのゲート付きRMS。
// 実際に見つかったバグ: 全体平均RMSで比較すると、ボーカルにイントロ等の無音区間が
// あるだけで平均が実態より低く出てしまい、「歌っている間は明らかに大きい」のに
// 補正が働かないケースがあった(検証: 30%無音のテスト信号で、全体平均diff=2.9dB
// <-- 閾値+3dB以内で見逃されていたが、実際の歌唱区間だけのdiffは4.4dBだった)。
function gatedRmsDb(samples, sr, frameMs) {
  frameMs = frameMs || 100;
  const frameSize = Math.max(1, Math.round(sr * frameMs / 1000));
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gateThreshold = peak * Math.pow(10, -40 / 20); // ピークから-40dB以下は無音とみなして除外
  let sumSq = 0, count = 0;
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    let frameSum = 0;
    for (let i = start; i < start + frameSize; i++) frameSum += samples[i] * samples[i];
    const frameRms = Math.sqrt(frameSum / frameSize);
    if (frameRms > gateThreshold) { sumSq += frameSum; count += frameSize; }
  }
  if (count === 0) return dbfs(rmsOf(samples, 0, samples.length)); // 全部無音扱いなら通常計算にフォールバック
  return dbfs(Math.sqrt(sumSq / count));
}

// Vocal処理チェーン全体が終わった後の「実測レベル」を基準に、伴奏に対する
// 音量差を最終補正する。理由: 以前ハモリで見つけたのと同じ問題が起きていた
// ——decideChain内のgainステップは処理の途中で計算された固定値のため、
// その後のコンプ/サチュレーション/リバーブ/リミッターで実際のレベルが
// また変化してしまい、狙った音量差が崩れることがあった。
// さらに、無音区間に惑わされないようゲート付きRMSで比較するよう修正済み(上記参照)。
//
// manualTrimDb: 自動補正だけで不十分な場合の手動オーバーライド(大/中/小)。
// 自動補正の"後"に単純加算する(自動判断の仕組みは変えず、最後に一枚足すだけ)。
/* 最終的な音量バランスの自動最適化。
   以前は「許容範囲(-8dB〜-2dB)の中に収まっていれば何もしない」方式だったため、
   素材によって最大6dBもばらつき、「どうしてもVocalが大きすぎる時がある」原因に
   なっていた。また、Vocal単体と伴奏だけを比べておりHarmonyを足した後の
   合計音量を考慮していなかったため、ハモリを重ねるとさらに大きくなっていた。
   ここでは「Vocal+Harmonyの合計」と伴奏を比べ、常に目標値ぴったりへ合わせる。
   これでどのプリセットの組み合わせでも一貫したバランスになる
   (手動での微調整はPreviewタブの最終音量調整で従来通り行える)。 */

function gatedRmsDbFromAudioBuffer(buffer, sr, frameMs) {
  if (!buffer) return -Infinity;

  frameMs = frameMs || 100;
  sr = sr || buffer.sampleRate;
  const frameSize = Math.max(1, Math.round(sr * frameMs / 1000));
  const a = buffer.getChannelData(0);
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const length = buffer.length;

  const sampleAt = b
    ? (i) => (a[i] + b[i]) / 2
    : (i) => a[i];

  let peak = 0;
  for (let i = 0; i < length; i++) {
    const v = Math.abs(sampleAt(i));
    if (v > peak) peak = v;
  }

  const gateThreshold = peak * Math.pow(10, -40 / 20);
  let sumSq = 0;
  let count = 0;

  for (let start = 0; start + frameSize <= length; start += frameSize) {
    let frameSum = 0;
    for (let i = start; i < start + frameSize; i++) {
      const s = sampleAt(i);
      frameSum += s * s;
    }
    const frameRms = Math.sqrt(frameSum / frameSize);
    if (frameRms > gateThreshold) {
      sumSq += frameSum;
      count += frameSize;
    }
  }

  if (count === 0) {
    let fallbackSum = 0;
    for (let i = 0; i < length; i++) {
      const s = sampleAt(i);
      fallbackSum += s * s;
    }
    return dbfs(Math.sqrt(fallbackSum / Math.max(1, length)));
  }

  return dbfs(Math.sqrt(sumSq / count));
}


async function gatedRmsDbCooperative(samples, sr, frameMs) {
  frameMs = frameMs || 100;
  const frameSize = Math.max(1, Math.round(sr * frameMs / 1000));
  const n = samples.length;
  const chunkSize = 131072;

  let peak = 0;
  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(n, start + chunkSize);
    for (let i = start; i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    if (end < n) await yieldToBrowser();
  }

  const gateThreshold = peak * Math.pow(10, -40 / 20);
  let sumSq = 0, count = 0;

  let frameCounter = 0;
  for (let start = 0; start + frameSize <= n; start += frameSize) {
    let frameSum = 0;
    for (let i = start; i < start + frameSize; i++) frameSum += samples[i] * samples[i];
    const frameRms = Math.sqrt(frameSum / frameSize);
    if (frameRms > gateThreshold) {
      sumSq += frameSum;
      count += frameSize;
    }
    frameCounter++;
    if ((frameCounter & frameYieldMask) === 0) await yieldToBrowser();
  }

  if (count === 0) {
    let fallbackSum = 0;
    for (let start = 0; start < n; start += chunkSize) {
      const end = Math.min(n, start + chunkSize);
      for (let i = start; i < end; i++) fallbackSum += samples[i] * samples[i];
      if (end < n) await yieldToBrowser();
    }
    return dbfs(Math.sqrt(fallbackSum / Math.max(1, n)));
  }
  return dbfs(Math.sqrt(sumSq / count));
}

async function gatedRmsDbFromAudioBufferCooperative(buffer, sr, frameMs) {
  if (!buffer) return -Infinity;

  frameMs = frameMs || 100;
  sr = sr || buffer.sampleRate;
  const frameSize = Math.max(1, Math.round(sr * frameMs / 1000));
  const a = buffer.getChannelData(0);
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const length = buffer.length;

  // D414: Vocal/Inst/Harmonyのgated RMS全走査は、iPhoneだけyield間隔を半分にする。
  // 計算対象sample・gate・RMS式は変えず、SafariのUI応答性だけ改善する。
  const isiOSCoop = !!(typeof VM_PLATFORM !== 'undefined' && VM_PLATFORM && VM_PLATFORM.isiOS);
  const chunkSize = isiOSCoop ? 65536 : 131072;
  const frameYieldMask = isiOSCoop ? 15 : 31;

  let peak = 0;
  for (let start = 0; start < length; start += chunkSize) {
    const end = Math.min(length, start + chunkSize);
    for (let i = start; i < end; i++) {
      const s = b ? (a[i] + b[i]) / 2 : a[i];
      const v = Math.abs(s);
      if (v > peak) peak = v;
    }
    if (end < length) await yieldToBrowser();
  }

  const gateThreshold = peak * Math.pow(10, -40 / 20);
  let sumSq = 0, count = 0;
  let frameCounter = 0;

  for (let start = 0; start + frameSize <= length; start += frameSize) {
    let frameSum = 0;
    for (let i = start; i < start + frameSize; i++) {
      const s = b ? (a[i] + b[i]) / 2 : a[i];
      frameSum += s * s;
    }
    const frameRms = Math.sqrt(frameSum / frameSize);
    if (frameRms > gateThreshold) {
      sumSq += frameSum;
      count += frameSize;
    }
    frameCounter++;
    if ((frameCounter & 31) === 0) await yieldToBrowser();
  }

  if (count === 0) {
    let fallbackSum = 0;
    for (let start = 0; start < length; start += chunkSize) {
      const end = Math.min(length, start + chunkSize);
      for (let i = start; i < end; i++) {
        const s = b ? (a[i] + b[i]) / 2 : a[i];
        fallbackSum += s * s;
      }
      if (end < length) await yieldToBrowser();
    }
    return dbfs(Math.sqrt(fallbackSum / Math.max(1, length)));
  }

  return dbfs(Math.sqrt(sumSq / count));
}

async function finalizeVocalLevelAgainstInstrumental(vocalBuffer, sr, manualTrimDb) {
  if (!state.instBuffer) return vocalBuffer;
  // D405: Vocal/InstrumentalともAudioBufferを直接走査する。
  // gated RMSの判定式は既存のまま。解析専用mono配列を常駐させる必要をなくす。
  const vocalRms = await gatedRmsDbFromAudioBufferCooperative(vocalBuffer, sr);
  const instRms = await gatedRmsDbFromAudioBufferCooperative(state.instBuffer, sr);

  // Harmonyが既にレンダリング済みなら、その音量も合算して「歌全体」として扱う。
  // (ハモリは後段でVocalに足されるため、Vocal単体だけで合わせると
  //  最終的な歌の総量が目標より大きくなってしまう)
  let vocalSideRms = vocalRms;
  const harmonyBuf = state.harmonyOnlyFxBuffer || state.harmonyOnlyBuffer;
  if (harmonyBuf) {
    const harmonyRms = await gatedRmsDbFromAudioBufferCooperative(harmonyBuf, sr);
    // dB同士は単純に足せないため、一度リニアのパワーに戻して合算する
    const vPow = Math.pow(10, vocalRms / 10), hPow = Math.pow(10, harmonyRms / 10);
    vocalSideRms = 10 * Math.log10(vPow + hPow);
  }

  const diff = vocalSideRms - instRms;
  const bl = (state.chainRules && state.chainRules.blend) || DEFAULT_MIX_RULES.blend;
  const target = bl.targetVocalToInstDb != null ? bl.targetVocalToInstDb : -4.0;
  const maxAdjust = bl.maxAutoAdjustDb != null ? bl.maxAutoAdjustDb : 12;
  // 目標との差をそのまま埋める(範囲内なら放置、ではなく常に目標へ合わせる)
  let autoTrimDb = target - diff;
  autoTrimDb = Math.max(-maxAdjust, Math.min(maxAdjust, autoTrimDb));

  let trimDb = autoTrimDb + (manualTrimDb || 0);
  if (Math.abs(trimDb) < 0.05) return vocalBuffer; // 誤差程度なら無駄な再生成を避ける
  const gainLin = Math.pow(10, trimDb / 20);
  const out = audioCtx.createBuffer(vocalBuffer.numberOfChannels, vocalBuffer.length, sr);
  for (let ch = 0; ch < vocalBuffer.numberOfChannels; ch++) {
    const src = vocalBuffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * gainLin;
      if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
    }
  }
  console.log('[Vocal最終レベル補正(目標値方式)]', {
    歌側RMS: vocalSideRms.toFixed(1), 伴奏RMS: instRms.toFixed(1),
    現在の差: diff.toFixed(1), 目標: target, 自動補正: autoTrimDb.toFixed(1),
    手動: (manualTrimDb || 0), 合計: trimDb.toFixed(1),
    Harmony合算: !!harmonyBuf,
  });
  // ゲイン適用後のクリップ防止(中間段なので、実際に天井を超えた時だけ働く保険)
  return await applySafetyLimiterIfNeeded(out, -0.1);
}

async function combineWithInstrumental(buf) {
  if (!state.instBuffer) return buf; // 伴奏未アップロードならそのまま
  const sr = buf.sampleRate;
  const instResampled = await resampleIfNeeded(state.instBuffer, sr);
  let instTreated = await applyInstrumentalTreatment(instResampled, sr);

  // マスキングが疑われる場合、decideChainが'ducking'ステップを出している。
  // ボーカル(+ハモリ)側のエンベロープを使って伴奏を動的にダッキングする
  // (WebAudioのDynamicsCompressorNodeは外部サイドチェイン入力を持たないため、
  // サンプル配列への手動ゲイン適用で実現している)。
  const duckingStep = state.chain && state.chain.find((s) => s.name === 'ducking');
  if (duckingStep) {
    // D113: サイドチェイン用にVocal全曲monoコピーを作らず直接解析。
    const gainCurve = await computeDuckingGainCurveFromAudioBuffer(buf, sr, duckingStep.params.amount);
    const numCh = instTreated.numberOfChannels;
    const ducked = audioCtx.createBuffer(numCh, instTreated.length, sr);
    for (let ch = 0; ch < numCh; ch++) {
      const src = instTreated.getChannelData(ch);
      const dst = ducked.getChannelData(ch);
      const n = Math.min(src.length, gainCurve.length);
      for (let i = 0; i < n; i++) {
        dst[i] = src[i] * gainCurve[i];
        if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
      }
      for (let i = n; i < src.length; i++) dst[i] = src[i];
    }
    instTreated = ducked;
  }

  // セクション別自動バランス: 伴奏が密な区間(サビらしい箇所)でボーカルを
  // 少し前に出し、薄い区間(Aメロらしい箇所)で抑える。伴奏のエネルギーが
  // 必要なため、ここ(伴奏と合わさる直前)でボーカル側にゲインカーブを掛ける。
  const sectionBalanceStep = state.chain && state.chain.find((s) => s.name === 'sectionBalance');
  let vocalSide = buf;
  if (sectionBalanceStep) {
    // D114: 伴奏全体のmonoコピーを作らず、AudioBufferから直接区間エネルギーを測定。
    const gainCurve = await computeSectionBalanceGainCurveFromAudioBuffer(instTreated, sr, sectionBalanceStep.params);
    const numCh = buf.numberOfChannels;
    const adjusted = audioCtx.createBuffer(numCh, buf.length, sr);
    for (let ch = 0; ch < numCh; ch++) {
      const src = buf.getChannelData(ch);
      const dst = adjusted.getChannelData(ch);
      const n = Math.min(src.length, gainCurve.length);
      for (let i = 0; i < n; i++) {
        dst[i] = src[i] * gainCurve[i];
        if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
      }
      for (let i = n; i < src.length; i++) dst[i] = src[i];
    }
    vocalSide = adjusted;
  }

  return await mixTwoBuffers(vocalSide, instTreated, sr);
}

// 実際にユーザーが聴く/書き出す「曲としてのMIX」= ボーカル側の処理結果 + 伴奏(ハモリなし)。
// 重要なバグ修正(過去に発見): 以前はボーカル側のチェーン(EQ/コンプ/リバーブ)だけを処理していて、
// 伴奏(Instrumental)は解析にしか使われておらず、最終出力に一度も合成されていなかった
// (「ステム同士が混ざっていない」の原因)。assembleFullSongで初めて全ステムを実際に加算合成する。
// (以前あった getFinalSongBuffer はharmonyを含まない版として重複していたため統合・削除した)

// AudioBuffer全チャンネルに先読みリミッターを適用するラッパー。
// True Peak対応(仕様書のリミッター強化): 通常のサンプルピーク基準の
// リミッターだけでは、サンプルとサンプルの間で生じるオーバーシュート
// (True Peak)を防ぎきれないことがある。ここではリミッター適用後に
// estimateTruePeak()でTrue Peakを実測し、まだ目標を超えていれば
// 超過分だけ追加でゲインを下げて再確認する(最大2回まで)。
// True Peak推定自体に処理時間がかかるため、常時ではなく引数で選べるようにする。
async function applyFinalLookaheadLimiterToBuffer(buffer, ceilingDb, truePeakSafe) {
  const sr = buffer.sampleRate;
  const out = audioCtx.createBuffer(buffer.numberOfChannels, buffer.length, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    // D187: 最終AudioBufferのチャンネルへ直接書き込み、processed全曲配列を省く。
    // Stereo: both channels are detected together so they get identical gain.
    const linked = buffer.numberOfChannels === 2 ? buffer.getChannelData(1 - ch) : undefined;
    await applyLookaheadLimiter(
      buffer.getChannelData(ch), sr, ceilingDb, 5, 60, out.getChannelData(ch), linked
    );
  }
  if (truePeakSafe) {
    const ceilingLin = Math.pow(10, ceilingDb / 20);
    for (let iter = 0; iter < 2; iter++) {
      let maxTp = 0;
      for (let ch = 0; ch < out.numberOfChannels; ch++) {
        // D181: 通常/YouTube書き出しのTrue Peak確認も協調処理に統一。
        // 数式は同じまま、長尺音源でUIを長時間ブロックしない。
        const chTp = await estimateTruePeakCooperative(out.getChannelData(ch), 8, 16);
        if (chTp > maxTp) maxTp = chTp;
      }
      if (maxTp <= ceilingLin * 1.001) break; // 十分収まっていれば終了
      const extraGainLin = ceilingLin / maxTp; // 超過分だけ追加で下げる
      const extraGainDb = 20 * Math.log10(Math.max(extraGainLin, 1e-12));
      // D194: True Peak超過時の全曲Gain調整も分割実行し、長尺でUIを固めない。
      await applyBufferGainInPlaceCooperative(out, extraGainDb);
    }
  }
  return out;
}

/* =========================================================
   中間段(セーフティネット)専用の軽いリミッター。
   クリップ対策として各処理段にリミッターを足した結果、Vocalは最大4回も
   リミッターを通る構造になっていた。それぞれが本気の天井(-0.3dB)で
   動作するため、通るたびにダイナミクスが削られ音が平板になる、歪みが
   蓄積する、という副作用があった。
   本来リミッターは「最終段だけが本気で音圧を整え、中間段は万一の事故を
   防ぐ保険」であるべきなので、この関数は:
     1. まずピークを実測し、天井(-0.1dB、最終段より高い)を超えていなければ
        何もせずそのまま返す(通常時は完全に無干渉)
     2. 超えている時だけリミッターをかける(事故を防ぐ)
   という設計にする。これで通常の音量では中間段が一切音に影響しなくなる。
   ========================================================= */
// サンプルピーク計測(VM_SAMPLE_PEAK_WASM_BASE64〜measureBufferSamplePeakCooperative)は src/audio/sample-peak.js へ移動。

async function applySafetyLimiterIfNeeded(buffer, ceilingDb) {
  const ceiling = Math.pow(10, (ceilingDb != null ? ceilingDb : -0.1) / 20);

  // D191: 長尺Mixのセーフティ判定も分割走査。
  // 同じSample Peak判定のまま、スマホUIを長時間占有しない。
  const maxPeak = await measureBufferSamplePeakCooperative(buffer);

  if (maxPeak <= ceiling) return buffer; // 通常時: 何もしない(音に一切影響しない)
  return await applyFinalLookaheadLimiterToBuffer(buffer, ceilingDb != null ? ceilingDb : -0.1, false);
}

/* =========================================================
   モノラル互換チェック(仕様書12番)。ステレオ処理(ハモリのステレオ幅・
   ダブラー・ショートディレイ等)は、L/Rの位相関係によってはモノラルに
   まとめた瞬間に音が薄くなったり部分的に消えたりする(位相キャンセル)。
   イヤホン片耳・スマホ本体スピーカー・一部Bluetooth等、モノラルで聴く
   環境は実際には多いため、書き出し前に確認できるようにする。
   ========================================================= */
function checkMonoCompatibility(buffer) {
  if (buffer.numberOfChannels < 2) {
    return { applicable: false };
  }
  const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
  const n = L.length;

  // ピアソン相関係数: +1=完全に同位相(モノ互換◎) 0=無相関 -1=完全に逆位相(モノで消える)
  let sumL = 0, sumR = 0;
  for (let i = 0; i < n; i++) { sumL += L[i]; sumR += R[i]; }
  const meanL = sumL / n, meanR = sumR / n;
  let cov = 0, varL = 0, varR = 0;
  for (let i = 0; i < n; i++) {
    const dl = L[i] - meanL, dr = R[i] - meanR;
    cov += dl * dr; varL += dl * dl; varR += dr * dr;
  }
  const denom = Math.sqrt(varL * varR);
  const correlation = denom > 1e-9 ? cov / denom : 1;

  // D182: モノラル互換チェックだけのために全曲分のFloat32Arrayを作らない。
  // L/R平均サンプルの二乗和を直接積算して、同じRMSを求める。
  const stereoRms = (rmsOf(L, 0, n) + rmsOf(R, 0, n)) / 2;
  let monoSumSq = 0;
  for (let i = 0; i < n; i++) {
    const monoSample = (L[i] + R[i]) / 2;
    monoSumSq += monoSample * monoSample;
  }
  const monoRms = Math.sqrt(monoSumSq / Math.max(1, n));
  const monoLossDb = dbfs(stereoRms) - dbfs(monoRms); // 正の値が大きいほどモノで音量が落ちる

  return {
    applicable: true,
    correlation,
    monoLossDb,
    warning: correlation < 0.3 || monoLossDb > 3,
  };
}
