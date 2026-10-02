# Phaneroo SACCO: demo script

**URL:** https://sacco.pivotventures.tech · **Duration:** about 45 minutes · **Presenter's laptop:** Chrome, zoom 100%, signed in as `mifos`

## Before the demo (do these the night before)

1. **Deploy the Desk:** `rsync` command in the chat. Then hard-refresh with Cmd+Shift+R.
2. **Load the SACCO configuration** (chart of accounts, products, fees, holidays):
   `python3 deploy/finance/apply_config.py --url https://sacco.pivotventures.tech/fineract-provider/api/v1`
3. **Optional: load the 300-member sample SACCO** so screens are full. This is synthetic data; wipe it before go-live.
4. **Set up in the Desk:**
   - Roles → **Create standard SACCO roles**.
   - Staff → add "Sarah Namubiru".
   - Tellers → create "Front Desk Till 1" and assign Sarah as cashier.
   - Users → create `snamubiru` with the Teller role, linked to Sarah.
   - Sign in as `snamubiru` once in a private window and set her password.
5. As `mifos`: open the till → **Allocate** UGX 2,000,000 float.

## 1. Sign in and dashboard (3 min)
- Point out the Phaneroo branding and the secure connection (Let's Encrypt).
- **Dashboard:**
  - **Figures:** active members, loans outstanding, savings balance, PAR > 30, teller cash today.
  - **Work queues:** loans pending approval, loans awaiting disbursal, members awaiting activation.

## 2. Members (7 min)
- **Members → Onboard member:**
  1. Name, gender and date of birth.
  2. Mobile 07…, normalised automatically.
  3. National ID (NIN, checked for format), office and loan officer.
  4. Photo and documents.
  5. **Create.**
- **Show the duplicate guard:** start onboarding again with the same NIN. The Desk names the existing member and refuses.
- **Search:** type a surname in lowercase, a phone number, or part of a NIN.
- **Member profile:**
  - Profile edit.
  - Identifiers, next of kin and documents.
  - **Accounts tab** (savings, shares and loans with totals).
  - Transfer / close (explain only).

## 3. Savings, shares, fixed deposits (8 min)
- **Open savings:**
  - Open **Voluntary Savings** for the new member. The UGX 20,000 entrance fee attaches automatically.
  - **Deposit** 200,000 by MTN Mobile Money with a reference, then show the confirmation step.
  - **Withdraw** 50,000 cash: the UGX 1,000 fee and the minimum balance are shown before posting.
  - **Statement** → date range → **Print**.
- **Shares:** open a share account (5 shares × UGX 20,000), then **Buy** 5 more and show the value.
- **Fixed deposit:**
  1. Choose 12 months; the 10% chart rate and the estimated maturity amount appear.
  2. Fund it by transfer from savings.
  3. Show **Early close preview**.

## 4. Loans (10 min), the centrepiece
- **Loan application:**
  1. **Business / Development Loan**, UGX 2,000,000, 12 months.
  2. Limits are checked live, and the 2% processing fee comes from the product.
  3. **Schedule preview**.
  4. Submit.
- **Loan detail → Approve** is blocked by "guarantee coverage not met". Add:
  - the **own-savings guarantee**;
  - a **member guarantor** (search by name with a capital letter, e.g. "Babirye").
  - The coverage meters fill, then **Approve**.
- **Disburse** via MTN with a reference. The confirmation shows the fee and the net amount.
- **Repay:** cash at the till, or **from savings**. Show the receipt and the schedule turning "Paid".
- **Collections:** overdue loans by age bucket, officer filter and PAR %.

## 5. Front office (7 min), sign in as the teller `snamubiru`
- **Teller day desk shows "My drawer":** opening float, cash in/out and running balance.
- **Cash in:** deposit for a member. **Cash out:** a withdrawal larger than the drawer is refused with the maximum allowed.
- **Cashier EOD** (back as `mifos`): count notes and coins → variance against the system → **Settle** → print the EOD sheet with signature lines.
- **Roles:** Teller / Loan Officer / Branch Manager / Accountant / Auditor. Show that the teller doesn't see Accounting or Users.

## 6. Accounting and reports (8 min)
- **Chart of accounts:** the SACCO tree with balances. Click **Entries** on Bank (1130).
- **Journal entry:** use the "Bank charges" rule → post → open the voucher → **Print**.
- **Trial balance:** "Balanced" badge. **Balance sheet:** Assets = Liabilities + Equity.
- **Reports:**
  - **Portfolio at Risk** (works on live, which has the report fix).
  - Active Loans, Expected Payments, Client Listing.
  - CSV export.
- **Member statement:** savings, shares and loans with opening/closing balances → print with the Phaneroo header.

## Questions to expect and honest answers
- **"Can members use a phone app?"** Not yet. It's being rebuilt with its own secure member login. This demo is the staff system.
- **"Mobile money?"** MTN and Airtel are recorded as payment types today. Automatic collection and payout (API) come in a later phase.
- **"Our existing data?"** A tested migration tool loads members, balances, shares and active loans, then proves the books tie out to the old trial balance.
- **"Approvals by two people?"** Maker-checker is switched on after migration.

## After the demo, before go-live
- Wipe the sample data (fresh tenant).
- Apply the Board-approved config.
- Run `harden-tenant.sh`.
- Turn on nightly backups.
- Run the real migration.
