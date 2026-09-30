#!/usr/bin/env bash
# Start Pivot SACCO Desk proxy (static UI + Fineract reverse proxy) on :5173
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.docker/bin:$PATH"

# Stop plain http.server / old proxy on 5173
if lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Stopping existing process on :5173"
  lsof -tiTCP:5173 -sTCP:LISTEN | xargs kill 2>/dev/null || true
  sleep 1
fi

# Warn if Fineract not up
if ! curl -sk --max-time 2 https://localhost:8443/fineract-provider/actuator/health 2>/dev/null | grep -q UP; then
  echo "WARNING: Fineract health not UP at https://localhost:8443"
  echo "  From the repository root run:"
  echo "    docker compose up -d"
fi

nohup python3 -u server.py >> /tmp/pivot-proxy.log 2>&1 &
echo $! > /tmp/pivot-proxy.pid
sleep 1
echo "Pivot SACCO Desk → http://127.0.0.1:5173/"
echo "Proxy log: /tmp/pivot-proxy.log  pid=$(cat /tmp/pivot-proxy.pid)"
echo "Login: mifos / password  tenant: default"
