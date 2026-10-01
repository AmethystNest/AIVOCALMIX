// Progress bar / completion banner controller (taskProgress*).
// Moved verbatim from index.html's #app-script; loaded right before it.

// 進捗バー/完了バナーの共通コントローラ。時間で見せかけるアニメーションではなく、
// 各処理が実際にどの工程まで終わったかを段階的に%へ反映する。
// idPrefix + 'Progress' / 'ProgressFill' / 'ProgressPct' / 'ProgressLabel' /
// 'CompletionBanner' というid命名規則のDOM要素が対象画面にある前提。
const VM_PROGRESS_STATE = new Map();

function formatVmTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '計算中';
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}

function refreshTaskProgressMeta(idPrefix) {
  const st = VM_PROGRESS_STATE.get(idPrefix);
  if (!st) return;
  const pct = document.getElementById(idPrefix + 'ProgressPct');
  if (!pct) return;
  const elapsed = Math.max(0, (performance.now() - st.startedAt) / 1000);
  const p = Math.max(0, Math.min(100, st.percent || 0));

  let etaText = '残り目安 計算中';
  // 最初の数%は速度推定が不安定なので、5%以上進んでからETAを出す。
  if (p >= 5 && p < 100) {
    const totalEstimate = elapsed / (p / 100);
    const remaining = Math.max(0, totalEstimate - elapsed);
    etaText = `残り目安 ${formatVmTime(remaining)}`;
  } else if (p >= 100) {
    etaText = `経過 ${formatVmTime(elapsed)}`;
  }
  pct.textContent = `${Math.round(p)}% · ${etaText}`;
}

function taskProgressStart(idPrefix, label) {
  const box = document.getElementById(idPrefix + 'Progress');
  if (!box) return;
  box.classList.add('active');
  const banner = document.getElementById(idPrefix + 'CompletionBanner');
  if (banner) banner.classList.remove('show');

  const old = VM_PROGRESS_STATE.get(idPrefix);
  if (old && old.timer) clearInterval(old.timer);
  const st = {
    startedAt: performance.now(),
    percent: 0,
    label: label || '',
    timer: null
  };
  st.timer = setInterval(() => refreshTaskProgressMeta(idPrefix), 1000);
  VM_PROGRESS_STATE.set(idPrefix, st);
  taskProgressUpdate(idPrefix, 0, label);
}

async function taskProgressUpdate(idPrefix, percent, label) {
  const fill = document.getElementById(idPrefix + 'ProgressFill');
  const lbl = document.getElementById(idPrefix + 'ProgressLabel');
  const safe = Math.max(0, Math.min(100, percent));
  if (fill) fill.style.width = safe + '%';
  if (lbl && label) lbl.textContent = label;

  const st = VM_PROGRESS_STATE.get(idPrefix);
  if (st) {
    st.percent = safe;
    if (label) st.label = label;
  } else {
    VM_PROGRESS_STATE.set(idPrefix, {
      startedAt: performance.now(),
      percent: safe,
      label: label || '',
      timer: null
    });
  }
  refreshTaskProgressMeta(idPrefix);
  await yieldToBrowser();
  // D378: short event-only feedback on meaningful progress changes.
  try {
    const track = document.querySelector('.task-progress-track');
    const progress = document.querySelector('.task-progress');
    const pctEl = document.querySelector('.task-progress-pct');
    const pctNow = pctEl ? parseInt(pctEl.textContent, 10) : NaN;
    if (track && Number.isFinite(pctNow)) {
      const prev = Number(track.dataset.vmLastPct || '-999');
      if (pctNow >= 0 && Math.abs(pctNow - prev) >= 4) {
        track.dataset.vmLastPct = String(pctNow);
        track.classList.remove('vm-progress-step');
        requestAnimationFrame(() => {
          track.classList.add('vm-progress-step');
          clearTimeout(track._vmStepTimer);
          track._vmStepTimer = setTimeout(() => track.classList.remove('vm-progress-step'), 280);
        });
      }
      if (progress && pctNow >= 100) {
        progress.classList.remove('vm-progress-finish');
        requestAnimationFrame(() => {
          progress.classList.add('vm-progress-finish');
          clearTimeout(progress._vmFinishTimer);
          progress._vmFinishTimer = setTimeout(() => progress.classList.remove('vm-progress-finish'), 480);
        });
      }
    }
  } catch (_) {}

}

function stopTaskProgressTimer(idPrefix) {
  const st = VM_PROGRESS_STATE.get(idPrefix);
  if (st && st.timer) clearInterval(st.timer);
  if (st) st.timer = null;
}

function taskProgressFinish(idPrefix, bannerMessage) {
  stopTaskProgressTimer(idPrefix);
  const st = VM_PROGRESS_STATE.get(idPrefix);
  if (st) st.percent = 100;
  refreshTaskProgressMeta(idPrefix);

  const box = document.getElementById(idPrefix + 'Progress');
  if (box) box.classList.remove('active');
  const banner = document.getElementById(idPrefix + 'CompletionBanner');
  if (banner) {
    banner.innerHTML = `<span class="check">&#10003;</span>${bannerMessage}`;
    banner.classList.add('show');
    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => banner.classList.remove('show'), 6000);
  }
}

function taskProgressReset(idPrefix) {
  stopTaskProgressTimer(idPrefix);
  VM_PROGRESS_STATE.delete(idPrefix);
  const box = document.getElementById(idPrefix + 'Progress');
  if (box) box.classList.remove('active');
  const banner = document.getElementById(idPrefix + 'CompletionBanner');
  if (banner) banner.classList.remove('show');
}
