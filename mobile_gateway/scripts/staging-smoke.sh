#!/usr/bin/env bash
# Run the member gateway against a staging copy of deploy/production and smoke-test it.
#
#   mobile_gateway/scripts/staging-smoke.sh ~/Projects/sacco/pivot-staging/deploy/production pivot-staging \
#       --client-id 12 [--other-savings-id 40] [--recipient-account-no 000000041] [--move-money]
#
# 1. Copies create-gateway-user.sh into the staging copy and runs it (it prompts for the staging
#    admin password, creates the least-privilege "Mobile Gateway" role/user, stores the password in
#    that copy's .env and starts the gateway). Skip with SKIP_USER=1 once it has been done.
# 2. Starts the gateway on 127.0.0.1:${GATEWAY_SMOKE_PORT:-8710} via staging-gateway.override.yml
#    (the staging copy's docker-compose.yml and Caddy are not changed).
# 3. Runs staging_smoke.py, which prompts for a Desk staff login.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
staging="$(cd "${1:?staging deploy/production folder}" && pwd)"
project="${2:?compose project name, e.g. pivot-staging}"
shift 2

export COMPOSE_PROJECT_NAME="$project"
export COMPOSE_FILE="$staging/docker-compose.yml:$here/staging-gateway.override.yml"
export GATEWAY_SRC="$repo/mobile_gateway"
port="${GATEWAY_SMOKE_PORT:-8710}"

if [[ "${SKIP_USER:-}" != 1 ]]; then
  install -m 755 "$repo/deploy/production/scripts/create-gateway-user.sh" "$staging/scripts/create-gateway-user.sh"
  (cd "$staging" && ./scripts/create-gateway-user.sh)
fi
(cd "$staging" && docker compose up -d --build gateway)

for _ in $(seq 30); do
  curl -fsS "http://127.0.0.1:$port/v1/health" > /dev/null 2>&1 && break
  sleep 2
done
python3 "$here/staging_smoke.py" --gateway "http://127.0.0.1:$port" "$@"
echo "Gateway logs: (cd $staging && COMPOSE_PROJECT_NAME=$project COMPOSE_FILE=$COMPOSE_FILE docker compose logs gateway)"
