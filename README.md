# ボートレース予想画面の匿名試験

GitHub Actionsで、レース選択から保存済み予想と履歴を開くまでの操作を検証します。試験用のレースは2030年1月1日・会場コード01・1Rです。6艇の3連単120通りに同じ確率を設定した合成結果を使用します。

## GitHubでの実行

Actions → **Anonymous race UI** → **Run workflow** で対象ブランチを選択します。標準Linuxランナーが一時DBを作り、APIを通して合成結果を登録します。ChromiumでPC幅とスマートフォン幅を順番に開き、120通りの表示と、履歴から同じ予想を再表示できることを検査します。各実行の結果はジョブのログに表示されます。

## 手元で再現する場合

Node.js 24を使用します。

```sh
npm ci
npx --no-install playwright install --with-deps --only-shell chromium
npm run ci:race-smoke
```

成果物は画面・APIの動作試験です。モデルの学習や実レースの予想精度は評価対象外です。
