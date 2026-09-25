# WebAssembly sources

`index.html` embeds seven small WebAssembly modules as base64 constants. They were compiled from C with clang 17 (the `producers` section says `clang_17.0.0`, Apple/swiftlang build). **That C source is not in this repository.** The `.wat` files here are disassemblies of those modules. Each one assembles back to the same bytes as the embedded module, apart from the custom sections (`name`, `producers`, `target_features`), which do not affect execution.

| File | Constant in `index.html` | Exports | Used by (JS fallback exists) |
|---|---|---|---|
| `dsp.wat` | `VM_WASM_DSP_BASE64` | `vm_biquad_reset/process`, `vm_limiter_reset/process`, `vm_gain_process` | `vmProcessBiquadWasmCooperative`, `vmApplyLookaheadLimiterWasmCooperative`, `vmApplyGainArrayInPlaceWasmCooperative` |
| `clipstats.wat` | `VM_CLIPSTATS_WASM_BASE64` | `vm_clipstats_accumulate` | clip detection during analysis |
| `analysis-stats.wat` | `VM_ANALYSIS_STATS_WASM_BASE64` | `vm_peak_rms_accumulate`, `vm_pair_rms_accumulate` | peak/RMS statistics during analysis |
| `sample-peak.wat` | `VM_SAMPLE_PEAK_WASM_BASE64` | `vm_sample_peak_scan` | sample peak |
| `lufs.wat` | `VM_LUFS_WASM_BASE64` | `vm_kweight_accumulate` | `accumulateKWeightedBlockPowersWasmCooperative` (Integrated LUFS) |
| `hq-resampler.wat` | `VM_HQ_RESAMPLER_WASM_BASE64` | `vm_resample_polyphase` | 44.1/48 kHz export resampling |
| `true-peak.wat` | `VM_TRUE_PEAK_WASM_BASE64` | `vm_true_peak_scan` | `estimateTruePeakWasmCooperative` (True Peak) |

## Commands

```
npm install              # installs wabt (dev tooling only)
npm run wasm:verify      # fails if any .wat no longer matches index.html
npm run wasm:extract     # regenerate the .wat files from index.html
node tools/wasm-sources.cjs --build   # print base64 assembled from the .wat files
```

## Changing a module

1. Edit the `.wat` file.
2. `node tools/wasm-sources.cjs --build` and replace the matching constant in `index.html`. The rebuilt module has no custom sections, which is fine for execution.
3. `npm run wasm:verify`, then the regression tests (`tests/loudness-reference-regression.cjs` for LUFS/True Peak, `tests/baseline-metrics.cjs --check docs/baseline/chromium.json` for end-to-end output).

If the original C source turns up, add it here and prefer it over the `.wat` files.
