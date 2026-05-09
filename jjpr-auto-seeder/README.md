# JJPR Auto Seeder

start.gg の参加者CSVを読み込み、`Venue Type` が `competitor` の参加者だけを対象にして、`Short GamerTag` を JJPR で検索し、JJPR順位順のシードCSVを作るツールです。

- 入力: start.gg 参加者CSV
- シード対象行: `Venue Type` が `competitor` の行
- 検索対象列: `Short GamerTag`（変更可）
- 出力: `seed`, `status`, `candidate_index`, `short_gamer_tag`, `jjpr_rank`, `jjpr_name` などを付けたCSV
- 複数候補が出た場合: 同じ参加者を候補ごとに複数行へ展開します
- 未ヒット: `status=not_found` として末尾へ送ります
- 観戦者など: `Venue Type` が `spectator` 等の行はシード対象から除外します

## なぜサーバー実行が必要？

JJPRのページはブラウザ上で動くWebアプリなので、GitHub Pagesのような静的ページだけでは外部サイトのDOM検索やスクレイピングを安定実行できません。このリポジトリでは Playwright を使ってサーバー側または GitHub Actions 上でJJPRページを開き、検索結果を取得します。

## 使い方A: GitHub Actionsだけで使う

1. このリポジトリを自分のGitHubにpushします。
2. `input/attendees.csv` に start.gg から落とした参加者CSVを置きます。
3. GitHubの `Actions` → `Create JJPR seeds` → `Run workflow` を押します。
4. 実行後、`jjpr-seeded-csv` artifact から `output/seeded.csv` をダウンロードします。

GitHub Actions実行時はデフォルトで `Venue Type=competitor` の参加者のみを処理します。

## 使い方B: ローカルのWeb UIで使う

```bash
npm ci
npx playwright install --with-deps chromium
npm start
```

ブラウザで `http://localhost:3000` を開き、CSVをアップロードします。Web UIでは以下を変更できます。

- Gamer tag列名: デフォルト `Short GamerTag`
- Venue type列名: デフォルト `Venue Type`
- シード対象のVenue type: デフォルト `competitor`

## 使い方C: CLIで使う

```bash
npm ci
npx playwright install --with-deps chromium
node src/cli.js input/attendees.csv output/seeded.csv
```

CLIでもデフォルトで `Venue Type=competitor` の参加者のみを処理します。

## 使い方D: Dockerで動かす

```bash
docker build -t jjpr-auto-seeder .
docker run --rm -p 3000:3000 jjpr-auto-seeder
```

## 出力列

| 列 | 意味 |
| --- | --- |
| `seed` | JJPR順位順に並べた仮シード番号 |
| `status` | `matched`, `multiple_candidates`, `not_found` |
| `candidate_index` | 複数候補内の番号 |
| `competitor_order` | competitorだけに絞った後の元順 |
| `original_order` | CSV全体での元行順 |
| `short_gamer_tag` | CSVの元タグ |
| `jjpr_rank` | JJPRで見つかった順位 |
| `jjpr_name` | JJPR上のプレイヤー名 |
| `match_score` | 名前一致の簡易スコア |
| `jjpr_raw_row` | JJPRの検索結果行テキスト |

## Venue Typeの扱い

`src/csvSeeder.js` では `Venue Type` 列を見て、デフォルトでは値が `competitor` の行だけを処理します。列名の大文字小文字やスペース差はある程度吸収します。

コード上のデフォルトは以下です。

```js
const DEFAULT_VENUE_TYPE_COLUMN = 'Venue Type';
const DEFAULT_INCLUDED_VENUE_TYPES = ['competitor'];
```


## 調整ポイント

- `src/jjprScraper.js` の `parseCandidateRow()` は、JJPRページの表構造が変わった場合に調整します。
- `src/csvSeeder.js` の `buildSearchTerms()` は、`Iris/イリス` のような名前を分割検索するためのロジックです。
- `src/csvSeeder.js` の `DEFAULT_INCLUDED_VENUE_TYPES` を変えると、CLI / Actionsのシード対象Venue typeを変えられます。
- 同名・曖昧ヒットは自動で削らず、候補をすべて見せる設計にしています。最終シードは人間が確認してください。

## 注意

Webページ側のHTML構造が変わるとスクレイピング部分の調整が必要になることがあります。安定運用したい場合は、JJPR側が公式APIやデータファイルを提供しているかを確認し、そのエンドポイントへ置き換えるのがベストです。
