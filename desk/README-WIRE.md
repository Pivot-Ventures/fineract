# Pivot SACCO Desk — Live Fineract wiring

Every screen reads from and writes to Apache Fineract. There is no sample or placeholder
data in the pages: where Fineract has no data, the page shows an empty state; where a
feature is not built yet, the control is disabled and labelled "Not available yet".

## Architecture

```
Browser  http://127.0.0.1:5173/
   │  static HTML/CSS/JS (desk/)
   │  /fineract-provider/*  ──proxy──►  https://localhost:8443/fineract-provider/*
Docker   apache/fineract (image tag fineract:latest) + postgres
```

The UI and API share one origin, so there is no CORS. In production Caddy serves the static
files and reverse-proxies `/fineract-provider/`. `server.py` is for local development only.

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

## 2. Start the development server

```bash
cd desk
./start-desk.sh              # port 5173; exits with a message if the port is busy
# or: PORT=5191 python3 server.py
```

Open **http://127.0.0.1:5173/** and sign in with your Fineract user. The tenant defaults to
`default` (change `DEFAULT_TENANT` in `assets/api.js` for another deployment).

`server.py` (development only):

- serves only `*.html`, `assets/**` and a favicon; everything else (including `server.py`,
  `scripts/`, READMEs and dotfiles) is 404, with no directory listings;
- rejects requests whose `Host` is not `127.0.0.1:PORT` / `localhost:PORT` (DNS rebinding);
- sends no CORS headers (same origin only) and caps request bodies at 20 MB;
- returns a generic `502 Upstream unavailable` and logs the detail to stderr;
- disables TLS verification only when `FINERACT_HOST` is localhost / 127.0.0.1 /
  host.docker.internal; any other upstream is verified.

## 3. Session and security

- Sign-in uses `POST /authentication`. There is no fallback: a failed sign-in shows the real error.
- `shouldRenewPassword` (Fineract answers `403` with a key) → the user must set a new password
  (`POST /users/{id}/pwd` with `password` + `repeatPassword`; a plain `PUT /users/{id}` is refused), then Desk signs in again.
- `isTwoFactorAuthenticationRequired` → sign-in is refused with "Two-factor authentication is
  not supported in Desk yet — contact your administrator".
- The session key lives in `sessionStorage` (per tab) and is never logged.
- Idle timeout 30 minutes (warning at 28), absolute timeout 12 hours. Any `401` clears the
  session and returns to `login.html?expired=1`.
- Every page redirects to sign-in without a session. A **Log out** button is in the top bar.
- Buttons for actions the user's Fineract permissions do not allow are hidden
  (`ALL_FUNCTIONS` allows everything).

## 4. What is live

| Area | Reads | Writes |
|------|-------|--------|
| Dashboard | Active members (`/clients?status=active`), active / pending / approved loans (`/loans?status=300/100/200`), savings accounts, recent members | — |
| Clients | Paged `/clients` with name search (`displayName`, case-sensitive) and status filter | Onboard (`POST /clients`, photo `/images`, identifier `/identifiers`), edit, close (reason from `ClientClosureReason` code), propose transfer, update photo |
| Global search | `/search?resource=clients,loans,savings` typeahead in the top bar | — |
| Loans | Paged `/loans` with status filter; search via `/search` | Apply = **submit only** (`POST /loans`). On the loan page: Approve / Reject (pending), Disburse (approved), Repay (active) |
| Savings | Paged `/savingsaccounts`; search via `/search` | Open account (optionally approve + activate), deposit, withdraw |
| Groups / centres | Paged `/groups`, `/centers` with name search | Create |
| Teller desk | Cashier summary + transactions | Allocate, settle, cash in/out (savings deposit / withdrawal), loan repayment |
| Tellers / cashiers | `/tellers`, `/tellers/{id}/cashiers` (cashier names per teller on the list) | Create / edit teller, assign cashier from the list or the teller page (`POST /tellers/{id}/cashiers`, staff from `/cashiers/template`), edit cashier, allocate |
| Cashier EOD | Summary, denomination count and variance | Settle to vault |
| Collections | Active loans (`status=300`, up to 2,000) filtered to those in arrears | — |
| Accounting | Chart of accounts, paged journal entries (date / office / manual / transaction filters), closures, mappings, rules, provisioning entries | GL account, manual journal, period close / delete closure, mapping, rule, run accruals |
| Financial reports | Trial balance, income statement, balance sheet via `/runreports/…` with `R_officeId`, `R_startDate` (not for the balance sheet), `R_endDate`, `locale`, `dateFormat`, `genericResultSet=true`. They run on page load and on **Run** | — |
| Member statement | Savings transactions via `/savingsaccounts/{id}/transactions/search?fromDate&toDate`, loan transactions filtered to the date range | — |
| Products | Loan and savings products, charges, floating rates | Create flat loan charge |
| Offices | Office tree, staff | — |
| Staff (`staff.html`) | `/staff?status=all[&officeId=]` | Add (`POST /staff`: officeId, firstname, lastname, isLoanOfficer, isActive, mobileNo?, externalId?, joiningDate + locale/dateFormat), edit (`PUT /staff/{id}`; Fineract ignores joiningDate there and cannot clear mobile / external ID) |
| Users (`users.html`) | `/users`, `/roles`, `/passwordpreferences` | Add (`POST /users`: username, firstname, lastname, email, officeId, staffId?, roles [ids], password + repeatPassword, sendPasswordToEmail=false), edit (`PUT /users/{id}`; password only when filled, `staffId: null` unlinks). Passwords are checked against the active policy client-side and by Fineract |

### Money-moving actions

Deposit, withdraw, repay, disburse, approve, allocate, settle, journal post and transfer all:

- start with an **empty** amount — no pre-filled figures;
- accept only a positive whole number of UGX (`5000` or `5,000`; no decimals, signs or exponents);
- default dates to today in Africa/Kampala, set at runtime;
- use a payment type chosen from `/paymenttypes` (defaults to the cash type), not a hard-coded id;
- show a confirmation step with the amount and the member / account before posting;
- disable the submit button while the request is in flight, so a double click cannot post twice.

## 5. Intentionally not available yet

Shown as disabled controls or "Not available yet" / "Not set up yet" notes:

- Share accounts and buying shares.
- CSV import of members, and a KYC review queue.
- Member family, addresses and documents tabs (photo upload works).
- Portfolio at Risk report (its SQL fails on this database — use Collections).
- Loan product creation, floating-rate editing, provisioning entry creation, a settings screen.

## 6. Required Fineract configuration

- **ClientClosureReason** code values — closing a member needs at least one. Without them Desk
  explains that an administrator must add them.
- **Customer Identifier** code values — needed to capture ID numbers during onboarding.
- **Payment types** — at least one (ideally one marked as cash) for deposits, withdrawals,
  repayments and disbursements.
- Cash in / out shows on the cashier drawer whose staff member is the signed-in user.

### Teller → cashier → staff → user

A **teller** is a till in an office. A **cashier** is a **staff** member of that office assigned to the teller
for a date range. A **user** (login) is linked to one staff record. So to give someone a till: add them under
**Staff**, assign them as cashier under **Tellers & cashiers**, then create their login under **Users** with that
staff record. New users get `shouldRenewPassword` and must set a new password at first sign-in (`POST /users/{id}/pwd`).

## 7. Files

| File | Role |
|------|------|
| `server.py` | Development static server + `/fineract-provider` proxy |
| `start-desk.sh` | Starts `server.py`; fails if the port is busy |
| `assets/api.js` | API client, session and timeouts, permissions, dialogs, typeahead, helpers |
| `assets/app.js` | Shell: auth guard, top bar, navigation, tabs, wizard |
| `assets/pages.js` | Read views for each page, server-side paging |
| `assets/actions.js` | All writes |

## 8. Known gaps

1. **Empty seed** — a fresh Fineract database has Head Office only: no GL accounts, products,
   staff or tellers. Load a starter set with `desk/scripts/seed-fineract.sh`, or create them in Fineract.
2. **Search is case-sensitive** — Fineract's `/search` and `displayName` filters match case-sensitively.
3. **Port 5000** — macOS AirPlay Receiver binds `:5000`. Keep the `docker-compose.override.yml` copy.
4. **Docker PATH** — use `export PATH="$HOME/.docker/bin:$PATH"` if `docker` is not found.
