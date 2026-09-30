#!/usr/bin/env bash
# One-time hardening of a freshly created production tenant, through the public HTTPS endpoint:
#   1. replace the well-known default password of the built-in "mifos" superuser
#   2. lock the built-in "interopUser" with a random password nobody knows
#   3. turn on login lockout, first-login password reset, 90-day expiry and reuse history
# Maker-checker stays OFF here: switch it on after the data migration is reconciled.
# Passwords are read from the terminal and never written to disk or shown.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source ./.env; set +a

tenant="${FINERACT_TENANT_ID:-default}"
base="https://${DESK_DOMAIN}:${HTTPS_PORT:-443}/fineract-provider/api/v1"
curl_tls=(--resolve "${DESK_DOMAIN}:${HTTPS_PORT:-443}:127.0.0.1")
if [[ "${CADDY_TLS:-internal}" == internal ]]; then
  ca="$(mktemp)"; trap 'rm -f "$ca"' EXIT
  docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt < /dev/null > "$ca"
  curl_tls+=(--cacert "$ca")
fi

api() { # method path [json-body]  (uses $auth)
  local out code
  out="$(mktemp)"
  code="$(curl -sS "${curl_tls[@]}" -o "$out" -w '%{http_code}' -X "$1" \
    -H "Fineract-Platform-TenantId: $tenant" -H 'Content-Type: application/json' \
    -H "Authorization: Basic $auth" ${3:+--data "$3"} "$base$2")"
  if [[ "$code" != 2* ]]; then
    echo "HTTP $code on $1 $2: $(head -c 400 "$out")" >&2; rm -f "$out"; return 1
  fi
  cat "$out"; rm -f "$out"
}
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

b64() { printf '%s' "$1" | base64 | tr -d '\n'; }   # GNU base64 wraps long lines
# Mirrors Fineract's "strong" policy: 12-50 chars, upper, lower, digit, symbol, no spaces,
# no character repeated back to back.
policy_ok() {
  P="$1" python3 -c 'import os,re,sys; p=os.environ["P"]; sys.exit(0 if 12<=len(p)<=50 and re.search("[A-Z]",p) and re.search("[a-z]",p) and re.search("[0-9]",p) and re.search("[^A-Za-z0-9]",p) and not re.search(r"\s",p) and not re.search(r"(.)\1",p) else 1)'
}
random_password() {
  python3 -c 'import secrets,string
s=string.ascii_letters+string.digits+"!#%*+-=?@^_"
while True:
    p="".join(secrets.choice(s) for _ in range(32))
    if any(c.isupper() for c in p) and any(c.islower() for c in p) and any(c.isdigit() for c in p) and any(not c.isalnum() for c in p) and all(a!=b for a,b in zip(p,p[1:])):
        print(p); break'
}
password_body() { P="$1" python3 -c 'import os,json; p=os.environ["P"]; print(json.dumps({"password":p,"repeatPassword":p}))'; }

read -rp "Admin username [mifos]: " user; user="${user:-mifos}"
read -rsp "Current password for $user (fresh install: password): " pass; echo
auth="$(b64 "$user:$pass")"
api GET /users > /dev/null || { echo "Login failed." >&2; exit 1; }

users="$(api GET /users)"
uid() { printf '%s' "$users" | json "next((u['id'] for u in d if u['username']=='$1'), '')"; }

if [[ "$user" == mifos ]]; then
  while :; do
    read -rsp "New password for mifos (12-50 chars; upper, lower, digit, symbol; no spaces; no character twice in a row): " p1; echo
    read -rsp "Repeat: " p2; echo
    if [[ "$p1" != "$p2" ]]; then echo "Passwords differ; try again."
    elif ! policy_ok "$p1"; then echo "Does not meet the password policy; try again."
    else break; fi
  done
  api PUT "/users/$(uid mifos)" "$(password_body "$p1")" > /dev/null
  auth="$(b64 "mifos:$p1")"
  api GET /users > /dev/null
  echo "✓ mifos password changed"
fi

interop="$(uid interopUser)"
if [[ -n "$interop" ]]; then
  api PUT "/users/$interop" "$(password_body "$(random_password)")" > /dev/null
  echo "✓ interopUser locked with an unknown random password"
fi

configs="$(api GET /configurations)"
set_config() { # name enabled [value]
  local id body
  id="$(printf '%s' "$configs" | json "next(c['id'] for c in d['globalConfiguration'] if c['name']=='$1')")"
  body="{\"enabled\": $2${3:+, \"value\": $3}}"
  api PUT "/configurations/$id" "$body" > /dev/null
  echo "✓ $1 → enabled=$2${3:+ value=$3}"
}
set_config max-login-retry-attempts true 5
set_config force-password-reset-on-first-login true
set_config force-password-reset-days true 90
set_config password-reuse-check-history-count true 3

tz="$(docker compose exec -T db psql -U "$POSTGRES_SUPERUSER" -d fineract_tenants -At -c "select timezone_id from tenants where identifier='$tenant'" < /dev/null)"
echo "Tenant '$tenant' timezone: $tz"
echo "Done. Next: create named staff users with specific roles; stop using mifos day to day."
