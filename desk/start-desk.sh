#!/usr/bin/env bash
# Start the Pivot SACCO Desk development server (static UI + Fineract proxy).
# Development only — production is served by Caddy.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5173}"
LOG="${TMPDIR:-/tmp}/pivot-desk-${PORT}.log"

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Stop whatever is listening there, or run: PORT=<other> $0" >&2
  exit 1
fi

if ! curl -sk --max-time 2 "https://${FINERACT_HOST:-localhost}:${FINERACT_PORT:-8443}/fineract-provider/actuator/health" 2>/dev/null | grep -q UP; then
  echo "WARNING: Fineract health is not UP at https://${FINERACT_HOST:-localhost}:${FINERACT_PORT:-8443}"
  echo "  From the repository root run:  docker compose up -d"
fi

PORT="$PORT" nohup python3 -u server.py >> "$LOG" 2>&1 &
PID=$!
sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  echo "Desk server failed to start — see $LOG" >&2
  exit 1
fi
echo "Pivot SACCO Desk → http://127.0.0.1:${PORT}/  (pid $PID, log $LOG)"
echo "Sign in with your Fineract user."
