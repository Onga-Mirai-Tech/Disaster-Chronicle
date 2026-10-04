#!/usr/bin/env bash
# GitHub の Environment「production」を対話式で設定する（初回のみ）。
# docs/deploy-xserver.md の「2. GitHub 側の設定」を自動化したもの。
#
#  - 値はこのスクリプトが直接 GitHub に登録する（鍵や接続情報をチャット・ファイルに残さない）
#  - 事前に gh（GitHub CLI）でログインしておく: gh auth login
#  - DEPLOY_ENABLED は設定しない（dry_run で確認してから、手順書の「3. 初回デプロイ」で true にする）
set -euo pipefail

REPO="${REPO:-Onga-Mirai-Tech/Disaster-Chronicle}"
DOMAIN="disaster-chronicle.onga-mirai-tech.com"
MAIN_DOMAIN="onga-mirai-tech.com"
PORT=10022

gh auth status >/dev/null 2>&1 || { echo "先に gh auth login でログインしてください" >&2; exit 1; }

echo "== ${REPO} の Environment「production」を設定します =="
echo "（他のサイトと同じ Xserver アカウントなので、ホスト名・サーバーID・鍵は同じ値です）"
echo

read -r -p "SSH ホスト名（例: sv12345.xserver.jp）: " SSH_HOST
read -r -p "サーバーID（SSH ユーザー名）: " SSH_USER
read -r -p "デプロイ用の秘密鍵 [~/.ssh/xserver_onga_deploy]: " KEY_FILE
KEY_FILE="${KEY_FILE:-$HOME/.ssh/xserver_onga_deploy}"
KEY_FILE="${KEY_FILE/#\~/$HOME}"
[ -f "$KEY_FILE" ] || { echo "鍵ファイルが見つかりません: $KEY_FILE" >&2; exit 1; }

DEFAULT_PATH="/home/${SSH_USER}/${MAIN_DOMAIN}/public_html/${DOMAIN}"
read -r -p "デプロイ先 [${DEFAULT_PATH}]: " DEPLOY_PATH
DEPLOY_PATH="${DEPLOY_PATH:-$DEFAULT_PATH}"

case "${DEPLOY_PATH%/}" in
  */public_html/?*) ;;
  *) echo "デプロイ先は public_html 配下のサブドメイン用ディレクトリにしてください" >&2; exit 1 ;;
esac

echo
echo "-- サーバーに接続して、デプロイ先のディレクトリがあることを確認します"
if ! ssh -p "$PORT" -i "$KEY_FILE" -o ConnectTimeout=20 "${SSH_USER}@${SSH_HOST}" "test -d '${DEPLOY_PATH}' && echo 'OK: ${DEPLOY_PATH}'"; then
  echo "接続できない、またはデプロイ先がありません。サブドメイン設定（1-1）とSSH設定を確認してください" >&2
  exit 1
fi

echo
echo "-- ホスト鍵を取得します"
KNOWN_HOSTS="$(ssh-keyscan -p "$PORT" "$SSH_HOST" 2>/dev/null)"
[ -n "$KNOWN_HOSTS" ] || { echo "ssh-keyscan に失敗しました" >&2; exit 1; }

echo
echo "-- Environment を作成し、main ブランチのみデプロイできるようにします"
gh api -X PUT "repos/${REPO}/environments/production" \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true' >/dev/null
# 既に登録済みの場合は無視する
gh api -X POST "repos/${REPO}/environments/production/deployment-branches" -f name=main >/dev/null 2>&1 || true

echo "-- Secrets / Variables を登録します"
gh secret set XSERVER_SSH_HOST     --env production --repo "$REPO" --body "$SSH_HOST"
gh secret set XSERVER_SSH_USER     --env production --repo "$REPO" --body "$SSH_USER"
gh secret set XSERVER_DEPLOY_PATH  --env production --repo "$REPO" --body "$DEPLOY_PATH"
gh secret set XSERVER_KNOWN_HOSTS  --env production --repo "$REPO" --body "$KNOWN_HOSTS"
gh secret set XSERVER_SSH_KEY      --env production --repo "$REPO" < "$KEY_FILE"
gh variable set XSERVER_SSH_PORT   --env production --repo "$REPO" --body "$PORT"

echo
echo "完了しました。登録された項目:"
gh secret list   --env production --repo "$REPO"
gh variable list --env production --repo "$REPO"
echo
echo "次は docs/deploy-xserver.md の「3. 初回デプロイ」（DEPLOY_ENABLED は未設定のままです）"
