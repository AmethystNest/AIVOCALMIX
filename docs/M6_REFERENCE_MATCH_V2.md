# M6: Reference matching v2 (opt-in)

`src/reference/reference-match-v2.js`, enabled by the 新方式(試験的) checkbox in Preview → リファレンスマッチング (off by default, not saved). With it off, the existing method runs unchanged: its output is bit-identical to the previous code (`tests/reference-ui-regression.cjs --expect-v1 dddd8cec…`).

## Method (ideas from Matchering, independent code)

1. Split each track into 3 s sections and keep the loudest half (at most 20 sections), so quiet intros do not skew the comparison.
2. Average Mid and Side power spectra (4096-point FFT) over those sections.
3. Difference on a 1/6-octave grid, overall level offset (100 Hz-10 kHz, Mid) removed, smoothed over 1/3 octave, capped at ±6 dB, faded to 0 dB outside 40 Hz-16 kHz. Side is not corrected where it is more than 50 dB below Mid.
4. Linear-phase FIRs (4095 taps, Blackman) for Mid and Side, applied with ConvolverNodes; the FIR latency is removed, then the existing final limiter runs as for v1. The 適用量 slider scales the curve in dB.

## Evaluation (`tests/reference-match-v2-evaluation.cjs`)

Reference = test mix with a known EQ (200 Hz low shelf -3 dB, 3 kHz peak +4 dB, 9 kHz high shelf +5 dB), -4 dB and Side x1.3. Remaining 1/3-octave error against the reference, level-normalised, 63 Hz-12.5 kHz:

| | Mid RMS | Mid max | Side RMS |
|---|---|---|---|
| no correction | 2.04 dB | 3.60 dB | 3.05 dB |
| v1, 100 % | 0.82 | 1.60 | 2.45 |
| **v2, 100 %** | **0.07** | **0.20** | **0.11** |
| v1, 50 % | 0.88 | 1.97 | 2.44 |
| v2, 50 % | 1.02 | 1.90 | 1.53 |

v2 at 50 % leaves half of the difference, as the slider says; v1's overlapping Q=1 peaking filters overshoot at 50 % and cannot close the gap at 100 %. Invariants: amount 0 returns the input (max difference 4e-7), FIR response within 0.04 dB of the curve.

Not evaluated: listening tests and real reference tracks (no ground truth), iPhone memory/time. v2 needs about one more song-length buffer than v1 (the memory guard uses 3x instead of 2x).

## Fixed on the way

Loading a reference track ran the same invalidation as replacing the vocal, so the Mix result became stale and 違いを分析 always answered 先にMixタブでレンダリングしてください unless the Mix was rendered again after loading the reference. The state contract in `index.html` (v80-D5) says a reference change discards only the reference-match results; `invalidateForSourceChange('reference')` now does nothing (the reference state is already reset by its own revision counters).

## Fixed: the correction now reaches Preview and Export

Previously the corrected audio reached Preview only if the FX tab had been rendered, and never reached Export, which rebuilds the song from the stems. Now:

- 補正を適用 stores the correction (method, amount, analysis) together with the uncorrected song it was computed from, and registers the result as the current song, so Preview plays it without an FX render.
- Normal and YouTube export apply the same correction to the rebuilt song, then the final limiter at their ceiling (-0.3 / -1.5 dBTP). The Fire Lit premaster applies only the correction and leaves headroom to its existing gain step (it has no limiter).
- Analysing or applying again works on the uncorrected song, so corrections do not stack (Export applies the latest one once).
- The correction stops applying, as other derived results do, when FX settings change or FX is re-rendered, a source or the reference is replaced.

`tests/reference-ui-regression.cjs` checks for both methods: Preview uses the corrected audio; the normal export matches it (residual 0.00008 after a gain fit, vs 1.15 against the uncorrected song); YouTube (0.04 vs 1.00) and premaster (0.55 vs 0.63, different processing path) are closer to the corrected than to the uncorrected song; an FX setting change drops the correction. The v1 correction itself is bit-identical to before. Extra memory: while a correction is active after an FX render, the uncorrected FX song stays in memory.
