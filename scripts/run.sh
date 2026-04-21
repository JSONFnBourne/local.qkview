#!/usr/bin/env bash
# Local.Qkview — start backend + frontend, tail logs, Ctrl+C stops both.
# Assumes one-time install has been done (see README.md).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

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

echo "Starting backend on http://127.0.0.1:8000 …"
(cd backend && uvicorn main:app --host 127.0.0.1 --port 8000) &
backend_pid=$!

sleep 2

echo "Starting frontend on http://127.0.0.1:3000 …"
(cd webapp && npm run start) &
webapp_pid=$!

echo
echo "Local.Qkview is running. Open http://localhost:3000 — Ctrl+C to stop."
wait
