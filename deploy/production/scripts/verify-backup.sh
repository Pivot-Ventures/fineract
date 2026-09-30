#!/usr/bin/env bash
# Prove a backup restores: load it into a throwaway PostgreSQL container and print record counts.
# Does not touch the running stack.   Usage: scripts/verify-backup.sh /var/backups/pivot-sacco/<stamp>
set -euo pipefail
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
src="${1:?backup folder}"
cd "$src"
sha256 -c SHA256SUMS

name="pivot-verify-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=verify postgres:18.3 > /dev/null
trap 'docker stop "$name" > /dev/null' EXIT
until docker exec "$name" pg_isready -q -U postgres; do sleep 1; done
sleep 2

for f in *.dump; do
  db="${f%.dump}"
  docker exec "$name" createdb -U postgres "$db"
  docker exec -i "$name" pg_restore -U postgres --no-owner -d "$db" < "$f"
done

tenant_db="$(ls *.dump | grep -v '^fineract_tenants' | head -1)"
tenant_db="${tenant_db%.dump}"
docker exec "$name" psql -U postgres -d "$tenant_db" -At -F ' ' -c "
  select 'clients',       count(*) from m_client
  union all select 'savings accounts', count(*) from m_savings_account
  union all select 'loans',            count(*) from m_loan
  union all select 'journal entries',  count(*) from acc_gl_journal_entry
  union all select 'users',            count(*) from m_appuser"
echo "restore OK: $src"
