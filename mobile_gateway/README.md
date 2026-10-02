# Pivot SACCO member gateway

The Pivosacc app (`../mobile_flutter`) talks only to this service, never to Fineract. The gateway:

- signs members in with **their own 4-digit PIN on one registered phone** (device binding), not staff credentials;
- holds a **least-privilege Fineract service user** (read clients/savings/loans + create account transfers);
- checks on **every call that the accounts belong to the signed-in member**;
- requires the PIN again for every payment, with **per-transaction and daily limits** and **idempotency keys** so a retry never pays twice;
- locks the PIN for 30 minutes after 3 wrong tries and **blocks after 6** (staff must issue a new code);
- keeps an audit trail of logins, failed PINs, payments and staff actions.

What members can do today: balances, statements, loan schedule, **transfers to any member by account number** (recipient name shown masked, e.g. "James O."), **transfers between own accounts**, **loan repayment from savings**, change PIN, unlink phone. Withdrawals and bill payments need a mobile-money / biller integration and are shown as "coming soon" in the app.

**Mobile-money deposits (`POST /v1/deposits/momo`, `GET /v1/deposits/{id}`) exist but are off** unless `MOMO_PROVIDER` is set, and the only provider today is `sandbox` (simulated approvals — demos only, never production). It is the one endpoint that credits money: once the provider confirms, it posts a savings deposit (`/savingsaccounts/{id}/transactions?command=deposit`). If it is ever enabled for real, the service user also needs `DEPOSIT_SAVINGSACCOUNT`, which `create-gateway-user.sh` does not grant today. With `MOMO_PROVIDER` empty the endpoint returns 503 and the app hides it.

## Enrolment

1. Member visits a branch with ID. Staff open the member in Desk → **Mobile banking** card → **Issue activation code** (8 digits, valid 24 h, shown once).
2. Member installs the app, enters member number + code, and chooses a PIN. The phone is now bound to the account.
3. Forgot PIN / new phone: staff issue a new code (**Reset PIN / new phone**). Lost phone: **Block mobile banking**.

Desk staff need `UPDATE_CLIENT` (or `ALL_FUNCTIONS`); the gateway re-checks their Desk credentials against Fineract on each call.

## API

| Member (Bearer token + `X-Device-Key`) | |
|---|---|
| `POST /v1/auth/activate` | member no + activation code + new PIN + device key → session |
| `POST /v1/auth/login` | member no + PIN + device key → session (5 min idle, 1 h max) |
| `POST /v1/auth/logout`, `/v1/auth/pin`, `/v1/auth/deregister` | |
| `GET /v1/me` | profile, active savings, loans with schedule, recent activity, limits |
| `GET /v1/savings/{id}/transactions`, `GET /v1/loans/{id}` | own accounts only (others → 404) |
| `POST /v1/transfers/recipient` | account no → masked owner name (20 lookups/hour) |
| `POST /v1/transfers` | PIN + idempotency key; savings → any active savings account |
| `POST /v1/loans/{id}/repayments` | PIN + idempotency key; own savings → own active loan |
| `POST /v1/deposits/momo`, `GET /v1/deposits/{id}` | off unless `MOMO_PROVIDER` is set (sandbox only) |

Transfers and repayments answer `200` with `"status": "completed"` and a `reference` when the money has moved, or `202` with `"status": "pending_approval"` when Fineract maker-checker is holding it (see below).

Staff (`X-Staff-Authorization: Basic <Desk key>`): `GET /v1/admin/members/{clientId}`, `POST …/activation`, `…/block`, `…/unlock`.

## Maker-checker

If Fineract maker-checker covers a command the gateway uses, Fineract answers the POST with a `commandId` and no `resourceId`: the command is queued for a checker and **no money has moved**. The gateway then:

- answers `202` with `{"status": "pending_approval", "message": "Your transfer is waiting for branch approval.", "reference": null, "commandId": …, "date", "amount", "from", "to", "note"}` (repayments: `"Your loan repayment is waiting for branch approval."`, with `loan` and `from`);
- still counts the amount against today's limit (it moves as soon as a checker approves it);
- saves that answer under the idempotency key, so a retry replays it and never queues a second command;
- audits `transfer_pending_approval` / `loan_repayment_pending_approval` with the `commandId`, and sends no SMS alert;
- for a mobile-money credit, marks the deposit `pending_approval` (not `successful`) and audits `momo_deposit_pending_approval`. The gateway does not follow up on the approval; staff see the queued command in Fineract.

Recommendation: **exclude `ACCOUNTTRANSFER` (CREATE) from maker-checker for the mobile service user's commands**, or members will see "waiting for branch approval" for every transfer and repayment. The per-transaction and daily limits are the control for mobile.

## Transactional alerts

Optional SMS alerts through the SACCO alerts service (`../alerts`), server to server. Off unless both are set:

| Variable | Example |
|---|---|
| `ALERTS_URL` | `http://alerts:8095` |
| `ALERTS_SERVICE_KEY` | shared secret, sent as `X-Alerts-Service-Key` |

After the member's request has finished, the gateway posts `{ALERTS_URL}/v1/events` in the background (5 s timeout; failures are logged without phone numbers and dropped, never affecting the member):

```json
{"type": "transfer", "idempotencyKey": "transfer:101", "memberId": "1", "phone": "+256772441203",
 "context": {"amount": 10000, "account": "000000001", "balance": 48300.0, "reference": "TRF-101", "memberName": "Grace"}}
```

| Event | `type` | `context` | `idempotencyKey` |
|---|---|---|---|
| Transfer completed | `transfer` | amount, source account no, source available balance after, `TRF-…`, first name | `transfer:<id>` |
| Loan repayment completed | `loan_repay` | amount, **loan** account no, **loan outstanding after** (the SMS names the loan, so the balance is the loan's), `RPY-…`, first name | `loan_repay:<id>` |
| PIN changed in the app / PIN lock cleared by staff | `pin` | — | `pin:changed:<client>:<ts>` / `pin:unlocked:<client>:<ts>` |
| Phone activated (security notice) | `activation` | first name | `activation:<client>:<ts>` |
| Mobile banking blocked by staff | `mobile_blocked` | — | `mobile_blocked:<client>:<ts>` |

`phone` is the Fineract client's `mobileNo` as stored; members without one get no alert. Nothing is sent for `pending_approval` results. Events never carry activation codes, PINs, session tokens or device keys.

## Run

Production: the `gateway` service in `deploy/production/docker-compose.yml`, behind Caddy at `https://<desk domain>/mobile/api`. After `harden-tenant.sh`, run `deploy/production/scripts/create-gateway-user.sh` once to create the Fineract service user and store its password in `.env`. The SQLite database (`gateway_data` volume) is included in `scripts/backup.sh`.

Tests (fake Fineract, no network):

```bash
docker run --rm -v "$PWD":/src -w /src python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```

Try the app on a phone without any Fineract tenant (in-memory fake core banking; staff login `teller` / `secret`):

```bash
docker run --rm -p 8700:8000 -v "$PWD":/src -w /src python:3.12-slim sh -c "pip install -q -r requirements-dev.txt && python -m tests.demo"
```

## Staging smoke test

Runs the gateway against a staging copy of `deploy/production` (its compose file and Caddy are not changed) and walks the member journey (activation, `/me`, statements, loans, recipient lookup):

```bash
mobile_gateway/scripts/staging-smoke.sh <staging deploy/production dir> <compose project> --client-id <id> \
    [--other-savings-id N] [--recipient-account-no X] [--move-money]
```

It creates the gateway service user in that copy (prompts for the staging admin password; `SKIP_USER=1` once done), starts the gateway on `127.0.0.1:8710`, and prompts for a Desk staff login to issue the activation code. Only with `--move-money` does it post a UGX 1,000 own-account transfer and loan repayment; it ends by blocking mobile banking for the test member so the throwaway PIN cannot be reused. A transfer answered with `pending_approval` fails the check — fix the maker-checker setting first.

## Before launch

- Board to confirm the limits (`MOBILE_LIMIT_PER_TXN`, `MOBILE_LIMIT_PER_DAY`; defaults UGX 2,000,000 / 5,000,000) and whether mobile transfers carry a fee.
- Run `create-gateway-user.sh` against the staging tenant and confirm the five permissions are enough (the `/search` and `/clients/{id}/accounts` calls are the ones to watch).
- One uvicorn worker only: the per-member lock and daily-limit check live in the process.
