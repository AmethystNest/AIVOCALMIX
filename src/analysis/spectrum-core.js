// Analysis core: FFT, Hann window, magnitude spectrum, RMS and dBFS helpers.
// Pure functions and caches only. Moved verbatim from the main app script in
// index.html; loaded as a classic script before it so the declarations stay global.
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

const VM_FFT_PLAN_CACHE = new Map();

function getFftPlan(n) {
  const cached = VM_FFT_PLAN_CACHE.get(n);
  if (cached) return cached;

  // Preserve the exact swap ordering used by the original iterative FFT.
  const swapI = [];
  const swapJ = [];
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      swapI.push(i);
      swapJ.push(j);
    }
  }

  const stages = [];
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    stages.push({ len, wr: Math.cos(ang), wi: Math.sin(ang) });
  }

  const plan = {
    swapI: Uint32Array.from(swapI),
    swapJ: Uint32Array.from(swapJ),
    stages
  };

  if (VM_FFT_PLAN_CACHE.size >= 8) {
    VM_FFT_PLAN_CACHE.delete(VM_FFT_PLAN_CACHE.keys().next().value);
  }
  VM_FFT_PLAN_CACHE.set(n, plan);
  return plan;
}

function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;

  const plan = getFftPlan(n);

  for (let s = 0; s < plan.swapI.length; s++) {
    const i = plan.swapI[s], j = plan.swapJ[s];
    let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
    tmp = im[i]; im[i] = im[j]; im[j] = tmp;
  }

  for (let si = 0; si < plan.stages.length; si++) {
    const stage = plan.stages[si];
    const len = stage.len, wr = stage.wr, wi = stage.wi;

    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curWr - im[i + k + len / 2] * curWi;
        const vIm = re[i + k + len / 2] * curWi + im[i + k + len / 2] * curWr;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nextWr = curWr * wr - curWi * wi;
        const nextWi = curWr * wi + curWi * wr;
        curWr = nextWr; curWi = nextWi;
      }
    }
  }
}

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

const VM_FREQ_RANGE_CACHE = new WeakMap();

function getInclusiveFrequencyBinRange(freqs, lo, hi) {
  let perArray = VM_FREQ_RANGE_CACHE.get(freqs);
  if (!perArray) {
    perArray = new Map();
    VM_FREQ_RANGE_CACHE.set(freqs, perArray);
  }

  const key = `${lo}|${hi}`;
  const cached = perArray.get(key);
  if (cached) return cached;

  let start = 0;
  while (start < freqs.length && freqs[start] < lo) start++;

  let end = start;
  while (end < freqs.length && freqs[end] <= hi) end++;

  const result = Object.freeze({ start, end });
  perArray.set(key, result);
  return result;
}

const VM_HANN_CACHE = new Map();

function getCachedHannWindow(n) {
  const cached = VM_HANN_CACHE.get(n);
  if (cached) return cached;

  const w = hann(n);
  if (VM_HANN_CACHE.size >= 8) {
    VM_HANN_CACHE.delete(VM_HANN_CACHE.keys().next().value);
  }
  VM_HANN_CACHE.set(n, w);
  return w;
}

function createSpectrumWorkspace(frameLength, sr) {
  const n = nextPow2(frameLength);
  const half = n / 2;
  const freqs = new Float64Array(half);
  for (let i = 0; i < half; i++) freqs[i] = (i * sr) / n;

  return {
    n,
    half,
    window: getCachedHannWindow(frameLength),
    re: new Float64Array(n),
    im: new Float64Array(n),
    mag: new Float64Array(half),
    freqs
  };
}

function magnitudeSpectrumInto(frame, workspace) {
  const n = workspace.n;
  const re = workspace.re;
  const im = workspace.im;
  const mag = workspace.mag;
  const window = workspace.window;

  re.fill(0);
  im.fill(0);

  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * window[i];
  fft(re, im);

  for (let i = 0; i < workspace.half; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return mag;
}

function magnitudeSpectrumRangeInto(samples, start, length, workspace) {
  const re = workspace.re, im = workspace.im, mag = workspace.mag, window = workspace.window;
  re.fill(0); im.fill(0);
  const count = Math.min(length, samples.length - start, window.length);
  for (let i = 0; i < count; i++) re[i] = samples[start + i] * window[i];
  fft(re, im);
  for (let i = 0; i < workspace.half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

function magnitudeSpectrum(frame, sr) {
  const workspace = createSpectrumWorkspace(frame.length, sr);
  const mag = new Float64Array(workspace.half);
  mag.set(magnitudeSpectrumInto(frame, workspace));
  return { mag, freqs: workspace.freqs };
}

function rmsOf(samples, start, len) {
  let sum = 0;
  const end = Math.min(start + len, samples.length);
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(end - start, 1));
}

function dbfs(linear) { return 20 * Math.log10(Math.max(linear, 1e-9)); }
