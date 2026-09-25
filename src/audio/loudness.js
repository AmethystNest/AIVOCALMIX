// Integrated LUFS (ITU-R BS.1770 K-weighting, gating) with its WASM kernel,
// plus the synchronous JS True Peak estimator. Moved verbatim from the main
// app script in index.html; loaded before it. Uses yieldToBrowser,
// vmDecodeBase64Bytes and vmWasmGlobalNumber at call time.
const VM_KWEIGHT_COEFF_CACHE = new Map();

function kWeightingCoeffs(sr) {
  const cacheKey = Number(sr);
  const cached = VM_KWEIGHT_COEFF_CACHE.get(cacheKey);
  if (cached) return cached;
  // ステージ1: 高域シェルフ(高域を持ち上げ、耳の感度特性を模す)
  const f0_1 = 1681.9744509555319, G = 3.99984385397, Q1 = 0.7071752369554193;
  const K1 = Math.tan(Math.PI * f0_1 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K1 / Q1 + K1 * K1;
  const stage1 = {
    b0: (Vh + Vb * K1 / Q1 + K1 * K1) / a0_1,
    b1: 2 * (K1 * K1 - Vh) / a0_1,
    b2: (Vh - Vb * K1 / Q1 + K1 * K1) / a0_1,
    a1: 2 * (K1 * K1 - 1) / a0_1,
    a2: (1 - K1 / Q1 + K1 * K1) / a0_1,
  };
  // ステージ2: 高域通過(RLB、低域をロールオフして超低域の影響を除く)
  const f0_2 = 38.13547087613982, Q2 = 0.5003270373238773;
  const K2 = Math.tan(Math.PI * f0_2 / sr);
  const stage2 = {
    b0: 1, b1: -2, b2: 1,
    a1: 2 * (K2 * K2 - 1) / (1 + K2 / Q2 + K2 * K2),
    a2: (1 - K2 / Q2 + K2 * K2) / (1 + K2 / Q2 + K2 * K2),
  };
  // BS.1770 / libebur128と同じく分子は[1, -2, 1]のまま(正規化しない)。
  // 以前は1/(1+K/Q+K^2)で割っており、LUFSが約0.04LU低く出ていた。
  const result = { stage1, stage2 };
  if (VM_KWEIGHT_COEFF_CACHE.size >= 8) {
    VM_KWEIGHT_COEFF_CACHE.delete(VM_KWEIGHT_COEFF_CACHE.keys().next().value);
  }
  VM_KWEIGHT_COEFF_CACHE.set(cacheKey, result);
  return result;
}
function applyBiquadDF1(samples, c) {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}
function applyKWeighting(samples, sr) {
  const { stage1, stage2 } = kWeightingCoeffs(sr);
  return applyBiquadDF1(applyBiquadDF1(samples, stage1), stage2);
}

async function applyKWeightingCompactCooperative(samples, sr, shouldCancel) {
  const { stage1, stage2 } = kWeightingCoeffs(sr);
  const out = new Float32Array(samples.length);
  const chunkSize = 131072;

  // stage1 / stage2を1サンプルずつ直列処理し、
  // 従来の中間Float32Array 1本を作らない。
  // stage1出力はMath.froundでFloat32量子化してからstage2へ渡し、
  // 旧 applyBiquadDF1(...stage1) -> applyBiquadDF1(...stage2) の
  // 中間精度を維持する。
  let s1x1 = 0, s1x2 = 0, s1y1 = 0, s1y2 = 0;
  let s2x1 = 0, s2x2 = 0, s2y1 = 0, s2y2 = 0;

  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);

    for (let i = start; i < end; i++) {
      const x0 = samples[i];

      let y1 = stage1.b0 * x0 + stage1.b1 * s1x1 + stage1.b2 * s1x2
             - stage1.a1 * s1y1 - stage1.a2 * s1y2;
      y1 = Math.fround(y1);
      s1x2 = s1x1; s1x1 = x0; s1y2 = s1y1; s1y1 = y1;

      const y2 = stage2.b0 * y1 + stage2.b1 * s2x1 + stage2.b2 * s2x2
               - stage2.a1 * s2y1 - stage2.a2 * s2y2;
      const y2f = Math.fround(y2);
      out[i] = y2f;
      s2x2 = s2x1; s2x1 = y1; s2y2 = s2y1; s2y1 = y2f;
    }

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    if (end < samples.length) await yieldToBrowser();
  }

  return out;
}

const VM_LUFS_WASM_BASE64 = 'AGFzbQEAAAABFwFgE39/f39/fHx8fHx8fHx8fH9/f38AAwIBAAUFAQEQgAgGDwJ/AUGAiAQLfwBBgIgECwcwAwZtZW1vcnkCABV2bV9rd2VpZ2h0X2FjY3VtdWxhdGUAAAtfX2hlYXBfYmFzZQMBCvkDAfYDBAF/CnwCfwF8IAFBAUghEyAPKwNAIRQgDysDOCEVIA8rAzAhFiAPKwMoIRcgDysDICEYIA8rAxghGSAPKwMQIRogDysDCCEbIA8rAwAhHAJAAkAgDysDSCIdmUQAAAAAAADgQWNFDQAgHaohHgwBC0GAgICAeCEeCwJAAkAgE0UNACAYIQ4MAQtBASADayEfIAO3ISAgDpohHSANmiENIAmaIQkgCJohCCAaIQ4DQCAbIRogHCEbIB0gFaIgDSAWIhWiIAwgF6IgCiAJIBmiIAggDiIZoiAHIBqiIAUgACoCALsiHKIgGyAGoqCgoKC2uyIOoiAYIhcgC6KgoKCgtrsiFiAWoiEYIAIiEyADbyECAkAgEyADSA0AIBQgECACQQN0aisDAKEhFAsgECACQQN0aiAYOQMAIBggFKAhFAJAIBNBAWoiAiADSA0AIB8gE2ogBG8NACAeIBJODQAgESAeQQN0aiITRAAAAAAAAAAAIBQgFEQAAAAAAAAAAGMbICCjIBMrAwCgOQMAIB5BAWohHgsgAEEEaiEAIA4hGiAOIRggAUF/aiIBDQALCyAPIBQ5A0AgDyAVOQM4IA8gFjkDMCAPIBc5AyggDyAOOQMgIA8gGTkDGCAPIBo5AxAgDyAbOQMIIA8gHDkDACAPIB63OQNICwA/BG5hbWUACglsdWZzLndhc20BGAEAFXZtX2t3ZWlnaHRfYWNjdW11bGF0ZQcSAQAPX19zdGFja19wb2ludGVyAH8JcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBBWNsYW5nXzE3LjAuMCAoaHR0cHM6Ly9naXRodWIuY29tL3N3aWZ0bGFuZy9sbHZtLXByb2plY3QuZ2l0IDEwOTk5YjZkMDM0ZmUzMThmM2Q1NmM4M2JkZGI2NTcyNTkzYThiYjApAEkPdGFyZ2V0X2ZlYXR1cmVzBCsKbXVsdGl2YWx1ZSsPbXV0YWJsZS1nbG9iYWxzKw9yZWZlcmVuY2UtdHlwZXMrCHNpZ24tZXh0';
let vmLufsRuntimePromise = null;
let vmLufsWasmDisabled = false;

async function vmEnsureLufsRuntime() {
  if (vmLufsWasmDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmLufsRuntimePromise) return vmLufsRuntimePromise;

  vmLufsRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_LUFS_WASM_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (!memory || typeof exports.vm_kweight_accumulate !== 'function') {
        throw new Error('LUFS WASM exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmLufsWasmDisabled = true;
      console.warn('[lufs-wasm/fallback-js]', e);
      return null;
    }
  })();

  return vmLufsRuntimePromise;
}

function vmEnsureLufsMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  if (runtime.memory.buffer.byteLength >= need) return;
  runtime.memory.grow(Math.ceil((need - runtime.memory.buffer.byteLength) / 65536));
}

async function accumulateKWeightedBlockPowersWasmCooperative(
  samples, sr, blockSize, hop, blockPowers, shouldCancel
) {
  const runtime = await vmEnsureLufsRuntime();
  if (!runtime) return null;

  const { stage1, stage2 } = kWeightingCoeffs(sr);
  const chunkSize = 131072;
  const stateBytes = 10 * 8;
  const ringBytes = blockSize * 8;
  const blockBytes = blockPowers.length * 8;

  const statePtr = runtime.heapBase;
  const ringPtr = (statePtr + stateBytes + 15) & ~15;
  const blockPtr = (ringPtr + ringBytes + 15) & ~15;
  const inputPtr = (blockPtr + blockBytes + 15) & ~15;

  vmEnsureLufsMemory(runtime, (inputPtr - runtime.heapBase) + chunkSize * 4 + 64);

  const stateView = new Float64Array(runtime.memory.buffer, statePtr, 10);
  stateView.fill(0);
  new Float64Array(runtime.memory.buffer, ringPtr, blockSize).fill(0);

  const blockView = new Float64Array(runtime.memory.buffer, blockPtr, blockPowers.length);
  blockView.set(blockPowers);

  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);
    const len = end - start;

    const inputView = new Float32Array(runtime.memory.buffer, inputPtr, chunkSize);
    inputView.set(samples.subarray(start, end), 0);

    runtime.exports.vm_kweight_accumulate(
      inputPtr, len, start,
      blockSize, hop,
      stage1.b0, stage1.b1, stage1.b2, stage1.a1, stage1.a2,
      stage2.b0, stage2.b1, stage2.b2, stage2.a1, stage2.a2,
      statePtr, ringPtr, blockPtr, blockPowers.length
    );

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    if (end < samples.length) await yieldToBrowser();
  }

  blockPowers.set(blockView);
  return Math.round(stateView[9]);
}

async function accumulateKWeightedBlockPowersCooperative(
  samples, sr, blockSize, hop, blockPowers, shouldCancel
) {
  try {
    const wasmCount = await accumulateKWeightedBlockPowersWasmCooperative(
      samples, sr, blockSize, hop, blockPowers, shouldCancel
    );
    if (wasmCount != null) return wasmCount;
  } catch (e) {
    if (e && e.code === 'VM_EXPORT_CANCELLED') throw e;
    console.warn('[lufs-wasm/fallback-js]', e);
  }

  const { stage1, stage2 } = kWeightingCoeffs(sr);
  const ringSq = new Float64Array(blockSize);
  const chunkSize = 131072;

  let s1x1 = 0, s1x2 = 0, s1y1 = 0, s1y2 = 0;
  let s2x1 = 0, s2x2 = 0, s2y1 = 0, s2y2 = 0;
  let windowSum = 0;
  let bi = 0;

  // D202: K-weighted全曲波形を一切保持しない。
  // 400msリングバッファへ「二乗値」だけ保持し、
  // フィルタ出力とLUFS block power計算を1回の走査で完結する。
  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);

    for (let i = start; i < end; i++) {
      const x0 = samples[i];

      let y1 = stage1.b0 * x0 + stage1.b1 * s1x1 + stage1.b2 * s1x2
             - stage1.a1 * s1y1 - stage1.a2 * s1y2;
      y1 = Math.fround(y1);
      s1x2 = s1x1; s1x1 = x0; s1y2 = s1y1; s1y1 = y1;

      let y2 = stage2.b0 * y1 + stage2.b1 * s2x1 + stage2.b2 * s2x2
             - stage2.a1 * s2y1 - stage2.a2 * s2y2;
      y2 = Math.fround(y2);
      s2x2 = s2x1; s2x1 = y1; s2y2 = s2y1; s2y1 = y2;

      const sq = y2 * y2;
      const ringIndex = i % blockSize;

      if (i >= blockSize) windowSum -= ringSq[ringIndex];
      ringSq[ringIndex] = sq;
      windowSum += sq;

      if (i + 1 >= blockSize) {
        const blockStart = i + 1 - blockSize;
        if ((blockStart % hop) === 0 && bi < blockPowers.length) {
          blockPowers[bi] += Math.max(0, windowSum) / blockSize;
          bi++;
        }
      }
    }

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    if (end < samples.length) await yieldToBrowser();
  }

  return bi;
}


// モノラルchannel配列(複数チャンネル分)からIntegrated LUFSを計算する。
// チャンネルは全て同じ重み1.0で扱う(BS.1770のサラウンド用L/R以外の重み付けは
// ここでは扱わない。歌ってみたMIXは基本モノ/ステレオのため実用上問題ない)。
function finalizeIntegratedLufsFromBlockPowers(blockPowers) {
  if (blockPowers.length === 0) return { lufs: -Infinity, blockCount: 0 };

  const toLufs = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));

  // D309: gating判定中のMath.log10を除去。
  // LUFS > threshold は power > inverseLUFS(threshold) と完全に同じ比較なので、
  // 大量blockでのCPU負荷だけを下げ、最終LUFS式は従来のまま維持する。
  const absThresholdPower = Math.pow(10, (-70 + 0.691) / 10);

  let absSum = 0;
  let absCount = 0;
  for (let i = 0; i < blockPowers.length; i++) {
    const p = blockPowers[i];
    if (p > absThresholdPower) {
      absSum += p;
      absCount++;
    }
  }
  if (absCount === 0) return { lufs: -Infinity, blockCount: 0 };

  const meanAbs = absSum / absCount;
  // Relative gate = integrated absolute-gated loudness -10 LU.
  // In linear power this is exactly meanAbs / 10.
  const relThresholdPower = meanAbs / 10;

  let relSum = 0;
  let relCount = 0;
  for (let i = 0; i < blockPowers.length; i++) {
    const p = blockPowers[i];
    if (p > absThresholdPower && p > relThresholdPower) {
      relSum += p;
      relCount++;
    }
  }

  if (relCount === 0) return { lufs: toLufs(meanAbs), blockCount: absCount };
  return { lufs: toLufs(relSum / relCount), blockCount: relCount };
}

async function computeIntegratedLufsCooperative(channels, sr, shouldCancel) {
  if (!channels || !channels.length) return { lufs: -Infinity, blockCount: 0 };

  const blockSize = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  const n = channels[0].length;
  if (n < blockSize) return { lufs: -Infinity, blockCount: 0 };

  const blockCount = Math.max(0, Math.floor((n - blockSize) / hop) + 1);

  // D412: LUFS block powerの一時配列をFloat32化。最終sum/meanはJS Number(double)で累積。
  // 音声DSPには触れず、長尺測定時の一時メモリだけ半減する。
  const blockPowers = new Float32Array(blockCount);

  // D202: チャンネルごとにK-weightingとblock powerを直接累積。
  // 全曲長のweighted Float32Arrayを作らないため、
  // LUFS測定の一時メモリは400msリング + block power程度になる。
  for (let ch = 0; ch < channels.length; ch++) {
    await accumulateKWeightedBlockPowersCooperative(
      channels[ch], sr, blockSize, hop, blockPowers, shouldCancel
    );

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    await yieldToBrowser();
  }

  return finalizeIntegratedLufsFromBlockPowers(blockPowers);
}

// 互換用同期版。既存コード/将来拡張からの呼び出しを壊さない。
function computeIntegratedLufs(channels, sr) {
  const weighted = channels.map((ch) => applyKWeighting(ch, sr));
  const blockSize = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  const n = weighted[0].length;
  const blockPowers = [];
  for (let start = 0; start + blockSize <= n; start += hop) {
    let sum = 0;
    for (const ch of weighted) {
      let chSum = 0;
      for (let i = start; i < start + blockSize; i++) chSum += ch[i] * ch[i];
      sum += chSum / blockSize;
    }
    blockPowers.push(sum);
  }
  return finalizeIntegratedLufsFromBlockPowers(blockPowers);
}

/* =========================================================
   True Peak(サンプル間ピーク)推定。
   通常の「サンプルピーク」は実際のサンプル値の絶対値の最大でしかなく、
   D/A変換やストリーミング配信のエンコード時に生じる「サンプルとサンプルの
   間」のピーク(帯域制限された連続波形として復元した時の実際のピーク)を
   見落とすことがある。ITU-R BS.1770の付属書と同じ考え方で、窓付きsinc
   フィルタによる帯域制限補間を使い、各サンプル間を4倍にオーバーサンプル
   して真のピークを推定する。
   位相(サンプル間のどこを見るか)ごとにフィルタ係数を一度だけ計算し、
   毎回sin/cosを計算しない設計にすることで、4分の曲でも約1秒程度で
   計算できる(素朴な実装だと同じ精度で10秒以上かかった)。
   ※ これも簡易実装であり、放送・配信規格が定める正式なTrue Peak
   測定器と完全に一致する保証はない(参考値として扱ってほしい)。
   ========================================================= */
function sincKernel(x) { if (x === 0) return 1; return Math.sin(Math.PI * x) / (Math.PI * x); }
function hammingWindowTP(x, halfWidth) { if (Math.abs(x) > halfWidth) return 0; return 0.54 + 0.46 * Math.cos(Math.PI * x / halfWidth); }
function precomputeTruePeakPhaseCoeffs(oversample, halfWidth) {
  const phases = [];
  for (let k = 1; k < oversample; k++) {
    const frac = k / oversample;
    const coeffs = new Float64Array(halfWidth * 2);
    let sum = 0;

    for (let j = -halfWidth + 1, idx = 0; j <= halfWidth; j++, idx++) {
      const x = frac - j;
      const value = sincKernel(x) * hammingWindowTP(x, halfWidth);
      coeffs[idx] = value;
      sum += value;
    }

    // D291: phaseごとのDC gainを1に正規化。
    // 補間位相によってわずかに振幅が変わる誤差を抑える。
    if (Math.abs(sum) > 1e-15) {
      const inv = 1 / sum;
      for (let i = 0; i < coeffs.length; i++) coeffs[i] *= inv;
    }

    phases.push(coeffs);
  }
  return phases;
}

// D162: True Peakの補間係数はoversample/halfWidthが同じなら不変。
// 通常書き出し・YouTube・Fire Lit検証で同じ係数を何度も作らない。
const VM_TRUE_PEAK_PHASE_CACHE = new Map();

function getTruePeakPhaseCoeffs(oversample, halfWidth) {
  const key = `${oversample}|${halfWidth}`;
  const cached = VM_TRUE_PEAK_PHASE_CACHE.get(key);
  if (cached) return cached;

  const coeffs = precomputeTruePeakPhaseCoeffs(oversample, halfWidth);
  VM_TRUE_PEAK_PHASE_CACHE.set(key, coeffs);

  // 将来別設定が増えても小さく保つ。
  if (VM_TRUE_PEAK_PHASE_CACHE.size > 8) {
    VM_TRUE_PEAK_PHASE_CACHE.delete(VM_TRUE_PEAK_PHASE_CACHE.keys().next().value);
  }
  return coeffs;
}
function estimateTruePeak(samples, oversample, halfWidth) {
  oversample = oversample || 4; halfWidth = halfWidth || 8;
  const phaseCoeffs = getTruePeakPhaseCoeffs(oversample, halfWidth);
  let maxPeak = 0;
  for (let i = 0; i < samples.length; i++) maxPeak = Math.max(maxPeak, Math.abs(samples[i]));
  for (let i = 0; i < samples.length - 1; i++) {
    for (const coeffs of phaseCoeffs) {
      let acc = 0;
      for (let t = 0, j = i - halfWidth + 1; t < coeffs.length; t++, j++) {
        if (j < 0 || j >= samples.length) continue;
        acc += samples[j] * coeffs[t];
      }
      if (Math.abs(acc) > maxPeak) maxPeak = Math.abs(acc);
    }
  }
  return maxPeak;
}
