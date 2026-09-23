(function(){
  const netEl = document.getElementById('pwaNetStatus');
  const toast = document.getElementById('pwaUpdateToast');
  const btnUpdate = document.getElementById('btnApplyPwaUpdate');

  function updateNetworkState(){
    if (!netEl) return;
    if (navigator.onLine) {
      netEl.textContent = '';
      netEl.classList.remove('offline');
    } else {
      netEl.textContent = 'OFFLINE';
      netEl.classList.add('offline');
    }
  }

  window.addEventListener('online', updateNetworkState);
  window.addEventListener('offline', updateNetworkState);
  updateNetworkState();

  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  let reloadWhenIdle = false;
  let activateWaitingWhenIdle = false;
  let updateRegistration = null;

  function vmReloadForPwaUpdateWhenSafe() {
    if (refreshing) return;
    const processing = document.body && document.body.classList.contains('is-processing');
    if (processing) {
      reloadWhenIdle = true;
      if (toast) toast.hidden = false;
      if (btnUpdate) {
        btnUpdate.disabled = true;
        btnUpdate.textContent = '処理完了後に更新';
      }
      return;
    }
    refreshing = true;
    location.reload();
  }

  navigator.serviceWorker.addEventListener('controllerchange', vmReloadForPwaUpdateWhenSafe);

  // D297: update activation happened during a long render/export.
  // Processing ends first, then reload; never discard a Mix/WAV mid-operation.
  const bodyObserver = new MutationObserver(() => {
    const processing = document.body && document.body.classList.contains('is-processing');
    if (processing) return;

    // User tapped Update while processing: activate the waiting worker first.
    if (activateWaitingWhenIdle) {
      activateWaitingWhenIdle = false;
      if (updateRegistration && updateRegistration.waiting) {
        updateRegistration.waiting.postMessage({type:'SKIP_WAITING'});
        return; // controllerchange will perform the safe reload.
      }
    }

    // Worker already changed controller while processing: now it is safe to reload.
    if (reloadWhenIdle) {
      reloadWhenIdle = false;
      vmReloadForPwaUpdateWhenSafe();
    }
  });
  if (document.body) bodyObserver.observe(document.body, { attributes:true, attributeFilter:['class'] });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
      updateRegistration = reg;

      const showUpdate = () => {
        if (toast) toast.hidden = false;
      };

      if (reg.waiting) showUpdate();

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdate();
          }
        });
      });

      if (btnUpdate) {
        btnUpdate.addEventListener('click', () => {
          const processing = document.body && document.body.classList.contains('is-processing');
          if (processing) {
            activateWaitingWhenIdle = true;
            btnUpdate.disabled = true;
            btnUpdate.textContent = '処理完了後に更新';
            return;
          }
          if (reg.waiting) {
            reg.waiting.postMessage({type:'SKIP_WAITING'});
          } else {
            vmReloadForPwaUpdateWhenSafe();
          }
        });
      }

      // D409: 起動直後にも明示的にSW更新確認する。
      // Safari/PWAではvisibilitychangeが発生しない起動経路があるため、
      // register()完了後の1回を追加し、既存の復帰時確認も維持する。
      reg.update().catch(()=>{});

      // Check for updates when returning to the app.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().catch(()=>{});
        }
      });
    } catch (_) {}
  });
})();
