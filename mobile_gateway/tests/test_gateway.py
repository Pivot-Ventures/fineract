import asyncio
import base64
import json
import logging
import os
import re

import httpx
import pytest

os.environ.update(FINERACT_URL="http://core", FINERACT_USER="svc", FINERACT_PASSWORD="x",
                  LIMIT_PER_TXN="100000", LIMIT_PER_DAY="150000")

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.alerts import Alerts  # noqa: E402
from app.fineract import Fineract  # noqa: E402
from app.momo import SandboxProvider  # noqa: E402
from app.store import Store  # noqa: E402

DEVICE = "d" * 43
OTHER_DEVICE = "e" * 43
STAFF = "Basic " + base64.b64encode(b"teller:secret").decode()


class FakeCore:
    """Just enough of Fineract's API: two members, their savings, one active loan."""

    def __init__(self):
        self.clients = {
            1: {"id": 1, "accountNo": "000000001", "firstname": "Grace", "lastname": "Nakato",
                "displayName": "Grace Nakato", "officeId": 1, "officeName": "Head Office",
                "mobileNo": "+256772441203", "active": True},
            2: {"id": 2, "accountNo": "000000002", "firstname": "James", "lastname": "Okello",
                "displayName": "James Okello", "officeId": 1, "officeName": "Head Office", "active": True},
        }
        self.savings = {
            1: {"id": 1, "accountNo": "000000001", "clientId": 1, "balance": 58300.0},
            2: {"id": 2, "accountNo": "000000002", "clientId": 2, "balance": 66000.0},
        }
        self.loan = {"id": 7, "accountNo": "000000007", "clientId": 1, "outstanding": 30000.0}
        self.transfers = []
        self.deposits = []
        # Commands held by Fineract maker-checker ("accounttransfers", "deposit"): accepted with a
        # commandId and no resourceId, and nothing moves until a checker approves.
        self.maker_checker: set[str] = set()
        self.commands = []

    def held(self, kind: str, body: dict):
        if kind not in self.maker_checker:
            return None
        self.commands.append(body)
        return httpx.Response(200, json={"commandId": 900 + len(self.commands), "rollbackTransaction": False})

    def sav_json(self, s):
        return {"id": s["id"], "accountNo": s["accountNo"], "clientId": s["clientId"],
                "savingsProductName": "Voluntary Savings", "status": {"value": "Active", "active": True},
                "currency": {"code": "UGX"},
                "summary": {"accountBalance": s["balance"], "availableBalance": s["balance"]},
                "transactions": [{"id": 9, "date": [2026, 10, 1], "amount": 5000,
                                  "transactionType": {"value": "Deposit", "deposit": True}, "runningBalance": s["balance"]}]}

    def loan_json(self):
        return {"id": 7, "accountNo": "000000007", "clientId": 1, "loanProductName": "Business Loan",
                "status": {"value": "Active", "active": True}, "principal": 50000,
                "currency": {"code": "UGX"},
                "summary": {"totalOutstanding": self.loan["outstanding"], "totalOverdue": 0},
                "repaymentSchedule": {"periods": [
                    {"dueDate": [2026, 9, 1]},
                    {"period": 1, "dueDate": [2026, 10, 1], "totalDueForPeriod": 20000,
                     "totalOutstandingForPeriod": 0, "complete": True},
                    {"period": 2, "dueDate": [2026, 11, 1], "totalDueForPeriod": 30000,
                     "totalOutstandingForPeriod": self.loan["outstanding"], "complete": False}]}}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, q = request.url.path, request.url.params
        if path == "/authentication":
            body = json.loads(request.content)
            if body == {"username": "teller", "password": "secret"}:
                return httpx.Response(200, json={"authenticated": True, "username": "teller",
                                                 "permissions": ["UPDATE_CLIENT"]})
            return httpx.Response(401, json={})
        if path.startswith("/clients/") and path.endswith("/accounts"):
            cid = int(path.split("/")[2])
            sav = [{"id": s["id"], "status": {"active": True}} for s in self.savings.values() if s["clientId"] == cid]
            loans = [{"id": 7, "status": {"value": "Active"}}] if cid == 1 else []
            return httpx.Response(200, json={"savingsAccounts": sav, "loanAccounts": loans})
        if path.startswith("/clients/"):
            return httpx.Response(200, json=self.clients[int(path.split("/")[2])])
        if path.startswith("/savingsaccounts/") and path.endswith("/transactions") and request.method == "POST":
            sid, body = int(path.split("/")[2]), json.loads(request.content)
            assert q["command"] == "deposit"
            if held := self.held("deposit", body):
                return held
            self.savings[sid]["balance"] += body["transactionAmount"]
            self.deposits.append(body)
            return httpx.Response(200, json={"resourceId": 500 + len(self.deposits)})
        if path.startswith("/savingsaccounts/"):
            sid = int(path.split("/")[2])
            if sid not in self.savings:
                return httpx.Response(404, json={"errors": [{"defaultUserMessage": "not found"}]})
            return httpx.Response(200, json=self.sav_json(self.savings[sid]))
        if path.startswith("/loans/"):
            return httpx.Response(200, json=self.loan_json())
        if path == "/search":
            return httpx.Response(200, json=[{"entityId": s["id"], "entityAccountNo": s["accountNo"]}
                                             for s in self.savings.values() if s["accountNo"] == q["query"]])
        if path == "/accounttransfers":
            body = json.loads(request.content)
            if held := self.held("accounttransfers", body):
                return held
            src = self.savings[body["fromAccountId"]]
            if body["transferAmount"] > src["balance"]:
                return httpx.Response(400, json={"errors": [{"defaultUserMessage": "Insufficient balance"}]})
            src["balance"] -= body["transferAmount"]
            if body["toAccountType"] == 2:
                self.savings[body["toAccountId"]]["balance"] += body["transferAmount"]
            else:
                self.loan["outstanding"] -= body["transferAmount"]
            self.transfers.append(body)
            return httpx.Response(200, json={"resourceId": 100 + len(self.transfers)})
        return httpx.Response(404, json={})


@pytest.fixture
def env(tmp_path):
    core = FakeCore()
    main.configure(Store(str(tmp_path / "g.sqlite3")),
                   Fineract("http://core", "default", "svc", "x", transport=httpx.MockTransport(core.handler)),
                   momo=SandboxProvider(approve_after=0))
    main._client_locks.clear()
    main._ip_hits.clear()
    main._lookup_hits.clear()
    return TestClient(main.app), core


def enrol(c, client_id=1, member_no="000000001", pin="4826", device=DEVICE):
    code = c.post(f"/v1/admin/members/{client_id}/activation", headers={"X-Staff-Authorization": STAFF}).json()["code"]
    r = c.post("/v1/auth/activate", json={"memberNo": member_no, "code": code, "pin": pin,
                                          "deviceKey": device, "deviceName": "Galaxy S23"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", "X-Device-Key": device}


def test_staff_must_authenticate(env):
    c, _ = env
    assert c.post("/v1/admin/members/1/activation").status_code == 401
    bad = "Basic " + base64.b64encode(b"teller:wrong").decode()
    assert c.post("/v1/admin/members/1/activation", headers={"X-Staff-Authorization": bad}).status_code == 401


def test_activation_rejects_weak_pin_and_bad_code(env):
    c, _ = env
    code = c.post("/v1/admin/members/1/activation", headers={"X-Staff-Authorization": STAFF}).json()["code"]
    r = c.post("/v1/auth/activate", json={"memberNo": "1", "code": "0000 0000", "pin": "4826", "deviceKey": DEVICE})
    assert r.status_code == 401
    r = c.post("/v1/auth/activate", json={"memberNo": "1", "code": code, "pin": "1234", "deviceKey": DEVICE})
    assert r.json()["code"] == "weak_pin"


def test_me_returns_only_own_accounts(env):
    c, _ = env
    h = enrol(c)
    body = c.get("/v1/me", headers=h).json()
    assert [s["accountNo"] for s in body["savings"]] == ["000000001"]
    assert body["loans"][0]["nextDue"] == {"date": "2026-11-01", "amount": 30000.0}
    assert body["member"]["mobile"] == "+256•••203"
    # Another member's account is invisible, even by direct id.
    assert c.get("/v1/savings/2/transactions", headers=h).status_code == 404


def test_session_bound_to_device(env):
    c, _ = env
    h = enrol(c)
    assert c.get("/v1/me", headers={**h, "X-Device-Key": OTHER_DEVICE}).status_code == 401
    r = c.post("/v1/auth/login", json={"memberNo": "000000001", "pin": "4826", "deviceKey": OTHER_DEVICE})
    assert r.json()["code"] == "device_not_registered"


def test_pin_lockout_then_block(env):
    c, _ = env
    enrol(c)
    login = lambda pin: c.post("/v1/auth/login", json={"memberNo": "1", "pin": pin, "deviceKey": DEVICE})
    assert login("0001").status_code == 401
    assert login("0002").status_code == 401
    assert login("0003").status_code == 423          # third failure locks
    assert login("4826").status_code == 423          # even the right PIN while locked
    main.store().update_member(1, locked_until=0)    # lock expires
    for pin in ("0004", "0005"):
        login(pin)
    r = login("0006")
    assert r.status_code == 423 and "branch" in r.json()["message"]
    main.store().update_member(1, locked_until=0)
    assert login("4826").status_code == 423          # blocked until staff re-issue a code


def test_transfer_to_other_member(env):
    c, core = env
    h = enrol(c)
    r = c.post("/v1/transfers/recipient", json={"accountNo": "000000002"}, headers=h).json()
    assert r == {"accountNo": "000000002", "name": "James O.", "own": False}
    body = {"fromAccountId": 1, "toAccountNo": "000000002", "amount": 10000, "note": "school",
            "pin": "4826", "idempotencyKey": "k-000000001"}
    r = c.post("/v1/transfers", json=body, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["availableAfter"] == 48300.0
    assert core.savings[2]["balance"] == 76000.0
    # Retrying the same request (e.g. after a dropped connection) must not move money twice.
    assert c.post("/v1/transfers", json=body, headers=h).json()["reference"] == r.json()["reference"]
    assert len(core.transfers) == 1


def test_transfer_guards(env):
    c, core = env
    h = enrol(c)
    base = {"fromAccountId": 1, "toAccountNo": "000000002", "pin": "4826"}
    send = lambda key, **kw: c.post("/v1/transfers", json={**base, "idempotencyKey": key, **kw}, headers=h)
    assert send("k-1aaaaaaa", amount=10000, pin="9999").json()["code"] == "wrong_pin"
    assert send("k-2aaaaaaa", amount=60000).json()["code"] == "insufficient_funds"
    assert send("k-3aaaaaaa", amount=150000).json()["code"] == "over_limit"
    assert send("k-4aaaaaaa", amount=10000, fromAccountId=2).status_code == 404   # not their account
    assert send("k-5aaaaaaa", amount=10000, toAccountNo="000000001").json()["code"] == "same_account"
    assert send("k-6aaaaaaa", amount=10.5).json()["code"] == "bad_amount"
    assert core.transfers == []


def test_daily_limit(env):
    c, core = env
    core.savings[1]["balance"] = 500000.0
    h = enrol(c)
    send = lambda key, amt: c.post("/v1/transfers", json={"fromAccountId": 1, "toAccountNo": "000000002",
                                                          "amount": amt, "pin": "4826", "idempotencyKey": key}, headers=h)
    assert send("k-day-0001", 100000).status_code == 200
    r = send("k-day-0002", 60000)
    assert r.json()["code"] == "over_daily_limit" and "50,000" in r.json()["message"]


def test_loan_repayment_from_savings(env):
    c, core = env
    h = enrol(c)
    pay = lambda key, amt: c.post("/v1/loans/7/repayments", json={"fromAccountId": 1, "amount": amt, "pin": "4826",
                                                                  "idempotencyKey": key}, headers=h)
    assert pay("k-loan-001", 40000).json()["code"] == "over_outstanding"
    r = pay("k-loan-002", 20000)
    assert r.status_code == 200, r.text
    assert r.json()["loan"]["outstandingAfter"] == 10000.0
    assert core.transfers[0]["toAccountType"] == 1


def test_change_pin_and_deregister(env):
    c, _ = env
    h = enrol(c)
    assert c.post("/v1/auth/pin", json={"currentPin": "4826", "newPin": "7391"}, headers=h).status_code == 200
    assert c.post("/v1/auth/login", json={"memberNo": "1", "pin": "7391", "deviceKey": DEVICE}).status_code == 200
    assert c.post("/v1/auth/deregister", headers=h).status_code == 200
    r = c.post("/v1/auth/login", json={"memberNo": "1", "pin": "7391", "deviceKey": DEVICE})
    assert r.json()["code"] == "not_registered"


def test_momo_deposit_credits_only_after_approval(env):
    c, core = env
    h = enrol(c)
    body = {"savingsId": 1, "network": "mtn", "phone": "0772 123456", "amount": 20000, "idempotencyKey": "dep-00000001"}
    r = c.post("/v1/deposits/momo", json=body, headers=h).json()
    assert r["status"] == "pending" and core.deposits == []          # nothing credited on request
    assert c.post("/v1/deposits/momo", json=body, headers=h).json()["id"] == r["id"]   # retry = same request
    done = c.get(f"/v1/deposits/{r['id']}", headers=h).json()
    assert done["status"] == "successful" and done["reference"] == "DEP-501"
    assert core.savings[1]["balance"] == 78300.0
    c.get(f"/v1/deposits/{r['id']}", headers=h)                         # polling again never credits twice
    assert len(core.deposits) == 1


def test_momo_deposit_declined_and_validation(env):
    c, core = env
    h = enrol(c)
    dep = lambda key, **kw: c.post("/v1/deposits/momo", headers=h, json={
        "savingsId": 1, "network": "airtel", "phone": "0752 123000", "amount": 5000, "idempotencyKey": key, **kw})
    r = dep("dep-decline1").json()
    assert c.get(f"/v1/deposits/{r['id']}", headers=h).json()["status"] == "failed"
    assert core.deposits == []
    assert dep("dep-badnet01", phone="0772123456").json()["code"] == "wrong_network"
    assert dep("dep-badphon1", phone="12345").json()["code"] == "bad_phone"
    assert dep("dep-toosmal1", amount=500).json()["code"] == "bad_amount"
    assert dep("dep-notmine1", savingsId=2).status_code == 404
    other = enrol(c, client_id=2, member_no="000000002", device="f" * 43)
    assert c.get(f"/v1/deposits/{r['id']}", headers=other).status_code == 404   # cannot see others' deposits


def test_momo_off_by_default(env):
    c, _ = env
    main._state["momo"] = None
    h = enrol(c)
    r = c.post("/v1/deposits/momo", headers=h, json={"savingsId": 1, "network": "mtn", "phone": "0772123456",
                                                     "amount": 5000, "idempotencyKey": "dep-offffff1"})
    assert r.status_code == 503
    assert c.get("/v1/me", headers=h).json()["channels"]["momoDeposits"] is False


# ---------------------------------------------------------------- maker-checker

def audit_actions() -> list[str]:
    with main.store().conn() as conn:
        return [r["action"] for r in conn.execute("SELECT action FROM audit")]


def test_transfer_held_by_maker_checker_is_not_reported_as_done(env):
    c, core = env
    core.maker_checker.add("accounttransfers")
    h = enrol(c)
    body = {"fromAccountId": 1, "toAccountNo": "000000002", "amount": 10000, "pin": "4826",
            "idempotencyKey": "k-mc-00001"}
    r = c.post("/v1/transfers", json=body, headers=h)
    assert r.status_code == 202, r.text
    j = r.json()
    assert j["status"] == "pending_approval" and j["reference"] is None and j["commandId"] == 901
    assert "approval" in j["message"] and "availableAfter" not in j
    assert core.savings[1]["balance"] == 58300.0 and core.transfers == []
    # A retry replays the pending answer; it never submits a second command.
    again = c.post("/v1/transfers", json=body, headers=h)
    assert again.status_code == 202 and again.json() == j
    assert len(core.commands) == 1
    # Counted against today's limit (it moves as soon as it is approved).
    assert c.get("/v1/me", headers=h).json()["limits"]["usedToday"] == 10000
    actions = audit_actions()
    assert "transfer_pending_approval" in actions and "transfer" not in actions


def test_repayment_held_by_maker_checker(env):
    c, core = env
    core.maker_checker.add("accounttransfers")
    h = enrol(c)
    body = {"fromAccountId": 1, "amount": 20000, "pin": "4826", "idempotencyKey": "k-mc-loan1"}
    r = c.post("/v1/loans/7/repayments", json=body, headers=h)
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending_approval" and r.json()["reference"] is None
    assert core.loan["outstanding"] == 30000.0
    assert c.post("/v1/loans/7/repayments", json=body, headers=h).status_code == 202
    assert len(core.commands) == 1
    assert main.store().moved_today(1, main.today_local()) == 20000
    actions = audit_actions()
    assert "loan_repayment_pending_approval" in actions


def test_momo_credit_held_by_maker_checker(env):
    c, core = env
    core.maker_checker.add("deposit")
    h = enrol(c)
    r = c.post("/v1/deposits/momo", headers=h, json={"savingsId": 1, "network": "mtn", "phone": "0772 123456",
                                                     "amount": 20000, "idempotencyKey": "dep-mc-0001"}).json()
    done = c.get(f"/v1/deposits/{r['id']}", headers=h).json()
    assert done["status"] == "pending_approval" and done["reference"] is None
    c.get(f"/v1/deposits/{r['id']}", headers=h)                       # polling never submits again
    assert len(core.commands) == 1 and core.deposits == []
    actions = audit_actions()
    assert "momo_deposit_pending_approval" in actions and "momo_deposit_credited" not in actions


# ---------------------------------------------------------------- transactional alerts

class FakeAlerts:
    def __init__(self, fail: bool = False):
        self.events, self.raw, self.fail = [], [], fail

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.raw.append(str(request.headers) + request.content.decode())
        if self.fail:
            raise httpx.ConnectError("alerts down")
        assert request.url.path == "/v1/events"
        assert request.headers["X-Alerts-Service-Key"] == "svc-key"
        self.events.append(json.loads(request.content))
        return httpx.Response(202, json={"ok": True})


@pytest.fixture
def alerting(env):
    _, core = env
    fake = FakeAlerts()
    main._state["alerts"] = Alerts("http://alerts", "svc-key", transport=httpx.MockTransport(fake.handler))
    with TestClient(main.app) as c:          # one event loop for the whole test, so alert tasks finish
        drain = lambda: c.portal.call(main._state["alerts"].drain)
        yield c, core, fake, drain


def test_alerts_for_money_and_security_events(alerting):
    c, core, fake, drain = alerting
    code = c.post("/v1/admin/members/1/activation", headers={"X-Staff-Authorization": STAFF}).json()["code"]
    r = c.post("/v1/auth/activate", json={"memberNo": "000000001", "code": code, "pin": "4826",
                                          "deviceKey": DEVICE, "deviceName": "Galaxy S23"})
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}", "X-Device-Key": DEVICE}
    drain()
    assert fake.events[-1]["type"] == "activation"

    t = c.post("/v1/transfers", headers=h, json={"fromAccountId": 1, "toAccountNo": "000000002", "amount": 10000,
                                                 "pin": "4826", "idempotencyKey": "k-alert-01"}).json()
    p = c.post("/v1/loans/7/repayments", headers=h, json={"fromAccountId": 1, "amount": 20000, "pin": "4826",
                                                          "idempotencyKey": "k-alert-02"}).json()
    assert c.post("/v1/auth/pin", json={"currentPin": "4826", "newPin": "7391"}, headers=h).status_code == 200
    staff = {"X-Staff-Authorization": STAFF}
    assert c.post("/v1/admin/members/1/unlock", headers=staff).status_code == 200
    assert c.post("/v1/admin/members/1/block", headers=staff).status_code == 200
    drain()

    by_type = {e["type"]: e for e in fake.events}
    assert [e["type"] for e in fake.events] == ["activation", "transfer", "loan_repay", "pin", "pin", "mobile_blocked"]
    for e in fake.events:
        assert e["memberId"] == "1" and e["phone"] == "+256772441203"
        assert set(e) == {"type", "idempotencyKey", "memberId", "phone", "context"}
        assert len(e["idempotencyKey"]) <= 100
    assert by_type["activation"]["context"] == {"memberName": "Grace"}
    assert by_type["transfer"] == {
        "type": "transfer", "idempotencyKey": f"transfer:{t['reference'][4:]}", "memberId": "1",
        "phone": "+256772441203",
        "context": {"amount": 10000, "account": "000000001", "balance": 48300.0, "reference": t["reference"],
                    "memberName": "Grace"}}
    assert by_type["loan_repay"]["idempotencyKey"] == f"loan_repay:{p['reference'][4:]}"
    assert by_type["loan_repay"]["context"] == {"amount": 20000, "account": "000000007", "balance": 10000.0,
                                                "reference": p["reference"], "memberName": "Grace"}
    pins = [e for e in fake.events if e["type"] == "pin"]
    assert pins[0]["idempotencyKey"] != pins[1]["idempotencyKey"]
    # Nothing secret ever leaves the gateway.
    # (Idempotency keys are stripped first: the timestamp in a non-money key could contain any 4 digits.)
    sent = "\n".join(fake.raw)
    for e in fake.events:
        sent = sent.replace(e["idempotencyKey"], "")
        assert re.fullmatch(r"(activation|transfer|loan_repay|pin:changed|pin:unlocked|mobile_blocked):[\d:]+",
                            e["idempotencyKey"])
    for secret in ("4826", "7391", code.replace(" ", ""), code, DEVICE, token):
        assert secret not in sent


def test_no_alerts_for_pending_approval_or_members_without_phone(alerting):
    c, core, fake, drain = alerting
    h = enrol(c)
    drain()
    fake.events.clear()
    core.maker_checker.add("accounttransfers")
    r = c.post("/v1/transfers", headers=h, json={"fromAccountId": 1, "toAccountNo": "000000002", "amount": 10000,
                                                 "pin": "4826", "idempotencyKey": "k-alert-mc"})
    assert r.status_code == 202
    drain()
    assert fake.events == []
    core.maker_checker.clear()
    other = enrol(c, client_id=2, member_no="000000002", device="f" * 43)     # James has no mobileNo
    c.post("/v1/transfers", headers=other, json={"fromAccountId": 2, "toAccountNo": "000000001", "amount": 1000,
                                                 "pin": "4826", "idempotencyKey": "k-alert-np"})
    drain()
    assert fake.events == []


def test_failing_alerts_service_never_affects_member(alerting, caplog):
    c, core, fake, drain = alerting
    fake.fail = True
    caplog.set_level(logging.WARNING, logger="gateway.alerts")
    h = enrol(c)
    r = c.post("/v1/transfers", headers=h, json={"fromAccountId": 1, "toAccountNo": "000000002", "amount": 10000,
                                                 "pin": "4826", "idempotencyKey": "k-alert-ff"})
    assert r.status_code == 200 and r.json()["status"] == "completed"
    assert c.post("/v1/auth/pin", json={"currentPin": "4826", "newPin": "7391"}, headers=h).status_code == 200
    drain()
    assert fake.raw and fake.events == []
    assert "not sent" in caplog.text
    assert "772441203" not in caplog.text and "4826" not in caplog.text and "7391" not in caplog.text


def test_alerts_off_without_url_or_key(env, monkeypatch):
    c, _ = env
    assert main._state["alerts"] is None                     # ALERTS_URL unset in the test environment
    h = enrol(c)
    r = c.post("/v1/transfers", headers=h, json={"fromAccountId": 1, "toAccountNo": "000000002", "amount": 10000,
                                                 "pin": "4826", "idempotencyKey": "k-alert-of"})
    assert r.status_code == 200
    import dataclasses
    from app import config
    base = config.get_settings()
    for url, key in (("http://alerts", ""), ("", "svc-key")):
        monkeypatch.setattr(config, "settings", dataclasses.replace(base, alerts_url=url, alerts_service_key=key))
        main.configure(main.store(), main.core())
        assert main._state["alerts"] is None
    monkeypatch.setattr(config, "settings", dataclasses.replace(base, alerts_url="http://alerts",
                                                                alerts_service_key="svc-key"))
    main.configure(main.store(), main.core())
    assert isinstance(main._state["alerts"], Alerts)
    asyncio.run(main._state["alerts"].close())
