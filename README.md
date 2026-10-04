# Disaster Chronicle

指定した日付（月日）の「前後」に、日本でかつて発生した災害（地震・噴火・風水害など）を振り返れる検索ツールです。

- 公開URL: https://disaster-chronicle.onga-mirai-tech.com/
- 個人・有志による**非公式**のツールです。防災・避難の判断には、気象庁や自治体などの公式情報をご確認ください。

## データの出典

- 災害の一覧: [Wikidata](https://www.wikidata.org/)（CC0）の SPARQL エンドポイント。日単位まで日付が登録されている災害だけを表示します。
- 震度・規模・被害の概要: 日本語版 [Wikipedia](https://ja.wikipedia.org/)（CC BY-SA 4.0）の記事冒頭の概要欄から取得します。各カードから元の記事にリンクしています。

都道府県での絞り込みは、Wikidata に登録された所在地（市町村 → 都道府県の階層）と、名称・場所・概要に含まれる地名から判定します。場所が登録されていない災害は、絞り込むと表示されないことがあります。

誰でも編集できるデータのため、内容の正確さ・網羅性は保証できません。

## 仕組み

ブラウザだけで動く静的サイトです（サーバー側の処理はありません）。ブラウザから Wikidata と Wikipedia の API に直接問い合わせます。

```
index.html        画面
js/places.js      旧国名・地方名・県庁所在地と政令市 → 都道府県の対応表
js/logic.js       日付判定・絞り込み・並び替え・SPARQLクエリ（画面に依存しない。tests/ でテスト）
js/app.js         画面の処理・通信
src/tailwind.css  Tailwind CSS の入力（ビルドして assets/app.css にする）
server/           本番（Xserver / Apache）用の .htaccess と 404 ページ
scripts/          ビルドスクリプトと OGP 画像の生成（scripts/ogp/）
tests/            ロジックのテスト（Node 標準のテストランナー）
docs/             デプロイ手順
```

## 開発

Node.js 20 以上が必要です。

```bash
npm ci                  # 依存関係のインストール
npm run build:assets    # assets/（Tailwind CSS と Font Awesome）を生成
python3 -m http.server  # http://localhost:8000/ で確認
npm test                # テスト（タイムゾーンを変えて2回実行）
```

- `assets/` と `dist/` は生成物なので Git には含めません。
- クラス名を文字列の連結で組み立てると Tailwind が検出できません。必ず完全なクラス名で書いてください。
- 外部サービスへの通信を追加・変更したら、`server/.htaccess` の CSP（`connect-src` など）も更新してください。更新漏れは本番でだけ壊れます。

## デプロイ

`main` への push で、GitHub Actions が Xserver に自動デプロイします。設定と手順は [docs/deploy-xserver.md](docs/deploy-xserver.md) を参照してください。

## ライセンス

[MIT License](LICENSE)。表示するデータ（Wikidata・Wikipedia）には、上記の各ライセンスが適用されます。
