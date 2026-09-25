// True Peak measurement (WASM kernel with JS fallback, measureTruePeakBuffer)
// and in-place buffer gain helpers. Moved verbatim from the main app script
// in index.html; loaded before it. Uses getTruePeakPhaseCoeffs
// (loudness.js), the DSP WASM runtime (src/dsp/sample-dsp.js), VM_PLATFORM
// and yieldToBrowser at call time.
const VM_TRUE_PEAK_WASM_BASE64 = 'AGFzbQEAAAABDwFgCn9/f39/f39/f38BfAMCAQAFBQEBEIAIBg8CfwFBgIgEC38AQYCIBAsHLAMGbWVtb3J5AgARdm1fdHJ1ZV9wZWFrX3NjYW4AAAtfX2hlYXBfYmFzZQMBCv4HAfsHBgF8AX8BfAF9AXwLf0QAAAAAAAAAACEKAkAgByAGTA0AAkAgA0EASg0AIAcgBmshCyAAIAZBAnRqIQlEAAAAAAAAAAAhDANARAAAAAAAAPh/IQogCSoCACINuyIORJx1AIg85Df+Yw0CIA0gDVwNAiAORJx1AIg85Dd+ZA0CIAlBBGohCSAOmiAOIA1DAAAAAF0bIg4gDCAOIAxkGyIMIQogC0F/aiILDQAMAgsLIAlBf2ohDwJAIARBAEoNACADQfj///8HcSEQIANBB3EhCyADQQhJIQFEAAAAAAAAAAAhCgNAIAohDEQAAAAAAAD4fyEKIAAgBkECdGoqAgAiDbsiDkScdQCIPOQ3/mMNAiANIA1cDQIgDkScdQCIPOQ3fmQNAiAOmiAOIA1DAAAAAF0bIg4gDCAOIAxkGyEKAkAgBiAIaiAPTg0AIBAhCQJAIAENAANARAAAAAAAAAAAIAogCkQAAAAAAAAAAGMbIQogCUF4aiIJDQALCyALRQ0AIAshCQNARAAAAAAAAAAAIAogCkQAAAAAAAAAAGMbIQogCUF/aiIJDQALCyAGQQFqIgYgB0YNAgwACwsgBkECdCAFQQJ0ayAAakEIaiERIARBA3QhEiAGIAVrIRMgBEH+////B3EhFCAEQQFxIRVEAAAAAAAAAAAhCgNAAkAgACAGQQJ0aioCACINuyIORJx1AIg85Df+Y0UNAEQAAAAAAAD4fw8LAkAgDSANWw0ARAAAAAAAAPh/DwsCQCAORJx1AIg85Dd+ZEUNAEQAAAAAAAD4fw8LIA6aIA4gDUMAAAAAXRsiDiAKIA4gCmQbIQoCQCAGIAhqIA9ODQAgBiAFa0EBaiEWQQAhFyACIRgDQEQAAAAAAAAAACEOQQAhCQJAIARBAUYNAEQAAAAAAAAAACEOQQAhCSAYIQsgESEQA0ACQCATIAlqIhlBAWogAU8NACAQQXxqKgIAuyALKwMAoiAOoCEOCwJAIBlBAmogAU8NACAQKgIAuyALQQhqKwMAoiAOoCEOCyALQRBqIQsgEEEIaiEQIBQgCUECaiIJRw0ACwsCQCAVRQ0AIBYgCWoiCyABTw0AIAAgC0ECdGoqAgC7IAIgFyAEbEEDdGogCUEDdGorAwCiIA6gIQ4LAkAgDkScdQCIPOQ3/mNFDQBEAAAAAAAA+H8PCwJAIA4gDmENAEQAAAAAAAD4fw8LAkAgDkScdQCIPOQ3fmRFDQBEAAAAAAAA+H8PCyAOmiAOIA5EAAAAAAAAAABjGyIOIAogDiAKZBshCiAYIBJqIRggF0EBaiIXIANHDQALCyATQQFqIRMgEUEEaiERIAZBAWoiBiAHRw0ACwsgCgsAOQRuYW1lAAgHdHAud2FzbQEUAQARdm1fdHJ1ZV9wZWFrX3NjYW4HEgEAD19fc3RhY2tfcG9pbnRlcgB/CXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQVjbGFuZ18xNy4wLjAgKGh0dHBzOi8vZ2l0aHViLmNvbS9zd2lmdGxhbmcvbGx2bS1wcm9qZWN0LmdpdCAxMDk5OWI2ZDAzNGZlMzE4ZjNkNTZjODNiZGRiNjU3MjU5M2E4YmIwKQBJD3RhcmdldF9mZWF0dXJlcwQrCm11bHRpdmFsdWUrD211dGFibGUtZ2xvYmFscysPcmVmZXJlbmNlLXR5cGVzKwhzaWduLWV4dA==';
let vmTruePeakRuntimePromise = null;
let vmTruePeakWasmDisabled = false;
const VM_TRUE_PEAK_FLAT_COEFF_CACHE = new Map();

async function vmEnsureTruePeakRuntime() {
  if (vmTruePeakWasmDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmTruePeakRuntimePromise) return vmTruePeakRuntimePromise;

  vmTruePeakRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_TRUE_PEAK_WASM_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (!memory || typeof exports.vm_true_peak_scan !== 'function') {
        throw new Error('True Peak WASM exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmTruePeakWasmDisabled = true;
      console.warn('[truepeak-wasm/fallback-js]', e);
      return null;
    }
  })();

  return vmTruePeakRuntimePromise;
}

function vmEnsureTruePeakMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  if (runtime.memory.buffer.byteLength >= need) return;
  runtime.memory.grow(Math.ceil((need - runtime.memory.buffer.byteLength) / 65536));
}

function getFlatTruePeakCoeffs(oversample, halfWidth) {
  const key = `${oversample}|${halfWidth}`;
  const cached = VM_TRUE_PEAK_FLAT_COEFF_CACHE.get(key);
  if (cached) return cached;

  const phases = getTruePeakPhaseCoeffs(oversample, halfWidth);
  const taps = halfWidth * 2;
  const flat = new Float64Array(phases.length * taps);
  for (let p = 0; p < phases.length; p++) flat.set(phases[p], p * taps);

  if (VM_TRUE_PEAK_FLAT_COEFF_CACHE.size >= 8) {
    VM_TRUE_PEAK_FLAT_COEFF_CACHE.delete(VM_TRUE_PEAK_FLAT_COEFF_CACHE.keys().next().value);
  }
  VM_TRUE_PEAK_FLAT_COEFF_CACHE.set(key, flat);
  return flat;
}

async function estimateTruePeakWasmCooperative(samples, oversample, halfWidth, shouldCancel) {
  const runtime = await vmEnsureTruePeakRuntime();
  if (!runtime) return null;

  const phases = Math.max(0, oversample - 1);
  const taps = halfWidth * 2;
  const flat = getFlatTruePeakCoeffs(oversample, halfWidth);
  // D413: iPhoneはTrue Peak WASMの1回あたり処理量を半分にして、
  // 長尺Export中にSafariのUIイベントループへ戻る間隔を短縮する。
  // overlap/係数/走査範囲は同じためTrue Peak算出値は不変。
  const chunkSize = (typeof VM_PLATFORM !== 'undefined' && VM_PLATFORM && VM_PLATFORM.isiOS) ? 16384 : 32768;
  const overlap = halfWidth + 2;
  const maxInputLen = chunkSize + overlap * 2 + 8;

  const coeffPtr = runtime.heapBase;
  const inputPtr = (coeffPtr + flat.byteLength + 15) & ~15;
  vmEnsureTruePeakMemory(runtime, (inputPtr - runtime.heapBase) + maxInputLen * 4 + 64);

  new Float64Array(runtime.memory.buffer, coeffPtr, flat.length).set(flat);

  let maxPeak = 0;

  for (let chunkStart = 0; chunkStart < samples.length; chunkStart += chunkSize) {
    const chunkEnd = Math.min(samples.length, chunkStart + chunkSize);
    const srcStart = Math.max(0, chunkStart - overlap);
    const srcEnd = Math.min(samples.length, chunkEnd + overlap);
    const inputLen = srcEnd - srcStart;

    const wasmInput = new Float32Array(runtime.memory.buffer, inputPtr, maxInputLen);
    wasmInput.set(samples.subarray(srcStart, srcEnd), 0);

    const localPeak = runtime.exports.vm_true_peak_scan(
      inputPtr,
      inputLen,
      coeffPtr,
      phases,
      taps,
      halfWidth,
      chunkStart - srcStart,
      chunkEnd - srcStart,
      srcStart,
      samples.length
    );

    if (!Number.isFinite(localPeak)) {
      const err = new Error('True Peak計算中に不正なサンプル値(NaN/Infinity)を検出しました');
      err.code = 'VM_INVALID_AUDIO_SAMPLE';
      throw err;
    }
    if (localPeak > maxPeak) maxPeak = localPeak;

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    if (chunkEnd < samples.length) await yieldToBrowser();
  }

  return maxPeak;
}

async function estimateTruePeakCooperative(samples, oversample = 4, halfWidth = 8, shouldCancel) {
  try {
    const wasmPeak = await estimateTruePeakWasmCooperative(samples, oversample, halfWidth, shouldCancel);
    if (wasmPeak != null) return wasmPeak;
  } catch (e) {
    if (e && (e.code === 'VM_EXPORT_CANCELLED' || e.code === 'VM_INVALID_AUDIO_SAMPLE')) throw e;
    console.warn('[truepeak-wasm/fallback-js]', e);
  }

  const phaseCoeffs = getTruePeakPhaseCoeffs(oversample, halfWidth);
  let maxPeak = 0;
  // D413: JS fallbackもiPhoneだけyield間隔を短くする。補間式/精度は変更しない。
  const chunkSize = (typeof VM_PLATFORM !== 'undefined' && VM_PLATFORM && VM_PLATFORM.isiOS) ? 16384 : 32768;

  // D160: D159までのTrue Peak推定と同じ補間式を使いながら、
  // 長尺音源でも一定サンプルごとにUIへ制御を返す。
  for (let chunkStart = 0; chunkStart < samples.length; chunkStart += chunkSize) {
    const chunkEnd = Math.min(samples.length, chunkStart + chunkSize);

    for (let i = chunkStart; i < chunkEnd; i++) {
      const sample = samples[i];
      if (!Number.isFinite(sample)) {
        const err = new Error('Premaster音声に不正なサンプル値(NaN/Infinity)を検出しました');
        err.code = 'VM_INVALID_AUDIO_SAMPLE';
        throw err;
      }
      const sampleAbs = Math.abs(sample);
      if (sampleAbs > maxPeak) maxPeak = sampleAbs;

      if (i >= samples.length - 1) continue;
      for (const coeffs of phaseCoeffs) {
        let acc = 0;
        for (let t = 0, j = i - halfWidth + 1; t < coeffs.length; t++, j++) {
          if (j < 0 || j >= samples.length) continue;
          acc += samples[j] * coeffs[t];
        }
        if (!Number.isFinite(acc)) {
          const err = new Error('PremasterのTrue Peak計算中に不正値を検出しました');
          err.code = 'VM_INVALID_AUDIO_SAMPLE';
          throw err;
        }
        const a = Math.abs(acc);
        if (a > maxPeak) maxPeak = a;
      }
    }

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }

    if (chunkEnd < samples.length) await yieldToBrowser();
  }

  return maxPeak;
}

async function measureTruePeakBuffer(buffer, shouldCancel) {
  let maxTruePeak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channelPeak = await estimateTruePeakCooperative(
      buffer.getChannelData(ch), 8, 16, shouldCancel
    );
    if (channelPeak > maxTruePeak) maxTruePeak = channelPeak;

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    await yieldToBrowser();
  }
  return maxTruePeak;
}


async function vmApplyGainArrayInPlaceWasmCooperative(data, gainLin, shouldCancel) {
  const runtime = await vmEnsureWasmDspRuntime();
  if (!runtime || typeof runtime.exports.vm_gain_process !== 'function') return false;

  const chunkSize = VM_WASM_DSP_CHUNK;
  const scratchPtr = runtime.heapBase;
  vmEnsureWasmMemory(runtime, chunkSize * 4 + 16);

  for (let start = 0; start < data.length; start += chunkSize) {
    const end = Math.min(data.length, start + chunkSize);
    const len = end - start;
    const scratch = new Float32Array(runtime.memory.buffer, scratchPtr, chunkSize);
    scratch.set(data.subarray(start, end), 0);

    runtime.exports.vm_gain_process(scratchPtr, len, gainLin);
    data.set(scratch.subarray(0, len), start);

    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }
    if (end < data.length) await yieldToBrowser();
  }
  return true;
}

async function applyBufferGainInPlaceCooperative(buffer, gainDb, shouldCancel) {
  if (!buffer || !Number.isFinite(gainDb) || Math.abs(gainDb) < 1e-12) return buffer;
  const gainLin = Math.pow(10, gainDb / 20);
  const chunkSize = 131072;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);

    // D241: 単純Gain乗算をWASMへ。演算式・Float32書き戻しは従来と同じ。
    // WASMが使えない場合のみ既存JSループへ戻る。
    const wasmApplied = await vmApplyGainArrayInPlaceWasmCooperative(data, gainLin, shouldCancel);
    if (wasmApplied) continue;

    for (let start = 0; start < data.length; start += chunkSize) {
      const end = Math.min(data.length, start + chunkSize);
      for (let i = start; i < end; i++) data[i] *= gainLin;

      if (typeof shouldCancel === 'function' && shouldCancel()) {
        const err = new Error('export cancelled');
        err.code = 'VM_EXPORT_CANCELLED';
        throw err;
      }
      if (end < data.length) await yieldToBrowser();
    }
  }
  return buffer;
}
