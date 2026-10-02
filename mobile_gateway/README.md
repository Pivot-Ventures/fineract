# Pivot SACCO member gateway

The Pivosacc app (`../mobile_flutter`) talks only to this service, never to Fineract. The gateway:

- signs members in with **their own 4-digit PIN on one registered phone** (device binding), not staff credentials;
- holds a **least-privilege Fineract service user** (read clients/savings/loans + create account transfers);
- checks on **every call that the accounts belong to the signed-in member**;
- requires the PIN again for every payment, with **per-transaction and daily limits** and **idempotency keys** so a retry never pays twice;
- locks the PIN for 30 minutes after 3 wrong tries and **blocks after 6** (staff must issue a new code);
- keeps an audit trail of logins, failed PINs, payments and staff actions.

What members can do today: balances, statements, loan schedule, **transfers to any member by account number** (recipient name shown masked, e.g. "James O."), **transfers between own accounts**, **loan repayment from savings**, change PIN, unlink phone. Deposits, withdrawals and bill payments need a mobile-money / biller integration and are shown as "coming soon" in the app — the gateway has no endpoint that creates money.

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

Staff (`X-Staff-Authorization: Basic <Desk key>`): `GET /v1/admin/members/{clientId}`, `POST …/activation`, `…/block`, `…/unlock`.

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

## Before launch

- Board to confirm the limits (`MOBILE_LIMIT_PER_TXN`, `MOBILE_LIMIT_PER_DAY`; defaults UGX 2,000,000 / 5,000,000) and whether mobile transfers carry a fee.
- Run `create-gateway-user.sh` against the staging tenant and confirm the five permissions are enough (the `/search` and `/clients/{id}/accounts` calls are the ones to watch).
- One uvicorn worker only: the per-member lock and daily-limit check live in the process.
