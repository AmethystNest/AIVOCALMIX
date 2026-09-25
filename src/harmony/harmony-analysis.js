// Harmony stem: rules and presets, preset resolution from analysis, timing
// and phrase-timing analysis/correction, relationship analysis and
// decideHarmonyChain. No DOM or app state. Moved verbatim from the main app
// script in index.html; loaded before it. Uses spectrum-core.js,
// mix-decision.js (deepMerge, SAFETY_CAPS, applySafetyCaps) and
// yieldToBrowser at call time.
const DEFAULT_HARMONY_RULES = {
  // D400: Harmony基準レベルを前へ。最終レベルは自動MIXで決め、プリセットは主に質感/距離感を担当。
  level: { defaultOffsetDb: -2.5, minOffsetDb: -1.0, maxOffsetDb: -7.0 },
  lowCleanup: { highpassCutoffHz: 180 },
  highTame: { freqHz: 9000, gainDb: -2.0, q: 0.8 },
  // Mainの明瞭度帯域(1-3kHz、歌詞の聞き取りやすさに直結)を、ハモリは常に
  // 控えめに削っておく。以前はMainを喰っている時だけ高域(9kHz)を強めに
  // 抑える対症療法だったが、常時ここを譲る方が「Mainを邪魔しない」という
  // 目的に対してより直接的。
  presenceCarve: { freqHz: 2200, gainDb: -2.5, q: 1.3 },
  // Mainより強め・速めのコンプで音量ムラを均す(2段シリアル、Main側と同じ設計)。
  // ハモリは主旋律ではなく「支え」の役割のため、アタック感を残すことより
  // 均一に潰して常に一定の存在感を保つことを優先する方針に変更。
  // (以前アタックタイムを緩めてトランジェント強調も追加していたが、
  // 「やはりアタック感を出す設定は除外し、強いコンプで均一に」という
  // 方針転換により、アタックタイムを再び速めレシオも上げた)
  compressor: { thresholdDb: -24, ratio: 7.0, attackMs: 4, releaseMs: 80 },
  reverb: { mix: 0.35, decay: 0.6, predelayMs: 25, character: 'hall' },
  stereoWidth: { default: 0.65 },
  maskingCheck: { warnIfHarmonyPresenceExceedsMainRatio: 0.9 },
  // v72: Harmonyを単体の音色だけでなくMainとの「同時発声中の関係」で判断する。
  // overlapが高いほど同じ帯域を奪い合うためPresence carve/widthを増やし、
  // 逆にHarmonyが薄すぎる場合は目標レベルを少し前へ出して密着感を保つ。
  adaptiveBlend: {
    enabled: true,
    overlapWarn: 0.68,
    overlapHigh: 0.80,
    presenceWarn: 0.92,
    maxExtraCarveDb: 1.8,
    maxTargetLiftDb: 1.2,
    maxTargetCutDb: 1.5,
    maxWidthAdd: 0.18,
  },
  // 超高域(11kHz付近)を軽く持ち上げて煌めきを足す。presenceCarveが既に
  // Mainの明瞭度帯域(1-3kHz)を守っているため、このEQはそれより十分高い
  // 帯域を狙うことでMainと衝突しない設計。デフォルトは無効、Surroundプリセット等で有効化する。
  airBoost: { enabled: false, freqHz: 11000, gainDb: 2.5, q: 0.8 },
  // ダブラー効果で「左右+斜め後ろ」に広がる空間表現。単純な左右の時間差
  // (renderHarmonyStereoWidenの対称allpass)に加えて、もう少し長めで
  // 拡散的な(斜め後ろ・遠方から聞こえるような)追加のディレイ層を薄く重ねる。
  // デフォルトは無効、Surroundプリセット等で有効化する。
  doublerBehind: { enabled: false, timeLMs: 55, timeRMs: 70, mix: 0.16 },
};

// ハモリの「馴染ませ方」パターン。MIXパターンと違いジャンル差ではなく、
// Mainとの距離感(タイトに寄り添う ⇔ 広く包み込んで後方に置く)のバリエーション。
const HARMONY_PRESETS = {
  auto: {
    label: '自動',
    desc: 'Main/Harmonyの実測音量差・1–4kHz重なり・Presence比・タイミング関係から、ハモリ専用4パターンのうち安全なものを自動選択します。解析が不十分な場合はナチュラルへ戻します。',
    patch: {}
  },
  natural: { label: 'ナチュラル', desc: '標準の馴染ませ方。Mainより控えめに、適度な距離感で。', patch: {} },
  tight: {
    label: 'タイト',
    desc: 'Mainへ密着する輪郭と近さを優先。最終音量は自動MIXで合わせ、リバーブ/ステレオ幅は控えめ。',
    patch: {
      level: { defaultOffsetDb: -1.5 },
      compressor: { ratio: 3.0, attackMs: 4, releaseMs: 70 },
      reverb: { mix: 0.15, decay: 0.35, predelayMs: 12, character: 'room' },
      stereoWidth: { default: 0.35 },
    },
  },
  enveloping: {
    label: 'サラウンド',
    desc: 'Mainを引き立てつつ包み込むように。広いステレオ幅と多めのリバーブ、控えめな高域の煌めきで。',
    patch: {
      level: { defaultOffsetDb: -2.5 }, // D401: Surroundのみ+0.5dB。広がりは維持
      compressor: { ratio: 5.5, attackMs: 8, releaseMs: 140 },
      reverb: { mix: 0.55, decay: 1.1, predelayMs: 40, character: 'hall' },
      stereoWidth: { default: 1.15 }, // 左右対称の位相分散設計に変更し、より包み込む質感に(要望に合わせさらに拡張)
      highTame: { gainDb: -1.0 }, // 高域ブーストを別途足すため、taming自体は控えめに
      airBoost: { enabled: true }, // Mainの帯域と被らない超高域だけ軽く持ち上げて煌めきを出す
      doublerBehind: { enabled: true }, // 左右+斜め後ろに広がる空間表現(仕様は下記doublerBehind参照)
    },
  },
  backing: {
    label: 'バックサポート',
    desc: 'Mainの後ろで安定して支えるハモリ専用。Presenceを譲り、強めのコンプと中程度の残響で存在感より厚みを優先。最終音量は自動MIXで不足しない位置へ合わせる。',
    patch: {
      level: { defaultOffsetDb: -3.5, minOffsetDb: -2.0, maxOffsetDb: -7.5 },
      compressor: { thresholdDb: -26, ratio: 8.0, attackMs: 3, releaseMs: 105 },
      reverb: { mix: 0.42, decay: 0.75, predelayMs: 30, character: 'hall' },
      stereoWidth: { default: 0.55 },
      highTame: { gainDb: -3.0 },
      presenceCarve: { gainDb: -3.5 },
    },
  },
};

// D399: Harmony専用Auto。
// 新しいDSPは追加せず、既存4プリセットのどれを使うかだけを既存解析値から保守的に選ぶ。
// 解析不足・境界値ではNaturalへ戻し、Auto選択だけで過処理になりにくい設計。
function resolveHarmonyPresetFromAnalysis(harmonyAnalysis, relation) {
  if (!harmonyAnalysis || !relation || !Number.isFinite(relation.activeLevelDiffDb) ||
      !Number.isFinite(relation.spectralOverlap1_4k) || !Number.isFinite(relation.presenceRatio) ||
      (relation.activeFrames || 0) < 6) {
    return { key: 'natural', reason: '解析データが十分でないため安全側のNatural' };
  }

  const levelDiff = relation.activeLevelDiffDb;
  const overlap = Math.max(0, Math.min(1, relation.spectralOverlap1_4k));
  const presence = Math.max(0, relation.presenceRatio);
  const timing = relation.timing || {};
  const timingOffset = Number.isFinite(timing.offsetMs) ? Math.abs(timing.offsetMs) : 999;
  const timingConfidence = Number.isFinite(timing.confidence) ? timing.confidence : 0;

  // Mainの明瞭度帯域を強く奪う、またはHarmony自体がかなり前にいる場合は
  // Back SupportでPresenceと音量を譲る。
  const competition = Math.max(
    Math.max(0, (overlap - 0.68) / 0.22),
    Math.max(0, (presence - 1.05) / 0.45),
    Math.max(0, (levelDiff + 1.5) / 3.0)
  );
  if (competition >= 0.72) {
    return {
      key: 'backing',
      reason: `Mainとの競合が強い（重なり${overlap.toFixed(2)} / Presence比${presence.toFixed(2)} / 発声時差${levelDiff.toFixed(1)}dB）`
    };
  }

  // 発声タイミングが十分近く、帯域重なりも中程度以上なら、
  // HarmonyをぼかさずMainへ密着させるTight。
  if (timingConfidence >= 0.46 && timingOffset <= 28 && overlap >= 0.48 &&
      presence >= 0.55 && presence <= 1.05 && levelDiff >= -7.5) {
    return {
      key: 'tight',
      reason: `Mainと発声が近く密着向き（Timing ${timingOffset.toFixed(0)}ms / 重なり${overlap.toFixed(2)}）`
    };
  }

  // Harmonyが既に控えめでMainのPresenceを奪っていない場合だけ、
  // 後方へ広げるSurroundを許可。競合がある素材には選ばない。
  if (levelDiff <= -4.5 && presence <= 0.78 && overlap <= 0.72) {
    return {
      key: 'enveloping',
      reason: `Harmonyが控えめで後方配置に余裕あり（発声時差${levelDiff.toFixed(1)}dB / Presence比${presence.toFixed(2)}）`
    };
  }

  return {
    key: 'natural',
    reason: `極端な競合・距離条件がないためNatural（重なり${overlap.toFixed(2)} / Presence比${presence.toFixed(2)}）`
  };
}

function getHarmonyRulesForPreset(presetKey) {
  const preset = HARMONY_PRESETS[presetKey] || HARMONY_PRESETS.natural;
  return deepMerge(DEFAULT_HARMONY_RULES, preset.patch);
}

// v73: Main/Harmonyの「一定のタイミングずれ」を発声エンベロープで検出する。
// ピッチが異なるハモリ同士でも比較できるよう、生波形ではなく短時間RMSの変化量を使う。
// ここでは音質劣化のない単純シフトだけを行い、フレーズごとの伸縮(タイムストレッチ)は行わない。
async function analyzeHarmonyTiming(mainSamples, harmonySamples, sr, onProgress) {
  const hop = Math.max(64, Math.round(sr * 0.020)); // D53: 全長で20ms hopに統一
  const win = Math.max(hop * 2, Math.round(sr * 0.040)); // 40ms
  const n = Math.min(mainSamples.length, harmonySamples.length);
  const mEnv=[], hEnv=[];
  const envTotal=Math.max(1,Math.floor((n-win)/hop)+1);
  let envIdx=0;
  for (let i=0; i+win<n; i+=hop) {
    mEnv.push(Math.log10(rmsOf(mainSamples,i,win)+1e-7));
    hEnv.push(Math.log10(rmsOf(harmonySamples,i,win)+1e-7));
    envIdx++;
    if(envIdx%140===0){
      if(onProgress) onProgress(0.65*(envIdx/envTotal));
      await yieldToBrowser();
    }
  }
  if (mEnv.length < 20) return { offsetMs:0, confidence:0, apply:false, maxLagMs:120 };
  // 発声の立ち上がり/語尾を強調。ゆっくりした音量差は無視する。
  const diff = a => a.slice(1).map((v,i)=>Math.max(-0.35,Math.min(0.35,v-a[i])));
  const m=diff(mEnv), h=diff(hEnv);
  const maxLag=Math.max(1,Math.round(0.120*sr/hop));
  let bestLag=0,best=-Infinity, second=-Infinity;
  let lagCounter=0;
  for(let lag=-maxLag;lag<=maxLag;lag++){
    let sum=0,mm=0,hh=0,count=0;
    const start=Math.max(0,-lag), end=Math.min(m.length,h.length-lag);
    for(let i=start;i<end;i++){
      const a=m[i], b=h[i+lag];
      // 無音付近の微小変化ばかりで相関しないよう、動きがある箇所を優先。
      if(Math.abs(a)+Math.abs(b)<0.018) continue;
      sum+=a*b; mm+=a*a; hh+=b*b; count++;
    }
    const score=count>8 ? sum/Math.sqrt(Math.max(1e-12,mm*hh)) : -1;
    if(score>best){ second=best; best=score; bestLag=lag; }
    else if(score>second && Math.abs(lag-bestLag)>1) second=score;
    lagCounter++;
    if(lagCounter%4===0){
      if(onProgress) onProgress(0.65 + 0.35*(lagCounter/Math.max(1,2*maxLag+1)));
      await yieldToBrowser();
    }
  }
  if(onProgress) onProgress(1);
  // bestLag>0 = HarmonyのイベントがMainより後ろにある → Harmonyを前へ移動する必要がある。
  const detectedMs=bestLag*hop/sr*1000;
  const margin=Math.max(0,best-Math.max(-1,second));
  const confidence=Math.max(0,Math.min(1,(best-0.12)/0.45))*Math.max(0.25,Math.min(1,margin/0.08));
  const apply=Math.abs(detectedMs)>=8 && Math.abs(detectedMs)<=120 && best>=0.28 && confidence>=0.32;
  return { offsetMs:detectedMs, correctionMs:apply ? -detectedMs : 0, confidence, correlation:best, apply, maxLagMs:120 };
}

function shiftSamplesNoStretch(samples, shiftMs, sr) {
  const shift=Math.round(shiftMs*sr/1000); // + = 遅らせる / - = 前へ
  if(!shift) return samples;
  const out=new Float32Array(samples.length);
  if(shift>0) out.set(samples.subarray(0,Math.max(0,samples.length-shift)),shift);
  else { const k=-shift; if(k<samples.length) out.set(samples.subarray(k),0); }
  return out;
}


// v75: Main/Harmony両方の発声と音量の谷を使ってフレーズ境界を細分化する。
// 完全な無音だけでなく、長い歌唱区間内のブレス/語句間の谷も解析境界にする。
// 谷が浅い境界は「解析のみ」とし、実際の移動は十分な余白がある区間だけに限定する。

// D53: フレーズ局所タイミング用の軽量相関。
// 既に作った10/20msエンベロープの差分だけで相関を取り、
// 各フレーズごとに生波形からRMS窓を再生成する処理を廃止する。
function analyzeEnvelopeTimingLimited(mainDiff, harmDiff, startFrame, endFrame, hop, sr, maxLagMs) {
  const maxLag = Math.max(1, Math.round((maxLagMs / 1000) * sr / hop));
  const pad = Math.max(maxLag + 3, Math.round(0.13 * sr / hop));
  const s = Math.max(0, startFrame - pad);
  const e = Math.min(mainDiff.length, endFrame + pad);

  let bestLag = 0, best = -Infinity, second = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0, mm = 0, hh = 0, count = 0;
    const lo = Math.max(s, -lag);
    const hi = Math.min(e, harmDiff.length - lag);
    for (let i = lo; i < hi; i++) {
      const a = mainDiff[i], b = harmDiff[i + lag];
      if (Math.abs(a) + Math.abs(b) < 0.018) continue;
      sum += a * b; mm += a * a; hh += b * b; count++;
    }
    const score = count > 8 ? sum / Math.sqrt(Math.max(1e-12, mm * hh)) : -1;
    if (score > best) { second = best; best = score; bestLag = lag; }
    else if (score > second && Math.abs(lag - bestLag) > 1) second = score;
  }

  const detectedMs = bestLag * hop / sr * 1000;
  const margin = Math.max(0, best - Math.max(-1, second));
  const confidence = Math.max(0, Math.min(1, (best - 0.12) / 0.45)) *
                     Math.max(0.25, Math.min(1, margin / 0.08));
  const apply = Math.abs(detectedMs) >= 8 &&
                Math.abs(detectedMs) <= maxLagMs &&
                best >= 0.28 && confidence >= 0.32;

  return {
    offsetMs: detectedMs,
    correctionMs: apply ? -detectedMs : 0,
    confidence,
    correlation: best,
    apply
  };
}

async function analyzeHarmonyPhraseTiming(mainSamples, harmonySamples, sr, globalTiming, onProgress) {
  const durationSec=Math.min(mainSamples.length,harmonySamples.length)/Math.max(1,sr);
  const hop=Math.max(64,Math.round(sr*(durationSec>180?0.020:0.010)));
  const win=Math.max(hop*2,Math.round(sr*0.030));
  const n=Math.min(mainSamples.length,harmonySamples.length), mainDb=[], harmDb=[];
  let envIndex=0;
  const envTotal=Math.max(1,Math.floor((n-win)/hop)+1);
  for(let i=0;i+win<n;i+=hop){
    mainDb.push(dbfs(rmsOf(mainSamples,i,win)));
    harmDb.push(dbfs(rmsOf(harmonySamples,i,win)));
    envIndex++;
    if(envIndex%120===0){
      if(onProgress) onProgress(0.18*(envIndex/envTotal));
      await yieldToBrowser();
    }
  }
  if(mainDb.length<30) return { phrases:[], applicable:0, medianAbsMs:0, boundaries:0, safeBoundaries:0 };

  const percentile=(arr,p)=>{
    const a=arr.filter(Number.isFinite).slice().sort((x,y)=>x-y);
    return a.length ? a[Math.max(0,Math.min(a.length-1,Math.floor((a.length-1)*p)))] : -90;
  };
  const smooth=(arr,r=2)=>arr.map((_,i)=>{
    let sum=0,c=0; for(let k=Math.max(0,i-r);k<=Math.min(arr.length-1,i+r);k++){sum+=arr[k];c++;}
    return sum/Math.max(1,c);
  });
  const m=smooth(mainDb,2), h=smooth(harmDb,2);

  // D53: 局所タイミング相関用の差分エンベロープを1回だけ作る。
  const diffEnv=(arr)=>{
    const out=new Float32Array(Math.max(0,arr.length-1));
    for(let i=1;i<arr.length;i++) out[i-1]=Math.max(-0.35,Math.min(0.35,(arr[i]-arr[i-1])/20));
    return out;
  };
  const mainDiff=diffEnv(m), harmDiff=diffEnv(h);

  const mainGate=Math.max(-50,Math.min(-34,percentile(m,0.20)+16));
  const harmGate=Math.max(-52,Math.min(-36,percentile(h,0.20)+18));
  // タイミング比較に必要なので、MainとHarmonyの両方が発声している区間を基準にする。
  const active=m.map((v,i)=>v>mainGate && h[i]>harmGate);
  // 60ms以下の隙間だけ結合。v74の120msより短くし、語句間を残しやすくする。
  const bridge=Math.max(1,Math.round(0.060*sr/hop));
  for(let i=0;i<active.length;){
    if(active[i]){i++;continue;}
    let j=i; while(j<active.length&&!active[j])j++;
    if(i>0&&j<active.length&&j-i<=bridge) for(let k=i;k<j;k++)active[k]=true;
    i=j;
  }

  const base=[]; let i=0;
  while(i<active.length){
    while(i<active.length&&!active[i])i++;
    if(i>=active.length)break;
    let j=i; while(j<active.length&&active[j])j++;
    if((j-i)*hop/sr>=0.18) base.push([i,j]);
    i=j;
  }

  // 長すぎる区間は、Main/Harmony双方の音量が落ちる局所的な谷で分割する。
  // 解析区間の上限を約4.5秒にし、目標点の±0.9秒から最も深い谷を選ぶ。
  const raw=[], maxFrames=Math.max(1,Math.round(4.5*sr/hop));
  const minFrames=Math.max(1,Math.round(0.45*sr/hop));
  const searchFrames=Math.max(1,Math.round(0.90*sr/hop));
  const combined=m.map((v,i)=>Math.max(v-mainGate,h[i]-harmGate));
  for(const [a,b] of base){
    let st=a;
    while(b-st>maxFrames){
      const target=st+maxFrames;
      const lo=Math.max(st+minFrames,target-searchFrames), hi=Math.min(b-minFrames,target+searchFrames);
      let cut=target,best=Infinity;
      for(let k=lo;k<=hi;k++){
        // 50ms平均で瞬間的なノイズ谷を避ける。
        let q=0,c=0; for(let t=Math.max(lo,k-2);t<=Math.min(hi,k+2);t++){q+=combined[t];c++;}
        q/=Math.max(1,c);
        if(q<best){best=q;cut=k;}
      }
      raw.push([st,cut]); st=cut;
    }
    if(b-st>=minFrames) raw.push([st,b]);
  }

  if(onProgress) onProgress(0.28);
  await yieldToBrowser();

  const phrases=[], maxLag=Math.max(1,Math.round(0.090*sr/hop));
  const globalCorrection=(globalTiming&&globalTiming.apply)?globalTiming.correctionMs:0;

  // D54: スマホで全フレーズを精密相関するとCPUを長時間占有するため、
  // 最大48区間を曲全体から均等抽出。未抽出区間はglobal補正のみ。
  const maxPhraseChecks = 48;
  let phraseIndices = raw.map((_,i)=>i);
  if (phraseIndices.length > maxPhraseChecks) {
    const sampled = [];
    for (let q=0; q<maxPhraseChecks; q++) {
      sampled.push(Math.round(q * (phraseIndices.length - 1) / (maxPhraseChecks - 1)));
    }
    phraseIndices = [...new Set(sampled)];
  }

  for(let loopIdx=0;loopIdx<phraseIndices.length;loopIdx++){
    const idx=phraseIndices[loopIdx];
    const [a,b]=raw[idx];
    const start=Math.max(0,a*hop), end=Math.min(n,b*hop);

    // D53: 生波形を切り出して毎回RMS/相関をやり直さず、
    // 既存エンベロープ上で±90msだけ相関する。
    const local=analyzeEnvelopeTimingLimited(mainDiff,harmDiff,a,b,hop,sr,90);
    const residualMs=local.apply ? local.correctionMs-globalCorrection : 0;
    phrases.push({
      startSample:start,endSample:end,offsetMs:local.offsetMs,correctionMs:residualMs,
      confidence:local.confidence,apply:false,leftSilenceMs:0,rightSilenceMs:0,
      leftBoundarySafe:false,rightBoundarySafe:false
    });
    if(loopIdx%3===2){
      if(onProgress) onProgress(0.28 + 0.44*((loopIdx+1)/Math.max(1,phraseIndices.length)));
      await yieldToBrowser();
    }
  }

  // 境界の安全性を判定。完全な無音余白、または両トラックが十分低い谷が40ms以上続く場合のみ移動可。
  const quietRunMs=(frameIndex,dir)=>{
    let count=0,k=frameIndex;
    while(k>=0&&k<m.length&&count<40){
      if(m[k]>mainGate+5 || h[k]>harmGate+5) break;
      count++; k+=dir;
    }
    return count*hop/sr*1000;
  };
  let safeBoundaries=0;
  for(let k=0;k<phrases.length;k++){
    const ph=phrases[k], prevEnd=k?phrases[k-1].endSample:0, nextStart=k+1<phrases.length?phrases[k+1].startSample:n;
    const hardLeft=(ph.startSample-prevEnd)/sr*1000, hardRight=(nextStart-ph.endSample)/sr*1000;
    const sf=Math.max(0,Math.min(m.length-1,Math.round(ph.startSample/hop)));
    const ef=Math.max(0,Math.min(m.length-1,Math.round(ph.endSample/hop)));
    const valleyLeft=Math.min(quietRunMs(sf,-1),quietRunMs(sf,1));
    const valleyRight=Math.min(quietRunMs(ef,-1),quietRunMs(ef,1));
    ph.leftSilenceMs=Math.max(hardLeft,valleyLeft);
    ph.rightSilenceMs=Math.max(hardRight,valleyRight);
    const need=Math.abs(ph.correctionMs)+18;
    // v76: 完全無音だけでなく「そのフレーズ本体より十分小さい谷」も安全境界として評価する。
    // 実音源では語句間が-36〜-41dB程度まで落ちても完全無音にはならず、旧条件だと補正が全停止した。
    // 10〜15msの微小移動は両端がフレーズ中央値より12dB以上低ければ許可。
    // それを超える移動は18dB以上の深い谷を要求し、大きな局所移動は引き続き慎重に扱う。
    const segM=m.slice(sf,Math.max(sf+1,ef)).slice().sort((a,b)=>a-b);
    const segH=h.slice(sf,Math.max(sf+1,ef)).slice().sort((a,b)=>a-b);
    const medM=segM.length?segM[Math.floor(segM.length/2)]:-90;
    const medH=segH.length?segH[Math.floor(segH.length/2)]:-90;
    const phraseLevel=Math.max(medM,medH);
    const boundaryLevel=(fi)=>{ let sm=0,sh=0,c=0; for(let q=Math.max(0,fi-2);q<=Math.min(m.length-1,fi+2);q++){sm+=m[q];sh+=h[q];c++;} return Math.max(sm/Math.max(1,c),sh/Math.max(1,c)); };
    const leftDropDb=phraseLevel-boundaryLevel(sf), rightDropDb=phraseLevel-boundaryLevel(ef);
    const requiredDrop=Math.abs(ph.correctionMs)<=15 ? 12 : 18;
    ph.leftBoundarySafe=ph.leftSilenceMs>=need || leftDropDb>=requiredDrop;
    ph.rightBoundarySafe=ph.rightSilenceMs>=need || rightDropDb>=requiredDrop;
    ph.leftDropDb=leftDropDb; ph.rightDropDb=rightDropDb;
    if(ph.leftBoundarySafe&&ph.rightBoundarySafe) safeBoundaries++;
    ph.apply=Math.abs(ph.correctionMs)>=10 && Math.abs(ph.correctionMs)<=80 && ph.confidence>=0.38 && ph.leftBoundarySafe && ph.rightBoundarySafe;
    if(k%8===7){
      if(onProgress) onProgress(0.74 + 0.24*((k+1)/Math.max(1,phrases.length)));
      await yieldToBrowser();
    }
  }
  if(onProgress) onProgress(1);
  const applied=phrases.filter(x=>x.apply), abs=applied.map(x=>Math.abs(x.correctionMs)).sort((a,b)=>a-b);
  return {
    phrases, applicable:applied.length,
    medianAbsMs:abs.length?abs[Math.floor(abs.length/2)]:0,
    boundaries:Math.max(0,phrases.length-1), safeBoundaries,
    gates:{mainDb:mainGate,harmonyDb:harmGate}
  };
}

function analyzeHarmonyTimingLimited(mainSamples,harmonySamples,sr,maxMs){
  const hop=Math.max(64,Math.round(sr*0.010)), win=Math.max(hop*2,Math.round(sr*0.030));
  const n=Math.min(mainSamples.length,harmonySamples.length), me=[],he=[];
  for(let i=0;i+win<n;i+=hop){ me.push(Math.log10(rmsOf(mainSamples,i,win)+1e-7)); he.push(Math.log10(rmsOf(harmonySamples,i,win)+1e-7)); }
  if(me.length<12)return {offsetMs:0,correctionMs:0,confidence:0,apply:false};
  const diff=a=>a.slice(1).map((v,i)=>Math.max(-.35,Math.min(.35,v-a[i]))), m=diff(me),h=diff(he);
  const maxLag=Math.max(1,Math.round(maxMs*0.001*sr/hop)); let bestLag=0,best=-1,second=-1;
  for(let lag=-maxLag;lag<=maxLag;lag++){let sum=0,mm=0,hh=0,c=0; const st=Math.max(0,-lag),en=Math.min(m.length,h.length-lag); for(let i=st;i<en;i++){const x=m[i],y=h[i+lag]; if(Math.abs(x)+Math.abs(y)<.018)continue; sum+=x*y;mm+=x*x;hh+=y*y;c++;} const sc=c>6?sum/Math.sqrt(Math.max(1e-12,mm*hh)):-1; if(sc>best){second=best;best=sc;bestLag=lag}else if(sc>second&&Math.abs(lag-bestLag)>1)second=sc;}
  const offsetMs=bestLag*hop/sr*1000, margin=Math.max(0,best-second), confidence=Math.max(0,Math.min(1,(best-.12)/.45))*Math.max(.25,Math.min(1,margin/.08));
  const apply=Math.abs(offsetMs)>=8&&best>=.28&&confidence>=.32; return {offsetMs,correctionMs:apply?-offsetMs:0,confidence,apply};
}

async function applyPhraseTimingCorrection(samples, phraseTiming, sr) {
  if(!phraseTiming || !phraseTiming.applicable) return samples;
  const out=new Float32Array(samples.length);
  const copyChunk=262144;
  for(let st=0;st<samples.length;st+=copyChunk){
    const en=Math.min(samples.length,st+copyChunk);
    out.set(samples.subarray(st,en),st);
    if(en<samples.length) await yieldToBrowser();
  }
  const fade=Math.max(16,Math.round(sr*0.008));
  for(const ph of phraseTiming.phrases){
    if(!ph.apply) continue;
    const shift=Math.round(ph.correctionMs*sr/1000), src0=ph.startSample, src1=ph.endSample;
    const dst0=src0+shift, dst1=src1+shift;
    if(dst0<0||dst1>out.length) continue;
    // 安全条件により前後は無音なので、元位置を消して移動先へコピー。
    out.fill(0,src0,src1);
    const len=src1-src0;
    for(let i=0;i<len;i++){
      let g=1; if(i<fade)g=i/fade; else if(i>len-fade)g=(len-i)/fade;
      out[dst0+i]=samples[src0+i]*Math.max(0,Math.min(1,g));
      if(i>0 && i%131072===0) await yieldToBrowser();
    }
    await yieldToBrowser();
  }
  return out;
}

async function analyzeHarmonyRelationship(mainSamples, harmonySamples, sr, onProgress) {
  const frameSize = 2048;
  const n = Math.min(mainSamples.length, harmonySamples.length);

  // D52: スペクトル関係の評価は全フレームFFTではなく均等サンプリング。
  // タイミング解析は後段で別途フル時間軸を見るため、ここで1,024sampleごとに
  // 全曲FFTする必要はない。最大480窓で全体傾向を十分に把握する。
  const usable = Math.max(0, n - frameSize);
  const spectralFrames = Math.min(96, Math.max(1, Math.floor(usable / frameSize)));
  const rows = [];
  const totalFrames = spectralFrames;
  for (let frameIndex = 0; frameIndex < spectralFrames; frameIndex++) {
    const start = spectralFrames <= 1 ? 0 : Math.floor((usable * frameIndex) / (spectralFrames - 1));
    const m = mainSamples.subarray(start, start + frameSize);
    const h = harmonySamples.subarray(start, start + frameSize);
    const mr = rmsOf(m, 0, m.length), hr = rmsOf(h, 0, h.length);
    if (dbfs(mr) < -48 || dbfs(hr) < -52) continue; // 両方が実際に歌っている区間だけ
    const ms = magnitudeSpectrum(m, sr), hs = magnitudeSpectrum(h, sr);
    let mBand=0,hBand=0,overlap=0,mPres=0,hPres=0,mSib=0,hSib=0;
    const bins=Math.min(ms.mag.length,hs.mag.length);
    for(let k=0;k<bins;k++){
      const f=ms.freqs[k], a=ms.mag[k], b=hs.mag[k];
      if(f>=1000 && f<=4000){ mBand+=a; hBand+=b; overlap+=Math.min(a,b); }
      if(f>=1000 && f<=3000){ mPres+=a; hPres+=b; }
      if(f>=5500 && f<=10000){ mSib+=a; hSib+=b; }
    }
    rows.push({
      levelDiff: dbfs(hr)-dbfs(mr),
      overlap: overlap/Math.max(1e-9,Math.min(mBand,hBand)),
      presenceRatio: hPres/Math.max(1e-9,mPres),
      sibilanceRatio: hSib/Math.max(1e-9,mSib),
    });
    if (frameIndex % 12 === 11) {
      if (onProgress) onProgress(0.66 * ((frameIndex + 1) / totalFrames));
      await yieldToBrowser();
    }
  }
  if (onProgress) onProgress(0.68);
  await yieldToBrowser();

  const timing = await analyzeHarmonyTiming(
    mainSamples,
    harmonySamples,
    sr,
    (frac) => {
      if (onProgress) onProgress(0.68 + Math.max(0,Math.min(1,frac))*0.08);
    }
  );
  if (onProgress) onProgress(0.76);
  await yieldToBrowser();

  const phraseTiming = await analyzeHarmonyPhraseTiming(
    mainSamples,
    harmonySamples,
    sr,
    timing,
    (frac) => {
      if (onProgress) onProgress(0.76 + Math.max(0,Math.min(1,frac))*0.24);
    }
  );
  if (onProgress) onProgress(1);
  if(!rows.length) return { activeLevelDiffDb:0, spectralOverlap1_4k:0, presenceRatio:1, sibilanceRatio:1, activeFrames:0, timing, phraseTiming };
  const avg=k=>rows.reduce((a,r)=>a+r[k],0)/rows.length;
  return {
    activeLevelDiffDb: avg('levelDiff'),
    spectralOverlap1_4k: Math.max(0,Math.min(1,avg('overlap'))),
    presenceRatio: avg('presenceRatio'),
    sibilanceRatio: avg('sibilanceRatio'),
    activeFrames: rows.length,
    timing,
    phraseTiming,
  };
}

function decideHarmonyChain(mainRmsDbfs, harmonyRmsDbfs, mainPresence, harmonyPresence, rules, relation) {
  const r = rules || DEFAULT_HARMONY_RULES;
  const steps = [];
  steps.push({ name: 'highpass', params: { cutoffHz: r.lowCleanup.highpassCutoffHz },
    reason: '複数声重なりによる低域の濁りを防ぐためMainより高めでカット' });

  const ratio = harmonyPresence / Math.max(mainPresence, 1e-9);
  const mc = r.maskingCheck;
  const rel = relation || { activeLevelDiffDb: harmonyRmsDbfs-mainRmsDbfs, spectralOverlap1_4k:0, presenceRatio:ratio, sibilanceRatio:1 };
  const ab = r.adaptiveBlend || DEFAULT_HARMONY_RULES.adaptiveBlend;
  const overlapRisk = Math.max(0, Math.min(1, (rel.spectralOverlap1_4k - ab.overlapWarn) / Math.max(0.01, ab.overlapHigh - ab.overlapWarn)));
  const presenceRisk = Math.max(0, Math.min(1, (rel.presenceRatio - ab.presenceWarn) / 0.45));
  const competitionRisk = Math.max(overlapRisk, presenceRisk);

  // 1-3kHz(歌詞の聞き取りやすさを左右するMainの明瞭度帯域)は、
  // マスキングを検出してからではなく常に控えめに譲っておく。
  // Mainを喰っている疑いが強い場合はさらに深く削る。
  const baseCarveGain = ratio > mc.warnIfHarmonyPresenceExceedsMainRatio
    ? r.presenceCarve.gainDb * 1.45 : r.presenceCarve.gainDb;
  const carveGain = baseCarveGain - (ab.enabled ? competitionRisk * ab.maxExtraCarveDb : 0);
  steps.push({ name: 'peakingEq',
    params: { freqHz: r.presenceCarve.freqHz, gainDb: carveGain, q: r.presenceCarve.q },
    reason: `Mainの明瞭度帯域を確保。Presence比${rel.presenceRatio.toFixed(2)} / 1–4kHz重なり${rel.spectralOverlap1_4k.toFixed(2)}${competitionRisk>0.25 ? 'のため競合分を追加で整理' : ''}` });

  if (ratio > mc.warnIfHarmonyPresenceExceedsMainRatio) {
    steps.push({ name: 'peakingEq',
      params: { freqHz: r.highTame.freqHz, gainDb: r.highTame.gainDb * 1.5, q: r.highTame.q },
      reason: `ハモリの1-3kHz存在感がMain比${ratio.toFixed(2)}と高くMainを喰う恐れがあるため高域も強めに抑制` });
  } else {
    steps.push({ name: 'peakingEq',
      params: { freqHz: r.highTame.freqHz, gainDb: r.highTame.gainDb, q: r.highTame.q },
      reason: 'Mainより手前に出過ぎないよう高域を軽く抑制(通常量)' });
  }
  if (r.airBoost && r.airBoost.enabled) {
    // presenceCarveが既にMainの明瞭度帯域(1-3kHz)を守っているため、
    // それより十分高い帯域(11kHz付近)を軽く持ち上げても実用上Mainとは衝突しない。
    steps.push({ name: 'peakingEq', params: { freqHz: r.airBoost.freqHz, gainDb: r.airBoost.gainDb, q: r.airBoost.q },
      reason: `超高域(${r.airBoost.freqHz}Hz付近)を軽く持ち上げて煌めきを追加(Mainの明瞭度帯域とは十分離れているため衝突しない)` });
  }
  steps.push({ name: 'compressor', params: r.compressor, reason: 'ハモリは「支え」として強めのコンプで音量ムラを均し、常に一定の存在感にする' });
  steps.push({ name: 'reverb', params: r.reverb, reason: 'Mainより多めのリバーブで奥行きを作りMainと分離' });

  let width = r.stereoWidth.default;
  if (ratio > mc.warnIfHarmonyPresenceExceedsMainRatio) width += 0.08;
  if (ab.enabled) width += competitionRisk * ab.maxWidthAdd;
  width = Math.min(width, SAFETY_CAPS.stereoWidth);
  const doublerBehindParams = (r.doublerBehind && r.doublerBehind.enabled) ? r.doublerBehind : null;
  steps.push({ name: 'stereoWiden', params: { width, doublerBehind: doublerBehindParams },
    reason: 'MainとHarmonyを左右に分離してマスキングを避けつつ広がりを作る' +
      (doublerBehindParams ? '(左右+斜め後ろに広がるダブラー層も追加)' : '') });
  // Main側と同じ安全上限キャップを通す(以前はここが抜けていた実装漏れ)。
  return applySafetyCaps(steps);
}

function presenceRatio1_3k(samples, sr) {
  const frameSize = 2048, hop = 1024;
  let total = 0, band = 0;
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const { mag, freqs } = magnitudeSpectrum(samples.subarray(start, start + frameSize), sr);
    for (let k = 0; k < freqs.length; k++) {
      if (freqs[k] >= 1000 && freqs[k] <= 3000) band += mag[k];
      total += mag[k];
    }
  }
  return total > 0 ? band / total : 0;
}
