#!/usr/bin/env bash
# Create (or rotate) the Fineract service user the member gateway uses, with only the permissions
# it needs, and store its password in .env. Run once after harden-tenant.sh, then again whenever
# you want to rotate the password. The password is generated here and never shown.
#
# Permissions: read clients / savings / loans, and create account transfers (member-to-member
# transfers and loan repayments from savings). No deposits, withdrawals, approvals or admin.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source ./.env; set +a
tenant="${FINERACT_TENANT_ID:-default}"
gw_user="${GATEWAY_FINERACT_USER:-mobile-gateway}"
role_name="Mobile Gateway"
perms=(READ_CLIENT READ_SAVINGSACCOUNT READ_LOAN CREATE_ACCOUNTTRANSFER READ_ACCOUNTTRANSFER)

base="https://${DESK_DOMAIN}:${HTTPS_PORT:-443}/fineract-provider/api/v1"
curl_tls=(--resolve "${DESK_DOMAIN}:${HTTPS_PORT:-443}:127.0.0.1")
if [[ "${CADDY_TLS:-internal}" == internal ]]; then
  ca="$(mktemp)"; trap 'rm -f "$ca"' EXIT
  docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt < /dev/null > "$ca"
  curl_tls+=(--cacert "$ca")
fi
call() { # auth method path [json-body] -> prints body; returns 1 on non-2xx (body on stderr)
  local out code
  out="$(mktemp)"
  code="$(curl -sS "${curl_tls[@]}" -o "$out" -w '%{http_code}' -X "$2" \
    -H "Fineract-Platform-TenantId: $tenant" -H 'Content-Type: application/json' \
    ${1:+-H "Authorization: Basic $1"} ${4:+--data "$4"} "$base$3")"
  if [[ "$code" != 2* ]]; then cat "$out" >&2; rm -f "$out"; return 1; fi
  cat "$out"; rm -f "$out"
}
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
random_password() {
  python3 -c 'import secrets,string
s=string.ascii_letters+string.digits+"!#%*+-=?@^_"
while True:
    p="".join(secrets.choice(s) for _ in range(32))
    if any(c.isupper() for c in p) and any(c.islower() for c in p) and any(c.isdigit() for c in p) and any(not c.isalnum() for c in p) and all(a!=b for a,b in zip(p,p[1:])):
        print(p); break'
}

read -rp "Admin username: " admin
read -rsp "Password for $admin: " admin_pass; echo
auth="$(b64 "$admin:$admin_pass")"
call "$auth" GET /users > /dev/null || { echo "Login failed." >&2; exit 1; }

role_id="$(call "$auth" GET /roles | json "next((r['id'] for r in d if r['name']=='$role_name'), '')")"
if [[ -z "$role_id" ]]; then
  role_id="$(call "$auth" POST /roles "{\"name\":\"$role_name\",\"description\":\"Member gateway service account (Pivosacc app)\"}" | json "d['resourceId']")"
  echo "✓ role '$role_name' created"
fi
body="$(python3 -c 'import json,sys; print(json.dumps({"permissions": {p: True for p in sys.argv[1:]}}))' "${perms[@]}")"
call "$auth" PUT "/roles/$role_id/permissions" "$body" > /dev/null
echo "✓ role permissions: ${perms[*]}"

p1="$(random_password)"
pw_body() { P="$1" python3 -c 'import os,json; p=os.environ["P"]; print(json.dumps({"password":p,"repeatPassword":p}))'; }
user_id="$(call "$auth" GET /users | json "next((u['id'] for u in d if u['username']=='$gw_user'), '')")"
if [[ -z "$user_id" ]]; then
  body="$(P="$p1" U="$gw_user" R="$role_id" python3 -c 'import os,json; print(json.dumps({
    "username": os.environ["U"], "firstname": "Mobile", "lastname": "Gateway", "officeId": 1,
    "roles": [int(os.environ["R"])], "sendPasswordToEmail": False, "passwordNeverExpires": True,
    "password": os.environ["P"], "repeatPassword": os.environ["P"]}))')"
  user_id="$(call "$auth" POST /users "$body" | json "d['resourceId']")"
  echo "✓ user '$gw_user' created"
else
  call "$auth" PUT "/users/$user_id" "$(pw_body "$p1")" > /dev/null
  echo "✓ user '$gw_user' password rotated"
fi

# With force-password-reset-on-first-login on, Fineract makes the new password provisional: the
# user must replace it once, using its own credentials.
final="$p1"
login_out="$(curl -sS "${curl_tls[@]}" -X POST -H "Fineract-Platform-TenantId: $tenant" -H 'Content-Type: application/json' \
  --data "$(P="$p1" U="$gw_user" python3 -c 'import os,json; print(json.dumps({"username":os.environ["U"],"password":os.environ["P"]}))')" \
  "$base/authentication")"
if printf '%s' "$login_out" | json "d.get('shouldRenewPassword', False)" | grep -q True; then
  key="$(printf '%s' "$login_out" | json "d['base64EncodedAuthenticationKey']")"
  final="$(random_password)"
  call "$key" PUT "/users/$user_id" "$(pw_body "$final")" > /dev/null
  echo "✓ first-login password renewal done"
fi
call "$(b64 "$gw_user:$final")" GET "/clients?limit=1" > /dev/null || { echo "The new user cannot read clients — check the role." >&2; exit 1; }

P="$final" python3 - <<'PY'
import os, re
p = ".env"
s = open(p).read()
line = "GATEWAY_FINERACT_PASSWORD=" + os.environ["P"]
s = re.sub(r"(?m)^GATEWAY_FINERACT_PASSWORD=.*$", line.replace("\\", "\\\\"), s) if "GATEWAY_FINERACT_PASSWORD=" in s else s + "\n" + line + "\n"
open(p, "w").write(s)
PY
echo "✓ password stored in .env"
docker compose up -d gateway
echo "Done. The gateway now signs in to Fineract as '$gw_user'."
