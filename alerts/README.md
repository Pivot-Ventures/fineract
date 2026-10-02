# Transactional alerts

Member SMS / WhatsApp alerts for Phaneroo SACCO, sent through **Africa’s Talking SMS** and **LipeChat WhatsApp**. Node 20+, no npm dependencies (built-ins and global `fetch` only).

Two kinds of caller post events:

- **Desk (staff).** After a Fineract posting succeeds, the Desk sends only the Fineract ids, with the teller's own Desk session. The service reads the amount, balance, account and member phone **from Fineract**, using that teller's credentials. Nothing typed in the browser reaches a message.
- **Member gateway (service).** The mobile-banking gateway sends trusted, validated content (transfers, repayments, PIN reset/unlock, activation on a new phone, mobile banking blocked) with a shared service key.

The service is **dry-run unless `ALERTS_LIVE=true`** and the provider credentials are present.

## Deploy (production: docker compose behind Caddy)

Production on this branch runs from `deploy/production` (see `deploy/production/README.md`):

- The `alerts` compose service builds this folder (`Dockerfile`). It is **not published**; it sits on the backend network (to reach Fineract and the gateway) and the edge network (to reach the providers).
- Caddy routes `https://<desk-host>/alerts/api/*` to `alerts:8095` with the prefix stripped, so the service sees `/v1/...`. Caddy strips any browser-supplied `X-Alerts-Service-Key` and adds no auth headers. Every call is authenticated by this service.
- Compose sets `HOST=0.0.0.0`, `PORT=8095`, `FINERACT_URL=http://fineract:8080/fineract-provider/api/v1`, `FINERACT_TENANT`, `ALERTS_SERVICE_KEY` (from `scripts/gen-secrets.sh`), and `ALERTS_DATA_DIR=/app/data` on the `alerts_data` volume.
- Provider credentials and the go-live switch go in `deploy/production/alerts.env` (optional file; copy the provider/limit section of `alerts/.env.example`). Without `ALERTS_LIVE=true` there, it only dry-runs.
- Set `ALERTS_TRUST_PROXY=true` in `alerts.env` so the per-IP rate limit uses the client address Caddy puts in `X-Forwarded-For` rather than Caddy's own address.

The container runs as the non-root `node` user, declares `VOLUME /app/data`, and has a `HEALTHCHECK` against `/v1/health`. Its filesystem can be read-only apart from `/app/data`.

Health from the host: `curl -sS https://<desk-host>/alerts/api/v1/health` → `{"ok":true,"mode":"dry-run"}`.

The older single-host systemd path lives in `alerts/deploy/` and is documented there.

## Run locally

```bash
cd alerts
export FINERACT_URL=https://localhost:8443/fineract-provider/api/v1   # staff auth + fact lookups
export ALERTS_SERVICE_KEY=dev-only-key                                  # optional, for gateway calls
npm start             # listens on 127.0.0.1:8095 by default
curl -s http://127.0.0.1:8095/v1/health
npm test              # mocked HTTP only; never sends a real SMS
```

With neither `FINERACT_URL` nor `ALERTS_SERVICE_KEY` set, every route except `/v1/health` answers **503**: the service never runs open. For a local Fineract with a self-signed certificate, export `NODE_TLS_REJECT_UNAUTHORIZED=0` in that shell only.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. The Dockerfile sets `0.0.0.0` inside the container only. |
| `PORT` | `8095` | Listen port. |
| `FINERACT_URL` | (empty) | Fineract API base incl. `/api/v1`. Required for staff auth and staff events. |
| `FINERACT_TENANT` | `default` | `Fineract-Platform-TenantId` for `/authentication` and lookups. |
| `ALERTS_SERVICE_KEY` | (empty) | Shared key for the member gateway (`X-Alerts-Service-Key`). Empty = service callers refused. |
| `ALERTS_ADMIN_PERMISSION` | `ALL_FUNCTIONS` | Fineract permission (besides `ALL_FUNCTIONS`) that grants the admin routes. |
| `ALERTS_LIVE` | (empty) | Exactly `true` to send live. Anything else dry-runs. A provider without credentials always dry-runs. |
| `ALERTS_CHANNEL_ORDER` | `sms` | `sms`, `whatsapp`, or `whatsapp,sms` (WhatsApp first, SMS only if WhatsApp fails). Never both on success. |
| `ALERTS_PER_PHONE_HOURLY` | `10` | Sends per destination phone per rolling hour. |
| `ALERTS_DAILY_CAP` | `2000` | Total sends per day (Africa/Kampala), across all phones. |
| `ALERTS_RATE_PER_MINUTE` | `120` | Requests per client IP per minute on every route except health (429 beyond). |
| `ALERTS_TRUST_PROXY` | (empty) | `true` = take the client IP from the last `X-Forwarded-For` entry (set behind Caddy). |
| `ALERTS_EXTRA_PREFIXES` | (empty) | Comma-separated E.164 prefixes (e.g. `+2547`) accepted besides Ugandan mobiles, in full `+` form only. |
| `ALERTS_BRANCH_CONTACT` | `your SACCO branch` | Text for `{{branch}}` ("If this wasn't you, call …"). |
| `ALERTS_DATA_DIR` | `alerts/data` | Directory for `store.json`. |
| `ALERTS_DATA_FILE` | (empty) | Full store path; overrides `ALERTS_DATA_DIR`. |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`, `AT_BASE_URL` | `AT_BASE_URL=https://api.africastalking.com` | Africa’s Talking. Key only ever sent as the `apiKey` header. |
| `LIPECHAT_API_KEY`, `LIPECHAT_FROM`, `LIPECHAT_BASE_URL` | `LIPECHAT_BASE_URL=https://gateway.lipachat.com` | LipeChat WhatsApp templates. |

Removed: `ALERTS_API_KEY` / `X-Alerts-Key` (replaced by staff and service auth below), `ALERTS_DRY_RUN` (dry-run is now the default), the email stub.

## Authentication

| Caller | Header | Check |
| --- | --- | --- |
| Staff (Desk) | `X-Staff-Authorization: Basic <desk session key>` | The Desk session key is the same base64 `user:password` Fineract uses for Basic auth. The service POSTs it to Fineract `/authentication`; a positive answer (username + permissions) is cached about 60 s under the SHA-256 of the key. The key is never logged or stored. |
| Service (gateway) | `X-Alerts-Service-Key: <ALERTS_SERVICE_KEY>` | Compared in constant time after hashing both sides, so the length doesn't leak. |

No credentials → 401. Wrong credentials → 401. Neither `FINERACT_URL` nor `ALERTS_SERVICE_KEY` configured → 503. Fineract unreachable → 503.

**Admin routes** (templates, test-send, deliveries, settings) are staff only and need `ALL_FUNCTIONS` or `ALERTS_ADMIN_PERMISSION`; otherwise 403 `{ "error": "forbidden", "required": "<permission>" }`.

## HTTP API

Paths are `/v1/...` (what the service sees behind Caddy, i.e. `https://<desk-host>/alerts/api/v1/...` from outside). `/alerts/api/v1/...` also works when calling the process directly.

### `GET /v1/health` (no auth)

```json
{ "ok": true, "mode": "dry-run" }
```

`mode` is `"live"` only when `ALERTS_LIVE=true` and at least one provider has credentials. No other detail.

### `POST /v1/events` from staff (Desk hooks)

Only ids. Any amount, phone, text or `meta` in the body is ignored.

```json
{ "type": "deposit",       "transactionId": "501", "savingsAccountId": "15" }
{ "type": "withdrawal",    "transactionId": "502", "savingsAccountId": "15" }
{ "type": "loan_disburse", "transactionId": "801", "loanId": "7" }
{ "type": "loan_repay",    "transactionId": "802", "loanId": "7" }
{ "type": "transfer",      "transferId": "90" }
```

With the staff member's own Basic credentials the service reads:

| Event | Fineract reads |
| --- | --- |
| deposit / withdrawal | `GET /savingsaccounts/{id}/transactions/{txId}`, `GET /savingsaccounts/{id}`, `GET /clients/{clientId}` |
| loan_disburse / loan_repay | `GET /loans/{id}/transactions/{txId}`, `GET /loans/{id}`, `GET /clients/{clientId}` |
| transfer | `GET /accounttransfers/{id}`, `GET /savingsaccounts/{fromAccountId}`, `GET /clients/{clientId}` |

It refuses (no send) when the transaction does not exist (404 — e.g. a maker-checker command still awaiting approval has no transaction), belongs to another account (409), is reversed (409), or its type doesn't match the event (409). Transfers alert the **source** account's member and only for transfers out of a savings account. The member's `mobileNo` must be a valid Ugandan mobile, otherwise the event is recorded as `skipped`.

Idempotency key (server-side): `${type}:${accountId}:${txId}` (for transfers `transfer:${fromAccountId}:${transferId}`). A repeat returns the earlier result with `"duplicate": true` and sends nothing.

### `POST /v1/events` from the service key (member gateway)

```json
{
  "type": "transfer",
  "idempotencyKey": "gw-transfer-8c1f…",
  "memberId": "42",
  "phone": "0772123456",
  "context": { "amount": 1500000, "account": "000000123", "balance": 20000, "reference": "MB123", "memberName": "Achieng" }
}
```

- `type`: `transfer`, `loan_repay`, `pin`, `activation`, `mobile_blocked`.
- `idempotencyKey`: required, ≤ 100 printable ASCII characters, deduplicated (repeat → earlier result, `"duplicate": true`).
- `phone`: required, Ugandan mobile (rules below); otherwise 400.
- `memberId`: optional, ≤ 64 `[A-Za-z0-9_-]`.
- `context` (all optional): `amount`, `balance` numbers; `account` ≤ 32 alphanumerics (masked to `****1234`); `reference` ≤ 40 `[A-Za-z0-9 _./-]`; `memberName` ≤ 60, no control characters or braces. Unknown context keys are ignored. There is no field for an activation code or PIN, and templates cannot reference one.

### Response (both callers)

```json
{
  "ok": true,
  "type": "deposit",
  "status": "sent",
  "reason": "",
  "deliveries": [
    { "id": "dlv_…", "at": "…", "type": "deposit", "source": "staff", "channel": "sms", "provider": "africastalking",
      "status": "sent", "providerId": "ATXid_1", "error": "", "to": "+2567****456", "dryRun": false, "length": 117 }
  ]
}
```

`status`: `sent`, `dry_run`, `failed`, `skipped` (cap reached, no channel enabled, no valid phone), or `pending` (a duplicate arrived while the first is still sending).

### Admin routes (staff with the admin permission)

- `GET /v1/settings`: mode, channel order, caps, rate limit, which providers are configured/live. Never keys.
- `GET /v1/templates`, `GET /v1/templates/:type`, `PUT /v1/templates/:type`: the eight types are fixed (no create/delete). Tokens outside the type's whitelist are rejected with 400.
- `POST /v1/test-send` `{ "type": "deposit", "phone": "0772…", "channel": "sms" | "whatsapp" (optional) }`: renders the template with sample values to the given Ugandan mobile, ignoring the on/off toggles. Counts toward the caps.
- `GET /v1/deliveries?limit=50`: newest first, phones masked, no message text.

## Phone numbers

Only Ugandan mobiles: normalised to `+256` then `[37]` and 8 digits. Accepted forms: `07XXXXXXXX`, `7XXXXXXXX`, `2567XXXXXXXX`, `+2567XXXXXXXX`, `25607XXXXXXXX` / `+25607…` (the 0 after 256 is dropped), `00256…`, with spaces or dashes. Everything else is rejected (wrong length, other country codes such as `+44…` or `+1900…`). `ALERTS_EXTRA_PREFIXES` can admit other E.164 prefixes in full `+` form.

## Channels, caps, and limits

- **Channel order** (`ALERTS_CHANNEL_ORDER`) is filtered by each template's `smsEnabled` / `whatsappEnabled`. The first channel that succeeds (or dry-runs) ends the chain; a failure falls through to the next. With `whatsapp,sms`, members get SMS only when WhatsApp fails. Never both.
- **Per-phone** (`ALERTS_PER_PHONE_HOURLY`) and **daily** (`ALERTS_DAILY_CAP`) limits are checked and counted atomically in the store before sending (one count per alert, dry-run included). Over the limit → a `skipped` delivery with the reason. Phones are kept in the counters only as SHA-256 hashes.
- **Per-IP rate limit** (`ALERTS_RATE_PER_MINUTE`) on every route except health → 429 with `Retry-After`.
- Every outbound request (providers and Fineract) has a 10 s timeout.

## Provider results

- Africa’s Talking counts as sent only when HTTP is 2xx, `SMSMessageData.Recipients` is non-empty, and every recipient `statusCode` is 100, 101 or 102. Otherwise it fails with `SMSMessageData.Message` or the recipient `status` as the reason.
- LipeChat counts as sent only on 2xx without an error body (`status` of `error` / `failed` / `false`, or `success: false`).

## Templates

`{{token}}` names, whitelisted per type. `[[ … ]]` is an optional section, dropped when a token in it is empty (e.g. a gateway event without a balance). Amounts render as `UGX 1,500,000` (`Intl.NumberFormat('en-UG')`, no decimals); accounts as `****1234`.

| Type | Tokens | WhatsApp template / placeholders |
| --- | --- | --- |
| `deposit`, `withdrawal`, `transfer` | amount, account, balance (available after the transaction), reference, date, memberName, branch | `sacco_deposit` / `sacco_withdrawal` / `sacco_transfer`: amount, account, balance, reference |
| `loan_disburse`, `loan_repay` | same; balance = loan outstanding after the transaction | `sacco_loan_disburse` / `sacco_loan_repay`: amount, account, balance, reference |
| `pin` | memberName, date, branch | `sacco_pin`: branch |
| `activation` | memberName, date, branch | `sacco_activation`: branch — "Mobile banking was activated on a new phone. If this wasn't you, call {{branch}} now." Never contains a code. |
| `mobile_blocked` | memberName, date, branch | `sacco_mobile_blocked`: branch |

Create the WhatsApp templates in the [LipeChat portal](https://docs.lipachat.com/) with the exact names, then turn `whatsappEnabled` on. SMS is on by default. A store from an earlier release is migrated on read: missing types are added, retired types dropped, and the old seeded savings-activation / PIN text replaced.

## Desk wiring

`desk/assets/transactional-alerts.js` posts `{type, ids}` fire-and-forget (`keepalive`, errors swallowed, never `FineractAPI.get`) with `X-Staff-Authorization` from the Desk session, and only for a committed Fineract result (a maker-checker `rollbackTransaction` result sends nothing).

| Desk path | Event (ids from the Fineract response) |
| --- | --- |
| Savings deposit / withdrawal, teller cash in / out | `deposit` / `withdrawal` (`resourceId`, `savingsId`) |
| Savings to savings transfer | `transfer` (`resourceId` = transfer id) |
| Loan disburse | `loan_disburse` (`subResourceId` = disbursement transaction) |
| Loan repayment, pay-off, teller loan repayment | `loan_repay` (`resourceId`) |
| Loan repayment from savings | `transfer` (`/accounttransfers` returns the transfer id, not the loan transaction) |

Not sent from the Desk, on purpose: loan disburse-to-savings (Fineract returns no disbursement transaction id), savings account activation (`activation` now means mobile banking on a new phone), and mobile-banking PIN unlock/activation (the member gateway sends `pin` / `activation` itself; activation codes are never sent).

The admin screen is `https://<desk-host>/transactional-alerts/`. It uses the Desk sign-in (staff without the admin permission see an explanation, not an error) and shows dry-run/live mode.

## Logging and privacy

Logs are one JSON object per line: type, source, channel, status, **masked** phone (`+2567****456`), provider id and a scrubbed error. Message bodies, request bodies and credentials are never logged. The delivery log stores the masked phone and the message length, not the text.

## Persistence

One JSON file (`ALERTS_DATA_DIR/store.json`): templates, the last 500 deliveries, idempotency results (14 days, at most 5000), and cap counters. Writes are serialised in-process, written to a unique temp file, fsynced, then renamed. A corrupt file is renamed to `store.json.corrupt-<timestamp>`, logged once (`alerts.store_corrupt`), and the service continues with a fresh store. Run one process per data directory.
