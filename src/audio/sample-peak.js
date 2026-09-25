// Sample peak measurement with its WASM kernel. Moved verbatim from the main
// app script in index.html; loaded before it. Uses yieldToBrowser,
// vmDecodeBase64Bytes and vmWasmGlobalNumber at call time.
const VM_SAMPLE_PEAK_WASM_BASE64 = 'AGFzbQEAAAABBwFgAn9/AXwDAgEABQUBARCACAYPAn8BQYCIBAt/AEGAiAQLBy4DBm1lbW9yeQIAE3ZtX3NhbXBsZV9wZWFrX3NjYW4AAAtfX2hlYXBfYmFzZQMBCpQBAZEBAwJ8AX0BfAJAIAFBAU4NAEQAAAAAAAAAAA8LRAAAAAAAAAAAIQICQANARAAAAAAAAPh/IQMgACoCACIEuyIFRJx1AIg85Df+Yw0BIAQgBFwNASAFRJx1AIg85Dd+ZA0BIABBBGohACAFmiAFIARDAAAAAF0bIgUgAiAFIAJkGyICIQMgAUF/aiIBDQALCyADCwBEBG5hbWUAERBzYW1wbGVfcGVhay53YXNtARYBABN2bV9zYW1wbGVfcGVha19zY2FuBxIBAA9fX3N0YWNrX3BvaW50ZXIAfwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQEFY2xhbmdfMTcuMC4wIChodHRwczovL2dpdGh1Yi5jb20vc3dpZnRsYW5nL2xsdm0tcHJvamVjdC5naXQgMTA5OTliNmQwMzRmZTMxOGYzZDU2YzgzYmRkYjY1NzI1OTNhOGJiMCkASQ90YXJnZXRfZmVhdHVyZXMEKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=';
let vmSamplePeakRuntimePromise = null;
let vmSamplePeakWasmDisabled = false;

async function vmEnsureSamplePeakRuntime() {
  if (vmSamplePeakWasmDisabled || typeof WebAssembly === 'undefined') return null;
  if (vmSamplePeakRuntimePromise) return vmSamplePeakRuntimePromise;

  vmSamplePeakRuntimePromise = (async () => {
    try {
      const bytes = vmDecodeBase64Bytes(VM_SAMPLE_PEAK_WASM_BASE64);
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      const memory = exports.memory;
      const heapBase = Math.max(1024, vmWasmGlobalNumber(exports.__heap_base));
      if (!memory || typeof exports.vm_sample_peak_scan !== 'function') {
        throw new Error('Sample Peak WASM exports missing');
      }
      return { exports, memory, heapBase };
    } catch (e) {
      vmSamplePeakWasmDisabled = true;
      console.warn('[samplepeak-wasm/fallback-js]', e);
      return null;
    }
  })();

  return vmSamplePeakRuntimePromise;
}

function vmEnsureSamplePeakMemory(runtime, requiredBytes) {
  const need = runtime.heapBase + requiredBytes;
  if (runtime.memory.buffer.byteLength >= need) return;
  runtime.memory.grow(Math.ceil((need - runtime.memory.buffer.byteLength) / 65536));
}

async function vmMeasureSamplePeakArrayCooperative(data) {
  const runtime = await vmEnsureSamplePeakRuntime();
  if (!runtime) return null;

  const chunkSize = 131072;
  const ptr = runtime.heapBase;
  vmEnsureSamplePeakMemory(runtime, chunkSize * 4 + 64);

  let maxPeak = 0;
  for (let start = 0; start < data.length; start += chunkSize) {
    const end = Math.min(data.length, start + chunkSize);
    const len = end - start;
    const scratch = new Float32Array(runtime.memory.buffer, ptr, chunkSize);
    scratch.set(data.subarray(start, end), 0);

    const local = runtime.exports.vm_sample_peak_scan(ptr, len);
    if (!Number.isFinite(local)) {
      const err = new Error('音声処理中に不正なサンプル値(NaN/Infinity)を検出しました');
      err.code = 'VM_INVALID_AUDIO_SAMPLE';
      throw err;
    }
    if (local > maxPeak) maxPeak = local;
    if (end < data.length) await yieldToBrowser();
  }
  return maxPeak;
}

async function measureBufferSamplePeakCooperative(buffer) {
  let maxPeak = 0;
  const chunkSize = 131072;

  try {
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const wasmPeak = await vmMeasureSamplePeakArrayCooperative(buffer.getChannelData(ch));
      if (wasmPeak == null) throw new Error('WASM unavailable');
      if (wasmPeak > maxPeak) maxPeak = wasmPeak;
      await yieldToBrowser();
    }
    return maxPeak;
  } catch (e) {
    if (e && e.code === 'VM_INVALID_AUDIO_SAMPLE') throw e;
    console.warn('[samplepeak-wasm/fallback-js]', e);
    maxPeak = 0;
  }

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let start = 0; start < data.length; start += chunkSize) {
      const end = Math.min(data.length, start + chunkSize);
      for (let i = start; i < end; i++) {
        const sample = data[i];
        if (!Number.isFinite(sample)) {
          const err = new Error('音声処理中に不正なサンプル値(NaN/Infinity)を検出しました');
          err.code = 'VM_INVALID_AUDIO_SAMPLE';
          throw err;
        }
        const a = Math.abs(sample);
        if (a > maxPeak) maxPeak = a;
      }
      if (end < data.length) await yieldToBrowser();
    }
    await yieldToBrowser();
  }
  return maxPeak;
}
