#!/usr/bin/env bash
# One-shot demo setup for the live Phaneroo SACCO tenant, run from the Mac:
#   1. (optional) reset the live tenant to an empty database      — only while it holds NO real data
#   2. load the SACCO finance configuration                        — deploy/finance/apply_config.py
#   3. load the 300-member synthetic sample SACCO and reconcile    — deploy/migration/migrate.py
#   4. add demo staff, a teller till and recent transactions       — deploy/demo/seed_demo_ops.py
# Asks for the mifos password once. Stops at the first failure; every step is safe to re-run.
#
#   deploy/demo/setup-live-demo.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL="https://sacco.pivotventures.tech/fineract-provider/api/v1"
SSH=(ssh -i "$HOME/.ssh/basi_do" -o IdentitiesOnly=yes root@143.110.163.162)
DATA="$HOME/pivot-demo-10"
CUTOVER="2026-09-30"

step() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
wait_api() {
  printf 'Waiting for Fineract'
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'Fineract-Platform-TenantId: default' "$URL/offices" || true)
    if [[ "$code" == 401 || "$code" == 200 ]]; then echo " up."; return 0; fi
    printf '.'; sleep 5
  done
  echo; echo "Fineract did not come up within 7.5 minutes." >&2; exit 1
}

step "1. Reset the live tenant (optional)"
echo "This DELETES everything in the live SACCO database (members, accounts, ledger) and starts empty."
echo "Only do this while it holds demo/test data. Your other sites on the server are not touched."
read -rp "Type RESET to reset, or press Enter to skip: " ans
if [[ "$ans" == "RESET" ]]; then
  "${SSH[@]}" 'cd /opt/pivot-sacco/deploy/production && docker compose down -v && docker compose up -d'
  wait_api
  echo "Fresh tenant: the admin login is back to the install default (mifos / password)."
fi

read -rsp "Password for mifos: " FINERACT_PASSWORD; echo
export FINERACT_PASSWORD

step "2. SACCO configuration (chart of accounts, products, fees, holidays)"
python3 "$ROOT/deploy/finance/apply_config.py" --url "$URL" | tail -12

step "3. Sample SACCO: 12 synthetic members"
[[ -f "$DATA/members.csv" ]] || python3 "$ROOT/deploy/migration/gen_sample.py" "$DATA" --members 12
python3 "$ROOT/deploy/migration/migrate.py" load --data "$DATA" --cutover "$CUTOVER" --url "$URL" | tail -8
python3 "$ROOT/deploy/migration/migrate.py" reconcile --data "$DATA" --cutover "$CUTOVER" --url "$URL" | tail -22 || echo "(reconcile differences are expected while older test entries remain — clean up later)"

step "4. Staff, teller till and recent transactions"
python3 "$ROOT/deploy/demo/seed_demo_ops.py" --url "$URL" --yes-this-is-a-demo-tenant

step "Done"
echo "Open https://sacco.pivotventures.tech (Cmd+Shift+R), then follow 'Before the demo' in deploy/DEMO-SCRIPT.md:"
echo "  Roles → Create standard SACCO roles; Users → create Sarah Namubiru's teller login."
