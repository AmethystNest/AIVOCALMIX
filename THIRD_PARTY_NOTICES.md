# Third-party notices

No third-party library code is bundled in AIVOCALMIX. The app's JavaScript and CSS were written for this project. The embedded WebAssembly modules were compiled from C whose source is not in the repository and whose origin is unconfirmed; their disassembly is in `wasm-src/` (see `wasm-src/README.md`). The items below are used by the app at runtime, only for development, or as references for algorithms.

## Loaded at runtime (not bundled)

| Item | Source | License |
|---|---|---|
| Shippori Mincho (font) | Google Fonts (`fonts.googleapis.com`) | SIL Open Font License 1.1 |
| JetBrains Mono (font) | Google Fonts | SIL Open Font License 1.1 |
| Inter (font) | Google Fonts | SIL Open Font License 1.1 |

The fonts are requested from Google Fonts by `index.html`; when offline or blocked, the browser falls back to system fonts.

## Development and test tools (not shipped)

| Item | Use | License |
|---|---|---|
| wabt 1.0.37 (npm) | `tools/wasm-sources.cjs`: disassemble / assemble the WebAssembly modules | Apache-2.0 |
| Playwright | browser tests in `tests/` | Apache-2.0 |
| http-server | local server for browser tests | MIT |
| libebur128 67b33ab | measured once to produce the loudness reference values recorded in `tests/loudness-reference-regression.cjs`; not included | MIT |

## Algorithm references (no code taken)

- **ITU-R BS.1770 / EBU R 128 and EBU Tech 3341**: K-weighting filter design, gating and loudness test signals. The K-weighting constants in `src/audio/loudness.js` are the standard design values, which libebur128 (MIT) also uses.
- **Matchering** (GPL-3.0): the ideas behind reference matching v2 (loudest sections, Mid/Side, smoothed spectral difference). `src/reference/reference-match-v2.js` was written independently and contains no Matchering code.
