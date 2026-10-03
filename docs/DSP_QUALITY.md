# DSP quality measurements

Measured with `node tools/dsp-quality-report.cjs` (report only, nothing is asserted) and the loudness reference test. These are measurements of the current code, not changes.

## Export resampler (`src/audio/hq-resampler.js`)
44.1 <-> 48 kHz, 0.5 FS sine: gain error within ±0.004 dB from 1 kHz to 19.5 kHz in both directions; -0.21 dB (44.1 -> 48) and -0.31 dB (48 -> 44.1) at 20.5 kHz, close to the cutoff. No change needed.

## Aliasing of sample-domain saturators
Level of folded-back (non-harmonic) components relative to the fundamental, 48 kHz, no oversampling:

| Stage | Condition | Alias level |
|---|---|---|
| FX region drive (`saturateSampleForRegion`) | amount 0.3 / 0.6 / 1.0, 3 kHz at 0.5 FS | -60 / -40 / -29 dB |
| Sibilance-aware exciter (added part, before mix 0.16) | 12 kHz -20 dBFS / 15 kHz -20 dBFS / 11 kHz -12 dBFS | -40 / -38 / -26 dB |

The main drive and saturation paths use `WaveShaperNode` with `oversample = '4x'` and are not affected. Only the per-region drive (needed because the amount varies over time) and the exciter work in the sample domain. The exciter's added part is mixed in at about -16 dB, so its aliasing sits roughly 40-55 dB below the signal in the top octave.

Not changed: oversampling these stages 4x in JS would cost several seconds per channel for a 5-minute song on a phone, for an audible gain only on strong region drive. Revisit if region drive is used heavily, preferably with 2x and a short FIR, measured on a real device.

## True Peak (`src/audio/loudness.js`, 8x / 16-tap half width, used by export and the limiter safety pass)
Against the high-precision reference in `tests/loudness-reference-regression.cjs`: within -0.002 dB (48 kHz) and -0.167 dB (44.1 kHz) on the dense music-like signal, so the estimate can read up to about 0.17 dB low. Within the tolerance of the test (+0.2 / -0.4 dB). The 4x variant used only by the test reads up to 0.39 dB low and is not used by the app.

## Platform notes
Playwright WebKit 26.0 (Linux) has no `navigator.audioSession`; whether iOS Safari exposes it could not be checked here (the W3C and MDN pages are blocked from this environment).

## Final limiter (`applyLookaheadLimiter`, cache v91)
The gain used to drop in one sample when a peak entered the 5 ms lookahead, and each channel was limited on its own. It now ramps over the lookahead and both channels share one gain; see `tests/limiter-quality.cjs` (far sidebands on a tone with about 5 dB of reduction: about -48 dB before, -84 dB after).

## The `DynamicsCompressorNode` "limiters" in the FX and harmony renders
`src/render/fx-render.js` and `src/render/harmony-render.js` end with a `DynamicsCompressorNode` (threshold -1 dB, ratio 4, attack 10 ms, release 150 ms, default 30 dB knee). Measured in Chromium with a 997 Hz sine at -30 ... +2 dBFS, the level change is 0 to -0.04 dB, so the node neither limits nor colours the sound; peak protection comes from the lookahead limiter applied at export. Not measured in WebKit. Left unchanged: removing it would only change code, not sound, in the cases measured.
