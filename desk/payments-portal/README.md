# Payments portal

Ops screens for the SACCO payments middleware. The information architecture matches the approved remock (overview, payments, run detail, reports, channels, plus gateway health). Colour is the Phaneroo desk: forest green `#1F3A0E` and amber `#F8A11B` from `desk/assets/app.css`.

The Nest gateway stays at `/payments` on the same origin. These pages do not change its API.

## Screens

| File | Screen |
|------|--------|
| index.html | KPIs, channel mix, recent feed |
| payments.html | Filterable collect / disburse table |
| payment.html | Timeline, idempotency and HMAC refs (retry only on the demo book) |
| reports.html | Date and channel filters, volume, success, CSV |
| channels.html | MoMo, Airtel, bank, and card tiles with mode badges |

Open a payment from the table (`payment.html?id=pi_0001`).

## Sign-in

Every portal page loads `/assets/api.js` and calls `FineractAPI.requireAuth()` before it reads anything, then starts the Desk idle / absolute session timers. Without a live Desk session the operator is sent to `/login.html` at the desk root.

## Data

The portal reads the gateway portal book for partner `demo-portal` (override with `?partner=`):

1. `GET /payments/health` (no key) drives the mock / sandbox / live badges.
2. `GET /payments/v1/portal/intents` with `channel`, `direction`, `status`, `product`, `partnerId`, `from`, `to`, `q`, `limit`, and `offset`. The payments table asks for 8 rows per page and trusts the gateway's paging. If the gateway ignores `limit` and returns the whole set, the page is cut in the browser with a notice; if it returns more than a page but less than the total, no rows are shown.
3. Overview, reports, channels, and every CSV export page through the same route 200 rows at a time until the book is exhausted, with a hard cap of 10,000 rows. When the cap is hit the screen says "Showing the first N of M".
4. `GET /payments/v1/portal/intents/:id` fills the run screen, including the timeline when the payload has one.

Report KPIs are computed in the browser from the full row set so they use the same definitions as the overview:

- Collections / disbursements count POSTED intents only. Initiated volume is shown separately.
- REVERSED is not posted and not "Settled to core".
- Success rate = POSTED / (POSTED + PROVIDER_DECLINED + CORE_REJECTED). Pending and AMBIGUOUS runs are excluded, and the label says so.
- "Today" is the current date in Africa/Kampala.

Reads send one key from this tab's `sessionStorage`: `X-Demo-Read-Key` (`paymentsPortal.demoReadKey`) if saved, otherwise the partner `X-Api-Key` (`paymentsPortal.partnerKey`). There is no internal key in the browser; any old `paymentsPortal.internalKey` value is deleted on load.

If a read fails (401, 403, 5xx, missing route, network error) the page shows an error such as "Payments gateway unavailable (HTTP 502). No data shown." and no figures, KPIs, or tables. It never substitutes the fixture.

## Demo mode

Open any portal page with `?demo=1` to use `fixtures/intents.json` (100 intents). The flag is kept in `sessionStorage` (`paymentsPortal.demoMode`) for that tab, so navigation keeps it. While it is on:

- A red "DEMO DATA — not real payments" banner sits on every screen, with a **Leave demo mode** button (or open any page with `?demo=0`).
- "Today" is the book's anchor day and is labelled as such.
- CSV and settlement-pack exports are named `DEMO-*.csv` and their first line is `# DEMO DATA - not real payments (fixtures/intents.json)`.
- Initiate and Retry only change this tab's copy of the book and say that nothing was sent to the gateway.

## Initiate

Amounts are whole shillings only (`50000` or `50,000`); decimals, exponents, and other characters are rejected inline. The maximum is UGX 5,000,000 (`MAX_INITIATE_UGX` in `assets/model.js`). A review step shows the formatted amount, channel, product, and destination before anything is sent. On the live book Initiate posts `POST /payments/v1/payments/initiate` with the partner key only; without a partner key it refuses.

## Retry

Retry is disabled on the live book. Retries are done by the gateway operator on the server (`allow_single_retry`) until the Desk has a session-backed retry proxy; the browser never calls `/payments/internal/*`. On the demo book the retry dialog requires a note, an explicitly ticked "did not post" confirmation (unchecked by default), and, for AMBIGUOUS runs, the provider reference that was checked.

## Tests and fixture

From the repository root:

```bash
python3 desk/payments-portal/scripts/build_fixture.py
python3 desk/payments-portal/scripts/build_fixture.py --check
node desk/payments-portal/scripts/model.test.js
```

`build_fixture.py` rewrites the 100-intent demo book (MTN MoMo, Airtel Money, bank, card; collect and disburse; posted, pending, and failed). Amounts are whole shillings. MSISDNs are masked. HMAC refs are labeled demo values, not channel secrets. No MoMo or Airtel keys are used.

## Seed

`seed_gateway.py` copies the demo book into a gateway that is entirely in mock mode. It is a dry-run by default and needs `PAYMENTS_BASE_URL` (there is no default host):

```bash
PAYMENTS_BASE_URL=https://mock-gateway.example \
python3 desk/payments-portal/scripts/seed_gateway.py

PAYMENTS_BASE_URL=https://mock-gateway.example \
PAYMENTS_API_KEY='partner-key' \
python3 desk/payments-portal/scripts/seed_gateway.py --apply --confirm-host mock-gateway.example
```

With `--apply` it first reads `{base}/payments/health` and aborts unless every reported mode (channel modes and `fineract`) is `mock`, and `--confirm-host` must equal the base URL's hostname. Payloads omit `savingsAccountId` and `loanId`. It posts each row with its idempotency key, keeps going after per-row HTTP errors, prints a summary, and exits non-zero if any row failed.

The gateway repository seeds its own portal read book (about 100 rows, partner `demo-portal`) with `npm run seed:demo` or `docker compose -f docker-compose.demo.yml --profile seed run --rm --build seed`.

## Deploy

Merging to `main` runs **Deploy SACCO Desk** (`.github/workflows/deploy-desk.yml`), which rsyncs `desk/` to the droplet web root (`SACCO_DESK_PATH`, default `/opt/pivot-sacco/desk`). It does not use `--delete`, and it does not restart Fineract or Caddy.

The desk is served from the site root by Caddy, so this folder is `https://sacco.pivotventures.tech/payments-portal/` and shares the Desk's `/assets/api.js` and login. Do not put these files under `/payments/`; that path is the Nest gateway.

The gateway API docs are not public: Caddy blocks `/payments/docs` and `/payments/internal/*`, and the portal does not link to gateway Swagger. Fixtures are only shown with `?demo=1`.
