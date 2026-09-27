// Reverb impulse builder, saturation curve, gain riding and the cooperative
// (yielding) mono/stereo DSP stages: expander, reverb-tail gate, click
// reduction, clip detection/repair, breath control, precision de-esser and
// compressor, finite-sample sanitising. No DOM or app state. Moved verbatim
// from the main app script in index.html; loaded before it. Uses
// spectrum-core.js, sample-dsp.js and yieldToBrowser at call time.
// リバーブの質感を3タイプで作り分ける。
// Room: 部屋の反射音を想定。密度が高く減衰が速め、吸音で高域がやや鈍る。
// Plate: 金属板を振動させる古典的なリバーブ。明るく密で滑らかな減衰。
// Hall: ホールの残響を想定。減衰がなだらかで長く、Roomほど高域は鈍らない。
const REVERB_CHARACTERS = {
  room: { exponent: 3.0, damp: 0.55 },
  plate: { exponent: 1.6, damp: 0.12 },
  hall: { exponent: 1.9, damp: 0.32 },
};
async function buildReverbImpulse(ctx, decaySec, predelayMs, numChannels, character) {
  numChannels = numChannels || 2;
  const c = REVERB_CHARACTERS[character] || REVERB_CHARACTERS.hall;
  const sr = ctx.sampleRate;
  const predelaySamples = Math.floor((predelayMs / 1000) * sr);
  // L/Rで減衰時間・プリディレイをずらすため、バッファ長は「最も長くなる側」
  // に合わせて確保する(L基準のままだとRの伸ばした分が頭打ちになり、
  // せっかくずらした減衰の違いが出なくなる)。
  const maxDecay = decaySec * 1.06;
  const maxPredelay = predelaySamples + Math.floor(sr * 0.004);
  const len = Math.floor(maxDecay * sr) + maxPredelay;
  const impulse = ctx.createBuffer(numChannels, len, sr);
  for (let ch = 0; ch < numChannels; ch++) {
    const data = impulse.getChannelData(ch);
    let lp = 0;
    // L/Rで「乱数の種が違うだけ」でなく、減衰の速さ・高域の鈍り方・
    // プリディレイも互いに少しずらす。実際の部屋でも左右の耳に届く反射音は
    // 経路長も吸音も微妙に異なるため、完全に同じ特性の残響が両耳に届くことは
    // なく、この違いこそが自然な広がりの手がかりになる。
    // (以前は乱数だけが違い、減衰カーブ・ローパス特性・長さが完全に同一
    // だったため、L/Rの相関が高く広がりが出にくかった)
    const chOffset = ch === 0 ? 0 : 1;
    const decayForCh = decaySec * (1 + chOffset * 0.06);   // Rはわずかに長く残る
    const dampForCh = Math.min(0.95, c.damp * (1 + chOffset * 0.10)); // Rはわずかに高域が鈍る
    const predelayForCh = predelaySamples + Math.floor(chOffset * sr * 0.004); // Rは4msだけ遅く始まる
    for (let i = 0; i < len; i++) {
      if (i < predelayForCh) { data[i] = 0; continue; }
      const t = (i - predelayForCh) / sr;
      if (t >= decayForCh) { data[i] = 0; continue; }
      const raw = Math.random() * 2 - 1;
      lp = lp + (raw - lp) * (1 - dampForCh); // 簡易ローパス。dampが大きいほど高域が鈍る(Room向け)
      data[i] = lp * Math.pow(1 - t / decayForCh, c.exponent);

      // D224: 長いRoom/Plate IR生成中も定期的にUIへ制御を返す。
      // 乱数生成順・減衰式・ダンピング式は変更しない。
      if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
    }
    await yieldToBrowser();
  }
  return impulse;
}

// WaveShaperNode用のサチュレーション/エキサイター曲線を作る(tanhベース)。
// Python版 dsp.saturation() の移植。
// asymmetric=trueの場合、正負の入力で異なるドライブをかけて偶数次倍音を
// 意図的に発生させる(テープ/真空管的な温かみのある歪み方に近づく)。
// falseの場合は正負対称(奇数次倍音中心、ソリッドステート的なクリーンな歪み)。
const vmSaturationCurveCache = new Map();

function buildSaturationCurve(amount, asymmetric) {
  // D253: transfer式は変更せず、WaveShaper curveを1024→8192点へ高解像度化。
  // 補間誤差を減らして、特に低Drive時の細かな波形をより滑らかにする。
  const safeAmount = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const key = `${safeAmount.toFixed(6)}|${asymmetric ? 1 : 0}`;
  const cached = vmSaturationCurveCache.get(key);
  if (cached) return cached;

  const n = 8192;
  const curve = new Float32Array(n);
  const k = 1 + safeAmount * 8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y;
    if (asymmetric) {
      const kPos = k * 1.15, kNeg = k * 0.82;
      y = x >= 0
        ? Math.tanh(x * kPos) / Math.tanh(kPos)
        : Math.tanh(x * kNeg) / Math.tanh(kNeg);
    } else {
      y = Math.tanh(x * k) / Math.tanh(k);
    }
    curve[i] = Math.max(-1, Math.min(1, y));
  }

  // 再Renderでの生成コストを抑えつつ、設定変更を繰り返しても無制限に増やさない。
  if (vmSaturationCurveCache.size >= 16) {
    const oldest = vmSaturationCurveCache.keys().next().value;
    vmSaturationCurveCache.delete(oldest);
  }
  vmSaturationCurveCache.set(key, curve);
  return curve;
}

// decideChainが出したチェーンのうち、サンプル配列への直接処理が必要なもの
// (WebAudioの標準ノードでは表現しづらいexpander/clickReduction)を先に適用する。
// renderChainを呼ぶ前に使う。
// L/Rそれぞれに独立して同じ処理を適用する(WebAudioの標準ノードでは表現しづらい
// サンプル配列への直接処理のみが対象)。あえて左右をリンクさせず完全に独立して
// 処理しているのは、既存のL/R差分(例えばステレオで作り込まれたディレイ効果)を
// そのつど検出・保持したいため——もしL+Rの合算信号から検出したゲインカーブを
// 両チャンネルへ同じように適用してしまうと、この差分そのものが均されてしまう。
// v70: 小さいフレーズだけを穏やかに持ち上げる簡易Gain Riding。
// 通常コンプのように大きい部分を押し下げるのではなく、発声中の低レベル部だけを
// 最大maxBoostDbまで持ち上げる。ノイズフロアまで持ち上げないようgateDb以下は無処理。
function applyGainRiding(samples, sr, params) {
  const out = new Float32Array(samples.length);
  const frame = Math.max(64, Math.round(sr * 0.02)); // 20ms
  const hop = Math.max(32, Math.round(sr * 0.01));   // 10ms
  const targetDb = params.targetDb ?? -20;
  const gateDb = params.gateDb ?? -42;
  const maxBoostDb = Math.min(4.0, Math.max(0, params.maxBoostDb ?? 2.5));
  const desired = new Float32Array(Math.ceil(samples.length / hop) + 1);
  for (let k=0, start=0; start<samples.length; k++, start+=hop) {
    const end=Math.min(samples.length,start+frame); let e=0;
    for(let i=start;i<end;i++) e+=samples[i]*samples[i];
    const r=Math.sqrt(e/Math.max(1,end-start)); const db=dbfs(r);
    let boost=0;
    if(db>gateDb && db<targetDb) boost=Math.min(maxBoostDb,(targetDb-db)*0.45);
    desired[k]=Math.pow(10,boost/20);
  }
  // 急な音量変化を避ける。attack/release相当の平滑化をサンプル単位で行う。
  const atk=Math.exp(-1/(sr*0.035)), rel=Math.exp(-1/(sr*0.18));
  let g=1;
  for(let i=0;i<samples.length;i++) {
    const pos=i/hop, k=Math.floor(pos), t=pos-k;
    const dg=(desired[k]||1)*(1-t)+(desired[Math.min(desired.length-1,k+1)]||1)*t;
    const c=dg>g?atk:rel; g=c*g+(1-c)*dg;
    out[i]=samples[i]*g;
  }
  return out;
}

async function applyGainRidingCooperative(samples, sr, params) {
  const out = new Float32Array(samples.length);
  const frame = Math.max(64, Math.round(sr * 0.02));
  const hop = Math.max(32, Math.round(sr * 0.01));
  const targetDb = params.targetDb ?? -20;
  const gateDb = params.gateDb ?? -42;
  const maxBoostDb = Math.min(4.0, Math.max(0, params.maxBoostDb ?? 2.5));
  const desired = new Float32Array(Math.ceil(samples.length / hop) + 1);

  let k = 0;
  for (let start = 0; start < samples.length; k++, start += hop) {
    const end = Math.min(samples.length, start + frame);
    let e = 0;
    for (let i = start; i < end; i++) e += samples[i] * samples[i];
    const r = Math.sqrt(e / Math.max(1, end - start));
    const db = dbfs(r);
    let boost = 0;
    if (db > gateDb && db < targetDb) boost = Math.min(maxBoostDb, (targetDb - db) * 0.45);
    desired[k] = Math.pow(10, boost / 20);

    if ((k & 127) === 0 && k > 0) await yieldToBrowser();
  }

  const atk = Math.exp(-1 / (sr * 0.035));
  const rel = Math.exp(-1 / (sr * 0.18));
  let g = 1;

  for (let i = 0; i < samples.length; i++) {
    const pos = i / hop;
    const ki = Math.floor(pos);
    const t = pos - ki;
    const dg = (desired[ki] || 1) * (1 - t)
      + (desired[Math.min(desired.length - 1, ki + 1)] || 1) * t;
    const c = dg > g ? atk : rel;
    g = c * g + (1 - c) * dg;
    out[i] = samples[i] * g;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  return out;
}

async function applyGainRidingStereoCooperative(left, right, sr, params) {
  // D263: Gain RidingをStereo-link化。
  // 左右を別々に持ち上げるのではなく、強い側を基準に共通Gainを作ることで
  // 小声区間でも定位・ステレオ幅を維持する。
  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const frame = Math.max(64, Math.round(sr * 0.02));
  const hop = Math.max(32, Math.round(sr * 0.01));
  const targetDb = params.targetDb ?? -20;
  const gateDb = params.gateDb ?? -42;
  const maxBoostDb = Math.min(4.0, Math.max(0, params.maxBoostDb ?? 2.5));
  const desired = new Float32Array(Math.ceil(n / hop) + 1);

  let k = 0;
  for (let start = 0; start < n; k++, start += hop) {
    const end = Math.min(n, start + frame);
    let eL = 0, eR = 0;
    for (let i = start; i < end; i++) {
      eL += left[i] * left[i];
      eR += right[i] * right[i];
    }
    const denom = Math.max(1, end - start);
    const rL = Math.sqrt(eL / denom);
    const rR = Math.sqrt(eR / denom);
    const linkedRms = Math.max(rL, rR);
    const db = dbfs(linkedRms);

    let boost = 0;
    if (db > gateDb && db < targetDb) {
      boost = Math.min(maxBoostDb, (targetDb - db) * 0.45);
    }
    desired[k] = Math.pow(10, boost / 20);

    if ((k & 127) === 0 && k > 0) await yieldToBrowser();
  }

  const atk = Math.exp(-1 / (sr * 0.035));
  const rel = Math.exp(-1 / (sr * 0.18));
  let g = 1;

  for (let i = 0; i < n; i++) {
    const pos = i / hop;
    const ki = Math.floor(pos);
    const t = pos - ki;
    const dg = (desired[ki] || 1) * (1 - t)
      + (desired[Math.min(desired.length - 1, ki + 1)] || 1) * t;
    const c = dg > g ? atk : rel;
    g = c * g + (1 - c) * dg;

    outL[i] = left[i] * g;
    outR[i] = right[i] * g;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}




async function applyExpanderCooperative(samples, sr, thresholdDb, ratio, attackMs, releaseMs) {
  const attack = Math.exp(-1 / (sr * attackMs / 1000));
  const release = Math.exp(-1 / (sr * releaseMs / 1000));
  const out = new Float32Array(samples.length);
  let level = 0;
  const thresholdLin = Math.pow(10, thresholdDb / 20);

  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i]);
    const coef = absVal > level ? attack : release;
    level = coef * level + (1 - coef) * absVal;
    let gain = 1;
    if (level < thresholdLin && level > 1e-9) {
      gain = Math.pow(level / thresholdLin, ratio - 1);
    }
    out[i] = samples[i] * gain;
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return out;
}

async function applyExpanderStereoCooperative(left, right, sr, thresholdDb, ratio, attackMs, releaseMs) {
  // D261: ExpanderをStereo-link化。
  // 片側のノイズ/息だけで左右別々にゲインが動くのを避け、
  // 小音量部でもセンター定位とステレオ幅を保ちやすくする。
  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const attack = Math.exp(-1 / (sr * attackMs / 1000));
  const release = Math.exp(-1 / (sr * releaseMs / 1000));
  const thresholdLin = Math.pow(10, thresholdDb / 20);

  let level = 0;
  let gain = 1;

  for (let i = 0; i < n; i++) {
    const absVal = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const coef = absVal > level ? attack : release;
    level = coef * level + (1 - coef) * absVal;

    let targetGain = 1;
    if (level < thresholdLin && level > 1e-9) {
      targetGain = Math.pow(level / thresholdLin, ratio - 1);
    }

    // detector envelope already smooths movement; share one gain across both channels.
    gain = targetGain;
    outL[i] = left[i] * gain;
    outR[i] = right[i] * gain;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}


async function applyReverbTailGateCooperative(samples, sr, opts) {
  opts = opts || {};
  const thresholdDropDb = opts.thresholdDropDb != null ? opts.thresholdDropDb : 14;
  const reduceTo = opts.reduceTo != null ? opts.reduceTo : 0.35;
  const attackMs = opts.attackMs != null ? opts.attackMs : 3;
  const releaseMs = opts.releaseMs != null ? opts.releaseMs : 120;

  const fastAttack = Math.exp(-1 / (sr * 0.002));
  const fastRelease = Math.exp(-1 / (sr * 0.03));
  const peakDecay = Math.exp(-1 / (sr * 0.4));
  const gateAttack = Math.exp(-1 / (sr * (attackMs / 1000)));
  const gateRelease = Math.exp(-1 / (sr * (releaseMs / 1000)));

  const out = new Float32Array(samples.length);
  let fastEnv = 0, peakRef = 0, gain = 1;

  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    const cf = a > fastEnv ? fastAttack : fastRelease;
    fastEnv = cf * fastEnv + (1 - cf) * a;
    if (fastEnv > peakRef) peakRef = fastEnv;
    else peakRef = peakDecay * peakRef + (1 - peakDecay) * fastEnv;

    const dropDb = dbfs(peakRef) - dbfs(fastEnv);
    const targetGain = dropDb > thresholdDropDb ? reduceTo : 1;
    const c = targetGain < gain ? gateAttack : gateRelease;
    gain = c * gain + (1 - c) * targetGain;
    out[i] = samples[i] * gain;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return out;
}

async function applyReverbTailGateStereoCooperative(left, right, sr, opts) {
  // D265: Reverb Tail GateをStereo-link化。
  // 左右別々にtail判定すると、語尾や残響の広がりが片側だけ早く閉じることがあるため、
  // 共通envelope / peak reference / gainで両chを同時に処理する。
  opts = opts || {};
  const thresholdDropDb = opts.thresholdDropDb != null ? opts.thresholdDropDb : 14;
  const reduceTo = opts.reduceTo != null ? opts.reduceTo : 0.35;
  const attackMs = opts.attackMs != null ? opts.attackMs : 3;
  const releaseMs = opts.releaseMs != null ? opts.releaseMs : 120;

  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const fastAttack = Math.exp(-1 / (sr * 0.002));
  const fastRelease = Math.exp(-1 / (sr * 0.03));
  const peakDecay = Math.exp(-1 / (sr * 0.4));
  const gateAttack = Math.exp(-1 / (sr * (attackMs / 1000)));
  const gateRelease = Math.exp(-1 / (sr * (releaseMs / 1000)));

  let fastEnv = 0, peakRef = 0, gain = 1;

  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const cf = a > fastEnv ? fastAttack : fastRelease;
    fastEnv = cf * fastEnv + (1 - cf) * a;

    if (fastEnv > peakRef) peakRef = fastEnv;
    else peakRef = peakDecay * peakRef + (1 - peakDecay) * fastEnv;

    const dropDb = dbfs(peakRef) - dbfs(fastEnv);
    const targetGain = dropDb > thresholdDropDb ? reduceTo : 1;
    const c = targetGain < gain ? gateAttack : gateRelease;
    gain = c * gain + (1 - c) * targetGain;

    outL[i] = left[i] * gain;
    outR[i] = right[i] * gain;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}


async function applyClickReductionCooperative(samples, sr) {
  const windowSize = Math.max(1, Math.round(sr * 0.002));
  const out = samples.slice();
  let reducedCount = 0;

  for (let i = windowSize; i < samples.length - windowSize - 1; i++) {
    const diffIn = Math.abs(samples[i] - samples[i - 1]);
    const diffOut = Math.abs(samples[i + 1] - samples[i]);
    const localAvg = (Math.abs(samples[i - windowSize]) + Math.abs(samples[i + windowSize])) / 2;

    if (diffIn > 0.45 && diffOut > 0.3 && diffIn > localAvg * 10 + 0.05) {
      for (let k = -windowSize; k <= windowSize; k++) {
        const idx = i + k;
        if (idx < 0 || idx >= out.length) continue;
        const w = 1 - Math.abs(k) / windowSize;
        out[idx] *= (1 - 0.6 * w);
      }
      reducedCount++;
    }

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  return { samples: out, reducedCount };
}

async function applyClickReductionStereoCooperative(left, right, sr) {
  const n=Math.min(left.length,right.length);
  const windowSize=Math.max(1,Math.round(sr*0.002));
  const outL=left.slice(),outR=right.slice();
  let reducedCount=0;

  for(let i=windowSize;i<n-windowSize-1;i++){
    const diL=Math.abs(left[i]-left[i-1]),doL=Math.abs(left[i+1]-left[i]),laL=(Math.abs(left[i-windowSize])+Math.abs(left[i+windowSize]))/2;
    const diR=Math.abs(right[i]-right[i-1]),doR=Math.abs(right[i+1]-right[i]),laR=(Math.abs(right[i-windowSize])+Math.abs(right[i+windowSize]))/2;
    const clickL=diL>0.45&&doL>0.3&&diL>laL*10+0.05;
    const clickR=diR>0.45&&doR>0.3&&diR>laR*10+0.05;
    if(clickL||clickR){
      for(let k=-windowSize;k<=windowSize;k++){
        const idx=i+k;if(idx<0||idx>=n)continue;
        const w=1-Math.abs(k)/windowSize,gain=1-0.6*w;
        outL[idx]*=gain;outR[idx]*=gain;
      }
      reducedCount++;
      i+=Math.max(1,Math.floor(windowSize/2));
    }
    if((i&131071)===0&&i>0)await yieldToBrowser();
  }
  return{left:outL,right:outR,reducedCount};
}


async function detectClippingCooperative(samples, opts) {
  opts = opts || {};
  const threshold = opts.threshold != null ? opts.threshold : 0.985;
  const minRun = opts.minRun != null ? opts.minRun : 3;
  const runs = [];
  let i = 0;
  let clippedSamples = 0;

  while (i < samples.length) {
    if (Math.abs(samples[i]) >= threshold) {
      const sign = samples[i] >= 0 ? 1 : -1;
      let j = i;
      while (j < samples.length &&
             Math.abs(samples[j]) >= threshold &&
             (samples[j] >= 0 ? 1 : -1) === sign) {
        j++;
        if ((j & 131071) === 0) await yieldToBrowser();
      }
      if (j - i >= minRun) {
        runs.push({ start: i, end: j, sign });
        clippedSamples += j - i;
      }
      i = j;
    } else {
      i++;
    }

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  return { runs, clippedRatio: samples.length ? clippedSamples / samples.length : 0 };
}

async function repairClippingCooperative(samples, opts) {
  opts = opts || {};
  const maxRun = opts.maxRunSamples != null ? opts.maxRunSamples : 220;
  const { runs } = await detectClippingCooperative(samples, opts);
  const out = samples.slice();
  let repaired = 0, skipped = 0;

  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
    const len = r.end - r.start;
    if (len > maxRun) { skipped++; continue; }
    const i0 = r.start - 1, i1 = r.end;
    if (i0 < 1 || i1 >= samples.length - 1) continue;
    const y0 = samples[i0], y1 = samples[i1];
    const d0 = y0 - samples[i0 - 1];
    const peakEstimate = Math.abs(y0) + Math.abs(d0) * (len / 2);
    const peakAbs = Math.min(peakEstimate, Math.abs(y0) * 1.6);

    for (let k = 0; k < len; k++) {
      const t = (k + 1) / (len + 1);
      const bump = Math.sin(Math.PI * t);
      const linear = y0 + (y1 - y0) * t;
      out[r.start + k] = linear + r.sign * (peakAbs - Math.abs(y0)) * bump;
    }
    repaired++;

    if ((ri & 127) === 0 && ri > 0) await yieldToBrowser();
  }

  return { samples: out, repairedRuns: repaired, skippedRuns: skipped };
}

async function repairClippingStereoCooperative(left, right, opts) {
  opts = opts || {};
  const threshold = opts.threshold != null ? opts.threshold : 0.985;
  const minRun = opts.minRun != null ? opts.minRun : 3;
  const maxRun = opts.maxRunSamples != null ? opts.maxRunSamples : 220;

  const n = Math.min(left.length, right.length);
  const outL = left.slice();
  const outR = right.slice();

  // D277: run object配列を作らず、検出したrunをその場で修復。
  // heavily-clippedな長尺音源でallocation/GCを抑える。
  let i = 0;
  let repairedL = 0, repairedR = 0, skippedRuns = 0;

  function repairOneChannel(source, out, start, end) {
    const len = end - start;
    const i0 = start - 1, i1 = end;
    if (len > maxRun || i0 < 1 || i1 >= source.length - 1) return false;

    const y0 = source[i0], y1 = source[i1];
    const d0 = y0 - source[i0 - 1];
    const sign = Math.abs(source[start]) >= threshold
      ? (source[start] >= 0 ? 1 : -1)
      : (y0 >= 0 ? 1 : -1);

    const peakEstimate = Math.abs(y0) + Math.abs(d0) * (len / 2);
    const peakAbs = Math.min(peakEstimate, Math.max(Math.abs(y0), 1e-6) * 1.6);

    for (let k = 0; k < len; k++) {
      const t = (k + 1) / (len + 1);
      const bump = Math.sin(Math.PI * t);
      const linear = y0 + (y1 - y0) * t;
      out[start + k] = linear + sign * (peakAbs - Math.abs(y0)) * bump;
    }
    return true;
  }

  while (i < n) {
    const clipL = Math.abs(left[i]) >= threshold;
    const clipR = Math.abs(right[i]) >= threshold;

    if (clipL || clipR) {
      let j = i;
      let lCount = 0, rCount = 0;

      while (j < n && (Math.abs(left[j]) >= threshold || Math.abs(right[j]) >= threshold)) {
        if (Math.abs(left[j]) >= threshold) lCount++;
        if (Math.abs(right[j]) >= threshold) rCount++;
        j++;
        if ((j & 131071) === 0) await yieldToBrowser();
      }

      if (j - i >= minRun) {
        let repairedAny = false;

        if (lCount >= minRun && repairOneChannel(left, outL, i, j)) {
          repairedL++;
          repairedAny = true;
        }
        if (rCount >= minRun && repairOneChannel(right, outR, i, j)) {
          repairedR++;
          repairedAny = true;
        }
        if (!repairedAny) skippedRuns++;
      }

      i = j;
    } else {
      i++;
    }

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  return {
    left: outL,
    right: outR,
    repairedRunsL: repairedL,
    repairedRunsR: repairedR,
    skippedRuns
  };
}


async function detectAndReduceBreathsCooperative(samples, sr, opts) {
  opts = opts || {};
  const zcrThreshold = opts.zcrThreshold != null ? opts.zcrThreshold : 0.15;
  const rmsMinDb = opts.rmsMinDb != null ? opts.rmsMinDb : -45;
  const rmsMaxDb = opts.rmsMaxDb != null ? opts.rmsMaxDb : -18;
  const tooLoudDb = opts.tooLoudDb != null ? opts.tooLoudDb : -20;
  const reduceTo = opts.reduceTo != null ? opts.reduceTo : 0.45;

  const frameSize = Math.round(sr * 0.03), hop = Math.round(sr * 0.015);
  const frames = [];
  let frameNo = 0;

  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    let sumSq = 0, zc = 0;
    for (let i = start; i < start + frameSize; i++) {
      sumSq += samples[i] * samples[i];
      if (i > start && (samples[i] >= 0) !== (samples[i - 1] >= 0)) zc++;
    }
    frames.push({ start, rms: Math.sqrt(sumSq / frameSize), zcr: zc / frameSize });
    frameNo++;
    if ((frameNo & 127) === 0) await yieldToBrowser();
  }

  const out = samples.slice();
  let reducedCount = 0;
  let i = 0;

  while (i < frames.length) {
    const db0 = dbfs(frames[i].rms);
    const isCandidate = frames[i].zcr > zcrThreshold && db0 > rmsMinDb && db0 < rmsMaxDb;

    if (isCandidate) {
      let j = i, maxDb = db0;
      while (j < frames.length) {
        const dbj = dbfs(frames[j].rms);
        if (frames[j].zcr <= zcrThreshold || dbj <= rmsMinDb || dbj >= rmsMaxDb + 6) break;
        maxDb = Math.max(maxDb, dbj);
        j++;
      }

      if (maxDb > tooLoudDb) {
        const segStart = frames[i].start;
        const segEnd = Math.min(samples.length, frames[j - 1].start + frameSize);
        const fadeLen = Math.max(1, Math.round(sr * 0.01));
        for (let k = segStart; k < segEnd; k++) {
          const distStart = k - segStart, distEnd = segEnd - k;
          const fadeFactor = Math.max(0, Math.min(1, Math.min(distStart, distEnd) / fadeLen));
          out[k] *= 1 - (1 - reduceTo) * fadeFactor;
          if ((k & 131071) === 0 && k > segStart) await yieldToBrowser();
        }
        reducedCount++;
      }
      i = j > i ? j : i + 1;
    } else {
      i++;
    }

    if ((i & 127) === 0 && i > 0) await yieldToBrowser();
  }

  return { samples: out, reducedCount };
}

async function detectAndReduceBreathsStereoCooperative(left, right, sr, opts) {
  opts = opts || {};
  const zcrThreshold = opts.zcrThreshold != null ? opts.zcrThreshold : 0.15;
  const rmsMinDb = opts.rmsMinDb != null ? opts.rmsMinDb : -45;
  const rmsMaxDb = opts.rmsMaxDb != null ? opts.rmsMaxDb : -18;
  const tooLoudDb = opts.tooLoudDb != null ? opts.tooLoudDb : -20;
  const reduceTo = opts.reduceTo != null ? opts.reduceTo : 0.45;

  const n = Math.min(left.length, right.length);
  const frameSize = Math.round(sr * 0.03), hop = Math.round(sr * 0.015);

  // D271: object配列をやめ、必要な3項目だけTypedArrayへ保持。
  // 長尺音源でGC負荷とメモリ断片化を減らす。判定式自体はD267と同じ。
  const frameCount = Math.max(0, Math.floor((n - frameSize) / hop) + 1);
  const starts = new Uint32Array(frameCount);
  const rmsValues = new Float32Array(frameCount);
  const zcrValues = new Float32Array(frameCount);

  let frameNo = 0;
  for (let start = 0; start + frameSize <= n; start += hop) {
    let sumSqL = 0, sumSqR = 0, zcL = 0, zcR = 0;
    for (let i = start; i < start + frameSize; i++) {
      const l = left[i], r = right[i];
      sumSqL += l*l; sumSqR += r*r;
      if (i > start) {
        if ((left[i] >= 0) !== (left[i-1] >= 0)) zcL++;
        if ((right[i] >= 0) !== (right[i-1] >= 0)) zcR++;
      }
    }
    starts[frameNo] = start;
    rmsValues[frameNo] = Math.max(
      Math.sqrt(sumSqL/frameSize), Math.sqrt(sumSqR/frameSize)
    );
    zcrValues[frameNo] = Math.max(zcL,zcR)/frameSize;
    frameNo++;
    if ((frameNo & 127) === 0) await yieldToBrowser();
  }

  const outL = left.slice(), outR = right.slice();
  let reducedCount = 0, i = 0;

  while (i < frameNo) {
    const db0 = dbfs(rmsValues[i]);
    const isCandidate = zcrValues[i] > zcrThreshold && db0 > rmsMinDb && db0 < rmsMaxDb;
    if (isCandidate) {
      let j = i, maxDb = db0;
      while (j < frameNo) {
        const dbj = dbfs(rmsValues[j]);
        if (zcrValues[j] <= zcrThreshold || dbj <= rmsMinDb || dbj >= rmsMaxDb + 6) break;
        maxDb = Math.max(maxDb, dbj);
        j++;
      }
      if (maxDb > tooLoudDb) {
        const segStart = starts[i];
        const segEnd = Math.min(n, starts[j-1] + frameSize);
        const fadeLen = Math.max(1, Math.round(sr*0.01));
        for (let k=segStart; k<segEnd; k++) {
          const distStart=k-segStart, distEnd=segEnd-k;
          const fadeFactor=Math.max(0,Math.min(1,Math.min(distStart,distEnd)/fadeLen));
          const gain=1-(1-reduceTo)*fadeFactor;
          outL[k]*=gain; outR[k]*=gain;
          if ((k & 131071) === 0 && k > segStart) await yieldToBrowser();
        }
        reducedCount++;
      }
      i = j > i ? j : i + 1;
    } else i++;
    if ((i & 127) === 0 && i > 0) await yieldToBrowser();
  }
  return { left:outL, right:outR, reducedCount };
}



// D243: deterministic sample-domain Precision De-Esser.
// 歯擦音帯域をsidechainとして検出し、その瞬間だけ全帯域を短時間だけ減衰する
// broadband de-essing方式。位相差のある高域差分合成を避けるため、Android/iPhoneで
// ブラウザ実装差が出にくく、サ行/シ/チ等の鋭い瞬間を自然に抑えやすい。
const vmPrecisionDeEsserApplied = new WeakSet();

function vmCompressorGainDbSoftKnee(levelDb, thresholdDb, ratio, kneeDb) {
  const safeRatio = Math.max(1.0, ratio || 1.0);
  const knee = Math.max(0, kneeDb || 0);
  const x = levelDb - thresholdDb;

  if (knee <= 0) {
    if (x <= 0) return 0;
    return -(x * (1 - 1 / safeRatio));
  }

  const half = knee / 2;
  if (x <= -half) return 0;
  if (x >= half) return -(x * (1 - 1 / safeRatio));

  const y = x + half;
  return -((1 - 1 / safeRatio) * y * y / (2 * knee));
}

async function applyPrecisionDeEsserStereoCooperative(left, right, sr, params) {
  params = params || {};
  const freqHz = Math.max(3500, Math.min(sr * 0.45, params.freqHz || 6500));
  const thresholdDb = Number.isFinite(params.thresholdDb) ? params.thresholdDb : -26;
  const ratio = Math.max(1, Number.isFinite(params.ratio) ? params.ratio : 4);
  const kneeDb = 4;
  const maxReductionDb = 9;

  const detL = await biquadHighpassCooperative(left, sr, freqHz, 0.7071);
  await yieldToBrowser();
  const detR = await biquadHighpassCooperative(right, sr, freqHz, 0.7071);

  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  const envAttack = Math.exp(-1 / (sr * 0.0007));
  const envRelease = Math.exp(-1 / (sr * 0.035));
  const fullAttack = Math.exp(-1 / (sr * 0.0012));
  const fullRelease = Math.exp(-1 / (sr * 0.050));
  const gainAttack = Math.exp(-1 / (sr * 0.0006));
  const gainRelease = Math.exp(-1 / (sr * 0.040));

  const ratioStart = 0.16;
  const ratioFull = 0.34;

  let env = 0, fullEnv = 0, gain = 1;

  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(detL[i]), Math.abs(detR[i]));
    const ec = a > env ? envAttack : envRelease;
    env = ec * env + (1 - ec) * a;

    const fullA = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const fc = fullA > fullEnv ? fullAttack : fullRelease;
    fullEnv = fc * fullEnv + (1 - fc) * fullA;

    const levelDb = 20 * Math.log10(Math.max(env, 1e-12));
    let reductionDb = vmCompressorGainDbSoftKnee(levelDb, thresholdDb, ratio, kneeDb);
    reductionDb = Math.max(-maxReductionDb, reductionDb);

    const spectralRatio = fullEnv > 1e-9 ? env / fullEnv : 0;
    const selectivity = Math.max(0, Math.min(1,
      (spectralRatio - ratioStart) / Math.max(1e-6, ratioFull - ratioStart)
    ));

    const targetGain = Math.pow(10, (reductionDb * selectivity) / 20);
    const gc = targetGain < gain ? gainAttack : gainRelease;
    gain = gc * gain + (1 - gc) * targetGain;

    outL[i] = left[i] * gain;
    outR[i] = right[i] * gain;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}


// D247: deterministic sample-domain vocal compressor.
// WebAudio DynamicsCompressorNodeの実装差を避けつつ、既存設定
// thresholdDb / ratio / attackMs / releaseMs をそのまま利用する。
const vmPrecisionCompressorApplied = new WeakSet();

function vmCompressorGainDb(levelDb, thresholdDb, ratio, kneeDb) {
  const safeRatio = Math.max(1, ratio || 1);
  const knee = Math.max(0, kneeDb || 0);
  const x = levelDb - thresholdDb;

  if (knee <= 0) {
    if (x <= 0) return 0;
    return -(x * (1 - 1 / safeRatio));
  }

  const half = knee / 2;
  if (x <= -half) return 0;
  if (x >= half) return -(x * (1 - 1 / safeRatio));

  const y = x + half;
  return -((1 - 1 / safeRatio) * y * y / (2 * knee));
}

async function applyPrecisionCompressorStereoCooperative(left, right, sr, params) {
  params = params || {};
  const thresholdDb = Number.isFinite(params.thresholdDb) ? params.thresholdDb : -18;
  const ratio = Math.max(1, Number.isFinite(params.ratio) ? params.ratio : 3);
  const attackMs = Math.max(0.2, Number.isFinite(params.attackMs) ? params.attackMs : 8);
  const releaseMs = Math.max(10, Number.isFinite(params.releaseMs) ? params.releaseMs : 120);

  const n = Math.min(left.length, right.length);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);

  // D249: D248のdeterministic compressorを、従来WebAudio版と同じ
  // 2段構成へ拡張。Stage 1でピークを軽く整え、Stage 2で全体をまとめる。
  // どちらもStereo-linkedで、L/R定位を動かさない。
  const s1ThresholdDb = thresholdDb + 4;
  const s1Ratio = Math.min(2.5, ratio);
  const s1AttackMs = 2;
  const s1ReleaseMs = Math.max(50, releaseMs * 0.6);
  const s1KneeDb = 6;

  const s2ThresholdDb = thresholdDb;
  const s2Ratio = ratio;
  const s2AttackMs = attackMs;
  const s2ReleaseMs = releaseMs;
  const s2KneeDb = 8;

  const detAttack = Math.exp(-1 / (sr * 0.0015));
  const detRelease = Math.exp(-1 / (sr * 0.060));

  // D251: Stage 1はPeak detectorのまま瞬間的な飛び出しを捕まえ、
  // Stage 2だけRMS detectorへ変更。母音の平均エネルギーを見てまとめるため、
  // 声の細かい波形ピークに過剰反応しにくく、息遣いと子音を残しやすい。
  const rmsAttack = Math.exp(-1 / (sr * 0.010));
  const rmsRelease = Math.exp(-1 / (sr * 0.090));

  const s1GainAttack = Math.exp(-1 / (sr * (s1AttackMs / 1000)));
  const s1GainRelease = Math.exp(-1 / (sr * (s1ReleaseMs / 1000)));
  const s2GainAttack = Math.exp(-1 / (sr * (s2AttackMs / 1000)));
  const s2GainRelease = Math.exp(-1 / (sr * (s2ReleaseMs / 1000)));

  let env1 = 0;
  let rmsPower2 = 0;
  let gain1 = 1, gain2 = 1;

  for (let i = 0; i < n; i++) {
    const det1 = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const e1c = det1 > env1 ? detAttack : detRelease;
    env1 = e1c * env1 + (1 - e1c) * det1;

    const level1Db = 20 * Math.log10(Math.max(env1, 1e-12));
    const gain1Db = vmCompressorGainDb(level1Db, s1ThresholdDb, s1Ratio, s1KneeDb);
    const targetGain1 = Math.pow(10, gain1Db / 20);
    const g1c = targetGain1 < gain1 ? s1GainAttack : s1GainRelease;
    gain1 = g1c * gain1 + (1 - g1c) * targetGain1;

    const stage1L = left[i] * gain1;
    const stage1R = right[i] * gain1;

    // Stereo-linked RMS detector。左右の大きい側のpowerを基準にするので定位は動かない。
    const power2 = Math.max(stage1L * stage1L, stage1R * stage1R);
    const rc = power2 > rmsPower2 ? rmsAttack : rmsRelease;
    rmsPower2 = rc * rmsPower2 + (1 - rc) * power2;
    const rms2 = Math.sqrt(Math.max(rmsPower2, 1e-24));

    const level2Db = 20 * Math.log10(Math.max(rms2, 1e-12));
    const gain2Db = vmCompressorGainDb(level2Db, s2ThresholdDb, s2Ratio, s2KneeDb);
    const targetGain2 = Math.pow(10, gain2Db / 20);
    const g2c = targetGain2 < gain2 ? s2GainAttack : s2GainRelease;
    gain2 = g2c * gain2 + (1 - g2c) * targetGain2;

    outL[i] = stage1L * gain2;
    outR[i] = stage1R * gain2;

    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }

  if (left.length > n) outL.set(left.subarray(n), n);
  if (right.length > n) outR.set(right.subarray(n), n);

  return { left: outL, right: outR };
}

async function sanitizeStereoFiniteCooperative(left, right) {
  // D275: custom DSP後のNaN/Infinity伝播を防ぐ安全網。
  // 正常な有限sampleは変更しない。
  const n = Math.min(left.length, right.length);
  let repaired = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(left[i])) { left[i] = 0; repaired++; }
    if (!Number.isFinite(right[i])) { right[i] = 0; repaired++; }
    if ((i & 131071) === 0 && i > 0) await yieldToBrowser();
  }
  for (let i=n;i<left.length;i++) if (!Number.isFinite(left[i])) { left[i]=0; repaired++; }
  for (let i=n;i<right.length;i++) if (!Number.isFinite(right[i])) { right[i]=0; repaired++; }
  if (repaired > 0) console.warn('[preprocess-safety/nonfinite-repaired]', repaired);
  return repaired;
}
