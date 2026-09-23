(function(){
  const recover = () => { if (typeof ensureAudioContextReady === 'function') ensureAudioContextReady().catch(()=>{}); };
  document.addEventListener('pointerdown', recover, {passive:true});
  document.addEventListener('touchstart', recover, {passive:true});
  document.addEventListener('keydown', recover);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recover();
    else if (typeof vmMarkAudioContextNeedsHealthCheck === 'function') vmMarkAudioContextNeedsHealthCheck();
  });
  window.addEventListener('pageshow', () => {
    if (typeof vmMarkAudioContextNeedsHealthCheck === 'function') vmMarkAudioContextNeedsHealthCheck();
    recover();
  });
})();
