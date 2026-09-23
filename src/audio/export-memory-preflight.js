(function(){
  function updateExportMemoryHint(){
    try {
      const statusEl = document.getElementById('exportStatus');
      const bitEl = document.getElementById('exportBitDepth');
      const srEl = document.getElementById('exportSampleRate');
      if (!statusEl || !bitEl || !srEl || !window.state) return;

      const buffer = typeof getLatestSongBuffer === 'function' ? getLatestSongBuffer() : null;
      if (!buffer) return;

      const estimate = estimateWavExportMemory(
        buffer,
        parseInt(bitEl.value, 10),
        parseInt(srEl.value, 10)
      );
      const limit = getWavExportMemoryLimit();

      if (estimate.workingBytes > limit * 0.72 && estimate.workingBytes <= limit) {
        statusEl.textContent =
          `大きめの書き出しです: 一時メモリ推定 ${formatBytes(estimate.workingBytes)}`;
        statusEl.className = 'status-line busy';
      } else if (statusEl.textContent.indexOf('大きめの書き出しです:') === 0) {
        statusEl.textContent = '';
        statusEl.className = 'status-line';
      }
    } catch (_) {}
  }

  document.getElementById('exportBitDepth')?.addEventListener('change', updateExportMemoryHint);
  document.getElementById('exportSampleRate')?.addEventListener('change', updateExportMemoryHint);
  document.querySelector('[data-screen="export"]')?.addEventListener('click', updateExportMemoryHint, {passive:true});
})();
