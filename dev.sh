#!/usr/bin/env bash
# Sayso — run the voice agent server and the web app together.
#   ./dev.sh            # server on :7860, web on :5173
#   ./dev.sh --check    # only run the provider pre-flight
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--check" ]]; then
  (cd server && uv run scripts/check_keys.py)
  exit 0
fi

command -v uv >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/"; exit 1; }
command -v npm >/dev/null || { echo "npm is required (Node 20+)"; exit 1; }

[[ -f server/.env ]] || { cp server/.env.example server/.env; echo "→ created server/.env from the example (add your keys when you have them)"; }
[[ -d server/.venv ]] || (cd server && uv sync)
[[ -d web/node_modules ]] || (cd web && npm install)

(cd server && uv run scripts/check_keys.py) || true

cleanup() { echo; echo "→ stopping"; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd server && uv run bot.py) &
(cd web && npm run dev -- --port 5173 --strictPort) &

echo
echo "  Sayso"
echo "  server  http://localhost:7860"
echo "  web     http://localhost:5173   ← open this, press Connect, and talk"
echo
wait
