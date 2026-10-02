# Payments portal

Ops screens for the SACCO payments middleware. The information architecture matches the approved remock (overview, payments, run detail, reports, channels, plus gateway health). Colour is the Phaneroo desk: forest green `#1F3A0E` and amber `#F8A11B` from `desk/assets/app.css`.

The Nest gateway stays at `/payments`. These pages do not change that OpenAPI.

## Screens

| File | Screen |
|------|--------|
| index.html | KPIs, channel mix, recent feed |
| payments.html | Filterable collect / disburse table |
| payment.html | Timeline, idempotency and HMAC refs, retry when failed |
| reports.html | Date and channel filters, volume, success, CSV |
| channels.html | MoMo, Airtel, bank, and card tiles with mode badges |

Open a payment from the table (`payment.html?id=pi_0001`).

## Data

The portal reads the gateway mock book first, for partner `demo-portal` (override with `?partner=`):

1. `GET /payments/health` (no key) drives the mock / sandbox / live badges.
2. `GET /payments/v1/portal/intents` with `channel`, `direction`, `status`, `product`, `partnerId`, `from`, `to`, `q`, `limit`, and `offset`. The payments table asks for 8 rows per page.
3. `GET /payments/v1/portal/intents/:id` fills the run screen, including the timeline when the payload has one.
4. `GET /payments/v1/portal/reports/summary` fills the report totals. Settlement packs still come from the intent list.

Mock auth sends whichever of these this browser session has stored: `X-Demo-Read-Key`, `X-Api-Key`, `X-Internal-Api-Key`. The values stay in `sessionStorage` (`paymentsPortal.demoReadKey`, `paymentsPortal.partnerKey`, `paymentsPortal.internalKey`). The page still calls the portal routes when no key is saved, so an open mock can answer. A 401, 403, or missing route falls back to `fixtures/intents.json` (100 intents) and shows a notice. The partner key still initiates `POST /payments/v1/payments/initiate`. Retry on a live portal book calls `POST /payments/internal/intents/{id}/resolve` with `allow_single_retry` and needs the internal key. Retry on the demo book updates the timeline for this session only.

## Seed

From the repository root:

```bash
python3 desk/payments-portal/scripts/build_fixture.py
python3 desk/payments-portal/scripts/build_fixture.py --check
node desk/payments-portal/scripts/model.test.js
```

`build_fixture.py` rewrites the 100-intent demo book (MTN MoMo, Airtel Money, bank, card; collect and disburse; posted, pending, and failed). Amounts are whole shillings. MSISDNs are masked. HMAC refs are labeled demo values, not channel secrets. `CHANNEL_MODE=mock` is the expected gateway mode. No MoMo or Airtel keys are used.

To copy that book into a gateway you are allowed to write (still mock mode, partner key only):

```bash
python3 desk/payments-portal/scripts/seed_gateway.py
PAYMENTS_BASE_URL=https://sacco.pivotventures.tech \
PAYMENTS_API_KEY='partner-key' \
python3 desk/payments-portal/scripts/seed_gateway.py --apply
```

The default is a dry-run. `--apply` posts `/payments/v1/payments/initiate` with each row's idempotency key.

The gateway repository seeds the portal read book (about 100 rows, partner `demo-portal`) with either of:

```bash
npm run seed:demo
docker compose -f docker-compose.demo.yml --profile seed run --rm --build seed
```

Those commands run in the payments gateway repo. This desk ships the fixture so the screens still render before that seed is deployed.

## Deploy

Merging to `main` runs **Deploy SACCO Desk** (`.github/workflows/deploy-desk.yml`). That workflow rsyncs `desk/` to the droplet web root (`SACCO_DESK_PATH`, default `/opt/pivot-sacco/desk`). It does not use `--delete`, and it does not restart Fineract or Caddy.

The gateway allowlist is [../../deploy/production/caddy/routes.caddy](../../deploy/production/caddy/routes.caddy). `/payments-portal/*` is on that list (the bare `/payments-portal` path is listed too, so Caddy can redirect to the trailing slash). A new Desk directory is not reachable until the same `path` line names it. This workflow does not reload Caddy.

`https://sacco.pivotventures.tech/payments-portal/`

Do not put these files under `/payments/`. That path is the Nest gateway. `/payments/docs` stays reachable from the desk card, the desk sidebar, and the portal banner.

The dashboard **Payments middleware** card links here and still links to the API docs.
