async function audioBufferToWavBlob(buffer, bitDepth) {
  const channels = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  if (channels.length === 1) channels.push(channels[0]);
  return encodeWavBlobAsync(channels, buffer.sampleRate, bitDepth || 16);
}

function encodeWav(samplesByChannel, sr, bitDepth) {
  bitDepth = bitDepth || 16;
  const numChannels = samplesByChannel.length;
  const numFrames = samplesByChannel[0].length;
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  function writeString(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
  writeString(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); writeString(36, 'data'); view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let s = Math.max(-1, Math.min(1, samplesByChannel[ch][i]));
      if (bitDepth === 24) {
        const scale = s < 0 ? 8388608 : 8388607;
        let v = Math.round(s * scale + tpdfDither());
        v = Math.max(-8388608, Math.min(8388607, v));
        view.setUint8(offset, v & 0xff); view.setUint8(offset + 1, (v >> 8) & 0xff); view.setUint8(offset + 2, (v >> 16) & 0xff);
        offset += 3;
      } else {
        const scale = s < 0 ? 32768 : 32767;
        let v = Math.round(s * scale + tpdfDither());
        v = Math.max(-32768, Math.min(32767, v));
        view.setInt16(offset, v, true); offset += 2;
      }
    }
  }
  return buffer;
}

async function encodeWavAsync(samplesByChannel, sr, bitDepth, onProgress, shouldCancel) {
  bitDepth = bitDepth || 16;
  const numChannels = samplesByChannel.length;
  const numFrames = samplesByChannel[0].length;
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const chunkFrames = 131072;

  if (typeof shouldCancel === 'function' && shouldCancel()) {
    const err = new Error('export cancelled');
    err.code = 'VM_EXPORT_CANCELLED';
    throw err;
  }

  for (let start = 0; start < numFrames; start += chunkFrames) {
    const end = Math.min(numFrames, start + chunkFrames);

    for (let i = start; i < end; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let s = Math.max(-1, Math.min(1, samplesByChannel[ch][i]));

        if (bitDepth === 24) {
          const scale = s < 0 ? 8388608 : 8388607;
          let v = Math.round(s * scale + tpdfDither());
          v = Math.max(-8388608, Math.min(8388607, v));
          view.setUint8(offset, v & 0xff);
          view.setUint8(offset + 1, (v >> 8) & 0xff);
          view.setUint8(offset + 2, (v >> 16) & 0xff);
          offset += 3;
        } else {
          const scale = s < 0 ? 32768 : 32767;
          let v = Math.round(s * scale + tpdfDither());
          v = Math.max(-32768, Math.min(32767, v));
          view.setInt16(offset, v, true);
          offset += 2;
        }
      }
    }

    if (typeof onProgress === 'function') {
      try { onProgress(end / Math.max(1, numFrames)); } catch (_) {}
    }

    if (end < numFrames) {
      if (typeof yieldToBrowser === 'function') await yieldToBrowser();
      else await new Promise(resolve => setTimeout(resolve, 0));

      if (typeof shouldCancel === 'function' && shouldCancel()) {
        const err = new Error('export cancelled');
        err.code = 'VM_EXPORT_CANCELLED';
        throw err;
      }
    }
  }

  return buffer;
}

function createFastTpdfDitherGenerator() {
  // D289: inner-loopでMath.random()を数千万回呼ばない。
  // seedだけcryptoを使い、SFC32で高速な一様乱数を生成して2値差からTPDFを作る。
  let seed = new Uint32Array(4);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(seed);
  } else {
    const now = (Date.now() >>> 0) || 0x9e3779b9;
    seed[0] = now;
    seed[1] = (now ^ 0xa5a5a5a5) >>> 0;
    seed[2] = (now * 1664525 + 1013904223) >>> 0;
    seed[3] = (now ^ 0x6d2b79f5) >>> 0;
  }

  let a = seed[0] || 0x9e3779b9;
  let b = seed[1] || 0x243f6a88;
  let c = seed[2] || 0xb7e15162;
  let d = seed[3] || 0xdeadbeef;

  const uniform = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };

  return () => uniform() - uniform();
}

function buildWavHeader(numChannels, sr, bitDepth, numFrames) {
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  return header;
}

async function encodeWavBlobAsync(samplesByChannel, sr, bitDepth, onProgress, shouldCancel) {
  // D289: 全WAV分の巨大な連続ArrayBufferを先に確保せず、
  // PCMを小さなchunkへ順次encodeしてBlob partsへ渡す。
  // iPhone Safariで大きなWAVのcontiguous allocation失敗を起こしにくくする。
  bitDepth = bitDepth || 16;
  if (!Array.isArray(samplesByChannel) || !samplesByChannel.length || !samplesByChannel[0]) {
    throw new Error('WAV出力: 音声チャンネルがありません');
  }
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error('WAV出力: 非対応のビット深度');
  if (!Number.isInteger(sr) || sr < 8000 || sr > 384000) throw new Error('WAV出力: 不正なサンプルレート');
  const numChannels = samplesByChannel.length;
  const numFrames = samplesByChannel[0].length;
  if (!numFrames) throw new Error('WAV出力: 音声データが空です');
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  if (!Number.isSafeInteger(numFrames * blockAlign) || numFrames * blockAlign > 0xffffffff - 36) {
    throw new Error('WAV出力: RIFF WAVの最大サイズを超えています');
  }
  const chunkFrames = 32768;
  const parts = [buildWavHeader(numChannels, sr, bitDepth, numFrames)];
  const dither = createFastTpdfDitherGenerator();

  // Validate the complete float PCM before allocating output parts. Silent NaN-to-zero
  // conversion and implicit clipping would otherwise produce a seemingly valid WAV.
  for (let ch = 0; ch < numChannels; ch++) {
    const samples = samplesByChannel[ch];
    if (!samples || samples.length !== numFrames) throw new Error('WAV出力: チャンネル長が一致しません');
    for (let start = 0; start < numFrames; start += 32768) {
      if (typeof shouldCancel === 'function' && shouldCancel()) {
        const err = new Error('export cancelled');
        err.code = 'VM_EXPORT_CANCELLED';
        throw err;
      }
      const end = Math.min(numFrames, start + 32768);
      for (let i = start; i < end; i++) {
        const sample = samples[i];
        if (!Number.isFinite(sample)) throw new Error(`WAV出力: 不正な音声値 (ch${ch + 1}, frame${i})`);
        if (Math.abs(sample) > 1) throw new Error(`WAV出力: クリッピングの危険 (ch${ch + 1}, frame${i})`);
      }
      if (end < numFrames) await yieldToBrowser();
    }
  }

  for (let start = 0; start < numFrames; start += chunkFrames) {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('export cancelled');
      err.code = 'VM_EXPORT_CANCELLED';
      throw err;
    }

    const end = Math.min(numFrames, start + chunkFrames);
    const frames = end - start;
    const chunk = new ArrayBuffer(frames * blockAlign);
    const view = new DataView(chunk);
    let offset = 0;

    for (let i = start; i < end; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = Math.max(-1, Math.min(1, samplesByChannel[ch][i]));

        if (bitDepth === 24) {
          const scale = s < 0 ? 8388608 : 8388607;
          let v = Math.round(s * scale + dither());
          v = Math.max(-8388608, Math.min(8388607, v));
          view.setUint8(offset, v & 0xff);
          view.setUint8(offset + 1, (v >> 8) & 0xff);
          view.setUint8(offset + 2, (v >> 16) & 0xff);
          offset += 3;
        } else {
          const scale = s < 0 ? 32768 : 32767;
          let v = Math.round(s * scale + dither());
          v = Math.max(-32768, Math.min(32767, v));
          view.setInt16(offset, v, true);
          offset += 2;
        }
      }
    }

    parts.push(chunk);
    if (typeof onProgress === 'function') onProgress(end / numFrames);
    if (end < numFrames) await yieldToBrowser();
  }

  return new Blob(parts, { type: 'audio/wav' });
}
