# Pivot SACCO — finance configuration sign-off

Config version `2026-09-30-draft`. These are **draft defaults**. Each value must be confirmed or corrected by the Board / Manager before `apply_config.py` runs against production. Loan and savings terms cannot be changed freely once members hold accounts.

Accounting: **accrual (periodic)** for loans, savings and fixed deposits; cash for share capital (Fineract limitation). Currency UGX, 0 decimals.

## Loan products

| Product | Amount (UGX) | Term (months) | Interest | Fees | Guarantee | Portfolio GL / income GL | ✔ |
|---|---|---|---|---|---|---|---|
| Business / Development Loan | 500,000–20,000,000 (default 2,000,000) | 3–36 | 2% per month reducing (allowed 1.5–2.5%) | Loan processing fee 2%, Late repayment penalty | 50% (25% own savings + 25% guarantors) | 1210 / 4110 | ☐ |
| Business / Development Loan (migrated) | 10,000–100,000,000 (default 2,000,000) | 1–60 | 2% per month reducing (allowed 0.5–5%) | Late repayment penalty | none | 1210 / 4110 | ☐ |
| Emergency Loan | 100,000–2,000,000 (default 500,000) | 1–3 | 3% per month reducing (allowed 3–3%) | Loan processing fee 1%, Late repayment penalty | none | 1220 / 4120 | ☐ |
| School Fees Loan | 200,000–10,000,000 (default 1,000,000) | 3–12 | 2% per month reducing (allowed 1.5–2%) | Loan processing fee 1.5%, Late repayment penalty | none | 1230 / 4130 | ☐ |
| Salary / Check-off Loan | 500,000–30,000,000 (default 3,000,000) | 3–36 | 1.8% per month reducing (allowed 1.5–2%) | Loan processing fee 1.5%, Late repayment penalty | none | 1240 / 4140 | ☐ |

All loans: equal monthly instalments, amounts in multiples of UGX 1,000, non-performing after 90 days in arrears, repayments applied penalties → fees → interest → principal.

## Savings and deposits

| Product | Interest | Minimum balance | Withdrawal rules | Fees | Liability GL | ✔ |
|---|---|---|---|---|---|---|
| Voluntary Savings | 3% p.a., posted annually | 5,000 | any time | Membership / entrance fee (UGX 20,000), Savings withdrawal fee (UGX 1,000) | 2110 | ☐ |
| Compulsory Savings | 5% p.a., posted annually | 0 | locked first 12 months | none | 2120 | ☐ |
| Children and Youth Savings | 4% p.a., posted annually | 5,000 | locked first 3 months | none | 2140 | ☐ |
| Fixed Deposit | 1–5 m: 6%; 6–11 m: 8%; 12–24 m: 10% | min 500,000 | 3–24 months; early closure −2% rate | none | 2130 | ☐ |

## Share capital

- Share price **UGX 20,000**; minimum **5 shares** (UGX 100,000); maximum 5,000 per member; 1,000,000 authorised. ☐
- Shares locked for 12 months; dividends only for shares held 90+ days. ☐

## Fees and penalties

| Charge | Applies to | Amount | Income GL | ✔ |
|---|---|---|---|---|
| Membership / entrance fee | savings | UGX 20,000 | 4220 Membership and entrance fees | ☐ |
| Loan processing fee 2% | loan | 2% | 4210 Loan processing fees | ☐ |
| Loan processing fee 1.5% | loan | 1.5% | 4210 Loan processing fees | ☐ |
| Loan processing fee 1% | loan | 1% | 4210 Loan processing fees | ☐ |
| Late repayment penalty | loan | 1% | 4240 Penalty income | ☐ |
| Migrated arrears (interest and fees) | loan | set per loan (migration only) | 4900 Migration income adjustment | ☐ |
| Savings withdrawal fee | savings | UGX 1,000 | 4230 Savings account fees | ☐ |

## Loan loss provisioning

| Category | Days in arrears | Provision | ✔ |
|---|---|---|---|
| STANDARD | 0–30 | 1% | ☐ |
| SUB-STANDARD | 31–90 | 25% | ☐ |
| DOUBTFUL | 91–180 | 50% | ☐ |
| LOSS | 181–∞ | 100% | ☐ |

## Operations

- Working days: MO, TU, WE, TH, FR, SA; repayments on a closed day move to the next working day. ☐
- Public holidays loaded: 17 (Eid dates are provisional until gazetted). ☐
- Payment types → ledger: Cash → 1120; MTN Mobile Money → 1140; Airtel Money → 1150; Bank transfer → 1130; Cheque → 1130; Salary check-off → 1160; Migration → 1990. ☐

## Chart of accounts

| Code | Account | Type |
|---|---|---|
| 1000 | **ASSETS** | Asset |
| 1100 | **Cash and bank** | Asset |
| 1110 | Cash in main vault | Asset |
| 1120 | Cash at teller tills | Asset |
| 1130 | Bank current account | Asset |
| 1140 | MTN Mobile Money float | Asset |
| 1150 | Airtel Money float | Asset |
| 1160 | Salary check-off receivable (employers) | Asset |
| 1200 | **Loan portfolio** | Asset |
| 1210 | Business / development loans | Asset |
| 1220 | Emergency loans | Asset |
| 1230 | School fees loans | Asset |
| 1240 | Salary / check-off loans | Asset |
| 1300 | **Receivables** | Asset |
| 1310 | Interest receivable on loans | Asset |
| 1320 | Fees receivable | Asset |
| 1330 | Penalties receivable | Asset |
| 1340 | Other receivables | Asset |
| 1500 | **Fixed assets** | Asset |
| 1510 | Furniture and fittings | Asset |
| 1520 | Computers and equipment | Asset |
| 1530 | Motor vehicles | Asset |
| 1590 | Accumulated depreciation | Asset |
| 1600 | **Investments** | Asset |
| 1610 | Fixed deposits with banks | Asset |
| 1620 | Treasury bills and bonds | Asset |
| 1900 | **Clearing and suspense** | Asset |
| 1910 | Transfers in suspense | Asset |
| 1990 | Data migration clearing | Asset |
| 2000 | **LIABILITIES** | Liability |
| 2100 | **Member deposits** | Liability |
| 2110 | Voluntary savings | Liability |
| 2120 | Compulsory savings | Liability |
| 2130 | Fixed deposits | Liability |
| 2140 | Children and youth savings | Liability |
| 2200 | **Interest payable** | Liability |
| 2210 | Interest payable on savings | Liability |
| 2220 | Interest payable on fixed deposits | Liability |
| 2300 | **Payables** | Liability |
| 2310 | Accounts payable | Liability |
| 2320 | Withholding tax payable | Liability |
| 2330 | Loan overpayments | Liability |
| 2340 | Liability transfers in suspense | Liability |
| 2350 | Dividends payable | Liability |
| 2360 | Share purchases in suspense | Liability |
| 2370 | Dormant / unclaimed balances | Liability |
| 2400 | **Provisions** | Liability |
| 2410 | Loan loss provision | Liability |
| 2500 | **Borrowings** | Liability |
| 2510 | External borrowings | Liability |
| 3000 | **EQUITY** | Equity |
| 3100 | Member share capital | Equity |
| 3200 | Statutory reserve | Equity |
| 3300 | Retained earnings | Equity |
| 3400 | Donations and grants | Equity |
| 3900 | Opening balances contra | Equity |
| 4000 | **INCOME** | Income |
| 4100 | **Interest income on loans** | Income |
| 4110 | Interest - business loans | Income |
| 4120 | Interest - emergency loans | Income |
| 4130 | Interest - school fees loans | Income |
| 4140 | Interest - salary loans | Income |
| 4200 | **Fee and commission income** | Income |
| 4210 | Loan processing fees | Income |
| 4220 | Membership and entrance fees | Income |
| 4230 | Savings account fees | Income |
| 4240 | Penalty income | Income |
| 4300 | **Other income** | Income |
| 4310 | Interest on bank deposits and investments | Income |
| 4320 | Recoveries of written-off loans | Income |
| 4330 | Miscellaneous income | Income |
| 4900 | Migration income adjustment | Income |
| 5000 | **EXPENSES** | Expense |
| 5100 | **Interest expense** | Expense |
| 5110 | Interest on savings | Expense |
| 5120 | Interest on fixed deposits | Expense |
| 5130 | Interest on borrowings | Expense |
| 5200 | **Credit losses** | Expense |
| 5210 | Loan loss provision expense | Expense |
| 5220 | Loans written off | Expense |
| 5300 | **Operating expenses** | Expense |
| 5310 | Salaries and wages | Expense |
| 5320 | Rent | Expense |
| 5330 | Utilities | Expense |
| 5340 | Stationery and printing | Expense |
| 5350 | Transport | Expense |
| 5360 | Communication and airtime | Expense |
| 5370 | Bank charges | Expense |
| 5380 | Mobile money charges | Expense |
| 5390 | Depreciation | Expense |
| 5395 | Audit and professional fees | Expense |
| 5396 | Board and AGM expenses | Expense |
| 5397 | Software and IT | Expense |

## Reviewer notes (policy details behind the numbers)

- **workingDays**: branches open Monday–Saturday; repayments falling on a non-working day move to the next working day.
- **Bank current account**: one account per bank (e.g. Centenary, Stanbic)
- **Membership / entrance fee**: one-off entrance fee UGX 20,000, attached to the member's Voluntary Savings account when it is opened and collected automatically from the first deposits (daily 'Pay Due Savings Charges' job). Modelled on savings because this Fineract build does not store an income account on client-level charges.
- **Loan processing fee 2%**: 2% of principal at disbursement. Fineract books disbursement fees as cash received at the till (Dr 1120). If the fee is instead deducted from the member's savings, switch these charges to payment mode 'account transfer'.
- **Late repayment penalty**: 1% per month of the overdue instalment (principal + interest)
- **Savings withdrawal fee**: UGX 1,000 per over-the-counter withdrawal
- **Member Shares**: share price UGX 20,000; minimum 5 shares (UGX 100,000) to be a full member; max 5,000 shares per member; shares locked 12 months; dividends only for shares held 90+ days.
- **Voluntary Savings**: 3% p.a. on daily balance, compounded monthly, posted annually; first deposit at least UGX 10,000 (collected as a normal deposit); minimum balance UGX 5,000; no interest below UGX 50,000; entrance fee UGX 20,000 charged on activation.
- **Compulsory Savings**: 5% p.a.; first deposit UGX 20,000; UGX 20,000/month expected contribution (enforced by staff/standing instruction, not the product); withdrawals blocked for the first 12 months. Fineract has no 'withdraw only on exit' rule — closing the account on exit is the control.
- **Children and Youth Savings**: 4% p.a.; minimum balance UGX 5,000; withdrawals blocked for the first 3 months; no withdrawal fee.
- **Fixed Deposit**: 3–24 months in 3-month steps; minimum UGX 500,000; 6% (3–5 m), 8% (6–11 m), 10% (12–24 m) p.a.; early closure loses 2% of the rate.
- **Business / Development Loan**: UGX 500k–20M, 3–36 months, 2% per month reducing balance (range 1.5–2.5%), 2% processing fee, 50% of the loan must be guaranteed (25% own savings + 25% guarantors).
- **Business / Development Loan (migrated)**: holds legacy business loans at their existing terms. Same ledger accounts as the main business loan. It has no guarantee hold because legacy guarantor records are not migrated, and this Fineract build cannot switch the rule off and back on during the load.
- **Emergency Loan**: UGX 100k–2M, 1–3 months, 3% per month reducing balance, 1% processing fee, no guarantee requirement.
- **School Fees Loan**: UGX 200k–10M, 3–12 months, 2% per month reducing balance, 1.5% processing fee.
- **Salary / Check-off Loan**: UGX 500k–30M, 3–36 months, 1.8% per month reducing balance, 1.5% processing fee; requires an employer check-off agreement (tracked outside Fineract).
- **Pivot SACCO loan loss provisioning**: against the UMRA Tier 4 provisioning rules and your auditor: 1% (0–30 days), 25% (31–90), 50% (91–180), 100% (180+).
- **Eid al-Fitr 2027**: lunar date, confirm when gazetted
- **Eid al-Adha 2027**: lunar date, confirm when gazetted

First deposits are taken as normal deposits: Fineract's automatic opening-balance deposit is switched off because it would record cash that was never received (and would corrupt migrated balances).

## Not modelled in Fineract (policy / manual controls)

- Loan-to-savings multiple (e.g. 3× savings), check-off employer agreements, compulsory monthly contribution amount.
- Withholding tax on savings interest (add a Fineract tax group if URA requires it).

Approved by: ____________________  Title: ______________  Date: ___________

