#!/usr/bin/env python3
"""Load Pivot SACCO legacy data into a Fineract tenant configured by deploy/finance.

  python3 migrate.py validate  --data DIR --cutover 2026-09-30 --url URL [--cacert CRT]
  python3 migrate.py load      --data DIR --cutover 2026-09-30 --url URL [--cacert CRT] [--workers 4]
  python3 migrate.py reconcile --data DIR --cutover 2026-09-30 --url URL [--cacert CRT]

DIR holds members.csv, savings.csv, shares.csv, loans.csv and trial_balance.csv (see templates/).
Every record is keyed by its legacy number (stored as Fineract externalId), so `load` can be re-run
after a failure: finished records are skipped and half-finished ones are completed.

Balances enter Fineract through the "Migration" payment type, which posts against clearing account
1990. The opening journal posts the rest of the legacy trial balance against 1990 as well, so after a
correct load GL 1990 is exactly zero. `reconcile` proves that, and that every control account equals
its subledger. Standard library only; the password comes from $FINERACT_PASSWORD or a prompt.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import datetime as dt
import getpass
import json
import os
import sys
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "finance"))
from apply_config import ApiError, Fineract, items  # noqa: E402

D = {"locale": "en", "dateFormat": "yyyy-MM-dd"}
OPENING_REF = "MIGRATION-OPENING"
CLEARING_GL = "1990"
ARREARS_INCOME_GL = "4900"
ARREARS_CHARGE = "Migrated arrears (interest and fees)"
MIGRATION_PAYMENT = "Migration"
LOG_LOCK = threading.Lock()


# ------------------------------------------------------------------ input files
def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [{k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def money(v: str) -> int:
    """UGX has no minor unit: accept '1,250,000' / '1250000' / '1250000.00', reject fractions."""
    x = float((v or "0").replace(",", ""))
    if x != int(x):
        raise ValueError(f"not a whole UGX amount: {v}")
    return int(x)


def day(v: str) -> dt.date:
    return dt.date.fromisoformat(v)


class Data:
    def __init__(self, folder: Path):
        self.members = read_csv(folder / "members.csv")
        self.savings = read_csv(folder / "savings.csv")
        self.shares = read_csv(folder / "shares.csv")
        self.loans = read_csv(folder / "loans.csv")
        self.tb = read_csv(folder / "trial_balance.csv")


# ------------------------------------------------------------------ tenant lookups
class Tenant:
    def __init__(self, api: Fineract, cfg: dict):
        self.api = api
        self.cfg = cfg
        self.offices = {o["name"]: o["id"] for o in api.get("/offices")}
        self.gl = {g["glCode"]: g for g in api.get("/glaccounts")}
        self.savings_products = {p["name"]: p for p in api.get("/savingsproducts")}
        self.loan_products = {p["name"]: api.get(f"/loanproducts/{p['id']}") for p in api.get("/loanproducts")}
        shares = items(api.get("/products/share"))
        self.share_product = api.get(f"/products/share/{shares[0]['id']}") if shares else None
        self.payment_types = {p["name"]: p["id"] for p in api.get("/paymenttypes")}
        self.charges = {c["name"]: c for c in api.get("/charges")}
        codes = {c["name"]: c["id"] for c in api.get("/codes")}
        self.genders = {v["name"].lower(): v["id"] for v in api.get(f"/codes/{codes['Gender']}/codevalues")}
        self.id_types = {v["name"]: v["id"] for v in api.get(f"/codes/{codes['Customer Identifier']}/codevalues")}
        # control accounts whose balances come from subledgers, never from the opening journal
        sp = {p["name"]: p["gl"]["control"] for p in cfg["savingsProducts"]}
        sp[cfg["fixedDepositProduct"]["name"]] = cfg["fixedDepositProduct"]["gl"]["control"]
        self.savings_gl = sp
        self.loan_gl = {p["name"]: p["gl"]["portfolio"] for p in cfg["loanProducts"]}
        # legacy rows name the product the member knows; some load into a "(migrated)" twin with legacy-friendly rules
        self.load_product = {p["name"]: p["name"] for p in cfg["loanProducts"]}
        self.load_product.update({p["migrates"]: p["name"] for p in cfg["loanProducts"] if p.get("migrates")})
        self.share_gl = cfg["shareProduct"]["gl"]["shareEquity"]
        d = cfg["loanProductDefaults"]["gl"]
        self.receivable_gls = {d["interestReceivable"], d["feesReceivable"], d["penaltiesReceivable"]}
        self.subledger_gls = set(sp.values()) | set(self.loan_gl.values()) | {self.share_gl} | self.receivable_gls


# ------------------------------------------------------------------ validate
def validate(data: Data, t: Tenant, cutover: dt.date) -> tuple[list[str], list[str], dict]:
    errors, warnings = [], []

    def err(where, msg):
        errors.append(f"{where}: {msg}")

    for need in (MIGRATION_PAYMENT,):
        if need not in t.payment_types:
            err("tenant", f"payment type '{need}' missing — run deploy/finance/apply_config.py first")
    for gl in (CLEARING_GL, ARREARS_INCOME_GL):
        if gl not in t.gl:
            err("tenant", f"GL {gl} missing — run deploy/finance/apply_config.py first")
    if ARREARS_CHARGE not in t.charges:
        err("tenant", f"charge '{ARREARS_CHARGE}' missing — run deploy/finance/apply_config.py first")
    if not data.members:
        err("members.csv", "no rows")

    members = {}
    for i, m in enumerate(data.members, start=2):
        w = f"members.csv line {i}"
        no = m.get("member_no")
        if not no:
            err(w, "member_no is empty"); continue
        if no in members:
            err(w, f"duplicate member_no {no}")
        members[no] = m
        if not m.get("first_name") or not m.get("last_name"):
            err(w, "first_name and last_name are required")
        if m.get("office", "Head Office") not in t.offices:
            err(w, f"unknown office '{m.get('office')}' (tenant has {sorted(t.offices)})")
        if m.get("gender") and m["gender"].lower() not in t.genders:
            err(w, f"unknown gender '{m['gender']}'")
        try:
            if day(m["joined_date"]) > cutover:
                err(w, "joined_date is after the cutover date")
            if m.get("date_of_birth") and day(m["date_of_birth"]) >= day(m["joined_date"]):
                err(w, "date_of_birth is not before joined_date")
        except (KeyError, ValueError) as e:
            err(w, f"bad date ({e})")

    totals = Counter()
    seen = set()
    vol_name = t.cfg["savingsProducts"][0]["name"]
    has_voluntary = set()
    for i, s in enumerate(data.savings, start=2):
        w = f"savings.csv line {i}"
        if s.get("account_no") in seen:
            err(w, f"duplicate account_no {s.get('account_no')}")
        seen.add(s.get("account_no"))
        if s.get("member_no") not in members:
            err(w, f"unknown member_no {s.get('member_no')}")
        if s.get("product") not in t.savings_products:
            err(w, f"unknown savings product '{s.get('product')}'")
            continue
        if s["product"] == t.cfg["fixedDepositProduct"]["name"]:
            err(w, "fixed deposits are not loaded by this tool yet — open them in Desk at cutover")
        try:
            bal = money(s["balance"])
            if bal < 0:
                err(w, "negative balance")
            totals[t.savings_gl[s["product"]]] += bal
            if day(s["opened_date"]) > cutover:
                err(w, "opened_date is after the cutover date")
            m = members.get(s.get("member_no"))
            if m and day(s["opened_date"]) < day(m["joined_date"]):
                err(w, "opened_date is before the member joined")
        except (KeyError, ValueError) as e:
            err(w, f"bad value ({e})")
        if s.get("product") == vol_name:
            has_voluntary.add(s.get("member_no"))

    sp = t.share_product
    for i, s in enumerate(data.shares, start=2):
        w = f"shares.csv line {i}"
        if s.get("member_no") not in members:
            err(w, f"unknown member_no {s.get('member_no')}"); continue
        try:
            n = int(s["shares"])
        except (KeyError, ValueError):
            err(w, "shares must be a whole number"); continue
        if sp and not (sp["minimumShares"] <= n <= sp["maximumShares"]):
            err(w, f"{n} shares is outside the product limits {sp['minimumShares']}–{sp['maximumShares']}")
        if s["member_no"] not in has_voluntary:
            err(w, f"member needs a {vol_name} account in savings.csv (Fineract links share dividends to it)")
        if sp:
            totals[t.share_gl] += n * int(sp["unitPrice"])

    arrears_total = 0
    seen = set()
    for i, l in enumerate(data.loans, start=2):
        w = f"loans.csv line {i}"
        if l.get("loan_no") in seen:
            err(w, f"duplicate loan_no {l.get('loan_no')}")
        seen.add(l.get("loan_no"))
        if l.get("member_no") not in members:
            err(w, f"unknown member_no {l.get('member_no')}")
        p = t.loan_products.get(t.load_product.get(l.get("product"), ""))
        if not p:
            err(w, f"unknown loan product '{l.get('product')}'"); continue
        try:
            principal = money(l["outstanding_principal"])
            n = int(l["remaining_installments"])
            rate = float(l["monthly_rate"])
            arrears = money(l.get("arrears_interest_and_fees") or "0")
            nxt = day(l["next_due_date"])
        except (KeyError, ValueError) as e:
            err(w, f"bad value ({e})"); continue
        if not (p["minPrincipal"] <= principal <= p["maxPrincipal"]):
            err(w, f"outstanding principal {principal:,} is outside product limits {p['minPrincipal']:,.0f}–{p['maxPrincipal']:,.0f}")
        if principal % int(p.get("inMultiplesOf") or 1):
            err(w, f"outstanding principal {principal:,} is not a multiple of {p['inMultiplesOf']}")
        if not (p["minNumberOfRepayments"] <= n <= p["maxNumberOfRepayments"]):
            err(w, f"{n} remaining instalments is outside product limits {p['minNumberOfRepayments']}–{p['maxNumberOfRepayments']}")
        if not (p["minInterestRatePerPeriod"] <= rate <= p["maxInterestRatePerPeriod"]):
            err(w, f"rate {rate}% is outside product limits {p['minInterestRatePerPeriod']}–{p['maxInterestRatePerPeriod']}%")
        if not (cutover < nxt <= cutover + dt.timedelta(days=62)):
            err(w, f"next_due_date {nxt} must fall within two months after the cutover")
        if arrears < 0:
            err(w, "negative arrears")
        totals[t.loan_gl[l["product"]]] += principal
        arrears_total += arrears
        if arrears:
            warnings.append(f"{w}: UGX {arrears:,} arrears will be loaded as a '{ARREARS_CHARGE}' charge due on the cutover date")

    # trial balance: balanced, known GLs, subledger lines equal the detail files
    tb_dr = tb_cr = 0
    tb_by_gl = Counter()
    for i, r in enumerate(data.tb, start=2):
        w = f"trial_balance.csv line {i}"
        gl = r.get("gl_code")
        if gl not in t.gl:
            err(w, f"unknown gl_code {gl}"); continue
        if t.gl[gl]["usage"]["value"].upper() == "HEADER":
            err(w, f"gl_code {gl} is a header account; map it to a detail account")
        try:
            dr, cr = money(r.get("debit") or "0"), money(r.get("credit") or "0")
        except ValueError as e:
            err(w, str(e)); continue
        tb_dr += dr
        tb_cr += cr
        tb_by_gl[gl] += dr - cr
        if gl == CLEARING_GL:
            err(w, f"GL {CLEARING_GL} is the migration clearing account and must not appear in the legacy trial balance")
    if data.tb and tb_dr != tb_cr:
        err("trial_balance.csv", f"not balanced: debits {tb_dr:,} ≠ credits {tb_cr:,}")
    if not data.tb:
        err("trial_balance.csv", "missing — the opening journal needs the legacy trial balance at cutover")

    checks = {}
    for gl in sorted(t.subledger_gls):
        if gl in t.receivable_gls:
            continue
        files = totals.get(gl, 0)
        tbv = abs(tb_by_gl.get(gl, 0))
        checks[gl] = (files, tbv)
        if files != tbv:
            err(f"GL {gl} {t.gl[gl]['name']}", f"detail files total {files:,} but the legacy trial balance says {tbv:,}")
    recv_tb = sum(tb_by_gl.get(g, 0) for g in t.receivable_gls)
    checks["receivables"] = (arrears_total, recv_tb)
    if arrears_total != recv_tb:
        err("receivables (1310–1330)", f"loan arrears in loans.csv total {arrears_total:,} but the trial balance has {recv_tb:,}")

    summary = {
        "members": len(data.members), "savings_accounts": len(data.savings), "share_accounts": len(data.shares),
        "loans": len(data.loans), "loan_arrears": arrears_total, "tb_debits": tb_dr, "subledger_checks": checks,
    }
    return errors, warnings, summary


# ------------------------------------------------------------------ load
class Loader:
    def __init__(self, api: Fineract, t: Tenant, data: Data, cutover: dt.date, log_path: Path):
        self.api, self.t, self.data, self.T = api, t, data, cutover.isoformat()
        self.log_path = log_path
        self.client_ids: dict[str, int] = {}
        self.voluntary: dict[str, int] = {}
        self.done = Counter()

    def log(self, kind, legacy, fineract_id, **extra):
        with LOG_LOCK, self.log_path.open("a") as f:
            f.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind, "legacy": legacy, "id": fineract_id, **extra}) + "\n")
        self.done[kind] += 1

    def find_one(self, path):
        r = self.api.get(path)
        r = items(r) if isinstance(r, dict) and "pageItems" in r else r
        return r[0] if r else None

    # members ------------------------------------------------------------
    def member(self, m):
        ext = f"M-{m['member_no']}"
        c = self.find_one(f"/clients?externalId={ext}")
        if c:
            cid = c["id"]
        else:
            body = {**D, "officeId": self.t.offices[m.get("office") or "Head Office"], "legalFormId": 1,
                    "firstname": m["first_name"], "lastname": m["last_name"], "externalId": ext,
                    "active": True, "activationDate": m["joined_date"], "submittedOnDate": m["joined_date"]}
            if m.get("middle_name"):
                body["middlename"] = m["middle_name"]
            if m.get("mobile_no"):
                body["mobileNo"] = m["mobile_no"]
            if m.get("date_of_birth"):
                body["dateOfBirth"] = m["date_of_birth"]
            if m.get("gender"):
                body["genderId"] = self.t.genders[m["gender"].lower()]
            cid = self.api.post("/clients", body)["clientId"]
            self.log("member", m["member_no"], cid)
        if m.get("national_id"):
            have = {i["documentKey"] for i in self.api.get(f"/clients/{cid}/identifiers")}
            if m["national_id"] not in have:
                self.api.post(f"/clients/{cid}/identifiers", {"documentTypeId": self.t.id_types["National ID (NIN)"],
                                                              "documentKey": m["national_id"], "status": "Active"})
        return cid

    # savings ------------------------------------------------------------
    def savings(self, s, cid):
        ext = f"S-{s['account_no']}"
        prod = self.t.savings_products[s["product"]]
        acct = self.find_one(f"/savingsaccounts?externalId={ext}")
        if acct:
            sid = acct["id"]
        else:
            sid = self.api.post("/savingsaccounts", {**D, "clientId": cid, "productId": prod["id"], "externalId": ext,
                                                     "submittedOnDate": s["opened_date"]})["savingsId"]
            # recurring product charges only (withdrawal fee etc.); existing members already paid one-off entrance fees
            tpl = self.api.get(f"/savingsaccounts/template?clientId={cid}&productId={prod['id']}")
            for c in tpl.get("charges", []):
                if (c.get("chargeTimeType") or {}).get("id") != 2:
                    self.api.post(f"/savingsaccounts/{sid}/charges", {**D, "chargeId": c.get("chargeId") or c["id"], "amount": c["amount"]})
        acct = self.api.get(f"/savingsaccounts/{sid}")
        st = acct["status"]
        if st.get("submittedAndPendingApproval"):
            self.api.post(f"/savingsaccounts/{sid}?command=approve", {**D, "approvedOnDate": s["opened_date"]})
            st = {"approved": True}
        if st.get("approved") and not st.get("active"):
            self.api.post(f"/savingsaccounts/{sid}?command=activate", {**D, "activatedOnDate": s["opened_date"]})
        bal = money(s["balance"])
        txns = self.api.get(f"/savingsaccounts/{sid}?associations=transactions").get("transactions", [])
        loaded = any((t.get("paymentDetailData") or {}).get("paymentType", {}).get("name") == MIGRATION_PAYMENT for t in txns)
        if bal and not loaded:
            self.api.post(f"/savingsaccounts/{sid}/transactions?command=deposit",
                          {**D, "transactionDate": self.T, "transactionAmount": bal, "paymentTypeId": self.t.payment_types[MIGRATION_PAYMENT],
                           "note": f"Opening balance migrated from legacy account {s['account_no']}"})
        if bal and not loaded:
            self.log("savings", s["account_no"], sid, balance=bal)
        return sid

    # shares -------------------------------------------------------------
    def share(self, s, cid, savings_id):
        sp = self.t.share_product
        mine = [a for a in self.api.get(f"/clients/{cid}/accounts").get("shareAccounts", []) if a.get("productId") == sp["id"]]
        if mine:
            aid = mine[0]["id"]
        else:
            aid = self.api.post("/accounts/share", {**D, "clientId": cid, "productId": sp["id"], "requestedShares": int(s["shares"]),
                                                    "submittedDate": self.T, "applicationDate": self.T, "savingsAccountId": savings_id,
                                                    "unitPrice": sp["unitPrice"], "externalId": f"SH-{s['member_no']}"})["resourceId"]
            self.log("shares", s["member_no"], aid, shares=int(s["shares"]))
        st = self.api.get(f"/accounts/share/{aid}")["status"]
        if st.get("submittedAndPendingApproval"):
            self.api.post(f"/accounts/share/{aid}?command=approve", {**D, "approvedDate": self.T})
            st = {"approved": True}
        if st.get("approved") and not st.get("active"):
            self.api.post(f"/accounts/share/{aid}?command=activate", {**D, "activatedDate": self.T})

    # loans --------------------------------------------------------------
    def loan(self, l, cid):
        ext = f"L-{l['loan_no']}"
        p = self.t.loan_products[self.t.load_product[l["product"]]]
        ln = self.find_one(f"/loans?externalId={ext}")
        if ln:
            lid = ln["id"]
        else:
            n = int(l["remaining_installments"])
            lid = self.api.post("/loans", {**D, "clientId": cid, "productId": p["id"], "externalId": ext, "loanType": "individual",
                                           "principal": money(l["outstanding_principal"]), "loanTermFrequency": n, "loanTermFrequencyType": 2,
                                           "numberOfRepayments": n, "repaymentEvery": 1, "repaymentFrequencyType": 2,
                                           "interestRatePerPeriod": float(l["monthly_rate"]), "amortizationType": p["amortizationType"]["id"],
                                           "interestType": p["interestType"]["id"], "interestCalculationPeriodType": p["interestCalculationPeriodType"]["id"],
                                           "transactionProcessingStrategyCode": p["transactionProcessingStrategyCode"],
                                           "expectedDisbursementDate": self.T, "submittedOnDate": self.T,
                                           "repaymentsStartingFromDate": l["next_due_date"], "charges": []})["loanId"]
            self.log("loan", l["loan_no"], lid, principal=money(l["outstanding_principal"]))
        st = self.api.get(f"/loans/{lid}")["status"]
        if st.get("pendingApproval"):
            self.api.post(f"/loans/{lid}?command=approve", {**D, "approvedOnDate": self.T, "note": "Migrated from legacy system"})
            st = {"waitingForDisbursal": True}
        if st.get("waitingForDisbursal"):
            self.api.post(f"/loans/{lid}?command=disburse", {**D, "actualDisbursementDate": self.T, "transactionAmount": money(l["outstanding_principal"]),
                                                              "paymentTypeId": self.t.payment_types[MIGRATION_PAYMENT],
                                                              "note": f"Outstanding principal migrated from legacy loan {l['loan_no']}"})
        arrears = money(l.get("arrears_interest_and_fees") or "0")
        if arrears:
            charge_id = self.t.charges[ARREARS_CHARGE]["id"]
            if not any(c.get("chargeId") == charge_id for c in self.api.get(f"/loans/{lid}/charges")):
                self.api.post(f"/loans/{lid}/charges", {**D, "chargeId": charge_id, "amount": arrears, "dueDate": self.T})
        return lid

    def unit(self, m):
        """Everything for one member, in dependency order."""
        no = m["member_no"]
        cid = self.member(m)
        vol = None
        for s in self.by_member["savings"].get(no, []):
            sid = self.savings(s, cid)
            if s["product"] == self.t.cfg["savingsProducts"][0]["name"] and vol is None:
                vol = sid
        for s in self.by_member["shares"].get(no, []):
            self.share(s, cid, vol)
        for l in self.by_member["loans"].get(no, []):
            self.loan(l, cid)
        return no

    def run(self, workers: int):
        self.by_member = {k: defaultdict(list) for k in ("savings", "shares", "loans")}
        for k in self.by_member:
            for r in getattr(self.data, k):
                self.by_member[k][r["member_no"]].append(r)
        failures = []
        start = time.time()
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(self.unit, m): m["member_no"] for m in self.data.members}
            for i, f in enumerate(cf.as_completed(futures), start=1):
                try:
                    f.result()
                except ApiError as e:
                    failures.append(f"member {futures[f]}: {e}")
                if i % 25 == 0 or i == len(futures):
                    rate = i / max(time.time() - start, 0.001)
                    print(f"  {i}/{len(futures)} members ({rate:.1f}/s, {len(failures)} failed)", flush=True)
        if failures:
            print("\nFAILED members (fix and re-run `load`; finished records are skipped):")
            for x in failures[:50]:
                print("  ✗", x)
            return False
        self.opening_journal()
        return True

    def opening_journal(self):
        existing = [e for e in items(self.api.get(f"/journalentries?fromDate={self.T}&toDate={self.T}&manualEntriesOnly=true&limit=500&{'&'.join(f'{k}={v}' for k, v in D.items())}"))
                    if e.get("referenceNumber") == OPENING_REF]
        if existing:
            print(f"  opening journal {OPENING_REF} already posted")
            return
        t = self.t
        lines = Counter()
        for r in self.data.tb:
            if r["gl_code"] in t.subledger_gls:
                continue      # these balances arrived through the subledger loads above
            lines[r["gl_code"]] += money(r.get("debit") or "0") - money(r.get("credit") or "0")
        # share activation books the purchase as cash at the till (Dr shareReference); legacy shares were not new cash
        share_total = sum(int(s["shares"]) for s in self.data.shares) * int(t.share_product["unitPrice"]) if self.data.shares else 0
        ref_gl = t.cfg["shareProduct"]["gl"]["shareReference"]
        lines[ref_gl] -= share_total
        # arrears charges accrue to 4900 (contra income): the legacy books already recognised that income
        arrears = sum(money(l.get("arrears_interest_and_fees") or "0") for l in self.data.loans)
        lines[ARREARS_INCOME_GL] += arrears
        lines[CLEARING_GL] -= sum(lines.values())
        debits = [{"glAccountId": t.gl[g]["id"], "amount": v} for g, v in sorted(lines.items()) if v > 0]
        credits = [{"glAccountId": t.gl[g]["id"], "amount": -v} for g, v in sorted(lines.items()) if v < 0]
        r = self.api.post("/journalentries", {**D, "officeId": t.offices["Head Office"], "transactionDate": self.T, "currencyCode": "UGX",
                                              "referenceNumber": OPENING_REF, "comments": "Opening balances migrated from the legacy trial balance",
                                              "debits": debits, "credits": credits})
        self.log("journal", OPENING_REF, r.get("transactionId"), lines=len(debits) + len(credits))
        print(f"  opening journal posted: {len(debits)} debit and {len(credits)} credit lines (incl. share {share_total:,} and arrears {arrears:,} adjustments)")


# ------------------------------------------------------------------ reconcile
def run_job(api: Fineract, name: str):
    job = next(j for j in api.get("/jobs") if j["displayName"] == name)
    before = (job.get("lastRunHistory") or {}).get("version", 0)
    api.post(f"/jobs/{job['jobId']}?command=executeJob", {})
    for _ in range(150):
        time.sleep(2)
        h = next(j for j in api.get("/jobs") if j["jobId"] == job["jobId"]).get("lastRunHistory") or {}
        if h.get("version", 0) > before:
            return h.get("status")
    return "timeout"


def paged(api: Fineract, path: str):
    off = 0
    while True:
        r = api.get(f"{path}{'&' if '?' in path else '?'}offset={off}&limit=500")
        page = items(r)
        yield from page
        off += len(page)
        if not page or off >= r.get("totalFilteredRecords", 0):
            return


def reconcile(api: Fineract, t: Tenant, data: Data, cutover: dt.date) -> bool:
    # Arrears charges are due on the cutover date; the periodic accrual job books them (Dr 1320 / Cr 4900).
    print("Running job: Add Periodic Accrual Transactions")
    print(f"  {run_job(api, 'Add Periodic Accrual Transactions')}")
    # Balances AS AT the cutover date (debit positive). Later accruals of new interest are not legacy balances.
    T = cutover.isoformat()
    bal = Counter()
    for e in paged(api, f"/journalentries?fromDate=2000-01-01&toDate={T}&locale=en&dateFormat=yyyy-MM-dd"):
        bal[e["glAccountCode"]] += e["amount"] * (1 if e["entryType"]["value"] == "DEBIT" else -1)
    # Migrated arrears accrue on the day the accrual job runs (Dr fees receivable / Cr 4900), i.e. after the
    # cutover. Those two accounts are therefore checked on all postings, not just those up to the cutover.
    fees_recv = t.cfg["loanProductDefaults"]["gl"]["feesReceivable"]
    now = Counter()
    for gl in (ARREARS_INCOME_GL, fees_recv):
        for e in paged(api, f"/journalentries?glAccountId={t.gl[gl]['id']}"):
            now[gl] += e["amount"] * (1 if e["entryType"]["value"] == "DEBIT" else -1)
    ok = True

    def check(label, cond, detail):
        nonlocal ok
        ok &= bool(cond)
        print(("  ✓ " if cond else "  ✗ ") + label + f"  [{detail}]")

    print("Ledger")
    check("trial balance balances", abs(sum(bal.values())) < 1, f"net {sum(bal.values()):,.0f}")
    check(f"clearing account {CLEARING_GL} is zero", abs(bal.get(CLEARING_GL, 0)) < 1, f"{bal.get(CLEARING_GL, 0):,.0f}")
    check(f"arrears contra {ARREARS_INCOME_GL} is zero after the arrears accrual", abs(now[ARREARS_INCOME_GL]) < 1, f"{now[ARREARS_INCOME_GL]:,.0f}")
    print("Subledgers vs control accounts")
    by_product = Counter()
    n_sav = 0
    for a in paged(api, "/savingsaccounts?"):
        if (a.get("externalId") or "").startswith("S-"):
            n_sav += 1
        by_product[t.savings_gl.get(a["savingsProductName"])] += (a.get("summary") or {}).get("accountBalance", 0)
    for gl in sorted(set(t.savings_gl.values())):
        check(f"GL {gl} {t.gl[gl]['name']} = account balances", abs(-bal.get(gl, 0) - by_product.get(gl, 0)) < 1,
              f"GL {-bal.get(gl, 0):,.0f} / accounts {by_product.get(gl, 0):,.0f}")
    loans_by = Counter()
    n_loans = 0
    for l in paged(api, "/loans?"):
        if (l.get("externalId") or "").startswith("L-"):
            n_loans += 1
        loans_by[t.loan_gl.get(l["loanProductName"])] += (l.get("summary") or {}).get("principalOutstanding", 0)
    for gl in sorted(set(t.loan_gl.values())):
        check(f"GL {gl} {t.gl[gl]['name']} = principal outstanding", abs(bal.get(gl, 0) - loans_by.get(gl, 0)) < 1,
              f"GL {bal.get(gl, 0):,.0f} / loans {loans_by.get(gl, 0):,.0f}")
    expected_shares = sum(int(s["shares"]) for s in data.shares) * int(t.share_product["unitPrice"]) if data.shares else 0
    check(f"GL {t.share_gl} share capital = migrated shares", abs(-bal.get(t.share_gl, 0) - expected_shares) < 1,
          f"GL {-bal.get(t.share_gl, 0):,.0f} / file {expected_shares:,}")
    print("Against the legacy files")
    n_members = sum(1 for c in paged(api, "/clients?") if (c.get("externalId") or "").startswith("M-"))
    check("members", n_members == len(data.members), f"{n_members} / {len(data.members)}")
    check("savings accounts", n_sav == len(data.savings), f"{n_sav} / {len(data.savings)}")
    check("loans", n_loans == len(data.loans), f"{n_loans} / {len(data.loans)}")
    tb = Counter()
    for r in data.tb:
        tb[r["gl_code"]] += money(r.get("debit") or "0") - money(r.get("credit") or "0")
    mism = []
    for gl, v in tb.items():
        if gl in t.receivable_gls:
            continue
        if abs(bal.get(gl, 0) - v) >= 1:
            mism.append(f"{gl}: Fineract {bal.get(gl, 0):,.0f} vs legacy {v:,}")
    recv_tb = sum(tb.get(g, 0) for g in t.receivable_gls)
    if abs(now[fees_recv] - recv_tb) >= 1:
        mism.append(f"legacy receivables {recv_tb:,} vs migrated arrears in GL {fees_recv} {now[fees_recv]:,.0f}")
    check("every legacy trial-balance line matches Fineract", not mism, "; ".join(mism[:6]) or f"{len(tb)} lines")
    print("\nRECONCILED — ready for sign-off" if ok else "\nNOT RECONCILED — investigate before go-live")
    return ok


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["validate", "load", "reconcile"])
    ap.add_argument("--data", required=True, help="folder with the legacy CSV files")
    ap.add_argument("--cutover", required=True, help="cutover date (YYYY-MM-DD): legacy balances are as at the end of this day")
    ap.add_argument("--url", required=True)
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--user", default="mifos")
    ap.add_argument("--cacert")
    ap.add_argument("--insecure", action="store_true", help="skip TLS verification (localhost only)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--config", default=str(HERE.parent / "finance" / "pivot-sacco-config.json"))
    args = ap.parse_args()

    cutover = day(args.cutover)
    if cutover > dt.date.today():
        sys.exit("cutover date is in the future")
    data = Data(Path(args.data))
    cfg = json.loads(Path(args.config).read_text())
    password = os.environ.get("FINERACT_PASSWORD") or getpass.getpass(f"Password for {args.user}: ")
    api = Fineract(args.url, args.tenant, args.user, password, args.cacert, args.insecure, dry_run=False)
    t = Tenant(api, cfg)

    errors, warnings, summary = validate(data, t, cutover)
    print(f"Validation: {summary['members']} members, {summary['savings_accounts']} savings, {summary['share_accounts']} share accounts, "
          f"{summary['loans']} loans; legacy trial balance {summary['tb_debits']:,} UGX each side")
    for gl, (files, tbv) in summary["subledger_checks"].items():
        print(f"  {gl}: detail files {files:,} | trial balance {tbv:,}")
    if warnings:
        print(f"  {len(warnings)} note(s), e.g. {warnings[0]}")
    if errors:
        print(f"\n{len(errors)} ERROR(S) — nothing was loaded:")
        for e in errors[:100]:
            print("  ✗", e)
        return 1
    print("  ✓ files are consistent with each other and with the tenant")
    if args.command == "validate":
        return 0
    try:
        if args.command == "load":
            log = Path(args.data) / "migration-log.jsonl"
            print(f"\nLoading (cutover {cutover}, {args.workers} workers, audit log {log})")
            ok = Loader(api, t, data, cutover, log).run(args.workers)
            print("\nLoad finished. Now run `reconcile`." if ok else "")
            return 0 if ok else 1
        return 0 if reconcile(api, t, data, cutover) else 1
    except ApiError as e:
        print(f"\nFAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
