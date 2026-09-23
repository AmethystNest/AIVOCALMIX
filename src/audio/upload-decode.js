function vmReadFileArrayBuffer(file, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('ファイル読み込みがタイムアウトしました'));
    }, timeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    // File.arrayBuffer()を優先。失敗時はFileReaderへフォールバック。
    if (file && typeof file.arrayBuffer === 'function') {
      Promise.resolve()
        .then(() => file.arrayBuffer())
        .then((buf) => finish(resolve, buf))
        .catch(() => {
          try {
            const reader = new FileReader();
            reader.onload = () => finish(resolve, reader.result);
            reader.onerror = () => finish(reject, reader.error || new Error('ファイル読み込みに失敗しました'));
            reader.onabort = () => finish(reject, new Error('ファイル読み込みが中断されました'));
            reader.readAsArrayBuffer(file);
          } catch (e) {
            finish(reject, e);
          }
        });
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = () => finish(resolve, reader.result);
      reader.onerror = () => finish(reject, reader.error || new Error('ファイル読み込みに失敗しました'));
      reader.onabort = () => finish(reject, new Error('ファイル読み込みが中断されました'));
      reader.readAsArrayBuffer(file);
    } catch (e) {
      finish(reject, e);
    }
  });
}

// Inspect only a small RIFF header slice before reading/decoding the full WAV.
// decodeAudioData allocates a complete AudioBuffer, so PCM WAV duration and
// decoded size can be rejected before that much larger allocation occurs.
function vmEstimatePcmWavFromHeader(headerBuffer, totalFileBytes, targetSampleRate) {
  if (!headerBuffer || headerBuffer.byteLength < 12 || !Number.isFinite(totalFileBytes)) return null;
  const view = new DataView(headerBuffer);
  const readFourCC = (offset) => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
  if (readFourCC(0) !== 'RIFF' || readFourCC(8) !== 'WAVE') return null;

  let formatCode = 0, channels = 0, sampleRate = 0, blockAlign = 0;
  let dataBytes = 0, haveFormat = false, haveData = false;
  for (let offset = 12; offset + 8 <= headerBuffer.byteLength;) {
    const id = readFourCC(offset);
    const chunkBytes = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (id === 'fmt ' && chunkBytes >= 16 && payload + 16 <= headerBuffer.byteLength) {
      formatCode = view.getUint16(payload, true);
      if (formatCode === 0xFFFE && chunkBytes >= 40 && payload + 40 <= headerBuffer.byteLength) {
        formatCode = view.getUint16(payload + 24, true);
      }
      channels = view.getUint16(payload + 2, true);
      sampleRate = view.getUint32(payload + 4, true);
      blockAlign = view.getUint16(payload + 12, true);
      haveFormat = true;
    } else if (id === 'data') {
      if (chunkBytes === 0xFFFFFFFF || payload + chunkBytes > totalFileBytes) return null;
      dataBytes += chunkBytes;
      haveData = true;
    }
    if (haveFormat && haveData) break;
    const next = payload + chunkBytes + (chunkBytes & 1);
    if (!Number.isSafeInteger(next) || next <= offset || next > headerBuffer.byteLength) break;
    offset = next;
  }

  if (!haveFormat || !haveData || ![1, 3].includes(formatCode) ||
      !channels || !sampleRate || !blockAlign || !dataBytes) return null;
  const frames = Math.floor(dataBytes / blockAlign);
  if (!frames) return null;
  const duration = frames / sampleRate;
  const decodeRate = Math.max(sampleRate, Number(targetSampleRate) > 0 ? Number(targetSampleRate) : 48000);
  const decodedBytes = Math.ceil(duration * decodeRate) * channels * 4;
  if (!Number.isFinite(duration) || !Number.isFinite(decodedBytes)) return null;
  return { formatCode, channels, sampleRate, frames, duration, decodedBytes };
}

async function vmValidatePcmWavResourceBudget(file, kind, targetSampleRate) {
  if (!file || !Number.isFinite(file.size) || typeof file.slice !== 'function' ||
      !/\.(?:wav|wave)$/i.test(file.name || '')) return null;

  const headerBlob = file.slice(0, Math.min(file.size, 1024 * 1024));
  const header = await vmReadFileArrayBuffer(headerBlob, 15000);
  const estimate = vmEstimatePcmWavFromHeader(header, file.size, targetSampleRate);
  if (!estimate) return null;

  if (estimate.duration > VM_RESOURCE_POLICY.maxDurationSec) {
    throw new Error(`音源が長すぎます (${(estimate.duration / 60).toFixed(1)}分)。安全上限は20分です`);
  }
  let projected = estimate.decodedBytes;
  for (const [key, bytes] of Object.entries(state.inputBufferBytes || {})) {
    if (key !== kind) projected += bytes || 0;
  }
  if (projected > VM_RESOURCE_POLICY.maxDecodedInputBytes) {
    const format = typeof formatBytes === 'function' ? formatBytes : (bytes) => `${Math.ceil(bytes / (1024 * 1024))}MB`;
    throw new Error(`WAVを展開した音声メモリが安全上限を超える見込みです (推定${format(projected)} / 上限${format(VM_RESOURCE_POLICY.maxDecodedInputBytes)})。音源を短くするか、不要なステムを外してください`);
  }
  return estimate;
}

function vmDecodeAudioDataReliable(arrayBuf, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('音声デコードがタイムアウトしました'));
    }, timeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    try {
      if (!audioCtx || audioCtx.state === 'closed') {
        if (!VMAudioContextCtor) throw new Error('このブラウザではAudioContextを利用できません');
        audioCtx = new VMAudioContextCtor();
      }

      // decodeAudioData自体はAudioContextがsuspendedでも動作する。
      // ファイル選択change後にresume()をawaitすると、モバイルブラウザでは
      // ユーザージェスチャー扱いが切れてPromiseが返らないことがあるため、
      // Upload時はresumeを待たない。
      // D403: vmReadFileArrayBuffer()が返すArrayBufferはdecode専用で、この後再利用しない。
      // decodeAudioData()直前の全ファイルslice(0)は圧縮データを丸ごと複製して
      // iPhoneのUpload時メモリピークを増やすため廃止。デコード内容/DSPは不変。
      const maybePromise = audioCtx.decodeAudioData(
        arrayBuf,
        (buffer) => finish(resolve, buffer),
        (err) => finish(reject, err || new Error('音声デコードに失敗しました'))
      );

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          (buffer) => finish(resolve, buffer),
          (err) => finish(reject, err || new Error('音声デコードに失敗しました'))
        );
      }
    } catch (e) {
      finish(reject, e);
    }
  });
}
