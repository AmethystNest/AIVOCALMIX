# D410 OSS / iPhone調査メモ

## 現状
- Web Audio API / AudioContext / OfflineAudioContext を中核に使用。
- 独自の埋め込みWebAssembly DSPを使用し、失敗時はJSへフォールバック。
- Web Workerは現時点で未使用。
- AudioWorkletはアプリDSP処理経路には未導入。
- WAVはチャンクBlob方式を含むiPhone向けメモリ対策済み。
- iPhoneでは解析後のfull-rate mono配列解放、Before遅延生成/離脱解放を実装済み。

## OSS候補の判断
- pitchlite (MIT): WASM + AudioWorkletのMPM/YIN。F0用途では有力。ただし現在のAI VocalMIX本体には
  常時F0補正を行う処理経路がなく、追加するとWASM/Worklet常駐コストだけ増えるためD410では不採用。
- Essentia.js (AGPL-3.0): 分析機能は非常に豊富だが、WASMサイズ/初期化負荷とライセンス影響が大きい。
  既存の必要解析を全面置換する根拠がまだないため不採用。
- aubio (GPL-3.0): pitch/onset/MFCC等は有力だが、GPLと追加WASM負荷に対して現行本体の改善幅が未実証。
- Rubber Band (GPL/commercial): 高品質なpitch/time stretch候補だが、GPL/商用ライセンス条件とWASM負荷がある。
  現行MIX本体への無条件導入は不採用。
- libebur128 (MIT): LUFS/True Peakの基準実装候補として有力。既存メーターとの数値比較を先に行い、
  差が確認できた場合にWASM化して採用する候補。
- RNNoise (BSD-3-Clause code): ノイズ低減候補。ただし歌唱音声では過処理/高域・倍音損失の可能性があり、
  常時適用はしない。モデル配布条件も別途確認が必要。

## D410で採用した改善
iOS PWAのAudioContext復帰を強化。WebKitで報告されている
「state=runningでもcurrentTimeが進まない」「resumeが復帰しない」ケースを対象に、
background/pageshow後だけ短いclock health checkを行い、異常時のみAudioContextを再生成する。
resumeには上限時間を設け、UIが無期限停止しないようにした。
