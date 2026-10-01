#!/usr/bin/env python3
"""Generate a synthetic legacy SACCO extract for staging dry runs (no real member data).

  python3 gen_sample.py OUT_DIR [--members 300] [--cutover 2026-09-30] [--seed 7] [--inject-errors]

Writes members.csv, savings.csv, shares.csv, loans.csv and a trial_balance.csv whose control lines
equal the detail files, so a correct migration reconciles to zero. --inject-errors plants a handful
of typical extract mistakes to prove that `migrate.py validate` stops them.
"""
import argparse
import csv
import datetime as dt
import random
from pathlib import Path

FIRST = ["Nakato", "Okello", "Namubiru", "Mugisha", "Achieng", "Ssempala", "Atim", "Tumusiime", "Nansubuga", "Kato",
         "Akello", "Byaruhanga", "Nalwoga", "Ochieng", "Kyomuhendo", "Wasswa", "Babirye", "Opio", "Nabukenya", "Mwesigwa"]
LAST = ["Grace", "James", "Sarah", "Joseph", "Ruth", "Peter", "Esther", "Moses", "Agnes", "David",
        "Florence", "Samuel", "Harriet", "Isaac", "Prossy", "Robert", "Juliet", "Denis", "Brenda", "Patrick"]
LOANS = {  # name: (min principal, max principal, min n, max n, rate, portfolio GL)
    "Business / Development Loan": (500_000, 20_000_000, 3, 36, 2.0, "1210"),
    "Emergency Loan": (100_000, 2_000_000, 1, 3, 3.0, "1220"),
    "School Fees Loan": (200_000, 10_000_000, 3, 12, 2.0, "1230"),
    "Salary / Check-off Loan": (500_000, 30_000_000, 3, 36, 1.8, "1240"),
}
SAVINGS = {"Voluntary Savings": "2110", "Compulsory Savings": "2120", "Children and Youth Savings": "2140"}
SHARE_PRICE = 20_000


def write(path, rows, header):
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--members", type=int, default=300)
    ap.add_argument("--cutover", default="2026-09-30")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--inject-errors", action="store_true")
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    T = dt.date.fromisoformat(a.cutover)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    members, savings, shares, loans = [], [], [], []
    gl = {}
    for i in range(1, a.members + 1):
        no = f"PS{i:05d}"
        joined = T - dt.timedelta(days=rnd.randint(60, 3650))
        members.append({"member_no": no, "first_name": rnd.choice(FIRST), "middle_name": "", "last_name": rnd.choice(LAST),
                        "gender": rnd.choice(["Female", "Male"]),
                        "date_of_birth": (joined - dt.timedelta(days=rnd.randint(18 * 365, 60 * 365))).isoformat(),
                        "mobile_no": f"07{rnd.choice('05678')}{rnd.randint(1000000, 9999999)}",
                        "national_id": f"C{rnd.choice('MF')}{rnd.randint(10**11, 10**12 - 1)}", "joined_date": joined.isoformat(),
                        "office": "Head Office"})
        products = ["Voluntary Savings"] + (["Compulsory Savings"] if rnd.random() < 0.6 else []) + (["Children and Youth Savings"] if rnd.random() < 0.2 else [])
        for j, p in enumerate(products, start=1):
            bal = rnd.choice([0, rnd.randint(5, 400) * 1000, rnd.randint(5, 4000) * 1000])
            opened = joined + dt.timedelta(days=rnd.randint(0, max(0, (T - joined).days - 1)))
            savings.append({"account_no": f"{no}-S{j}", "member_no": no, "product": p, "opened_date": opened.isoformat(), "balance": bal})
            gl[SAVINGS[p]] = gl.get(SAVINGS[p], 0) + bal
        n_sh = rnd.randint(5, 60)
        shares.append({"member_no": no, "shares": n_sh})
        gl["3100"] = gl.get("3100", 0) + n_sh * SHARE_PRICE
        if rnd.random() < 0.4:
            name = rnd.choice(list(LOANS))
            lo, hi, nmin, nmax, rate, pgl = LOANS[name]
            principal = rnd.randint(lo // 1000, min(hi, 8_000_000) // 1000) * 1000
            arrears = rnd.randint(1, 30) * 1000 if rnd.random() < 0.15 else 0
            loans.append({"loan_no": f"{no}-L1", "member_no": no, "product": name,
                          "original_disbursed_date": (T - dt.timedelta(days=rnd.randint(30, 600))).isoformat(),
                          "outstanding_principal": principal, "monthly_rate": rate, "remaining_installments": rnd.randint(nmin, nmax),
                          "next_due_date": (T + dt.timedelta(days=rnd.randint(1, 30))).isoformat(), "arrears_interest_and_fees": arrears})
            gl[pgl] = gl.get(pgl, 0) + principal
            gl["1310"] = gl.get("1310", 0) + arrears

    # legacy trial balance (already mapped to the new chart): subledger controls + the rest of the balance sheet
    tb = []
    def line(code, name, dr=0, cr=0):
        tb.append({"legacy_code": f"OLD-{code}", "legacy_name": name, "gl_code": code, "debit": dr, "credit": cr})
    for code in ("1210", "1220", "1230", "1240"):
        if gl.get(code):
            line(code, "Loans to members", dr=gl[code])
    if gl.get("1310"):
        line("1310", "Interest receivable", dr=gl["1310"])
    line("1110", "Cash in safe", dr=14_500_000)
    line("1130", "Bank - current account", dr=96_250_000)
    line("1140", "MTN MoMo float", dr=3_180_000)
    line("1520", "Computers", dr=9_400_000)
    line("1590", "Accumulated depreciation", cr=3_100_000)
    for code in ("2110", "2120", "2140"):
        if gl.get(code):
            line(code, "Member savings", cr=gl[code])
    line("3100", "Share capital", cr=gl["3100"])
    line("2310", "Creditors", cr=1_870_000)
    line("3200", "Statutory reserve", cr=6_000_000)
    dr = sum(r["debit"] for r in tb)
    cr = sum(r["credit"] for r in tb)
    line("3300", "Retained earnings (balancing)", cr=dr - cr) if dr >= cr else line("3300", "Retained earnings (balancing)", dr=cr - dr)

    if a.inject_errors:
        savings.append({"account_no": savings[0]["account_no"], "member_no": "PS99999", "product": "Gold Savings",
                        "opened_date": "2030-01-01", "balance": "12,500.50"})                       # duplicate, unknown member/product, future, fraction
        loans.append({"loan_no": "BAD-1", "member_no": members[1]["member_no"], "product": "Emergency Loan",
                      "original_disbursed_date": "2026-01-01", "outstanding_principal": 9_000_000, "monthly_rate": 3,
                      "remaining_installments": 12, "next_due_date": (T + dt.timedelta(days=120)).isoformat(),
                      "arrears_interest_and_fees": 0})                                             # above max, too long, due too late
        shares.append({"member_no": members[2]["member_no"], "shares": 2})                         # below minimum shares
        tb[0]["debit"] += 1                                                                        # unbalanced TB

    write(out / "members.csv", members, list(members[0]))
    write(out / "savings.csv", savings, list(savings[0]))
    write(out / "shares.csv", shares, ["member_no", "shares"])
    write(out / "loans.csv", loans, list(loans[0]) if loans else ["loan_no"])
    write(out / "trial_balance.csv", tb, list(tb[0]))
    print(f"{len(members)} members, {len(savings)} savings accounts, {len(shares)} share accounts, {len(loans)} loans → {out}")


if __name__ == "__main__":
    main()
