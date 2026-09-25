# OSS調査・技術選定・開発順序の提案（D438時点）

調査日: 2026-09-25 / 対象: `main` 相当（BUILD D438, `index.html` 1.35MB）
本書は提案のみ。コード変更は含まない。

## 0. 前提（推定を含む）

依頼文に要件の明記がないため、要件は README と `index.html` の実装から推定した。

| 要件 | 根拠 |
|---|---|
| 歌ってみたMIX（Vocal + Inst、任意でHarmony / Reference） | Uploadタブ |
| スマホ完結、iPhone Safari PWAが主対象 | README「iPhone Safari remains primary」、manifest |
| サーバー送信なし・オフライン動作 | Home文言、service-worker |
| 固定プリセットではなく解析結果から処理を選び、理由を表示 | Home / Analysis / Mix |
| Before/After、FX（区間FX含む）、リファレンスマッチング、WAV書き出し、YouTube向け（-14 LUFS / -1.5 dBTP） | Preview / FX / Export |
| 既存の解析式・MIX判断・DSP順序・Preview/Export挙動を壊さない | README「structure before behavior」 |

**重要: 新規アプリではなく、既に機能が揃ったアプリ（D438）の次フェーズとして扱う。** ゼロからの作り直しは提案しない。

### 現状の実測（静的確認）
- `index.html` 1,350,990 B のうち、インラインJS `#app-script` 514,854 B、CSS 331,189 B、base64埋め込みWASM 最大約227KB。
- 埋め込みWASMは `VM_WASM_DSP_BASE` / `VM_LUFS_WASM_BASE` / `VM_TRUE_PEAK_WASM_BASE` / `VM_HQ_RESAMPLER_WASM_BASE` など。**リポジトリ内にWASMのソースとビルド手順が見当たらない**（確認済み）。
- 分離済みモジュール 11個（`src/`）、回帰テスト 11本（Chromiumのみ、iPhone実機は未検証とREADMEに明記）。

## 1. 類似OSSの比較

更新日は各リポジトリをcloneし `git log` で確認した値（2026-09-25時点）。スター数はGitHubページ表示。

| 名前 | 解決する課題 / 対象 | 技術構成 | ライセンス | 更新状況 | 判定 |
|---|---|---|---|---|---|
| [Matchering](https://github.com/sergree/matchering) (2.6k★) | 参照曲に合わせたマスタリング（RMS・周波数特性・ピーク・ステレオ幅）/ 制作者・AIマスタリング事業者 | Python + NumPy/SciPy、Docker Web UI | GPL-3.0 | 最新コミット 2026-07-08 だがSUPPORTERS更新のみ。**コード変更は 2022-10 が最後** | **音質面で最も参考**（設計のみ） |
| [AudioMass](https://github.com/pkalogiros/AudioMass) (3.0k★) | ブラウザ波形エディタ＋マルチトラック / 一般ユーザー | 素のJS、Service Worker、JS版LUFS（`lufs.js`）、RNNoise WASM、lame/flac | MIT（同梱ライブラリは個別） | 2026-08-20 まで活発 | **実装形態が最も近い** |
| [openDAW](https://github.com/andremichelle/openDAW) (2.1k★) | 本格Web DAW / 制作者 | TypeScript + Rust WASM + AudioWorklet、monorepo | AGPL-3.0 / 商用 | 2026-09-24 まで毎日更新 | 設計参考のみ（採用不可） |
| [automix-toolkit](https://github.com/csteinmetz1/automix-toolkit) (118★) | 深層学習による自動ミックス研究 | Python / PyTorch、ドラム用学習済みモデル | Apache-2.0 | 研究用 | 不採用 |
| [Diff-MST](https://github.com/sai-soum/Diff-MST) | 参照曲からのミックススタイル転写（ISMIR 2024） | PyTorch、微分可能ミキサー | CC-BY-NC-SA 4.0 | 研究用 | 不採用（非商用条件） |
| [Auto_podcast_mixer](https://github.com/R0mb0/Auto_podcast_mixer) (0★) | BGM自動ダッキング | 素のJS、OfflineAudioContext、wavesurfer | MIT | 小規模 | 参考価値低 |

補助ライブラリ（採否は §3）:

| 名前 | ライセンス | 最終コミット | 用途 |
|---|---|---|---|
| wavesurfer.js | BSD-3 | 2026-09-24 | 波形UI |
| Tone.js | MIT | 2026-09-16 | リアルタイム再生フレームワーク |
| Faust | コンパイラGPL系 / ライブラリLGPL（生成コードの扱いは要確認） | 2026-09-22 | DSP記述→WASM/AudioWorklet生成 |
| libebur128 | MIT | 2021-02（安定・枯れている） | EBU R128 / True Peak 基準実装 |
| Elementary | MIT | 2024-12（停滞） | 関数型DSP |
| Meyda | MIT | 2024-04（停滞） | 特徴量抽出 |
| essentia.js | AGPL-3.0 | 2022-07（停滞） | 高度な音楽解析 |

**「ブラウザ内で・ボーカル中心に・解析結果から処理を決めて理由を説明する」OSSは見つからなかった。** 本アプリの中核部分に直接流用できるOSSはない（検索範囲: GitHub topics `automatic-mixing` / `audio-mixing`、Web検索。網羅性は中程度）。

## 2. 選定: 最も参考になるもの

1. **Matchering（音質・アルゴリズム面）** — 本アプリのリファレンスマッチングとYouTube向け最終段に直結する。
2. **AudioMass（実装形態面）** — 素のJS・PWA・クライアント完結・MITという点で本アプリと同じ制約で動いている。

### Matchering: 再利用すべき設計（コードは流用しない）
- Mid/Sideに分け、それぞれで周波数特性を合わせる（ボーカル中央定位を崩しにくい）。
- 曲全体ではなく「最も大きい区間（loudest pieces）」だけで比較する → サビ基準で比較され、静かなイントロに引っ張られない。
- 平均スペクトル差を LOWESS で平滑化してから FIR を作る → 狭い山谷に過補正しない。
- RMS補正を複数回反復（既定4回）して目標に収束させる。
- 最終段に専用ブリックウォールリミッタ（Hyrax）、クリップ/リミット発生サンプル数をしきい値で報告。
- 処理ログをコード化（`log/codes.py`）し、ユーザー向け説明文と分離。本アプリの「判断理由表示」と同じ思想。

### Matchering: 避けるべき点
- **GPL-3.0のためコードの移植・翻訳はしない**（配布する本アプリ全体にGPLが及ぶ恐れ）。数式・手順の考え方のみ参照し、独自実装する。※法的助言ではない。
- 参照曲の音量に機械的に合わせるため、過度な持ち上げで歪む。本アプリは既に「上げすぎず歪ませない」方針（D423）なので、そちらを優先する。
- Docker Webはサーバーへ音源をアップロードする方式。本アプリの「サーバー送信なし」とは逆。
- 内部44.1kHz固定、最大15分、メモリはPC前提。iPhoneのメモリ上限には合わない。

### AudioMass: 再利用すべき点
- JS単体のBS.1770ラウドネス実装（400ms block / 100ms hop / -70・-10 LU gate / 4x True Peak）→ 本アプリのLUFS実装の突き合わせ対象に使える。
- 同梱ライブラリのライセンスを `THIRD_PARTY_NOTICES.md` に一覧化している → 本アプリも同様にすべき。
- RNNoiseをWASMで任意機能として同梱（常時適用しない）。

### AudioMass: 避けるべき点
- グローバル名前空間に多数のスクリプトを連結する構造 → 現状の巨大インラインJSと同じ問題を持つ。
- 旧 appcache が残存。モバイル最適化の記述なし。

### openDAW: 参考にする点と採用しない理由
- 参考: 起動時に必要機能を列挙して検査する `testFeatures()`、エラー番号を振ってトリアージする運用、AudioWorklet + WASM の分離。
- 採用しない: `SharedArrayBuffer` / WASM SIMD / OPFS を必須とし、SABには COOP/COEP ヘッダが必要。**GitHub Pagesは独自ヘッダを設定できない**（Service Workerで回避する手段はあるが、iPhone PWAの安定性リスクが増える）。AGPL。デスクトップ優先。

## 3. 技術選定（提案）

| 領域 | 提案 | 理由 / トレードオフ |
|---|---|---|
| UI | **現状維持（素のJS、フレームワーク導入なし）** | React等への移行は514KBのJSを書き直すことになり、回帰リスクに見合う利点がない |
| 配信 | **GitHub Pages + Service Worker 維持** | サーバー不要・無料。COOP/COEPが使えない制約は受け入れる |
| 音声処理 | **OfflineAudioContext中心を維持** | Preview/Exportのサンプル一致テストが既にある。AudioWorklet化は計測でボトルネックが出てから |
| 重い解析 | 必要が計測できたら純粋計算部分のみ Web Worker へ | Web Audio APIのノード類はWorkerでは使えないため、移せるのは配列計算とWASMのみ |
| WASM | **ソースと再現ビルドをリポジトリに置くことを最優先** | 現状はbase64のみで、修正・監査・ライセンス確認ができない。元ソースがなければ、新規DSPは Faust か C/Rust で記述する |
| ラウドネス検証 | libebur128（MIT）をテスト専用の基準実装として使う | 本番には同梱しない。LUFS/True Peakの誤差を数値で保証できる |
| リファレンスマッチングv2 | Matchering方式の独自実装（Mid/Side、loudest pieces、平滑化、反復RMS） | 既存方式とA/B比較してから切替。GPLコードは使わない |
| 波形UI | 現状維持。wavesurfer.js（BSD-3）は置換が必要になった場合の候補 | 既存の波形・区間選択は動いている |
| テスト | 既存Node/Chromiumテスト継続 + Playwright WebKit を追加候補 | WebKit(Linux)はiPhone Safariと同一ではない。実機確認は別途必須。この環境にはChromiumのみ導入済み |
| 採用しない | Tone.js、essentia.js、Elementary、機械学習モデル | 不要（リアルタイム主体でない）/ AGPL・停滞 / 停滞 / サイズとiPhoneメモリに見合わない |

## 4. システム構成（目標）

```
index.html          … マークアップのみ（インラインJS/CSS/WASMを段階的に外へ）
styles/             … 331KBのCSSを画面単位に分割（重複を計測してから）
src/state/          … 設定・解析結果・レンダリング状態
src/analysis/       … 純粋関数（入力: Float32Array → 出力: 数値）。Worker化の候補
src/decision/       … 解析結果 → 処理チェーンと判断理由（ここが本アプリの価値）
src/dsp/            … ノードグラフ構築（Vocal / Harmony / Inst / FX / Master）
src/render/         … OfflineAudioContext実行、メモリ事前チェック（既存）
src/export/         … WAV（既存 wav-codec）、YouTube master
src/wasm/  wasm-src/… WASMのソースとビルドスクリプト、生成物
src/ui/ src/pwa/    … 既存
tests/              … 既存 + golden test（同じ入力で同じ出力）+ LUFS基準テスト
THIRD_PARTY_NOTICES.md
```

分離順は「依存の少ない純粋関数 → 判断ロジック → DSPグラフ → UI」。各段階で既存のPreview/Export一致テストが通ることを条件にする。

## 5. MVP範囲（次マイルストーン）

機能は既に揃っているため、次のMVPは **「新機能を足さず、変更しても壊れないことを保証できる状態」** と定義する。

含む:
1. 基準値の記録: ファイルサイズ、解析/レンダリング時間、ピークメモリ、固定入力に対する出力のハッシュ/LUFS。
2. WASMの出所確定とソース・ビルド手順の追加（元ソースが無い場合は再実装の範囲を確定）。
3. LUFS / True Peak を libebur128 と比較するテスト。
4. `#app-script` から 解析 → 判断 の純粋関数を切り出し、golden testを付ける。
5. `THIRD_PARTY_NOTICES.md` 作成。

含まない: リファレンスマッチングv2、Worker化、AudioWorklet化、UI変更、新しい書き出し形式。

## 6. 開発順序

| 段階 | 内容 | 完了条件 |
|---|---|---|
| M0 | 基準値の記録（上記1） | 数値がリポジトリに残る |
| M1 | WASMソース確定・再現ビルド | 同じバイナリ、または同じ出力を再現できる |
| M2 | ラウドネス基準テスト | 誤差が許容範囲内（例: ±0.1 LU、±0.2 dBTP。値は要合意） |
| M3 | 解析・判断ロジックの分離 | 既存テスト全通過、golden出力一致 |
| M4 | DSPグラフ・レンダリングの分離 | Preview/Export一致テスト通過 |
| M5 | CSS分割 | 見た目の差分なし（スクリーンショット比較） |
| M6 | リファレンスマッチングv2（フラグ付き） | 既存方式とのA/B試聴・数値比較 |
| M7 | 計測結果に応じて Worker / AudioWorklet | 実機でメモリか時間の改善を確認 |

各段階で iPhone Safari 実機確認が必要（自動テストでは代替できない）。

## 7. 未確認事項
- 各OSSのiOS Safari上での実動作（未検証）。
- Faust生成コードのライセンス条件の最終確認。
- 埋め込みWASMの元ソースの所在（リポジトリ外にある可能性）。
- 商用利用の予定（GPL/AGPL回避の厳しさが変わる）。

## 8. 進捗（2026-09-25）
- 前提確認: 既存アプリを継続開発、WASM元ソースの所在は不明、商用予定なし、M0〜M2着手を承認済み。
- M0 完了: `tests/baseline-metrics.cjs`、`docs/baseline/chromium.json`。乱数を固定すれば出力はビット一致。途中でService Workerのinstall停止バグ（HTTP/1.1）を発見して修正。
- M1 完了（WATで代替）: 7モジュールを `wasm-src/*.wat` に逆アセンブルし、埋め込みバイナリと実行部分がバイト一致することを `npm run wasm:verify` で検証。元のCソースは無し。
- M2 完了: `docs/M2_LOUDNESS_REFERENCE.md`。全項目合格。LUFSが規格より約0.04 LU低く出る点（K特性2段目の正規化）は承認を得て修正し、libebur128と一致（YouTube用書き出しは −13.953 → −14.000 LUFS）。基準値は `docs/baseline/chromium.json` に取り直し。
- M3 判断層 完了: `src/decision/mix-decision.js`（一字一句そのまま移動）。84ケースのゴールデンテストと、エンドツーエンドのビット一致で挙動不変を確認。
- M3 解析層 完了: `src/analysis/spectrum-core.js`・`src/analysis/vocal-analysis.js`（一字一句そのまま移動、元ファイルの完全復元を確認）。Node上のゴールデンテスト（Chromium記録値と相対1e-12以内）で検証。`index.html` の本体スクリプトは約1.35MB→約1.27MB。
- M4 完了（純粋な処理部分）: DSP・計測・ハモリ・レンダリング・マスタリングを `src/` の11ファイルへ一字一句そのまま移動。基準値にハモリありの経路を追加し、全出力のビット一致で挙動不変を確認。本体スクリプトは約7,400行、`index.html` は約1.35MB→約1.05MB。残りは状態・画面・再生・書き出し制御で、分離には状態管理の設計変更が必要。
- M5 完了: CSSを3ファイルへ一字一句そのまま外部化（`index.html` 1.06MB→0.73MB）。全画面・全要素の計算済みスタイル一致を確認。未修正の発見2件（閉じていない`@media`、スマホで未使用の227KB画像）は `docs/M5_CSS.md`。
- 更新時のずれ対策: `src/`・`styles/` の参照に `?v=<キャッシュ版>` を付与（`tools/asset-version.cjs`）し、整合性テストを追加。分割でキャッシュ優先のファイルが増えたことで顕在化しうる「新HTML＋旧JS」の組み合わせを、ブラウザで再現・解消を確認。
- M6 実装（既定オフ）: 新方式は既知EQの復元誤差がMid 0.82→0.07 dB、Side 2.45→0.11 dB（100%時）。リファレンス読み込みでMIXが無効化されるバグを修正。補正結果が書き出しに反映されない既存の問題は判断待ち（`docs/M6_REFERENCE_MATCH_V2.md`）。
- M7 計測: 書き出し時間の大半は計算ではなく描画フレーム待ち（`yieldToBrowser`）。Worker/AudioWorklet化より待ち方の見直しが有効な見込み。iPhone実機の工程別時間を見てから判断（`docs/M7_PERFORMANCE.md`）。
