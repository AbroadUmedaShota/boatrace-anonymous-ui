# ボートレース予想画面の匿名試験

GitHub Actionsで、レース選択から保存済み予想と履歴を開くまでの操作を検証します。試験用のレースは2030年1月1日・会場コード01・1Rです。6艇の三連単120通りに合成確率と合成オッズを設定して使います。

## GitHubでの実行

Actions → **Anonymous race UI** → **Run workflow** で対象ブランチを選択します。標準Linuxランナーが一時DBを作り、APIを通して合成結果を登録します。ChromiumでPC幅とスマートフォン幅を順番に開き、120通りの表示と、履歴から同じ予想を再表示できることを検査します。段階別試験では、展示後予想とオッズ反映後の結果を別の依頼として保存します。タブを閉じて履歴からそれぞれを開き、元の確率が変わらず、詳細画面で段階を区別できることを確認します。スマートフォン幅では古いオッズが保留になる経路も検査します。各実行の結果はジョブのログに表示されます。

実行は手動のみです。標準の Linux ランナー1台に10分の上限を設定しています。公開リポジトリでの標準ランナー利用は無料です。[GitHub Actions の利用料金](https://docs.github.com/en/actions/concepts/billing-and-usage)

## 手元で再現する場合

Node.js 24を使用します。

```sh
npm ci
npx --no-install playwright install --with-deps --only-shell chromium
npm run ci:race-smoke
npm run ci:race-smoke -- --staged
```

成果物は画面・APIの動作試験です。モデルの学習や実レースの予想精度は評価対象外です。
