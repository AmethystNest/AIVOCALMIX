// Android Chrome: offer "add to home screen" inside the app. The browser fires
// beforeinstallprompt only when the app is installable and not yet installed;
// iOS Safari never fires it, so nothing is shown there.
(function(){
  const box = document.getElementById('pwaInstallBox');
  const btnInstall = document.getElementById('btnPwaInstall');
  const btnLater = document.getElementById('btnPwaInstallLater');
  if (!box || !btnInstall || !btnLater) return;
  const KEY = 'vmPwaInstallDismissed';
  let deferred = null;

  const dismissed = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const remember = () => { try { localStorage.setItem(KEY, '1'); } catch (e) {} };
  const hide = () => { box.hidden = true; };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    if (!dismissed()) box.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; hide(); });

  btnLater.addEventListener('click', () => { remember(); hide(); });
  btnInstall.addEventListener('click', async () => {
    const prompt = deferred;
    deferred = null;
    hide();
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice && choice.outcome === 'dismissed') remember();
    } catch (e) {}
  });
})();
