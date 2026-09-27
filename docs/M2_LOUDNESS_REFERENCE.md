# M2: LUFS / True Peak reference check (D438)

Test: `tests/loudness-reference-regression.cjs` (Chromium, local server on port 8765). All checks pass.

## Result (after the K-weighting fix)

| Check | Reference | App result | Verdict |
|---|---|---|---|
| EBU Tech 3341 cases 1-5, 48 kHz and 44.1 kHz, WASM and JS paths | -23.0 / -33.0 LUFS, +-0.1 LU | -0.055 to +0.024 LU | Pass |
| True Peak of sines with known peak (incl. Tech 3341 case 15) | exact analytic peak, +0.2/-0.4 dB | -0.02 to +0.04 dB | Pass |
| Music-like signal, Integrated LUFS | libebur128 67b33ab, now +-0.01 LU | 0.000 LU (48 and 44.1 kHz) | Pass |
| Music-like signal, True Peak, export path (8x, 16 taps per side) | band-limited peak (Kaiser windowed sinc, 1024 taps per side, 64x) | -0.002 dB (48 kHz), -0.167 dB (44.1 kHz) | Pass |
| Same, 4x path (function default only; the app always calls 8x) | same | -0.249 dB (48 kHz), -0.386 dB (44.1 kHz) | Pass, close to the limit |

## Finding 1 (fixed): Integrated LUFS read about 0.04 LU low

`kWeightingCoeffs()` normalised the numerator of the second K-weighting stage (RLB high-pass) by `1 / (1 + K/Q + K^2)`. ITU-R BS.1770 and libebur128 use the unnormalised numerator `[1, -2, 1]`. The normalisation was -0.043 dB at 48 kHz and -0.047 dB at 44.1 kHz, which matched the measured offset exactly (EBU cases read -0.022 to -0.099 LU low; case 4 was at -23.098, near the limit). The WASM module receives its coefficients from JS, so one change fixes both paths.

After the fix the numerator is `[1, -2, 1]`. LUFS is used only by the Export meters and YouTube mastering (not by analysis or MIX decisions). On the baseline input the YouTube master measured with libebur128 went from -13.953 to -14.000 LUFS; the normal and premaster exports are bit-identical to before.

## Finding 2: libebur128 is not a usable True Peak reference here

On the music-like signal libebur128 reported -0.03 dBTP, while the band-limited peak is +0.23 dBTP (48 kHz) and +0.49 dBTP (44.1 kHz). The app's 8x estimator came within 0.17 dB. The test therefore uses the high-precision reconstruction for True Peak and libebur128 only for loudness.

## How the reference values were measured

- libebur128 67b33ab built with clang 18 and a small CLI (`EBUR128_MODE_I | EBUR128_MODE_TRUE_PEAK`), fed `node tests/loudness-reference-regression.cjs --dump-music <rate>` (interleaved float32).
- True peak reference: the same input evaluated with a Kaiser (beta 12) windowed sinc, 1024 taps per side, 64x oversampling, around every sample above 85 % of the sample peak. At 256 taps / 32x the result differed by 0.02 dB (48 kHz) and 0.003 dB (44.1 kHz).
- EBU Tech 3341 signal definitions: the official PDF could not be downloaded from this environment. Cases 1-5 follow the widely quoted definitions (libebur128 reads -22.99 LUFS on case 1, which confirms the setup). Case 15 (fs/4, 0 deg, 0.5 FS -> -6.0 dBTP, +0.2/-0.4 dB) was confirmed through a search result quoting the document.

Not covered: iPhone Safari (Chromium only), EBU cases 6+ (multichannel) and 16-23 (official WAV files).
