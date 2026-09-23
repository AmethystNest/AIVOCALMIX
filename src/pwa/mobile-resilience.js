(function(){
  let wakeLock = null;
  let persistRequested = false;

  function isProcessing(){
    return document.body.classList.contains('is-processing');
  }

  async function acquireWakeLock(){
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || !isProcessing()) return;
    try {
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {
      wakeLock = null;
    }
  }

  async function releaseWakeLock(){
    if (!wakeLock) return;
    try { await wakeLock.release(); } catch (_) {}
    wakeLock = null;
  }

  // Follow the app's existing body.is-processing state without touching DSP code.
  const observer = new MutationObserver(() => {
    if (isProcessing()) acquireWakeLock();
    else releaseWakeLock();
  });
  observer.observe(document.body, {attributes:true, attributeFilter:['class']});

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isProcessing()) acquireWakeLock();
    else if (document.visibilityState !== 'visible') releaseWakeLock();
  });

  // Request persistent storage only after a real user gesture.
  async function requestPersistentStorageOnce(){
    if (persistRequested) return;
    persistRequested = true;
    if (!navigator.storage || !navigator.storage.persist) return;
    try {
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!persisted) await navigator.storage.persist();
    } catch (_) {}
  }
  document.addEventListener('pointerdown', requestPersistentStorageOnce, {once:true, passive:true});
  document.addEventListener('keydown', requestPersistentStorageOnce, {once:true});

  // Avoid accidental reload/close in the middle of analysis/render/export.
  window.addEventListener('beforeunload', (event) => {
    if (!isProcessing()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Release OS resource on navigation.
  window.addEventListener('pagehide', releaseWakeLock);
})();
