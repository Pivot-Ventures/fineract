# Pivosacc Mobile

Member-facing mobile web app for Pivosacc, wired to **Apache Fineract** through the same reverse-proxy pattern as Desk (`ui-mockups`).

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
| Home | Savings available balance + recent txns |
| Deposit | MTN MoMo / Airtel Money UI — **Phase 1** integration |
| Statement | Real savings transactions |
| Loans | Real loan list (+ schedule when present) |
| Profile | Client profile from Fineract |

## Demo auth (important)

Fineract’s local Docker image does **not** expose a member self-service login suitable for this app. The mobile UI therefore:

1. Authenticates as **staff** (`mifos` / `password`, tenant `default`).
2. Selects the **client** matching the member number (default: Nakato Grace `#000000001`).
3. Uses a soft **PIN gate** (`1234`) for UX only — not stored in Fineract.

Production member auth (OTP / PIN / biometric against a member credential store) is a follow-on.

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
