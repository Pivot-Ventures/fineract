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
- **Create charge** — `products-loans.html` POST `/charges`. The dialog picks loan or savings, flat or percent of amount, and a time type that is valid for that choice (no monthly/annual fee date). Currency defaults to UGX when UGX is in GET `/currencies` `selectedCurrencyOptions`; otherwise the first selected currency. A USD-only organisation is not rejected. Loan charges send `chargePaymentMode: 0`.
- **Edit charge** — PUT `/charges/{id}` from the charges table for loan and savings charges. Applies-to stays as stored.
- **Create loan product** — POST `/loanproducts` with `accountingRule: 1` (NONE) and `transactionProcessingStrategyCode: mifos-standard-strategy`. Fields follow the NONE retry in `scripts/seed-fineract.py` (principal min/default/max, repayments, monthly interest, no GL account ids). The loan product grid reloads after a successful save.
- **Create savings product** — POST `/savingsproducts` with the voluntary savings NONE fallback (`accountingRule: 1`, monthly compounding and posting, daily balance, 365-day year, no GL account ids).

### LIVE writes added 2026-10-01 (follow-up, chart seeded)
Live inventory used here: 39 GL accounts and 7 financial-activity mappings, with activity 101 on vault `1110` and activity 102 on teller `1120`. Cash product dialogs prefer those codes, then the first GL of the right type.

- **Floating rates** — `products-loans.html` POST/PUT `/floatingrates`. The period date must be after the business date (`GET /businessdate`). Edit adds one future period; past periods are left alone.
- **Share product** — POST `/products/share`. Accounting None, or Cash with `shareReferenceId` (1120), `shareSuspenseId`, `shareEquityId`, `incomeFromFeeAccountId`.
- **Fixed deposit** — POST `/fixeddepositproducts` with a 6–24 month chart, `interestPostingPeriodType` 4, and `depositAmount`. Cash uses the savings reference/control set (reference defaults to 1120).
- **Recurring deposit** — POST `/recurringdepositproducts` with the same chart plus monthly `recurringFrequency`.
- **Edit loan / savings product** — PUT `/loanproducts/{id}` and PUT `/savingsproducts/{id}`. Accounting can stay None or switch to Cash (rule 2) with GL pickers. Create still posts accounting NONE; cash is chosen on edit.
- **Provisioning** — `accruals.html` POST `/provisioningcriteria` (one age bucket) and POST `/provisioningentries`.
- **Client address** — `client-detail.html` turns on `configurations/name/enable-address` when it is off, then POST `/client/{id}/addresses?type=`. Family stays unwired.
- **Accounting rule** — when none exist, the create dialog debits vault 1110 (else teller 1120) and credits a liability.
- **Buy shares** — teller desk, only after a share product exists. POST `/accounts/share`, then `command=approve` and `command=activate`. The client must already have a savings account.

### Desk screens added for existing Fineract APIs (2026-10-01)
These call the live REST API. A failed call stays a toast. Nothing here is a mock success.

- **Recurring deposits** — `recurring-deposits.html`, `rd-detail.html`. POST/PUT `/recurringdepositproducts`. POST `/recurringdepositaccounts`, then `command=approve`, `command=activate`, `transactions?command=deposit`, `command=prematureClose`, `command=close`.
- **Settings** — `settings.html`. GET/PUT `/configurations` (including `enable-address`). GET/PUT `/currencies`. GET/POST/PUT `/paymenttypes`. GET/POST/PUT `/funds`. GET/POST `/holidays` and `command=activate`. GET/PUT `/workingdays`. GET/POST `/taxes/component` and `/taxes/group`. GET/POST `/delinquency/ranges` and `/delinquency/buckets` when that API exists; a 404 disables create and says so.
- **System** — `system.html`. GET `/jobs`, POST `/jobs/{id}?command=executeJob`, GET `/jobs/{id}/runhistory`. GET `/audits` with action, entity, and maker date filters. GET `/makercheckers`, POST `/makercheckers/{auditId}?command=approve|reject`. POST `/scheduler?command=start|stop`. PUT `/caches`. GET `/hooks` is list-only.
- **Staff and users** — `staff.html` GET/POST/PUT `/staff`. `users.html` GET/POST/PUT `/users` using `/users/template`. `roles.html` stays on the roles and permissions APIs.
- **Shares and fixed deposits** — `shares.html`, `share-detail.html`, `fixed-deposits.html`, `fd-detail.html` are in git (they were droplet-only). Dividends: POST `/shareproduct/{id}/dividend` and `command=approve`.
- **Standing instructions** — savings and client detail. GET/POST `/standinginstructions`, PUT `?command=delete` to cancel.
- **Loan reschedule** — loan detail. POST `/rescheduleloans`, then `command=approve` or `command=reject`. Reasons come from code `LoanRescheduleReason`.
- **Member import** — Clients. GET `/clients/downloadtemplate?legalFormType=CLIENTS_PERSON`, POST multipart `/clients/uploadtemplate`, GET `/imports?entityType=client`. A `.csv` file is refused and is not uploaded. A successful upload reports the import id only. Desk does not claim members were created.

Portfolio at Risk stays a Desk calculation over loan data. The SQL report still throws BadSqlGrammar on this database, and Collections does not depend on it.

### Still not a working write (labeled in the UI)
- KYC queue, family datatable, reversing the old mock journal refs.
- New loan and savings products are created with accounting NONE. Edit can switch an existing product to cash when the chart is seeded.
- Cash in/out will **not** hit a cashier whose staff is not the logged-in user. Joseph's drawer is the one tied to `mifos`.
- Hook create is not posted. The hooks list is the whole screen.

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
