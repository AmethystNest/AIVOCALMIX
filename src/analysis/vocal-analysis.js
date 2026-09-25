// Vocal / instrumental / harmony analysis: analyze(), analyzeRelative(),
// analyzeHarmonySummary(), the harmony analysis proxy and the peak/RMS WASM
// helpers they use. Moved verbatim from the main app script in index.html and
// loaded as a classic script before it.
// Uses spectrum-core.js, plus these globals from the app script at call time:
// yieldToBrowser, vmDecodeBase64Bytes, vmWasmGlobalNumber.
const VM_ANALYSIS_STATS_WASM_BASE64 = 'AGFzbQEAAAABEAJgA39/fwF/YAR/f39/AX8DAwIAAQUFAQEQgAgGDwJ/AUGAiAQLfwBBgIgECwdKBAZtZW1vcnkCABZ2bV9wZWFrX3Jtc19hY2N1bXVsYXRlAAAWdm1fcGFpcl9ybXNfYWNjdW11bGF0ZQABC19faGVhcF9iYXNlAwEK2AICnwEEAnwBfwF9AnwgAisDCCEDIAIrAwAhBAJAAkAgAUEBSA0AA0BBACEFIAAqAgAiBrsiB0ScdQCIPOQ3/mMNAiAGIAZcDQIgB0ScdQCIPOQ3fmQNAiAHmiAHIAZDAAAAAF0bIgggBCAIIARkGyEEIABBBGohACAHIAeiIAOgIQMgAUF/aiIBDQALCyACIAM5AwggAiAEOQMAQQEhBQsgBQu0AQQCfAF/AX0CfCADKwMIIQQgAysDACEFAkACQCACQQFIDQADQEEAIQYgACoCACIHIAdcDQIgB7siCEScdQCIPOQ3/mMNAiABKgIAIgcgB1wNAiAIRJx1AIg85Dd+ZA0CIAe7IgmZRJx1AIg85Dd+ZA0CIABBBGohACABQQRqIQEgCSAJoiAEoCEEIAggCKIgBaAhBSACQX9qIgINAAsLIAMgBDkDCCADIAU5AwBBASEGCyAGCwBZBG5hbWUACwpzdGF0cy53YXNtATECABZ2bV9wZWFrX3Jtc19hY2N1bXVsYXRlARZ2bV9wYWlyX3Jtc19hY2N1bXVsYXRlBxIBAA9fX3N0YWNrX3BvaW50ZXIAfwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQEFY2xhbmdfMTcuMC4wIChodHRwczovL2dpdGh1Yi5jb20vc3dpZnRsYW5nL2xsdm0tcHJvamVjdC5naXQgMTA5OTliNmQwMzRmZTMxOGYzZDU2YzgzYmRkYjY1NzI1OTNhOGJiMCkASQ90YXJnZXRfZmVhdHVyZXMEKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=';
let vmAnalysisStatsRuntimePromise = null;
let vmAnalysisStatsWasmDisabled = false;

async function vmEnsureAnalysisStatsRuntime() {
  if (vmAnalysisStatsWasmDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmAnalysisStatsRuntimePromise) return vmAnalysisStatsRuntimePromise;

  vmAnalysisStatsRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_ANALYSIS_STATS_WASM_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (!memory ||
          typeof exports.vm_peak_rms_accumulate !== 'function' ||
          typeof exports.vm_pair_rms_accumulate !== 'function') {
        throw new Error('Analysis Stats WASM exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmAnalysisStatsWasmDisabled = true;
      console.warn('[analysis-stats-wasm/fallback-js]', e);
      return null;
    }
  })();

  return vmAnalysisStatsRuntimePromise;
}

function vmEnsureAnalysisStatsMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  if (runtime.memory.buffer.byteLength >= need) return;
  runtime.memory.grow(Math.ceil((need - runtime.memory.buffer.byteLength) / 65536));
}

async function vmMeasurePeakAndRmsCooperative(samples) {
  const runtime = await vmEnsureAnalysisStatsRuntime();
  if (!runtime) return null;

  const chunkSize = 131072;
  const statePtr = runtime.heapBase;
  const inputPtr = (statePtr + 16 + 15) & ~15;
  vmEnsureAnalysisStatsMemory(runtime, (inputPtr - runtime.heapBase) + chunkSize * 4 + 64);

  const stateView = new Float64Array(runtime.memory.buffer, statePtr, 2);
  stateView[0] = 0;
  stateView[1] = 0;

  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);
    const len = end - start;
    const input = new Float32Array(runtime.memory.buffer, inputPtr, chunkSize);
    input.set(samples.subarray(start, end), 0);

    const ok = runtime.exports.vm_peak_rms_accumulate(inputPtr, len, statePtr);
    if (!ok) {
      const err = new Error('解析音声に不正なサンプル値(NaN/Infinity)を検出しました');
      err.code = 'VM_INVALID_AUDIO_SAMPLE';
      throw err;
    }
    if (end < samples.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    peak: stateView[0],
    rms: Math.sqrt(stateView[1] / Math.max(samples.length, 1))
  };
}

async function vmMeasurePairRmsCooperative(a, b, n) {
  const runtime = await vmEnsureAnalysisStatsRuntime();
  if (!runtime) return null;

  const chunkSize = 131072;
  const statePtr = runtime.heapBase;
  const aPtr = (statePtr + 16 + 15) & ~15;
  const bPtr = (aPtr + chunkSize * 4 + 15) & ~15;
  vmEnsureAnalysisStatsMemory(runtime, (bPtr - runtime.heapBase) + chunkSize * 4 + 64);

  const stateView = new Float64Array(runtime.memory.buffer, statePtr, 2);
  stateView[0] = 0;
  stateView[1] = 0;

  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(n, start + chunkSize);
    const len = end - start;
    new Float32Array(runtime.memory.buffer, aPtr, chunkSize).set(a.subarray(start, end), 0);
    new Float32Array(runtime.memory.buffer, bPtr, chunkSize).set(b.subarray(start, end), 0);

    const ok = runtime.exports.vm_pair_rms_accumulate(aPtr, bPtr, len, statePtr);
    if (!ok) {
      const err = new Error('相対解析音声に不正なサンプル値(NaN/Infinity)を検出しました');
      err.code = 'VM_INVALID_AUDIO_SAMPLE';
      throw err;
    }
    if (end < n) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const denom = Math.max(n, 1);
  return {
    rmsA: Math.sqrt(stateView[0] / denom),
    rmsB: Math.sqrt(stateView[1] / denom)
  };
}

async function measurePeakAndRmsCooperative(samples) {
  try {
    const wasmResult = await vmMeasurePeakAndRmsCooperative(samples);
    if (wasmResult) return wasmResult;
  } catch (e) {
    if (e && e.code === 'VM_INVALID_AUDIO_SAMPLE') throw e;
    console.warn('[analysis-stats-wasm/fallback-js]', e);
  }

  // D325: Analyze冒頭の全曲Peak走査 + 全曲RMS走査を1回に統合。
  // RMSの加算順序は従来rmsOf(0..N)と同じなので数値結果を維持する。
  let peak = 0;
  let sum = 0;
  const chunkSize = 131072;

  for (let start = 0; start < samples.length; start += chunkSize) {
    const end = Math.min(samples.length, start + chunkSize);
    for (let i = start; i < end; i++) {
      const x = samples[i];
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      sum += x * x;
    }
    if (end < samples.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    peak,
    rms: Math.sqrt(sum / Math.max(samples.length, 1))
  };
}

async function analyze(samples, sr, onProgress) {
  const initialStats = await measurePeakAndRmsCooperative(samples);
  const peak = initialStats.peak;
  const rms = initialStats.rms;

  const frameSize = 2048;
  const durationSec = samples.length / Math.max(1, sr);
  const hop = durationSec > 180 ? 1024 : 512;
  let centroidSum = 0, centroidCount = 0;
  let sibilantEnergy = 0, totalEnergy = 0;
  let boxyEnergy = 0, muddyEnergy = 0, harshEnergy = 0;

  const totalFrames = Math.max(1, Math.floor((samples.length - frameSize) / hop) + 1);
  const rmsFrames = new Float64Array(totalFrames);
  const distortionRms = new Float64Array(totalFrames);
  const distortionHiRatio = new Float64Array(totalFrames);
  let rmsFrameCount = 0;
  let distortionCount = 0;

  // D321: 全frameで同じ2048-point FFT workspace/Hann/frequency tableを再利用。
  // 解析式・帯域判定・thresholdは従来と同じ。
  const spectrumWorkspace = createSpectrumWorkspace(frameSize, sr);
  const freqs = spectrumWorkspace.freqs;
  const sibRange = getInclusiveFrequencyBinRange(freqs, 5000, 8000);
  const boxyRange = getInclusiveFrequencyBinRange(freqs, 200, 500);
  const muddyRange = getInclusiveFrequencyBinRange(freqs, 500, 1000);
  const harshRange = getInclusiveFrequencyBinRange(freqs, 2000, 4000);
  const midRange = getInclusiveFrequencyBinRange(freqs, 800, 2500);
  const upperHiRange = getInclusiveFrequencyBinRange(freqs, 8000, 12000);

  let frameIdx = 0, sinceYield = 0;
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    // D337: RMS算出だけのためのsubarray objectを作らない。
    // FFTが必要な有効frameだけsubarray viewを作る。
    const frameRms = rmsOf(samples, start, frameSize);
    rmsFrames[rmsFrameCount++] = frameRms;
    frameIdx++;

    if (frameRms >= 1e-4) {
      const mag = magnitudeSpectrumRangeInto(samples, start, frameSize, spectrumWorkspace);
      let magSum = 0, weighted = 0, sib = 0, boxy = 0, muddy = 0, harsh = 0;
      let mid = 0, upperHi = 0;

      for (let i = 0; i < mag.length; i++) {
        magSum += mag[i];
        weighted += mag[i] * freqs[i];
      }
      // D333: fixed analysis bands use cached bin ranges instead of six
      // frequency comparisons for every FFT bin of every frame.
      for (let i = sibRange.start; i < sibRange.end; i++) sib += mag[i];
      for (let i = boxyRange.start; i < boxyRange.end; i++) boxy += mag[i];
      for (let i = muddyRange.start; i < muddyRange.end; i++) muddy += mag[i];
      for (let i = harshRange.start; i < harshRange.end; i++) harsh += mag[i];
      for (let i = midRange.start; i < midRange.end; i++) mid += mag[i];
      for (let i = upperHiRange.start; i < upperHiRange.end; i++) upperHi += mag[i];

      if (magSum > 0) { centroidSum += weighted / magSum; centroidCount++; }
      sibilantEnergy += sib; totalEnergy += magSum;
      boxyEnergy += boxy; muddyEnergy += muddy; harshEnergy += harsh;

      if (mid > 1e-9) {
        distortionRms[distortionCount] = frameRms;
        distortionHiRatio[distortionCount] = upperHi / mid;
        distortionCount++;
      }
    }

    sinceYield++;
    if (sinceYield >= 24) {
      sinceYield = 0;
      if (onProgress) onProgress(frameIdx / totalFrames);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const centroid = centroidCount > 0 ? centroidSum / centroidCount : 0;
  const sibilanceRatio = totalEnergy > 0 ? sibilantEnergy / totalEnergy : 0;
  const boxyRatio = totalEnergy > 0 ? boxyEnergy / totalEnergy : 0;
  const muddyRatio = totalEnergy > 0 ? muddyEnergy / totalEnergy : 0;
  const harshRatio = totalEnergy > 0 ? harshEnergy / totalEnergy : 0;
  const crest = dbfs(peak) - dbfs(rms);

  let distortionRatio = 1;
  if (distortionCount >= 8) {
    // Sort indices by RMS exactly as the previous object-array sort did.
    const order = new Uint32Array(distortionCount);
    for (let i = 0; i < distortionCount; i++) order[i] = i;
    const orderArray = Array.from(order);
    orderArray.sort((a, b) => distortionRms[a] - distortionRms[b]);

    const q = Math.max(1, Math.floor(distortionCount / 4));
    let quietSum = 0, loudSum = 0;
    for (let i = 0; i < q; i++) quietSum += distortionHiRatio[orderArray[i]];
    for (let i = distortionCount - q; i < distortionCount; i++) loudSum += distortionHiRatio[orderArray[i]];
    const quietAvg = quietSum / q;
    const loudAvg = loudSum / q;
    if (quietAvg > 1e-9) distortionRatio = loudAvg / quietAvg;
  }

  const usedRmsFrames = rmsFrames.subarray(0, rmsFrameCount);
  usedRmsFrames.sort();

  // D337: sorted RMSは閾値以下が先頭に並ぶため、filter用の新規配列を作らずview化。
  let firstNonZero = 0;
  while (firstNonZero < usedRmsFrames.length && usedRmsFrames[firstNonZero] <= 1e-5) {
    firstNonZero++;
  }
  const nonZero = usedRmsFrames.subarray(firstNonZero);

  let dynamicRange = 0;
  let noiseFloorDb = -80;
  let quietDropDb = 0, peakSpreadDb = 0, quietInstability = 0, peakInstability = 0;
  if (nonZero.length > 4) {
    const pick = (q) => nonZero[Math.min(nonZero.length - 1, Math.max(0, Math.floor(nonZero.length * q)))];
    const p10 = pick(0.10), p25 = pick(0.25), p50 = pick(0.50), p75 = pick(0.75), p95 = pick(0.95);
    dynamicRange = dbfs(p95) - dbfs(p10);
    noiseFloorDb = dbfs(p10);
    quietDropDb = Math.max(0, dbfs(p50) - dbfs(p25));
    peakSpreadDb = Math.max(0, dbfs(p95) - dbfs(p75));
    quietInstability = Math.max(0, Math.min(1, (quietDropDb - 2.5) / 7.5));
    peakInstability = Math.max(0, Math.min(1, (peakSpreadDb - 2.0) / 7.0));
  }

  return {
    peakDbfs: dbfs(peak), rmsDbfs: dbfs(rms), crestFactorDb: crest,
    dynamicRangeDb: dynamicRange, quietDropDb, peakSpreadDb, quietInstability, peakInstability,
    spectralCentroidHz: centroid, sibilanceRatio, noiseFloorDb,
    boxyRatio, muddyRatio, harshRatio,
    distortionRatio,
  };
}



// D54: Harmony解析はレンダリング用の44.1/48kHz生波形を直接走査しない。
// 解析専用の低レートproxyを1回だけ作り、以後のHarmony解析すべてで再利用する。
// 音声レンダリング自体は元のフルレート波形を使うため、音質は変えない。

async function buildHarmonyAnalysisProxyFromBuffer(mainSamples, harmonyBuffer, sourceSr) {
  const targetSr = 16000;
  const stride = Math.max(1, Math.round(sourceSr / targetSr));
  const actualSr = sourceSr / stride;
  const n = Math.min(mainSamples.length, harmonyBuffer.length);
  const outLen = Math.ceil(n / stride);

  const main = new Float32Array(outLen);
  const harmony = new Float32Array(outLen);
  const a = harmonyBuffer.getChannelData(0);
  const b = harmonyBuffer.numberOfChannels > 1 ? harmonyBuffer.getChannelData(1) : null;
  const chunk = 131072;

  for (let outStart = 0; outStart < outLen; outStart += chunk) {
    const outEnd = Math.min(outLen, outStart + chunk);
    for (let j = outStart; j < outEnd; j++) {
      const srcIndex = Math.min(n - 1, j * stride);
      main[j] = mainSamples[srcIndex];
      harmony[j] = b ? (a[srcIndex] + b[srcIndex]) / 2 : a[srcIndex];
    }
    if (outEnd < outLen) await yieldToBrowser();
  }

  return { main, harmony, sr: actualSr, stride };
}

async function buildHarmonyAnalysisProxy(mainSamples, harmonySamples, sourceSr) {
  const targetSr = 16000;
  const stride = Math.max(1, Math.round(sourceSr / targetSr));
  const actualSr = sourceSr / stride;
  const n = Math.min(mainSamples.length, harmonySamples.length);
  const outLen = Math.ceil(n / stride);

  const main = new Float32Array(outLen);
  const harmony = new Float32Array(outLen);
  const chunk = 131072;

  for (let outStart = 0; outStart < outLen; outStart += chunk) {
    const outEnd = Math.min(outLen, outStart + chunk);
    for (let j = outStart; j < outEnd; j++) {
      const srcIndex = Math.min(n - 1, j * stride);
      main[j] = mainSamples[srcIndex];
      harmony[j] = harmonySamples[srcIndex];
    }
    if (outEnd < outLen) await yieldToBrowser();
  }

  return { main, harmony, sr: actualSr, stride };
}

// D51: Harmony専用の軽量サマリー解析。
// Harmony側で実際に必要なのは主にPeak/RMS/Crestと概算Centroid。
// Vocal用analyze()の歪み・歯擦音・共鳴・全フレームFFTまで毎回回す必要はない。
// Centroidは全曲から最大96窓を均等サンプリングして概算し、スマホのCPU負荷を大幅に抑える。
async function analyzeHarmonySummary(samples, sr, onProgress) {
  const n = samples.length;
  let peak = 0, sumSq = 0;
  const chunk = 262144;
  for (let start = 0; start < n; start += chunk) {
    const end = Math.min(n, start + chunk);
    for (let i = start; i < end; i++) {
      const x = samples[i];
      const a = Math.abs(x);
      if (a > peak) peak = a;
      sumSq += x * x;
    }
    if (onProgress) onProgress(0.42 * (end / Math.max(1, n)));
    if (end < n) await yieldToBrowser();
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));

  const frameSize = 2048;
  const maxFrames = 96;
  const usable = Math.max(0, n - frameSize);
  const frameCount = usable > 0 ? Math.min(maxFrames, Math.max(1, Math.floor(usable / frameSize))) : 0;
  let centroidSum = 0, centroidCount = 0;

  for (let j = 0; j < frameCount; j++) {
    const pos = frameCount <= 1 ? 0 : Math.floor((usable * j) / (frameCount - 1));
    const frame = samples.subarray(pos, pos + frameSize);
    const frms = rmsOf(frame, 0, frameSize);
    if (frms > 1e-4) {
      const { mag, freqs } = magnitudeSpectrum(frame, sr);
      let magSum = 0, weighted = 0;
      for (let k = 0; k < mag.length; k++) {
        magSum += mag[k];
        weighted += mag[k] * freqs[k];
      }
      if (magSum > 0) {
        centroidSum += weighted / magSum;
        centroidCount++;
      }
    }
    if (j % 6 === 5) {
      if (onProgress) onProgress(0.42 + 0.58 * ((j + 1) / Math.max(1, frameCount)));
      await yieldToBrowser();
    }
  }

  if (onProgress) onProgress(1);
  const centroid = centroidCount ? centroidSum / centroidCount : 0;
  return {
    peakDbfs: dbfs(peak),
    rmsDbfs: dbfs(rms),
    crestFactorDb: dbfs(peak) - dbfs(rms),
    spectralCentroidHz: centroid
  };
}

async function measurePairRmsCooperative(a, b, n) {
  try {
    const wasmResult = await vmMeasurePairRmsCooperative(a, b, n);
    if (wasmResult) return wasmResult;
  } catch (e) {
    if (e && e.code === 'VM_INVALID_AUDIO_SAMPLE') throw e;
    console.warn('[analysis-stats-wasm/fallback-js]', e);
  }

  // D329: Vocal/Instrumentalの全曲RMSを2回の同期走査ではなく1回で計算。
  // 各channelの加算順序は従来rmsOf(0..n)と同じなので数値結果を維持する。
  let sumA = 0;
  let sumB = 0;
  const chunkSize = 131072;

  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(n, start + chunkSize);
    for (let i = start; i < end; i++) {
      const av = a[i];
      const bv = b[i];
      sumA += av * av;
      sumB += bv * bv;
    }
    if (end < n) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const denom = Math.max(n, 1);
  return {
    rmsA: Math.sqrt(sumA / denom),
    rmsB: Math.sqrt(sumB / denom)
  };
}

async function analyzeRelative(vocalSamples, instSamples, sr, onProgress) {
  const n = Math.min(vocalSamples.length, instSamples.length);
  const v = vocalSamples.subarray(0, n);
  const i = instSamples.subarray(0, n);
  const pairRms = await measurePairRmsCooperative(v, i, n);
  const levelDiff = dbfs(pairRms.rmsA) - dbfs(pairRms.rmsB);

  const frameSize = 2048, hop = 1024;
  const frameCount = Math.max(0, Math.floor((n - frameSize) / hop) + 1);
  const vocalRms = new Float64Array(frameCount);

  let maxVRms = 0, vPresence = 0, vTotal = 0;
  let scanIdx = 0;

  // D323: vf/inf subarray objectsをframeごとに保持せず、start+RMSだけ保存。
  for (let start = 0; start + frameSize <= n; start += hop) {
    // D393: rmsOf()第3引数は固定窓の「長さ」。
    // 後半ほど窓が肥大化する旧バグを戻さず、2048サンプル窓を維持する。
    const vr = rmsOf(v, start, frameSize);
    vocalRms[scanIdx] = vr;
    maxVRms = Math.max(maxVRms, vr);
    scanIdx++;

    if (scanIdx % 80 === 0) {
      if (onProgress) onProgress(0.18 * (scanIdx / Math.max(1, frameCount)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const activeThreshold = Math.max(1e-5, maxVRms * 0.08);
  let active = 0, masked = 0, overlapSum = 0, snrSum = 0;
  let activeV2 = 0, activeI2 = 0, activeSampleCount = 0;

  // One workspace per signal, reused for every active frame.
  const vocalWorkspace = createSpectrumWorkspace(frameSize, sr);
  const instWorkspace = createSpectrumWorkspace(frameSize, sr);
  const freqs = vocalWorkspace.freqs;
  const presenceRange = getInclusiveFrequencyBinRange(freqs, 1000, 3000);
  const maskingRange = getInclusiveFrequencyBinRange(freqs, 1000, 4000);

  let relIdx = 0;
  for (let fi = 0; fi < frameCount; fi++) {
    relIdx++;
    const start = fi * hop;
    const vr = vocalRms[fi];

    if (vr < activeThreshold) {
      if (relIdx % 24 === 0) {
        if (onProgress) onProgress(0.18 + 0.82 * (relIdx / Math.max(1, frameCount)));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      continue;
    }

    active++;
    for (let j = 0; j < frameSize; j++) {
      const vv = v[start + j];
      const ii = i[start + j];
      activeV2 += vv * vv;
      activeI2 += ii * ii;
    }
    activeSampleCount += frameSize;

    const magV = magnitudeSpectrumRangeInto(v, start, frameSize, vocalWorkspace);
    const magI = magnitudeSpectrumRangeInto(i, start, frameSize, instWorkspace);

    let vBand = 0, iBand = 0, overlap = 0, union = 0;
    for (let k = 0; k < magV.length; k++) vTotal += magV[k];
    for (let k = presenceRange.start; k < presenceRange.end; k++) {
      vPresence += magV[k];
    }
    // D335: masking/presence frequency tests are pre-resolved to bin ranges.
    for (let k = maskingRange.start; k < maskingRange.end; k++) {
      vBand += magV[k];
      iBand += magI[k];
      overlap += Math.min(magV[k], magI[k]);
      union += Math.max(magV[k], magI[k]);
    }

    const snrDb = 20 * Math.log10((vBand + 1e-9) / (iBand + 1e-9));
    const ov = union > 0 ? overlap / union : 0;
    snrSum += snrDb;
    overlapSum += ov;
    if (snrDb < 1.5 && ov > 0.28) masked++;

    if (relIdx % 12 === 0) {
      if (onProgress) onProgress(0.18 + 0.82 * (relIdx / Math.max(1, frameCount)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (onProgress) onProgress(1);
  const activeCount = Math.max(active, 1);
  const avgSnrDb = snrSum / activeCount;
  const spectralOverlap = overlapSum / activeCount;
  const maskingOccupancy = masked / activeCount;
  const snrRisk = Math.max(0, Math.min(1, (6 - avgSnrDb) / 12));
  const maskingScore = Math.max(0, Math.min(1,
    0.45 * snrRisk + 0.30 * spectralOverlap + 0.25 * maskingOccupancy));
  const presenceRatio = vTotal > 0 ? vPresence / vTotal : 0;
  const activeVRms = Math.sqrt(activeV2 / Math.max(activeSampleCount, 1));
  const activeIRms = Math.sqrt(activeI2 / Math.max(activeSampleCount, 1));
  const activeLevelDiffDb = dbfs(activeVRms) - dbfs(activeIRms);

  const loudRisk = Math.max(0, Math.min(1, (activeLevelDiffDb + 4) / 6));
  const quietRisk = Math.max(0, Math.min(1, (-4 - activeLevelDiffDb) / 8));
  const presenceHighRisk = Math.max(0, Math.min(1, (presenceRatio - 0.20) / 0.12));
  const presenceLowRisk = Math.max(0, Math.min(1, (0.16 - presenceRatio) / 0.10));
  const floatingScore = Math.max(0, Math.min(1,
    0.62 * loudRisk + 0.23 * (1 - maskingScore) + 0.15 * presenceHighRisk));
  const buriedScore = Math.max(0, Math.min(1,
    0.42 * quietRisk + 0.38 * maskingScore + 0.20 * presenceLowRisk));

  let placement = 'balanced';
  if (floatingScore >= 0.58 && floatingScore > buriedScore + 0.08) placement = 'floating';
  else if (buriedScore >= 0.52 && buriedScore > floatingScore + 0.05) placement = 'buried';

  return {
    levelDiffDb: levelDiff,
    activeLevelDiffDb,
    maskingRatio2_5k: maskingScore,
    vocalPresenceRatio1_3k: presenceRatio,
    maskingSnrDb1_4k: avgSnrDb,
    spectralOverlap1_4k: spectralOverlap,
    maskingOccupancy,
    activeVocalFrameRatio: frameCount ? active / frameCount : 0,
    floatingScore, buriedScore, placement,
  };
}
