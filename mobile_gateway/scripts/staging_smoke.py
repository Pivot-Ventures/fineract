"""Smoke-test a running member gateway against a real (staging) Fineract tenant.

Walks the member journey end to end: staff issue an activation code, the member activates with a
throwaway PIN and device key, then reads /me, statements and loans, looks up a recipient, and
(only with --move-money) makes a small own-account transfer and loan repayment. Ends by blocking
mobile banking for the test member again so the throwaway PIN cannot be used.

Staff credentials are prompted for and never printed. Run against staging only.

  python3 staging_smoke.py --gateway http://127.0.0.1:8710 --client-id 12 [--move-money]
"""

import argparse
import base64
import getpass
import json
import secrets
import sys
import urllib.error
import urllib.request

results: list[tuple[str, bool, str]] = []


def call(base, method, path, body=None, headers=None):
    req = urllib.request.Request(base + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read()
            return res.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw) if raw else None
        except ValueError:
            return exc.code, {"raw": raw[:200].decode(errors="replace")}


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    return ok


def throwaway_pin():
    while True:
        pin = f"{secrets.randbelow(10**4):04d}"
        d = [int(c) for c in pin]
        steps = {d[i + 1] - d[i] for i in range(3)}
        if len(set(pin)) > 2 and steps not in ({1}, {-1}):
            return pin


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gateway", default="http://127.0.0.1:8710")
    ap.add_argument("--client-id", type=int, required=True, help="an active staging member with savings (and ideally a loan)")
    ap.add_argument("--other-savings-id", type=int, help="a savings id owned by someone else, to prove ownership checks")
    ap.add_argument("--recipient-account-no", help="another member's savings account number for the recipient lookup")
    ap.add_argument("--move-money", action="store_true", help="also post a UGX 1,000 own-account transfer and loan repayment")
    a = ap.parse_args()
    g = a.gateway.rstrip("/")

    status, body = call(g, "GET", "/v1/health")
    if not check("gateway health", status == 200, f"HTTP {status}"):
        sys.exit(1)

    user = input("Staging Desk staff username: ")
    staff = {"X-Staff-Authorization": "Basic " + base64.b64encode(
        f"{user}:{getpass.getpass('Password: ')}".encode()).decode()}

    status, body = call(g, "GET", f"/v1/admin/members/{a.client_id}", headers=staff)
    check("staff auth + member status (GET /clients/{id} via service user)", status == 200, f"HTTP {status} {body}")
    status, body = call(g, "POST", f"/v1/admin/members/{a.client_id}/activation", headers=staff)
    if not check("issue activation code", status == 200, f"HTTP {status}" + ("" if status == 200 else f" {body}")):
        sys.exit(1)
    code, member_no = body["code"], body["memberNo"]

    pin, device = throwaway_pin(), secrets.token_hex(32)
    status, body = call(g, "POST", "/v1/auth/activate",
                        {"memberNo": member_no, "code": code, "pin": pin, "deviceKey": device, "deviceName": "staging-smoke"})
    if not check("member activation", status == 200, f"HTTP {status}" + ("" if status == 200 else f" {body}")):
        sys.exit(1)
    auth = {"Authorization": "Bearer " + body["token"], "X-Device-Key": device}

    try:
        status, me = call(g, "GET", "/v1/me", headers=auth)
        check("GET /v1/me (/clients/{id}/accounts, savings, loans)", status == 200,
              f"HTTP {status}" + (f" {len(me['savings'])} savings, {len(me['loans'])} loans" if status == 200 else f" {me}"))
        savings = me.get("savings", []) if status == 200 else []
        loans = me.get("loans", []) if status == 200 else []

        for s in savings[:2]:
            st, b = call(g, "GET", f"/v1/savings/{s['id']}/transactions", headers=auth)
            check(f"statement for savings {s['accountNo']}", st == 200, f"HTTP {st}")
        for ln in loans[:2]:
            st, b = call(g, "GET", f"/v1/loans/{ln['id']}", headers=auth)
            check(f"loan detail {ln.get('accountNo')}", st == 200, f"HTTP {st}")

        if a.other_savings_id:
            st, _ = call(g, "GET", f"/v1/savings/{a.other_savings_id}/transactions", headers=auth)
            check("someone else's savings is hidden", st == 404, f"HTTP {st} (expected 404)")

        target = a.recipient_account_no or (savings[1]["accountNo"] if len(savings) > 1 else None)
        if target:
            st, b = call(g, "POST", "/v1/transfers/recipient", {"accountNo": target}, headers=auth)
            check("recipient lookup (/search resource=savings)", st == 200, f"HTTP {st} {b}")
        else:
            print("SKIP  recipient lookup — pass --recipient-account-no")

        st, b = call(g, "POST", "/v1/transfers/recipient", {"accountNo": "999999999"}, headers=auth)
        check("unknown account number → 404", st == 404, f"HTTP {st}")

        st, _ = call(g, "GET", "/v1/me", headers={**auth, "X-Device-Key": secrets.token_hex(32)})
        check("session refused from another device", st == 401, f"HTTP {st} (expected 401)")
        # That call ends the session on purpose (device mismatch); sign in again.
        st, b = call(g, "POST", "/v1/auth/login", {"memberNo": member_no, "pin": pin, "deviceKey": device})
        check("login with PIN", st == 200, f"HTTP {st}")
        if st == 200:
            auth["Authorization"] = "Bearer " + b["token"]

        if a.move_money:
            funded = [s for s in savings if s["active"] and s["available"] >= 2000]
            if len(funded) and len(savings) > 1:
                src = funded[0]
                dst = next(s for s in savings if s["id"] != src["id"])
                key = secrets.token_hex(8)
                tx = {"fromAccountId": src["id"], "toAccountNo": dst["accountNo"], "amount": 1000, "pin": pin,
                      "idempotencyKey": key, "note": "staging smoke"}
                st, b = call(g, "POST", "/v1/transfers", tx, headers=auth)
                ok = st == 200 and bool(b.get("reference"))
                check("own-account transfer UGX 1,000 (CREATE_ACCOUNTTRANSFER)", ok,
                      f"HTTP {st} {b}" + ("" if ok or st != 200 else " — no Fineract resourceId: maker-checker?"))
                st2, b2 = call(g, "POST", "/v1/transfers", tx, headers=auth)
                check("same idempotency key replays, no second transfer", st2 == 200 and b2 == b, f"HTTP {st2}")
            else:
                print("SKIP  transfer — member needs two savings accounts, one with UGX 2,000+ available")
            active_loans = [ln for ln in loans if ln.get("active") and ln.get("outstanding", 0) >= 1000]
            if funded and active_loans:
                st, b = call(g, "POST", f"/v1/loans/{active_loans[0]['id']}/repayments",
                             {"fromAccountId": funded[0]["id"], "amount": 1000, "pin": pin,
                              "idempotencyKey": secrets.token_hex(8)}, headers=auth)
                ok = st == 200 and bool(b.get("reference"))
                check("loan repayment UGX 1,000 from savings", ok, f"HTTP {st} {b}")
            else:
                print("SKIP  repayment — member needs an active loan and funded savings")
    finally:
        st, _ = call(g, "POST", f"/v1/admin/members/{a.client_id}/block", headers=staff)
        check("cleanup: block mobile banking for the test member", st == 200, f"HTTP {st}")

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
