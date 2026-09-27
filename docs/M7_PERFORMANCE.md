# M7: where export time goes (measured, nothing changed)

Chromium headless, fixed 12 s stereo test song (`tests/baseline-metrics.cjs` input), normal export at 44.1 kHz.

| | ms |
|---|---|
| Export wall time | 11,668 |
| CPU busy (CPU profile, all functions) | about 1,400 — mostly `vm_true_peak_scan` (810 ms) and WAV encoding (~200 ms) |
| Idle | 10,226 |
| Waiting inside `yieldToBrowser()` (146 calls) | 9,095 |

Isolated components on the same song: true peak 8x 572 ms, integrated LUFS 164 ms, 16-bit WAV encode 804 ms (626 ms of it waiting in yields), 48 kHz resample 303 ms.

`yieldToBrowser()` waits for `requestAnimationFrame` and then `setTimeout(0)`. In headless Chromium each call took about 62 ms (frames are throttled), so this environment exaggerates the effect; at 60 Hz each call costs at least ~16 ms, i.e. roughly 2.3 s for this export (estimate, not measured on a device). Either way the export is dominated by waiting for frames rather than by DSP, so moving DSP to a Worker or AudioWorklet would not help much yet.

## Candidate change (needs iPhone numbers first)

Yield by elapsed time inside long loops (e.g. only when more than ~30-50 ms have passed since the last yield, via a `yieldToBrowserIfDue()` used in the chunk loops) and keep the frame-waiting `yieldToBrowser()` where a status message must be painted before heavy work. Output would be bit-identical (only scheduling changes); the risk is UI responsiveness, which has to be checked on an iPhone.

The app already shows per-stage timings after an export (e.g. 計測 2.85秒 / 最長 WAV生成 1.64秒). Those numbers from an iPhone for a typical song decide whether this is worth doing.
