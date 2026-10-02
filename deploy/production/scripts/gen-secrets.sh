#!/usr/bin/env bash
# Create deploy/production/.env from .env.example with fresh random secrets.
# On an existing install it never overwrites anything (the database and tenant were created with
# those secrets): it only appends settings that are new in .env.example, generating any CHANGE_ME.
set -euo pipefail
cd "$(dirname "$0")/.."

umask 077
fill() { # line -> line with CHANGE_ME replaced by a random value
  if [[ "$1" == *=CHANGE_ME ]]; then printf '%s=%s\n' "${1%%=*}" "$(openssl rand -hex 24)"; else printf '%s\n' "$1"; fi
}

# Secrets that can be added to a running install (nothing was created with them yet).
SAFE_TO_GENERATE=(ALERTS_SERVICE_KEY)

if [[ -e .env ]]; then
  added=()
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Z0-9_]+)= ]] || continue
    key="${BASH_REMATCH[1]}"
    grep -q "^${key}=" .env && continue
    # Database and tenant secrets must never be regenerated for a stack that already exists.
    if [[ "$line" == *=CHANGE_ME && " ${SAFE_TO_GENERATE[*]} " != *" $key "* ]]; then
      echo "WARNING: $key is missing from .env and was not generated — restore it from your password manager." >&2
      continue
    fi
    fill "$line" >> .env
    added+=("$key")
  done < .env.example
  if ((${#added[@]})); then
    echo "Added to existing .env: ${added[*]}"
  else
    echo ".env already has every setting — nothing changed."
  fi
  exit 0
fi

while IFS= read -r line; do fill "$line"; done < .env.example > .env

echo "Wrote $(pwd)/.env (mode 600). Edit DESK_DOMAIN / CADDY_TLS / FINERACT_IMAGE, then keep a copy in your password manager."
