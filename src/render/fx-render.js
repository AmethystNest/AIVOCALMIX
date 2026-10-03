// FX rendering: per-region FX curves and renderFx (drive, EQ, reverb, delay,
// doubler ...). Moved verbatim from index.html's #app-script; loaded right
// before it. It reads the FX controls from the DOM only when called.


/* =========================================================
   区間ごとのFX量カーブを作る(仕様: 区間指定FX)。
   曲全体に一律ではなく「45秒〜1分20秒だけディレイを強く」のように
   時間帯ごとに違う設定をかけられるようにする。
   境目でFX量が急に変わると耳につく段差になるため、必ずfadeSecかけて
   なめらかに繋ぐ(Node.jsで隣接サンプル間の変化量が極小=段差なしと検証済み)。
   ========================================================= */
function buildFxRegionCurve(regions, key, baseValue, durationSec, sr, fadeSec) {
  fadeSec = fadeSec != null ? fadeSec : 0.3;
  const n = Math.max(1, Math.ceil(durationSec * sr));
  const curve = new Float32Array(n);
  curve.fill(baseValue);
  for (const r of regions || []) {
    if (r[key] == null) continue;
    const s = Math.max(0, Math.floor(r.startSec * sr));
    const e = Math.min(n, Math.ceil(r.endSec * sr));
    if (e <= s) continue;
    const fade = Math.max(1, Math.floor(fadeSec * sr));
    for (let i = s; i < e; i++) {
      const fromStart = (i - s) / fade;
      const toEnd = (e - i) / fade;
      const t = Math.max(0, Math.min(1, Math.min(fromStart, toEnd)));
      // 既に他の区間で値が変わっている場合も考慮し、baseではなく現在値から補間する
      curve[i] = curve[i] + (r[key] - curve[i]) * t;
    }
  }
  return curve;
}

// AudioParamに区間カーブを適用する。区間指定が無い場合は単純に固定値を入れる。
// setValueCurveAtTimeはカーブ全体をパラメータの自動変化として登録できるため、
// サンプル単位で正確なタイミングのFX量変化が実現できる。

// D231: AudioParamへ渡すFX区間カーブは最終的に10ms間隔へ間引くため、
// 先に全サンプル長Float32Arrayを作ってから間引く必要はない。
// 旧buildFxRegionCurve()の「10msごとのサンプル点」と同じ計算を直接行い、
// 音の自動変化は維持したままメモリとCPUを削減する。
function buildFxParamCurveThinned(regions, key, baseValue, durationSec, sr, mapper, fadeSec) {
  fadeSec = fadeSec != null ? fadeSec : 0.3;
  const n = Math.max(1, Math.ceil(durationSec * sr));
  const step = Math.max(1, Math.floor(sr * 0.01));
  const count = Math.ceil(n / step);
  const thinned = new Float32Array(count);
  thinned.fill(baseValue);

  for (const r of regions || []) {
    if (r[key] == null) continue;
    const s = Math.max(0, Math.floor(r.startSec * sr));
    const e = Math.min(n, Math.ceil(r.endSec * sr));
    if (e <= s) continue;
    const fade = Math.max(1, Math.floor(fadeSec * sr));

    const jStart = Math.max(0, Math.ceil(s / step));
    const jEnd = Math.min(count, Math.ceil(e / step));
    for (let j = jStart; j < jEnd; j++) {
      const i = j * step;
      const fromStart = (i - s) / fade;
      const toEnd = (e - i) / fade;
      const t = Math.max(0, Math.min(1, Math.min(fromStart, toEnd)));
      thinned[j] = thinned[j] + (r[key] - thinned[j]) * t;
    }
  }

  if (typeof mapper === 'function') {
    for (let j = 0; j < thinned.length; j++) thinned[j] = mapper(thinned[j]);
  }
  return thinned;
}

async function buildFxRegionCurveCooperative(regions, key, baseValue, durationSec, sr, fadeSec, shouldCancel) {
  fadeSec = fadeSec != null ? fadeSec : 0.3;
  const n = Math.max(1, Math.ceil(durationSec * sr));
  const curve = new Float32Array(n);
  curve.fill(baseValue);

  for (const r of regions || []) {
    if (r[key] == null) continue;
    const s = Math.max(0, Math.floor(r.startSec * sr));
    const e = Math.min(n, Math.ceil(r.endSec * sr));
    if (e <= s) continue;
    const fade = Math.max(1, Math.floor(fadeSec * sr));

    for (let i = s; i < e; i++) {
      const fromStart = (i - s) / fade;
      const toEnd = (e - i) / fade;
      const t = Math.max(0, Math.min(1, Math.min(fromStart, toEnd)));
      curve[i] = curve[i] + (r[key] - curve[i]) * t;

      if ((i & 131071) === 0 && i > s) {
        await yieldToBrowser();
        throwIfFxCancelled(shouldCancel);
      }
    }
    await yieldToBrowser();
    throwIfFxCancelled(shouldCancel);
  }

  return curve;
}

function applyFxParamCurve(param, regions, key, baseValue, durationSec, sr) {
  const hasRegion = (regions || []).some((r) => r[key] != null);
  if (!hasRegion) { param.value = baseValue; return; }
  const thinned = buildFxParamCurveThinned(regions, key, baseValue, durationSec, sr);
  param.setValueCurveAtTime(thinned, 0, durationSec);
}

function applyFxMappedParamCurve(param, regions, key, baseValue, durationSec, sr, mapper) {
  const hasRegion = (regions || []).some((r) => r[key] != null);
  if (!hasRegion) { param.value = mapper(baseValue); return; }
  const thinned = buildFxParamCurveThinned(regions, key, baseValue, durationSec, sr, mapper);
  param.setValueCurveAtTime(thinned, 0, durationSec);
}


async function renderDriveRegionStereoChunked(sourceBuffer, destinationBuffer, regions, baseDrive, sr, asymmetric, shouldCancel) {
  const n = sourceBuffer.length;
  const srcL = sourceBuffer.getChannelData(0);
  const srcR = sourceBuffer.getChannelData(sourceBuffer.numberOfChannels > 1 ? 1 : 0);
  const dstL = destinationBuffer.getChannelData(0);
  const dstR = destinationBuffer.getChannelData(1);
  const fade = Math.max(1, Math.floor(0.3 * sr));
  const chunkSize = 131072;

  // Region境界を一度だけSample indexへ変換する。
  const driveRegions = (regions || [])
    .filter((r) => r.driveAmount != null)
    .map((r) => ({
      s: Math.max(0, Math.floor(r.startSec * sr)),
      e: Math.min(n, Math.ceil(r.endSec * sr)),
      target: r.driveAmount
    }))
    .filter((r) => r.e > r.s);

  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(n, start + chunkSize);
    const local = new Float32Array(end - start);
    local.fill(baseDrive);

    // D233: 旧buildFxRegionCurveと同じ順序・補間式で、このchunkに重なる
    // Regionだけを適用する。Float32Arrayへの代入も同じなのでDrive量は同値。
    for (const r of driveRegions) {
      const rs = Math.max(start, r.s);
      const re = Math.min(end, r.e);
      if (re <= rs) continue;

      for (let i = rs; i < re; i++) {
        const fromStart = (i - r.s) / fade;
        const toEnd = (r.e - i) / fade;
        const t = Math.max(0, Math.min(1, Math.min(fromStart, toEnd)));
        const j = i - start;
        local[j] = local[j] + (r.target - local[j]) * t;
      }
    }

    for (let i = start; i < end; i++) {
      const amt = local[i - start];
      dstL[i] = saturateSampleForRegion(srcL[i], amt, asymmetric);
      dstR[i] = saturateSampleForRegion(srcR[i], amt, asymmetric);
    }

    if (end < n) {
      await yieldToBrowser();
      throwIfFxCancelled(shouldCancel);
    }
  }
}

function saturateSampleForRegion(x, amount, asymmetric) {
  if (!(amount > 0)) return x;
  const k = 1 + Math.max(0, amount) * 8;
  let y;
  if (asymmetric) {
    const kPos = k * 1.15, kNeg = k * 0.82;
    y = x >= 0
      ? Math.tanh(x * kPos) / Math.tanh(kPos)
      : Math.tanh(x * kNeg) / Math.tanh(kNeg);
  } else {
    y = Math.tanh(x * k) / Math.tanh(k);
  }
  return Math.max(-1, Math.min(1, y));
}

// sourceBufferはモノ/ステレオどちらでも可。モノなら従来通り中央に、
// ステレオ(例: 馴染ませ済みのHarmony)ならその左右の広がりをdry信号として保持したまま
// Reverb/Delay/Doublerを追加する(FXの元になるwet信号はモノダウンミックスから作る)。

function throwIfFxCancelled(shouldCancel) {
  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('fx render cancelled');
    err.code = 'VM_FX_RENDER_CANCELLED';
    throw err;
  }
}

async function renderFx(sourceBuffer, sr, shouldCancel) {
  throwIfFxCancelled(shouldCancel);
  const extra = sr * 2;
  const offlineCtx = new OfflineAudioContext(2, sourceBuffer.length + extra, sr);
  const isStereoIn = sourceBuffer.numberOfChannels > 1;
  const regions = state.fxRegions || [];
  const durationSec = sourceBuffer.length / sr;

  const driveOn = document.getElementById('fxDriveOn').checked;
  const driveAmount = parseFloat(document.getElementById('fxDriveAmount').value);
  const driveCharacter = document.getElementById('fxDriveCharacter').value;
  const hasDriveRegion = regions.some((r) => r.driveAmount != null);
  const baseDrive = driveOn ? driveAmount : 0;

  const dryStereoBuf = offlineCtx.createBuffer(2, sourceBuffer.length, sr);
  if (hasDriveRegion) {
    // D233: Driveの全曲amountCurve(Float32Array)を保持せず、131072 sample単位で
    // 同じRegion補間を作って即サチュレーションへ使用し、そのchunkを破棄する。
    await renderDriveRegionStereoChunked(
      sourceBuffer,
      dryStereoBuf,
      regions,
      baseDrive,
      sr,
      driveCharacter === 'asymmetric',
      shouldCancel
    );
  } else {
    dryStereoBuf.copyToChannel(sourceBuffer.getChannelData(0), 0);
    dryStereoBuf.copyToChannel(sourceBuffer.getChannelData(isStereoIn ? 1 : 0), 1);
  }
  const drySrc = offlineCtx.createBufferSource(); drySrc.buffer = dryStereoBuf;

  const monoBuf = offlineCtx.createBuffer(1, sourceBuffer.length, sr);
  if (isStereoIn) {
    const l = sourceBuffer.getChannelData(0), r = sourceBuffer.getChannelData(1);
    const m = monoBuf.getChannelData(0);
    for (let i = 0; i < l.length; i++) {
      m[i] = (l[i] + r[i]) / 2;
      if ((i & 131071) === 0 && i > 0) {
        await yieldToBrowser();
        throwIfFxCancelled(shouldCancel);
      }
    }
  } else {
    monoBuf.copyToChannel(sourceBuffer.getChannelData(0), 0);
  }
  const fxSrc = offlineCtx.createBufferSource(); fxSrc.buffer = monoBuf;

  const merger = offlineCtx.createChannelMerger(2);

  const reverbMix = parseFloat(document.getElementById('fxReverbMix').value);
  const reverbDecay = parseFloat(document.getElementById('fxReverbDecay').value);
  const reverbType = document.getElementById('fxReverbType').value;
  const delayTime = parseFloat(document.getElementById('fxDelayTime').value) / 1000;
  const delayFeedback = parseFloat(document.getElementById('fxDelayFeedback').value);
  const delayMix = parseFloat(document.getElementById('fxDelayMix').value);
  const doublerOn = document.getElementById('fxDoublerOn').checked;
  const doublerDepth = parseFloat(document.getElementById('fxDoublerDepth').value);

  // dry(入力の左右をそのまま)
  // 注意(バグ修正): AudioBufferSourceNodeは(ステレオバッファを持っていても)
  // 出力ポートは1つしか無い。drySrc.connect(merger, 1, 1) のように出力インデックス1を
  // 指定すると "output index (1) exceeds number of outputs (1)" エラーになる。
  // L/Rを別々のmerger入力へ振り分けるにはChannelSplitterNodeで一度分割する必要がある。
  //
  // Drive(サチュレーション)はReverb/Delay/Doublerと違い「原音に薄く足す」のではなく
  // 「原音そのものの質感を変える」処理なので、wetとして混ぜるのではなく
  // dry信号の経路上に挿入する。
  let dryChain = drySrc;
  if (!hasDriveRegion && driveOn && driveAmount > 0) {
    const shaper = offlineCtx.createWaveShaper();
    shaper.curve = buildSaturationCurve(driveAmount, driveCharacter === 'asymmetric');
    shaper.oversample = '4x'; // エイリアシング(折り返しノイズ)対策
    drySrc.connect(shaper);
    dryChain = shaper;
  }
  const drySplitter = offlineCtx.createChannelSplitter(2);
  dryChain.connect(drySplitter);
  drySplitter.connect(merger, 0, 0); drySplitter.connect(merger, 1, 1);

  // 区間指定FXがある場合は、全体設定が0でも区間内で値が入る可能性があるため
  // 処理自体は有効化しておく(実際のFX量はカーブ側で0になるので影響はない)。
  const hasReverbRegion = regions.some((r) => r.reverbMix != null);
  const hasDelayRegion = regions.some((r) => r.delayMix != null);
  const hasDoublerRegion = regions.some((r) => r.doublerDepth != null);

  // reverb (stereo-ish: 同じconvolverをL/Rに)
  if (reverbMix > 0 || hasReverbRegion) {
    const conv = offlineCtx.createConvolver();
    conv.buffer = await buildReverbImpulse(offlineCtx, Math.max(reverbDecay, 0.2), 15, 1, reverbType);
    const wet = offlineCtx.createGain();
    applyFxParamCurve(wet.gain, regions, 'reverbMix', reverbMix, durationSec, sr);
    fxSrc.connect(conv); conv.connect(wet);
    wet.connect(merger, 0, 0); wet.connect(merger, 0, 1);
  }

  // delay
  if (delayMix > 0 || hasDelayRegion) {
    const delay = offlineCtx.createDelay(1.0); delay.delayTime.value = delayTime;
    const fb = offlineCtx.createGain(); fb.gain.value = delayFeedback;
    const wet = offlineCtx.createGain();
    applyFxParamCurve(wet.gain, regions, 'delayMix', delayMix, durationSec, sr);
    fxSrc.connect(delay); delay.connect(fb); fb.connect(delay);
    delay.connect(wet); wet.connect(merger, 0, 0); wet.connect(merger, 0, 1);
  }

  // doubler: 区間指定にも対応。全体OFFでも区間側に値があれば、その区間だけ有効になる。
  if (doublerOn || hasDoublerRegion) {
    const baseDepth = doublerOn ? doublerDepth : 0;
    const dL = offlineCtx.createDelay(0.05);
    const dR = offlineCtx.createDelay(0.05);
    const gL = offlineCtx.createGain();
    const gR = offlineCtx.createGain();

    applyFxMappedParamCurve(dL.delayTime, regions, 'doublerDepth', baseDepth, durationSec, sr, (v) => 0.006 + 0.015 * v);
    applyFxMappedParamCurve(dR.delayTime, regions, 'doublerDepth', baseDepth, durationSec, sr, (v) => 0.011 + 0.020 * v);
    applyFxMappedParamCurve(gL.gain, regions, 'doublerDepth', baseDepth, durationSec, sr, (v) => 0.35 * v);
    applyFxMappedParamCurve(gR.gain, regions, 'doublerDepth', baseDepth, durationSec, sr, (v) => 0.35 * v);

    fxSrc.connect(dL); dL.connect(gL); gL.connect(merger, 0, 0);
    fxSrc.connect(dR); dR.connect(gR); gR.connect(merger, 0, 1);
  }

  // 中間段の安全策(強いリミットはExport時の最終段だけに残す。理由はmixTwoBuffers参照)
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -1.0; limiter.ratio.value = 4; limiter.attack.value = 0.01; limiter.release.value = 0.15;
  merger.connect(limiter); limiter.connect(offlineCtx.destination);

  drySrc.start(); fxSrc.start();
  throwIfFxCancelled(shouldCancel);
  const rendered = await offlineCtx.startRendering();
  throwIfFxCancelled(shouldCancel);
  return rendered;
}
