#!/usr/bin/env bash
# Nightly backup: both Fineract databases (pg_dump custom format), role definitions, the member
# gateway database and the client photo/document volume. Schedule it (cron / launchd / systemd timer), e.g.:
#   30 1 * * *  /opt/pivot-sacco/deploy/production/scripts/backup.sh >> /var/log/pivot-backup.log 2>&1
set -euo pipefail
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
cd "$(dirname "$0")/.."
set -a; source ./.env; set +a

: "${BACKUP_DIR:?}" "${BACKUP_RETENTION_DAYS:=30}"
tenant_db="${FINERACT_TENANT_DB_NAME:-fineract_default}"
stamp="$(TZ=Africa/Kampala date +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/$stamp"
umask 077
mkdir -p "$dest"

dc() { docker compose "$@"; }

echo "[$stamp] backing up to $dest"
for db in fineract_tenants "$tenant_db"; do
  dc exec -T db pg_dump -U "$POSTGRES_SUPERUSER" -Fc --no-owner "$db" < /dev/null > "$dest/$db.dump"
done
dc exec -T db pg_dumpall -U "$POSTGRES_SUPERUSER" --roles-only < /dev/null > "$dest/roles.sql"

content_vol="$(dc config --format json | python3 -c 'import sys,json; print(json.load(sys.stdin)["volumes"]["content"]["name"])')"
docker run --rm -v "$content_vol:/data:ro" busybox:1.37 tar -C /data -czf - . > "$dest/content.tar.gz"

# Member gateway: PIN hashes, device bindings, limits and the mobile audit trail (online SQLite backup).
dc exec -T gateway python -c "import sqlite3; s=sqlite3.connect('/data/gateway.sqlite3'); d=sqlite3.connect('/data/backup.sqlite3'); s.backup(d); d.close()" < /dev/null
dc cp gateway:/data/backup.sqlite3 "$dest/gateway.sqlite3"
dc exec -T gateway python -c "import os; os.remove('/data/backup.sqlite3')" < /dev/null

# Alerts: delivery log, idempotency keys and send caps. Optional — skipped if the service isn't running.
if ! dc exec -T alerts tar -C /app/data -czf - . < /dev/null > "$dest/alerts-data.tar.gz" 2> /dev/null; then
  rm -f "$dest/alerts-data.tar.gz"
  echo "alerts data not backed up (service not running)" >&2
fi

# A dump that pg_restore cannot list is not a backup.
for db in fineract_tenants "$tenant_db"; do
  dc exec -T db pg_restore --list < "$dest/$db.dump" > /dev/null
done
(cd "$dest" && sha256 ./* > SHA256SUMS)
echo "[$stamp] ok: $(du -sh "$dest" | cut -f1)"

if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
  bash -c "$BACKUP_OFFSITE_CMD" _ "$dest"
  echo "[$stamp] off-site copy done"
fi

# Retention: remove backup folders older than BACKUP_RETENTION_DAYS (only our timestamped folders).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][01][0-9][0-3][0-9]-*' \
  -mtime +"$BACKUP_RETENTION_DAYS" -print -exec rm -rf {} +
