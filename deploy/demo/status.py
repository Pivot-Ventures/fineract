#!/usr/bin/env python3
"""Read-only snapshot of a Fineract tenant: what exists, and which GL accounts clash with the finance config.

  python3 status.py --url https://sacco.pivotventures.tech/fineract-provider/api/v1

Makes GET requests only. Password from $FINERACT_PASSWORD or a prompt.
"""
import argparse
import getpass
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "finance"))
from apply_config import Fineract, items  # noqa: E402


def count(api, path):
    r = api.get(path)
    if isinstance(r, dict):
        return r.get("totalFilteredRecords", len(r.get("pageItems", [])))
    return len(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--user", default="mifos")
    ap.add_argument("--cacert", help="CA bundle (e.g. Caddy internal root) for non-public certificates")
    a = ap.parse_args()
    pw = os.environ.get("FINERACT_PASSWORD") or getpass.getpass(f"Password for {a.user}: ")
    api = Fineract(a.url, a.tenant, a.user, pw, a.cacert, False, dry_run=False)

    print("Tenant contents")
    for label, path in [("members", "/clients?limit=1"), ("savings accounts", "/savingsaccounts?limit=1"),
                        ("loans", "/loans?limit=1"), ("share accounts", "/accounts/share?limit=1"),
                        ("staff", "/staff?status=all"), ("tellers", "/tellers"), ("users", "/users"),
                        ("roles", "/roles"), ("offices", "/offices"), ("GL accounts", "/glaccounts"),
                        ("journal entries", "/journalentries?limit=1"), ("loan products", "/loanproducts"),
                        ("savings products", "/savingsproducts"), ("payment types", "/paymenttypes"),
                        ("charges", "/charges")]:
        try:
            print(f"  {label:18} {count(api, path)}")
        except Exception as e:  # keep going: a snapshot should show everything it can
            print(f"  {label:18} ? ({str(e)[:80]})")

    cfg = json.loads((HERE.parent / "finance" / "pivot-sacco-config.json").read_text())
    want = {g["code"]: g for g in cfg["glAccounts"]}
    have = api.get("/glaccounts")
    print(f"\nExisting GL accounts ({len(have)}):")
    clashes = 0
    for g in sorted(have, key=lambda x: x["glCode"]):
        w = want.get(g["glCode"])
        usage = g["usage"]["value"]
        note = ""
        if w:
            wu = "Header" if w.get("usage") == "HEADER" else "Detail"
            if w["name"] != g["name"] or wu.lower() != usage.lower() or w["type"] != g["type"]["value"].upper():
                note = f"  ✗ config wants '{w['name']}' ({w['type'].title()}, {wu})"
                clashes += 1
        print(f"  {g['glCode']:6} {g['name'][:38]:38} {g['type']['value']:9} {usage:7}{note}")
    print(f"\n{clashes} clash(es) with deploy/finance/pivot-sacco-config.json")
    print("Products:", [p["name"] for p in api.get("/loanproducts")] + [p["name"] for p in api.get("/savingsproducts")])
    print("Payment types:", [p["name"] for p in api.get("/paymenttypes")])


if __name__ == "__main__":
    main()
