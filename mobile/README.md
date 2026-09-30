# Pivosacc Mobile

Member-facing mobile web app for Pivosacc, wired to **Apache Fineract** through the same reverse-proxy pattern as Desk (`ui-mockups` / `desk`).

## Quick start

```bash
# Fineract must be healthy on :8443
export PATH="$HOME/.docker/bin:$PATH"
cd ~/Projects/sacco/fineract && docker compose up -d

cd ~/Projects/sacco/fineract/mobile
./start-mobile.sh
# → http://127.0.0.1:5174/
```

## Screens

| Screen | Data source |
|--------|-------------|
| Login | Staff auth (`mifos`/`password`) + client bind |
| Home | Multi-account savings list + **total available** + recent txns |
| Transfer | Live Fineract `POST /accounttransfers` — own savings ↔ own, or member-to-member |
| Pay utilities | Billers UI (water/electricity/TV/school) — Phase 1 toast **or** tagged savings withdrawal |
| Deposit | MTN MoMo / Airtel Money UI — **Phase 1** collection |
| Withdraw to MoMo | Cash-out UI — **Phase 1** payout |
| Statement | Live savings transactions (all accounts / filter) |
| Loans | Live loan list (+ schedule) · **Repay from app** |
| Loan repay | Fineract repayment when loan is Active; MoMo mode = Phase 1 |
| Notifications | Stub |
| Help & support | Branch contacts / FAQ |
| Profile | Client profile from Fineract |
| More | Shortcuts to deposit, withdraw, statement, loans, alerts, help |

### Try it (demo)

1. Open http://127.0.0.1:5174/ → member `000000001` / PIN `1234` (Nakato Grace).
2. **Home** — see Voluntary Savings accounts + total available.
3. **Transfer → Own accounts** — move UGX between her two savings (if both active).
4. **Transfer → Member** — lookup `000000002` (Okello James) → send a small amount.
5. **Bills** — pick NWSC → Phase 1 toast, or switch to **Ledger withdrawal** to post a tagged debit.
6. **More → Withdraw / Deposit** — MoMo UI toasts (Phase 1).
7. **More → Loans → Repay from app** — attempts Fineract repay (needs Active loan; Approved-only will error until disbursed).

## Demo auth (important)

Fineract’s local Docker image does **not** expose a member self-service login suitable for this app. The mobile UI therefore:

1. Authenticates as **staff** (`mifos` / `password`, tenant `default`).
2. Selects the **client** matching the member number (default: Nakato Grace `#000000001`).
3. Uses a soft **PIN gate** (`1234`) for UX only — not stored in Fineract.

Production member auth (OTP / PIN / biometric against a member credential store) is a follow-on.

Demo peers seeded for transfers: **Okello James** `#000000002` with an active savings account.

## What is live vs Phase 1

| Capability | Status |
|------------|--------|
| Balances / multi-account / statement | **Live** Fineract |
| Own-account & member transfers | **Live** `/accounttransfers` |
| Utility “ledger withdrawal” tag | **Live** savings withdrawal + note |
| Loan repay (Active loans) | **Live** `/loans/{id}/transactions?command=repayment` |
| MoMo deposit / withdraw / bill rails | **Phase 1 UI** (toast) |
| Notifications push | **Stub** |

## Brand

Accent `#21409A` · Barlow / Barlow Condensed · IBM Plex Mono for amounts — matches approved samples in `~/Projects/sacco/proposals/mobile-samples/`.

## Ports

| Service | Port |
|---------|------|
| Desk (staff) | `5173` |
| Mobile (member) | `5174` |
| Fineract | `8443` |

## Proxy

`server.py` serves this folder and proxies `/fineract-provider/*` → `https://localhost:8443/fineract-provider/*` so the browser stays same-origin (no CORS).
