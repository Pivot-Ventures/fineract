# Pivot SACCO Desk

Static HTML UI for Pivot SACCO on the **Apache Fineract** backend in this repository. This is the product frontend.

**Mifos X web-app is not part of this product.** Do not use the Mifos community app or the [Pivot-Ventures/web-app](https://github.com/Pivot-Ventures/web-app) fork (deprecated).

**Brand:** Pivot SACCO Desk · **UGX** · Kampala


## Live Fineract wiring

See **[README-WIRE.md](README-WIRE.md)** for Docker, the development proxy and what is live.

From this directory:

```bash
./start-desk.sh
# http://127.0.0.1:5173/  — sign in with your Fineract user (tenant: default)
```

From the repository root:

```bash
docker compose up -d          # Fineract on https://localhost:8443
cd desk && ./start-desk.sh    # Desk on http://127.0.0.1:5173
```

Do not serve `desk/` with `python3 -m http.server`: it has no API proxy. `server.py` is a
development server only; production is served by Caddy. To try the mobile-banking card, alerts or
payments portal locally, point it at those services: `GATEWAY_URL=http://127.0.0.1:8700`,
`ALERTS_URL=http://127.0.0.1:8095`, `PAYMENTS_URL=http://127.0.0.1:3000`.

## Screens

### Core
| File | Screen |
|------|--------|
| login.html | Login + tenant |
| dashboard.html | KPIs + queues |
| index.html | → login |

### Front office / tellers
| File | Screen | Fineract |
|------|--------|----------|
| teller.html | Day desk, float, actions | `/tellers/.../transactions` |
| tellers.html | Tellers by office | `/tellers` |
| teller-detail.html | Cashiers, allocate | `/cashiers`, `/allocate` |
| cashier-eod.html | EOD settle + denominations | `/settle`, `/summaryandtransactions` |
| collections.html | Overdue / collections | PAR / collection sheet |

### Members
| File | Screen | Fineract |
|------|--------|----------|
| clients.html | Paged member list, name search | `/clients` |
| client-onboard.html | Wizard: personal → photo → ID → office → review | `POST /clients`, `/images`, `/identifiers` |
| client-detail.html | Profile, loans, savings, photo, transfer/close | `/clients/{id}` |
| member-statement.html | Date range + print | savings `/transactions/search`, `/loans/{id}` |
| groups.html | Groups | `/groups` |
| centres.html | Centres | `/centers` |

### Portfolio
| File | Screen | Fineract |
|------|--------|----------|
| loans.html | Portfolio | `/loans` |
| loan-detail.html | Schedule, txns, approve / reject / disburse / repay | `/loans/{id}` |
| loan-apply.html | Application wizard (submit only) | `POST /loans` |
| savings.html | Paged list, open account | `/savingsaccounts` |
| savings-detail.html | Account, txns, deposit / withdraw | `/savingsaccounts/{id}` |

### Accounting park
| File | Screen | Fineract |
|------|--------|----------|
| accounting.html | COA + create GL | `/glaccounts` |
| journals.html | Search / reverse | `/journalentries` |
| journal-entry.html | Create manual JE | `POST /journalentries` |
| closing-entries.html | Period closures | `/glclosures` |
| financial-mappings.html | Activity → GL | `/financialactivityaccounts` |
| accounting-rules.html | Rules + frequent postings | `/accountingrules` |
| accruals.html | Run accruals, list provisioning entries | `/runaccruals`, `/provisioningentries` |
| trial-balance.html | Trial balance | `/runreports/Trial Balance Table` |
| income-statement.html | Income statement | `/runreports/Income Statement Table` |
| balance-sheet.html | Balance sheet | `/runreports/Balance Sheet Table` |

### Org / products / reports
| File | Screen |
|------|--------|
| offices.html | Offices + staff |
| products-loans.html | Products, charges, floating rates |
| reports.html | Report catalog + user list |

Shared: `assets/api.js` (API client, session, dialogs), `assets/app.js` (shell, auth guard), `assets/pages.js` (read views), `assets/actions.js` (writes), `assets/app.css`

### Payments portal
Static ops UI in `payments-portal/` (overview, payments, run detail, reports, channels). It needs a Desk session and calls `/payments/...` on the same host (Caddy proxies it to `PAYMENTS_UPSTREAM`). A failed read shows an error, never sample numbers; the 100-intent demo book loads only with `?demo=1` (development). See [payments-portal/README.md](payments-portal/README.md).

### Transactional alerts
Static ops UI in `transactional-alerts/` (templates, delivery log, test send). It calls `/alerts/api/v1` on the same host with the staff member's Desk login; editing templates needs `ALL_FUNCTIONS` (or `ALERTS_ADMIN_PERMISSION`). The Node service lives in `alerts/` and runs as the `alerts` service in `deploy/production` (or on the droplet via **Deploy SACCO Alerts**). See [../alerts/README.md](../alerts/README.md). Successful teller, savings and loan postings send only the Fineract transaction id from `assets/transactional-alerts.js`; the service reads the facts from Fineract. Mobile-banking alerts (PIN, new phone, block) come from the member gateway. Activation codes are never sent.

## Design refs (URLs only — do not copy paid assets)
- FintechWeb ThemeForest finance admin
- Geex banking patterns
- LoanProX loan lifecycle
- Unity SACCO CodeCanyon listings

## Out of scope
Fineract stays at the repository root and is reached through the `server.py` proxy. Do not vendor Mifos community-app or web-app. Do not require Envato or ThemeForest purchases; the design references above are URLs only.
