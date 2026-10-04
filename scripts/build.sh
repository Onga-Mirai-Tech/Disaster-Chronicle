#!/usr/bin/env bash
# 公開用ファイルだけを dist/ に集める。
# サーバーへはこの dist/ の中身だけがアップロードされるため、
# .git や docs、CLAUDE.md などリポジトリ管理用のファイルは公開されない。
# 公開ファイルを追加したら、下の PUBLIC_FILES にも追記すること。
set -euo pipefail

cd "$(dirname "$0")/.."

# Tailwind CSS と Font Awesome を assets/ に用意する（要 npm ci / npm install）
bash scripts/build-assets.sh

# 公開するファイル・ディレクトリ
PUBLIC_FILES=(
  index.html
  favicon.svg
  ogp.png
  js
  assets
)

rm -rf dist
mkdir -p dist

for f in "${PUBLIC_FILES[@]}"; do
  cp -R "$f" "dist/$f"
done

# サーバー（Xserver / Apache）専用の設定・エラーページ
cp server/.htaccess dist/.htaccess
cp server/404.html dist/404.html
cp server/404.css dist/assets/404.css

echo "dist/ を作成しました:"
find dist -type f | sort
