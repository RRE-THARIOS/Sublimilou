#!/usr/bin/env bash
# Tunnel public vers le serveur Sublimilou local (port 8080).
set -euo pipefail

PORT="${PORT:-8080}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok introuvable. Installe-le : brew install ngrok"
  exit 1
fi

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Rien n'écoute sur le port ${PORT}."
  echo "Lance d'abord : npm run dev:server   (ou npm run preview)"
  exit 1
fi

echo "Tunnel ngrok → http://localhost:${PORT}"
echo "Dashboard : http://127.0.0.1:4040"
echo "Sur iPhone : ouvre l'URL https://… affichée ci-dessous (Safari → Sur l'écran d'accueil)"
exec ngrok http "$PORT"
