# AI VocalMIX D415 Modular Development
Baseline: v80-D414-STABLE (unchanged in `legacy-d414/`).

First rule: structure before behavior. Preserve UI, analysis formulas, MIX decisions, DSP order/parameters,
Preview and Export behavior while extracting modules incrementally.

First extraction: `src/navigation-guard.js` (independent of DSP initialization).
Planned boundaries: state / audio / dsp / ui / workers / wasm / styles / tests.
Worker/AudioWorklet moves require measured bottlenecks first. iPhone Safari remains primary.


## D416
Extracted independent shell/lifecycle code before touching the large application/DSP script:
- ui/hard-reset.js
- pwa/lifecycle.js
- audio/context-lifecycle.js
- ui/page-lifecycle.js
- ui/viewport-keyboard.js
- pwa/mobile-resilience.js
- audio/export-memory-preflight.js

The main application/DSP script remains intact to minimize regression risk.


## D417
Extracted pure WAV codec primitives to `src/audio/wav-codec.js`. Main DSP/render/export orchestration remains in the main app script.

## D418 development
Moved the AudioBuffer-to-WAV adapter into `src/audio/wav-codec.js` without changing its body. Added all external scripts to the versioned service worker app shell so a first online load can reopen offline. `tests/static-check.cjs` checks JavaScript syntax and duplicate IDs. `tests/smoke.cjs` exercises the browser path from upload through WAV export and offline reload against a local server on port 8765. Chrome/Chromium coverage does not establish iPhone Safari compatibility.

## D419 development
Extracted Harmony render and final export memory preflight calculations/guards to `src/audio/render-memory-preflight.js` without changing their bodies. The module is loaded before the main application script and is included in the versioned PWA app shell.

## D420 development
Extracted the upload file reader and Web Audio decode helpers to `src/audio/upload-decode.js` without changing their bodies. Upload UI/state orchestration remains in the main app script. The new helper is loaded before the main application script and cached in the versioned PWA app shell.

## iOS file picker compatibility integration
Removed `accept="audio/*"` from all four native file inputs (Vocal, Instrumental, Harmony, Reference) so iOS Files can select GarageBand WAV files. After selection, `setupDrop` checks the file extension against WAV/WAVE/MP3/M4A/AAC/AIF/AIFF/FLAC/OGG/OPUS/CAF and displays an error for unsupported files. Audio decoding still decides actual format support. Existing deferred iOS mono conversion, waveform fallback, and the upload decode helper are retained. Bumped the app shell cache to `v80-d421-ios-file-picker-shell`. Safari file selection and the complete audio pipeline require device testing.

## iOS picker click guard
Guarded bubbling native file-input clicks in `setupDrop` to avoid reopening the picker when the card delegates to `input.click()`. Added `tests/upload-picker-regression.cjs` for all four unrestricted inputs, picker delegation, and unsupported-file rejection. Updated app shell cache to `v80-d422-ios-file-picker-guard-shell`. The real iOS file picker and full audio pipeline still require device/browser testing.

## YouTube mastering distortion prevention
The YouTube export now prioritizes preserving transients over reaching -14 LUFS: limits gain using measured input true peak, avoids a second full-song lookahead limiter, and uses a -1.5 dBTP final ceiling. If the loudness target requires excessive boosting, the export remains quieter and reports that gain was limited. Added `tests/youtube-master-regression.cjs` with synthetic loud and quiet inputs. Cache bumped to `v80-d423-youtube-master-safety-shell`. Actual listening tests and browser export QA remain necessary.

## iPhone WAV preflight (D438)

PCM and WAVE_FORMAT_EXTENSIBLE WAV files are inspected from at most the first 1 MiB before the full file is read and decoded. The app estimates decoded AudioBuffer memory and rejects files that exceed the current device limits. Unknown/compressed WAV encodings continue through the existing decoder and post-decode checks. No analysis or DSP behavior was changed.

Automated Chromium coverage includes WAV preflight invocation, upload through MIX/Preview/WAV Export, Preview/Export sample comparison, and existing mastering/export regression tests. Physical iPhone Safari behavior remains unverified.

## M0-M2 (development baseline, no DSP change)

Plan: `docs/OSS_RESEARCH_TECH_SELECTION.md`.

- Service worker install no longer stalls over HTTP/1.1: each app-shell body is read before waiting on the rest (the all-or-nothing cache update is unchanged). `tests/smoke.cjs` accepts 44.1 or 48 kHz Preview renders (the AudioContext rate depends on the device).
- M0: `tests/baseline-metrics.cjs` records sizes, stage timings, heap peak, the analysis/decision snapshot and WAV hashes for a fixed synthetic input (`docs/baseline/chromium.json`). With `Math.random`/`crypto.getRandomValues` seeded in the page, output is bit-identical between runs; `--check` compares a run with the baseline.
- M1: the seven embedded WASM modules are disassembled into `wasm-src/*.wat`; `npm run wasm:verify` checks they still assemble to the embedded bytes. The original C source is not in the repository.
- M2: `tests/loudness-reference-regression.cjs` checks LUFS/True Peak against EBU Tech 3341 cases, analytic sines, libebur128 and a high-precision True Peak reference. Results: `docs/M2_LOUDNESS_REFERENCE.md`.
- K-weighting fix: the second K-weighting stage now uses the BS.1770 numerator `[1, -2, 1]` (it was normalised, so LUFS read about 0.04 LU low). Integrated LUFS matches libebur128; the YouTube master lands on -14.00 instead of about -13.95 LUFS. Cache bumped to `v80-d442-lufs-kweight-fix`.

Running the tests locally: `npm install`, serve the repository on port 8765 (e.g. `npx http-server -p 8765 -c-1 .`), then `node tests/<name>.cjs`. Browser tests need Playwright (global install). Chromium results do not establish iPhone Safari behaviour.

## M3 (structure only, no behaviour change)

- MIX decision layer (`DEFAULT_MIX_RULES` … `optimizeProcessingBudget`: presets, rules, `decideChain`, safety caps, processing budget) moved verbatim to `src/decision/mix-decision.js`, loaded before the main app script and cached in the app shell (`v80-d443-decision-module`).
- `tests/mix-decision-regression.cjs` runs the module in Node against `tests/fixtures/mix-decision.json`: analysis results from four synthetic inputs x 21 setting combinations (84 cases, 34 distinct chains), recorded from the app before the move. `--record` re-records it; do that only for intended decision changes.
- Analysis layer moved verbatim: FFT/window/spectrum/RMS/dBFS helpers (`nextPow2` … `dbfs`) to `src/analysis/spectrum-core.js`; `analyze`, `analyzeRelative`, `analyzeHarmonySummary`, the harmony analysis proxy and the peak/RMS WASM helpers to `src/analysis/vocal-analysis.js`. They still call `yieldToBrowser`, `vmDecodeBase64Bytes` and `vmWasmGlobalNumber` from the app script at call time. Cache `v80-d444-analysis-module`.
- `tests/analysis-regression.cjs` runs the analysis layer in Node on the same four inputs and compares with the analysis results recorded from Chromium (numbers within 1e-12 relative: Node and Chromium V8 differ in the last bit of Math.cos/sin/hypot). It reproduces Chromium's 16-bit decode (float32 `n/32768` for negative, `n/32767` for positive samples, measured).
- Moving code between scripts is only safe when the moved names are not declared twice (the later declaration wins inside one script). Current duplicate: `estimateAudioBufferBytes` (twice in the app script).

## M4 (structure only, no behaviour change)

Further verbatim moves out of the app script (each re-inserts to the previous `index.html` exactly, loads standalone, runs before the app script and is in the app shell; cache `v80-d448-render-export-modules`):

| File | Contents |
|---|---|
| `src/dsp/sample-dsp.js` | sample-array DSP, biquads, lookahead limiter, dither, DSP/clip-stats WASM |
| `src/dsp/cooperative-dsp.js` | reverb impulse, saturation, gain riding, yielding mono/stereo stages, precision de-esser/compressor |
| `src/audio/loudness.js`, `sample-peak.js`, `hq-resampler.js`, `true-peak.js` | LUFS, sample peak, export resampler, true peak and gain helpers (with their WASM) |
| `src/harmony/harmony-analysis.js` | harmony presets, timing analysis/correction, `decideHarmonyChain` |
| `src/render/vocal-render.js`, `harmony-render.js` | `applyPreProcessingSteps`/`renderChain`, harmony rendering, `mixTwoBuffers` |
| `src/export/youtube-master.js`, `premaster.js` | YouTube mastering, Fire Lit premaster |

The baseline now also runs the flow with a synthetic harmony stem (recorded on unchanged code before the harmony move). What remains in the app script is state, UI, preview, FX region editing and export orchestration, which reads `state` and the DOM directly.

## M5 (CSS, no visual change)

The inline `<style>` blocks moved verbatim into `styles/app.css`, `styles/patches-d4-d42.css` and `styles/patches-d46-d439.css`, linked at the original positions (cache `v80-d449-external-css`). `tests/visual-regression.cjs` compares computed styles and screenshots of every screen before and after a CSS change. Details and two open findings (an unclosed `@media` block, an unused 227 KB image on phones): `docs/M5_CSS.md`.
