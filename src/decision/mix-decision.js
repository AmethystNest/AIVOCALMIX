// MIX decision layer: analysis results + selected settings -> processing chain.
// Pure functions and data only (no DOM, Web Audio or app state). Moved verbatim
// from the main app script in index.html; loaded as a classic script before it
// so the declarations stay global. Covered by tests/mix-decision-regression.cjs.
const DEFAULT_MIX_RULES = {
  highpassCutoffHz: 80,
  brightness: {
    centroidBrightThresholdHz: 3200, centroidDarkThresholdHz: 1600,
    brightEq: { freqHz: 4000, gainDb: -2.5, q: 1.2 },
    darkEq: { freqHz: 8000, gainDb: 2.0, q: 0.9 },
  },
  sibilance: { ratioThreshold: 0.12, deEsser: { thresholdDb: -26, ratio: 4.0, freqHz: 6500 } },
  dynamics: {
    crestHighThresholdDb: 18, crestMediumThresholdDb: 12,
    compressorStrong: { thresholdDb: -20, ratio: 3.5, attackMs: 6, releaseMs: 90 },
    compressorLight: { thresholdDb: -16, ratio: 2.0, attackMs: 10, releaseMs: 120 },
  },
  blend: {
    // 以前は許容範囲が[-6,+3]と広く、伴奏より最大+3dBまで大きくても
    // 「補正不要」と判定されて生の録音レベルがそのまま素通りしていた。
    // これが「自動だとボーカルが大きすぎる」の直接の原因だったため、
    // 許容範囲全体を下げ、上限も+3→-2へ大きく引き締めた。
    levelDiffLowThresholdDb: -8, maxGainBoostDb: 6,
    levelDiffHighThresholdDb: -2, maxGainCutDb: 8, // ボーカルが伴奏に対し大きすぎ(浮く)場合の下限補正
    // 最終的な音量バランスの「目標値」(Vocal+Harmony合計 - 伴奏、単位dB)。
    // 上の許容範囲方式は「範囲内なら何もしない」ため、素材によって最大6dBも
    // ばらつき、結果として「Vocalが大きすぎる時がある」原因になっていた。
    // 常にこの目標値ぴったりへ合わせることで、どのプリセットの組み合わせでも
    // 一貫したバランスになる(手動での微調整は従来通りPreviewタブで行える)。
    targetVocalToInstDb: -4.0,
    maxAutoAdjustDb: 12, // 自動調整の上限(極端な素材で暴れないように)
    maskingRatioThreshold: 0.52,
    maskingEq: { freqHz: 3000, gainDb: 1.5, q: 1.0 },
    presenceLowThreshold: 0.15,
    presenceEq: { freqHz: 2000, gainDb: 2.0, q: 1.1 },
  },
  // リバーブを自動MIXに含めるかどうか。デフォルトtrue(従来通り、ドライすぎる
  // 場合に自動でリバーブを足す)。falseにすると、乾き具合に関わらずVocalの
  // 自動リバーブ(Room+Plateの並列送り)を一切追加しない。
  reverbAutoEnabled: true,
  reverbForDrySource: { dynamicRangeLowThresholdDb: 4, reverb: { mix: 0.15, decay: 0.4, predelayMs: 15, character: 'hall' } },
  // 「聞こえない程度」の極短マイクロディレイ(仕様書のショートディレイとは別枠)。
  // 単発(フィードバック無し)・左右で少し違う時間(Haas効果の知覚しきい値を
  // 大きく下回る値)をかけることで、ディレイそのものには気づかれないまま、
  // 倍音の強調(厚み)と左右の時間差による広がり(立体感)を得る。
  thickenDelay: { enabled: false, timeLMs: 14, timeRMs: 19, mix: 0.18 },
  // 残響ゲート。デフォルト無効。有効時は「アップロード音源に既に含まれる
  // リバーブの尻尾」を軽減してから、後続処理(新しいリバーブ等)に渡す。
  reverbTailGate: { enabled: false, thresholdDropDb: 14, reduceTo: 0.35, attackMs: 3, releaseMs: 120 },
  // クリップ修復。録音時点で潰れた波形を推定で埋め直し、ガビガビした歪みを軽減する。
  // 完全復元ではないため、デフォルトは無効(UIのトグルで有効化)。
  clipRepair: { enabled: false, threshold: 0.985, minRun: 3, maxRunSamples: 220 },
  expander: { dynamicRangeTriggerDb: 8, thresholdDb: -45, ratio: 2.5, attackMs: 5, releaseMs: 120 },
  clickReduction: { sibilanceTriggerRatio: 0.12 }, // deEsserと同条件で連動発火(近接マイクは口の雑音も出やすい傾向)
  breathControl: { enabled: false, tooLoudDb: -20, reduceTo: 0.45 }, // 大きすぎるブレスだけ軽減(仕様書8番)。UIのトグルでON/OFF切り替え
  lowpass: { sibilanceHighTriggerRatio: 0.20, cutoffHz: 15000 }, // deEsserでも足りないほど歯擦音が強い場合の追加策
  shortDelay: { enabled: false, dynamicRangeLowThresholdDb: 3, timeMs: 70, feedback: 0.15, mix: 0.12 },
  exciter: { enabled: false, freqHz: 4500, driveDb: 6, mix: 0.15 },
  saturation: { enabled: false, drive: 0.15, asymmetric: false },
  ducking: { enabled: true, amount: 0.35, forceOn: false }, // マスキング判定時、伴奏を動的にダッキングする(EQより積極的な対策)。forceOnはUploadタブのトグルで明示的に有効化された場合
  stereoWidth: { enabled: false, width: 0.5 },
  // マルチバンドコンプレッション。ONの場合、通常の(帯域を分けない)2段コンプの
  // 代わりに使う。低域<250Hz/中域250Hz-4kHz/高域>4kHzを独立して圧縮するため、
  // 「低音の一発で高音まで一緒に潰れる」ことが無くなり、より透明感が出る。
  multibandCompression: { enabled: false, lowFreqHz: 250, highFreqHz: 4000 },
  // パラレルコンプレッション(ニューヨークコンプ)。原音とは別に非常に強く
  // 圧縮した信号を作ってブレンドする。ダイナミクスの自然さを保ったまま
  // 密度感・パンチを足せる、プロの現場で定番の手法。
  parallelCompression: { enabled: false, thresholdDb: -32, ratio: 10, attackMs: 3, releaseMs: 80, mix: 0.25 },
  resonance: {
    // 仕様書4番。qは検証済みの8で固定(過検出を避けるため帯域を絞る必要があった)。
    // triggerRatioはanalyze()のboxy/muddy/harshRatio(その帯域の全体に対する
    // エネルギー比率)がこれを超えたら「そもそもこの帯域が問題になりやすい曲」と
    // 判断してdynamicEQステップを追加する、という発動条件。
    boxy: { freqHz: 350, q: 8, triggerRatio: 0.16, thresholdRatio: 0.35, maxCutDb: 4 },   // こもり/箱鳴り
    muddy: { freqHz: 750, q: 8, triggerRatio: 0.16, thresholdRatio: 0.35, maxCutDb: 4 },  // 中域の濁り
    harsh: { freqHz: 3000, q: 8, triggerRatio: 0.16, thresholdRatio: 0.35, maxCutDb: 4 }, // 硬さ/攻撃性
  },
  // 録音時の歪みによる超高域の暴れを、解析結果から自動で検出して抑える。
  // マイク補正トグルとは独立して常に働く(スマホ録音に限らず、大きな声で
  // 歪んでしまった素材全般に効くため)。
  // distortionRatio(音量上位25%と下位25%の超高域比率の比)がtriggerRatioを
  // 超えた場合だけダイナミックEQを追加し、強く出た瞬間のみ抑制する。
  // triggerRatioは実測に基づいて決定: 実際に歪んでいたスマホ録音が1.96、
  // クリーンな合成信号が0.82だったため、その間の1.6を境界とした。
  distortionControl: {
    enabled: true, triggerRatio: 1.6,
    freqHz: 9000, q: 1.2, thresholdRatio: 0.16, maxCutDb: 5,
  },
  limiterCeilingDb: -0.3,
  // 「透明感」トグル(主に女性ボーカル向け)。息づかいの自然な空気感を残しつつ
  // 超高域(10kHz以上)にきらめきを加え、中低域の こもりを軽く整理して抜け感を出す。
  // MIXパターン・距離感とは独立した第3の軸として、どの組み合わせにも重ねられる。
  airEnhance: {
    enabled: false,
    // 超高域シェルフ的なブースト(息の倍音・サ行の煌めきが乗る帯域)
    airShelf: { freqHz: 12000, gainDb: 2.5, q: 0.7 },
    // 中低域を軽く削って「重さ」を取り、相対的に高域が抜けて聴こえるようにする
    thinning: { freqHz: 350, gainDb: -1.5, q: 1.0 },
    // 8kHz付近を狙った控えめなエキサイター(既存のexciterとは別枠、常にこの用途専用)
    shimmer: { freqHz: 8000, driveDb: 4, mix: 0.10 },
  },
  // セクション別自動バランス(仕様書のセクション自動検出に近い発想、ただし
  // 本物の曲構造解析ではなく伴奏エネルギーのパーセンタイルベースの近似)。
  // MIXパターン・距離感・透明感とは独立した第4の軸。
  sectionBalance: {
    enabled: false,
    windowSec: 6, boostDb: 1.5, cutDb: -0.5,
  },
  // スマホ/イヤホンマイク録音向けの補正(第5の軸)。
  // 小型マイクカプセルの一般的な傾向: (1)低域が薄く「痩せた」音になりがち
  // (2)特定帯域(3-4kHz付近)に共振が出やすく硬さ・キンつきの原因になる
  // (3)マイクプリアンプの自己ノイズでノイズフロアが高め
  // (4)口元に近い/一定しない距離のため、通常よりブレスが目立ちやすい
  // (5)ハンドリングノイズ・タッチノイズが乗りやすい
  // ここでは(1)(2)を常時の補正EQとして加え、(3)(4)(5)については
  // 既存の解析ベースの判定(エキスパンダー/クリック低減/ブレス処理)の
  // 発動しきい値そのものを下げることで「同じロジックだが、より敏感に反応する」
  // ようにする(固定EQを機械的に足すだけでなく、解析駆動という設計方針を維持)。
  recordingSource: {
    enabled: false,
    // イヤホンマイク/スマホ内蔵マイクの具体的な弱点それぞれに対策を当てる。
    // 以前は「200Hz +1.5dB」「3.5kHz -2.0dB」の2本だけで、安全側に振りすぎて
    // 効果が薄かったため、狙いを明確にして作り直した。
    //
    // (1) こもり除去: 口元に近い小型マイクは近接効果で中低域(300Hz付近)が
    //     膨らみ、「ぼやけた・こもった」印象になりやすい。ここを軽く削る。
    //     ※以前は逆に200Hzを持ち上げていたが、イヤホンマイクでは
    //       むしろ膨らんでいることの方が多いため方針を反転した。
    muddyCarve: { freqHz: 300, gainDb: -2.5, q: 1.0 },
    // (2) 硬さ・キンつき除去: 小型カプセル特有の共振。以前は3.5kHzを広めに
    //     削っていたが、この帯域は子音の聞き取りやすさにも関わるため、
    //     削りすぎると逆にこもる。より高い位置を狭く(Q高め)狙う。
    harshCarve: { freqHz: 4200, gainDb: -2.5, q: 2.2 },
    // (3) 明瞭度の補強: 声の芯・輪郭が出る帯域を軽く持ち上げて前に出す。
    presenceLift: { freqHz: 2000, gainDb: 1.5, q: 1.0 },
    // (4) 失われた超高域の復元: 小型マイクは物理的に10kHz以上がほとんど
    //     収音できず、声の「空気感」が丸ごと失われる。ここを単純なEQで
    //     持ち上げても、元々信号が無い場所ではノイズが持ち上がるだけなので、
    //     既存の倍音から新しい高域を合成するエキサイターで補う。
    // 「空気感」に効くのは10kHz以上の超高域。以前は7000Hzからブーストして
    // いたが、これはデエッサーが狙う歯擦音帯域(6.5kHz付近)とほぼ重なって
    // おり、歯擦音に直接倍音を足してしまうため割れ・ノイズの原因になっていた
    // (実際に報告された不具合)。開始位置を10kHzまで上げて棲み分ける。
    // driveも歯擦音の刺激を抑えるため5→4dBに緩和。
    airRestore: { freqHz: 10000, driveDb: 4, mix: 0.16 },
  },
};

function deepMerge(base, patch) {
  const result = JSON.parse(JSON.stringify(base));
  (function merge(dst, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object') {
        merge(dst[k], src[k]);
      } else {
        dst[k] = src[k];
      }
    }
  })(result, patch);
  return result;
}

// MIXパターン: 判断の閾値・処理量だけを調整する(「何を問題とみなすか」の
// 検出ロジック自体はdecideChainで共通。パターンはそのチューニングプリセット)。
const MIX_PRESETS = {
  natural: { label: 'ナチュラル(標準)', desc: '解析結果に素直に従う標準設定。', patch: {} },
  tight: {
    label: 'タイト',
    desc: '余分な低域と残響を整理し、強く潰しすぎず発音とタイミングの輪郭を揃える。ドライでクリーンな密着感。',
    patch: {
      highpassCutoffHz: 100, // D397: Rockよりクリーンな整理。痩せすぎを避けつつ不要低域を整理
      dynamics: { crestHighThresholdDb: 12, crestMediumThresholdDb: 7,
        compressorStrong: { thresholdDb: -22, ratio: 4.5, attackMs: 7, releaseMs: 70 },
        compressorLight: { thresholdDb: -18, ratio: 2.8, attackMs: 10, releaseMs: 90 } },
      reverbForDrySource: { dynamicRangeLowThresholdDb: 2.0, reverb: { mix: 0.05, decay: 0.18, predelayMs: 7, character: 'room' } },
      shortDelay: { enabled: true, dynamicRangeLowThresholdDb: 5, timeMs: 45, feedback: 0.06, mix: 0.07 },
      sibilance: { ratioThreshold: 0.08 },
    },
  },
  ballad: {
    label: 'バラード',
    desc: '低域を残して温かく、コンプはごく軽く自然なダイナミクスを活かす。リバーブを大胆に増やし余韻を作る。',
    patch: {
      highpassCutoffHz: 40, // 常時適用。低域を残して温かみを出す
      dynamics: { crestHighThresholdDb: 26, crestMediumThresholdDb: 20,
        compressorStrong: { thresholdDb: -16, ratio: 2.0, attackMs: 15, releaseMs: 180 },
        compressorLight: { thresholdDb: -14, ratio: 1.4, attackMs: 20, releaseMs: 200 } },
      reverbForDrySource: { dynamicRangeLowThresholdDb: 9, reverb: { mix: 0.42, decay: 1.4, predelayMs: 35, character: 'hall' } },
      brightness: { darkEq: { gainDb: 3.0 }, centroidDarkThresholdHz: 2200 },
      saturation: { enabled: true, drive: 0.12, asymmetric: true }, // 真空管的な柔らかい温かみ(偶数次倍音)
    },
  },
  rock: {
    label: 'ロック',
    desc: '低域を削りつつ非常に強いコンプで前に出す。プレゼンスを大胆に強調、リバーブはほぼ無し。',
    patch: {
      highpassCutoffHz: 100,
      dynamics: { crestHighThresholdDb: 7, crestMediumThresholdDb: 4,
        compressorStrong: { thresholdDb: -26, ratio: 8.0, attackMs: 2, releaseMs: 35 },
        compressorLight: { thresholdDb: -22, ratio: 5.0, attackMs: 3, releaseMs: 50 } },
      reverbForDrySource: { dynamicRangeLowThresholdDb: 0.5, reverb: { mix: 0.03, decay: 0.12, predelayMs: 3, character: 'room' } },
      shortDelay: { enabled: true, dynamicRangeLowThresholdDb: 3, timeMs: 90, feedback: 0.2, mix: 0.14 },
      blend: { presenceEq: { gainDb: 4.5, freqHz: 2200 }, maskingEq: { gainDb: 3.0 } },
      sibilance: { ratioThreshold: 0.09, deEsser: { ratio: 5.5 } },
      exciter: { enabled: true, freqHz: 4000, driveDb: 4.5, mix: 0.15 }, // エッジの効いたギラつき(まだ強いとの指摘で6→4.5にさらに緩和、mixも0.18→0.15)
      saturation: { enabled: true, drive: 0.15 }, // 歪み気味のグリット感(同様に0.20→0.15にさらに緩和)
    },
  },
  wide: {
    label: 'ワイド',
    desc: '低域をすっきりさせ、明るさ判定を大胆に緩めて高域を強調。プレゼンスも大幅増強でハキハキした印象に。ステレオ幅も広げて開放的に。',
    patch: {
      highpassCutoffHz: 70,
      brightness: { centroidBrightThresholdHz: 5000, brightEq: { gainDb: -0.5 },
        centroidDarkThresholdHz: 2600, darkEq: { gainDb: 4.5, freqHz: 7000 } },
      blend: { presenceEq: { gainDb: 4.0 }, presenceLowThreshold: 0.22 },
      reverbForDrySource: { dynamicRangeLowThresholdDb: 5, reverb: { mix: 0.24, decay: 0.65, character: 'plate' } },
      exciter: { enabled: true, freqHz: 6000, driveDb: 5, mix: 0.14 }, // 抜け感・空気感
      stereoWidth: { enabled: true, width: 0.55 }, // Vocal自体にもステレオ感を持たせて開放的に
    },
  },
};

// プリセット選択時に、レンダリング前でも「実際何が変わるのか」が分かるように、
// 各プリセットのpatchから読み取れる特徴を短い箇条書きに変換する。
// (以前はmixPresetDescの一文だけだったため、具体的な数値の違いが見えなかった)
const VOCAL_PRESET_MEANING = {
  natural: '声質を大きく作り替えず、解析で必要と判断した処理だけを加えます。迷った場合の基準です。',
  tight: '余分な低域と余韻を整理し、強く潰しすぎず発音を揃えます。ドライでクリーンな密着感が欲しい歌向けです。Rockより歪み・高域強調を抑えます。',
  ballad: '声の温かさと抑揚を残し、長めの余韻で空間を作ります。静かな曲や感情表現を活かしたい歌向けです。',
  rock: 'コンプとPresenceを強め、厚い伴奏の中でも声を前へ出します。強くすると硬さや圧迫感が出やすい設定です。',
  wide: '高域の抜けと広がりを加え、開放的な印象にします。元音が明るい場合は刺さりや薄さが出ることがあります。'
};

const DISTANCE_MEANING = {
  veryClose: '最前面: 声を耳元に近い位置へ。Dry感と密着感を優先し、残響を最小限にします。',
  close: '前: 声を少し前へ。明瞭さを保ちつつ、短い残響で自然な近さにします。',
  natural: '標準: 声の明瞭さと伴奏への馴染みを両立します。迷った場合はここが基準です。',
  far: '奥: 声量を少し控え、残響を増やして伴奏の空間へ馴染ませます。'
};

function formatPresetDetail(presetKey) {
  const preset = MIX_PRESETS[presetKey];
  if (!preset) return [];
  const p = preset.patch || {};
  const lines = [];
  if (p.highpassCutoffHz != null) lines.push(`低域カット: ${p.highpassCutoffHz}Hz(標準は解析結果依存)`);
  if (p.dynamics) {
    const strong = p.dynamics.compressorStrong, light = p.dynamics.compressorLight;
    if (strong) lines.push(`コンプ(強): Ratio ${strong.ratio}:1 / Attack ${strong.attackMs}ms / Release ${strong.releaseMs}ms`);
    else if (light) lines.push(`コンプ(軽): Ratio ${light.ratio}:1 / Attack ${light.attackMs}ms / Release ${light.releaseMs}ms`);
  }
  if (p.reverbForDrySource && p.reverbForDrySource.reverb) {
    const rv = p.reverbForDrySource.reverb;
    lines.push(`リバーブ: Mix ${(rv.mix * 100).toFixed(0)}% / Decay ${rv.decay}s${rv.character ? ' / ' + rv.character : ''}`);
  }
  if (p.shortDelay && p.shortDelay.enabled) lines.push(`ショートディレイ: ${p.shortDelay.timeMs}ms / Mix ${(p.shortDelay.mix * 100).toFixed(0)}%`);
  if (p.saturation && p.saturation.enabled) lines.push(`サチュレーション: Drive ${(p.saturation.drive * 100).toFixed(0)}%${p.saturation.asymmetric ? '(温かみ寄り)' : ''}`);
  if (p.exciter && p.exciter.enabled) lines.push(`エキサイター: ${p.exciter.freqHz}Hz付近 / Mix ${(p.exciter.mix * 100).toFixed(0)}%`);
  if (p.stereoWidth && p.stereoWidth.enabled) lines.push(`ステレオ幅: ${(p.stereoWidth.width * 100).toFixed(0)}%追加`);
  if (lines.length === 0) lines.push('固定の上書き設定なし(すべて解析結果に基づいて自動決定される)');
  return lines;
}

// 距離感コントロール(仕様書11番)。Dry/Wet・Reverb・Pre-delay・EQ・Compression・
// Volumeを連動させる。Vocalパターンとは独立した軸として、どのパターンとも
// 組み合わせられる(getMixRulesForPresetでVocalパターンの後に重ねてマージする)。
const DISTANCE_PRESETS = {
  natural: { label: '標準(自然な位置)', desc: '明瞭さとオケへの馴染みを両立する標準位置。', patch: {} },
  veryClose: {
    label: '最前面(超接近・密着)',
    desc: 'Dry感を強め、残響を極力短くして声を最も近く配置。低域を整理しながら密着感を出す。',
    patch: {
      highpassCutoffHz: 110,
      reverbForDrySource: { dynamicRangeLowThresholdDb: 1.0, reverb: { mix: 0.03, decay: 0.12, predelayMs: 3, character: 'room' } },
      blend: { levelDiffHighThresholdDb: 0, targetVocalToInstDb: -2.0 }, // 近い分、通常(-4.0)より少し大きめが自然
    },
  },
  close: {
    label: '前(近め・明瞭)',
    desc: '声を前に配置。Dry寄りで明瞭さを保ちつつ、短い残響で不自然な張り付きを避ける。',
    patch: {
      highpassCutoffHz: 95,
      reverbForDrySource: { dynamicRangeLowThresholdDb: 2.0, reverb: { mix: 0.08, decay: 0.25, predelayMs: 8, character: 'room' } },
      blend: { levelDiffHighThresholdDb: -1, targetVocalToInstDb: -3.0 },
    },
  },
  far: {
    label: '奥(空間に馴染む)',
    desc: '声を少し後方へ配置。残響・高域・音量を連動させ、オケの空間へ自然に馴染ませる。',
    patch: {
      reverbForDrySource: { dynamicRangeLowThresholdDb: 20, reverb: { mix: 0.42, decay: 1.1, predelayMs: 30, character: 'hall' } },
      brightness: { darkEq: { gainDb: 2.0 }, centroidDarkThresholdHz: 2400 },
      blend: { levelDiffHighThresholdDb: -6, maxGainCutDb: 10, targetVocalToInstDb: -7.0 }, // 遠い分、普段より控えめな音量が「自然」
    },
  },
};

function getMixRulesForPreset(presetKey, distanceKey, airEnhanceOn, sectionBalanceOn, breathControlOn, duckingOn, multibandOn, parallelCompOn, recordingSourceOn, reverbAutoOn, thickenDelayOn, reverbTailGateOn, clipRepairOn) {
  const preset = MIX_PRESETS[presetKey] || MIX_PRESETS.natural;
  let rules = deepMerge(DEFAULT_MIX_RULES, preset.patch);
  const distance = DISTANCE_PRESETS[distanceKey];
  if (distance) rules = deepMerge(rules, distance.patch);
  if (airEnhanceOn) rules = deepMerge(rules, { airEnhance: { enabled: true } });
  if (sectionBalanceOn) rules = deepMerge(rules, { sectionBalance: { enabled: true } });
  if (breathControlOn) rules = deepMerge(rules, { breathControl: { enabled: true } });
  if (duckingOn) rules = deepMerge(rules, { ducking: { enabled: true, forceOn: true } });
  if (multibandOn) rules = deepMerge(rules, { multibandCompression: { enabled: true } });
  if (parallelCompOn) rules = deepMerge(rules, { parallelCompression: { enabled: true } });
  if (reverbAutoOn != null) rules = deepMerge(rules, { reverbAutoEnabled: reverbAutoOn });
  if (thickenDelayOn) rules = deepMerge(rules, { thickenDelay: { enabled: true } });
  if (reverbTailGateOn) rules = deepMerge(rules, { reverbTailGate: { enabled: true } });
  if (clipRepairOn) rules = deepMerge(rules, { clipRepair: { enabled: true } });
  if (recordingSourceOn) {
    // スマホ/イヤホンマイクは自己ノイズ・ハンドリングノイズ・ブレスが
    // 目立ちやすいため、既存の解析駆動ロジックのしきい値を下げて
    // 「同じ判断基準だが、より敏感に反応する」ようにする。
    // ただしクリックの低減については、しきい値を下げると通常の歌声まで
    // 誤検出して波形を削り、かえってノイズを生むことが実測で判明したため
    // 連動対象から外した(「マイク補正にするとノイズが酷い」の直接原因)。
    rules = deepMerge(rules, {
      recordingSource: { enabled: true },
      expander: { dynamicRangeTriggerDb: Math.max(4, rules.expander.dynamicRangeTriggerDb - 4) },
      breathControl: { enabled: true },
    });
  }

  /* --- 重複処理の自動調整 ---
     独立した軸として設計したトグル同士でも、狙う帯域が近いものを同時に
     有効にすると効果が二重にかかって過剰になることがある。ここで実際に
     重なる組み合わせを検出し、片方を控えめにして釣り合いを取る。
     調整した内容はrules._adjustmentsに記録し、UI側で警告として表示する。 */
  const adjustments = [];
  const micOn = !!(rules.recordingSource && rules.recordingSource.enabled);
  const airOn = !!(rules.airEnhance && rules.airEnhance.enabled);

  if (micOn && airOn) {
    // (1) 中低域カットの二重がけ: マイク補正のこもり除去(300Hz)と
    //     透明感の「重さ取り」(350Hz)はほぼ同じ帯域を狙っており、
    //     両方かかると-3.8dB程度まで削られて声が痩せる。
    //     マイク補正側を主とし、透明感側の削りを半分に減らす。
    const before = rules.airEnhance.thinning.gainDb;
    rules = deepMerge(rules, { airEnhance: { thinning: { gainDb: before * 0.5 } } });
    adjustments.push(`中低域カットが重複するため、透明感側の削りを${before.toFixed(1)}dB→${(before * 0.5).toFixed(1)}dBに緩和(声が痩せるのを防止)`);

    // (2) エキサイターの二重がけ: マイク補正(7kHz)と透明感(8kHz)が
    //     近い帯域で倍音を合成するため、高域が過剰にギラつく。
    //     両方の混ぜ量を控えめにして釣り合いを取る。
    const micMixBefore = rules.recordingSource.airRestore.mix;
    const airMixBefore = rules.airEnhance.shimmer.mix;
    rules = deepMerge(rules, {
      recordingSource: { airRestore: { mix: micMixBefore * 0.7 } },
      airEnhance: { shimmer: { mix: airMixBefore * 0.7 } },
    });
    adjustments.push('高域の倍音合成(エキサイター)が重複するため、両方の混ぜ量を30%ずつ控えめに調整');
  }

  // (3) マイク補正 + プリセット自身のエキサイター(ロック/ワイド)の重複。
  //     プリセット側は「そのパターンらしさ」を出す要素なので残し、
  //     後付けであるマイク補正側を控えめにする。
  if (micOn && rules.exciter && rules.exciter.enabled) {
    const before = rules.recordingSource.airRestore.mix;
    rules = deepMerge(rules, { recordingSource: { airRestore: { mix: before * 0.6 } } });
    adjustments.push(`選択中のMIXパターン自体がエキサイターを含むため、マイク補正側の高域合成を控えめに調整(高域の三重がけ防止)`);
  }

  rules._adjustments = adjustments;
  return rules;
}

function diagnoseVocalBlend(analysis, rel, rules) {
  const r = rules || DEFAULT_MIX_RULES;
  const bl = r.blend || DEFAULT_MIX_RULES.blend;
  const levelLow = Math.max(0, Math.min(1, (bl.levelDiffLowThresholdDb - rel.activeLevelDiffDb) / 8));
  const levelHigh = Math.max(0, Math.min(1, (rel.activeLevelDiffDb - bl.levelDiffHighThresholdDb) / 7));
  const masking = Math.max(0, Math.min(1, (rel.maskingRatio2_5k - 0.30) / 0.55));
  const presenceLow = Math.max(0, Math.min(1, (bl.presenceLowThreshold - rel.vocalPresenceRatio1_3k) / 0.10));
  const dynamics = Math.max(0, Math.min(1, (analysis.crestFactorDb - 11) / 11));

  const causes = rel.placement === 'buried' ? [
    ['level', levelLow, '音量不足'], ['masking', masking, '伴奏との帯域競合'],
    ['presence', presenceLow, 'Presence不足'], ['dynamics', dynamics * 0.65, 'ピーク過多']
  ] : rel.placement === 'floating' ? [
    ['level', levelHigh, '音量過多'],
    ['presence', Math.max(0, Math.min(1, (rel.vocalPresenceRatio1_3k - 0.20) / 0.12)) * 0.65, 'Presence過多'],
    ['dynamics', dynamics * 0.35, 'ピーク突出']
  ] : [['balanced', 1, '大きな問題なし']];
  causes.sort((a,b)=>b[1]-a[1]);
  const primary = causes[0];
  return { primaryCause: primary[0], primaryLabel: primary[2], confidence: primary[1],
    levelLow, levelHigh, masking, presenceLow, dynamics };
}

function decideChain(analysis, rel, rules) {
  const r = rules || DEFAULT_MIX_RULES;
  const diagnosis = diagnoseVocalBlend(analysis, rel, r);
  const steps = [];
  // クリップ修復(トグルON時のみ)。録音時点で潰れた波形を扱うため、
  // 他のどの処理よりも先(最上流)に実行する必要がある。
  if (r.clipRepair && r.clipRepair.enabled) {
    steps.push({ name: 'clipRepair', params: r.clipRepair,
      reason: '録音時に波形の頭が潰れた箇所(クリップ)を推定で埋め直し、ガビガビした歪みを軽減(完全復元ではありません)' });
  }
  // 残響ゲート(トグルON時のみ、常に一番最初に実行)。アップロードされた
  // 音源に既に含まれるリバーブの尻尾を、後続の処理(新しいリバーブを
  // かける等)より前に軽減しておく。完全な除去ではなく「軽減」であることに
  // 注意(仕様はapplyReverbTailGate参照)。
  if (r.reverbTailGate && r.reverbTailGate.enabled) {
    steps.push({ name: 'reverbTailGate', params: r.reverbTailGate,
      reason: `アップロード音源に含まれる既存のリバーブの尻尾を軽減(直近ピークから${r.reverbTailGate.thresholdDropDb}dB以上下がった減衰部分のみ、完全除去ではなく軽減)` });
  }
  // DCオフセット除去(常時、プリセットに関わらず必ず適用)。安価なマイク/
  // インターフェースでは波形が0を中心にせず片側に偏る(DCオフセット)ことがある。
  // 通常のhighpass(プリセットにより40Hz〜130Hz超まで様々)がある程度これを
  // 兼ねてしまっていたが、意図した除去ではなかったため、5Hzという聴感上
  // 全く意味を持たない帯域を専用に切ることで、プリセットの設定に関わらず
  // 確実にDCオフセットだけを除去する(音楽的な内容には影響しない)。
  steps.push({ name: 'dcBlock', params: { cutoffHz: 5 }, reason: 'DCオフセット除去(常時、プリセットに関わらず適用)' });
  steps.push({ name: 'highpass', params: { cutoffHz: r.highpassCutoffHz }, reason: '低域不要成分の除去(常時)' });

  // エキスパンダー/クリック低減はサンプル配列への前処理(applyPreProcessingSteps側で実行)。
  // ここではチェーンの表示・判断だけを行う。
  const ex = r.expander;
  if (analysis.dynamicRangeDb > ex.dynamicRangeTriggerDb) {
    steps.push({ name: 'expander', params: { thresholdDb: ex.thresholdDb, ratio: ex.ratio, attackMs: ex.attackMs, releaseMs: ex.releaseMs },
      reason: `ダイナミックレンジが大きく(${analysis.dynamicRangeDb.toFixed(1)}dB)息継ぎ等のノイズフロアが目立ちやすいため軽く整理` });
  }
  if (analysis.sibilanceRatio > r.clickReduction.sibilanceTriggerRatio) {
    steps.push({ name: 'clickReduction', params: {}, reason: `歯擦音が多く(比率${analysis.sibilanceRatio.toFixed(2)})マイクが近くリップノイズも出やすいと推定されるため軽減` });
  }
  if (r.breathControl && r.breathControl.enabled) {
    steps.push({ name: 'breathControl',
      params: { tooLoudDb: r.breathControl.tooLoudDb, reduceTo: r.breathControl.reduceTo },
      reason: `目立って大きいブレスだけを検出し、控えめに軽減(${r.breathControl.tooLoudDb}dBFSを超える区間が対象。通常のブレスはそのまま残す)` });
  }

  const b = r.brightness;
  // v64: 境界付近でEQがON/OFFし過処理になるのを避けるため10%の安全域を置く。
  if (analysis.spectralCentroidHz > b.centroidBrightThresholdHz * 1.10) {
    steps.push({ name: 'peakingEq', params: b.brightEq, reason: `明るさが基準を明確に超過(${analysis.spectralCentroidHz.toFixed(0)}Hz)したため高域を軽減` });
  } else if (analysis.spectralCentroidHz < b.centroidDarkThresholdHz * 0.90) {
    steps.push({ name: 'peakingEq', params: b.darkEq, reason: `暗さが基準を明確に下回る(${analysis.spectralCentroidHz.toFixed(0)}Hz)ため高域を持ち上げ` });
    if (r.exciter.enabled) {
      steps.push({ name: 'exciter', params: r.exciter, reason: '高域の煌びやかさを倍音付加(エキサイター)で追加強調(EQブーストだけより自然な変化)' });
    }
  }

  // 歯擦音対策(deEsser/lowpass)は、後段で高域の倍音を足す処理(マイク補正の
  // エキサイター等)より"後"に配置する必要がある。先に歯擦音を抑えても、
  // その後でエキサイターが同じ帯域に新しい成分を足し直してしまい、
  // 歯擦音が割れる・ノイズが乗る原因になっていた(実際に報告された不具合)。
  // ここではフラグだけ立てておき、実際のステップ追加は高域処理の後で行う。
  const s = r.sibilance;
  const needsDeEsser = analysis.sibilanceRatio > s.ratioThreshold;
  const needsSibilanceLowpass = analysis.sibilanceRatio > r.lowpass.sibilanceHighTriggerRatio;

  // Dynamic EQ(仕様書4番): こもり/濁り/硬さの共鳴帯域が全体的に目立つ曲だけ、
  // その帯域の「瞬間的に強く出た時だけ」抑えるステップを追加する。
  const resonanceBands = [
    { key: 'boxy', ratio: analysis.boxyRatio, label: 'こもり/箱鳴り(200-500Hz)' },
    { key: 'muddy', ratio: analysis.muddyRatio, label: '中域の濁り(500-1000Hz)' },
    { key: 'harsh', ratio: analysis.harshRatio, label: '硬さ/攻撃性(2-4kHz)' },
  ];
  for (const band of resonanceBands) {
    const cfg = r.resonance[band.key];
    if (band.ratio > cfg.triggerRatio) {
      steps.push({ name: 'dynamicEQ',
        params: { freqHz: cfg.freqHz, q: cfg.q, thresholdRatio: cfg.thresholdRatio, maxCutDb: cfg.maxCutDb },
        reason: `${band.label}が目立つ(比率${band.ratio.toFixed(2)})ため、強く出た瞬間だけDynamic EQで抑制` });
    }
  }

  // 録音時の歪み対策(自動判定)。「大きい声ほど超高域が増える」という
  // 歪み特有の傾向を解析で捉え、該当する素材にだけ適用する。
  // スマホ録音に限らず、大きな声で歪んでしまった素材全般に効く。
  const dc = r.distortionControl;
  if (dc && dc.enabled && analysis.distortionRatio != null && analysis.distortionRatio > dc.triggerRatio) {
    steps.push({ name: 'dynamicEQ',
      params: { freqHz: dc.freqHz, q: dc.q, thresholdRatio: dc.thresholdRatio, maxCutDb: dc.maxCutDb },
      reason: `録音時の歪みを検出(大きい区間の超高域が静かな区間の${analysis.distortionRatio.toFixed(1)}倍)。ガビガビ感の原因になるため強く出た瞬間だけ抑制` });
  }

  const d = r.dynamics;
  const useMultiband = r.multibandCompression && r.multibandCompression.enabled;
  const quietInstability = analysis.quietInstability || 0;
  const peakInstability = analysis.peakInstability || 0;
  const crestNeed = Math.max(0, Math.min(1,
    (analysis.crestFactorDb - d.crestMediumThresholdDb) /
    Math.max(4, d.crestHighThresholdDb - d.crestMediumThresholdDb)));

  // v70: 「小さい部分が沈む」と「ピークが暴れる」を同じコンプで処理しない。
  // quiet優勢 → Gain Riding、quiet+peak両方 → Parallel、peak優勢 → downward compression。
  let dynamicsStrategy = 'none';
  if (quietInstability > 0.48 && peakInstability < 0.48 && crestNeed < 0.62) {
    dynamicsStrategy = 'gainRiding';
    const boost = Math.min(3.5, 1.4 + quietInstability * 2.2);
    steps.push({ name: 'gainRider',
      params: { targetDb: -20, gateDb: Math.max(-48, (analysis.noiseFloorDb || -55) + 6), maxBoostDb: boost },
      reason: `小音量部だけが沈んでいるためGain Ridingを選択(沈み${quietInstability.toFixed(2)} / ピーク${peakInstability.toFixed(2)})。大きい声を潰さず小さいフレーズだけ最大${boost.toFixed(1)}dB補助` });
  } else if (quietInstability > 0.52 && (peakInstability > 0.42 || crestNeed > 0.58)) {
    dynamicsStrategy = 'parallel';
    const autoParallel = { thresholdDb: -30, ratio: 7.0, attackMs: 4, releaseMs: 95, mix: Math.min(0.28, 0.14 + quietInstability * 0.12) };
    steps.push({ name: 'parallelCompression', params: autoParallel,
      reason: `小音量部の沈みとピーク変動が共存するためParallel Compressionを自動選択。原音の抑揚を残しながら密度を補う` });
  } else {
    const compNeed = Math.max(peakInstability, crestNeed * 0.9);
    if (compNeed > 0.72) {
      dynamicsStrategy = useMultiband ? 'multibandStrong' : 'compressorStrong';
      if (useMultiband) steps.push({ name: 'multibandCompressor',
        params: { thresholdDb: d.compressorStrong.thresholdDb, ratio: d.compressorStrong.ratio, attackMs: d.compressorStrong.attackMs, releaseMs: d.compressorStrong.releaseMs, lowFreqHz: r.multibandCompression.lowFreqHz, highFreqHz: r.multibandCompression.highFreqHz },
        reason: `ピーク側の変動が主因(必要度${compNeed.toFixed(2)})。マルチバンド圧縮でピークを整理` });
      else steps.push({ name: 'compressor', params: d.compressorStrong,
        reason: `ピーク側の変動が主因(必要度${compNeed.toFixed(2)} / ピーク${peakInstability.toFixed(2)})。通常コンプで突出を整理` });
    } else if (compNeed > 0.34) {
      dynamicsStrategy = useMultiband ? 'multibandLight' : 'compressorLight';
      if (useMultiband) steps.push({ name: 'multibandCompressor',
        params: { thresholdDb: d.compressorLight.thresholdDb, ratio: d.compressorLight.ratio, attackMs: d.compressorLight.attackMs, releaseMs: d.compressorLight.releaseMs, lowFreqHz: r.multibandCompression.lowFreqHz, highFreqHz: r.multibandCompression.highFreqHz },
        reason: `軽いピーク制御が必要(必要度${compNeed.toFixed(2)})。マルチバンドで自然に整理` });
      else steps.push({ name: 'compressor', params: d.compressorLight,
        reason: `軽いピーク制御が必要(必要度${compNeed.toFixed(2)} / ピーク${peakInstability.toFixed(2)})` });
    }
  }
  analysis.dynamicsStrategy = dynamicsStrategy;

  // ユーザーが明示的にParallel CompをONにした場合のみ追加。ただし自動選択済みなら二重掛けしない。
  if (r.parallelCompression && r.parallelCompression.enabled && dynamicsStrategy !== 'parallel') {
    steps.push({ name: 'parallelCompression', params: r.parallelCompression,
      reason: '手動設定: 原音とは別に強く圧縮した信号をブレンドし、密度感・パンチを追加' });
  }

  const bl = r.blend;
  // v67: 音量補正は全曲RMSではなく発声中RMSを基準にする。さらに複合判定が
  // balancedなら境界付近の素材を無理に動かさず、過補正を避ける。
  // v68: 「埋もれた=音量を上げる」ではなく原因を分類。
  // 帯域競合が主因なら先にEQ/duckingへ任せ、単純なゲイン上げによる過大Vocalを防ぐ。
  if (rel.placement === 'buried' && rel.activeLevelDiffDb < bl.levelDiffLowThresholdDb &&
      (diagnosis.primaryCause === 'level' || diagnosis.levelLow > 0.55)) {
    const boost = Math.min(bl.levelDiffLowThresholdDb - rel.activeLevelDiffDb, bl.maxGainBoostDb);
    steps.push({ name: 'gain', params: { gainDb: boost }, reason: `埋もれの主因を${diagnosis.primaryLabel}と判定。発声中Level差${rel.activeLevelDiffDb.toFixed(1)}dBを補正` });
  } else if (rel.placement === 'floating' && rel.activeLevelDiffDb > bl.levelDiffHighThresholdDb &&
             (diagnosis.primaryCause === 'level' || diagnosis.levelHigh > 0.55)) {
    const cut = Math.min(rel.activeLevelDiffDb - bl.levelDiffHighThresholdDb, bl.maxGainCutDb);
    steps.push({ name: 'gain', params: { gainDb: -cut }, reason: `浮きの主因を${diagnosis.primaryLabel}と判定。発声中Level差${rel.activeLevelDiffDb.toFixed(1)}dBを下げて馴染ませる` });
  }
  if (rel.maskingRatio2_5k > bl.maskingRatioThreshold) {
    steps.push({ name: 'peakingEq', params: bl.maskingEq, reason: `伴奏との帯域競合を検出。${diagnosis.primaryCause === 'masking' ? '埋もれの主因と判定。' : ''}総合${rel.maskingRatio2_5k.toFixed(2)}, SNR ${rel.maskingSnrDb1_4k.toFixed(1)}dB, 重なり${rel.spectralOverlap1_4k.toFixed(2)}` });
    if (r.ducking.enabled) {
      steps.push({ name: 'ducking', params: { amount: r.ducking.amount },
        reason: 'マスキングが疑われるため、EQだけでなく伴奏をボーカルの音量に連動して動的にダッキング(サイドチェイン風)' });
    }
  } else if (r.ducking.enabled && r.ducking.forceOn) {
    // マスキングが検出されなくても、Uploadタブのトグルで明示的にONにした場合は
    // 常にダッキングを効かせる(「MIXにダッキングも追加」という明示的な意図への対応)。
    steps.push({ name: 'ducking', params: { amount: r.ducking.amount },
      reason: '手動でダッキングを有効化(マスキング未検出でも、ボーカルの音量に連動して伴奏を常時ダッキング)' });
  }
  if (rel.vocalPresenceRatio1_3k < bl.presenceLowThreshold && (rel.placement === 'buried' || rel.maskingRatio2_5k > bl.maskingRatioThreshold)) {
    steps.push({ name: 'peakingEq', params: bl.presenceEq, reason: `1-3kHz帯の存在感が不足(比率${rel.vocalPresenceRatio1_3k.toFixed(2)}, 埋もれ傾向)` });
  }

  const rv = r.reverbForDrySource;
  if (r.reverbAutoEnabled) {
    if (r.shortDelay.enabled && analysis.dynamicRangeDb < r.shortDelay.dynamicRangeLowThresholdDb) {
      steps.push({ name: 'shortDelay', params: r.shortDelay,
        reason: `ドライすぎる(DR ${analysis.dynamicRangeDb.toFixed(1)}dB)ため短いスラップディレイで奥行きを出す(このパターンではリバーブより自然な質感を優先)` });
    } else if (analysis.dynamicRangeDb < rv.dynamicRangeLowThresholdDb) {
      steps.push({ name: 'reverb', params: rv.reverb, reason: `ドライすぎる(DR ${analysis.dynamicRangeDb.toFixed(1)}dB)ため短いリバーブで馴染ませる(Room+Plate並列送り+濁り除去EQ)` });
    }
  }

  // 「透明感」トグル(主に女性ボーカル向け)。有効な場合、MIXパターン/距離感の
  // 判断結果とは別に、常に同じ3ステップを追加する(解析結果に応じた分岐はしない。
  // 「透明感を足したい」という明示的な意図に対する加算的な処理のため)。
  if (r.airEnhance && r.airEnhance.enabled) {
    const ae = r.airEnhance;
    steps.push({ name: 'peakingEq', params: ae.thinning,
      reason: '透明感: 中低域を軽く削って重さを取り、相対的に高域が抜けて聴こえるようにする' });
    steps.push({ name: 'peakingEq', params: ae.airShelf,
      reason: '透明感: 超高域(息の倍音・煌めきが乗る帯域)を持ち上げてエアー感を出す' });
    steps.push({ name: 'exciter', params: ae.shimmer,
      reason: '透明感: 8kHz付近に控えめな倍音を加えて煌びやかさを補強(EQブーストだけより自然)' });
  }
  if (r.sectionBalance && r.sectionBalance.enabled) {
    // 実際のゲイン適用は伴奏のエネルギーが要るためcombineWithInstrumental側で行う。
    // ここではそのことが分かるようにフラグとして積んでおく(表示・状態管理用)。
    steps.push({ name: 'sectionBalance', params: r.sectionBalance,
      reason: `伴奏が密な区間(サビらしい箇所)でボーカルを+${r.sectionBalance.boostDb}dB、` +
        `薄い区間(Aメロらしい箇所)で${r.sectionBalance.cutDb}dB自動調整(曲構造の自動検出ではなくエネルギー量からの近似)` });
  }
  if (r.recordingSource && r.recordingSource.enabled) {
    const rs = r.recordingSource;
    steps.push({ name: 'peakingEq', params: rs.muddyCarve,
      reason: 'イヤホン/スマホマイク補正: 口元に近い小型マイクで膨らみがちな中低域(こもり)を削って明瞭に' });
    steps.push({ name: 'peakingEq', params: rs.harshCarve,
      reason: 'イヤホン/スマホマイク補正: 小型カプセル特有の共振による硬さ・キンつきを狭く狙って抑制(子音の帯域は削りすぎない)' });
    steps.push({ name: 'peakingEq', params: rs.presenceLift,
      reason: 'イヤホン/スマホマイク補正: 声の芯・輪郭が出る帯域を持ち上げて前に出す' });
    // 歪み由来の高域抑制は、マイク補正トグルとは独立した自動判定
    // (distortionControl)に一本化した。マイク補正をONにしなくても、
    // 解析で歪みが検出されれば常に適用される。
    steps.push({ name: 'sibilanceAwareExciter', params: rs.airRestore,
      reason: 'イヤホン/スマホマイク補正: 小型マイクでは物理的に収音できない超高域の空気感を倍音から合成して復元(サ行の瞬間は自動で効果を弱め、歯擦音にノイズが乗るのを防ぐ)' });
  }
  if (r.thickenDelay && r.thickenDelay.enabled) {
    steps.push({ name: 'thickenDelay', params: r.thickenDelay,
      reason: `聞こえない程度の極短ディレイ(L ${r.thickenDelay.timeLMs}ms / R ${r.thickenDelay.timeRMs}ms)で厚み・立体感を追加` });
  }

  // 歯擦音対策をここで実行する。透明感・マイク補正・プリセット自身の
  // エキサイター等、高域に倍音を足す処理をすべて通した"後"に置くことで、
  // 「せっかく抑えた歯擦音に後から成分を足し直して割れる」という
  // 順序の問題を防ぐ。
  if (needsDeEsser) {
    steps.push({ name: 'deEsser', params: s.deEsser,
      reason: `歯擦音成分比率が高い(${analysis.sibilanceRatio.toFixed(2)})。高域を足す処理の後に配置し、足し直しによる割れを防止` });
  }
  if (needsSibilanceLowpass) {
    steps.push({ name: 'lowpass', params: { cutoffHz: r.lowpass.cutoffHz },
      reason: `歯擦音が非常に強い(${analysis.sibilanceRatio.toFixed(2)})ためデエッサーに加え高域を軽くローパスで抑制` });
  }

  if (r.saturation.enabled) {
    steps.push({ name: 'saturation', params: r.saturation, reason: 'このMIXパターンの質感としてサチュレーション(倍音)を軽く付加' });
  }
  if (r.stereoWidth.enabled) {
    steps.push({ name: 'stereoWiden', params: { width: r.stereoWidth.width }, reason: 'このMIXパターンではステレオ感を広げて開放的な印象にする' });
  }

  steps.push({ name: 'limiter', params: { ceilingDb: r.limiterCeilingDb }, reason: 'クリッピング防止(常時)' });
  // v71: 個別の安全上限だけでなく、複数処理が同時に積み重なった時の総量も監視する。
  // 例: dark判定のEQ + 透明感EQ + マイク補正Presence + Exciter が同時に走るケース。
  const safeSteps = applySafetyCaps(steps);
  return optimizeProcessingBudget(safeSteps, analysis, rel);
}

// 処理量の安全上限。「処理した方が数値上は良くなる場合でも、聴感上不自然になる
// なら処理量を減らす」という考え方(仕様書15番)に基づき、どんな解析結果・
// プリセットの組み合わせでも、各処理が一定量を超えないようここで一律に制限する。
// プリセットのpatchで大胆な値を設定しても、最終的にはここを通る。
const SAFETY_CAPS = {
  eqGainDb: 6.0,           // peakingEq/exciterのゲイン上限(絶対値)
  compressorRatio: 8.0,    // コンプ/デエッサーの最大レシオ
  reverbMix: 0.4,            // リバーブ/ショートディレイのmix上限(Room+Plateの並列送りに変更した際、やりすぎ防止のため0.5→0.4に引き締め)
  saturationDrive: 0.35,    // サチュレーション/エキサイターのdrive上限
  stereoWidth: 1.15,        // ステレオ幅。対称設計への変更に伴い上限を少し引き上げた
  gainDb: 8.0,              // 音量差補正(gainステップ)の上限(絶対値)
  duckingAmount: 0.5,       // ダッキング量の上限
  breathReduceMin: 0.25,    // ブレス軽減の下限(完全消去を防ぐ。これ以下には下げない)
  reverbTailGateReduceMin: 0.15, // 残響ゲートの軽減下限(完全消去は不自然になるため、これ以下には下げない)
  transientBoostDb: 8.0,    // トランジェント強調の上限
  parallelCompMix: 0.5,     // パラレルコンプレッションのブレンド量上限(強圧縮側に寄せすぎない)
  thickenDelayMs: 28,       // マイクロディレイの時間上限(Haas効果の知覚しきい値を大きく下回り「聞こえない程度」を保証するため)
  thickenDelayMix: 0.3,     // マイクロディレイのブレンド量上限
};
function applySafetyCaps(steps) {
  // v71: paramsはプリセット設定への参照を含むため、そのまま変更すると一度のレンダーで
  // 元プリセットまで書き換わり、次回レンダー結果が変化する。必ずコピーしてから制限する。
  const out = steps.map(step => ({ ...step, params: step.params ? { ...step.params } : step.params }));
  const clamp = (v, max) => Math.max(-max, Math.min(max, v));
  const clampPos = (v, max) => Math.max(0, Math.min(max, v));
  for (const step of out) {
    const p = step.params;
    if (!p) continue;
    if (step.name === 'peakingEq' && typeof p.gainDb === 'number') p.gainDb = clamp(p.gainDb, SAFETY_CAPS.eqGainDb);
    if ((step.name === 'compressor' || step.name === 'deEsser' || step.name === 'multibandCompressor' || step.name === 'parallelCompression') && typeof p.ratio === 'number') p.ratio = Math.min(p.ratio, SAFETY_CAPS.compressorRatio);
    if ((step.name === 'reverb' || step.name === 'shortDelay') && typeof p.mix === 'number') p.mix = clampPos(p.mix, SAFETY_CAPS.reverbMix);
    if (step.name === 'saturation' && typeof p.drive === 'number') p.drive = clampPos(p.drive, SAFETY_CAPS.saturationDrive);
    if (step.name === 'exciter' && typeof p.mix === 'number') p.mix = clampPos(p.mix, SAFETY_CAPS.reverbMix);
    if (step.name === 'stereoWiden' && typeof p.width === 'number') p.width = clampPos(p.width, SAFETY_CAPS.stereoWidth);
    if (step.name === 'stereoWiden' && p.doublerBehind) {
      // ダブラー(斜め後ろ)層も、通常の短いディレイと同じ上限を流用して
      // 「聞こえすぎる」ほど長い・大きいディレイにならないよう制限する。
      if (typeof p.doublerBehind.timeLMs === 'number') p.doublerBehind.timeLMs = Math.min(p.doublerBehind.timeLMs, 120);
      if (typeof p.doublerBehind.timeRMs === 'number') p.doublerBehind.timeRMs = Math.min(p.doublerBehind.timeRMs, 120);
      if (typeof p.doublerBehind.mix === 'number') p.doublerBehind.mix = clampPos(p.doublerBehind.mix, SAFETY_CAPS.thickenDelayMix);
    }
    if (step.name === 'gain' && typeof p.gainDb === 'number') p.gainDb = clamp(p.gainDb, SAFETY_CAPS.gainDb);
    if (step.name === 'ducking' && typeof p.amount === 'number') p.amount = clampPos(p.amount, SAFETY_CAPS.duckingAmount);
    if (step.name === 'breathControl' && typeof p.reduceTo === 'number') p.reduceTo = Math.max(p.reduceTo, SAFETY_CAPS.breathReduceMin);
    if (step.name === 'reverbTailGate' && typeof p.reduceTo === 'number') p.reduceTo = Math.max(p.reduceTo, SAFETY_CAPS.reverbTailGateReduceMin);
    if (step.name === 'transientBoost' && typeof p.boostDb === 'number') p.boostDb = clampPos(p.boostDb, SAFETY_CAPS.transientBoostDb);
    if (step.name === 'parallelCompression' && typeof p.mix === 'number') p.mix = clampPos(p.mix, SAFETY_CAPS.parallelCompMix);
    if (step.name === 'thickenDelay') {
      if (typeof p.timeLMs === 'number') p.timeLMs = clampPos(p.timeLMs, SAFETY_CAPS.thickenDelayMs);
      if (typeof p.timeRMs === 'number') p.timeRMs = clampPos(p.timeRMs, SAFETY_CAPS.thickenDelayMs);
      if (typeof p.mix === 'number') p.mix = clampPos(p.mix, SAFETY_CAPS.thickenDelayMix);
    }
  }
  return out;
}

// v71 統合過処理防止レイヤー。
// 個々の処理が安全値でも、EQブースト×複数 + Exciter + Comp + 空間系のように
// 合計すると「明るすぎる/潰れすぎる/遠すぎる」ことがあるため、チェーン全体で再評価する。
function optimizeProcessingBudget(steps, analysis, rel) {
  const out = steps.map(step => ({ ...step, params: step.params ? { ...step.params } : step.params }));
  const notes = [];

  // 1) Tonal budget: 正のEQブースト総量を監視。カットは問題帯域除去なので別扱い。
  const boostEqs = out.filter(s => s.name === 'peakingEq' && (s.params?.gainDb || 0) > 0);
  const totalBoost = boostEqs.reduce((a,s)=>a+s.params.gainDb,0);
  const harshOrSibilant = (analysis.sibilanceRatio || 0) > 0.16 || (analysis.harshRatio || 0) > 0.20;
  const boostBudget = harshOrSibilant ? 6.0 : 8.5;
  if (totalBoost > boostBudget && boostEqs.length > 1) {
    const scale = Math.max(0.55, boostBudget / totalBoost);
    boostEqs.forEach(s => { s.params.gainDb *= scale; s.reason += ` / 過処理防止: EQブースト総量を${Math.round(scale*100)}%へ調整`; });
    notes.push(`EQ boost ${totalBoost.toFixed(1)}→${boostBudget.toFixed(1)}dB相当`);
  }

  // 2) Air budget: 歯擦音/harshがある素材ではExciterの重複を弱める。
  const exciters = out.filter(s => s.name === 'exciter' || s.name === 'sibilanceAwareExciter');
  if (harshOrSibilant && exciters.length > 1) {
    exciters.slice(1).forEach(s => {
      if (typeof s.params.mix === 'number') s.params.mix *= 0.65;
      if (typeof s.params.drive === 'number') s.params.drive *= 0.65;
      s.reason += ' / 過処理防止: 高域処理の重複を抑制';
    });
    notes.push('高域倍音の重複を抑制');
  }

  // 3) Dynamics budget: Gain Riding/Parallel/通常Compの自動処理が複数重ならないよう保証。
  const dynNames = new Set(['gainRider','parallelCompression','compressor','multibandCompressor']);
  const dyn = out.filter(s => dynNames.has(s.name));
  if (dyn.length > 1) {
    // 手動Parallelが追加される場合などは、後段側を控えめにする。
    dyn.slice(1).forEach(s => {
      if (typeof s.params.ratio === 'number') s.params.ratio = Math.min(s.params.ratio, 4.0);
      if (typeof s.params.mix === 'number') s.params.mix = Math.min(s.params.mix, 0.22);
      s.reason += ' / 過処理防止: Dynamics重複のため強度を制限';
    });
    notes.push(`Dynamics ${dyn.length}段の重複を制限`);
  }

  // 4) Space budget: Reverb/Delay/Thickenerが重なる時はWet総量を抑える。
  const spaces = out.filter(s => ['reverb','shortDelay','thickenDelay'].includes(s.name));
  const wetSum = spaces.reduce((a,s)=>a+(typeof s.params?.mix==='number'?s.params.mix:0),0);
  if (wetSum > 0.48 && spaces.length > 1) {
    const scale = 0.48 / wetSum;
    spaces.forEach(s => { if (typeof s.params.mix === 'number') s.params.mix *= scale; s.reason += ' / 過処理防止: 空間系Wet総量を調整'; });
    notes.push(`空間系Wet ${wetSum.toFixed(2)}→0.48`);
  }

  // 5) 埋もれ対策が既にEQ+Duckingで成立している場合、追加Presence boostを少し抑える。
  const hasDuck = out.some(s=>s.name==='ducking');
  if (hasDuck && rel && rel.maskingRatio2_5k > 0.45) {
    const presenceBoosts = out.filter(s=>s.name==='peakingEq' && (s.params?.freqHz||0)>=1200 && (s.params?.freqHz||0)<=4000 && (s.params?.gainDb||0)>0);
    if (presenceBoosts.length > 1) {
      presenceBoosts.slice(1).forEach(s=>{ s.params.gainDb *= 0.75; s.reason += ' / 過処理防止: Ducking併用のためPresence追加量を抑制'; });
      notes.push('Masking対策の重複を抑制');
    }
  }

  analysis.processingBudget = {
    adjusted: notes.length > 0,
    notes,
    tonalBoostDb: boostEqs.reduce((a,s)=>a+(s.params?.gainDb||0),0),
    dynamicsStages: dyn.length,
    spaceWet: spaces.reduce((a,s)=>a+(typeof s.params?.mix==='number'?s.params.mix:0),0)
  };
  return out;
}
