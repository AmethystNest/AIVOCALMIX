/* Navigation Guard v80-D4
   Independent of DSP initialization. It is installed before the main app script so
   tabs remain usable even if a later audio/UI initializer throws an exception. */
(function () {
  function switchTab(name) {
    if (!name) return;
    document.body.dataset.screen = name;
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.toggle('active', el.dataset.screen === name);
    });
    document.querySelectorAll('.tab-btn').forEach(function (el) {
      el.classList.toggle('active', el.dataset.screen === name);
    });
    try { window.scrollTo(0, 0); } catch (_) {}
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    // If the full app initialized successfully, let it add readiness notices/redraws.
    if (typeof window.showScreen === 'function' && window.showScreen !== switchTab) {
      try { window.showScreen(name); } catch (_) {}
    }
  }
  window.__vmEmergencyShowScreen = switchTab;
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.tab-btn') : null;
    if (!btn) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    switchTab(btn.dataset.screen);
  }, true);
})();
