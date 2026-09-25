// Vocal chain rendering: applyPreProcessingSteps (sample-array stages) and
// renderChain (OfflineAudioContext graph for the decided chain). No DOM or
// app state. Moved verbatim from the main app script in index.html; loaded
// before it. Uses src/dsp/*.js and yieldToBrowser at call time.
async function applyPreProcessingSteps(samplesL, samplesR, sr, chain, onStepProgress) {
  let outL = samplesL, outR = samplesR;
  for (const step of chain) {
    if (step.name === 'gainRider') {
      try {
        const ridden = await applyGainRidingStereoCooperative(outL, outR, sr, step.params);
        outL = ridden.left;
        outR = ridden.right;
      } catch (e) {
        // Stereo-link処理が利用できない場合だけ既存の独立L/R処理へ戻す。
        console.warn('[stereo-gainrider/fallback-independent]', e);
        outL = await applyGainRidingCooperative(outL, sr, step.params);
        await yieldToBrowser();
        outR = await applyGainRidingCooperative(outR, sr, step.params);
      }
    } else if (step.name === 'sibilanceAwareExciter') {
      try {
        const excited = await applySibilanceAwareExciterStereoCooperative(outL, outR, sr, step.params);
        outL = excited.left;
        outR = excited.right;
      } catch (e) {
        // Stereo-link処理に失敗した場合は既存の独立L/R実装を使用する。
        console.warn('[stereo-exciter/fallback-independent]', e);
        outL = await applySibilanceAwareExciterCooperative(outL, sr, step.params);
        await yieldToBrowser();
        outR = await applySibilanceAwareExciterCooperative(outR, sr, step.params);
      }
    } else if (step.name === 'clipRepair') {
      try {
        const repaired = await repairClippingStereoCooperative(outL, outR, step.params);
        outL = repaired.left;
        outR = repaired.right;
      } catch (e) {
        console.warn('[stereo-cliprepair/fallback-independent]', e);
        outL = (await repairClippingCooperative(outL, step.params)).samples;
        await yieldToBrowser();
        outR = (await repairClippingCooperative(outR, step.params)).samples;
      }
    } else if (step.name === 'reverbTailGate') {
      try {
        const gated = await applyReverbTailGateStereoCooperative(outL, outR, sr, step.params);
        outL = gated.left;
        outR = gated.right;
      } catch (e) {
        // Stereo-link処理に失敗した場合は既存の独立L/R実装を使用する。
        console.warn('[stereo-tailgate/fallback-independent]', e);
        outL = await applyReverbTailGateCooperative(outL, sr, step.params);
        await yieldToBrowser();
        outR = await applyReverbTailGateCooperative(outR, sr, step.params);
      }
    } else if (step.name === 'expander') {
      try {
        const expanded = await applyExpanderStereoCooperative(
          outL, outR, sr,
          step.params.thresholdDb, step.params.ratio,
          step.params.attackMs, step.params.releaseMs
        );
        outL = expanded.left;
        outR = expanded.right;
      } catch (e) {
        // Stereo-link処理に失敗した場合は既存の独立L/R処理へ戻す。
        console.warn('[stereo-expander/fallback-independent]', e);
        outL = await applyExpanderCooperative(outL, sr, step.params.thresholdDb, step.params.ratio, step.params.attackMs, step.params.releaseMs);
        await yieldToBrowser();
        outR = await applyExpanderCooperative(outR, sr, step.params.thresholdDb, step.params.ratio, step.params.attackMs, step.params.releaseMs);
      }
    } else if (step.name === 'clickReduction') {
      try {
        const clicked=await applyClickReductionStereoCooperative(outL,outR,sr);
        outL=clicked.left;outR=clicked.right;
      } catch(e) {
        console.warn('[stereo-click/fallback-independent]',e);
        outL=(await applyClickReductionCooperative(outL,sr)).samples;
        await yieldToBrowser();
        outR=(await applyClickReductionCooperative(outR,sr)).samples;
      }
    } else if (step.name === 'dynamicEQ') {
      try {
        const controlled = await applyDynamicResonanceControlStereoCooperative(
          outL, outR, sr,
          step.params.freqHz, step.params.q,
          step.params.thresholdRatio, step.params.maxCutDb
        );
        outL = controlled.left;
        outR = controlled.right;
      } catch (e) {
        // Stereo-link処理が使えない場合は既存の独立L/R処理へ戻す。
        console.warn('[stereo-dynamic-eq/fallback-independent]', e);
        outL = await applyDynamicResonanceControlCooperative(outL, sr, step.params.freqHz, step.params.q, step.params.thresholdRatio, step.params.maxCutDb);
        await yieldToBrowser();
        outR = await applyDynamicResonanceControlCooperative(outR, sr, step.params.freqHz, step.params.q, step.params.thresholdRatio, step.params.maxCutDb);
      }
    } else if (step.name === 'deEsser') {
      try {
        const deessed = await applyPrecisionDeEsserStereoCooperative(outL, outR, sr, step.params);
        outL = deessed.left;
        outR = deessed.right;
        vmPrecisionDeEsserApplied.add(step);
      } catch (e) {
        console.warn('[precision-deesser/fallback-webaudio]', e);
        vmPrecisionDeEsserApplied.delete(step);
      }
    } else if (step.name === 'compressor' && vmPrecisionCompressorApplied.has(step)) {
      continue;
    } else if (step.name === 'compressor') {
      try {
        const compressed = await applyPrecisionCompressorStereoCooperative(outL, outR, sr, step.params);
        outL = compressed.left;
        outR = compressed.right;
        vmPrecisionCompressorApplied.add(step);
      } catch (e) {
        console.warn('[precision-compressor/fallback-webaudio]', e);
        vmPrecisionCompressorApplied.delete(step);
      }
    } else if (step.name === 'breathControl') {
      try {
        const breathed = await detectAndReduceBreathsStereoCooperative(
          outL, outR, sr,
          { tooLoudDb: step.params.tooLoudDb, reduceTo: step.params.reduceTo }
        );
        outL = breathed.left;
        outR = breathed.right;
      } catch (e) {
        console.warn('[stereo-breath/fallback-independent]', e);
        outL = (await detectAndReduceBreathsCooperative(outL, sr, { tooLoudDb: step.params.tooLoudDb, reduceTo: step.params.reduceTo })).samples;
        await yieldToBrowser();
        outR = (await detectAndReduceBreathsCooperative(outR, sr, { tooLoudDb: step.params.tooLoudDb, reduceTo: step.params.reduceTo })).samples;
      }
    }
    if (onStepProgress) onStepProgress(step);
    // 各前処理ステップ間でUIへ制御を返し、スマホで長時間無応答になるのを防ぐ。
    await yieldToBrowser();
  }
  await sanitizeStereoFiniteCooperative(outL, outR);
  return { left: outL, right: outR };
}

async function renderChain(sourceSamplesL, sourceSamplesR, sr, chain) {
  // 常にステレオで処理する(以前はモノラル配列を受け取り、stereoWidenが
  // 有効な時だけ疑似ステレオ合成していたため、元のボーカルファイルに既に
  // 入っていたステレオ差分——例えばL/Rで違う動きをするディレイ効果等——が
  // アップロード時点のモノラル化で失われてしまっていた。呼び出し元
  // (btnRenderMixハンドラ)でstate.vocalBufferから直接L/Rチャンネルを渡すよう
  // 変更し、この関数自体も入力の長さに関わらず常に2chで処理する)。
  const offlineCtx = new OfflineAudioContext(2, sourceSamplesL.length + sr * 2, sr);
  const srcBuffer = offlineCtx.createBuffer(2, sourceSamplesL.length, sr);
  srcBuffer.copyToChannel(sourceSamplesL, 0);
  srcBuffer.copyToChannel(sourceSamplesR, 1);
  const src = offlineCtx.createBufferSource();
  src.buffer = srcBuffer;

  let node = src;
  for (const step of chain) {
    if (step.name === 'gainRider' || step.name === 'expander' || step.name === 'clickReduction' || step.name === 'breathControl' || step.name === 'dynamicEQ' || step.name === 'sectionBalance' || step.name === 'reverbTailGate' || step.name === 'clipRepair' || step.name === 'sibilanceAwareExciter') {
      continue; // applyPreProcessingStepsで既に適用済み(サンプル配列への前処理)
    } else if (step.name === 'highpass' || step.name === 'dcBlock') {
      const f = offlineCtx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = step.params.cutoffHz;
      node.connect(f); node = f;
    } else if (step.name === 'lowpass') {
      const f = offlineCtx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = step.params.cutoffHz;
      node.connect(f); node = f;
    } else if (step.name === 'peakingEq') {
      const f = offlineCtx.createBiquadFilter();
      f.type = 'peaking'; f.frequency.value = step.params.freqHz;
      f.Q.value = step.params.q; f.gain.value = step.params.gainDb;
      node.connect(f); node = f;
    } else if (step.name === 'deEsser' && vmPrecisionDeEsserApplied.has(step)) {
      continue;
    } else if (step.name === 'deEsser') {
      // Precision処理が利用できなかった場合だけ既存WebAudio版を使用。
      // 本格デエッサー(帯域分割型)に刷新。以前は広帯域コンプで近似していたが、
      // それだと歯擦音以外の帯域(母音等)まで一緒に潰れてしまう欠点があった。
      // ここでは歯擦音帯域(5.5kHz以上)だけを抽出してコンプレッションし、
      // 「原音 - 元の歯擦音帯域 + 圧縮後の歯擦音帯域」という差分合成で
      // 歯擦音だけを狙い撃ちで抑える(Python版dsp.de_esser()と同じ設計)。
      // ステレオ信号のまま通しても、BiquadFilterNode/DynamicsCompressorNodeは
      // 各チャンネルを独立に処理するため、L/Rの違いは保たれる。
      const sibFreq = step.params.freqHz || 6500;
      const splitHp = offlineCtx.createBiquadFilter();
      splitHp.type = 'highpass'; splitHp.frequency.value = sibFreq; splitHp.Q.value = 0.7;
      node.connect(splitHp);

      const sibComp = offlineCtx.createDynamicsCompressor();
      sibComp.threshold.value = step.params.thresholdDb; sibComp.ratio.value = step.params.ratio;
      sibComp.attack.value = 0.001; sibComp.release.value = 0.03; sibComp.knee.value = 4;
      splitHp.connect(sibComp);

      const sum = offlineCtx.createGain(); sum.gain.value = 1;
      node.connect(sum);                          // 原音(乾)をそのまま
      const negBand = offlineCtx.createGain(); negBand.gain.value = -1;
      splitHp.connect(negBand); negBand.connect(sum); // 元の歯擦音帯域を引き算
      sibComp.connect(sum);                        // 圧縮後の歯擦音帯域を足し算
      node = sum;
    } else if (step.name === 'compressor') {
      // 2段構成のシリアルコンプレッション。1段(トランジェント処理、速いアタック/低レシオ)
      // →2段(グルー、遅めのアタック/そのレシオ)という professional な組み方にすることで、
      // 単段の強いコンプよりポンピングが少なく自然にまとまる。
      // 注: WebAudioのDynamicsCompressorNodeはステレオ入力時、L/R共通の
      // リンクされた検出器でゲインを決める(ネイティブ挙動)。これは
      // ステレオ感を歪めない標準的なマスターバス的処理として適切。
      const stage1 = offlineCtx.createDynamicsCompressor();
      stage1.threshold.value = step.params.thresholdDb + 4; stage1.ratio.value = Math.min(2.5, step.params.ratio);
      stage1.attack.value = 0.002; stage1.release.value = Math.max(0.05, step.params.releaseMs / 1000 * 0.6);
      stage1.knee.value = 6;
      node.connect(stage1);

      const stage2 = offlineCtx.createDynamicsCompressor();
      stage2.threshold.value = step.params.thresholdDb; stage2.ratio.value = step.params.ratio;
      stage2.attack.value = step.params.attackMs / 1000; stage2.release.value = step.params.releaseMs / 1000;
      stage2.knee.value = 8;
      stage1.connect(stage2);
      node = stage2;
    } else if (step.name === 'multibandCompressor') {
      // マルチバンドコンプレッション。単一帯域のコンプだと「低音の一発で
      // 高音まで一緒に潰れる」ことがあるが、帯域を分けて独立に圧縮すると
      // より透明感のある自然な仕上がりになる(プロの声の処理で定番の手法)。
      //
      // クロスオーバーはLinkwitz-Riley 4次(2次のButterworth biquadを2段
      // カスケード)を使用。この方式は、位相を無視した振幅としてローパス
      // 出力とハイパス出力を単純加算すると、クロスオーバー周波数付近も
      // 含めて理論上ぴったりフラットに戻ることをNode.jsで数値検証済み
      // (単純な1次フィルタや通常のButterworthをそのまま1段で使うと、
      // クロスオーバー付近で+3dB程度のふくらみが出てしまう)。
      const p = step.params;
      function makeLR4(type, freq) {
        const f1 = offlineCtx.createBiquadFilter(); f1.type = type; f1.frequency.value = freq; f1.Q.value = 0.7071;
        const f2 = offlineCtx.createBiquadFilter(); f2.type = type; f2.frequency.value = freq; f2.Q.value = 0.7071;
        f1.connect(f2);
        return { input: f1, output: f2 };
      }
      const lowXo = p.lowFreqHz, highXo = p.highFreqHz;

      const lowBand = makeLR4('lowpass', lowXo);
      const lowComp = offlineCtx.createDynamicsCompressor();
      lowComp.threshold.value = p.thresholdDb; lowComp.ratio.value = p.ratio;
      lowComp.attack.value = p.attackMs / 1000; lowComp.release.value = p.releaseMs / 1000; lowComp.knee.value = 6;
      node.connect(lowBand.input); lowBand.output.connect(lowComp);

      const highBand = makeLR4('highpass', highXo);
      const highComp = offlineCtx.createDynamicsCompressor();
      highComp.threshold.value = p.thresholdDb; highComp.ratio.value = p.ratio;
      highComp.attack.value = p.attackMs / 1000 / 2; highComp.release.value = p.releaseMs / 1000 / 2; highComp.knee.value = 6; // 高域は少し速め
      node.connect(highBand.input); highBand.output.connect(highComp);

      // 中域は「低域用ハイパス」+「高域用ローパス」を通してバンドパス化する
      const midHp = makeLR4('highpass', lowXo);
      const midLp = makeLR4('lowpass', highXo);
      const midComp = offlineCtx.createDynamicsCompressor();
      midComp.threshold.value = p.thresholdDb; midComp.ratio.value = p.ratio;
      midComp.attack.value = p.attackMs / 1000; midComp.release.value = p.releaseMs / 1000; midComp.knee.value = 6;
      node.connect(midHp.input); midHp.output.connect(midLp.input); midLp.output.connect(midComp);

      const sum = offlineCtx.createGain();
      lowComp.connect(sum); midComp.connect(sum); highComp.connect(sum);
      node = sum;
    } else if (step.name === 'parallelCompression') {
      // パラレルコンプレッション(ニューヨークコンプ)。原音とは別に非常に強く
      // 圧縮したコピーを作り、原音とブレンドする。強圧縮側は音の密度・パンチを
      // 足す役割に徹し、原音側はダイナミクスをそのまま保つため、
      // 単純にコンプを強くかけるより自然に「太さ」を足せる。
      const p = step.params;
      const heavyComp = offlineCtx.createDynamicsCompressor();
      heavyComp.threshold.value = p.thresholdDb; heavyComp.ratio.value = p.ratio;
      heavyComp.attack.value = p.attackMs / 1000; heavyComp.release.value = p.releaseMs / 1000; heavyComp.knee.value = 0;
      const parallelGain = offlineCtx.createGain(); parallelGain.gain.value = p.mix;
      const dryGain = offlineCtx.createGain(); dryGain.gain.value = 1;
      const sumP = offlineCtx.createGain();
      node.connect(dryGain); dryGain.connect(sumP);
      node.connect(heavyComp); heavyComp.connect(parallelGain); parallelGain.connect(sumP);
      node = sumP;
    } else if (step.name === 'gain') {
      const g = offlineCtx.createGain();
      g.gain.value = Math.pow(10, step.params.gainDb / 20);
      node.connect(g); node = g;
    } else if (step.name === 'exciter') {
      // 高域だけを取り出してサチュレーションをかけ、原音に薄く混ぜる古典的なエキサイター手法。
      const hp = offlineCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = step.params.freqHz;
      const shaper = offlineCtx.createWaveShaper(); shaper.curve = buildSaturationCurve(step.params.driveDb / 10, step.params.asymmetric);
      // 波形を歪ませる処理は原理的にサンプルレートの半分を超える倍音を生み、
      // それが折り返して(エイリアシング)元の音と無関係な濁りになる。
      // WaveShaperNodeは標準でオーバーサンプリング指定に対応しており、
      // '4x'にすると内部で4倍にアップサンプルしてから歪ませ、フィルタを
      // 通して戻すため、この折り返しノイズを大幅に減らせる。
      // エキサイターは元々高い帯域を狙って歪ませるぶん折り返しの影響が
      // 出やすいので、こちらは特に効果が大きい。
      shaper.oversample = '4x';
      const wet = offlineCtx.createGain(); wet.gain.value = step.params.mix;
      const dry = offlineCtx.createGain(); dry.gain.value = 1;
      const merge = offlineCtx.createGain();
      node.connect(dry); dry.connect(merge);
      node.connect(hp); hp.connect(shaper); shaper.connect(wet); wet.connect(merge);
      node = merge;
    } else if (step.name === 'saturation') {
      const shaper = offlineCtx.createWaveShaper(); shaper.curve = buildSaturationCurve(step.params.drive, step.params.asymmetric);
      shaper.oversample = '4x'; // 同上(エイリアシングによる濁りを防ぐ)
      node.connect(shaper); node = shaper;
    } else if (step.name === 'shortDelay') {
      const delay = offlineCtx.createDelay(0.5); delay.delayTime.value = step.params.timeMs / 1000;
      const fb = offlineCtx.createGain(); fb.gain.value = step.params.feedback;
      const wet = offlineCtx.createGain(); wet.gain.value = step.params.mix;
      const dry = offlineCtx.createGain(); dry.gain.value = 1;
      const merge = offlineCtx.createGain();
      node.connect(dry); dry.connect(merge);
      node.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(merge);
      node = merge;
    } else if (step.name === 'reverb') {
      // Room(奥行き)とPlate(きらびやかさ)を並列で混ぜる設計に刷新。
      // 単一のリバーブだけだと「奥行きは出るが煌めきがない」「明るいが平面的」
      // のどちらかに寄りがちだったため、役割を分けて両方を薄く重ねる。
      // それぞれの返り値には専用のEQ(低域ハイパス+中低域の軽いディップ)を
      // かけて、リバーブ特有の「濁り」(こもった低〜中低域の積み重なり)を
      // 削ってから混ぜる。全体の混ぜ量も従来よりは抑えめにし、
      // 「過度にやりすぎない」ことを優先する。
      const p = step.params;
      const roomConv = offlineCtx.createConvolver();
      roomConv.buffer = await buildReverbImpulse(offlineCtx, Math.max(p.decay, 0.3) * 3, p.predelayMs, 2, 'room');
      const plateConv = offlineCtx.createConvolver();
      // Plateは少し短めの減衰にして「きらめき」の質感を保ちつつ長く残らないようにする
      plateConv.buffer = await buildReverbImpulse(offlineCtx, Math.max(p.decay, 0.3) * 2, p.predelayMs, 2, 'plate');

      function makeReverbCleanupEQ(isPlate) {
        // 低域ハイパス: リバーブの低域は特に濁りの原因になりやすいため、
        // Plate(きらめき用途)はやや高めに、Room(奥行き用途)は少し低めに切る。
        const hp = offlineCtx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = isPlate ? 320 : 220; hp.Q.value = 0.7;
        // 中低域の軽いディップ: 「こもり」の中心帯域(400-600Hz付近)を少しだけ削る。
        // Plateは高域の煌めきを主役にしたいので、ここでの削りも心持ち強めにする。
        const dip = offlineCtx.createBiquadFilter();
        dip.type = 'peaking'; dip.frequency.value = 500; dip.Q.value = 1.0; dip.gain.value = isPlate ? -3.0 : -2.0;
        hp.connect(dip);
        return { input: hp, output: dip };
      }
      const roomEq = makeReverbCleanupEQ(false);
      const plateEq = makeReverbCleanupEQ(true);

      // 全体のmix予算をRoom(奥行き担当、やや多め)とPlate(きらめき担当、控えめ)に
      // 振り分ける。dryは軽くしか下げない(完全なクロスフェードにすると
      // パラレルセンドらしさが失われ、ボーカルが遠くに引っ込みすぎるため)。
      const roomGain = offlineCtx.createGain(); roomGain.gain.value = p.mix * 0.6;
      const plateGain = offlineCtx.createGain(); plateGain.gain.value = p.mix * 0.4;
      const dryGain = offlineCtx.createGain(); dryGain.gain.value = 1 - p.mix * 0.5;
      const merge = offlineCtx.createGain();

      node.connect(dryGain); dryGain.connect(merge);
      node.connect(roomConv); roomConv.connect(roomEq.input); roomEq.output.connect(roomGain); roomGain.connect(merge);
      node.connect(plateConv); plateConv.connect(plateEq.input); plateEq.output.connect(plateGain); plateGain.connect(merge);
      node = merge;
    } else if (step.name === 'thickenDelay') {
      // 「聞こえない程度」の極短マイクロディレイ。単発(フィードバック無し)・
      // 左右で少し違う時間(Haas効果の知覚しきい値を大きく下回る値)をかけ、
      // 同じチャンネルへ薄く混ぜ戻すことで、ディレイそのものには気づかれない
      // まま、倍音の強調(厚み)と左右の時間差による広がり(立体感)を得る。
      const p = step.params;
      const splitter = offlineCtx.createChannelSplitter(2);
      node.connect(splitter);

      const delayL = offlineCtx.createDelay(0.05); delayL.delayTime.value = p.timeLMs / 1000;
      const delayR = offlineCtx.createDelay(0.05); delayR.delayTime.value = p.timeRMs / 1000;
      const wetGainL = offlineCtx.createGain(); wetGainL.gain.value = p.mix;
      const wetGainR = offlineCtx.createGain(); wetGainR.gain.value = p.mix;
      splitter.connect(delayL, 0); delayL.connect(wetGainL);
      splitter.connect(delayR, 1); delayR.connect(wetGainR);

      const dryGainL = offlineCtx.createGain(); dryGainL.gain.value = 1;
      const dryGainR = offlineCtx.createGain(); dryGainR.gain.value = 1;
      splitter.connect(dryGainL, 0);
      splitter.connect(dryGainR, 1);

      const thickenMerger = offlineCtx.createChannelMerger(2);
      dryGainL.connect(thickenMerger, 0, 0); wetGainL.connect(thickenMerger, 0, 0);
      dryGainR.connect(thickenMerger, 0, 1); wetGainR.connect(thickenMerger, 0, 1);
      node = thickenMerger;
    } else if (step.name === 'ducking') {
      continue; // Vocal自身には影響しない(伴奏側で処理。combineWithInstrumental参照)
    } else if (step.name === 'stereoWiden') {
      // 以前はモノラル入力からallpass+Haasで疑似ステレオを合成していたが、
      // 今は入力が既に(元ファイル由来の)本物のステレオなので、M/S処理で
      // 「既存のL/R差分を追加で広げる」方式に変更した。これなら元の
      // ステレオ内容(既存のディレイ効果等)を壊さず、その差分を強調できる。
      const width = step.params.width;
      const splitter = offlineCtx.createChannelSplitter(2);
      node.connect(splitter);

      const midGainL = offlineCtx.createGain(); midGainL.gain.value = 0.5;
      const midGainR = offlineCtx.createGain(); midGainR.gain.value = 0.5;
      const mid = offlineCtx.createGain(); mid.gain.value = 1;
      splitter.connect(midGainL, 0); midGainL.connect(mid);
      splitter.connect(midGainR, 1); midGainR.connect(mid);

      const sideGainL = offlineCtx.createGain(); sideGainL.gain.value = 0.5;
      const sideGainRNeg = offlineCtx.createGain(); sideGainRNeg.gain.value = -0.5;
      const side = offlineCtx.createGain(); side.gain.value = 1 + width; // 既存の差分を追加で広げる量
      splitter.connect(sideGainL, 0); sideGainL.connect(side);
      splitter.connect(sideGainRNeg, 1); sideGainRNeg.connect(side);

      const merger = offlineCtx.createChannelMerger(2);
      mid.connect(merger, 0, 0); side.connect(merger, 0, 0);       // L' = Mid + Side'
      mid.connect(merger, 0, 1);
      const sideNegForR = offlineCtx.createGain(); sideNegForR.gain.value = -1;
      side.connect(sideNegForR); sideNegForR.connect(merger, 0, 1); // R' = Mid - Side'
      node = merger;
    } else if (step.name === 'limiter') {
      const comp = offlineCtx.createDynamicsCompressor();
      comp.threshold.value = step.params.ceilingDb; comp.ratio.value = 20;
      comp.attack.value = 0.001; comp.release.value = 0.1; comp.knee.value = 0;
      node.connect(comp); node = comp;
    }
  }

  node.connect(offlineCtx.destination);
  src.start();
  const rendered = await offlineCtx.startRendering();
  return rendered;
}
