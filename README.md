# AI VocalMIX - iPhone Test D401 Simple v2

AI VocalMIX の iPhone Safari / PWA 動作確認用簡易版です。

## この版の内容

- 通常の Vocal プリセット: あり
- Harmony プリセット / Auto: あり
- Vocal 詳細追加補正 UI: 非表示
- FX タブ: 非表示
- Upload / Analysis / Mix / Preview / Export: あり
- Fire Lit Premaster: あり

## GitHub Pages で公開する方法

1. このZIPの中身を GitHub リポジトリ直下へアップロードします。
2. GitHub の `Settings` → `Pages` を開きます。
3. `Build and deployment` の Source を `Deploy from a branch` にします。
4. Branch を `main`、Folder を `/(root)` にして Save します。
5. 発行された `https://<ユーザー名>.github.io/<リポジトリ名>/` を iPhone Safari で開きます。
6. PWA確認は Safari の共有 → `ホーム画面に追加` から行えます。

## ファイル構成

```text
/
├─ index.html
├─ manifest.webmanifest
├─ service-worker.js
├─ icon-180.png
├─ icon-192.png
├─ icon-512.png
├─ IPHONE_TEST_D401_SIMPLE_v2_AUDIT.json
├─ README.md
└─ .nojekyll
```

> 本番 D401 とは別の iPhone 動作確認用ビルドです。
