// Whole-buffer spectrum / band-level / dynamics-index computation used by the
// Before/After comparison and the export meters (getCachedSpectrumForBuffer ..
// getSpectrumNormalizedX). Moved verbatim from index.html's #app-script; loaded
// right before it.


/* =========================================================
   周波数スペクトラム(Before/After比較用)。曲全体を等間隔にサンプリングした
   フレームでFFTをかけ、パワー(振幅の2乗)の平均を取ってからdBに変換する
   (dBを直接平均すると小さい値に引っ張られて実態と違う平均になるため、
   必ずパワードメインで平均してからdBへ変換する)。
   ========================================================= */



const VM_SPECTRUM_CACHE = new WeakMap();

async function getCachedSpectrumForBuffer(buffer, shouldCancel) {
  if (!buffer) return { freqs: new Float64Array(0), magDb: new Float64Array(0), frameCount: 0 };

  const cached = VM_SPECTRUM_CACHE.get(buffer);
  if (cached) {
    throwIfAnalysisCancelled(shouldCancel);
    return cached;
  }

  const result = await computeAverageSpectrumDbFromBuffer(buffer, shouldCancel);
  throwIfAnalysisCancelled(shouldCancel);
  VM_SPECTRUM_CACHE.set(buffer, result);
  return result;
}

async function computeAverageSpectrumDbFromBuffer(buffer, shouldCancel) {
  if (!buffer) return { freqs: new Float64Array(0), magDb: new Float64Array(0), frameCount: 0 };

  const sr = buffer.sampleRate;
  const frameSize = 4096;
  const hop = 2048;
  const half = frameSize / 2;
  const powerSum = new Float64Array(half);
  const frame = new Float32Array(frameSize);
  const workspace = createSpectrumWorkspace(frameSize, sr);
  const channels = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  const channelCount = Math.max(1, channels.length);

  let frameCount = 0;
  let sinceYield = 0;

  const totalFrames = Math.max(0, Math.floor((buffer.length - frameSize) / hop) + 1);
  const maxFrames = 180;
  let starts;

  if (totalFrames <= maxFrames) {
    starts = new Uint32Array(totalFrames);
    let si = 0;
    for (let start = 0; start + frameSize <= buffer.length; start += hop) starts[si++] = start;
  } else {
    const tmp = new Uint32Array(maxFrames);
    const maxStart = Math.max(0, buffer.length - frameSize);
    let used = 0;
    for (let i = 0; i < maxFrames; i++) {
      const ratio = i / Math.max(1, maxFrames - 1);
      const start = Math.min(maxStart, Math.max(0, Math.round((maxStart * ratio) / hop) * hop));
      if (used === 0 || tmp[used - 1] !== start) tmp[used++] = start;
    }
    starts = tmp.subarray(0, used);
  }

  // D313: Hann / FFT re/im / magnitude / frequency配列を全frameで再利用。
  // 180 frame解析での大量TypedArray allocationとGCを除去し、計算式は変更しない。
  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    throwIfAnalysisCancelled(shouldCancel);

    if (channelCount === 1) {
      frame.set(channels[0].subarray(start, start + frameSize));
    } else if (channelCount === 2) {
      const left = channels[0], right = channels[1];
      for (let i = 0; i < frameSize; i++) {
        frame[i] = (left[start + i] + right[start + i]) / 2;
      }
    } else {
      for (let i = 0; i < frameSize; i++) {
        let sample = 0;
        for (let ch = 0; ch < channelCount; ch++) sample += channels[ch][start + i] || 0;
        frame[i] = sample / channelCount;
      }
    }

    const mag = magnitudeSpectrumInto(frame, workspace);
    for (let i = 0; i < half; i++) powerSum[i] += mag[i] * mag[i];

    frameCount++;
    sinceYield++;
    if (sinceYield >= 24) {
      sinceYield = 0;
      await yieldToBrowser();
      throwIfAnalysisCancelled(shouldCancel);
    }
  }

  const magDb = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const avgPower = frameCount > 0 ? powerSum[i] / frameCount : 0;
    magDb[i] = dbfs(Math.sqrt(avgPower));
  }
  return { freqs: workspace.freqs, magDb, frameCount };
}

async function computeDynamicsIndexFromBuffer(buffer, shouldCancel) {
  if (!buffer) return 0;

  const sr = buffer.sampleRate;
  const frameSize = Math.max(1, Math.floor(sr * 0.05));
  const totalFrames = Math.max(0, Math.floor((buffer.length - frameSize) / frameSize) + 1);
  const maxFrames = 1400;
  const channels = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  const channelCount = Math.max(1, channels.length);

  // D317: JS number配列をTypedArrayへ。
  // Reference解析で最大1400個のframe開始位置/level objectをGC対象にしない。
  let starts;
  if (totalFrames <= maxFrames) {
    starts = new Uint32Array(totalFrames);
    let si = 0;
    for (let start = 0; start + frameSize <= buffer.length; start += frameSize) {
      starts[si++] = start;
    }
  } else {
    const tmp = new Uint32Array(maxFrames);
    const maxStart = Math.max(0, buffer.length - frameSize);
    let used = 0;
    for (let i = 0; i < maxFrames; i++) {
      const ratio = i / Math.max(1, maxFrames - 1);
      const start = Math.min(
        maxStart,
        Math.max(0, Math.round((maxStart * ratio) / frameSize) * frameSize)
      );
      if (used === 0 || tmp[used - 1] !== start) tmp[used++] = start;
    }
    starts = tmp.subarray(0, used);
  }

  const levels = new Float64Array(starts.length);
  let levelCount = 0;
  let processed = 0;

  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    throwIfAnalysisCancelled(shouldCancel);
    const end = Math.min(buffer.length, start + frameSize);
    let sum = 0;

    for (let i = start; i < end; i++) {
      let sample = 0;
      for (let ch = 0; ch < channelCount; ch++) sample += channels[ch][i] || 0;
      sample /= channelCount;
      sum += sample * sample;
    }

    const n = Math.max(1, end - start);
    const rms = Math.sqrt(sum / n);
    if (rms > 1e-5) levels[levelCount++] = 20 * Math.log10(rms);

    processed++;
    if (processed % 80 === 0) {
      await yieldToBrowser();
      throwIfAnalysisCancelled(shouldCancel);
    }
  }

  if (levelCount < 8) return 0;
  const usedLevels = levels.subarray(0, levelCount);
  usedLevels.sort();
  const at = (p) => usedLevels[Math.min(levelCount - 1, Math.floor(levelCount * p))];
  return at(0.90) - at(0.30);
}

function throwIfAnalysisCancelled(shouldCancel) {
  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('analysis cancelled');
    err.code = 'VM_REFERENCE_ANALYSIS_CANCELLED';
    throw err;
  }
}

async function computeAverageSpectrumDb(samples, sr, shouldCancel) {
  const frameSize = 4096;
  const hop = 2048;
  const half = frameSize / 2;
  const powerSum = new Float64Array(half);
  let freqs = null;
  let frameCount = 0;
  let sinceYield = 0;

  // D94: 長尺音源では全フレームを総当たりせず、曲全体から等間隔に
  // 最大180フレームを抽出する。短尺は従来どおり全フレームを解析する。
  // これにより曲頭だけに偏らず、帯域傾向を維持したままスマホ負荷を抑える。
  const totalFrames = Math.max(0, Math.floor((samples.length - frameSize) / hop) + 1);
  const maxFrames = 180;
  const starts = [];

  if (totalFrames <= maxFrames) {
    for (let start = 0; start + frameSize <= samples.length; start += hop) {
      starts.push(start);
    }
  } else {
    const maxStart = Math.max(0, samples.length - frameSize);
    for (let i = 0; i < maxFrames; i++) {
      const t = i / Math.max(1, maxFrames - 1);
      const start = Math.min(maxStart, Math.max(0, Math.round((maxStart * t) / hop) * hop));
      if (!starts.length || starts[starts.length - 1] !== start) starts.push(start);
    }
  }

  for (const start of starts) {
    throwIfAnalysisCancelled(shouldCancel);
    const frame = samples.subarray(start, start + frameSize);
    const { mag, freqs: f } = magnitudeSpectrum(frame, sr);
    if (!freqs) freqs = f;

    for (let i = 0; i < half; i++) powerSum[i] += mag[i] * mag[i];
    frameCount++;
    sinceYield++;

    if (sinceYield >= 24) {
      sinceYield = 0;
      await yieldToBrowser();
      throwIfAnalysisCancelled(shouldCancel);
    }
  }

  const magDb = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const avgPower = frameCount > 0 ? powerSum[i] / frameCount : 0;
    magDb[i] = dbfs(Math.sqrt(avgPower));
  }

  return { freqs, magDb, frameCount };
}

/* =========================================================
   リファレンス音源へのマッチング。
   目標とするミックス済み音源をアップロードし、それに近づける。
   2つの側面を扱う:
   (1) 全体の帯域バランス — オクターブバンドごとの平均レベルを比較し、
       差分を打ち消すEQを自動生成する。
   (2) ボーカルと伴奏の音量バランス — 「短時間の音量変動の大きさ」で測る。
       伴奏は音量がほぼ一定なのに対し、ボーカルは歌う/歌わないで
       大きく変動するため、ボーカルが大きいほどこの値は増える。
       実測でボーカル音量比-9dB→+6dBの範囲で1.44dB→9.79dBと
       単調に増加することを検証済み(単純な帯域比では逆転して
       使えなかったため、この手法を採用した)。
   ========================================================= */

// オクターブバンドごとの平均レベル(dB)。帯域バランス比較の基礎データ。
const VM_BAND_RANGE_CACHE = new WeakMap();

function getSpectrumBandRanges(freqs) {
  const cached = VM_BAND_RANGE_CACHE.get(freqs);
  if (cached) return cached;

  const bands = [
    { lo: 60, hi: 120 }, { lo: 120, hi: 250 }, { lo: 250, hi: 500 },
    { lo: 500, hi: 1000 }, { lo: 1000, hi: 2000 }, { lo: 2000, hi: 4000 },
    { lo: 4000, hi: 8000 }, { lo: 8000, hi: 16000 },
  ];

  const ranges = bands.map((b) => {
    let start = 0;
    while (start < freqs.length && freqs[start] < b.lo) start++;
    let end = start;
    while (end < freqs.length && freqs[end] < b.hi) end++;
    return { lo:b.lo, hi:b.hi, centerHz:Math.sqrt(b.lo*b.hi), start, end };
  });

  VM_BAND_RANGE_CACHE.set(freqs, ranges);
  return ranges;
}

function computeBandLevels(spec) {
  const ranges = getSpectrumBandRanges(spec.freqs);

  return ranges.map((b) => {
    let sum = 0, count = 0;
    for (let i = b.start; i < b.end; i++) {
      if (isFinite(spec.magDb[i])) {
        sum += spec.magDb[i];
        count++;
      }
    }
    return {
      lo: b.lo,
      hi: b.hi,
      centerHz: b.centerHz,
      db: count > 0 ? sum / count : -120
    };
  });
}

// 短時間の音量変動の大きさ。ボーカルが伴奏に対して大きいほど値が増える。
async function computeDynamicsIndex(samples, sr, shouldCancel) {
  const frame = Math.max(1, Math.floor(sr * 0.05));
  const totalFrames = Math.max(0, Math.floor((samples.length - frame) / frame) + 1);
  const maxFrames = 1400;
  let starts;

  if (totalFrames <= maxFrames) {
    starts = new Uint32Array(totalFrames);
    let used = 0;
    for (let i = 0; i + frame <= samples.length; i += frame) starts[used++] = i;
  } else {
    const tmp = new Uint32Array(maxFrames);
    const maxStart = Math.max(0, samples.length - frame);
    let used = 0;
    for (let i = 0; i < maxFrames; i++) {
      const t = i / Math.max(1, maxFrames - 1);
      const start = Math.min(maxStart, Math.max(0, Math.round((maxStart * t) / frame) * frame));
      if (used === 0 || tmp[used - 1] !== start) tmp[used++] = start;
    }
    starts = tmp.subarray(0, used);
  }

  const levels = new Float64Array(starts.length);
  let levelCount = 0;
  let processed = 0;

  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    throwIfAnalysisCancelled(shouldCancel);
    let sum = 0;
    const end = Math.min(samples.length, start + frame);
    for (let k = start; k < end; k++) sum += samples[k] * samples[k];

    const n = Math.max(1, end - start);
    const r = Math.sqrt(sum / n);
    if (r > 1e-5) levels[levelCount++] = 20 * Math.log10(r);

    processed++;
    if (processed % 80 === 0) {
      await yieldToBrowser();
      throwIfAnalysisCancelled(shouldCancel);
    }
  }

  if (levelCount < 8) return 0;
  const usedLevels = levels.subarray(0, levelCount);
  usedLevels.sort();
  const at = (p) => usedLevels[Math.min(levelCount - 1, Math.floor(levelCount * p))];
  return at(0.90) - at(0.30);
}

// スペクトラムを対数周波数軸のグラフとしてcanvasに描画する。
const VM_SPECTRUM_XNORM_CACHE = new WeakMap();

function getSpectrumNormalizedX(freqs, minFreq = 40, maxFreq = 18000) {
  let perArray = VM_SPECTRUM_XNORM_CACHE.get(freqs);
  if (!perArray) {
    perArray = new Map();
    VM_SPECTRUM_XNORM_CACHE.set(freqs, perArray);
  }
  const key = `${minFreq}|${maxFreq}`;
  const cached = perArray.get(key);
  if (cached) return cached;

  const minLog = Math.log10(minFreq);
  const logSpan = Math.log10(maxFreq) - minLog;
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    out[i] = (Math.log10(Math.max(freqs[i], minFreq)) - minLog) / logSpan;
  }
  perArray.set(key, out);
  return out;
}
