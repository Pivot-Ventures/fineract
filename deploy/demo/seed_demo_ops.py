#!/usr/bin/env python3
"""Add demo staff, a teller till and a realistic spread of transactions to a configured tenant.

Run AFTER deploy/finance/apply_config.py and deploy/migration/migrate.py load (it uses their products
and the migrated members). Idempotent for staff/till (matched by name); transactions are added each run,
so run it once.  FOR DEMO TENANTS ONLY — never against a tenant holding real member data.

  python3 seed_demo_ops.py --url https://sacco.pivotventures.tech/fineract-provider/api/v1
"""
import argparse
import datetime as dt
import getpass
import os
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "finance"))
from apply_config import ApiError, Fineract, items  # noqa: E402

D = {"locale": "en", "dateFormat": "yyyy-MM-dd"}
STAFF = [("Sarah", "Namubiru", False), ("Moses", "Okello", True), ("Agnes", "Nabukenya", True), ("David", "Mugisha", False)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--user", default="mifos")
    ap.add_argument("--cacert", help="CA bundle (e.g. Caddy internal root) for non-public certificates")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--yes-this-is-a-demo-tenant", action="store_true", help="required: confirms no real member data")
    a = ap.parse_args()
    if not a.yes_this_is_a_demo_tenant:
        sys.exit("Refusing: pass --yes-this-is-a-demo-tenant (this script invents transactions).")
    pw = os.environ.get("FINERACT_PASSWORD") or getpass.getpass(f"Password for {a.user}: ")
    api = Fineract(a.url, a.tenant, a.user, pw, a.cacert, False, dry_run=False)
    rnd = random.Random(a.seed)
    today = dt.date.today()
    T = today.isoformat()

    office = next(o for o in api.get("/offices") if o.get("parentId") is None)["id"]
    pay = {p["name"]: p["id"] for p in api.get("/paymenttypes")}
    for need in ("Cash", "MTN Mobile Money", "Airtel Money"):
        if need not in pay:
            sys.exit(f"Payment type '{need}' missing — run deploy/finance/apply_config.py first.")

    # ---- staff
    print("Staff")
    existing = {(s["firstname"], s["lastname"]): s["id"] for s in api.get("/staff?status=all")}
    staff = {}
    for first, last, officer in STAFF:
        sid = existing.get((first, last))
        if not sid:
            sid = api.post("/staff", {**D, "officeId": office, "firstname": first, "lastname": last, "isLoanOfficer": officer,
                                      "isActive": True, "joiningDate": "2024-01-08"})["resourceId"]
            print(f"  + {first} {last}{' (loan officer)' if officer else ''}")
        staff[first] = sid

    # ---- till + cashier + float
    print("Teller till")
    tellers = {t["name"]: t["id"] for t in api.get("/tellers")}
    tid = tellers.get("Front Desk Till 1")
    if not tid:
        tid = api.post("/tellers", {**D, "officeId": office, "name": "Front Desk Till 1", "description": "Head Office front desk",
                                    "startDate": (today - dt.timedelta(days=30)).isoformat(), "status": 300})["resourceId"]
        print("  + Front Desk Till 1")
    cashiers = api.get(f"/tellers/{tid}/cashiers").get("cashiers", [])
    cid = next((c["id"] for c in cashiers if c.get("staffId") == staff["Sarah"]), None)
    if not cid:
        cid = api.post(f"/tellers/{tid}/cashiers", {**D, "staffId": staff["Sarah"], "description": "Front desk cashier",
                                                    "startDate": (today - dt.timedelta(days=30)).isoformat(),
                                                    "endDate": (today + dt.timedelta(days=365)).isoformat(), "isFullDay": True})["resourceId"]
        api.post(f"/tellers/{tid}/cashiers/{cid}/allocate", {**D, "txnDate": T, "txnAmount": 2000000, "currencyCode": "UGX",
                                                              "txnNote": "Opening float from vault"})
        print("  + cashier Sarah Namubiru, float UGX 2,000,000")

    # ---- savings activity on migrated members
    print("Savings activity")
    vol = [s for s in items(api.get("/savingsaccounts?limit=500"))
           if s["savingsProductName"] == "Voluntary Savings" and s["status"].get("active")]
    if len(vol) < 5:
        sys.exit("Fewer than 5 active Voluntary Savings accounts — load the sample members first (deploy/migration).")
    n = 0
    for s in rnd.sample(vol, min(len(vol), 24)):
        day = (today - dt.timedelta(days=rnd.randint(0, 6))).isoformat()
        ptype = rnd.choice(["Cash", "Cash", "MTN Mobile Money", "Airtel Money"])
        amt = rnd.choice([20000, 50000, 75000, 100000, 150000, 250000])
        try:
            api.post(f"/savingsaccounts/{s['id']}/transactions?command=deposit",
                     {**D, "transactionDate": day, "transactionAmount": amt, "paymentTypeId": pay[ptype], "receiptNumber": f"RC{rnd.randint(10000, 99999)}"})
            n += 1
            bal = (s.get("summary") or {}).get("accountBalance", 0) + amt
            if rnd.random() < 0.35 and bal > 60000:
                api.post(f"/savingsaccounts/{s['id']}/transactions?command=withdrawal",
                         {**D, "transactionDate": day, "transactionAmount": 30000, "paymentTypeId": pay["Cash"]})
                n += 1
        except ApiError as e:
            print(f"  ! account {s['accountNo']}: {str(e)[:120]}")
    print(f"  + {n} deposits/withdrawals")

    # ---- new loans across products (not the guaranteed business loan: that is shown live in the demo)
    print("Loans")
    products = {p["name"]: p for p in api.get("/loanproducts")}
    plan = [("Emergency Loan", 600000, 3, 3.0), ("School Fees Loan", 1500000, 6, 2.0), ("Salary / Check-off Loan", 3000000, 12, 1.8),
            ("Emergency Loan", 300000, 2, 3.0), ("School Fees Loan", 2400000, 8, 2.0), ("Salary / Check-off Loan", 5000000, 18, 1.8)]
    borrowers = [vol[i % len(vol)] for i in rnd.sample(range(len(vol) * 3), len(plan) + 2)]
    for i, (name, principal, n_inst, rate) in enumerate(plan + [("School Fees Loan", 800000, 4, 2.0), ("Emergency Loan", 400000, 2, 3.0)]):
        p = products.get(name)
        if not p:
            print(f"  ! product {name} missing"); continue
        client = borrowers[i]["clientId"]
        sub = today - dt.timedelta(days=rnd.randint(20, 40)) if i < len(plan) else today
        while sub.weekday() == 6:      # Sunday is not a working day in the SACCO config
            sub -= dt.timedelta(days=1)
        submitted = sub.isoformat()
        tpl = api.get(f"/loans/template?templateType=individual&clientId={client}&productId={p['id']}")
        try:
            lid = api.post("/loans", {**D, "clientId": client, "productId": p["id"], "loanType": "individual", "principal": principal,
                                      "loanTermFrequency": n_inst, "loanTermFrequencyType": 2, "numberOfRepayments": n_inst, "repaymentEvery": 1,
                                      "repaymentFrequencyType": 2, "interestRatePerPeriod": rate, "amortizationType": 1, "interestType": 0,
                                      "interestCalculationPeriodType": 1, "transactionProcessingStrategyCode": "mifos-standard-strategy",
                                      "expectedDisbursementDate": submitted, "submittedOnDate": submitted,
                                      "loanOfficerId": staff[rnd.choice(["Moses", "Agnes"])],
                                      "charges": [{"chargeId": c["chargeId"], "amount": c["amount"]} for c in tpl.get("charges", [])]})["loanId"]
            if i == len(plan) + 1:
                print(f"  + {name} UGX {principal:,} — pending approval (for the work queue)"); continue
            api.post(f"/loans/{lid}?command=approve", {**D, "approvedOnDate": submitted})
            if i == len(plan):
                print(f"  + {name} UGX {principal:,} — approved, awaiting disbursal"); continue
            api.post(f"/loans/{lid}?command=disburse", {**D, "actualDisbursementDate": submitted, "transactionAmount": principal,
                                                         "paymentTypeId": pay[rnd.choice(["Cash", "MTN Mobile Money"])]})
            sched = api.get(f"/loans/{lid}?associations=repaymentSchedule")["repaymentSchedule"]["periods"]
            first = next((x for x in sched if x.get("period") == 1), None)
            if first and dt.date(*first["dueDate"]) <= today and rnd.random() < 0.8:
                api.post(f"/loans/{lid}/transactions?command=repayment", {**D, "transactionDate": dt.date(*first["dueDate"]).isoformat(),
                                                                          "transactionAmount": first["totalDueForPeriod"], "paymentTypeId": pay["Cash"]})
                print(f"  + {name} UGX {principal:,} — disbursed, first instalment repaid")
            else:
                print(f"  + {name} UGX {principal:,} — disbursed")
        except ApiError as e:
            print(f"  ! {name}: {str(e)[:160]}")

    # ---- additional shares
    print("Shares")
    shares = [s for s in items(api.get("/accounts/share?limit=200")) if (s.get("status") or {}).get("value") == "Active"]
    for sh in rnd.sample(shares, min(5, len(shares))):
        try:
            api.post(f"/accounts/share/{sh['id']}?command=applyadditionalshares", {**D, "requestedDate": T, "requestedShares": rnd.choice([5, 10]),
                                                                                    "unitPrice": 20000})
            pending = [p for p in api.get(f"/accounts/share/{sh['id']}").get("purchasedShares", []) if (p.get("status") or {}).get("value", "").lower().startswith("pending")]
            if pending:
                api.post(f"/accounts/share/{sh['id']}?command=approveadditionalshares", {"requestedShares": [{"id": pending[-1]["id"]}]})
            print(f"  + share account {sh.get('accountNo')}: additional shares")
        except ApiError as e:
            print(f"  ! share account {sh.get('accountNo')}: {str(e)[:120]}")

    print("\nDone. Now in Desk: Roles → Create standard SACCO roles; Users → create the teller login for Sarah Namubiru (Teller role).")


if __name__ == "__main__":
    main()
