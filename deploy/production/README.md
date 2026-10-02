# Pivot SACCO — production deployment

This folder runs Fineract, PostgreSQL and the Desk UI for real member data. The repository-root
`docker-compose.yml` is Apache Fineract's **testing** stack: it runs with the test profile, remote
debugging, published database port, default passwords and the `Asia/Kolkata` tenant timezone.
Never put member data in it.

```
staff browser ──HTTPS──► caddy :443 ──┬── /              → desk/*.html, desk/assets/*, payments-portal/, transactional-alerts/
member app ─────HTTPS──►              ├── /fineract-provider/api/* → fineract:8080 ──► db:5432
                                      ├── /mobile/api/*  → gateway:8000 ──► fineract (service user)
                                      ├── /alerts/api/*  → alerts:8095  ──► Africa's Talking / LipeChat
                                      ├── /payments/*    → $PAYMENTS_UPSTREAM (docs + internal routes → 404)
                                      └── everything else → 404       (private network, no host ports)
```

| Concern | How this stack handles it |
|---|---|
| Secrets | Random per install (`scripts/gen-secrets.sh` → `.env`, mode 600, git-ignored). Fineract connects as a non-superuser role that owns only its two databases. Both tenant master-password keys are set. |
| Exposure | Only Caddy publishes ports. No actuator info/metrics, Swagger or API docs. Desk server scripts, READMEs and seed scripts are not served. |
| TLS | Caddy: Let's Encrypt (public DNS) or its own internal CA (LAN only). HSTS, CSP, no framing. |
| Runtime | No test profile, no JDWP debug port, TLS verification on for outbound calls, 2 GB heap, restart on failure, log rotation. |
| Timezone | Tenant created as `Africa/Kampala`, so end-of-day jobs run at Kampala midnight. (The JVM stays on UTC by design; business dates follow the tenant timezone.) |
| Data | Named volumes for the database and for client photos/documents (previously lost on every restart because they lived in `/tmp`). |
| Backups | `scripts/backup.sh` (nightly), `scripts/verify-backup.sh` (proves a restore), `scripts/restore.sh`. |

Validated on 2026-09-30 on a scratch copy of this stack:
- fresh tenant came up in `Africa/Kampala`
- only Caddy published ports
- every blocked path returned 404
- `harden-tenant.sh` made the default credentials return 401
- backup → verify → delete a record → restore brought the record back
- a client photo survived a Fineract restart

## 1. First install

Requirements: a Linux server (4 vCPU / 8 GB RAM / 100 GB SSD is comfortable for one SACCO), Docker
Engine with the compose plugin, and this repository checked out (e.g. `/opt/pivot-sacco`).

```bash
cd /opt/pivot-sacco/deploy/production
./scripts/gen-secrets.sh
```

Edit `.env`:
- **`DESK_DOMAIN`** is the name staff type in the browser.
  - With a public DNS record pointing at the server (ports 80 and 443 reachable from the internet), set `CADDY_TLS` to an e-mail address. Caddy obtains and renews a Let's Encrypt certificate.
  - For branch-LAN only, keep `CADDY_TLS=internal`. Add `DESK_DOMAIN` to the branch DNS or to each PC's hosts file, then install Caddy's root certificate on every staff PC (step 3).
- **`FINERACT_IMAGE`**: pin the image you tested by digest (`docker images --digests`). Never deploy `latest` blindly.

**Copy `.env` into the SACCO's password manager.** The database and the tenant are created with these secrets, and the backups can only be read with them.

```bash
docker compose up -d
docker compose ps          # wait until fineract is "healthy" (first boot 2–4 min)
```

## 2. Harden the new tenant (once)

```bash
./scripts/harden-tenant.sh
```

It logs in with the install default `mifos` / `password`, then:
- asks for a new `mifos` password; Fineract's policy is 12–50 characters with upper, lower, digit and symbol, no spaces, and no character twice in a row;
- locks `interopUser` with a random password nobody knows;
- turns on lockout after 5 failed logins, a forced password change on first login, 90-day expiry and a 3-password reuse history.

Next, in Desk (logged in as `mifos`):
1. Create named users for real people, with roles limited to their jobs (teller, loan officer, branch manager, accountant, auditor).
2. After that, use `mifos` only for emergencies.

**Maker-checker is deliberately left off** so the data migration can be loaded. Switch it on once the migration has been reconciled and signed off.

**If an account gets locked out** (including `mifos`), unlock it from the server:

```bash
set -a; . ./.env; set +a
docker compose exec db psql -U "$POSTGRES_SUPERUSER" -d "$FINERACT_TENANT_DB_NAME" \
  -c "update m_appuser set nonlocked = true, failed_login_attempts = 0 where username = 'THE_USER'"
```

## 3. Staff PCs (only with `CADDY_TLS=internal`)

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > pivot-sacco-root.crt
```

Install `pivot-sacco-root.crt` as a trusted root certificate on each staff PC (Windows: `certmgr.msc`
→ Trusted Root Certification Authorities). Then open `https://<DESK_DOMAIN>/`.

## 4. Backups: set them up before loading any member data

```bash
sudo mkdir -p /var/backups/pivot-sacco
./scripts/backup.sh                                        # run once by hand
./scripts/verify-backup.sh /var/backups/pivot-sacco/<stamp>  # proves it restores
```

Schedule it nightly (crontab of a user in the `docker` group):

```
30 1 * * *  /opt/pivot-sacco/deploy/production/scripts/backup.sh >> /var/log/pivot-backup.log 2>&1
```

Each run produces the following, keeping `BACKUP_RETENTION_DAYS` days of backups:
- `pg_dump` custom-format dumps of `fineract_tenants` and the tenant database
- the role definitions
- a tarball of client photos and documents
- `SHA256SUMS`

**A backup on the same disk is not a backup.** Set `BACKUP_OFFSITE_CMD` (e.g. `rclone copy` to cloud storage), or copy the folder off the server every day. Run `verify-backup.sh` on an off-site copy once a month and note the result.

To restore into production (stops Fineract and replaces **all** data):

```bash
./scripts/restore.sh /var/backups/pivot-sacco/<stamp> --replace-all-data
```

## 5. Upgrades

1. Run `./scripts/backup.sh`.
2. Test the new image on a copy: restore the latest backup into a separate stack with `COMPOSE_PROJECT_NAME=pivot-staging` and different ports.
3. Set the new digest in `FINERACT_IMAGE`.
4. Run `docker compose up -d` and watch `docker compose logs -f fineract` until Liquibase finishes.

## 6. Transactional alerts and the payments portal

**Alerts** (`alerts` service, SMS via Africa's Talking, WhatsApp via LipeChat):
1. `./scripts/gen-secrets.sh` — on an existing install it only appends new settings such as `ALERTS_SERVICE_KEY` (the key the member gateway uses to call the alerts service).
2. `cp ../../alerts/.env.example alerts.env && chmod 600 alerts.env`, then fill in the provider credentials. It stays a dry run until you also set `ALERTS_LIVE=true`. See [alerts/README.md](../../alerts/README.md).
3. `docker compose up -d --build alerts gateway caddy`.
4. Open Desk → **Transactional alerts** as an administrator, check the templates, then send a test SMS to a staff phone.

The service is not published. Caddy strips any browser-supplied `X-Alerts-Service-Key`, and the service checks the Desk staff login against Fineract on every call. Desk events carry only Fineract ids; the service reads the amount, phone and balance from Fineract itself. Only Ugandan mobile numbers are accepted, and sends per phone and per day are capped.

**Payments portal** (`/payments-portal/`): set `PAYMENTS_UPSTREAM` to the payments middleware (`host:port` or an `https://` URL) and run `docker compose up -d caddy`. Without it, `/payments/*` answers 502 and the portal shows "gateway unavailable". It never falls back to demo data; the demo book loads only with `?demo=1` in development. The middleware's Swagger and `/payments/internal/*` routes are not exposed.

## Not covered here (next steps before migration)

- **Finance setup:**
  - the SACCO chart of accounts
  - loan and savings products with cash or accrual accounting (the dev tenant's products use `NONE`)
  - a share product
  - code values: Gender, ClientType, National ID (NIN), closure reasons
  - payment types: MTN MoMo, Airtel Money, banks, Migration
  - Uganda public holidays and working days
- **Report fixes:** Portfolio at Risk and 21 other loan reports fail on PostgreSQL (`currency_code` compared with a bigint parameter). They need a Liquibase changeset in this repository and a rebuilt image.
- **Member mobile app:** served through the `gateway` service (member PIN, device binding, ownership checks). Run `scripts/create-gateway-user.sh` once, and smoke-test against staging first with `mobile_gateway/scripts/staging-smoke.sh`.
