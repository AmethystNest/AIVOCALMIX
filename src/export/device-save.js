// Saving audio to the device: iOS pending-save handoff, share/download, WAV
// export memory estimates and the save lock, downloadAudioBuffer. Moved
// verbatim from index.html's #app-script; loaded right before it.

let vmActiveExportTriggerId = null;
let vmIosPendingSave = null;
let vmIosPendingSaveTimer = null;

function clearIosPendingSave(reason) {
  if (!vmIosPendingSave) return;
  const buttonId = vmIosPendingSave.buttonId;
  vmIosPendingSave = null;
  if (vmIosPendingSaveTimer) {
    clearTimeout(vmIosPendingSaveTimer);
    vmIosPendingSaveTimer = null;
  }

  const btn = buttonId ? document.getElementById(buttonId) : null;
  if (btn && btn.dataset.vmIosPendingOriginalText) {
    btn.textContent = btn.dataset.vmIosPendingOriginalText;
    delete btn.dataset.vmIosPendingOriginalText;
    delete btn.dataset.vmIosPendingSave;
  }

  if (reason === 'expired') {
    const status = document.getElementById('exportStatus');
    if (status) {
      status.textContent = '保存待ちのWAVは期限切れになりました。必要ならもう一度書き出してください';
      status.className = 'status-line';
    }
  }
}

function refreshIosPendingSaveButton() {
  if (!vmIosPendingSave || !vmIosPendingSave.buttonId) return;
  const btn = document.getElementById(vmIosPendingSave.buttonId);
  if (!btn) return;

  if (!btn.dataset.vmIosPendingOriginalText) {
    btn.dataset.vmIosPendingOriginalText = btn.textContent || '';
  }
  btn.dataset.vmIosPendingSave = '1';
  btn.textContent = 'iPhoneへ保存する';
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
}

function queueIosPendingSave(blob, filename) {
  clearIosPendingSave();
  vmIosPendingSave = {
    blob,
    filename,
    buttonId: vmActiveExportTriggerId || null,
    createdAt: Date.now()
  };

  // WAV Blobを無期限に保持しない。10分経過で参照を解放する。
  vmIosPendingSaveTimer = setTimeout(() => clearIosPendingSave('expired'), 10 * 60 * 1000);
  setTimeout(refreshIosPendingSaveButton, 0);

  return {
    method: 'pending-share',
    filename,
    buttonId: vmIosPendingSave.buttonId
  };
}

async function completeIosPendingSaveFromGesture() {
  const pending = vmIosPendingSave;
  if (!pending) return { method: 'missing-pending' };

  const blob = pending.blob;
  const filename = pending.filename;

  if (typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'audio/wav' });
      if (navigator.canShare({ files: [file] })) {
        // 重要: navigator.share()はこのタップイベント内で即座に呼ぶ。
        const sharePromise = navigator.share({ files: [file], title: filename });
        await sharePromise;
        clearIosPendingSave();
        return { method: 'share', filename };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return { method: 'cancelled' };
      console.warn('[ios-pending-share/fallback-download]', e);
    }
  }

  // Web Share非対応時のみ通常downloadへfallback。
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    clearIosPendingSave();
    return { method: 'download', filename };
  } finally {
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 30000);
  }
}

// Main Export buttons: long DSP makes the original user activation expire on iOS.
// Capture phase intercepts the second tap before the normal Export handler can rerender.
// D412: ページ破棄時は生成済みWAV Blob参照を即時解放。bfcache復帰時は保存待ちを維持。
window.addEventListener('pagehide', (event) => {
  if (event && event.persisted) return;
  clearIosPendingSave();
});

document.addEventListener('click', (event) => {
  if (!VM_PLATFORM || !VM_PLATFORM.isiOS || !vmIosPendingSave) return;
  const target = event.target && event.target.closest ? event.target.closest('button') : null;
  if (!target || target.id !== vmIosPendingSave.buttonId) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const status = document.getElementById('exportStatus');
  if (status) {
    status.textContent = 'iPhoneの保存先を開いています...';
    status.className = 'status-line busy';
  }

  // Function calls navigator.share before its first awaited continuation.
  completeIosPendingSaveFromGesture().then((result) => {
    if (!status) return;
    if (result.method === 'cancelled') {
      status.textContent = '保存をキャンセルしました。もう一度タップすると再度保存できます';
      status.className = 'status-line';
      refreshIosPendingSaveButton();
    } else if (result.method === 'share' || result.method === 'download') {
      status.textContent = `保存完了: ${result.filename || 'WAV'}`;
      status.className = 'status-line';
    }
  }).catch((e) => {
    console.warn('[ios-pending-save]', e);
    if (status) {
      status.textContent = '保存を開始できませんでした。もう一度タップしてください';
      status.className = 'status-line error';
    }
    refreshIosPendingSaveButton();
  });
}, true);

async function saveBlobToDevice(blob, filename) {
  const isiOS = !!(VM_PLATFORM && VM_PLATFORM.isiOS);

  if (isiOS && typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    // navigator.share requires transient user activation in Safari.
    // Long render/encode work normally consumes that activation, so main Export buttons
    // keep the completed Blob and ask for one final tap instead of relying on a blocked share.
    const activation = navigator.userActivation;
    const hasActivation = !activation || activation.isActive === true;

    if (hasActivation) {
      try {
        const file = new File([blob], filename, { type: blob.type || 'audio/wav' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return { method: 'share' };
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return { method: 'cancelled' };
        console.warn('[save/share-fallback]', e);
      }
    } else if (vmActiveExportTriggerId) {
      return queueIosPendingSave(blob, filename);
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { method: 'download' };
  } finally {
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, isiOS ? 30000 : 8000);
  }
}



function estimateWavExportMemory(buffer, bitDepth, targetSampleRate) {
  if (!buffer) return { wavBytes: 0, workingBytes: 0, targetFrames: 0 };

  const sr = Number(targetSampleRate) > 0 ? Number(targetSampleRate) : buffer.sampleRate;
  const targetFrames = Math.max(1, Math.ceil(buffer.duration * sr));
  const channels = Math.max(2, buffer.numberOfChannels || 1);
  const bytesPerSample = Number(bitDepth) === 24 ? 3 : 2;

  const wavBytes = 44 + targetFrames * channels * bytesPerSample;
  // During export we may temporarily hold resampled float PCM + encoded WAV.
  const floatPcmBytes = targetFrames * channels * 4;
  const workingBytes = wavBytes + floatPcmBytes;

  return { wavBytes, workingBytes, targetFrames, channels, sampleRate: sr };
}

function getWavExportMemoryLimit() {
  // D235: iOSはdeviceMemoryがnullになり得るため、null時の620MB上限をそのまま使わない。
  if (VM_PLATFORM && VM_PLATFORM.isiOS) return 260 * 1024 * 1024;

  const dm = VM_RESOURCE_POLICY && VM_RESOURCE_POLICY.deviceMemoryGB;
  if (dm != null) {
    if (dm <= 2) return 150 * 1024 * 1024;
    if (dm <= 4) return 280 * 1024 * 1024;
    if (dm <= 6) return 430 * 1024 * 1024;
  }
  return 620 * 1024 * 1024;
}

function estimateFireLitPremasterPeakMemory(buffer, bitDepth, targetSampleRate) {
  if (!buffer) return { peakBytes: 0, rawBytes: 0, targetBytes: 0, wavBytes: 0 };

  const channels = Math.max(2, buffer.numberOfChannels || 1);
  const sourceFrames = Math.max(1, buffer.length || Math.ceil(buffer.duration * buffer.sampleRate));
  const targetSr = Number(targetSampleRate) > 0 ? Number(targetSampleRate) : buffer.sampleRate;
  const targetFrames = Math.max(1, Math.ceil(buffer.duration * targetSr));
  const bytesPerSample = Number(bitDepth) === 24 ? 3 : 2;

  const rawBytes = sourceFrames * channels * 4;
  const targetBytes = targetFrames * channels * 4;
  const wavBytes = 44 + targetFrames * channels * bytesPerSample;

  // The existing rendered mix remains in state during unmastered assembly.
  // Harmony/instrumental OfflineAudioContext source copies can overlap with
  // the unmastered result; after resampling, the WAV Blob holds PCM chunks.
  // Account for both phases before starting an expensive iOS render.
  const assemblyPeak = rawBytes * 4;
  const encodingPeak = rawBytes * 2 + targetBytes + wavBytes;
  const peakBytes = Math.ceil(Math.max(assemblyPeak, encodingPeak) * 1.25);

  return { peakBytes, assemblyPeak, encodingPeak, rawBytes, targetBytes, wavBytes, targetFrames, channels, sampleRate: targetSr };
}

function validateFireLitPremasterMemory(buffer, bitDepth, targetSampleRate) {
  const estimate = estimateFireLitPremasterPeakMemory(buffer, bitDepth, targetSampleRate);
  const limit = getWavExportMemoryLimit();

  if (estimate.peakBytes > limit) {
    const deviceHint = VM_RESOURCE_POLICY && VM_RESOURCE_POLICY.deviceMemoryGB
      ? ` / 端末メモリ目安${VM_RESOURCE_POLICY.deviceMemoryGB}GB`
      : '';
    const err = new Error(
      `Premaster処理の一時メモリが安全上限を超える見込みです ` +
      `(推定${formatBytes(estimate.peakBytes)} / 上限${formatBytes(limit)}${deviceHint})。` +
      `Sample Rateを下げるか、音源を短くして再度お試しください`
    );
    err.code = 'VM_PREMASTER_MEMORY_LIMIT';
    err.estimate = estimate;
    err.limit = limit;
    throw err;
  }
  return estimate;
}

function validateWavExportMemory(buffer, bitDepth, targetSampleRate) {
  const estimate = estimateWavExportMemory(buffer, bitDepth, targetSampleRate);
  const limit = getWavExportMemoryLimit();

  if (estimate.workingBytes > limit) {
    const deviceHint = VM_RESOURCE_POLICY && VM_RESOURCE_POLICY.deviceMemoryGB
      ? ` / 端末メモリ目安${VM_RESOURCE_POLICY.deviceMemoryGB}GB`
      : '';
    const message =
      `WAV書き出し時の一時メモリが安全上限を超える見込みです ` +
      `(推定${formatBytes(estimate.workingBytes)} / 上限${formatBytes(limit)}${deviceHint})。` +
      `Sample Rateを下げるか、音源を短くして再度お試しください。`;
    const err = new Error(message);
    err.code = 'VM_WAV_EXPORT_MEMORY_LIMIT';
    err.estimate = estimate;
    err.limit = limit;
    throw err;
  }

  return estimate;
}

let vmWavSaveBusy = false;

function setWavSaveBusy(busy) {
  vmWavSaveBusy = !!busy;

  const ids = [
    'btnDownloadMix',
    'btnDownloadFx',
    'btnExport',
    'btnExportMaster'
  ];

  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;

    if (busy) {
      if (!el.dataset.vmPrevDisabled) {
        el.dataset.vmPrevDisabled = el.disabled ? '1' : '0';
      }
      el.disabled = true;
      el.setAttribute('aria-busy', 'true');
    } else {
      const prev = el.dataset.vmPrevDisabled;
      if (prev === '0') el.disabled = false;
      else if (prev === '1') el.disabled = true;
      delete el.dataset.vmPrevDisabled;
      el.removeAttribute('aria-busy');
    }
  }

  document.querySelectorAll('.hist-dl').forEach((el) => {
    if (busy) {
      if (!el.dataset.vmPrevDisabled) {
        el.dataset.vmPrevDisabled = el.disabled ? '1' : '0';
      }
      el.disabled = true;
      el.setAttribute('aria-busy', 'true');
    } else {
      const prev = el.dataset.vmPrevDisabled;
      if (prev === '0') el.disabled = false;
      else if (prev === '1') el.disabled = true;
      delete el.dataset.vmPrevDisabled;
      el.removeAttribute('aria-busy');
    }
  });
}

async function withWavSaveLock(task) {
  if (vmWavSaveBusy) return { method: 'busy' };
  vmWavSaveBusy = true;
  setWavSaveBusy(true);

  try {
    return await task();
  } finally {
    vmWavSaveBusy = false;
    setWavSaveBusy(false);
  }
}

async function downloadAudioBuffer(buffer, filename, bitDepth) {
  if (!buffer) return { method: 'missing-buffer' };

  try {
    validateWavExportMemory(buffer, bitDepth || 16, buffer.sampleRate);
  } catch (e) {
    console.warn('[wav-export-memory]', e);
    const notice = document.getElementById('vmCompatibilityNotice');
    if (typeof vmShowCompatibilityNotice === 'function') {
      vmShowCompatibilityNotice(e.message);
    } else if (notice) {
      notice.textContent = e.message;
    }
    return { method: 'memory-blocked', error: e };
  }

  return withWavSaveLock(async () => {
    const blob = await audioBufferToWavBlob(buffer, bitDepth);
    return saveBlobToDevice(blob, filename);
  });
}
