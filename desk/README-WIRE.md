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
| Dashboard | Active members; active loans, principal outstanding and PAR > 30 days from one `/loans?status=300` call (`summary.overdueSinceDate`; the Portfolio at Risk report is a fallback when loans are not readable); savings balance from one `/savingsaccounts?fields=id,status,summary` call; teller cash in / out today across live drawers; work queues (loans 100 / 200, pending members, savings awaiting approval) with links; each tile shows "No access" instead of failing | — |
| Clients (`assets/members.js`) | Paged `/clients` with office + status filters; search box uses `/search?resource=clients,clientIdentifiers` (name, client no, member no / external ID, phone, NIN) and retries Title/UPPER/lower case because Fineract matches case-sensitively; “Awaiting activation” queue (`status=pending`). Profile: `/clients/{id}`, `/accounts` (loans, savings, shares), `/identifiers`, `/familymembers`, `/documents`, `/charges`, photo `/images` (data URI); addresses tab only when `enable-address` is on | Onboard wizard (`POST /clients` active or pending, then `/identifiers` with `status: Active`, `/images`, `/documents` multipart) with duplicate mobile / NIN / member-no checks via `/search?exactMatch=true` before anything is created; edit profile (`PUT /clients/{id}`, always with first + last name; clearing the officer uses `command=unassignStaff`); activate; close (`/clients/template?commandParam=close` reasons); reactivate (returns the member to pending); transfer now (`proposeAndAcceptTransfer`, no `transferDate`) or propose → accept / reject / withdraw; identifiers add/delete; next of kin add/edit/delete; documents upload/view/download/delete; photo update/remove (resized to ≤ 800 px JPEG in the browser) |
| Global search | `/search?resource=clients,loans,savings` typeahead in the top bar | — |
| Loans (`assets/loans.js`) | Paged `/loans` with status filter; search via `/search`. Loan page (`?associations=all`): schedule with paid/overdue status, transactions (receipt print, undo repayment), charges, guarantors with coverage vs the product rule, collateral, days overdue | Apply: product limits validated live, purpose (`LoanPurpose`), officer, first repayment date, linked savings, product charges + extra charges, schedule preview (`POST /loans?command=calculateLoanSchedule`), submit. Pending: approve (blocked until guarantees cover the product rule), reject, member withdrew, guarantors (`POST /loans/{id}/guarantors` `guarantorTypeId 1, entityId, savingsId, amount`; own savings = borrower as entity), collateral (`/loans/{id}/collaterals`, code `LoanCollateral`; value/description kept in a loan note because this build drops them). Approved: disburse (payment type + reference), disburse to savings (`command=disburseToSavings`), undo approval. Active: repay, repay from savings (`POST /accounttransfers` savings→loan), pay off (`transactions/template?command=prepayLoan`), waive interest, add / waive charge, write off (`WriteOffReasons`), undo disbursement. Written off: recovery payment |
| Savings (`savings.html`, `savings-detail.html`) | Paged `/savingsaccounts`; search (account no / member name, case-insensitive) and product / status filters load all accounts once and filter in the browser. Detail: balance, available (less minimum balance), holds, charges, withdrawal fee, statement with date range + print | Open account (charges attached after create), approve, activate, deposit / withdraw (payment type, receipt no., note; "Migration" excluded), transfer to own or another member's account (`POST /accounttransfers`), post interest as on a date, hold / release amount, block / unblock, pay / waive charges, undo a deposit or withdrawal, close (posts interest, transfers or pays out the balance) |
| Shares (`shares.html`, `share-detail.html`) | `/accounts/share` (paged; search / status filter in the browser), product unit price, purchases and redemptions | Open share account (dividend savings account, product lock-in), approve, activate, buy shares (`applyadditionalshares` then `approveadditionalshares`), approve / reject pending purchases, redeem (`redeemshares`; minimum holding enforced in Desk, lock-in by Fineract) |
| Fixed deposits (`fixed-deposits.html`, `fd-detail.html`) | `/fixeddepositaccounts?paged=true`, rate chart, maturity date / amount | Open FD (amount, term in months — rate from chart, funded by cash or transfer from savings, maturity instruction), approve, activate, premature close (`calculatePrematureAmount` preview, then `prematureClose` to savings or paid out), close on maturity |
| Groups / centres (`assets/members.js`) | Paged `/groups`, `/centers` with name search; member / group list via `?associations=clientMembers` / `groupMembers` | Create (active or pending, officer, centre), activate, add / remove members (`associateClients` / `disassociateClients`, active members of the same office only), add / remove groups in a centre (`associateGroups` / `disassociateGroups`, groups without a centre) |
| Teller desk | The signed-in user's own drawer (cashier whose `staffId` = the user's staff), opening float, in / out, balance, latest movements; clear notice when the login has no staff link, no cashier assignment, or the assignment does not cover today. Supervisors can view another drawer | Cash in / out and loan repayment, always Cash payment type (`isCashPayment`) and today's date; withdrawal checks the member's available balance and the drawer's cash first |
| Tellers / cashiers | `/tellers`, `/tellers/{id}/cashiers` (cashier names per teller on the list) | Create / edit teller, assign cashier from the list or the teller page (`POST /tellers/{id}/cashiers`, staff from `/cashiers/template`), edit cashier, allocate |
| Teller page / Cashier EOD | Drawer summary, UGX note + coin count, variance vs system balance, today's movements, printable EOD sheet with signature lines | Allocate (vault → till) and settle (till → vault) with denomination helper and confirm step; settle above the system balance is refused; a variance needs a note |
| Collections (`assets/loans.js`) | Active loans (`status=300`, up to 5,000) in arrears, days overdue from `summary.overdueSinceDate`, age and officer filters, PAR % (Desk-calculated; replaced by Fineract's `Portfolio at Risk` report with all 7 `R_` parameters when that report runs on the server) | — |
| Accounting (`assets/accounting.js`) | Chart of accounts tree by type with header subtotals and balances (from the Trial Balance report — `/glaccounts?fetchRunningBalance=true` fails on PostgreSQL), paged journals (date / office / GL / manual / transaction ID, page filter, CSV), journal voucher with all legs, closures, mappings, rules, provisioning entries | GL account create / edit / disable, manual multi-line journal (balanced check, rule prefill, payment type), reverse manual journal with reason, period close / re-open latest, mapping add / change / remove, rule create / delete, run accruals |
| Financial statements | Trial balance (cumulative or period, contra balances on their real side, debit = credit check), income statement, balance sheet (unclosed surplus shown under equity, A = L + E check) via `/runreports/…` with only the report's registered `R_` parameters (Fineract rejects unknown ones). Grouped by GL header; CSV export; print with SACCO header | — |
| Member statement | Savings (`/savingsaccounts/{id}?associations=transactions`), shares (`/accounts/share/{id}`) and loans, with opening / closing balances per account, summary, print layout with logo, CSV | — |
| Report catalogue (`reports.html`) | Every Table report from `/reports`, parameters rendered from each report's `reportParameters` (office, loan officer, currency / fund / product / purpose with `-1` = all, PAR basis, dates, GL, savings sub-status); results table with totals, CSV, print | — |
| Products | Loan and savings products, charges, floating rates | Create flat loan charge |
| Offices | Office tree, staff per office, holidays (`/holidays?officeId`), working days (read-only) | Create / edit office (`POST`/`PUT /offices`) |
| Roles (`roles.html`) | `/roles`, `/roles/{id}/permissions`, `/permissions?makerCheckerable=false` | Create / rename / enable / disable role, grouped permission editor (`PUT /roles/{id}/permissions`), one-click standard roles: Teller, Loan Officer, Branch Manager, Accountant, Auditor (codes checked against `/permissions`) |
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

- CSV import of members (pending members are activated from the “Awaiting activation” queue on Clients).
- Member addresses (shown read-only only when the `enable-address` configuration is on).
- Member-level charges are listed read-only (this Fineract build does not store their income GL).
- Group / centre closure (no `GroupClosureReason` / `CenterClosureReason` code values yet).
- Loan reports (Portfolio at Risk, Active Loans, Aging, Awaiting Disbursal, Funds Disbursed…) need Fineract changeset 0255 on the tenant; without it Desk shows a clear “report SQL does not run on this database” message.
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
| `assets/actions.js` | All writes (except accounting / reports) |
| `assets/frontoffice.js`, `assets/frontoffice.css` | Front office: dashboard, offices, roles, tellers, teller desk, teller page, cashier EOD (reads + writes) |
| `assets/accounting.js`, `assets/accounting.css` | Accounting, financial statements, report catalogue and member statement (reads and writes); loaded only by those pages |
| `assets/members.js` / `members.css` | Members module: clients list, onboarding, member profile, groups, centres (loaded only by those pages) |
| `assets/deposits.js` | Savings, shares and fixed deposits pages (reads and writes) |

## 8. Known gaps

1. **Empty seed** — a fresh Fineract database has Head Office only: no GL accounts, products,
   staff or tellers. Load a starter set with `desk/scripts/seed-fineract.sh`, or create them in Fineract.
2. **Search is case-sensitive** — Fineract's `/search` and `displayName` filters match case-sensitively.
3. **Port 5000** — macOS AirPlay Receiver binds `:5000`. Keep the `docker-compose.override.yml` copy.
4. **Docker PATH** — use `export PATH="$HOME/.docker/bin:$PATH"` if `docker` is not found.
