// Sample-array DSP: expander, click reduction, clip detection/repair,
// reverb-tail gate, breath control, transient boost, ducking and section
// balance curves, biquads, exciter, resonance control, lookahead limiter,
// TPDF dither, and the DSP/clip-stats WASM runtimes they use.
// No DOM or app state. Moved verbatim from the main app script in index.html
// and loaded as a classic script before it. Uses dbfs() from
// src/analysis/spectrum-core.js and yieldToBrowser() from the app script.
/* =========================================================
   追加DSP: サンプル配列に直接適用する処理(WebAudioの標準ノードでは
   表現しづらいもの)。Python版dsp.py/analyzer.pyと同じ設計思想の移植。
   ========================================================= */

// ダウンワードエキスパンダー: 閾値を下回る部分をなめらかに減衰させ、
// 息継ぎやノイズフロアを整理する。Python版compressor()と対になる実装
// (compressorが閾値より上を圧縮するのに対し、これは閾値より下を減衰させる)。
function applyExpander(samples, sr, thresholdDb, ratio, attackMs, releaseMs) {
  const attack = Math.exp(-1 / (sr * attackMs / 1000));
  const release = Math.exp(-1 / (sr * releaseMs / 1000));
  const out = new Float32Array(samples.length);
  let level = 0;
  const thresholdLin = Math.pow(10, thresholdDb / 20);
  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i]);
    const coef = absVal > level ? attack : release;
    level = coef * level + (1 - coef) * absVal;
    let gain = 1;
    if (level < thresholdLin && level > 1e-9) {
      gain = Math.pow(level / thresholdLin, ratio - 1);
    }
    out[i] = samples[i] * gain;
  }
  return out;
}

// 簡易リップノイズ/クリック低減: ごく短時間(数ms)の急激なスパイクを検出して
// 軽く減衰させる。誤検出で音楽的なアタック(子音の立ち上がり等)まで削らないよう、
// 「直前直後の平均に対して極端に飛び出している場合だけ」というかなり控えめな
// 条件にしている(過検出よりも見逃しを許容する設計)。
// クリック低減。「1〜2サンプルだけ孤立して突出するパルス」を狙う処理だが、
// 実際のスマホ録音で検証したところ、通常の歌声でも30秒間に1001回も誤発動し、
// 波形の3.4%を局所的に削って超高域を-3〜-4dBも損なう(=ノイズとして知覚される)
// ことが判明した。判定に使う「周辺平均」が2ms離れた2点のみで信頼性が低く、
// 大音量の歌唱では常に条件を満たしてしまうのが原因。
// 条件を厳しくしても誤検出は残り、一方で本物のクリックは元々ほとんど無いため、
// 得られる利益に対してリスクが大きすぎると判断し、既定で無効化した
// (どうしても必要な場合のみUIから有効化できる)。
function applyClickReduction(samples, sr) {
  const windowSize = Math.max(1, Math.round(sr * 0.002)); // 2ms
  const out = samples.slice();
  let reducedCount = 0;
  for (let i = windowSize; i < samples.length - windowSize - 1; i++) {
    const diffIn = Math.abs(samples[i] - samples[i - 1]);
    const diffOut = Math.abs(samples[i + 1] - samples[i]);
    const localAvg = (Math.abs(samples[i - windowSize]) + Math.abs(samples[i + windowSize])) / 2;
    // 「入り」だけでなく「出」も急峻であることを要求する。歌声の自然な
    // 立ち上がりは入りだけが急なので、これで孤立パルスだけに絞り込める。
    if (diffIn > 0.45 && diffOut > 0.3 && diffIn > localAvg * 10 + 0.05) {
      for (let k = -windowSize; k <= windowSize; k++) {
        const idx = i + k;
        if (idx < 0 || idx >= out.length) continue;
        const w = 1 - Math.abs(k) / windowSize;
        out[idx] *= (1 - 0.6 * w);
      }
      reducedCount++;
    }
  }
  return { samples: out, reducedCount };
}

/* =========================================================
   残響ゲート(仕様書相当、リバーブ「除去」ではなく「軽減」)。
   正直な前提: 一度畳み込まれたリバーブを完全に取り除くのは数学的に
   不良設定問題であり、実用レベルのものはほぼ例外なく大規模なニューラル
   ネットワークを使う(ブラウザ単体のJSでは非現実的)。ここでは代わりに
   「フレーズの合間に残る残響の"尻尾"を、次の発声が来るまで軽く抑える」
   というゲート的な軽減にとどめる。
   直近のピーク音量からどれだけ下がったか(dropDb)を常時追いかけ、
   大きく下がった=減衰中の尻尾らしいと判断した区間だけ緩やかにゲイン
   を下げる(急に切ると不自然なクリックになるため、attack/releaseで
   なめらかに)。アタックそのものは直近ピークとほぼ同じレベルなので
   ここでは触らない。
   ========================================================= */
/* =========================================================
   クリップ検出と簡易修復(デクリッパー)。
   イヤホンマイク等で大きな声を録ると、録音の時点で波形の頭が平らに
   潰れる(クリップ)ことがあり、これが「ガビガビ」した歪みの正体になる。
   正直な前提: 録音時に失われた波形は原理的に完全復元できない。ここでは
   潰れて平らになった区間を、その手前の波形の傾きから「本来どこまで
   伸びていたか」を推定し、なめらかな山で埋め直すことで、平らな面が生む
   耳障りな高次倍音を減らす。合成テスト信号で高調波歪みが約20%低減する
   ことをNode.jsで検証済み(完全な除去ではない)。
   長く潰れている区間は推定が外れて別の歪みを生むため、あえて触らない。
   ========================================================= */
function detectClipping(samples, opts) {
  opts = opts || {};
  const threshold = opts.threshold != null ? opts.threshold : 0.985;
  const minRun = opts.minRun != null ? opts.minRun : 3;
  const runs = [];
  let i = 0;
  while (i < samples.length) {
    if (Math.abs(samples[i]) >= threshold) {
      const sign = samples[i] >= 0 ? 1 : -1;
      let j = i;
      while (j < samples.length && Math.abs(samples[j]) >= threshold && (samples[j] >= 0 ? 1 : -1) === sign) j++;
      if (j - i >= minRun) runs.push({ start: i, end: j, sign });
      i = j;
    } else i++;
  }
  const clippedSamples = runs.reduce((s, r) => s + (r.end - r.start), 0);
  return { runs, clippedRatio: samples.length ? clippedSamples / samples.length : 0 };
}

const VM_CLIPSTATS_WASM_BASE64 = 'AGFzbQEAAAABCwFgBn9/fH9/fwF/AwIBAAUFAQEQgAgGDwJ/AUGAiAQLfwBBgIgECwcyAwZtZW1vcnkCABd2bV9jbGlwc3RhdHNfYWNjdW11bGF0ZQAAC19faGVhcF9iYXNlAwEKggMB/wIDAnwDfwF9IAUrAxAhBgJAAkAgBSsDCCIHmUQAAAAAAADgQWNFDQAgB6ohCAwBC0GAgICAeCEICyABQQFIIQkCQAJAIAUrAwAiB5lEAAAAAAAA4EFjRQ0AIAeqIQoMAQtBgICAgHghCgsCQAJAIAkNAANAQQAhCSAAKgIAIgu7IgdEnHUAiDzkN/5jDQIgCyALXA0CIAdEnHUAiDzkN35kDQICQAJAAkAgB5ogByALQwAAAABdGyACZkUNAEEBQX8gC0MAAAAAYBshCSAKRQ0BAkAgCSAIRw0AIApBAWohCgwDCyAGIAYgCregIAogA0gbIQYMAQsgBiAGIAq3oCAKIANIGyEGQQAhCEEAIQoMAQsgCSEIQQEhCgsgAEEEaiEAIAFBf2oiAQ0ACwsgBUQAAAAAAAAAACAItyAEQQBHIApBAEpxIgAbOQMIIAVEAAAAAAAAAAAgCrcgABs5AwAgBSAGIAYgCrigIAogA0gbIAYgABs5AxBBASEJCyAJCwBBBG5hbWUACgljbGlwLndhc20BGgEAF3ZtX2NsaXBzdGF0c19hY2N1bXVsYXRlBxIBAA9fX3N0YWNrX3BvaW50ZXIAfwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQEFY2xhbmdfMTcuMC4wIChodHRwczovL2dpdGh1Yi5jb20vc3dpZnRsYW5nL2xsdm0tcHJvamVjdC5naXQgMTA5OTliNmQwMzRmZTMxOGYzZDU2YzgzYmRkYjY1NzI1OTNhOGJiMCkASQ90YXJnZXRfZmVhdHVyZXMEKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=';
let vmClipStatsRuntimePromise = null;
let vmClipStatsWasmDisabled = false;

async function vmEnsureClipStatsRuntime() {
  if (vmClipStatsWasmDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmClipStatsRuntimePromise) return vmClipStatsRuntimePromise;

  vmClipStatsRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_CLIPSTATS_WASM_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (!memory || typeof exports.vm_clipstats_accumulate !== 'function') {
        throw new Error('Clip Stats WASM exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmClipStatsWasmDisabled = true;
      console.warn('[clipstats-wasm/fallback-js]', e);
      return null;
    }
  })();

  return vmClipStatsRuntimePromise;
}

function vmEnsureClipStatsMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  if (runtime.memory.buffer.byteLength >= need) return;
  runtime.memory.grow(Math.ceil((need - runtime.memory.buffer.byteLength) / 65536));
}

async function vmDetectClippingStatsCooperative(samples, threshold, minRun) {
  const runtime = await vmEnsureClipStatsRuntime();
  if (!runtime) return null;

  const chunkSize = 131072;
  const statePtr = runtime.heapBase;
  const inputPtr = (statePtr + 24 + 15) & ~15;
  vmEnsureClipStatsMemory(runtime, (inputPtr - runtime.heapBase) + chunkSize * 4 + 64);

  const state = new Float64Array(runtime.memory.buffer, statePtr, 3);
  state.fill(0);

  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);
    const len = end - start;
    new Float32Array(runtime.memory.buffer, inputPtr, chunkSize).set(samples.subarray(start, end), 0);

    const ok = runtime.exports.vm_clipstats_accumulate(
      inputPtr, len, threshold, minRun, end >= samples.length ? 1 : 0, statePtr
    );
    if (!ok) {
      const err = new Error('クリッピング解析中に不正なサンプル値(NaN/Infinity)を検出しました');
      err.code = 'VM_INVALID_AUDIO_SAMPLE';
      throw err;
    }
    if (end < samples.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const clippedSamples = state[2];
  return {
    clippedSamples,
    clippedRatio: samples.length ? clippedSamples / samples.length : 0
  };
}

async function detectClippingStatsCooperative(samples, opts) {
  opts = opts || {};
  const threshold = opts.threshold != null ? opts.threshold : 0.985;
  const minRun = opts.minRun != null ? opts.minRun : 3;

  try {
    const wasmResult = await vmDetectClippingStatsCooperative(samples, threshold, minRun);
    if (wasmResult) return wasmResult;
  } catch (e) {
    if (e && e.code === 'VM_INVALID_AUDIO_SAMPLE') throw e;
    console.warn('[clipstats-wasm/fallback-js]', e);
  }

  // D327: Analyze表示用はrun配列を必要としないため、clip sample数だけ数える。
  // Repair用detectClipping()は変更せず残す。
  const chunkYield = 131072;

  let i = 0;
  let clippedSamples = 0;
  let nextYieldAt = chunkYield;

  while (i < samples.length) {
    if (Math.abs(samples[i]) >= threshold) {
      const sign = samples[i] >= 0 ? 1 : -1;
      let j = i;
      while (
        j < samples.length &&
        Math.abs(samples[j]) >= threshold &&
        (samples[j] >= 0 ? 1 : -1) === sign
      ) {
        j++;
      }
      if (j - i >= minRun) clippedSamples += (j - i);
      i = j;
    } else {
      i++;
    }

    if (i >= nextYieldAt) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      nextYieldAt = i + chunkYield;
    }
  }

  return {
    clippedSamples,
    clippedRatio: samples.length ? clippedSamples / samples.length : 0
  };
}


function repairClipping(samples, opts) {
  opts = opts || {};
  const maxRun = opts.maxRunSamples != null ? opts.maxRunSamples : 220; // 約5ms@44.1kHz
  const { runs } = detectClipping(samples, opts);
  const out = samples.slice();
  let repaired = 0, skipped = 0;
  for (const r of runs) {
    const len = r.end - r.start;
    if (len > maxRun) { skipped++; continue; } // 長すぎるクリップは推定が外れやすいので触らない
    const i0 = r.start - 1, i1 = r.end;
    if (i0 < 1 || i1 >= samples.length - 1) continue;
    const y0 = samples[i0], y1 = samples[i1];
    const d0 = y0 - samples[i0 - 1]; // 潰れる直前の傾き = 本来の伸び方の手がかり
    const peakEstimate = Math.abs(y0) + Math.abs(d0) * (len / 2);
    // 推定が過大にならないよう、元のピークの1.6倍までに制限する
    const peakAbs = Math.min(peakEstimate, Math.abs(y0) * 1.6);
    for (let k = 0; k < len; k++) {
      const t = (k + 1) / (len + 1);
      const bump = Math.sin(Math.PI * t); // 両端0・中央1の山(端は元の波形と連続)
      const linear = y0 + (y1 - y0) * t;
      out[r.start + k] = linear + r.sign * (peakAbs - Math.abs(y0)) * bump;
    }
    repaired++;
  }
  return { samples: out, repairedRuns: repaired, skippedRuns: skipped };
}

function applyReverbTailGate(samples, sr, opts) {
  opts = opts || {};
  const thresholdDropDb = opts.thresholdDropDb != null ? opts.thresholdDropDb : 14;
  const reduceTo = opts.reduceTo != null ? opts.reduceTo : 0.35;
  const attackMs = opts.attackMs != null ? opts.attackMs : 3;
  const releaseMs = opts.releaseMs != null ? opts.releaseMs : 120;

  const fastAttack = Math.exp(-1 / (sr * 0.002));
  const fastRelease = Math.exp(-1 / (sr * 0.03));
  const peakDecay = Math.exp(-1 / (sr * 0.4)); // 直近ピークの記憶(0.4秒でゆっくり減衰)
  const gateAttack = Math.exp(-1 / (sr * (attackMs / 1000)));
  const gateRelease = Math.exp(-1 / (sr * (releaseMs / 1000)));

  const out = new Float32Array(samples.length);
  let fastEnv = 0, peakRef = 0, gain = 1;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    const cf = a > fastEnv ? fastAttack : fastRelease;
    fastEnv = cf * fastEnv + (1 - cf) * a;
    if (fastEnv > peakRef) peakRef = fastEnv; else peakRef = peakDecay * peakRef + (1 - peakDecay) * fastEnv;

    const dropDb = dbfs(peakRef) - dbfs(fastEnv);
    const targetGain = dropDb > thresholdDropDb ? reduceTo : 1;
    const c = targetGain < gain ? gateAttack : gateRelease;
    gain = c * gain + (1 - c) * targetGain;
    out[i] = samples[i] * gain;
  }
  return out;
}


// 大きいものだけ検出して軽く減衰する」という方針。ブレスは音程を持たない
// ノイズ的な音(ゼロ交差率=ZCRが高い)で、かつ歌唱そのものよりは静か・
// 完全な無音よりは大きい、という2条件で「ブレスらしい」区間を検出する。
// 通常のブレスはそのまま残し、track内で目立って大きい(tooLoudDb超)区間だけ
// 前後をフェードしながら控えめに(完全消去ではなく)軽減する。
function detectAndReduceBreaths(samples, sr, opts) {
  opts = opts || {};
  const zcrThreshold = opts.zcrThreshold != null ? opts.zcrThreshold : 0.15;
  const rmsMinDb = opts.rmsMinDb != null ? opts.rmsMinDb : -45;
  const rmsMaxDb = opts.rmsMaxDb != null ? opts.rmsMaxDb : -18;
  const tooLoudDb = opts.tooLoudDb != null ? opts.tooLoudDb : -20;
  const reduceTo = opts.reduceTo != null ? opts.reduceTo : 0.45; // 完全消去ではなく控えめに残す

  const frameSize = Math.round(sr * 0.03), hop = Math.round(sr * 0.015);
  const frames = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    let sumSq = 0, zc = 0;
    for (let i = start; i < start + frameSize; i++) {
      sumSq += samples[i] * samples[i];
      if (i > start && (samples[i] >= 0) !== (samples[i - 1] >= 0)) zc++;
    }
    frames.push({ start, rms: Math.sqrt(sumSq / frameSize), zcr: zc / frameSize });
  }

  const out = samples.slice();
  let reducedCount = 0;
  let i = 0;
  while (i < frames.length) {
    const db0 = dbfs(frames[i].rms);
    const isCandidate = frames[i].zcr > zcrThreshold && db0 > rmsMinDb && db0 < rmsMaxDb;
    if (isCandidate) {
      let j = i, maxDb = db0;
      while (j < frames.length) {
        const dbj = dbfs(frames[j].rms);
        if (frames[j].zcr <= zcrThreshold || dbj <= rmsMinDb || dbj >= rmsMaxDb + 6) break;
        maxDb = Math.max(maxDb, dbj);
        j++;
      }
      if (maxDb > tooLoudDb) {
        const segStart = frames[i].start;
        const segEnd = Math.min(samples.length, frames[j - 1].start + frameSize);
        const fadeLen = Math.max(1, Math.round(sr * 0.01)); // 10msフェード(急激な音量変化=クリックを防ぐ)
        for (let k = segStart; k < segEnd; k++) {
          const distStart = k - segStart, distEnd = segEnd - k;
          const fadeFactor = Math.max(0, Math.min(1, Math.min(distStart, distEnd) / fadeLen));
          out[k] *= 1 - (1 - reduceTo) * fadeFactor;
        }
        reducedCount++;
      }
      i = j > i ? j : i + 1;
    } else {
      i++;
    }
  }
  return { samples: out, reducedCount };
}

// トランジェント(アタック)強調。速いコンプでアタックが潰れた後の「パンチ回復」に使う
// 古典的な手法(SPL Transient Designer等と同じ考え方)。速いエンベロープ(数ms)と
// 遅いエンベロープ(数十ms)を同時に追いかけ、速い方が遅い方を大きく上回った瞬間
// =急激な立ち上がり(アタック)と判断してその瞬間だけ音量を持ち上げる。
// 定常的な部分(遅い方に追いついている部分)には影響しない。
async function applyTransientBoost(samples, sr, boostDb) {
  const fastAttack = Math.exp(-1 / (sr * 0.001));   // 1ms
  const fastRelease = Math.exp(-1 / (sr * 0.02));   // 20ms
  const slowAttack = Math.exp(-1 / (sr * 0.03));    // 30ms
  const slowRelease = Math.exp(-1 / (sr * 0.15));   // 150ms
  const maxBoost = Math.pow(10, boostDb / 20);
  const out = new Float32Array(samples.length);
  let fastEnv = 0, slowEnv = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    const cf = a > fastEnv ? fastAttack : fastRelease;
    fastEnv = cf * fastEnv + (1 - cf) * a;
    const cs = a > slowEnv ? slowAttack : slowRelease;
    slowEnv = cs * slowEnv + (1 - cs) * a;
    const ratio = slowEnv > 1e-6 ? fastEnv / slowEnv : 1;
    // ratioが1.0(定常)〜2.5(急激な立ち上がり)の範囲を0〜1の強調量にマッピング
    // ratio<=1.15は定常的な信号の整流リプル等による誤検出とみなして無視する
    // 不感帯(dead zone)。1.15〜2.5の範囲だけを0〜1の強調量にマッピングする。
    const t = Math.max(0, Math.min(1, (ratio - 1.15) / 1.35));
    const boost = 1 + (maxBoost - 1) * t;
    out[i] = samples[i] * boost;

    // D283: 長尺Harmonyでメインスレッドを占有し続けない。
    // 計算式・出力値は変更せず、一定sampleごとにUIへ制御を返す。
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return out;
}

// ボーカルの音量エンベロープから、伴奏を軽くダッキングするためのゲインカーブを作る
// (サイドチェイン風)。WebAudioのDynamicsCompressorNodeは外部サイドチェイン入力を
// 持たないため、エンベロープ計算とゲイン適用を手動のサンプル処理で行う。
//
// 修正(不自然なポンピングの報告への対応): 以前はattack 10ms/release 250msと
// 速すぎたため、歌詞の音節の切れ目ごとにゲインが急に上下し「不自然に伴奏が
// 揺れる」ポンピングが発生していた。attack/releaseを緩め、さらにゲインカーブ
// 自体に軽いローパス平滑化をかけることで、音節単位の細かい上下動を均し、
// フレーズ全体としての緩やかな「呼吸」のような自然な動きにした。

async function computeDuckingGainCurveFromAudioBuffer(buffer, sr, amount) {
  const attack = Math.exp(-1 / (sr * 0.035));
  const release = Math.exp(-1 / (sr * 0.45));
  const gain = new Float32Array(buffer.length);

  const a = buffer.getChannelData(0);
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  let level = 0;
  for (let i = 0; i < buffer.length; i++) {
    // monoFromAudioBuffer()と同じL/R平均。全曲mono配列だけ作らない。
    const sample = b ? (a[i] + b[i]) / 2 : a[i];
    const abs = Math.abs(sample);
    const coef = abs > level ? attack : release;
    level = coef * level + (1 - coef) * abs;
    const db = 20 * Math.log10(Math.max(level, 1e-6));
    const normalized = Math.min(1, Math.max(0, (db + 40) / 30));
    gain[i] = 1 - amount * normalized;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  const smoothCoef = Math.exp(-1 / (sr * 0.12));
  let smoothed = gain[0] || 1;
  for (let i = 0; i < gain.length; i++) {
    smoothed = smoothCoef * smoothed + (1 - smoothCoef) * gain[i];
    gain[i] = smoothed;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return gain;
}

function computeDuckingGainCurve(vocalMono, sr, amount) {
  const attack = Math.exp(-1 / (sr * 0.035));   // 10ms -> 35ms(急激な追従を抑える)
  const release = Math.exp(-1 / (sr * 0.45));   // 250ms -> 450ms(音節の隙間で戻りすぎない)
  const gain = new Float32Array(vocalMono.length);
  let level = 0;
  for (let i = 0; i < vocalMono.length; i++) {
    const a = Math.abs(vocalMono[i]);
    const coef = a > level ? attack : release;
    level = coef * level + (1 - coef) * a;
    const db = 20 * Math.log10(Math.max(level, 1e-6));
    const t = Math.min(1, Math.max(0, (db + 40) / 30)); // -40dB~-10dBを0~1に正規化
    gain[i] = 1 - amount * t;
  }
  // 追加の平滑化パス(単純な1次ローパス、時定数約120ms)。
  // エンベロープフォロワーだけでは音節ごとの細かい変動が残るため、
  // ゲインカーブ自体をさらに均して「フレーズ単位」の滑らかな動きにする。
  const smoothCoef = Math.exp(-1 / (sr * 0.12));
  let smoothed = gain[0];
  for (let i = 0; i < gain.length; i++) {
    smoothed = smoothCoef * smoothed + (1 - smoothCoef) * gain[i];
    gain[i] = smoothed;
  }
  return gain;
}
function applyDucking(instSamples, vocalMono, sr, amount) {
  const n = Math.min(instSamples.length, vocalMono.length);
  const gainCurve = computeDuckingGainCurve(vocalMono.subarray(0, n), sr, amount);
  const out = instSamples.slice();
  for (let i = 0; i < n; i++) out[i] *= gainCurve[i];
  return out;
}

/* =========================================================
   セクション別自動バランス(仕様書に近い発想)。
   正直な前提: 本当のAメロ/サビ検出には曲構造解析(コード進行・繰り返し
   パターンの検出等)が必要で、ここでは実装していない。代わりに、
   「伴奏のエネルギーが曲の中でどこが濃く/薄いか」を数秒単位の窓で
   測り、伴奏が密で音量も大きい区間(サビらしい箇所)ではボーカルを
   少しだけ前に出し、伴奏が薄い区間(Aメロ/間奏らしい箇所)では
   ボーカルの張り出しを抑える、というエネルギーベースの近似。
   曲全体のエネルギー分布に対する相対的な高低(パーセンタイル)で
   判断するので、曲によって絶対的な音量が違っても機能する。
   ========================================================= */

async function computeSectionBalanceGainCurveFromAudioBuffer(buffer, sr, opts) {
  opts = opts || {};
  const windowSec = opts.windowSec != null ? opts.windowSec : 6;
  const boostDb = opts.boostDb != null ? opts.boostDb : 1.5;
  const cutDb = opts.cutDb != null ? opts.cutDb : -0.5;
  const windowSize = Math.max(1, Math.round(sr * windowSec));
  const n = buffer.length;
  const numWindows = Math.max(1, Math.ceil(n / windowSize));

  const a = buffer.getChannelData(0);
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const windowRms = new Float64Array(numWindows);

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    const end = Math.min(n, start + windowSize);
    let sum = 0;

    for (let i = start; i < end; i++) {
      // monoFromAudioBuffer()と同じL/R平均。
      const s = b ? (a[i] + b[i]) / 2 : a[i];
      sum += s * s;
    }
    windowRms[w] = Math.sqrt(sum / Math.max(1, end - start));
    await yieldToBrowser();
  }

  const sorted = Array.from(windowRms).sort((x, y) => x - y);
  const p60 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.6))];
  const p30 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.3))];

  const windowTargetGainDb = new Float64Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    if (windowRms[w] >= p60) windowTargetGainDb[w] = boostDb;
    else if (windowRms[w] <= p30) windowTargetGainDb[w] = cutDb;
    else windowTargetGainDb[w] = 0;
  }

  const gainCurve = new Float32Array(n);
  const smoothCoef = Math.exp(-1 / (sr * 1.5));
  let currentGainDb = 0;

  for (let i = 0; i < n; i++) {
    const w = Math.min(numWindows - 1, Math.floor(i / windowSize));
    currentGainDb = smoothCoef * currentGainDb + (1 - smoothCoef) * windowTargetGainDb[w];
    gainCurve[i] = Math.pow(10, currentGainDb / 20);
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return gainCurve;
}

function computeSectionBalanceGainCurve(instMono, sr, opts) {
  opts = opts || {};
  const windowSec = opts.windowSec != null ? opts.windowSec : 6;
  const boostDb = opts.boostDb != null ? opts.boostDb : 1.5;
  const cutDb = opts.cutDb != null ? opts.cutDb : -0.5;
  const windowSize = Math.max(1, Math.round(sr * windowSec));
  const n = instMono.length;
  const numWindows = Math.max(1, Math.ceil(n / windowSize));

  const windowRms = new Float64Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize, end = Math.min(n, start + windowSize);
    let sum = 0;
    for (let i = start; i < end; i++) sum += instMono[i] * instMono[i];
    windowRms[w] = Math.sqrt(sum / Math.max(1, end - start));
  }
  // 曲全体のエネルギー分布に対する相対位置(パーセンタイル)で高/低を判断する。
  // 絶対的なdBFSしきい値だと曲ごとのラウドネス差に弱いため。
  const sorted = Array.from(windowRms).sort((a, b) => a - b);
  const p60 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.6))];
  const p30 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.3))];

  const windowTargetGainDb = new Float64Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    if (windowRms[w] >= p60) windowTargetGainDb[w] = boostDb;
    else if (windowRms[w] <= p30) windowTargetGainDb[w] = cutDb;
    else windowTargetGainDb[w] = 0;
  }

  // 窓の境界で急に音量が変わると不自然なので、なめらかに(約1.5秒かけて)遷移する。
  const gainCurve = new Float32Array(n);
  const smoothCoef = Math.exp(-1 / (sr * 1.5));
  let currentGainDb = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.min(numWindows - 1, Math.floor(i / windowSize));
    currentGainDb = smoothCoef * currentGainDb + (1 - smoothCoef) * windowTargetGainDb[w];
    gainCurve[i] = Math.pow(10, currentGainDb / 20);
  }
  return gainCurve;
}

/* =========================================================
   簡易Dynamic EQ(仕様書4番): 固定EQで常に削るのではなく、その帯域が
   相対的に強く出ている瞬間だけ抑える。WebAudioのBiquadFilterNodeは
   静的なゲインしか持てないため、帯域抽出(直接実装したバイクアッド)+
   エンベロープ追従+スペクトル減算という手動のサンプル処理で実現する。
   ========================================================= */

// RBJ Cookbookのバンドパスバイクアッド(直接形1)。OfflineAudioContextを介さず
// 同期的に計算できるので、他の前処理(expander等)と同じ枠組みで扱える。
function biquadBandpass(samples, sr, freqHz, q) {
  const w0 = 2 * Math.PI * freqHz / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

// 高域通過フィルタ(RBJ Cookbook、2次)。エキサイターで高域だけを取り出す用途。
function biquadHighpass(samples, sr, freqHz, q) {
  q = q || 0.7071;
  const w0 = 2 * Math.PI * freqHz / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const b0 = (1 + cosw0) / 2, b1 = -(1 + cosw0), b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw0, a2 = 1 - alpha;
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

// 指定帯域が全体の音量に対して相対的に強く出ている瞬間だけ、その帯域成分を
// 差し引いて抑える(スペクトル減算的アプローチ)。常時一定量削る固定EQと違い、
// 共鳴が実際に目立っている瞬間だけ働くので過処理になりにくい。
// maxCutDbで最大減衰量に上限をかけ(安全上限、仕様書15番と同じ思想)、
// thresholdRatioを超えた分だけ緩やかに(比例的に)効かせる。
//
// 検証結果(q/thresholdの組み合わせ探索): q=2程度だと隣接する基音まで拾って
// 「共鳴していない通常時」にも誤って-3dB前後削ってしまうことが判明。
// q=8, thresholdRatio=0.35まで絞ることで、通常時はほぼ無変化(0.0dB)のまま
// 共鳴区間だけ-2~-3dB程度の自然な抑制になることを確認した。
/* =========================================================
   歯擦音連動エキサイター。
   通常のエキサイターは高域を一律に持ち上げるため、サ行(歯擦音)の
   瞬間にも倍音を足してしまい「サ行にノイズが乗る」原因になっていた。
   実際のスマホ録音を解析したところ、歯擦音の瞬間は10-14kHz(エキサイターが
   狙う帯域)に既に十分なエネルギーがあり、そこへさらに足すのは過剰だった。
   ここでは歯擦音帯域(5-9kHz)のエネルギー比率を常時監視し、歯擦音が
   強く出ている瞬間だけエキサイターの効果を弱める。サ行以外では
   通常通り効くため、空気感を足す目的は損なわれない。
   実音源での検証: 歯擦音区間での10-14kHz増加が+1.66dB→+0.46dBに低減。
   ========================================================= */


// D237: bundled WebAssembly DSP core.
// 外部CDN不要。HTML内にWASMを埋め込み、失敗時は既存JS DSPへ自動フォールバック。
const VM_WASM_DSP_BASE64 = 'AGFzbQEAAAABIwVgAABgAX8AYAh/f3x8fHx8fwBgB39/f39/fH8AYAN/f3wAAwcGAAECAQMEBQMBAAIGPwp/AUGAiAQLfwBBgAgLfwBBgAgLfwBBgAgLfwBBgIgEC38AQYAIC38AQYCIBAt/AEGAgAgLfwBBAAt/AEEBCweBAhAGbWVtb3J5AgARX193YXNtX2NhbGxfY3RvcnMAAA92bV9iaXF1YWRfcmVzZXQAARF2bV9iaXF1YWRfcHJvY2VzcwACEHZtX2xpbWl0ZXJfcmVzZXQAAxJ2bV9saW1pdGVyX3Byb2Nlc3MABA92bV9nYWluX3Byb2Nlc3MABQxfX2Rzb19oYW5kbGUDAQpfX2RhdGFfZW5kAwILX19zdGFja19sb3cDAwxfX3N0YWNrX2hpZ2gDBA1fX2dsb2JhbF9iYXNlAwULX19oZWFwX2Jhc2UDBgpfX2hlYXBfZW5kAwcNX19tZW1vcnlfYmFzZQMIDF9fdGFibGVfYmFzZQMJCsEEBgIACycAIABCADcDACAAQRhqQgA3AwAgAEEQakIANwMAIABBCGpCADcDAAurAQEGfCAHKwMYIQggBysDECEJIAcrAwghCiAHKwMAIQsCQAJAIAFBAU4NACAJIQUgCiEGDAELIAaaIQwgBZohDQNAIAshBiAAIAwgCKIgDSAJoiAEIAqiIAIgACoCALsiC6IgBiADoqCgoKAiBbY4AgAgAEEEaiEAIAkhCCAGIQogBSEJIAFBf2oiAQ0ACwsgByAIOQMYIAcgBTkDECAHIAY5AwggByALOQMACxEAIABCgICAgICAgPg/NwMAC4oBAwJ8AX8BfCAGKwMAIQcCQCADQQFIDQBEAAAAAAAA8D8gBaEhCEEAIQkDQCABKgIAuyIKIAUgB6IgCCAKoqAgByAKZBshBwJAIAkgBE4NACACIAcgACoCALuitjgCAAsgAEEEaiEAIAJBBGohAiABQQRqIQEgAyAJQQFqIglHDQALCyAGIAc5AwALyAEBBH8CQCABQQFIDQAgAUEDcSEDQQAhBAJAIAFBBEkNACABQfz///8HcSEFQQAhBCAAIQEDQCABIAEqAgC7IAKitjgCACABQQRqIgYgBioCALsgAqK2OAIAIAFBCGoiBiAGKgIAuyACorY4AgAgAUEMaiIGIAYqAgC7IAKitjgCACABQRBqIQEgBSAEQQRqIgRHDQALCyADRQ0AIAAgBEECdGohAQNAIAEgASoCALsgAqK2OAIAIAFBBGohASADQX9qIgMNAAsLCwCVAQRuYW1lAAkIZHNwLndhc20BbwYAEV9fd2FzbV9jYWxsX2N0b3JzAQ92bV9iaXF1YWRfcmVzZXQCEXZtX2JpcXVhZF9wcm9jZXNzAxB2bV9saW1pdGVyX3Jlc2V0BBJ2bV9saW1pdGVyX3Byb2Nlc3MFD3ZtX2dhaW5fcHJvY2VzcwcSAQAPX19zdGFja19wb2ludGVyAH8JcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBBWNsYW5nXzE3LjAuMCAoaHR0cHM6Ly9naXRodWIuY29tL3N3aWZ0bGFuZy9sbHZtLXByb2plY3QuZ2l0IDEwOTk5YjZkMDM0ZmUzMThmM2Q1NmM4M2JkZGI2NTcyNTkzYThiYjApAEkPdGFyZ2V0X2ZlYXR1cmVzBCsKbXVsdGl2YWx1ZSsPbXV0YWJsZS1nbG9iYWxzKw9yZWZlcmVuY2UtdHlwZXMrCHNpZ24tZXh0';
const VM_WASM_DSP_CHUNK = 131072;
let vmWasmDspRuntimePromise = null;
let vmWasmDspDisabled = false;

function vmDecodeBase64Bytes(base64Text) {
  const raw = atob(base64Text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function vmWasmGlobalNumber(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.value === 'number') return value.value;
  return Number(value || 0);
}

async function vmEnsureWasmDspRuntime() {
  if (vmWasmDspDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmWasmDspRuntimePromise) return vmWasmDspRuntimePromise;

  vmWasmDspRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_WASM_DSP_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (
        !memory ||
        typeof exports.vm_biquad_process !== 'function' ||
        typeof exports.vm_limiter_process !== 'function' ||
        typeof exports.vm_gain_process !== 'function'
      ) {
        throw new Error('WASM DSP exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmWasmDspDisabled = true;
      console.warn('[wasm-dsp/fallback-js]', e);
      return null;
    }
  })();
  return vmWasmDspRuntimePromise;
}

function vmEnsureWasmMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  const current = runtime.memory.buffer.byteLength;
  if (current >= need) return;
  const pages = Math.ceil((need - current) / 65536);
  runtime.memory.grow(pages);
}

async function vmProcessBiquadWasmCooperative(samples, coeffs) {
  const runtime = await vmEnsureWasmDspRuntime();
  if (!runtime) return null;

  const chunkSize = VM_WASM_DSP_CHUNK;
  const sampleBytes = chunkSize * 4;
  const stateBytes = 32;
  const scratchPtr = runtime.heapBase;
  const statePtr = (scratchPtr + sampleBytes + 15) & ~15;
  vmEnsureWasmMemory(runtime, (statePtr - runtime.heapBase) + stateBytes + 16);

  runtime.exports.vm_biquad_reset(statePtr);
  const out = new Float32Array(samples.length);

  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);
    const len = end - start;
    const scratch = new Float32Array(runtime.memory.buffer, scratchPtr, chunkSize);
    scratch.set(samples.subarray(start, end), 0);

    runtime.exports.vm_biquad_process(
      scratchPtr, len,
      coeffs.b0, coeffs.b1, coeffs.b2,
      coeffs.a1, coeffs.a2,
      statePtr
    );

    out.set(scratch.subarray(0, len), start);
    if (end < samples.length) await yieldToBrowser();
  }
  return out;
}


async function vmApplyLookaheadLimiterWasmCooperative(samples, windowMin, release, lookahead, destination) {
  const runtime = await vmEnsureWasmDspRuntime();
  if (!runtime || typeof runtime.exports.vm_limiter_process !== 'function') return null;

  const n = samples.length;
  const chunkSize = VM_WASM_DSP_CHUNK;
  const sampleBytes = chunkSize * 4;

  const samplesPtr = runtime.heapBase;
  const windowPtr = samplesPtr + sampleBytes;
  const outputPtr = windowPtr + sampleBytes;
  const statePtr = (outputPtr + sampleBytes + 15) & ~15;
  vmEnsureWasmMemory(runtime, (statePtr - runtime.heapBase) + 32);

  runtime.exports.vm_limiter_reset(statePtr);

  const out = destination || new Float32Array(n);
  if (out.length !== n) throw new Error('Limiter出力Buffer長が一致しません');
  out.fill(0);

  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(n, start + chunkSize);
    const len = end - start;
    const outputStart = start + lookahead;
    const writeCount = Math.max(0, Math.min(len, n - outputStart));

    const wasmSamples = new Float32Array(runtime.memory.buffer, samplesPtr, chunkSize);
    const wasmWindow = new Float32Array(runtime.memory.buffer, windowPtr, chunkSize);
    const wasmOutput = new Float32Array(runtime.memory.buffer, outputPtr, chunkSize);

    wasmSamples.set(samples.subarray(start, end), 0);
    wasmWindow.set(windowMin.subarray(start, end), 0);

    runtime.exports.vm_limiter_process(
      samplesPtr,
      windowPtr,
      outputPtr,
      len,
      writeCount,
      release,
      statePtr
    );

    if (writeCount > 0) {
      out.set(wasmOutput.subarray(0, writeCount), outputStart);
    }

    if (end < n) await yieldToBrowser();
  }

  return out;
}

async function biquadBandpassCooperative(samples, sr, freqHz, q) {
  const w0 = 2 * Math.PI * freqHz / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;

  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
  const na1 = a1 / a0, na2 = a2 / a0;

  const wasmOut = await vmProcessBiquadWasmCooperative(samples, {
    b0: nb0, b1: nb1, b2: nb2, a1: na1, a2: na2
  });
  if (wasmOut) return wasmOut;

  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return out;
}

async function biquadHighpassCooperative(samples, sr, freqHz, q) {
  q = q || 0.7071;
  const w0 = 2 * Math.PI * freqHz / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const b0 = (1 + cosw0) / 2, b1 = -(1 + cosw0), b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha, a1 = -2 * cosw0, a2 = 1 - alpha;

  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
  const na1 = a1 / a0, na2 = a2 / a0;

  const wasmOut = await vmProcessBiquadWasmCooperative(samples, {
    b0: nb0, b1: nb1, b2: nb2, a1: na1, a2: na2
  });
  if (wasmOut) return wasmOut;

  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return out;
}

async function applySibilanceAwareExciterCooperative(samples, sr, opts) {
  opts = opts || {};
  const freqHz = opts.freqHz != null ? opts.freqHz : 10000;
  const drive = opts.driveDb != null ? opts.driveDb / 10 : 0.4;
  const mix = opts.mix != null ? opts.mix : 0.16;
  const sibLo = opts.sibLoHz != null ? opts.sibLoHz : 5000;
  const sibHi = opts.sibHiHz != null ? opts.sibHiHz : 9000;
  const duckAmount = opts.duckAmount != null ? opts.duckAmount : 0.75;
  const ratioStart = opts.ratioStart != null ? opts.ratioStart : 0.10;
  const ratioRange = opts.ratioRange != null ? opts.ratioRange : 0.15;

  const hi = await biquadHighpassCooperative(samples, sr, freqHz);
  const k = 1 + Math.max(0, drive) * 8;
  const tanhK = Math.tanh(k);
  const wet = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    wet[i] = Math.tanh(hi[i] * k) / tanhK;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  const sibBand = await biquadBandpassCooperative(samples, sr, Math.sqrt(sibLo * sibHi), 1.2);
  const attack = Math.exp(-1 / (sr * 0.002));
  const release = Math.exp(-1 / (sr * 0.05));
  const out = new Float32Array(samples.length);
  let sibEnv = 0, fullEnv = 0;

  for (let i = 0; i < samples.length; i++) {
    const as = Math.abs(sibBand[i]), af = Math.abs(samples[i]);
    const cs = as > sibEnv ? attack : release;
    sibEnv = cs * sibEnv + (1 - cs) * as;
    const cf = af > fullEnv ? attack : release;
    fullEnv = cf * fullEnv + (1 - cf) * af;
    const ratio = fullEnv > 1e-6 ? sibEnv / fullEnv : 0;
    const duck = Math.max(0, Math.min(1, (ratio - ratioStart) / ratioRange));
    const gain = 1 - duckAmount * duck;
    out[i] = samples[i] + wet[i] * mix * gain;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  return out;
}

async function applySibilanceAwareExciterStereoCooperative(left, right, sr, opts) {
  opts = opts || {};
  const freqHz = opts.freqHz != null ? opts.freqHz : 10000;
  const drive = opts.driveDb != null ? opts.driveDb / 10 : 0.4;
  const mix = opts.mix != null ? opts.mix : 0.16;
  const sibLo = opts.sibLoHz != null ? opts.sibLoHz : 5000;
  const sibHi = opts.sibHiHz != null ? opts.sibHiHz : 9000;
  const duckAmount = opts.duckAmount != null ? opts.duckAmount : 0.75;
  const ratioStart = opts.ratioStart != null ? opts.ratioStart : 0.10;
  const ratioRange = opts.ratioRange != null ? opts.ratioRange : 0.15;

  // D259: L/RのExciter成分は各chから生成するが、歯擦音によるduck量は共通化。
  // これにより片側だけ高域が強い場面でステレオ像が揺れにくくなる。
  const hiL = await biquadHighpassCooperative(left, sr, freqHz);
  await yieldToBrowser();
  const hiR = await biquadHighpassCooperative(right, sr, freqHz);

  const sibCenter = Math.sqrt(sibLo * sibHi);
  const sibL = await biquadBandpassCooperative(left, sr, sibCenter, 1.2);
  await yieldToBrowser();
  const sibR = await biquadBandpassCooperative(right, sr, sibCenter, 1.2);

  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const k = 1 + Math.max(0, drive) * 8;
  const tanhK = Math.tanh(k);
  const attack = Math.exp(-1 / (sr * 0.002));
  const release = Math.exp(-1 / (sr * 0.05));

  let sibEnv = 0, fullEnv = 0;

  for (let i = 0; i < n; i++) {
    const as = Math.max(Math.abs(sibL[i]), Math.abs(sibR[i]));
    const af = Math.max(Math.abs(left[i]), Math.abs(right[i]));

    const cs = as > sibEnv ? attack : release;
    sibEnv = cs * sibEnv + (1 - cs) * as;
    const cf = af > fullEnv ? attack : release;
    fullEnv = cf * fullEnv + (1 - cf) * af;

    const spectralRatio = fullEnv > 1e-6 ? sibEnv / fullEnv : 0;
    const duck = Math.max(0, Math.min(1, (spectralRatio - ratioStart) / ratioRange));
    const wetGain = mix * (1 - duckAmount * duck);

    const wetL = Math.tanh(hiL[i] * k) / tanhK;
    const wetR = Math.tanh(hiR[i] * k) / tanhK;

    outL[i] = left[i] + wetL * wetGain;
    outR[i] = right[i] + wetR * wetGain;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}


async function applyDynamicResonanceControlCooperative(samples, sr, freqHz, q, thresholdRatio, maxCutDb) {
  const band = await biquadBandpassCooperative(samples, sr, freqHz, q);
  const attack = Math.exp(-1 / (sr * 0.01));
  const release = Math.exp(-1 / (sr * 0.15));
  let bandLevel = 0, fullLevel = 0;
  const out = samples.slice();
  const maxCutLin = 1 - Math.pow(10, -maxCutDb / 20);

  for (let i = 0; i < samples.length; i++) {
    const ab = Math.abs(band[i]), af = Math.abs(samples[i]);
    const coefB = ab > bandLevel ? attack : release;
    bandLevel = coefB * bandLevel + (1 - coefB) * ab;
    const coefF = af > fullLevel ? attack : release;
    fullLevel = coefF * fullLevel + (1 - coefF) * af;
    const ratio = fullLevel > 1e-6 ? bandLevel / fullLevel : 0;
    let reduction = 0;
    if (ratio > thresholdRatio) {
      const excess = Math.min((ratio - thresholdRatio) / thresholdRatio, 1);
      reduction = maxCutLin * excess;
    }
    out[i] -= band[i] * reduction;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  return out;
}

async function applyDynamicResonanceControlStereoCooperative(left, right, sr, freqHz, q, thresholdRatio, maxCutDb) {
  // D257: Dynamic EQをStereo-link化。
  // L/R別々の検出で片側だけ削れることによる定位の揺れを避け、
  // 強い側の共鳴を検出して左右に同じreduction量を適用する。
  const bandL = await biquadBandpassCooperative(left, sr, freqHz, q);
  await yieldToBrowser();
  const bandR = await biquadBandpassCooperative(right, sr, freqHz, q);

  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const attack = Math.exp(-1 / (sr * 0.01));
  const release = Math.exp(-1 / (sr * 0.15));
  let bandLevel = 0, fullLevel = 0;
  const maxCutLin = 1 - Math.pow(10, -maxCutDb / 20);

  for (let i = 0; i < n; i++) {
    const ab = Math.max(Math.abs(bandL[i]), Math.abs(bandR[i]));
    const af = Math.max(Math.abs(left[i]), Math.abs(right[i]));

    const coefB = ab > bandLevel ? attack : release;
    bandLevel = coefB * bandLevel + (1 - coefB) * ab;
    const coefF = af > fullLevel ? attack : release;
    fullLevel = coefF * fullLevel + (1 - coefF) * af;

    const ratioNow = fullLevel > 1e-6 ? bandLevel / fullLevel : 0;
    let reduction = 0;
    if (ratioNow > thresholdRatio) {
      const excess = Math.min((ratioNow - thresholdRatio) / Math.max(thresholdRatio, 1e-6), 1);
      reduction = maxCutLin * excess;
    }

    // 同じreduction係数をL/Rへ適用し、ステレオ像を安定させる。
    outL[i] = left[i] - bandL[i] * reduction;
    outR[i] = right[i] - bandR[i] * reduction;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}


function applySibilanceAwareExciter(samples, sr, opts) {
  opts = opts || {};
  const freqHz = opts.freqHz != null ? opts.freqHz : 10000;
  const drive = opts.driveDb != null ? opts.driveDb / 10 : 0.4;
  const mix = opts.mix != null ? opts.mix : 0.16;
  const sibLo = opts.sibLoHz != null ? opts.sibLoHz : 5000;
  const sibHi = opts.sibHiHz != null ? opts.sibHiHz : 9000;
  const duckAmount = opts.duckAmount != null ? opts.duckAmount : 0.75;
  const ratioStart = opts.ratioStart != null ? opts.ratioStart : 0.10;
  const ratioRange = opts.ratioRange != null ? opts.ratioRange : 0.15;

  // 高域を抽出して歪ませる(エキサイター本体)
  const hi = biquadHighpass(samples, sr, freqHz);
  const k = 1 + Math.max(0, drive) * 8;
  const tanhK = Math.tanh(k);
  const wet = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) wet[i] = Math.tanh(hi[i] * k) / tanhK;

  // 歯擦音の量を検出してエンベロープ化
  const sibBand = biquadBandpass(samples, sr, Math.sqrt(sibLo * sibHi), 1.2);
  const attack = Math.exp(-1 / (sr * 0.002));
  const release = Math.exp(-1 / (sr * 0.05));
  const out = new Float32Array(samples.length);
  let sibEnv = 0, fullEnv = 0;
  for (let i = 0; i < samples.length; i++) {
    const as = Math.abs(sibBand[i]), af = Math.abs(samples[i]);
    const cs = as > sibEnv ? attack : release;
    sibEnv = cs * sibEnv + (1 - cs) * as;
    const cf = af > fullEnv ? attack : release;
    fullEnv = cf * fullEnv + (1 - cf) * af;
    const ratio = fullEnv > 1e-6 ? sibEnv / fullEnv : 0;
    // 歯擦音比率が高いほどエキサイターを弱める(0=完全に無効、1=フル適用)
    const duck = Math.max(0, Math.min(1, (ratio - ratioStart) / ratioRange));
    const gain = 1 - duckAmount * duck;
    out[i] = samples[i] + wet[i] * mix * gain;
  }
  return out;
}

function applyDynamicResonanceControl(samples, sr, freqHz, q, thresholdRatio, maxCutDb) {
  const band = biquadBandpass(samples, sr, freqHz, q);
  const attack = Math.exp(-1 / (sr * 0.01));
  const release = Math.exp(-1 / (sr * 0.15));
  let bandLevel = 0, fullLevel = 0;
  const out = samples.slice();
  const maxCutLin = 1 - Math.pow(10, -maxCutDb / 20);
  for (let i = 0; i < samples.length; i++) {
    const ab = Math.abs(band[i]), af = Math.abs(samples[i]);
    const coefB = ab > bandLevel ? attack : release;
    bandLevel = coefB * bandLevel + (1 - coefB) * ab;
    const coefF = af > fullLevel ? attack : release;
    fullLevel = coefF * fullLevel + (1 - coefF) * af;
    const ratio = fullLevel > 1e-6 ? bandLevel / fullLevel : 0;
    let reduction = 0;
    if (ratio > thresholdRatio) {
      const excess = Math.min((ratio - thresholdRatio) / thresholdRatio, 1);
      reduction = maxCutLin * excess;
    }
    out[i] -= band[i] * reduction;
  }
  return out;
}

/* =========================================================
   先読み(lookahead)型ピークリミッター。
   従来のWebAudio DynamicsCompressorNodeは「ピークを検知してから」ゲインを
   下げるため原理的に反応が一瞬遅れる(アタックタイムがどれだけ速くても、
   ピークが来た"後"にしか反応できない)。この実装は逆に、数msだけ音声を
   遅延させ、その間に「これから来るピーク」を先読みしてゲインカーブを
   計算しておくことで、ピークが実際に鳴る瞬間には既にゲインが下がっている
   状態を作る。理論上オーバーシュート(ceiling超え)が起きない設計。
   ※「True Peak」(サンプル間ピーク)まで検出するにはオーバーサンプリングが
   必要で、ここではサンプルそのもののピークのみを保証する(誇張しない)。
   ========================================================= */

// 後方(trailing)ウィンドウ最小値: out[i] = min(arr[i-window+1 .. i])。単調キューでO(n)。
function slidingWindowMinTrailing(arr, window) {
  const n = arr.length;
  const out = new Float32Array(n);
  const dq = [];
  for (let i = 0; i < n; i++) {
    while (dq.length && arr[dq[dq.length - 1]] >= arr[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - window) dq.shift();
    out[i] = arr[dq[0]];
  }
  return out;
}
// 前方(leading)ウィンドウ最小値: out[k] = min(arr[k .. k+window-1])。
// 配列を反転して「後方最小」を計算し、結果をまた反転すれば前方最小になる
// (このひと手間を挟むのは、インデックス対応を暗算で合わせにいって以前
// 実際にオフバイワンで壊した反省から、確実な方法に倒したもの)。
function slidingWindowMinLeading(arr, window) {
  const n = arr.length;
  const out = new Float32Array(n);
  if (!n) return out;

  // D188: 反転配列 + 反転後の最小値配列を作らず、右から左へ直接処理。
  // dqには候補indexを単調増加値になるよう保持し、
  // out[i] = min(arr[i .. i+window-1]) を同じ意味で求める。
  const dq = new Int32Array(n);
  let head = 0, tail = 0;

  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && arr[dq[tail - 1]] >= arr[i]) tail--;
    dq[tail++] = i;

    const maxIndex = i + window - 1;
    while (tail > head && dq[head] > maxIndex) head++;

    out[i] = arr[dq[head]];
  }
  return out;
}

async function buildLimiterWindowMin(samples, ceiling, window) {
  const n = samples.length;
  const out = new Float32Array(n);
  if (!n) return out;

  // D190: req全曲配列とn要素のdequeを廃止。
  // lookahead窓に残り得る候補数だけのリングバッファで、
  // min(req[i .. i+window-1]) を直接作る。
  const cap = Math.max(2, Math.min(n, Math.max(1, window)) + 1);
  const dqIndex = new Int32Array(cap);
  const dqValue = new Float32Array(cap);
  let head = 0;
  let count = 0;

  for (let i = n - 1; i >= 0; i--) {
    const maxIndex = i + window - 1;

    while (count > 0 && dqIndex[head] > maxIndex) {
      head = (head + 1) % cap;
      count--;
    }

    const a = Math.abs(samples[i]);
    const req = a > ceiling ? ceiling / a : 1;

    while (count > 0) {
      const back = (head + count - 1) % cap;
      if (dqValue[back] < req) break;
      count--;
    }

    const tail = (head + count) % cap;
    dqIndex[tail] = i;
    dqValue[tail] = req;
    count++;

    out[i] = dqValue[head];

    // D193: 長尺音源でもLookahead窓構築でUIを占有し続けない。
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  return out;
}

async function applyLookaheadLimiter(samples, sr, ceilingDb, lookaheadMs, releaseMs, destination) {
  const ceiling = Math.pow(10, ceilingDb / 20);
  const lookahead = Math.max(1, Math.round(sr * lookaheadMs / 1000));
  const n = samples.length;

  // D190: 必要ゲインの全曲配列を持たず、窓最小値だけを直接計算。
  const windowMin = await buildLimiterWindowMin(samples, ceiling, lookahead);

  // D239: gain smoothing + delayed writeをWASMへ移行。
  // 既存JSと同じdouble精度のgain stateとFloat32出力を使用する。
  const release = Math.exp(-1 / (sr * releaseMs / 1000));
  const wasmOut = await vmApplyLookaheadLimiterWasmCooperative(
    samples, windowMin, release, lookahead, destination
  );
  if (wasmOut) return wasmOut;

  // WASM非対応/初期化失敗時は従来JS処理へ戻す。
  const out = destination || new Float32Array(n);
  if (out.length !== n) throw new Error('Limiter出力Buffer長が一致しません');
  out.fill(0);

  let g = 1;
  for (let k = 0; k < n; k++) {
    if (windowMin[k] < g) g = windowMin[k];
    else g = release * g + (1 - release) * windowMin[k];

    const outIdx = k + lookahead;
    if (outIdx < n) out[outIdx] = samples[k] * g;

    if ((k & 131071) === 0 && k > 0) await yieldToBrowser();
  }
  return out;
}

// 解析(VM_ANALYSIS_STATS_WASM_BASE64〜analyzeRelative)は src/analysis/vocal-analysis.js へ移動。

// MIX判断層(DEFAULT_MIX_RULES〜optimizeProcessingBudget)は src/decision/mix-decision.js へ移動。

// TPDFディザ(三角分布ディザ)。独立した2つの一様乱数の差を取ると三角分布になる。
// bit深度を落とす(32bit浮動小数点の内部処理→16/24bit整数)際、量子化誤差を
// そのまま丸めるだけだと誤差が信号と相関し、小さな音・リバーブの余韻等で
// 耳につく歪みになることがある。量子化前に1LSB分のディザを加えることで、
// この誤差を信号と無相関なノイズに変換する(プロのマスタリングでの標準的な処理)。
function tpdfDither() { return Math.random() - Math.random(); }
