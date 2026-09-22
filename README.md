# AI VocalMIX iPhone TEST D418 Upload Fix

Based on the GitHub D401 Simple v2 test build. Independent from the main D417 development branch.

- Native file input overlay and no bubbling picker loop.
- No compressed ArrayBuffer copy before decode.
- iOS Vocal/Inst mono buffers created at Analyze instead of immediately after decode.
- Better upload errors and waveform redraw fallback.
- iPhone-only service-worker cache namespace, atomic installation and network-first navigation.

QA: JS/SW syntax and structural checks. Real iPhone Safari file picker, audio decode and full Export are **not verified**.

Publish these root files to GitHub Pages. If PWA still shows the old version, close/reopen the installed app or clear this site's website data.
