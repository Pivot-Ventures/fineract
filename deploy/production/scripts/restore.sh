#!/usr/bin/env bash
# Restore a backup INTO THE RUNNING PRODUCTION STACK, replacing all current data.
# Run scripts/verify-backup.sh on the folder first.
#   Usage: scripts/restore.sh /var/backups/pivot-sacco/<stamp> --replace-all-data
set -euo pipefail
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
src="${1:?backup folder}"
[[ "${2:-}" == "--replace-all-data" ]] || { echo "Refusing: pass --replace-all-data to confirm." >&2; exit 1; }
cd "$(dirname "$0")/.."
set -a; source ./.env; set +a
tenant_db="${FINERACT_TENANT_DB_NAME:-fineract_default}"
(cd "$src" && sha256 -c SHA256SUMS)

docker compose stop caddy fineract
for db in fineract_tenants "$tenant_db"; do
  docker compose exec -T db dropdb -U "$POSTGRES_SUPERUSER" --if-exists "$db" < /dev/null
  docker compose exec -T db createdb -U "$POSTGRES_SUPERUSER" -O "$FINERACT_DB_USER" "$db" < /dev/null
  docker compose exec -T db pg_restore -U "$POSTGRES_SUPERUSER" --no-owner --role="$FINERACT_DB_USER" -d "$db" < "$src/$db.dump"
done

content_vol="$(docker compose config --format json | python3 -c 'import sys,json; print(json.load(sys.stdin)["volumes"]["content"]["name"])')"
docker run --rm -i -v "$content_vol:/data" busybox:1.37 sh -c 'rm -rf /data/* && tar -C /data -xzf - && chown -R 1000:1000 /data' < "$src/content.tar.gz"

docker compose up -d
echo "Restored from $src. Wait for Fineract to report healthy: docker compose ps"
