# D411 iPhone Upload memory change

## 変更
iOSではVocal/Instrumentalのdecode直後にfull-rate mono Float32Arrayを生成しない。
Upload波形は既存のdrawAudioBufferWave()でAudioBufferから直接描画する。
Analyze開始時にD405の既存lazy rebuild経路でmono配列を生成する。

## 結果への影響
解析式・DSP・レンダリング・Exportは変更なし。
mono入力では元々getChannelData() viewなので効果は小さい。
stereo入力では追加の `frames * 4 bytes` のmono配列をVocal/InstそれぞれUpload時に保持しないため、
decode直後のiPhoneメモリピークを抑える。

例: 48kHz / 5分 stereo なら、1トラックあたり約57.6MBの追加mono配列生成をUpload時に回避。
Vocal+Instなら理論上約115.2MB分をAnalyze開始まで遅延できる。
（実ブラウザの総メモリ削減量はWebKit内部実装に依存するため実機未計測。）
