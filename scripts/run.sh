#!/usr/bin/env bash
# Local.Qkview — start backend + frontend, tail logs, Ctrl+C stops both.
# Assumes one-time install has been done (see README.md).
#
# Default ports (3001 / 8001) are chosen to coexist with the upstream
# f5.assistant project, which uses 3000 / 8000. Override by exporting
# FRONTEND_PORT / BACKEND_PORT before invoking this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FRONTEND_PORT="${FRONTEND_PORT:-3001}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_ORIGIN="http://localhost:${FRONTEND_PORT}"

if [[ ! -d .venv ]]; then
    echo "error: .venv/ not found. Run the install steps in README.md first." >&2
    exit 1
fi
if [[ ! -d webapp/.next ]]; then
    echo "error: webapp/.next not found. Run 'cd webapp && npm run build' first." >&2
    exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

backend_pid=""
webapp_pid=""

cleanup() {
    echo
    echo "Stopping services…"
    [[ -n "$backend_pid" ]] && kill "$backend_pid" 2>/dev/null || true
    [[ -n "$webapp_pid"  ]] && kill "$webapp_pid"  2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend on ${BACKEND_URL} …"
(cd backend && FRONTEND_ORIGIN="$FRONTEND_ORIGIN" uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT") &
backend_pid=$!

sleep 2

echo "Starting frontend on http://127.0.0.1:${FRONTEND_PORT} …"
(cd webapp && PORT="$FRONTEND_PORT" FASTAPI_BACKEND_URL="$BACKEND_URL" npm run start) &
webapp_pid=$!

echo
echo "Local.Qkview is running. Open http://localhost:${FRONTEND_PORT} — Ctrl+C to stop."
wait
