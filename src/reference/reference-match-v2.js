// Reference matching v2 (opt-in). Design follows Matchering's ideas, written
// from scratch (no Matchering code): compare only the loudest sections, treat
// Mid and Side separately, smooth the spectral difference in log frequency, and
// correct it with linear-phase FIRs so the applied response equals the smoothed
// difference instead of a sum of overlapping peaking filters.
//
// Uses src/analysis/spectrum-core.js (createSpectrumWorkspace,
// magnitudeSpectrumInto), and audioCtx / yieldToBrowser from the app script at
// call time.

const VM_REF2 = Object.freeze({
  pieceSeconds: 3,          // analysis section length
  loudestFraction: 0.5,     // keep the loudest half of the sections
  maxPieces: 20,            // at most 60 s of audio per track
  frameSize: 4096,
  hop: 2048,
  gridPointsPerOctave: 6,   // difference curve resolution
  smoothOctaves: 1 / 3,     // width of the log-frequency smoothing window
  matchLoHz: 40,            // corrections fade to 0 dB outside 40 Hz-16 kHz
  matchHiHz: 16000,
  levelLoHz: 100,           // overall level offset measured over 100 Hz-10 kHz
  levelHiHz: 10000,
  maxCorrectionDb: 6,       // same per-frequency cap as v1
  sideFloorDb: -50,         // no Side correction where Side is this far below Mid
  firTaps: 4095
});

function vmRef2GridHz(sr) {
  const hi = Math.min(sr / 2, 22000);
  const out = [];
  for (let f = 20; f <= hi; f *= 2 ** (1 / VM_REF2.gridPointsPerOctave)) out.push(f);
  return Float64Array.from(out);
}

// Mean power spectra of Mid and Side over the loudest sections of a buffer.
async function vmRef2SectionSpectra(buffer, shouldCancel) {
  const sr = buffer.sampleRate, n = buffer.length;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const pieceLen = Math.max(VM_REF2.frameSize, Math.round(VM_REF2.pieceSeconds * sr));
  const pieces = [];
  for (let start = 0; start + VM_REF2.frameSize <= n; start += pieceLen) {
    const end = Math.min(n, start + pieceLen);
    let sum = 0;
    for (let i = start; i < end; i++) { const m = (left[i] + right[i]) * 0.5; sum += m * m; }
    pieces.push({ start, end, power: sum / (end - start) });
  }
  if (!pieces.length) throw new Error('リファレンス分析には最低でも約0.1秒の音声が必要です');
  pieces.sort((a, b) => b.power - a.power);
  const keep = Math.max(1, Math.min(VM_REF2.maxPieces, Math.round(pieces.length * VM_REF2.loudestFraction)));
  const chosen = pieces.slice(0, keep).filter(p => p.power > 0);
  if (!chosen.length) throw new Error('無音の音源はリファレンス分析できません');

  const size = VM_REF2.frameSize, half = size / 2;
  const workspace = createSpectrumWorkspace(size, sr);
  const mid = new Float32Array(size), side = new Float32Array(size);
  const midPow = new Float64Array(half), sidePow = new Float64Array(half);
  let frames = 0;
  for (const piece of chosen) {
    for (let start = piece.start; start + size <= piece.end; start += VM_REF2.hop) {
      for (let i = 0; i < size; i++) {
        const l = left[start + i], r = right[start + i];
        mid[i] = (l + r) * 0.5; side[i] = (l - r) * 0.5;
      }
      let mag = magnitudeSpectrumInto(mid, workspace);
      for (let k = 0; k < half; k++) midPow[k] += mag[k] * mag[k];
      mag = magnitudeSpectrumInto(side, workspace);
      for (let k = 0; k < half; k++) sidePow[k] += mag[k] * mag[k];
      frames++;
    }
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('reference analysis cancelled');
      err.code = 'VM_REFERENCE_ANALYSIS_CANCELLED';
      throw err;
    }
    await yieldToBrowser();
  }
  for (let k = 0; k < half; k++) { midPow[k] /= frames; sidePow[k] /= frames; }
  return { sr, binHz: sr / size, midPow, sidePow, frames, pieces: chosen.length, totalPieces: pieces.length };
}

// Band power (dB) around each grid frequency, one grid step wide.
function vmRef2GridDb(pow, binHz, grid) {
  const step = 2 ** (1 / (2 * VM_REF2.gridPointsPerOctave));
  const out = new Float64Array(grid.length);
  for (let g = 0; g < grid.length; g++) {
    const lo = Math.max(1, Math.floor(grid[g] / step / binHz));
    const hi = Math.max(lo, Math.min(pow.length - 1, Math.ceil(grid[g] * step / binHz)));
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += pow[k];
    out[g] = 10 * Math.log10(Math.max(sum / (hi - lo + 1), 1e-20));
  }
  return out;
}

function vmRef2Smooth(curve, grid) {
  const halfWidth = VM_REF2.smoothOctaves / 2;
  const out = new Float64Array(curve.length);
  for (let g = 0; g < curve.length; g++) {
    let sum = 0, weight = 0;
    for (let j = 0; j < curve.length; j++) {
      const d = Math.abs(Math.log2(grid[j] / grid[g]));
      if (d > halfWidth * 2) continue;
      const w = 1 - d / (halfWidth * 2); // triangular window, 1/3 octave FWHM
      sum += w * curve[j]; weight += w;
    }
    out[g] = sum / weight;
  }
  return out;
}

// 1 inside [matchLoHz, matchHiHz], fading to 0 over one octave outside.
function vmRef2BandWeight(f) {
  if (f < VM_REF2.matchLoHz) return Math.max(0, 1 - Math.log2(VM_REF2.matchLoHz / f));
  if (f > VM_REF2.matchHiHz) return Math.max(0, 1 - Math.log2(f / VM_REF2.matchHiHz));
  return 1;
}

function vmRef2Clamp(v) {
  return Math.max(-VM_REF2.maxCorrectionDb, Math.min(VM_REF2.maxCorrectionDb, v));
}

// Correction curves (dB on a log grid) that move `current` towards `reference`.
async function analyzeReferenceMatchV2(referenceBuffer, currentBuffer, shouldCancel) {
  const sr = currentBuffer.sampleRate;
  const grid = vmRef2GridHz(sr);
  const ref = await vmRef2SectionSpectra(referenceBuffer, shouldCancel);
  const cur = await vmRef2SectionSpectra(currentBuffer, shouldCancel);
  const refMid = vmRef2GridDb(ref.midPow, ref.binHz, grid), curMid = vmRef2GridDb(cur.midPow, cur.binHz, grid);
  const refSide = vmRef2GridDb(ref.sidePow, ref.binHz, grid), curSide = vmRef2GridDb(cur.sidePow, cur.binHz, grid);

  // Remove the overall level difference (measured on Mid) so only the tonal
  // balance is matched, as in v1.
  let offset = 0, count = 0;
  for (let g = 0; g < grid.length; g++) {
    if (grid[g] >= VM_REF2.levelLoHz && grid[g] <= VM_REF2.levelHiHz) { offset += refMid[g] - curMid[g]; count++; }
  }
  offset /= Math.max(1, count);

  const rawMid = new Float64Array(grid.length), rawSide = new Float64Array(grid.length);
  const stereo = referenceBuffer.numberOfChannels > 1 && currentBuffer.numberOfChannels > 1;
  for (let g = 0; g < grid.length; g++) {
    rawMid[g] = refMid[g] - curMid[g] - offset;
    const sideAudible = refSide[g] - refMid[g] > VM_REF2.sideFloorDb && curSide[g] - curMid[g] > VM_REF2.sideFloorDb;
    rawSide[g] = stereo && sideAudible ? refSide[g] - curSide[g] - offset : rawMid[g];
  }
  const smoothMid = vmRef2Smooth(rawMid, grid), smoothSide = vmRef2Smooth(rawSide, grid);
  const midDb = new Float64Array(grid.length), sideDb = new Float64Array(grid.length);
  for (let g = 0; g < grid.length; g++) {
    const w = vmRef2BandWeight(grid[g]);
    midDb[g] = vmRef2Clamp(smoothMid[g]) * w;
    sideDb[g] = vmRef2Clamp(smoothSide[g]) * w;
  }
  return {
    version: 2, sampleRate: sr, gridHz: grid, midDb, sideDb, stereo, levelOffsetDb: offset,
    sections: { reference: ref.pieces, referenceTotal: ref.totalPieces, current: cur.pieces, currentTotal: cur.totalPieces }
  };
}

function vmRef2CurveAt(grid, curve, f) {
  if (f <= grid[0]) return curve[0];
  if (f >= grid[grid.length - 1]) return curve[curve.length - 1];
  const x = Math.log2(f / grid[0]) * VM_REF2.gridPointsPerOctave;
  const i = Math.min(grid.length - 2, Math.floor(x));
  const t = x - i;
  return curve[i] * (1 - t) + curve[i + 1] * t;
}

// Linear-phase FIR whose magnitude follows curveDb (frequency sampling on an
// 8x oversampled grid, Blackman window). Delay is (taps - 1) / 2 samples.
function buildReferenceMatchFirV2(grid, curveDb, sr, taps = VM_REF2.firTaps) {
  const n = nextPow2(taps * 2);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * sr) / n;
    const g = 10 ** (vmRef2CurveAt(grid, curveDb, Math.max(f, 1)) / 20);
    re[k] = g;
    if (k > 0 && k < n / 2) re[n - k] = g;
  }
  // Real, even spectrum -> real, even (zero-phase) impulse response.
  fft(re, im);
  const half = (taps - 1) / 2;
  const fir = new Float32Array(taps);
  for (let i = 0; i < taps; i++) {
    const t = i - half;
    const idx = (t + n) % n;
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    fir[i] = (re[idx] / n) * w;
  }
  return fir;
}

// Applies the correction at `amount` (0-1). Returns a new AudioBuffer of the
// same length; the caller runs the final limiter as for v1.
async function applyReferenceMatchV2(source, match, amount) {
  const sr = source.sampleRate, len = source.length, channels = source.numberOfChannels;
  const scale = c => Float64Array.from(c, v => v * amount);
  const midFir = buildReferenceMatchFirV2(match.gridHz, scale(match.midDb), sr);
  const sideFir = buildReferenceMatchFirV2(match.gridHz, scale(match.sideDb), sr);
  const delay = (midFir.length - 1) / 2;

  const ctx = new OfflineAudioContext(Math.max(2, channels), len + delay, sr);
  const src = ctx.createBufferSource();
  src.buffer = source;
  const makeConvolver = fir => {
    const conv = ctx.createConvolver();
    conv.normalize = false;
    const ir = ctx.createBuffer(1, fir.length, sr);
    ir.copyToChannel(fir, 0);
    conv.buffer = ir;
    conv.channelCount = 1;
    conv.channelCountMode = 'explicit';
    return conv;
  };
  const merger = ctx.createChannelMerger(2);
  if (channels === 1) {
    const conv = makeConvolver(midFir);
    src.connect(conv);
    conv.connect(merger, 0, 0);
    conv.connect(merger, 0, 1);
  } else {
    const split = ctx.createChannelSplitter(2);
    src.connect(split);
    const toMid = ctx.createGain(), toSide = ctx.createGain(), invR = ctx.createGain();
    toMid.gain.value = 0.5; toSide.gain.value = 0.5; invR.gain.value = -1;
    toMid.channelCount = toSide.channelCount = invR.channelCount = 1;
    toMid.channelCountMode = toSide.channelCountMode = invR.channelCountMode = 'explicit';
    split.connect(toMid, 0); split.connect(toMid, 1);           // M = (L + R) / 2
    split.connect(toSide, 0); split.connect(invR, 1); invR.connect(toSide); // S = (L - R) / 2
    const midConv = makeConvolver(midFir), sideConv = makeConvolver(sideFir);
    toMid.connect(midConv); toSide.connect(sideConv);
    const sideNeg = ctx.createGain();
    sideNeg.gain.value = -1;
    sideNeg.channelCount = 1; sideNeg.channelCountMode = 'explicit';
    midConv.connect(merger, 0, 0); sideConv.connect(merger, 0, 0);  // L = M + S
    midConv.connect(merger, 0, 1); sideConv.connect(sideNeg); sideNeg.connect(merger, 0, 1); // R = M - S
  }
  merger.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  // Drop the FIR latency so the result lines up with the source.
  const out = audioCtx.createBuffer(channels, len, sr);
  for (let ch = 0; ch < channels; ch++) {
    out.copyToChannel(rendered.getChannelData(ch).subarray(delay, delay + len), ch);
  }
  return out;
}
