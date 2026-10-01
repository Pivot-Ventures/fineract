# Pivot SACCO — legacy data migration

Loads members, savings balances, shares, active loans and the opening trial balance from the old system into a Fineract tenant that has been set up with `deploy/production` and `deploy/finance`. Then it proves the books tie out.

| File | Purpose |
|---|---|
| `templates/*.csv` | The five files the old system must be exported into (headers plus one example row each). |
| `migrate.py` | Runs `validate` → `load` → `reconcile`. Standard library only. |
| `gen_sample.py` | Generates a synthetic legacy extract for rehearsals. Contains no real member data. |

## How the money flows

- **Savings:** each balance is deposited on the cutover date using the **Migration** payment type: Dr **1990** clearing, Cr the savings control account.
- **Loans:** each loan is disbursed on the cutover date for its **outstanding principal** via Migration (Dr portfolio, Cr 1990). The repayment schedule covers the remaining instalments, starting from the legacy next due date.
- **Loan arrears:** unpaid interest and fees become a *Migrated arrears* charge due on the cutover date. They accrue to contra account **4900**, so income the old system already recognised is not counted twice.
- **Shares:** share accounts are activated on the cutover date at the share price.
- **Opening journal:** the rest of the legacy trial balance (cash, bank, assets, payables, reserves, retained earnings) is posted as one journal (`MIGRATION-OPENING`) against 1990. It also reverses the cash that share activation books, and offsets 4900.
- **Result:** after a correct load, **1990 and 4900 are exactly zero**, and every control account equals the sum of its member accounts.

## Steps

```bash
cd deploy/migration
export FINERACT_PASSWORD='...'          # the admin password set by harden-tenant.sh (or omit to be prompted)
A="--data /path/to/extract --cutover 2026-09-30 --url https://<host>/fineract-provider/api/v1 --cacert caddy-root.crt"
python3 migrate.py validate  $A          # never writes; stops on any inconsistency
python3 migrate.py load      $A          # safe to re-run after a failure; finished records are skipped
python3 migrate.py reconcile $A          # must end with "RECONCILED"
```

**`validate` checks everything before a single record is written:**
- **Files:** duplicate numbers, unknown members, products or offices, dates after the cutover, fractional shillings.
- **Product limits:** share and loan amounts outside product limits; next due dates more than two months after the cutover.
- **Trial balance:** it must balance, and each control line (savings, loans, share capital, receivables) must equal the total of the detail files.

**`reconcile`** runs the accrual job, then checks:
- the trial balance balances;
- 1990 and 4900 are zero;
- every subledger equals its control account;
- member, account and loan counts match the files;
- every legacy trial-balance line equals the Fineract balance as at the cutover date.

Each `load` appends what it created to `migration-log.jsonl` in the data folder. Keep this as the audit trail.

## Rehearsal (staging dry run, 2026-10-01)

Ran against a hardened staging copy of the production stack (`~/Projects/sacco/pivot-staging`, https://localhost:8460) using a synthetic extract: 300 members, 531 savings accounts, 300 share accounts, 131 loans (13 with arrears), and a UGX 571.9M trial balance.

| Step | Result |
|---|---|
| `validate` on an extract with planted errors | 11 errors reported, nothing loaded |
| `validate` on the clean extract | consistent |
| `load` (4 workers) | 300/300 members, 0 failures, 2 min 50 s (≈1.8 members/s, so ~45 min for 5,000 members) |
| `reconcile` | **RECONCILED**: 1990 = 0, 4900 = 0, 7 control accounts = subledgers, 17/17 legacy TB lines match |
| `load` re-run | 0 new records; the books still reconcile |

## Known limits and policy decisions

- **Fixed deposits** are not loaded yet. `validate` rejects them. Open them in Desk at cutover, or extend the loader.
- **Loan arrears history resets.** All outstanding principal is rescheduled from the legacy next due date, so days-in-arrears and PAR start fresh. Overdue principal at cutover is **not** shown as overdue. Report it from the legacy system for the first month, or ask the Board whether to load such loans differently.
- **Legacy business loans** load into *Business / Development Loan (migrated)*. This product uses the same ledger accounts but no guarantee hold, because guarantor records are not migrated and this Fineract build crashes when a loan product is edited. Desk hides it for new lending.
- **Loans outside current product limits** (amount, term, rate) are rejected by `validate`. Decide case by case: correct the extract, or widen the product before the load.
- **Shares:** every shareholder needs a Voluntary Savings account in `savings.csv`, because Fineract links dividends to it. Holdings below the 5-share minimum are rejected.
- **Entrance fees** are not charged to migrated accounts. Recurring fees, such as the withdrawal fee, are attached.

## Cutover day

1. Freeze the old system at close of business on the cutover date. Take the extract and the legacy trial balance, both as at that date.
2. Back up the production database (`deploy/production/scripts/backup.sh`).
3. Run `validate`, `load` and `reconcile`. The manager and an auditor sign the reconcile output.
4. Spot-check 5–10% of member statements in Desk against the legacy statements.
5. Deactivate the **Migration** payment type, enable maker-checker, and take another backup before the branches open.
