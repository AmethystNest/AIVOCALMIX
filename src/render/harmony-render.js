// Harmony stem rendering (mono chain, segmented chain, stereo widening) and
// mixTwoBuffers. No DOM or app state. Moved verbatim from the main app script
// in index.html; loaded before it. Uses src/dsp/*.js and, at call time,
// applySafetyLimiterIfNeeded, measureLevels and VM_RENDER_DEBUG from the app
// script.
// harmonyの主処理(highpass/EQ/compressor/reverb)をモノで実際にレンダリング。
// stereoWidenと最終レベルトリムはここでは行わない
// (Python版と同じ理由: コンプ/リバーブ後にレベルが変わるため、トリムは全処理の後で行う)。
//
// 'transientBoost'はサンプル配列への直接処理(applyTransientBoost)であり
// WebAudioノードのグラフには挿入できない。そのためチェーンを'transientBoost'の
// 前後で2区間に分割し、それぞれを個別にWebAudioでレンダリングした上で、
// 間でJS側の処理を挟む(コンプ直後・リバーブ前にアタックを持ち上げたいため)。
async function renderHarmonyMonoChain(samples, sr, chain) {
  const splitIdx = chain.findIndex((s) => s.name === 'transientBoost');
  if (splitIdx === -1) {
    return await renderHarmonyMonoChainSegment(samples, sr, chain);
  }
  const before = chain.slice(0, splitIdx);
  const boostStep = chain[splitIdx];
  const after = chain.slice(splitIdx + 1);
  const rendered1 = await renderHarmonyMonoChainSegment(samples, sr, before);
  const boosted = await applyTransientBoost(rendered1.getChannelData(0), sr, boostStep.params.boostDb);
  return await renderHarmonyMonoChainSegment(boosted, sr, after);
}

async function renderHarmonyMonoChainSegment(samples, sr, chain) {
  const offlineCtx = new OfflineAudioContext(1, samples.length + sr, sr);
  const srcBuffer = offlineCtx.createBuffer(1, samples.length, sr);
  srcBuffer.copyToChannel(samples, 0);
  const src = offlineCtx.createBufferSource();
  src.buffer = srcBuffer;
  let node = src;
  for (const step of chain) {
    if (step.name === 'highpass') {
      const f = offlineCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = step.params.cutoffHz;
      node.connect(f); node = f;
    } else if (step.name === 'peakingEq') {
      const f = offlineCtx.createBiquadFilter(); f.type = 'peaking';
      f.frequency.value = step.params.freqHz; f.Q.value = step.params.q; f.gain.value = step.params.gainDb;
      node.connect(f); node = f;
    } else if (step.name === 'compressor') {
      // Mainのコンプ(renderChain)と同じ2段シリアル構成に統一。
      // ハモリは「支え」の役割として、均一に潰すことを優先しstage1の
      // アタックも速め(2ms)に設定する(方針転換: アタック感より均一さ優先)。
      const stage1 = offlineCtx.createDynamicsCompressor();
      stage1.threshold.value = step.params.thresholdDb + 4; stage1.ratio.value = Math.min(3.5, step.params.ratio);
      stage1.attack.value = 0.002; stage1.release.value = Math.max(0.04, step.params.releaseMs / 1000 * 0.5);
      stage1.knee.value = 5;
      node.connect(stage1);

      const stage2 = offlineCtx.createDynamicsCompressor();
      stage2.threshold.value = step.params.thresholdDb; stage2.ratio.value = step.params.ratio;
      stage2.attack.value = step.params.attackMs / 1000; stage2.release.value = step.params.releaseMs / 1000;
      stage2.knee.value = 6;
      stage1.connect(stage2);
      node = stage2;
    } else if (step.name === 'reverb') {
      const conv = offlineCtx.createConvolver();
      conv.buffer = await buildReverbImpulse(offlineCtx, Math.max(step.params.decay, 0.2), step.params.predelayMs, 1, step.params.character);
      const wet = offlineCtx.createGain(); wet.gain.value = step.params.mix;
      const dry = offlineCtx.createGain(); dry.gain.value = 1 - step.params.mix;
      const merge = offlineCtx.createGain();
      node.connect(dry); dry.connect(merge);
      node.connect(conv); conv.connect(wet); wet.connect(merge);
      node = merge;
    }
    // 'stereoWiden'/'transientBoost' はここではスキップ(前者は後段の別関数、
    // 後者は上のrenderHarmonyMonoChainで区間分割して処理)
  }
  node.connect(offlineCtx.destination);
  src.start();
  return await offlineCtx.startRendering();
}

// トリム後のモノ信号をステレオへ広げる。Python版 dsp.stereo_widen の移植
// (allpass 2段 + 短いHaas遅延)。BiquadFilterNodeのtype='allpass'はゲインを
// ほぼ変えず位相だけ回すため、Python版のSchroeder allpassと近い性質を持つ。
// モノのハモリをステレオへ広げる。「包み込むように」という要望に応え、
// 以前はL=常に素の音(dry)固定・Rだけを位相分散させる非対称設計だったが
// (片側だけが広がる感じになっていた)、L/Rそれぞれ独立したallpass経路+
// 異なるHaas遅延で対称に位相分散させる設計に変更した。両チャンネルとも
// dry+wetを織り交ぜることで、左右どちらからも包まれるような質感になる。
async function renderHarmonyStereoWiden(monoSamples, sr, width, doublerBehind, inputGainLin = 1) {
  const offlineCtx = new OfflineAudioContext(2, monoSamples.length + Math.floor(sr * 0.08), sr);
  const srcBuffer = offlineCtx.createBuffer(1, monoSamples.length, sr);
  srcBuffer.copyToChannel(monoSamples, 0);
  const src = offlineCtx.createBufferSource(); src.buffer = srcBuffer;

  // D281: Harmony trimを全長Float32Arrayへ焼き込まず、定数GainNodeで適用。
  let inputNode = src;
  if (Math.abs(inputGainLin - 1) > 1e-12) {
    const inputGain = offlineCtx.createGain();
    inputGain.gain.value = inputGainLin;
    src.connect(inputGain);
    inputNode = inputGain;
  }

  const merger = offlineCtx.createChannelMerger(2);
  const wetAmount = width * 0.5; // 対称化に伴い、片側集中だった分を両側に振り分ける

  // Lチャンネル: dry + 独自の位相分散経路(遅延が短め=やや先行)
  const dryL = offlineCtx.createGain(); dryL.gain.value = 1 - wetAmount;
  inputNode.connect(dryL); dryL.connect(merger, 0, 0);
  const ap1L = offlineCtx.createBiquadFilter(); ap1L.type = 'allpass'; ap1L.frequency.value = 700; ap1L.Q.value = 0.7;
  const ap2L = offlineCtx.createBiquadFilter(); ap2L.type = 'allpass'; ap2L.frequency.value = 1800; ap2L.Q.value = 0.7;
  const haasL = offlineCtx.createDelay(0.05); haasL.delayTime.value = 0.009;
  const wetL = offlineCtx.createGain(); wetL.gain.value = wetAmount;
  inputNode.connect(ap1L); ap1L.connect(ap2L); ap2L.connect(haasL); haasL.connect(wetL); wetL.connect(merger, 0, 0);

  // Rチャンネル: dry + Lとは異なる位相分散経路(周波数・遅延をずらして独立させる)
  const dryR = offlineCtx.createGain(); dryR.gain.value = 1 - wetAmount;
  inputNode.connect(dryR); dryR.connect(merger, 0, 1);
  const ap1R = offlineCtx.createBiquadFilter(); ap1R.type = 'allpass'; ap1R.frequency.value = 950; ap1R.Q.value = 0.7;
  const ap2R = offlineCtx.createBiquadFilter(); ap2R.type = 'allpass'; ap2R.frequency.value = 2400; ap2R.Q.value = 0.7;
  const haasR = offlineCtx.createDelay(0.05); haasR.delayTime.value = 0.016;
  const wetR = offlineCtx.createGain(); wetR.gain.value = wetAmount;
  inputNode.connect(ap1R); ap1R.connect(ap2R); ap2R.connect(haasR); haasR.connect(wetR); wetR.connect(merger, 0, 1);

  // ダブラー効果(「左右+斜め後ろ」の空間表現)。上のL/R独立位相分散だけでは
  // 「横に広い」印象止まりなので、それより長めの遅延+ローパス(こもらせる)を
  // かけたタップを"交差"させて足す(左経路の遠めのタップを右へ、その逆も)。
  // 実際の後方定位はステレオ2chでは再現できないが、直接音より遅れて・
  // 高域が削れて・逆側からも薄く聞こえる、という組み合わせは「斜め後方の
  // 反射音」に近い聴感的手がかりを与える定番の手法。
  if (doublerBehind && doublerBehind.enabled) {
    const behindDelayL = offlineCtx.createDelay(0.1); behindDelayL.delayTime.value = doublerBehind.timeLMs / 1000;
    const behindLpL = offlineCtx.createBiquadFilter(); behindLpL.type = 'lowpass'; behindLpL.frequency.value = 5000; behindLpL.Q.value = 0.7;
    const behindGainL = offlineCtx.createGain(); behindGainL.gain.value = doublerBehind.mix;
    inputNode.connect(behindDelayL); behindDelayL.connect(behindLpL); behindLpL.connect(behindGainL);
    behindGainL.connect(merger, 0, 1); // Lの遅い反射をRへ交差させる(斜め後方の印象)

    const behindDelayR = offlineCtx.createDelay(0.1); behindDelayR.delayTime.value = doublerBehind.timeRMs / 1000;
    const behindLpR = offlineCtx.createBiquadFilter(); behindLpR.type = 'lowpass'; behindLpR.frequency.value = 5000; behindLpR.Q.value = 0.7;
    const behindGainR = offlineCtx.createGain(); behindGainR.gain.value = doublerBehind.mix;
    inputNode.connect(behindDelayR); behindDelayR.connect(behindLpR); behindLpR.connect(behindGainR);
    behindGainR.connect(merger, 0, 0); // Rの遅い反射をLへ交差させる
  }

  // 中間段の安全策(強いリミットはExport時の最終段だけに残す、という設計だった。
  // ただしこれはWebAudioのDynamicsCompressorNode(反応型・先読みなし、
  // attack=10ms)で、Vocal側で見つかったのと同じ理由により、手動トリム
  // (Previewタブのスライダー、最大+6dB)が大きくなった場合等に確実な
  // クリップ防止にはならないことが判明。ここでも先読みリミッターを
  // 最終段として追加し、確実に安全な範囲に収める。
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -1.0; limiter.ratio.value = 4; limiter.attack.value = 0.01; limiter.release.value = 0.15;
  merger.connect(limiter); limiter.connect(offlineCtx.destination);

  src.start();
  const rendered = await offlineCtx.startRendering();
  const safeRendered = await applySafetyLimiterIfNeeded(rendered, -0.1);
  if (VM_RENDER_DEBUG) console.log('[renderHarmonyStereoWiden] harmony単体:', measureLevels(safeRendered));
  return safeRendered;
}

// 2つのAudioBufferを(モノ/ステレオ混在OK)実際に加算合成する。
// 別のAudioContextで作られたAudioBufferを新しいOfflineAudioContext上で
// そのまま使うと環境によって問題が起きうるため、必ずcreateBuffer+copyToChannelで
// 現在のcontext用に作り直してから使う。
//
// 注意(見直した点): 以前はここに強いリミッター(threshold -0.3dB, ratio 20:1)を
// 毎回かけていた。Vocal+Harmony→さらに+Instrumentalと合成段階が2回あるため、
// リミッターが二重にかかり、後から足すHarmonyのように相対的に小さい成分が
// ダッキングで一層聴こえにくくなる可能性があった。ここでは「クリッピング防止の
// 最終安全策」に留め、ラウドネスを積極的に潰さないよう緩めた
// (本当のブリックウォールリミットはExport時の最終段だけに残す)。
async function mixTwoBuffers(bufferA, bufferB, sr) {
  const len = Math.max(bufferA.length, bufferB.length);
  const offlineCtx = new OfflineAudioContext(2, len, sr);
  function connectSource(buf) {
    const stereoBuf = offlineCtx.createBuffer(2, buf.length, sr);
    if (buf.numberOfChannels === 1) {
      stereoBuf.copyToChannel(buf.getChannelData(0), 0);
      stereoBuf.copyToChannel(buf.getChannelData(0), 1);
    } else {
      stereoBuf.copyToChannel(buf.getChannelData(0), 0);
      stereoBuf.copyToChannel(buf.getChannelData(1), 1);
    }
    const src = offlineCtx.createBufferSource();
    src.buffer = stereoBuf; src.connect(safety); src.start();
  }
  // 純粋な安全策: -1dBFSを超えた分だけ穏やかに(ratio 4:1)抑える。
  // 恒常的にかかりっぱなしにならないよう、通常の音量では実質無music。
  const safety = offlineCtx.createDynamicsCompressor();
  safety.threshold.value = -1.0; safety.ratio.value = 4; safety.attack.value = 0.01; safety.release.value = 0.15;
  safety.connect(offlineCtx.destination);
  connectSource(bufferA);
  connectSource(bufferB);
  const rendered = await offlineCtx.startRendering();
  if (VM_RENDER_DEBUG) console.log('[mixTwoBuffers] combined:', measureLevels(rendered));
  return rendered;
}
