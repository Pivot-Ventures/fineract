#!/usr/bin/env bash
# Start Pivosacc Mobile proxy (static UI + Fineract reverse proxy) on :5174
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.docker/bin:$PATH"

if lsof -tiTCP:5174 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Stopping existing process on :5174"
  lsof -tiTCP:5174 -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 1
fi

if ! curl -sk --max-time 2 https://localhost:8443/fineract-provider/actuator/health 2>/dev/null | grep -q UP; then
  echo "WARNING: Fineract health not UP at https://localhost:8443"
  echo "  From ~/Projects/sacco/fineract run: docker compose up -d"
fi

nohup python3 server.py >> /tmp/pivosacc-mobile.log 2>&1 &
echo $! > /tmp/pivosacc-mobile.pid
sleep 1
echo "Pivosacc Mobile → http://127.0.0.1:5174/"
echo "Proxy log: /tmp/pivosacc-mobile.log  pid=$(cat /tmp/pivosacc-mobile.pid)"
echo "Demo: staff mifos/password · member client Nakato Grace (#1) · tenant default"
