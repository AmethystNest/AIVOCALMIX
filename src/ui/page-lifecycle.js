(function(){
  let redrawRaf = 0;

  function redrawVisibleAudioUI(){
    if (redrawRaf) cancelAnimationFrame(redrawRaf);
    redrawRaf = requestAnimationFrame(() => {
      redrawRaf = 0;
      try {
        const active = document.body && document.body.dataset ? document.body.dataset.screen : '';

        // D104: 非表示タブのcanvasは再描画しない。
        // visualViewport/keyboard/resizeで頻繁に呼ばれても、現在見えている画面だけ更新する。
        if (active === 'upload' && window.state) {
          if (state.vocalSamples) {
            const c = document.getElementById('waveVocal');
            if (c && typeof drawWave === 'function') drawWave(c, state.vocalSamples);
          } else if (state.vocalBuffer) {
            const c = document.getElementById('waveVocal');
            if (c && typeof drawAudioBufferWave === 'function') drawAudioBufferWave(c, state.vocalBuffer);
          }
          if (state.instSamples) {
            const c = document.getElementById('waveInst');
            if (c && typeof drawWave === 'function') drawWave(c, state.instSamples);
          } else if (state.instBuffer) {
            const c = document.getElementById('waveInst');
            if (c && typeof drawAudioBufferWave === 'function') drawAudioBufferWave(c, state.instBuffer);
          }
          if (state.harmonyBuffer) {
            const c = document.getElementById('waveHarmony');
            if (c && typeof drawAudioBufferWave === 'function') drawAudioBufferWave(c, state.harmonyBuffer);
          }
        }

        if (active === 'preview' && typeof refreshPreviewWave === 'function') {
          refreshPreviewWave();
        }
        if (active === 'fx' && typeof drawFxRegionWave === 'function') {
          drawFxRegionWave();
        }
      } catch (_) {}
    });
  }

  async function recoverAfterResume(){
    try {
      if (typeof ensureAudioContextReady === 'function') {
        await ensureAudioContextReady();
      }
    } catch (_) {}

    redrawVisibleAudioUI();

    // Re-evaluate enabled/disabled controls after BFCache/app resume without
    // invalidating any existing analysis/render result.
    try { if (typeof checkUploadsReady === 'function') checkUploadsReady(); } catch (_) {}
    try { if (typeof checkHarmonyReady === 'function') checkHarmonyReady(); } catch (_) {}
    try { if (typeof updateMixChainDisplay === 'function' && window.state && state.vocalAnalysis) updateMixChainDisplay(); } catch (_) {}
  }

  window.addEventListener('pageshow', (event) => {
    // pageshow also fires when Safari/Chrome restores the document from BFCache.
    // In that case canvas backing stores and AudioContext state can be stale.
    if (event.persisted || document.visibilityState === 'visible') {
      recoverAfterResume();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setTimeout(recoverAfterResume, 30);
    }
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(redrawVisibleAudioUI, 120);
    setTimeout(redrawVisibleAudioUI, 420);
  }, {passive:true});

  window.addEventListener('resize', redrawVisibleAudioUI, {passive:true});
})();
