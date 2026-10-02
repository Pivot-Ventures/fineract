# Phaneroo SACCO desk

Static HTML UI for Phaneroo SACCO on the **Apache Fineract** backend in this repository. This is the product frontend.

**Mifos X web-app is not part of this product.** Do not use the Mifos community app or the [Pivot-Ventures/web-app](https://github.com/Pivot-Ventures/web-app) fork (deprecated).

**Brand:** Phaneroo SACCO · Member desk · **UGX** · Kampala · **LIVE-capable** (see README-WIRE.md)


## Live Fineract wiring

See **[README-WIRE.md](README-WIRE.md)** for Docker + proxy + LIVE screen status.

From this directory:

```bash
./start-desk.sh
# http://127.0.0.1:5173/   login mifos / password   tenant default
```

From the repository root:

```bash
docker compose up -d          # Fineract on https://localhost:8443
cd desk && ./start-desk.sh    # Desk on http://127.0.0.1:5173
```

## Open (static only — prefer start-desk.sh)

```bash
cd desk
python3 -m http.server 5173
```

**http://127.0.0.1:5173/**

## Deploy

Desk ships from `main` only. Rebase the pull request onto `main` and merge (rebase or squash). GitHub Actions runs **Deploy SACCO Desk** (`.github/workflows/deploy-desk.yml`) and rsyncs `desk/` to the droplet. That workflow is the ship path. A direct droplet rsync from a laptop or an SSH session is outside it.

- **Runs when** `main` changes `desk/**` or `.github/workflows/deploy-desk.yml`. `workflow_dispatch` on `main` syncs the current tree. The manual button is listed once this file is on the repository default branch (`develop`); pushes to `main` deploy either way.
- **Remote directory** is the `SACCO_DESK_PATH` secret, or `/opt/pivot-sacco/desk` when that secret is empty.
- **Sync** is `rsync` over SSH **without** `--delete`. Pages that exist only on the server (shares, fixed deposits, users, and similar) stay in place.
- **Not copied:** `README.md`, `README-WIRE.md`, `server.py`, `start-desk.sh`, `scripts/`, `.gitignore`.
- **Fineract and Caddy stay up.** This job copies static HTML and JS only.

Secrets: `SACCO_DESK_HOST`, `SACCO_DESK_USER`, `SACCO_DESK_SSH_KEY` (unencrypted PEM or OpenSSH private key), `SACCO_DESK_PATH`. The droplet must accept SSH from GitHub-hosted runners.

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
| clients.html | Table + KYC + photo thumbs | `/clients` |
| client-onboard.html | Wizard: personal → KYC/photo → IDs → office → activate | `POST /clients`, `/images` |
| client-detail.html | Photo, family, addresses, docs gallery, transfer/close | `/clients/{id}` |
| member-statement.html | Date range + print | `/runreports/ClientStatement` |
| groups.html | Groups | `/groups` |
| centres.html | Centres | `/centers` |

### Portfolio
| File | Screen | Fineract |
|------|--------|----------|
| loans.html | Portfolio | `/loans` |
| loan-detail.html | Schedule / txns | `/loans/{id}` |
| loan-apply.html | Application wizard | `POST /loans` |
| savings.html | List + shares stub | `/savingsaccounts` |
| savings-detail.html | Account + txns | `/savingsaccounts/{id}` |

### Accounting park
| File | Screen | Fineract |
|------|--------|----------|
| accounting.html | COA + create GL | `/glaccounts` |
| journals.html | Search / reverse | `/journalentries` |
| journal-entry.html | Create manual JE | `POST /journalentries` |
| closing-entries.html | Period closures | `/glclosures` |
| financial-mappings.html | Activity → GL | `/financialactivityaccounts` |
| accounting-rules.html | Rules + frequent postings | `/accountingrules` |
| accruals.html | Accruals + provisioning | `/runaccruals`, `/provisioningentries` |
| trial-balance.html | Trial balance | `/glaccounts/trialbalance` |
| income-statement.html | P&L stub | reports |
| balance-sheet.html | BS stub | reports |

### Org / products / reports
| File | Screen |
|------|--------|
| offices.html | Offices + staff |
| products-loans.html | Products, charges, floating rates |
| reports.html | Catalog + admin stubs |

Shared: `assets/app.css`, `assets/app.js`

## Design refs (URLs only — do not copy paid assets)
- FintechWeb ThemeForest finance admin
- Geex banking patterns
- LoanProX loan lifecycle
- Unity SACCO CodeCanyon listings

## Out of scope
Fineract stays at the repository root and is reached through the `server.py` proxy. Do not vendor Mifos community-app or web-app. Do not require Envato or ThemeForest purchases; the design references above are URLs only.
