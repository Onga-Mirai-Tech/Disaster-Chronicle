# Disaster Chronicle

日本の災害を「日付の前後」で検索する静的サイト（非公式）。https://disaster-chronicle.onga-mirai-tech.com/ （Xserver）

## 方針

- 秘密情報（SSH 鍵、サーバーID、ホスト名）は書かない。デプロイ接続情報は GitHub Environment `production` の secrets にある。
- 明るい配色にする（暗い・威圧感のある色は避ける）。ダークモードの自動切り替えも入れない。
- データは Wikidata（CC0）・Wikipedia（CC BY-SA 4.0）。出典表記はフッターにある。消さない。
- 防災の判断を促す表現・断定的な記述はしない（「非公式」「公式情報を確認」の注記を保つ）。

## 構成

- `index.html` / `js/app.js`（画面・通信）/ `js/logic.js`（画面に依存しないロジック）/ `js/places.js`（旧国名・地方名・県庁所在地と政令市 → 都道府県の対応表）
- `src/tailwind.css` → `scripts/build-assets.sh` が `assets/app.css` と `assets/fontawesome/` を生成（Git 管理外）
- `scripts/build.sh` — 公開ファイルだけを `dist/` に集める。公開ファイルを増やしたら `PUBLIC_FILES` に追記する。
- `server/` — 本番（Apache）専用の `.htaccess`（HTTPS・正規ホスト統一・CSP）と 404。
- `.github/workflows/deploy.yml` — PR ではテストとビルドのみ。`main` への push で rsync(SSH) デプロイ（`DEPLOY_ENABLED=true` のときのみ）。
- `docs/deploy-xserver.md` — デプロイ手順。

## 注意点（過去に問題になったこと）

- Wikidata の日付は精度（`timePrecision`）を見る。年だけ判明している日付は 1月1日 として返るため、SPARQL で 11（日）以上に絞っている。
- 地震の規模は `P2527`（モーメント）/ `P2528`（リヒター）。他の ID は無関係なプロパティなので使わない。
- 日付は `new Date()` に通さず文字列から分解する（タイムゾーンで1日ずれる）。`npm test` を TZ を変えて2回走らせているのはこのため。
- Wikipedia は記事全文ではなく `section=0`（冒頭）だけ取得する（全文は1記事で1MB超）。取得したHTMLは `stripInlineStyles` を通してから `DOMParser` に渡す（CSP 違反のコンソールエラーを防ぐ）。
- 都道府県の絞り込みは3層（`resolvePrefectures`）: ① Wikidata の所在地階層（P131*、Q50337）② 名称・場所・概要の都道府県名 ③ `js/places.js` の対応表。市町村名の対応表は持たず、Wikidata の階層に任せている（同名の市町村も区別できる）。場所が未登録の災害は判定できない（12か月分で約17%）。対応表に地名を足すときは、他の地名を部分一致で含まないか注意する（例: 「津市」は「大津市」に一致するので入れていない。「北九州」「四国中央」は `MASKED_PLACES` で先に解決している）。
- CSP は `script-src 'self'` `style-src 'self'`。インラインの `<script>` / `<style>` / `style=""` 属性を HTML に書かない（`element.style.x = ...` による設定は可）。
- ドメイン文字列は `grep -rn onga-mirai-tech.com` で全置換する。

## 確認

- `npm test`
- `bash scripts/build.sh` のあと `dist/` を配信して確認する。CSP 違反が出ないことをブラウザのコンソールで確認する（本番と同じ CSP を付けて配信しないと気づけない）。
