// High-quality polyphase resampler for 44.1/48 kHz export, with its WASM
// kernel. Moved verbatim from the main app script in index.html; loaded
// before it. Uses audioCtx, yieldToBrowser, vmDecodeBase64Bytes and
// vmWasmGlobalNumber at call time.
const VM_HQ_RESAMPLER_WASM_BASE64 = 'AGFzbQEAAAABDQFgCX9/f39/f398fAADAgEABQUBARCAIAYPAn8BQYCIBAt/AEGAiAQLBzADBm1lbW9yeQIAFXZtX3Jlc2FtcGxlX3BvbHlwaGFzZQAAC19faGVhcF9iYXNlAwEK7wQB7AQFBX8BfAR/AnwFfwJAIAZBAUgNACAEQX5tIQlBACEKAkAgBEEASg0AIAZBB3EhCwJAIAZBCEkNACAGQfj///8HcSEBQQAhCiAFIQwDQCAMQgA3AgAgDEEYakIANwIAIAxBEGpCADcCACAMQQhqQgA3AgAgDEEgaiEMIAEgCkEIaiIKRw0ACwsgC0UNASAFIApBAnRqIQwDQCAMQQA2AgAgDEEEaiEMIAtBf2oiCw0ADAILCyAJQQFqIQ0gA7chDiAAQQhqIQ8gBEH+////B3EhECAEQQFxIRFBACESRAAAAAAAAAAAIRMDQAJAAkAgEyAIoiAHoCIUmUQAAAAAAADgQWNFDQAgFKohFQwBC0GAgICAeCEVCwJAAkAgFCAVt6EgDqJEAAAAAAAA4D+gIhSZRAAAAAAAAOBBY0UNACAUqiELDAELQYCAgIB4IQsLQQAhDCACQQAgCyALIANOIhYbIARsQQJ0aiEXRAAAAAAAAAAAIRQCQCAEQQFGDQAgDyAJIBVqIBZqIhhBAnRqIQtEAAAAAAAAAAAhFEEAIQwgFyEKA0ACQCAYIAxqIhlBAWogAU8NACALQXxqKgIAuyAKKgIAu6IgFKAhFAsCQCAZQQJqIAFPDQAgCyoCALsgCkEEaioCALuiIBSgIRQLIApBCGohCiALQQhqIQsgECAMQQJqIgxHDQALCwJAIBFFDQAgDSAVaiAWaiAMaiILIAFPDQAgACALQQJ0aioCALsgFyAMQQJ0aioCALuiIBSgIRQLIAUgEkECdGogFLY4AgAgE0QAAAAAAADwP6AhEyASQQFqIhIgBkcNAAsLCwBEBG5hbWUADw5yZXNhbXBsZXIud2FzbQEYAQAVdm1fcmVzYW1wbGVfcG9seXBoYXNlBxIBAA9fX3N0YWNrX3BvaW50ZXIAfwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQEFY2xhbmdfMTcuMC4wIChodHRwczovL2dpdGh1Yi5jb20vc3dpZnRsYW5nL2xsdm0tcHJvamVjdC5naXQgMTA5OTliNmQwMzRmZTMxOGYzZDU2YzgzYmRkYjY1NzI1OTNhOGJiMCkASQ90YXJnZXRfZmVhdHVyZXMEKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=';
const VM_HQ_RESAMPLER_PHASES = 1024;
const VM_HQ_RESAMPLER_TAPS = 64;
const VM_HQ_RESAMPLER_OUT_CHUNK = 65536;
let vmHqResamplerRuntimePromise = null;
let vmHqResamplerDisabled = false;
const VM_HQ_RESAMPLER_COEFF_CACHE = new Map();

async function vmEnsureHqResamplerRuntime() {
  if (vmHqResamplerDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmHqResamplerRuntimePromise) return vmHqResamplerRuntimePromise;

  vmHqResamplerRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_HQ_RESAMPLER_WASM_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (!memory || typeof exports.vm_resample_polyphase !== 'function') {
        throw new Error('HQ resampler WASM exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmHqResamplerDisabled = true;
      console.warn('[hq-resampler/fallback-native]', e);
      return null;
    }
  })();
  return vmHqResamplerRuntimePromise;
}

function vmEnsureHqResamplerMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  const current = runtime.memory.buffer.byteLength;
  if (current >= need) return;
  runtime.memory.grow(Math.ceil((need - current) / 65536));
}

function buildHqResamplerCoefficients(srcSr, dstSr) {
  const key = `${srcSr}>${dstSr}|${VM_HQ_RESAMPLER_PHASES}|${VM_HQ_RESAMPLER_TAPS}`;
  const cached = VM_HQ_RESAMPLER_COEFF_CACHE.get(key);
  if (cached) return cached;

  const phases = VM_HQ_RESAMPLER_PHASES;
  const taps = VM_HQ_RESAMPLER_TAPS;
  const half = taps / 2;
  const cutoff = Math.min(1, dstSr / srcSr) * 0.985;
  const coeffs = new Float32Array(phases * taps);

  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;

    for (let k = 0; k < taps; k++) {
      const offset = k - (half - 1);
      const d = offset - frac;
      const x = d / half;
      let window = 0;
      if (Math.abs(x) <= 1) {
        window = 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
      }
      const z = Math.PI * cutoff * d;
      const sinc = Math.abs(z) < 1e-12 ? 1 : Math.sin(z) / z;
      const value = cutoff * sinc * window;
      coeffs[p * taps + k] = value;
      sum += value;
    }

    if (Math.abs(sum) > 1e-12) {
      const inv = 1 / sum;
      for (let k = 0; k < taps; k++) coeffs[p * taps + k] *= inv;
    }
  }

  if (VM_HQ_RESAMPLER_COEFF_CACHE.size >= 6) {
    VM_HQ_RESAMPLER_COEFF_CACHE.delete(VM_HQ_RESAMPLER_COEFF_CACHE.keys().next().value);
  }
  VM_HQ_RESAMPLER_COEFF_CACHE.set(key, coeffs);
  return coeffs;
}

async function resampleHighQualityForExport(buffer, targetSr, shouldCancel) {
  if (!buffer || buffer.sampleRate === targetSr) return buffer;

  const srcSr = buffer.sampleRate;
  const runtime = await vmEnsureHqResamplerRuntime();
  if (!runtime) return resampleIfNeeded(buffer, targetSr);

  const phases = VM_HQ_RESAMPLER_PHASES;
  const taps = VM_HQ_RESAMPLER_TAPS;
  const half = taps / 2;
  const outChunk = VM_HQ_RESAMPLER_OUT_CHUNK;
  const ratio = srcSr / targetSr;
  const targetFrames = Math.max(1, Math.ceil(buffer.duration * targetSr));
  const coeffs = buildHqResamplerCoefficients(srcSr, targetSr);

  const maxInputLen = Math.ceil(outChunk * ratio) + taps + 16;
  const coeffPtr = runtime.heapBase;
  const inputPtr = (coeffPtr + coeffs.byteLength + 15) & ~15;
  const outputPtr = (inputPtr + maxInputLen * 4 + 15) & ~15;

  vmEnsureHqResamplerMemory(runtime, (outputPtr - runtime.heapBase) + outChunk * 4 + 64);
  new Float32Array(runtime.memory.buffer, coeffPtr, coeffs.length).set(coeffs);

  const result = audioCtx.createBuffer(buffer.numberOfChannels, targetFrames, targetSr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const source = buffer.getChannelData(ch);
    const destination = result.getChannelData(ch);

    for (let outStart = 0; outStart < targetFrames; outStart += outChunk) {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        const err = new Error('export cancelled');
        err.code = 'VM_EXPORT_CANCELLED';
        throw err;
      }

      const outEnd = Math.min(targetFrames, outStart + outChunk);
      const outLen = outEnd - outStart;
      const globalStartPos = outStart * ratio;
      const globalEndPos = (outEnd - 1) * ratio;

      const srcStart = Math.max(0, Math.floor(globalStartPos) - half - 3);
      const srcEnd = Math.min(source.length, Math.ceil(globalEndPos) + half + 4);
      const inputLen = Math.max(0, srcEnd - srcStart);
      if (inputLen <= 0) continue;

      const wasmInput = new Float32Array(runtime.memory.buffer, inputPtr, maxInputLen);
      wasmInput.fill(0, 0, inputLen);
      wasmInput.set(source.subarray(srcStart, srcEnd), 0);

      runtime.exports.vm_resample_polyphase(
        inputPtr, inputLen, coeffPtr, phases, taps,
        outputPtr, outLen,
        globalStartPos - srcStart,
        ratio
      );

      const wasmOutput = new Float32Array(runtime.memory.buffer, outputPtr, outLen);
      destination.set(wasmOutput, outStart);

      if (outEnd < targetFrames) await yieldToBrowser();
    }
    await yieldToBrowser();
  }

  return result;
}

async function resampleIfNeeded(buffer, targetSr) {
  if (buffer.sampleRate === targetSr) return buffer;
  const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * targetSr), targetSr);
  const src = offlineCtx.createBufferSource();
  src.buffer = buffer; src.connect(offlineCtx.destination); src.start();
  return await offlineCtx.startRendering();
}
