#!/usr/bin/env bash
# assets/ を生成する（Git 管理外）。要 npm ci / npm install。
#  - assets/app.css          … Tailwind CSS（index.html と js/ で使うクラスだけを含む）
#  - assets/fontawesome/     … Font Awesome（CDN に頼らず自サイトから配信するため、必要なファイルだけコピー）
set -euo pipefail

cd "$(dirname "$0")/.."

npx --no-install tailwindcss -i src/tailwind.css -o assets/app.css --minify

FA=node_modules/@fortawesome/fontawesome-free
rm -rf assets/fontawesome
mkdir -p assets/fontawesome/css assets/fontawesome/webfonts
cp "$FA"/css/{fontawesome,solid,regular,brands}.min.css assets/fontawesome/css/
# 現在の主要ブラウザはすべて woff2 に対応しているため、woff2 だけを配信する
cp "$FA"/webfonts/fa-{solid-900,regular-400,brands-400}.woff2 assets/fontawesome/webfonts/
cp "$FA"/LICENSE.txt assets/fontawesome/LICENSE.txt
echo "assets/ を作成しました"
