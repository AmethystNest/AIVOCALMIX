// App core: audio context, shared state, error boundary, source-change
// invalidation, platform/resource policy and the export/render guards.
// Moved verbatim from index.html's #app-script (the DOM already exists when
// this runs, as it did inline). Loaded right before #app-script.

// v80-D13: boot-safe Web Audio constructor normalization.
// API不足ブラウザでもここで即クラッシュせず、ナビゲーション/互換性通知までは生存させる。
if (!window.OfflineAudioContext && window.webkitOfflineAudioContext) window.OfflineAudioContext = window.webkitOfflineAudioContext;
const VMAudioContextCtor = window.AudioContext || window.webkitAudioContext || null;
let audioCtx = VMAudioContextCtor ? new VMAudioContextCtor() : null;
const state = {
  vocalBuffer: null, instBuffer: null, harmonyBuffer: null,
  vocalSamples: null, instSamples: null, harmonySamples: null,
  vocalAnalysis: null, rel: null, chain: null,
  chainRules: null, // 現在選択中の設定から組み立てたルール(音量目標値の参照用)
  mixedBuffer: null,        // MIXタブでレンダリングした結果(ボーカルのみ、AudioBuffer)
  mixedBufferPreTrim: null, // ↑の音量最終補正をかける"前"の状態(Previewでの音量再調整を高速化するために保持)
  finalBuffer: null,        // Vocal向けFXまで適用した結果(ボーカルのみ、AudioBuffer)
  finalBufferPreTrim: null, // ↑の音量最終補正をかける"前"の状態
  harmonyOnlyBuffer: null,  // 馴染ませ処理後のハモリ単体(ステレオ、ボーカル/伴奏は含まない)
  harmonyOnlyFxBuffer: null,// ↑にHarmony向けFXを適用した結果(ステレオ、ハモリ単体のまま)
  mixedSongBuffer: null,    // Vocal(+Harmony) + 伴奏(実際に聴く/書き出す曲としてのMIX。Harmonyステムがあれば含む)
  fxSongBuffer: null,       // ↑にさらにFX(Vocal向けかHarmony向け)を適用した結果
  beforeBuffer: null,       // Preview「Before」用: 何も処理せずVocal(+Harmony)+伴奏をただ重ねただけの音
  vocalManualTrimDb: 0,     // Vocal音量の手動調整量(Previewタブの最終音量調整スライダーで設定)
  harmonyManualTrimDb: 0,   // Harmony音量の手動調整量(Previewのスライダー)
  harmonyProcessedPreTrim: null, // Harmonyの自動トリムをかける"前"の処理済みモノ信号(音量再調整の高速化用)
  _harmonyAnalysisCache: null, // D50: プリセット非依存の重いHarmony解析を音源世代ごとに再利用
  stemReviewCurrentBuffer: null, stemReviewCurrentLabel: '', // FXタブのステムレビューでシーク先に使う
  harmonyDiagCurrentBuffer: null, harmonyDiagCurrentLabel: '', // Mixタブのハモリ診断でシーク先に使う
  renderHistory: [],        // 比較用のレンダリング履歴 [{label, buffer, at}]
  latestRenderSummary: null, // Previewに残す最新レンダリング時の処理内容
  previewMode: 'before',  // 'before' | 'after'
  playingSource: null,
  playbackStartCtxTime: null, // audioCtx.currentTime (再生開始時) — レビュー再生のシーク位置計算用
  playbackOffset: 0,          // 再生開始時のバッファ内オフセット(秒)
  isRendering: false,         // レンダリング処理の多重実行防止フラグ
  isAnalyzing: false,         // 解析処理の多重実行防止フラグ
  sourceRevision: 0,          // 入力音源差し替え世代。古い派生結果の混入防止
  renderConfigRevision: 0,    // MIX/Harmony/伴奏設定の世代。UI表示と古いレンダーの食い違い防止
  fxConfigRevision: 0,        // FX設定の世代。古いFXレンダーの誤Export防止
  renderedSourceRevision: -1, // 最後に正常完了したMixの入力世代
  renderedConfigRevision: -1, // 最後に正常完了したMix設定世代
  fxRenderedRevision: -1,     // 最後に正常完了したFX設定世代
  isExporting: false,         // Export多重実行/入力差し替え競合防止
  meterBusy: false,          // D211: 手動LUFS/True Peak測定の多重実行防止
  // 区間ごとのFX設定。[{ startSec, endSec, reverbMix, delayMix, doublerDepth, driveAmount }]
  // 空の場合は従来通り、FXタブの設定が曲全体に一律でかかる。
  fxRegions: [],
  // 波形上でドラッグ中/選択中の範囲(まだ区間として登録していない状態)
  fxRegionSelection: null,
  fxRegionPlayhead: null, // 区間試聴中の再生位置(秒)。波形に縦線で表示する
  referenceBuffer: null,        // リファレンス音源(お手本にしたいミックス済み曲)
  referenceMatch: null,         // 分析結果(帯域差・変動指標)
  referenceMatchedBuffer: null, // 補正EQ適用後の音源
  referenceCorrection: null,    // 適用中の補正内容(Exportで再合成後にかけ直す)
  referenceRevision: 0,         // D97: リファレンス差し替え世代
  referenceAnalysisGeneration: 0, // D97: 古い分析完了の上書き防止
  referenceApplyGeneration: 0,    // D97: 古い補正レンダーの上書き防止
  activeOperation: null,         // v80-D6: 現在実行中の工程名(エラー切り分け用)
  activeStage: null,             // v80-D6: 現在実行中の詳細ステージ
  lastError: null,               // v80-D6: 直近エラー {operation, stage, message, at}
  stageTimings: [],               // D395/D396: Stage別実行時間。DSP内容は変えずボトルネック計測と実機要約表示だけ保持
  playbackGeneration: 0,          // v80-D7: 古い再生onended/timerが新しい再生を止める競合を防ぐ
  maxRenderHistory: 3,            // v80-D7: スマホのAudioBuffer保持量を制限
  activeLoads: 0,                  // v80-D8: 入力音源のdecode中カウント。解析/レンダーとの競合防止
  inputLoadGeneration: { vocal:0, instrumental:0, harmony:0, reference:0 }, // v80-D8: 古いdecode結果の逆流防止
  inputBufferBytes: { vocal:0, instrumental:0, harmony:0, reference:0 }, // v80-D9: decoded PCM概算保持量
  resourceMode: 'normal',          // v80-D9: normal | guarded（大容量時は履歴保持を抑制）
  lifecycleGeneration: 0,           // v80-D10: pagehide/pageshow世代。古い復帰処理の競合防止
  pageVisible: !document.hidden,     // v80-D10: バックグラウンド状態を追跡
};

// v80-D6: 工程単位のエラー境界。
// DSPそのものの例外を握り潰さず、「どの工程で失敗したか」を保持して上位へ返す。
// ナビゲーションはnavigation-guard-v80-d4で独立しているため、ここが失敗してもタブ操作は生存する。
class VMStageError extends Error {
  constructor(operation, stage, cause) {
    const msg = cause && cause.message ? cause.message : String(cause || '不明なエラー');
    super(msg);
    this.name = 'VMStageError';
    this.operation = operation || 'unknown';
    this.stage = stage || 'unknown';
    this.cause = cause;
  }
}
function vmErrorMessage(e) {
  const msg = e && e.message ? e.message : String(e || '不明なエラー');
  return msg.replace(/[\r\n]+/g, ' ').slice(0, 240);
}
function recordVMStageTiming(operation, stage, startedAt, ok) {
  const endedAt = performance.now();
  const entry = {
    operation: operation || 'unknown',
    stage: stage || 'unknown',
    ms: Math.max(0, endedAt - startedAt),
    ok: !!ok,
    at: Date.now()
  };
  state.stageTimings.push(entry);
  // 診断ログ自身が長時間利用時のメモリ負荷にならないよう直近96件だけ保持。
  if (state.stageTimings.length > 96) state.stageTimings.splice(0, state.stageTimings.length - 96);
  console.info(`[VM Timing] ${entry.operation} / ${entry.stage}: ${entry.ms.toFixed(1)} ms${entry.ok ? '' : ' (failed)'}`);
  return entry;
}
function getVMStageTimingSnapshot(operation) {
  const rows = operation
    ? state.stageTimings.filter((x) => x.operation === operation)
    : state.stageTimings.slice();
  return rows.map((x) => ({ ...x }));
}
function getVMOperationTimingSummary(operation, startedAt) {
  const rows = state.stageTimings.filter((x) =>
    x.operation === operation && (!startedAt || x.at >= startedAt)
  );
  if (!rows.length) return null;
  let totalMs = 0;
  let slowest = rows[0];
  for (const row of rows) {
    totalMs += row.ms;
    if (row.ms > slowest.ms) slowest = row;
  }
  const formatSec = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}秒` : `${Math.round(ms)}ms`;
  return {
    operation,
    count: rows.length,
    totalMs,
    slowestStage: slowest.stage,
    slowestMs: slowest.ms,
    text: `計測 ${formatSec(totalMs)} / 最長 ${slowest.stage} ${formatSec(slowest.ms)}`
  };
}
function appendVMOperationTiming(statusEl, operation, startedAt) {
  const summary = getVMOperationTimingSummary(operation, startedAt);
  if (!summary || !statusEl) return summary;
  const base = statusEl.textContent || '';
  statusEl.textContent = base ? `${base} ｜ ${summary.text}` : summary.text;
  console.info(`[VM Timing Summary] ${operation}: ${summary.text}`);
  return summary;
}
// D396: 実端末でDevToolsなしでも最重工程を確認できるよう、既存status-lineへ要約表示する。
// UI配置/DOM ID/DSP入出力は変更しない。
window.getVMStageTimingSnapshot = getVMStageTimingSnapshot;
window.getVMOperationTimingSummary = getVMOperationTimingSummary;

async function runVMStage(operation, stage, fn) {
  state.activeOperation = operation;
  state.activeStage = stage;
  const startedAt = performance.now();
  let ok = false;
  try {
    const result = await fn();
    ok = true;
    return result;
  } catch (e) {
    if (e instanceof VMStageError) throw e;
    throw new VMStageError(operation, stage, e);
  } finally {
    recordVMStageTiming(operation, stage, startedAt, ok);
  }
}
function recordVMError(e) {
  const operation = e && e.operation ? e.operation : (state.activeOperation || 'unknown');
  const stage = e && e.stage ? e.stage : (state.activeStage || 'unknown');
  const message = vmErrorMessage(e);
  state.lastError = { operation, stage, message, at: Date.now() };
  console.error(`[${operation}/${stage}]`, e && e.cause ? e.cause : e);
  return `エラー [${operation} / ${stage}]: ${message}`;
}
function clearVMOperation() {
  state.activeOperation = null;
  state.activeStage = null;
}

// 失敗途中のAudioBufferがstateに残ると、Preview/Exportが「半分だけ新しい状態」を参照する。
// 重い処理はトランザクションとして扱い、失敗時は直前の正常状態へ戻す。
const VM_DERIVED_KEYS = [
  'vocalAnalysis','rel','chain','chainRules','mixedBuffer','mixedBufferPreTrim',
  'finalBuffer','finalBufferPreTrim','harmonyOnlyBuffer','harmonyOnlyFxBuffer',
  'harmonyProcessedPreTrim','mixedSongBuffer','fxSongBuffer','beforeBuffer',
  'referenceMatch','referenceMatchedBuffer','referenceCorrection','stemReviewCurrentBuffer','stemReviewCurrentLabel',
  'harmonyDiagCurrentBuffer','harmonyDiagCurrentLabel','renderHistory','_harmonyComputed'
];
function snapshotDerivedState() {
  const snap = {};
  VM_DERIVED_KEYS.forEach((k) => {
    const v = state[k];
    snap[k] = Array.isArray(v) ? v.slice() : v;
  });
  return snap;
}
function restoreDerivedState(snap) {
  if (!snap) return;
  VM_DERIVED_KEYS.forEach((k) => { if (Object.prototype.hasOwnProperty.call(snap, k)) state[k] = snap[k]; });
  const dlMix = document.getElementById('btnDownloadMix');
  if (dlMix) dlMix.disabled = !state.mixedSongBuffer;
  const dlFx = document.getElementById('btnDownloadFx');
  if (dlFx) dlFx.disabled = !state.fxSongBuffer;
  if (typeof renderHistoryList === 'function') renderHistoryList();
  if (typeof checkHarmonyReady === 'function') checkHarmonyReady();
}

// 想定外の非同期例外も記録する。preventDefaultは行わずブラウザの診断情報は残す。
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev && ev.reason ? ev.reason : new Error('Unhandled Promise rejection');
  const wrapped = reason instanceof VMStageError ? reason : new VMStageError(state.activeOperation || 'global', state.activeStage || 'async', reason);
  recordVMError(wrapped);
  vmNotifyUnexpectedError(wrapped);
});
window.addEventListener('error', (ev) => {
  if (!ev || !ev.error) return;
  const wrapped = ev.error instanceof VMStageError ? ev.error : new VMStageError(state.activeOperation || 'global', state.activeStage || 'runtime', ev.error);
  recordVMError(wrapped);
  vmNotifyUnexpectedError(wrapped);
});
// スマホではコンソールが見えないため、処理の外で起きた想定外のエラーだけ短く表示する。
// 処理中(activeOperation)のエラーは各処理が既に画面へ出すので重ねて表示しない。
let vmUnexpectedErrorTimer = 0;
function vmNotifyUnexpectedError(wrapped) {
  try {
    if (state.activeOperation || typeof vmShowCompatibilityNotice !== 'function') return;
    const message = vmErrorMessage(wrapped && wrapped.cause ? wrapped.cause : wrapped);
    if (/ResizeObserver loop|^Script error/i.test(message)) return;
    vmShowCompatibilityNotice('予期しないエラーが発生しました。続けて使えない場合はアプリを閉じて開き直してください。(' + message.slice(0, 80) + ')');
    clearTimeout(vmUnexpectedErrorTimer);
    vmUnexpectedErrorTimer = setTimeout(() => {
      const el = document.getElementById('vmCompatibilityNotice');
      if (el) el.remove();
    }, 10000);
  } catch (e) {}
}
// v80-D7: PWA/ブラウザがバックグラウンド化・破棄される直前に再生ノード/タイマーを停止。
window.addEventListener('pagehide', () => { try { stopPlayback(); } catch (e) {} });

// v80-D7: 再生系を一か所で停止する。
// AudioBufferSourceNode / setInterval / 再生位置状態を確実に切り離し、
// 音源差し替えや再レンダー時に古いsource/timerが残らないようにする。
function stopPlayback({ resetUi = false } = {}) {
  state.playbackGeneration++;
  const src = state.playingSource;
  state.playingSource = null;
  if (src) {
    try { src.onended = null; } catch (e) {}
    try { src.stop(); } catch (e) {}
    try { src.disconnect(); } catch (e) {}
  }
  if (typeof stopPreviewTimer === 'function') stopPreviewTimer();
  if (typeof fxRegionPlayTimer !== 'undefined' && fxRegionPlayTimer) {
    cancelAnimationFrame(fxRegionPlayTimer);
    fxRegionPlayTimer = null;
  }
  state.playbackStartCtxTime = null;
  state.playbackOffset = 0;
  state.fxRegionPlayhead = null;
  if (resetUi) {
    const ids = ['previewTime','stemReviewTime','harmonyDiagTime'];
    ids.forEach(id => { const el=document.getElementById(id); if(el) el.textContent=''; });
    ['previewProgressFill','stemReviewProgressFill','harmonyDiagProgressFill'].forEach(id => { const el=document.getElementById(id); if(el) el.style.width='0%'; });
    const ph=document.getElementById('previewPlayhead'); if(ph) ph.style.left='0%';
  }
}

// 派生AudioBuffer参照を明示的に外す。Web Audioの実メモリ解放はGCに委ねるが、
// stateから到達可能な参照を残さないことで長時間利用時のメモリ増加を抑える。
function releaseDerivedAudioRefs({ keepVocalMix = false } = {}) {
  if (!keepVocalMix) {
    state.mixedBuffer = null;
    state.mixedBufferPreTrim = null;
    state.finalBuffer = null;
    state.finalBufferPreTrim = null;
  }
  state.harmonyOnlyBuffer = null;
  state.harmonyOnlyFxBuffer = null;
  state.harmonyProcessedPreTrim = null;
  state.mixedSongBuffer = null;
  state.fxSongBuffer = null;
  state.beforeBuffer = null;
  state.referenceMatchedBuffer = null;
  state.referenceCorrection = null;
  state.stemReviewCurrentBuffer = null;
  state.harmonyDiagCurrentBuffer = null;
}

// v80-D5: 入力音源と派生結果の依存関係を一か所で管理する。
// 「音源を差し替えたのに以前の解析/MIX/FXが残る」事故を防ぐ。
function clearRenderedOutputs({ keepVocalMix = false } = {}) {
  stopPlayback();
  releaseDerivedAudioRefs({ keepVocalMix });
  state.referenceMatch = null;
  state.renderHistory = [];
  state.latestRenderSummary = null;
  const dl = document.getElementById('btnDownloadMix');
  if (dl) dl.disabled = true;
  const hist = document.getElementById('renderHistoryList');
  if (hist && typeof renderHistoryList === 'function') renderHistoryList();
  if (typeof renderLatestProcessSummary === 'function') renderLatestProcessSummary();
}
function invalidateForSourceChange(kind) {
  // v80-D5契約: Reference差し替えで破棄するのはReference Match結果のみ(setupDrop側で
  // referenceRevision等を更新済み)。Mix/FX結果まで古い扱いにすると、Mix後にリファレンスを
  // 読み込んだだけで「先にMixタブでレンダリングしてください」となり分析できなかった。
  if (kind === 'reference') return;
  if (typeof vmSpectrumGeneration !== 'undefined') vmSpectrumGeneration++;
  if (typeof vmInstReviewGeneration !== 'undefined') vmInstReviewGeneration++;
  state.sourceRevision++;
  state.renderedSourceRevision = -1;
  state.renderedConfigRevision = -1;
  state.fxRenderedRevision = -1;
  stopPlayback();
  if (kind === 'vocal' || kind === 'instrumental') {
    state.vocalAnalysis = null;
    state.rel = null;
    state.chain = null;
    state.chainRules = null;
    state._harmonyComputed = null;
    clearRenderedOutputs();
  } else if (kind === 'harmony') {
    state._harmonyComputed = null;
    state._harmonyAnalysisCache = null;
    // Vocal単体のMix結果は再利用可能。ただしHarmonyを含む曲全体は必ず作り直す。
    clearRenderedOutputs({ keepVocalMix: true });
  }
  const hp = document.getElementById('harmonyDiagPanel');
  if (hp) hp.style.display = 'none';
  if (typeof removeHarmonyFxOption === 'function') removeHarmonyFxOption();
}
function setSourceInputsDisabled(disabled) {
  ['fileVocal','fileInst','fileHarmony','fileReference'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  });
}

// v80-D8: iOS/Safari等ではAudioContextがsuspendedのまま作られることがある。
// ユーザー操作から呼ばれる再生/読み込み時だけresumeし、DSP内容には触れない。
let _vmAudioContextRecoveryPromise = null;
let _vmAudioContextNeedsHealthCheck = false;

function vmMarkAudioContextNeedsHealthCheck() {
  _vmAudioContextNeedsHealthCheck = true;
}

async function vmResumeAudioContextBounded(ctx) {
  if (!ctx || typeof ctx.resume !== 'function') return;
  const isiOS = typeof VM_PLATFORM !== 'undefined' && VM_PLATFORM && VM_PLATFORM.isiOS;
  const timeoutMs = isiOS ? 1200 : 2500;
  let timer = 0;
  try {
    await Promise.race([
      Promise.resolve().then(() => ctx.resume()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('AudioContext resume timeout')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function vmAudioContextClockAdvances(ctx) {
  if (!ctx || ctx.state !== 'running') return false;
  const t0 = Number(ctx.currentTime) || 0;
  await new Promise((resolve) => setTimeout(resolve, 120));
  const t1 = Number(ctx.currentTime) || 0;
  return (t1 - t0) >= 0.02;
}

async function vmRecreateAudioContext(reason) {
  const old = audioCtx;
  // WebKitでclose()/resume()自体が停滞するケースがあるため、旧Contextのclose完了は待たない。
  try {
    if (old && old.state !== 'closed') Promise.resolve(old.close()).catch(()=>{});
  } catch (_) {}
  audioCtx = new VMAudioContextCtor();
  try {
    if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
      await vmResumeAudioContextBounded(audioCtx);
    }
  } catch (e) {
    console.warn(`[AudioContext recreate/${reason}]`, e);
  }
  return audioCtx;
}

async function ensureAudioContextReady() {
  if (!VMAudioContextCtor) throw new Error('このブラウザではAudioContextを利用できません');
  if (_vmAudioContextRecoveryPromise) return _vmAudioContextRecoveryPromise;
  _vmAudioContextRecoveryPromise = (async () => {
    try {
      if (!audioCtx || audioCtx.state === 'closed') audioCtx = new VMAudioContextCtor();

      if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
        try {
          await vmResumeAudioContextBounded(audioCtx);
        } catch (e) {
          console.warn('[AudioContext resume]', e);
          // D410: iOS PWAではresume()が返らない/復帰しないWebKit事例がある。
          // 無期限待機せず新Contextへ切替え、UI操作を止めない。
          if (typeof VM_PLATFORM !== 'undefined' && VM_PLATFORM && VM_PLATFORM.isiOS) {
            await vmRecreateAudioContext('resume-timeout');
          }
        }
      }

      if (audioCtx.state === 'closed' || audioCtx.state === 'interrupted') {
        await vmRecreateAudioContext('bad-state');
      }

      // D410: iOSではstate='running'でもcurrentTimeが停止したまま無音になるWebKit事例がある。
      // background/pageshow後だけ時計を短時間確認し、停止時のみContextを再生成する。
      if (_vmAudioContextNeedsHealthCheck &&
          typeof VM_PLATFORM !== 'undefined' && VM_PLATFORM && VM_PLATFORM.isiOS &&
          audioCtx && audioCtx.state === 'running') {
        _vmAudioContextNeedsHealthCheck = false;
        let advances = true;
        try { advances = await vmAudioContextClockAdvances(audioCtx); } catch (_) {}
        if (!advances) await vmRecreateAudioContext('stalled-clock');
      } else {
        _vmAudioContextNeedsHealthCheck = false;
      }

      return audioCtx ? audioCtx.state : 'closed';
    } finally { _vmAudioContextRecoveryPromise = null; }
  })();
  return _vmAudioContextRecoveryPromise;
}

function setBusyByInputLoad() {
  const btnAnalyze = document.getElementById('btnAnalyze');
  if (btnAnalyze) {
    const ready = !!(state.vocalBuffer && state.instBuffer);
    btnAnalyze.disabled = state.activeLoads > 0 || state.isAnalyzing || state.isRendering || state.isExporting || state.referenceBusy || state.meterBusy || !ready;
  }
}

function decodedBufferLooksValid(buf) {
  return !!buf && Number.isFinite(buf.duration) && buf.duration > 0 && Number.isFinite(buf.sampleRate) && buf.sampleRate > 0 && buf.length > 0;
}


// v80-D9: スマホで長尺/大容量音源を読み込んだ際のメモリ暴走を防ぐ。
// AudioBufferは概ね Float32(4byte) × samples × channels を占有するため、
// 圧縮ファイルのMB数ではなく「decode後PCMの概算量」を基準に判定する。
// v80-D83: 端末メモリに応じて入力AudioBufferの安全上限を調整する。
// navigator.deviceMemory非対応(iPhone/Safari等)では従来値を維持する。

const VM_PLATFORM = Object.freeze((() => {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = Number(navigator.maxTouchPoints) || 0;
  const isiPhoneLike =
    /iPad|iPhone|iPod/i.test(ua) ||
    (platform === 'MacIntel' && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = !!(
    navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );

  return {
    isiOS: isiPhoneLike,
    isAndroid,
    isStandalone,
    safariLike: isiPhoneLike && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)
  };
})());

function getVMResourcePolicy() {
  const dm = Number(navigator.deviceMemory);
  let guardedDecodedBytes = 260 * 1024 * 1024;
  let maxDecodedInputBytes = 520 * 1024 * 1024;
  let maxFileBytesBeforeDecode = 350 * 1024 * 1024;

  // D235: iOS Safariではnavigator.deviceMemoryが得られない環境があるため、
  // 「不明 = 高性能端末」とみなして520MBまで許可するのは危険。
  // iPhone/iPadではアプリ側の安全基準を保守的に設定し、ページ強制再読込を避ける。
  if (VM_PLATFORM.isiOS) {
    guardedDecodedBytes = 140 * 1024 * 1024;
    maxDecodedInputBytes = 300 * 1024 * 1024;
    maxFileBytesBeforeDecode = 220 * 1024 * 1024;
  } else if (Number.isFinite(dm) && dm > 0) {
    if (dm <= 2) {
      guardedDecodedBytes = 96 * 1024 * 1024;
      maxDecodedInputBytes = 190 * 1024 * 1024;
      maxFileBytesBeforeDecode = 180 * 1024 * 1024;
    } else if (dm <= 4) {
      guardedDecodedBytes = 160 * 1024 * 1024;
      maxDecodedInputBytes = 320 * 1024 * 1024;
      maxFileBytesBeforeDecode = 260 * 1024 * 1024;
    } else if (dm <= 6) {
      guardedDecodedBytes = 220 * 1024 * 1024;
      maxDecodedInputBytes = 440 * 1024 * 1024;
      maxFileBytesBeforeDecode = 320 * 1024 * 1024;
    }
  }

  return Object.freeze({
    deviceMemoryGB: Number.isFinite(dm) && dm > 0 ? dm : null,
    platform: VM_PLATFORM.isiOS ? 'ios' : (VM_PLATFORM.isAndroid ? 'android' : 'other'),
    maxFileBytesBeforeDecode,
    maxDurationSec: 20 * 60,
    guardedDecodedBytes,
    maxDecodedInputBytes
  });
}

if (VM_PLATFORM.isiOS) {
  document.documentElement.classList.add('vm-ios');
  if (VM_PLATFORM.isStandalone) document.documentElement.classList.add('vm-ios-standalone');
}
const VM_RESOURCE_POLICY = getVMResourcePolicy();
// D402: iPhone/guarded modeではMix完了時のメモリピークを抑えるため、
// Preview用Beforeバッファだけ遅延生成する。DSP式・合成内容は既存ensureBeforeBuffer()のまま。
function shouldDeferBeforeBufferGeneration() {
  return !!(VM_PLATFORM.isiOS || state.resourceMode === 'guarded');
}

// estimateAudioBufferBytes(): 後方のレンダリング履歴セクションで定義(同一スクリプト内で後の宣言が有効)。
function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb/1024).toFixed(2)}GB` : `${mb.toFixed(mb < 100 ? 1 : 0)}MB`;
}
function projectedInputBytes(kind, newBytes) {
  let total = 0;
  for (const [k, v] of Object.entries(state.inputBufferBytes || {})) total += (k === kind ? newBytes : (v || 0));
  return total;
}
function applyResourceMode(projectedBytes) {
  const guarded = projectedBytes >= VM_RESOURCE_POLICY.guardedDecodedBytes;
  state.resourceMode = guarded ? 'guarded' : 'normal';
  state.maxRenderHistory = guarded ? 1 : 3;
  if (guarded && state.renderHistory.length > 1) {
    state.renderHistory.splice(0, state.renderHistory.length - 1);
  }
  if (typeof trimRenderHistoryToBudget === 'function') trimRenderHistoryToBudget();
  if (typeof renderHistoryList === 'function') renderHistoryList();
  document.body.classList.toggle('resource-guarded', guarded);
  return guarded;
}
function validateResourceBudgetBeforeDecode(file) {
  if (file && Number.isFinite(file.size) && file.size > VM_RESOURCE_POLICY.maxFileBytesBeforeDecode) {
    throw new Error(`ファイルが大きすぎます (${formatBytes(file.size)})。この端末のメモリ保護上限 ${formatBytes(VM_RESOURCE_POLICY.maxFileBytesBeforeDecode)} 以下の音源を選んでください。`);
  }
}
function validateDecodedResourceBudget(kind, buf) {
  if (buf.duration > VM_RESOURCE_POLICY.maxDurationSec) {
    throw new Error(`音源が長すぎます (${(buf.duration/60).toFixed(1)}分)。安全上限は20分です`);
  }
  const bytes = estimateAudioBufferBytes(buf);
  const projected = projectedInputBytes(kind, bytes);
  if (projected > VM_RESOURCE_POLICY.maxDecodedInputBytes) {
    const deviceHint = VM_RESOURCE_POLICY.deviceMemoryGB
      ? ` / 端末メモリ目安${VM_RESOURCE_POLICY.deviceMemoryGB}GB`
      : '';
    throw new Error(`読み込み後の音声メモリが安全上限を超えます (推定${formatBytes(projected)}${deviceHint})。音源を短くするか不要なステムを外してください`);
  }
  return { bytes, projected, guarded: applyResourceMode(projected) };
}
function commitInputResourceUsage(kind, bytes) {
  state.inputBufferBytes[kind] = Math.max(0, bytes || 0);
  applyResourceMode(Object.values(state.inputBufferBytes).reduce((a,b)=>a+(b||0),0));
}
function currentInputResourceBytes() {
  return Object.values(state.inputBufferBytes || {}).reduce((a,b)=>a+(b||0),0);
}
function prepareForHeavyOperation() {
  const guarded = state.resourceMode === 'guarded';
  const iosSafety = VM_PLATFORM && VM_PLATFORM.isiOS;

  // D235: iOSはdeviceMemoryが取得できない場合でも、重処理前に比較用参照だけを整理する。
  // 現在の入力・Mix・FX結果は保持し、音声DSP結果自体には触れない。
  if (!guarded && !iosSafety) return;

  stopPlayback();
  if (state.renderHistory.length > 1) state.renderHistory.splice(0, state.renderHistory.length - 1);
  state.stemReviewCurrentBuffer = null;
  state.harmonyDiagCurrentBuffer = null;

  const dm = VM_RESOURCE_POLICY.deviceMemoryGB;
  if ((dm != null && dm <= 4) || iosSafety) {
    if (Array.isArray(state.renderHistory)) state.renderHistory.length = 0;
    if ('beforeBuffer' in state) state.beforeBuffer = null;
  }
}

// v80-D17: stale-result guard
// UI設定や入力が処理中に変わった場合、その結果を「最新」として確定しない。
function assertSourceRevision(expected, operation, stage) {
  if (state.sourceRevision !== expected) {
    throw new VMStageError(operation, stage, new Error('処理中に入力音源が変更されたため、この結果は破棄しました'));
  }
}
function currentMixRevisionToken() {
  return `${state.sourceRevision}:${state.renderConfigRevision}`;
}
function mixResultIsCurrent() {
  return state.renderedSourceRevision === state.sourceRevision &&
         state.renderedConfigRevision === state.renderConfigRevision &&
         !!state.mixedSongBuffer;
}
function invalidateFxOutputsOnly() {
  stopPlayback();
  state.finalBuffer = null;
  state.finalBufferPreTrim = null;
  state.harmonyOnlyFxBuffer = null;
  state.fxSongBuffer = null;
  state.referenceMatchedBuffer = null;
  state.referenceCorrection = null;
  state.fxRenderedRevision = -1;
  const dlFx = document.getElementById('btnDownloadFx');
  if (dlFx) dlFx.disabled = true;
}
function markMixConfigChanged(kind = 'mix') {
  if (typeof vmSpectrumGeneration !== 'undefined') vmSpectrumGeneration++;
  if (typeof vmInstReviewGeneration !== 'undefined') vmInstReviewGeneration++;
  state.renderConfigRevision++;
  state.renderedConfigRevision = -1;
  state.fxRenderedRevision = -1;
  if (kind === 'harmony') {
    state._harmonyComputed = null;
    clearRenderedOutputs({ keepVocalMix: true });
  } else clearRenderedOutputs();
}
function markFxConfigChanged() {
  if (typeof vmSpectrumGeneration !== 'undefined') vmSpectrumGeneration++;
  state.fxConfigRevision++;
  invalidateFxOutputsOnly();
}

// v80-D18: Exportはレンダーと同様に排他的に扱う。
async function withExportGuard(fn, triggerId) {
  if (state.isExporting || state.isRendering || state.isAnalyzing || state.referenceBusy || state.meterBusy || state.activeLoads > 0) return;
  prepareForHeavyOperation();
  vmActiveExportTriggerId = triggerId || null;
  state.isExporting = true;
  document.body.classList.add('is-exporting');
  syncVMProcessingClass();

  // D217: タップ直後に「押せた」ことが分かるよう、実際に押した書き出しボタンだけ
  // 視覚的な処理中状態へ切り替える。CSSアニメーションはtransform/opacity中心なので、
  // JSの重い処理中でもブラウザのcompositorで動き続けやすい。
  const activeButton = triggerId ? document.getElementById(triggerId) : null;
  if (activeButton) {
    activeButton.dataset.vmExportPrevText = activeButton.textContent || '';
    activeButton.classList.add('vm-export-active');
    activeButton.textContent = '処理中…';
  }

  // D152: 書き出し開始時の設定を固定し、処理中の誤操作で
  // stale判定→書き出し中止になるのを防ぐ。
  const controls = ['btnExport','btnExportMaster','exportBitDepth','exportSampleRate','exportFinishMode']
    .map(id => document.getElementById(id))
    .filter(Boolean);

  controls.forEach((el) => {
    if (!Object.prototype.hasOwnProperty.call(el.dataset, 'vmExportPrevDisabled')) {
      el.dataset.vmExportPrevDisabled = el.disabled ? '1' : '0';
    }
    el.disabled = true;
    el.setAttribute('aria-busy', 'true');
  });

  setSourceInputsDisabled(true);

  // 描画を最低1回確定させてからAudioContext/DSPへ入る。
  // これにより、重い処理開始直後でもボタン・リングが先に見える。
  await yieldToBrowser();

  try {
    await ensureAudioContextReady();
    await fn();
  } finally {
    state.isExporting = false;
    document.body.classList.remove('is-exporting');
    syncVMProcessingClass();

    if (activeButton) {
      activeButton.classList.remove('vm-export-active');
      if (Object.prototype.hasOwnProperty.call(activeButton.dataset, 'vmExportPrevText')) {
        activeButton.textContent = activeButton.dataset.vmExportPrevText;
        delete activeButton.dataset.vmExportPrevText;
      }
    }

    controls.forEach((el) => {
      const prev = el.dataset.vmExportPrevDisabled;
      el.disabled = prev === '1';
      delete el.dataset.vmExportPrevDisabled;
      el.removeAttribute('aria-busy');
    });

    setSourceInputsDisabled(false);
    setBusyByInputLoad();
    vmActiveExportTriggerId = null;
    refreshIosPendingSaveButton();
  }
}

// v80-D19: 外部要因や将来のUI変更でstateが半端な状態になっても、Preview/Export前に停止する。
function validateAudioBufferInvariant(buf, label) {
  if (!buf) throw new Error(`${label}がありません`);
  if (!Number.isFinite(buf.duration) || buf.duration <= 0 || !Number.isFinite(buf.sampleRate) || buf.sampleRate <= 0 || !Number.isFinite(buf.length) || buf.length <= 0) {
    throw new Error(`${label}のAudioBufferが不正です`);
  }
  return true;
}
function assertCurrentMixForOutput() {
  if (!mixResultIsCurrent()) {
    throw new Error('現在の設定に対するMIXが未レンダリングです。Mixタブで再レンダリングしてください');
  }
  validateAudioBufferInvariant(state.mixedSongBuffer, 'MIX結果');
}

// 重いUI更新の直後に同期的な重い処理(FFT解析、サンプル配列処理等)を続けると、
// ブラウザがテキスト変更を描画する前に処理が終わってしまい、「解析中...」等の
// 状態表示が一切見えないバグになる。この関数を挟むことで、必ず一度描画してから
// 処理を続けることを保証する。
function yieldToBrowser() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
