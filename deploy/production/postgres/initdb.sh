#!/bin/bash
# Runs once, on first start of an empty data volume.
# Fineract connects as a non-superuser role that owns only its two databases.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_user="$FINERACT_DB_USER" \
  -v app_pass="$FINERACT_DB_PASSWORD" \
  -v tenants_db="$FINERACT_TENANTS_DB_NAME" \
  -v tenant_db="$FINERACT_TENANT_DB_NAME" <<-'EOSQL'
  CREATE ROLE :"app_user" LOGIN PASSWORD :'app_pass';
  CREATE DATABASE :"tenants_db" OWNER :"app_user";
  CREATE DATABASE :"tenant_db" OWNER :"app_user";
  REVOKE ALL ON DATABASE :"tenants_db" FROM PUBLIC;
  REVOKE ALL ON DATABASE :"tenant_db" FROM PUBLIC;
EOSQL
