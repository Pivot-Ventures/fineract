# Pivot SACCO Desk — Live Fineract wiring

Status as of 2026-09-30 (Africa/Kampala): **Fineract UP**, UI proxy on **:5173**, progressive LIVE screens.

## Architecture

```
Browser  http://127.0.0.1:5173/
   │  static HTML/CSS/JS (desk/)
   │  /fineract-provider/*  ──proxy──►  https://localhost:8443/fineract-provider/*
Docker   apache/fineract (image tag fineract:latest) + postgres
```

CORS is avoided by serving the UI and API under the same origin via `server.py`.

## 1. Start Fineract (Docker)

```bash
# From the repository root (this fineract checkout)
# First time only, if you are using the published image instead of a local build:
docker pull apache/fineract:latest
docker tag apache/fineract:latest fineract:latest

# macOS AirPlay Receiver often binds host port 5000, which docker-compose.yml
# also publishes. Copy the example so Compose publishes only 8443:
cp docker-compose.override.yml.example docker-compose.override.yml

docker compose up -d
```

Wait until healthy (first boot ~1–3 min for DB migrate):

```bash
curl -sk https://localhost:8443/fineract-provider/actuator/health
# → {"status":"UP", ...}
```

Confirm auth (JSON body required):

```bash
curl -sk -u mifos:password \
  -H 'Fineract-Platform-TenantId: default' \
  -H 'Content-Type: application/json' \
  -d '{"username":"mifos","password":"password"}' \
  -X POST https://localhost:8443/fineract-provider/api/v1/authentication
```

**Credentials:** `mifos` / `password` · tenant `default`

## 2. Start UI + proxy

```bash
cd desk
./start-desk.sh
# or: python3 server.py
```

Open **http://127.0.0.1:5173/** → login.html

Do **not** use `python -m http.server` — it has no API proxy and browsers will hit CORS.

## 3. Smoke checklist

| Check | Result |
|-------|--------|
| Docker daemon | OK (Docker Desktop 4.93, engine 29.8) |
| Health URL | `https://localhost:8443/fineract-provider/actuator/health` → UP |
| Proxy URL | `http://127.0.0.1:5173/` |
| Login | LIVE — POST `/authentication` stores `base64EncodedAuthenticationKey` |
| List clients | LIVE — GET `/clients` |
| Create client | LIVE — POST `/clients` (onboard wizard final step) |
| Client detail | LIVE — GET `/clients/{id}` + `/accounts` |
| List loans | LIVE — GET `/loans` (empty until products/loans exist) |
| Loan detail | LIVE — GET `/loans/{id}?associations=all` |
| Savings list/detail | LIVE — `/savingsaccounts` |
| Tellers / cashiers | LIVE — `/tellers`, `/tellers/{id}/cashiers` |
| Chart of accounts | LIVE — GET `/glaccounts` |
| Journal entries | LIVE — GET `/journalentries` |
| Offices / staff | LIVE — GET `/offices`, `/staff` |
| Loan / savings products | LIVE — GET `/loanproducts`, `/savingsproducts` |
| Dashboard KPIs | LIVE counts from clients/loans/savings |

## 4. LIVE vs still MOCK / thin

### LIVE (session hits real API)
- login.html
- dashboard.html (counts; activity = recent clients)
- clients.html, client-detail.html, client-onboard.html
- loans.html, loan-detail.html
- savings.html, savings-detail.html
- tellers.html, teller-detail.html, teller.html (list/status; txn desk limited)
- accounting.html, journals.html
- offices.html, products-loans.html

### LIVE writes added 2026-09-30 (afternoon, Kampala)
- **Create teller** — `tellers.html` POST `/tellers` with numeric status (`300` active, `100` pending, `400` inactive, `600` closed). List refreshes. Edit is PUT `/tellers/{id}` (click a row, then Edit).
- **Assign / edit cashier** — `teller-detail.html` POST/PUT `/tellers/{id}/cashiers` using `/cashiers/template` staff list, date range, `isFullDay`.
- **Allocate** — POST `/tellers/{tellerId}/cashiers/{cashierId}/allocate` (not under `/transactions`). Body: `txnDate`, `txnAmount`, `currencyCode`, `txnNote`, `locale`, `dateFormat`.
- **Settle** — POST `.../settle` with the same body. EOD page and teller desk both post it.
- **Cash in / cash out** — this Fineract build has no cashier cash-in POST. Types 103/104 are savings deposits and withdrawals (and loan cash) joined onto the cashier whose **staff id matches the logged-in user**. Desk buttons POST `/savingsaccounts/{id}/transactions?command=deposit|withdrawal` with `paymentTypeId` 4 (Cash). `mifos` was linked to staff #2 (Joseph, cashier #1) so those txns show on that drawer.
- **Journal** — POST `/journalentries` with live GL ids.
- **Loan apply** — POST `/loans` from template, then approve and disburse when the API accepts the dates.
- **Loan repay / disburse**, **savings deposit / withdraw / open**.
- **Groups** POST `/groups`, **centres** POST `/centers`, **collections** from GET `/loans`.
- **Trial balance / income statement / balance sheet** — `/runreports/Trial Balance Table`, `Income Statement Table`, `Balance Sheet Table` with `R_startDate`, `R_endDate`, `R_officeId`.
- **Member statement** — real savings and loan transactions.
- **GL create, closures, accounting rules, financial activity mappings, run accruals, client image** (multipart `/clients/{id}/images`).

### Still not a working write (labeled in the UI)
- Buy shares — no share product.
- Portfolio at Risk `/runreports` — report exists but SQL throws BadSqlGrammar on this database. Collections lists loans instead.
- Loan-product wizard, floating rate edit, CSV import, KYC queue, family/address datatables, provisioning criteria create, reversing the old mock journal refs, global settings screen.
- Cash in/out will **not** hit a cashier whose staff is not the logged-in user. Joseph's drawer is the one tied to `mifos`.

Smoke (already run): POST teller #2, POST cashier #2 (Mary), POST allocate 50,000 on cashier #1, savings deposit 25,000 shows as Cash In, POST settle 1,000. Drawer net after that was UGX 574,000.

LIVE chip appears in topbar/sidebar when session exists; banner turns teal **LIVE**.

## 5. Files added

| File | Role |
|------|------|
| `server.py` | Static + `/fineract-provider` reverse proxy |
| `start-desk.sh` | Kill :5173 conflict, start proxy |
| `assets/api.js` | Auth, get/post/put/del, session, helpers |
| `assets/pages.js` | Per-page LIVE wiring |
| `assets/app.js` | Shared UI (tabs, wizard, search) |
| `docker-compose.override.yml.example` (repo root) | Drop host `:5000` (copy to `docker-compose.override.yml`) |

## 6. Gaps / blockers

1. **Empty demo seed** — a fresh Fineract database comes up with Head Office only: **0** GL accounts, loan/savings products, staff, tellers. Client create works. Load the starter chart, products, staff, and teller with `desk/scripts/seed-fineract.sh` (or create them from Desk). Mifos X web-app is not part of this product.
2. **Port 5000** — macOS AirPlay Receiver binds `:5000`. `docker-compose.override.yml.example` publishes only `8443`. Copy it to `docker-compose.override.yml`. Do not drop that override while AirPlay still holds port 5000.
3. **Docker PATH** — use `export PATH="$HOME/.docker/bin:$PATH"`.
4. **No volumes deleted** — DB data persists in Docker volumes.
5. **Complex commands** (disburse, settle cashier, journal create) — templates exist upstream; UI posts only where payload is clear; failures show error toasts.
6. Proxy is a foreground/nohup Python process — re-run `./start-desk.sh` after reboot.

## 7. Quick restart

```bash
# repository root
docker compose up -d
cd desk && ./start-desk.sh
# open http://127.0.0.1:5173/login.html
```
