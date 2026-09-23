(function(){
  const root = document.documentElement;
  let baseViewportHeight = 0;
  let rafId = 0;

  function updateViewportMetrics(){
    rafId = 0;
    const vv = window.visualViewport;
    const visibleH = vv ? vv.height : window.innerHeight;
    const fullH = Math.max(window.innerHeight || 0, screen && screen.height ? Math.min(screen.height, window.innerHeight || screen.height) : 0);

    if (document.visibilityState === 'visible' && visibleH > 0) {
      // Keep the largest recent "normal" viewport as the keyboard comparison baseline.
      if (!baseViewportHeight || visibleH > baseViewportHeight) baseViewportHeight = visibleH;
    }

    root.style.setProperty('--vm-viewport-height', `${Math.round(visibleH)}px`);
    root.style.setProperty('--vm-viewport-offset-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);

    // A reduction of roughly 150px+ on a phone is a reliable soft-keyboard signal.
    // Also require a focused editable control to avoid classifying browser chrome changes as keyboard.
    const active = document.activeElement;
    const editable = !!active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable
    );
    const keyboardOpen = editable && baseViewportHeight > 0 && (baseViewportHeight - visibleH) > 150;

    document.body.classList.toggle('vm-keyboard-open', keyboardOpen);
  }

  function scheduleUpdate(){
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(updateViewportMetrics);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleUpdate, {passive:true});
    window.visualViewport.addEventListener('scroll', scheduleUpdate, {passive:true});
  }
  window.addEventListener('resize', scheduleUpdate, {passive:true});
  window.addEventListener('orientationchange', () => {
    baseViewportHeight = 0;
    setTimeout(scheduleUpdate, 80);
    setTimeout(scheduleUpdate, 350);
  }, {passive:true});

  document.addEventListener('focusin', scheduleUpdate);
  document.addEventListener('focusout', () => setTimeout(scheduleUpdate, 80));
  document.addEventListener('visibilitychange', scheduleUpdate);

  updateViewportMetrics();
})();
