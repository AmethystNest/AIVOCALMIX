# M5: CSS moved out of index.html

The 44 inline `<style>` blocks (331 KB) are now three stylesheets, each linked where its blocks used to be, so the cascade order is unchanged:

| File | Contents |
|---|---|
| `styles/app.css` | the main stylesheet (was the first `<style>`) |
| `styles/patches-d4-d42.css` | 14 consecutive patch blocks (`navigation-safety-v80-d4` … `upload-reset-d42`) |
| `styles/patches-d46-d439.css` | 30 consecutive patch blocks (`analysis-visual-d46` … `aivocalmix-d439-brand-fix`) |

Each original block starts with a `/* @style <id> */` marker; blocks were only merged when nothing but whitespace separated them. No style id is referenced from JS, and the CSS has no relative `url()`s.

`index.html` goes from 1.06 MB to 0.73 MB. Because the service worker fetches navigations network-first, this is downloaded on every online launch; the stylesheets are served from the app-shell cache.

## Verification

`tests/visual-regression.cjs --write <dir>` on the previous commit, `--check <dir>` after the change, at 390 px and 1280 px for all 7 screens: the computed style of every rendered element and its `::before`/`::after` is identical, and no local request fails. Screenshots matched except a 10 px wide strip on the desktop Mix screen that differs between two captures of the old code as well. A 0.3 px `letter-spacing` change is detected. External stylesheets were also checked offline through the service worker.

## Findings (not changed)

1. **(Fixed) Unclosed `@media` in `styles/app.css`.** Closed after its `body::before` rule; computed styles of every element at 390 px and 1280 px are unchanged (later patch blocks already re-declare the affected rules for all widths). Original note: `@media(max-width:700px){ body::before {…}` (original `index.html` line 520) is never closed, so every rule after it in that stylesheet (decoration-layer contract, navigation safety patch: `.app { position:relative; z-index:10 }`, `nav.tabs` pointer events, `#vmDecorationRoot` rules) only applies at widths up to 700 px. iPhone widths are unaffected. Closing it would change desktop/tablet rendering, so it needs a decision and a visual check.
2. **227 KB background image not used on phones.** `body::before` in `styles/app.css` embeds a 227 KB base64 image that a `max-width:700px` rule replaces, so iPhones download and parse it without showing it. Moving it to a separate file would let phones skip it (offline desktop use would then need it in the app shell).
