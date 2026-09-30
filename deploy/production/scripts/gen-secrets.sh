#!/usr/bin/env bash
# Create deploy/production/.env from .env.example with fresh random secrets.
# Refuses to overwrite an existing .env: the database and tenant were created with those secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -e .env ]]; then
  echo ".env already exists — not overwriting. Delete it only if the stack has never been started." >&2
  exit 1
fi

umask 077
while IFS= read -r line; do
  if [[ "$line" == *=CHANGE_ME ]]; then
    printf '%s=%s\n' "${line%%=*}" "$(openssl rand -hex 24)"
  else
    printf '%s\n' "$line"
  fi
done < .env.example > .env

echo "Wrote $(pwd)/.env (mode 600). Edit DESK_DOMAIN / CADDY_TLS / FINERACT_IMAGE, then keep a copy in your password manager."
