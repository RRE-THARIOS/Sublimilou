#!/usr/bin/env bash
# Télécharge yt-dlp pour les fonctions Netlify (Linux) ou le dev local (macOS/Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/netlify/functions/bin"
mkdir -p "$BIN_DIR"
TARGET="$BIN_DIR/yt-dlp"

if [ -f "$TARGET" ] && [ -x "$TARGET" ]; then
  echo "yt-dlp déjà présent: $TARGET"
  exit 0
fi

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
elif [ "$OS" = "Linux" ]; then
  URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
else
  echo "OS non supporté pour yt-dlp: $OS" >&2
  exit 1
fi

echo "Téléchargement yt-dlp ($OS)…"
curl -fsSL "$URL" -o "$TARGET"
chmod +x "$TARGET"
echo "OK → $TARGET"
