# Transactional alerts

Member alerts for Phaneroo SACCO. Desk posts a normalized event; this service renders the template and fans out to **Africa’s Talking SMS** and **LipeChat WhatsApp**. Email is a config slot only.

The Nest payments gateway at `/opt/pivot-sacco/payments` is a different service (MoMo, Airtel, bank, card). This folder is the alerts lane: it runs beside that gateway, and the reverse proxy exposes it at `/alerts/`.

**Deploy SACCO Desk** (`.github/workflows/deploy-desk.yml`) rsyncs `desk/`, including `desk/transactional-alerts/`, only when `desk/**` or that workflow file changes. It does not copy this folder or start this process.

**Deploy SACCO Alerts** (`.github/workflows/deploy-alerts.yml`) rsyncs this folder and restarts `pivot-sacco-alerts.service` when `alerts/**` or that workflow file changes, and when someone runs the workflow manually from `main`. A Desk-only commit does not deploy alerts. An alerts-only commit does not deploy Desk. Do not rsync this folder from a laptop checkout.

## Deploy

The workflow checks out `main`, rsyncs `alerts/` to the droplet, runs `npm ci --omit=dev` on the host, and installs a systemd unit with `PORT=8095`. The process binds `0.0.0.0`; the proxy and the deploy health check use `127.0.0.1:8095`. The workflow restarts only `pivot-sacco-alerts.service`. It does not reload Caddy or nginx, and it does not restart Fineract, Desk, or the payments gateway.

`rsync --delete` removes source files that left the repo. It does not delete `data/` (the JSON store), `.env`, or `alerts.env`. `npm ci --omit=dev` then installs from `package-lock.json` on the host.

### GitHub Actions secrets

Reuse the Desk deploy secrets. Do not add `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`, `LIPECHAT_API_KEY`, or `LIPECHAT_FROM` as Actions secrets. This workflow never reads them.

| Secret | Required | Purpose |
| --- | --- | --- |
| `SACCO_DESK_HOST` | yes | Droplet address. Same value Desk uses. |
| `SACCO_DESK_USER` | yes | SSH account. Same value Desk uses. |
| `SACCO_DESK_SSH_KEY` | yes | Unencrypted private key. Same value Desk uses. |
| `SACCO_ALERTS_PATH` | no | Deploy directory. Default `/opt/pivot-sacco/alerts`. |
| `SACCO_ALERTS_ENV_FILE` | no | Host env file. Default `/etc/pivot-sacco/alerts.env`. |

`SACCO_ALERTS_PATH` must not be the Desk tree or the payments tree. The env file must sit outside the deploy directory so rsync cannot delete it.

### Host environment file

Create `/etc/pivot-sacco/alerts.env` on the droplet (mode `600`, owner root). systemd reads it as PID 1 via `EnvironmentFile=`. This process does not load a `.env` file by itself. Copy from `alerts/.env.example` and set:

```bash
PORT=8095
ALERTS_DRY_RUN=false
AT_USERNAME=
AT_API_KEY=
AT_SENDER_ID=
LIPECHAT_API_KEY=
LIPECHAT_FROM=
```

`AT_SENDER_ID` is optional. Leave `ALERTS_API_KEY` unset until the reverse proxy injects `X-Alerts-Key`. Keep `PORT=8095`: the Caddy and nginx snippets proxy to that port. Do not commit this file.

If the file is missing, the unit still starts and both providers dry-run. Create the file before expecting live SMS or WhatsApp. A missing key for one provider dry-runs that provider only.

### First-time host steps

1. Install Node.js 18 or newer so non-interactive SSH sees `node` and `npm` on the default PATH (for example `/usr/bin/node`). nvm installs under a home directory are refused: systemd cannot rely on them.
2. Confirm the Desk SSH user can create `/opt/pivot-sacco/alerts`. When that user is root, the workflow creates a system account `pivot-alerts` and runs the service as that account. When the SSH user is not root, the service runs as that same user, and passwordless `sudo` must allow `install` of `/etc/systemd/system/pivot-sacco-alerts.service` plus `systemctl daemon-reload`, `enable`, and `restart` for that unit.
3. Write `/etc/pivot-sacco/alerts.env` as above.
4. Two different Caddy configs are involved, and this workflow edits neither.
   - **`/alerts/*` → `127.0.0.1:8095`** is host Caddy. `alerts/deploy/caddy-alerts.caddy` is the source of truth (the same `reverse_proxy` that is live on this droplet). It was applied through the Caddy admin API. Do not `caddy reload` `/etc/caddy/Caddyfile`; that file is incomplete and a reload drops routes that exist only in the running config. `alerts/deploy/install-on-host.sh` does not call the admin API.
   - **`/transactional-alerts/*`** is the Desk page. The gateway container allowlist is `deploy/production/caddy/routes.caddy`, next to `/payments-portal/*`. A gateway recreate without that path 404s the page. The alerts port is not proxied from inside that container.
   - If this host uses nginx instead, paste `alerts/deploy/nginx-alerts.conf` inside the existing Desk `server` block. Do not replace the desk root or `/payments/`. The `$alerts_api_key` header is commented out so an undefined nginx variable cannot stop Desk from starting.
5. Merge to `main`, or run **Deploy SACCO Alerts** with `workflow_dispatch` on `main`.
6. On the droplet, `curl -sS http://127.0.0.1:8095/alerts/api/v1/health`. After the proxy reload, the same check belongs at `https://<desk-host>/alerts/api/v1/health`.
7. Do not publish port 8095 on the public firewall. The app binds `0.0.0.0` so the local proxy can reach it; only 443 should be public.

Manual runs from any branch other than `main` are skipped.

## Run locally

Node 18 or newer. No npm dependencies.

```bash
cd alerts
export ALERTS_DRY_RUN=true
npm start
# listens on 0.0.0.0:8095
curl -s http://127.0.0.1:8095/alerts/api/v1/health
```

`ALERTS_DRY_RUN=true` logs the intended provider payload and does not call Africa’s Talking or LipeChat. The same dry-run happens automatically when that provider’s credentials are unset, even if `ALERTS_DRY_RUN` is false or empty.

```bash
npm test
```

The smoke test checks the Africa’s Talking form body (`username`, `to`, `message`, optional `from`, `apiKey` header) and the LipeChat template JSON against a mocked HTTP client.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port. Default `8095`. Binds `0.0.0.0`. |
| `ALERTS_DRY_RUN` | `true` forces dry-run for SMS and WhatsApp. |
| `ALERTS_API_KEY` | When set, every route except `GET /health` requires `X-Alerts-Key` or `Authorization: Bearer`. |
| `ALERTS_DATA_FILE` | JSON store path. Default `alerts/data/store.json`. |
| `AT_USERNAME` | Africa’s Talking username (`sandbox` in the sandbox). |
| `AT_API_KEY` | Africa’s Talking API key. Sent only as the `apiKey` header. |
| `AT_SENDER_ID` | Optional `from` sender ID. |
| `AT_BASE_URL` | Default `https://api.africastalking.com`. Sandbox: `https://api.sandbox.africastalking.com`. |
| `LIPECHAT_API_KEY` | LipeChat key. Sent only as the `apiKey` header. |
| `LIPECHAT_FROM` | WhatsApp Business number, or the LipeChat sandbox number. |
| `LIPECHAT_BASE_URL` | Default `https://gateway.lipachat.com`. |
| `ALERTS_EMAIL_FROM` | Reserved. Unused until an email provider is added. |

Copy `alerts/.env.example`. Do not commit secrets. This process does not read a `.env` file; export the variables in the shell, or let systemd load `/etc/pivot-sacco/alerts.env` (see Deploy).

Health returns booleans only (`configured`, `dryRun`). It never returns key material.

## HTTP API

Prefix: `/alerts/api/v1`

### `GET /health`

```json
{
  "ok": true,
  "service": "transactional-alerts",
  "providers": {
    "sms": { "provider": "africastalking", "configured": false, "dryRun": true },
    "whatsapp": { "provider": "lipechat", "configured": false, "dryRun": true },
    "email": { "provider": "stub", "configured": false, "dryRun": true }
  }
}
```

### `POST /events`

```json
{
  "type": "deposit",
  "memberId": "42",
  "phone": "0772000111",
  "email": "",
  "amount": 10000,
  "currency": "UGX",
  "account": "000000123",
  "reference": "txn-1",
  "meta": { "memberName": "Achieng" }
}
```

`type` and `phone` are required. Phones are normalized to E.164 (`0772…` becomes `+256772…`). The service loads the template for `type` and sends each **enabled** channel. Disabled channels are skipped. Unknown types return 404.

Seeded types: `deposit`, `withdrawal`, `loan_disburse`, `loan_repay`, `transfer`, `pin`, `activation`.

### `GET /templates`, `POST /templates`, `GET|PUT|DELETE /templates/:type`

`PUT` upserts. `POST` creates and returns 409 when the type already exists. Toggles are `smsEnabled`, `whatsappEnabled`, and `emailEnabled`.

### `GET /deliveries?limit=50`

Newest first. Each row has `status` (`sent`, `dry_run`, `failed`, `stub`, `skipped`), `channel`, `provider`, `providerId`, and `error`. Previews are the rendered text, not provider credentials.

### `POST /test-send`

Same body as `/events`, plus `channel`: `sms`, `whatsapp`, or `both`. Test-send uses the template copy but **ignores the enable toggles**, so ops can try a channel before turning it on for members.

## Seeded templates

SMS bodies use `{{token}}` names. LipeChat placeholders are positional (`{{1}}`, `{{2}}`, …) in the order below. Create those templates in the [LipeChat portal](https://docs.lipachat.com/) with the **exact** `whatsappTemplateName`, then turn `whatsappEnabled` on in Desk. Until WhatsApp approves them, leave the toggle off. SMS is on by default.

| Type | WhatsApp template | Placeholder order | Suggested WhatsApp body |
| --- | --- | --- | --- |
| `deposit` | `sacco_deposit` | currency, amount, account, reference | Phaneroo SACCO: {{1}} {{2}} deposited to account {{3}}. Ref {{4}}. |
| `withdrawal` | `sacco_withdrawal` | currency, amount, account, reference | Phaneroo SACCO: {{1}} {{2}} withdrawn from account {{3}}. Ref {{4}}. |
| `loan_disburse` | `sacco_loan_disburse` | account, currency, amount, reference | Phaneroo SACCO: loan {{1}} disbursed {{2}} {{3}}. Ref {{4}}. |
| `loan_repay` | `sacco_loan_repay` | currency, amount, account, reference | Phaneroo SACCO: {{1}} {{2}} received for loan {{3}}. Ref {{4}}. |
| `transfer` | `sacco_transfer` | currency, amount, account, reference | Phaneroo SACCO: {{1}} {{2}} transferred from account {{3}}. Ref {{4}}. |
| `pin` | `sacco_pin` | memberId | Phaneroo SACCO: the mobile banking PIN lock for member {{1}} was cleared at your branch. |
| `activation` | `sacco_activation` | account, memberId | Phaneroo SACCO: savings account {{1}} is now active. |

Tokens also available in SMS (and in `meta`): `memberId`, `phone`, `email`, `amount`, `currency`, `account`, `reference`, `type`.

Language code seeded as `en`.

## Providers

Africa’s Talking: `POST {AT_BASE_URL}/version1/messaging` as `application/x-www-form-urlencoded` with header `apiKey` and fields `username`, `to`, `message`, optional `from`.

LipeChat: `POST {LIPECHAT_BASE_URL}/api/v1/whatsapp/template` as JSON with header `apiKey`:

```json
{
  "messageId": "<uuid>",
  "to": "+2567…",
  "from": "<LIPECHAT_FROM>",
  "template": {
    "name": "sacco_deposit",
    "languageCode": "en",
    "components": { "body": { "placeholders": ["UGX", "10000", "000000123", "txn-1"] } }
  }
}
```

Dry-run writes one JSON log line (`alerts.dry_run`) with the URL and body. The `apiKey` header is replaced with `[redacted]` before logging.

## How Desk and payments should post

Desk success paths call this fire-and-forget helper (see `desk/assets/transactional-alerts.js`):

```http
POST /alerts/api/v1/events
Content-Type: application/json

{ "type": "deposit", "memberId": "42", "phone": "0772000111", "amount": 10000, "currency": "UGX", "account": "000000123", "reference": "R-19" }
```

The browser helper looks up `mobileNo` on the Fineract client with the staff session already in the page. It uses its own `fetch`, so a lookup failure cannot sign the teller out or raise the Desk status bar. If the member has no mobile number, it does not post. Failures are swallowed. The savings or loan posting has already succeeded.

Wired today:

| Desk path | Event |
| --- | --- |
| Savings account deposit / withdrawal | `deposit` / `withdrawal` |
| Savings to savings transfer | `transfer` |
| Savings account activation | `activation` |
| Loan disburse and disburse-to-savings | `loan_disburse` |
| Loan repayment, pay-off, and repayment from savings | `loan_repay` |
| Teller day desk cash in, cash out, and loan repayment | `deposit` / `withdrawal` / `loan_repay` |
| Mobile banking “Clear PIN lock” | `pin` |

Not wired, on purpose:

- **Mobile activation codes** (`POST /mobile/api/.../activation`). Desk shows the code once and tells staff not to send it by SMS or WhatsApp. This service must not deliver that code.
- **Savings account closure.** Closure is several Fineract posts (interest, optional transfer, close). An alert in the middle can fire for a close that then fails.
- **Payments gateway** (`/opt/pivot-sacco/payments`, not in this repo). After a successful collect or disburse, that service can `POST /alerts/api/v1/events` the same JSON. Do not call it before Fineract has accepted the posting.

If `ALERTS_API_KEY` is set, browser calls need the header. Preferred production setup: keep the process on localhost and let host Caddy add the header so the key is not stored in Desk JavaScript. `alerts/deploy/caddy-alerts.caddy` is that host snippet (`reverse_proxy /alerts/* 127.0.0.1:8095`). The gateway file `deploy/production/caddy/routes.caddy` does not proxy `/alerts/*`, because `127.0.0.1` inside the container is not this service. The nginx snippet is `alerts/deploy/nginx-alerts.conf`; its header line ships commented out. Uncomment it only after `set $alerts_api_key "...";` exists in the `http` block. An undefined `$alerts_api_key` prevents nginx from starting. Deploy SACCO Alerts does not edit or reload either proxy, and it does not reload `/etc/caddy/Caddyfile`.

Desk calls relative `/alerts/api/v1`, same pattern as `/payments`.

The Desk screen is `https://<desk-host>/transactional-alerts/`. That path is a static allowlist entry in `deploy/production/caddy/routes.caddy`, not the `/alerts/*` proxy.

## Persistence

v1 stores templates and the delivery log in one JSON file (`ALERTS_DATA_FILE`, default `data/store.json`). On the droplet the unit sets that to `<deploy-dir>/data/store.json` (default `/opt/pivot-sacco/alerts/data/store.json`). Deploys do not delete `data/`. Writes are serialized in-process and use a temp file plus rename. The log keeps the latest 500 rows. The file is gitignored.

To move to Postgres later, replace `createFileStore` in `src/store.js` with an implementation of the same methods: `listTemplates`, `getTemplate`, `putTemplate`, `deleteTemplate`, `appendDeliveries`, `listDeliveries`. A single `alert_templates` table (one row per event type, JSON document) and an `alert_deliveries` table (the delivery record as JSON, indexed by `at desc`) is enough. Point `ALERTS_DATA_FILE` nowhere and construct that store in `createApp`. No HTTP or template shape changes.

## Docker

```bash
docker build -t phaneroo-alerts alerts
docker run --rm -p 8095:8095 -e ALERTS_DRY_RUN=true -v alerts-data:/app/data phaneroo-alerts
```

Mount `/app/data` so the JSON store survives restarts. The container filesystem is otherwise ephemeral.
