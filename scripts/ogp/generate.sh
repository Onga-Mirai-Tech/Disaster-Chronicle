#!/usr/bin/env bash
# scripts/ogp/ogp.html から OGP画像（リポジトリ直下の ogp.png, 1200x630）を作る。
# Google Chrome（ヘッドレスモード）を使う。macOS 以外では CHROME にパスを指定する。
#   例) CHROME=/usr/bin/google-chrome bash scripts/ogp/generate.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 \
  --window-size=1200,630 \
  --screenshot="$PWD/ogp.png" \
  "file://$PWD/scripts/ogp/ogp.html"

echo "ogp.png を作成しました"
