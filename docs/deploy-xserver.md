# Xserver（独自ドメイン）へのデプロイ手順

- 公開URL: `https://disaster-chronicle.onga-mirai-tech.com/`
- ホスティング: Xserver（レンタルサーバー）。`onga-mirai-tech.com` の**サブドメイン**として配信します。
- 他のサイト（`ongatown-kosodate-support-navi` など）と同じ Xserver アカウント・同じ仕組みです。サーバーのホスト名・サーバーID・SSH 鍵・`known_hosts` は既存のものを流用できます。

## 仕組み

```
main へ push
   └─ GitHub Actions（.github/workflows/deploy.yml）
        ├─ build        … テスト（npm test）とビルドの確認
        ├─ deploy       … scripts/build.sh で dist/ を作り、rsync over SSH で Xserver に同期
        │                 （手順は .github/actions/deploy-xserver/action.yml）
        └─ deploy-retry … deploy が失敗したときだけ、別の実行環境（別の IP）でやり直す
```

- サーバーに置かれるのは `dist/` の中身だけです（`index.html` / `js/` / `assets/` / `favicon.svg` / `.htaccess` / `404.html`）。`.git` や `docs/`、`tests/` などは公開されません。
- 接続情報や鍵は **GitHub の Environment secrets にだけ**保存します。リポジトリは公開されているため、ファイルには絶対に書かないでください。
- `DEPLOY_ENABLED` が `true` になるまで、main に push してもデプロイは実行されません（テストとビルドのみ）。
- rsync は `--delete` で同期します。デプロイ先は**このサイト専用のディレクトリ**でなければなりません（`.well-known/` と `.user.ini` は消さずに残します）。

> ドメイン名は `index.html`（canonical・OGP）、`server/.htaccess`、`.github/workflows/deploy.yml`、`docs/` に書かれています。変更するときは `grep -rn onga-mirai-tech.com` で漏れなく置き換えてください。

---

## 1. Xserver 側の準備

### 1-1. サブドメインの追加

サーバーパネル → **サブドメイン設定** → 対象ドメイン `onga-mirai-tech.com` を選択 → サブドメイン `disaster-chronicle` を追加します。

作成後に表示される**ドキュメントルート**を控えてください（手順 2 の `XSERVER_DEPLOY_PATH` に使います）。通常は次の形です。

```
/home/<サーバーID>/onga-mirai-tech.com/public_html/disaster-chronicle.onga-mirai-tech.com
```

> `onga-mirai-tech.com` の DNS を Xserver 以外で管理している場合は、サブドメイン `disaster-chronicle` の A レコード（または CNAME）を Xserver に向けてください。

### 1-2. 無料独自SSLの設定

サーバーパネル → **SSL設定** → `disaster-chronicle.onga-mirai-tech.com` に無料独自SSLを追加します。DNS の反映後でないと失敗するので、失敗した場合は時間をおいて再試行してください。

### 1-3. SSH とデプロイ用の鍵

すでに他のサイトで GitHub Actions からのデプロイをしている場合、SSH の ON・「国外IPアクセス制限」の OFF・公開鍵の登録は**設定済みなので不要**です。既存のデプロイ用の鍵と `known_hosts` の値をそのまま使えます。

初めて設定する場合は次の手順です。

1. サーバーパネル → **SSH設定** → 「ON」にする。同じ画面の **「国外IPアクセス制限」を OFF** にする（初期状態の ON のままだと GitHub Actions の海外IPからの接続が拒否される。鍵認証のみなので、OFF にしても鍵を持たない人はログインできない）
2. 手元の Mac で**デプロイ専用**の鍵を作る

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/xserver_onga_deploy -C "github-actions-deploy" -N ""
   ```

3. 公開鍵（`~/.ssh/xserver_onga_deploy.pub`）をサーバーに登録する（サーバーパネル → SSH設定 → 公開鍵登録。すでに別の鍵がある場合は、パネルからだと置き換わることがあるので、SSH でログインして `~/.ssh/authorized_keys` に**追記**する）
4. 接続確認（ホスト名はサーバーパネル → サーバー情報、ユーザー名はサーバーID）

   ```bash
   ssh -p 10022 -i ~/.ssh/xserver_onga_deploy <サーバーID>@<ホスト名> 'ls ~/onga-mirai-tech.com/public_html'
   ```

5. サーバーのホスト鍵を取得する（GitHub に登録します）

   ```bash
   ssh-keyscan -p 10022 <ホスト名>
   ```

## 2. GitHub 側の設定

リポジトリの **Settings → Environments → New environment** で `production` を作成し、**Deployment branches and tags** を「Selected branches and tags」にして `main` のみ許可します。そのうえで以下を登録します。

### Environment secrets

| 名前 | 値 |
| --- | --- |
| `XSERVER_SSH_HOST` | サーバーのホスト名（例: `sv12345.xserver.jp`） |
| `XSERVER_SSH_USER` | サーバーID |
| `XSERVER_SSH_KEY` | デプロイ用の**秘密鍵**の中身すべて（BEGIN/END 行を含む） |
| `XSERVER_KNOWN_HOSTS` | `ssh-keyscan` の出力すべて |
| `XSERVER_DEPLOY_PATH` | 1-1 で控えたドキュメントルート（`.../public_html/disaster-chronicle.onga-mirai-tech.com`） |

### Environment variables

| 名前 | 値 |
| --- | --- |
| `DEPLOY_ENABLED` | 最初は未設定のまま（3 で設定） |
| `XSERVER_SSH_PORT` | `10022`（省略可） |

## 3. 初回デプロイ

1. `DEPLOY_ENABLED` を `true` に設定
2. **Actions → Build & Deploy → Run workflow** で `dry_run` にチェックを入れて実行し、ログで転送予定のファイルを確認
   - `deleting ...` に、サーバー上の消えては困るファイルが含まれていないか**必ず確認**してください（`--delete` で同期するため）
3. 問題なければ `dry_run` なしで再実行

以降は main への push（PR のマージ）で自動デプロイされます。

## 4. 動作確認チェックリスト

- [ ] `https://disaster-chronicle.onga-mirai-tech.com/` が表示され、今日の日付の前後の災害が一覧に出る
- [ ] `http://` でアクセスすると `https://` に転送される
- [ ] `https://onga-mirai-tech.com/disaster-chronicle.onga-mirai-tech.com/` が正規URLに転送される
- [ ] 存在しないURL（例: `/xxx`）で 404 ページが表示される
- [ ] ブラウザの開発者ツールのコンソールに CSP（Content-Security-Policy）違反のエラーが出ていない
- [ ] 地震のカードに、Wikipedia から補完された震度・被害の概要が表示される
- [ ] 都道府県で絞り込み、並び替え、検索範囲の変更が動く
- [ ] スマートフォン実機で表示・操作できる

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| `Host key verification failed` | `XSERVER_KNOWN_HOSTS` が `ssh-keyscan -p 10022` の出力と一致しているか |
| `Permission denied (publickey)` | 公開鍵がサーバーに登録されているか、`XSERVER_SSH_KEY` に秘密鍵全体が入っているか |
| `Connection closed by <IP> port 10022`（認証前に切断される） | SSH設定の「国外IPアクセス制限」が ON のままになっていないか |
| SSH 接続がタイムアウトする | GitHub Actions の実行環境の IP によっては接続できないことがある。deploy が失敗すると別の実行環境で deploy-retry が自動でやり直す。両方失敗したら Actions の画面で「Re-run failed jobs」。何度やっても失敗する場合は SSH 設定が ON か確認 |
| `XSERVER_DEPLOY_PATH は public_html 配下の…` | メインドメインの `public_html` 直下など、サイト専用でない場所を指定していないか（`--delete` で他サイトを消さないための安全装置です） |
| 画面が崩れる・アイコンが出ない | コンソールの CSP 違反を確認し、`server/.htaccess` の CSP を見直す |
| 検索結果が出ない・エラーが出る | Wikidata（`query.wikidata.org`）の障害・混雑の可能性。時間をおいて再検索。`server/.htaccess` の `connect-src` に Wikidata / Wikipedia が入っているかも確認 |
