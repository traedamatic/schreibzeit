#!/usr/bin/env bash
# Start the family server (Bun) and the frontend (Vite) together for local dev.
# Ctrl+C stops both. Ports stay in sync: the Vite /api proxy is pointed at
# whatever port the server actually uses.
#
# Usage:  ./scripts/dev.sh            (or: npm run dev:full)
#         PORT=3000 ./scripts/dev.sh  (override server port)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"

command -v bun >/dev/null 2>&1 || { echo "bun not found — install from https://bun.com" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm not found" >&2; exit 1; }

# Resolve the server port: explicit env > server/.env > server default (7777).
if [[ -z "${PORT:-}" && -f "$SERVER_DIR/.env" ]]; then
  PORT="$(grep -E '^PORT=' "$SERVER_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)"
fi
PORT="${PORT:-7777}"
export PORT

# Install deps only when missing, so repeat starts are fast.
[[ -d "$SERVER_DIR/node_modules" ]] || (cd "$SERVER_DIR" && bun install)
[[ -d "$ROOT/node_modules" ]] || (cd "$ROOT" && npm install)

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "▶ server  : http://localhost:$PORT  (cd server && bun run dev)"
(cd "$SERVER_DIR" && PORT="$PORT" bun run dev) &
PIDS+=($!)

# Wait for /api/health so the frontend never races a half-started server.
for _ in $(seq 1 50); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

echo "▶ frontend: http://localhost:5173  (VITE_API_URL=/api → proxy → :$PORT)"
(cd "$ROOT" && SCHREIBZEIT_API="http://localhost:$PORT" VITE_API_URL=/api npm run dev) &
PIDS+=($!)

# Exit when either process exits; cleanup trap stops the other.
wait -n
