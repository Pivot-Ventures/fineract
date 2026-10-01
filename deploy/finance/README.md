# Pivot SACCO — finance configuration

Puts the SACCO's accounting and products into a **fresh** Fineract tenant, such as the one created by `deploy/production`.

| File | Purpose |
|---|---|
| `pivot-sacco-config.json` | The single source of truth. Every business value lives here: chart of accounts, products, fees, share price, provisioning, holidays, payment types and codes. |
| `REVIEW.md` | The sign-off sheet for the Board / Manager, generated from the config. **Values are draft defaults until it is signed.** |
| `apply_config.py` | Applies the config through the Fineract API. It is idempotent (safe to re-run), uses only the standard library, and never modifies existing products. |

Design decisions (agreed 2026-09-30):
- **Accrual (periodic) accounting** for loans, savings and fixed deposits. Share capital is cash-based, because Fineract supports only that for shares.
- **Products:**
  - savings: Voluntary, Compulsory and Children/Youth savings, plus a Fixed Deposit;
  - loans: Business/Development, Emergency, School fees and Salary/Check-off;
  - a member share product.
- **One loan-portfolio and one interest-income ledger account per loan product**, so the trial balance shows each product.
- **Migration clearing account 1990** plus a `Migration` payment type, used to load legacy balances. See *Migration* below.

## Workflow

```bash
cd deploy/finance
python3 apply_config.py --review > REVIEW.md      # 1. regenerate the sheet after any config edit
```

1. The Board / Manager reviews `REVIEW.md`. Correct the values in `pivot-sacco-config.json`, regenerate the sheet, and repeat until it is signed.
2. Apply the config to a **staging** tenant and test it (see *Verification*).
3. Apply it to production, right after `deploy/production/scripts/harden-tenant.sh`:

```bash
docker compose -f ../production/docker-compose.yml exec -T caddy \
  cat /data/caddy/pki/authorities/local/root.crt < /dev/null > caddy-root.crt   # only when CADDY_TLS=internal
python3 apply_config.py --url https://<DESK_DOMAIN>/fineract-provider/api/v1 --user mifos --cacert caddy-root.crt --dry-run
python3 apply_config.py --url https://<DESK_DOMAIN>/fineract-provider/api/v1 --user mifos --cacert caddy-root.crt
```

On failure the script stops, prints Fineract's validation message, and can be re-run once fixed; completed items are skipped. When re-run against a tenant that already has data, it prints **DRIFT** lines wherever the tenant differs from the config. It does not overwrite them.

**Do not apply this to the current dev tenant.** Its GL codes mean different things (e.g. 1130 is "Loans Portfolio" there), and its products use accounting `NONE`. A dry run lists 13 conflicts.

**Change the config before members hold accounts.** Loan and savings products with active accounts cannot change their accounting or ledger accounts. To change rates or fees later, create a new product version.

## Verification (2026-09-30, scratch copy of the production stack)

The config applied cleanly to a fresh tenant: 201 items on the first run, 0 on the second. A posting test then produced the following journal entries (all correct):

| Transaction | Journal entry |
|---|---|
| Cash / MTN / migration deposit | Dr 1120 / 1140 / 1990, Cr 2110 |
| Withdrawal + fee | Dr 2110, Cr 1120; Dr 2110, Cr 4230 |
| Entrance fee (collected by the daily *Pay Due Savings Charges* job) | Dr 2110, Cr 4220 |
| Salary loan disbursed by MoMo | Dr 1240, Cr 1140; processing fee Cr 4210 |
| Repayment | Cr 1240 principal, interest via 1310 |
| Periodic accrual job | Dr 1310, Cr 4140 (interest); Dr 1330, Cr 4240 (penalties) |
| Savings accrual job | Dr 5110, Cr 2210 |
| Share purchase (5 × 20,000) | Cr 3100 |
| Fixed deposit (12 months) | Cr 2130, rate 10% from the chart |
| Loan-loss provisioning | Dr 5210, Cr 2410 |

Business loans without guarantors are refused at approval. The trial balance balances. GL 2110 equals the sum of voluntary savings balances, and GL 1240 equals loan principal outstanding.

## Fineract behaviours this config works around

These were found in testing on the `fineract:latest` 1.16.0-SNAPSHOT image.

1. **Charges sent when a savings account is created crash the server** (HTTP 500, NPE in `SavingsAccountCharge`). Desk therefore creates the account first, then attaches the product's charges one by one (`desk/assets/actions.js`, open savings).
2. **Client-level charges never store their income account**, on create or update, so paying one posts no journal entry. The entrance fee is therefore a *specified-due-date* charge on Voluntary Savings, collected from the member's first deposits.
3. **Minimum opening balance is booked as an automatic cash deposit on activation.** All savings products set it to 0. The first deposit is taken as a normal deposit, and the minimum balance is still enforced. Otherwise every migrated account would gain a phantom deposit.
4. **Fees due at disbursement are booked as cash received at the till** (Dr 1120), whatever payment type the loan went out on. This is flagged in `REVIEW.md`. If fees are deducted from savings instead, switch those charges to payment mode *account transfer*.
5. **Deposit accounts need a liability** for "transfers in suspense" (2340); loans use an asset (1910). **Fixed-deposit interest charts must start at period 1.**

## Migration

- **Loading balances:** load legacy savings, share and loan balances with payment type **Migration**. Each load posts against clearing account **1990**.
- **Opening journal entry:** post non-subledger balances (cash, bank, fixed assets, payables, reserves, retained earnings) as one journal entry against **1990**, from the legacy trial balance at cutover.
- **Balancing test:** after the load, **GL 1990 must be exactly zero**, and each control account (2110–2140, 3100, 1210–1240) must equal its subledger.
- **After cutover:** deactivate the Migration payment type.

Load order: clients → savings → shares → loans → opening journal → reconcile. Enable maker-checker only after the migration reconciles.
