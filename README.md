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
