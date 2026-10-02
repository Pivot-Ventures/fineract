# Payments portal

Ops screens for the SACCO payments middleware: overview, payments, run detail, reports, and channels. Uganda shillings. The look is the Phaneroo desk (forest green and amber from `desk/assets/app.css`).

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

1. `GET /payments/health` (no key) drives the mock / sandbox / live badges.
2. If this browser session has an internal operator key, `GET /payments/internal/intents` fills the book. The key is kept in `sessionStorage` only.
3. Otherwise the portal reads `fixtures/intents.json` (100 intents). An empty gateway book also falls back to that file.

Retry on a failed demo row updates the timeline for this session. Retry against the gateway calls `POST /payments/internal/intents/{id}/resolve` with `allow_single_retry`.

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

The default is a dry-run. `--apply` posts `/payments/v1/payments/initiate` with each row's idempotency key. After the gateway list returns rows, the portal shows those instead of the fixture.

## Deploy

Merging to `main` runs **Deploy SACCO Desk** (`.github/workflows/deploy-desk.yml`). That workflow rsyncs `desk/` to the droplet web root (`SACCO_DESK_PATH`, default `/opt/pivot-sacco/desk`). It does not use `--delete`, and it does not restart Fineract or Caddy.

No Caddy change. The desk is already the site root, so this folder is:

`https://sacco.pivotventures.tech/payments-portal/`

Do not put these files under `/payments/`. That path is the Nest gateway. `/payments/docs` stays reachable from the desk card, the desk sidebar, and the portal banner.

The dashboard **Payments middleware** card links here and still links to the API docs.
