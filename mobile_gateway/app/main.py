"""Pivot SACCO member gateway.

The member app talks only to this service. It authenticates members with their own PIN on a
registered device, holds the Fineract service credentials server-side, and checks on every call
that the accounts involved belong to the signed-in member.
"""

import asyncio
import collections
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import get_settings
from .fineract import Fineract, FineractError
from .momo import NETWORKS, SandboxProvider, network_for, normalize_msisdn
from .store import Store, hash_pin, now, sha256, verify_pin


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


_state: dict = {}
_client_locks: dict[int, asyncio.Lock] = collections.defaultdict(asyncio.Lock)
_ip_hits: dict[str, collections.deque] = collections.defaultdict(collections.deque)
_lookup_hits: dict[int, collections.deque] = collections.defaultdict(collections.deque)


def configure(store: Store, fineract: Fineract, momo=None):
    """Wire dependencies (startup in production, directly from tests)."""
    _state["store"] = store
    _state["fineract"] = fineract
    if momo is None and get_settings().momo_provider == "sandbox":
        momo = SandboxProvider()
    _state["momo"] = momo


@asynccontextmanager
async def lifespan(_: FastAPI):
    if "store" not in _state:
        s = get_settings()
        configure(Store(s.db_path),
                  Fineract(s.fineract_url, s.fineract_tenant, s.fineract_user, s.fineract_password,
                           verify_tls=s.fineract_verify_tls))
    yield
    await _state["fineract"].close()


app = FastAPI(title="Pivot SACCO member gateway", docs_url=None, redoc_url=None, openapi_url=None,
              lifespan=lifespan)


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return JSONResponse({"code": exc.code, "message": exc.message}, status_code=exc.status)


@app.exception_handler(FineractError)
async def _fineract_error(_: Request, exc: FineractError):
    code = "rejected" if exc.status == 422 else "core_unavailable"
    message = exc.message if exc.status == 422 else "The SACCO system is temporarily unavailable. Try again shortly."
    return JSONResponse({"code": code, "message": message}, status_code=exc.status)


@app.middleware("http")
async def _no_store(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


def store() -> Store:
    return _state["store"]


def core() -> Fineract:
    return _state["fineract"]


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def throttle(bucket: dict, key, limit: int, window: int, message: str):
    q = bucket[key]
    t = time.monotonic()
    while q and q[0] < t - window:
        q.popleft()
    if len(q) >= limit:
        raise ApiError(429, "too_many_requests", message)
    q.append(t)


def today_local() -> str:
    return datetime.now(ZoneInfo(get_settings().tenant_tz)).strftime("%Y-%m-%d")


def norm_member_no(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits.lstrip("0") or ("0" if digits else "")


def check_new_pin(pin: str):
    if not re.fullmatch(r"\d{4}", pin or ""):
        raise ApiError(422, "weak_pin", "Your PIN must be exactly 4 digits.")
    digits = [int(c) for c in pin]
    steps = {digits[i + 1] - digits[i] for i in range(3)}
    if len(set(pin)) == 1 or steps in ({1}, {-1}) or pin in {"1212", "2580", "0852", "1122", "1004", "2000"}:
        raise ApiError(422, "weak_pin", "That PIN is too easy to guess. Choose a less obvious one.")


def mask_name(client: dict) -> str:
    first = (client.get("firstname") or "").strip()
    last = (client.get("lastname") or "").strip()
    if not first and not last:
        parts = (client.get("displayName") or "").split()
        first, last = (parts[0] if parts else "Member"), (parts[-1] if len(parts) > 1 else "")
    return f"{first.title()} {last[:1].upper()}." if last else first.title()


# ---------------------------------------------------------------- PIN checks and lockout

def _locked_message(member) -> str:
    if member["status"] == "blocked":
        return "Mobile banking is blocked for your account. Visit your branch to reset your PIN."
    minutes = max(1, (member["locked_until"] - now() + 59) // 60)
    return f"Too many wrong PINs. Try again in {minutes} minute{'s' if minutes != 1 else ''}."


def check_pin(member, pin: str, ip: str) -> None:
    """Verify a PIN, applying lockout. Raises ApiError on any failure."""
    s, st = get_settings(), store()
    if member["status"] == "blocked" or member["locked_until"] > now():
        raise ApiError(423, "locked", _locked_message(member))
    if verify_pin(pin or "", member["pin_hash"]):
        if member["failed_attempts"]:
            st.update_member(member["client_id"], failed_attempts=0, locked_until=0)
        return
    failures = member["failed_attempts"] + 1
    fields = {"failed_attempts": failures}
    if failures >= s.pin_block_after:
        fields["status"] = "blocked"
        st.delete_sessions_for(member["client_id"])
    elif failures % s.pin_lock_after == 0:
        fields["locked_until"] = now() + s.pin_lock_minutes * 60
    st.update_member(member["client_id"], **fields)
    st.audit("member", "pin_failed", member["client_id"], {"failures": failures}, ip)
    updated = st.member(member["client_id"])
    if updated["status"] == "blocked" or updated["locked_until"] > now():
        raise ApiError(423, "locked", _locked_message(updated))
    left = s.pin_lock_after - (failures % s.pin_lock_after)
    raise ApiError(401, "wrong_pin", f"Wrong PIN. {left} attempt{'s' if left != 1 else ''} left before your account is locked.")


# ---------------------------------------------------------------- member session dependency

class MemberContext:
    def __init__(self, member, token: str, ip: str):
        self.member, self.token, self.ip = member, token, ip

    @property
    def client_id(self) -> int:
        return self.member["client_id"]


async def member_ctx(request: Request, authorization: str = Header(default=""),
                     x_device_key: str = Header(default="")) -> MemberContext:
    s, st = get_settings(), store()
    token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    sess = st.session(token) if token else None
    t = now()
    if (not sess or sess["last_seen_at"] < t - s.session_idle_seconds
            or sess["created_at"] < t - s.session_max_seconds
            or not secrets.compare_digest(sess["device_hash"], sha256(x_device_key or ""))):
        if sess:
            st.delete_session(token)
        raise ApiError(401, "session_expired", "Your session has ended. Enter your PIN to continue.")
    member = st.member(sess["client_id"])
    if not member or member["status"] != "active":
        st.delete_session(token)
        raise ApiError(423, "locked", "Mobile banking is not active for this account. Visit your branch.")
    st.touch_session(token)
    return MemberContext(member, token, client_ip(request))


# ---------------------------------------------------------------- Fineract mapping

CREDIT_FLAGS = ("deposit", "interestPosting", "dividendPayout", "amountRelease")


def map_txn(t: dict, account_no: str) -> dict:
    ttype = t.get("transactionType") or {}
    credit = any(ttype.get(f) for f in CREDIT_FLAGS)
    label = ttype.get("value") or "Transaction"
    if t.get("transfer"):
        label = "Transfer in" if credit else "Transfer out"
    elif ttype.get("interestPosting"):
        label = "Interest"
    elif ttype.get("feeDeduction") or ttype.get("annualFee") or ttype.get("payCharge"):
        label = "Fee"
    d = t.get("date") or []
    return {
        "id": t.get("id"),
        "date": f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}" if len(d) >= 3 else None,
        "type": label,
        "credit": credit,
        "amount": float(t.get("amount") or 0),
        "runningBalance": t.get("runningBalance"),
        "accountNo": account_no,
        "note": (t.get("note") or (t.get("transfer") or {}).get("transferDescription") or "")[:120],
    }


def map_savings(detail: dict) -> dict:
    summary = detail.get("summary") or {}
    status = detail.get("status") or {}
    balance = float(summary.get("accountBalance") or detail.get("accountBalance") or 0)
    available = summary.get("availableBalance")
    return {
        "id": detail["id"],
        "accountNo": detail.get("accountNo"),
        "product": detail.get("savingsProductName") or detail.get("productName") or "Savings",
        "balance": balance,
        "available": float(available) if available is not None else balance,
        "currency": (detail.get("currency") or {}).get("code", "UGX"),
        "status": status.get("value", ""),
        "active": bool(status.get("active")),
    }


def map_loan(loan: dict) -> dict:
    status = loan.get("status") or {}
    summary = loan.get("summary") or {}
    periods = [p for p in (loan.get("repaymentSchedule") or {}).get("periods", []) if p.get("period")]
    schedule = []
    next_due = None
    for p in periods:
        d = p.get("dueDate") or []
        due = f"{d[0]:04d}-{d[1]:02d}-{d[2]:02d}" if len(d) >= 3 else None
        row = {
            "period": p["period"],
            "dueDate": due,
            "due": float(p.get("totalDueForPeriod") or 0),
            "outstanding": float(p.get("totalOutstandingForPeriod") or 0),
            "paid": bool(p.get("complete")),
        }
        schedule.append(row)
        if next_due is None and not row["paid"] and row["outstanding"] > 0:
            next_due = {"date": due, "amount": row["outstanding"]}
    active = bool(status.get("active"))
    return {
        "id": loan["id"],
        "accountNo": loan.get("accountNo"),
        "product": loan.get("loanProductName") or "Loan",
        "status": status.get("value", ""),
        "active": active,
        "principal": float(loan.get("principal") or summary.get("principalDisbursed") or 0),
        "outstanding": float(summary.get("totalOutstanding") or 0) if active else 0.0,
        "overdue": float(summary.get("totalOverdue") or 0) if active else 0.0,
        "currency": (loan.get("currency") or {}).get("code", "UGX"),
        "nextDue": next_due,
        "schedule": schedule,
    }


async def owned_savings(client_id: int, savings_id: int, with_txns: bool = False) -> dict:
    params = {"associations": "transactions"} if with_txns else {}
    try:
        detail = await core().get(f"/savingsaccounts/{int(savings_id)}", **params)
    except FineractError as exc:
        if exc.status == 422:
            raise ApiError(404, "not_found", "Account not found.")
        raise
    if detail.get("clientId") != client_id:
        raise ApiError(404, "not_found", "Account not found.")
    return detail


async def owned_loan(client_id: int, loan_id: int) -> dict:
    try:
        loan = await core().get(f"/loans/{int(loan_id)}", associations="repaymentSchedule")
    except FineractError as exc:
        if exc.status == 422:
            raise ApiError(404, "not_found", "Loan not found.")
        raise
    if loan.get("clientId") != client_id:
        raise ApiError(404, "not_found", "Loan not found.")
    return loan


async def find_savings_by_account_no(account_no: str) -> dict | None:
    account_no = re.sub(r"\D", "", account_no or "")
    if not account_no:
        return None
    hits = await core().get("/search", query=account_no, resource="savings", exactMatch="true")
    for hit in hits or []:
        if hit.get("entityAccountNo") == account_no and hit.get("entityId"):
            detail = await core().get(f"/savingsaccounts/{int(hit['entityId'])}")
            if detail.get("accountNo") == account_no:
                return detail
    return None


# ---------------------------------------------------------------- auth endpoints

class ActivateBody(BaseModel):
    memberNo: str = Field(max_length=32)
    code: str = Field(max_length=16)
    pin: str = Field(max_length=8)
    deviceKey: str = Field(min_length=32, max_length=128)
    deviceName: str = Field(default="", max_length=80)


class LoginBody(BaseModel):
    memberNo: str = Field(max_length=32)
    pin: str = Field(max_length=8)
    deviceKey: str = Field(min_length=32, max_length=128)


@app.get("/v1/health")
async def health():
    return {"ok": True}


@app.post("/v1/auth/activate")
async def activate(body: ActivateBody, request: Request):
    ip = client_ip(request)
    throttle(_ip_hits, ip, 20, 600, "Too many attempts from this network. Wait a few minutes.")
    st, s = store(), get_settings()
    member = st.member_by_no(norm_member_no(body.memberNo))
    code_row = st.activation_code(member["client_id"]) if member else None
    generic = ApiError(401, "bad_activation", "Member number or activation code is not valid.")
    if not member or not code_row or member["status"] == "blocked":
        raise generic
    if code_row["expires_at"] < now() or code_row["attempts"] >= 5:
        st.delete_activation_code(member["client_id"])
        raise ApiError(401, "code_expired", "This activation code has expired. Ask your branch for a new one.")
    if not verify_pin(re.sub(r"\D", "", body.code), code_row["code_hash"]):
        st.bump_activation_attempts(member["client_id"])
        st.audit("member", "activation_failed", member["client_id"], None, ip)
        raise generic
    check_new_pin(body.pin)
    client = await core().get(f"/clients/{member['client_id']}")
    if not (client.get("active") or (client.get("status") or {}).get("value") == "Active"):
        raise ApiError(423, "inactive", "Your membership is not active. Visit your branch.")
    st.delete_activation_code(member["client_id"])
    st.delete_sessions_for(member["client_id"])
    st.update_member(member["client_id"], status="active", pin_hash=hash_pin(body.pin), failed_attempts=0,
                     locked_until=0, device_hash=sha256(body.deviceKey), device_name=body.deviceName[:80],
                     activated_at=now(), last_login_at=now())
    st.audit("member", "activated", member["client_id"], {"device": body.deviceName[:80]}, ip)
    token = st.create_session(member["client_id"], sha256(body.deviceKey))
    return {"token": token, "idleSeconds": s.session_idle_seconds, "memberNo": client.get("accountNo"),
            "firstName": (client.get("firstname") or client.get("displayName") or "").split(" ")[0].title()}


@app.post("/v1/auth/login")
async def login(body: LoginBody, request: Request):
    ip = client_ip(request)
    throttle(_ip_hits, ip, 30, 600, "Too many attempts from this network. Wait a few minutes.")
    st, s = store(), get_settings()
    member = st.member_by_no(norm_member_no(body.memberNo))
    if not member or member["status"] == "pending" or not member["pin_hash"]:
        raise ApiError(401, "not_registered", "This phone is not registered for mobile banking. Activate it with a code from your branch.")
    if not secrets.compare_digest(member["device_hash"] or "", sha256(body.deviceKey)):
        st.audit("member", "login_unknown_device", member["client_id"], None, ip)
        raise ApiError(401, "device_not_registered",
                       "This phone is not the one registered for your account. Ask your branch for an activation code to move mobile banking to this phone.")
    check_pin(member, body.pin, ip)
    client = await core().get(f"/clients/{member['client_id']}")
    if not (client.get("active") or (client.get("status") or {}).get("value") == "Active"):
        raise ApiError(423, "inactive", "Your membership is not active. Visit your branch.")
    st.purge_sessions(s.session_idle_seconds, s.session_max_seconds)
    st.update_member(member["client_id"], last_login_at=now())
    st.audit("member", "login", member["client_id"], None, ip)
    return {"token": st.create_session(member["client_id"], member["device_hash"]),
            "idleSeconds": s.session_idle_seconds}


@app.post("/v1/auth/logout")
async def logout(ctx: MemberContext = Depends(member_ctx)):
    store().delete_session(ctx.token)
    return {"ok": True}


class ChangePinBody(BaseModel):
    currentPin: str = Field(max_length=8)
    newPin: str = Field(max_length=8)


@app.post("/v1/auth/pin")
async def change_pin(body: ChangePinBody, ctx: MemberContext = Depends(member_ctx)):
    check_pin(ctx.member, body.currentPin, ctx.ip)
    check_new_pin(body.newPin)
    if body.newPin == body.currentPin:
        raise ApiError(422, "weak_pin", "Choose a PIN different from your current one.")
    store().update_member(ctx.client_id, pin_hash=hash_pin(body.newPin))
    store().audit("member", "pin_changed", ctx.client_id, None, ctx.ip)
    return {"ok": True}


@app.post("/v1/auth/deregister")
async def deregister(ctx: MemberContext = Depends(member_ctx)):
    """Unlink this phone. The member needs a new activation code to use mobile banking again."""
    st = store()
    st.update_member(ctx.client_id, status="pending", pin_hash=None, device_hash=None, device_name=None)
    st.delete_sessions_for(ctx.client_id)
    st.audit("member", "deregistered", ctx.client_id, None, ctx.ip)
    return {"ok": True}


# ---------------------------------------------------------------- member read endpoints

@app.get("/v1/me")
async def me(ctx: MemberContext = Depends(member_ctx)):
    cid = ctx.client_id
    client = await core().get(f"/clients/{cid}")
    accounts = await core().get(f"/clients/{cid}/accounts") or {}
    savings, recent = [], []
    for item in accounts.get("savingsAccounts") or []:
        if not (item.get("status") or {}).get("active"):
            continue
        detail = await core().get(f"/savingsaccounts/{item['id']}", associations="transactions")
        mapped = map_savings(detail)
        savings.append(mapped)
        recent += [map_txn(t, mapped["accountNo"]) for t in (detail.get("transactions") or [])[:15] if not t.get("reversed")]
    loans = []
    for item in accounts.get("loanAccounts") or []:
        st_ = item.get("status") or {}
        if st_.get("closed") or st_.get("value", "").lower().startswith(("closed", "rejected", "withdrawn")):
            continue
        loans.append(map_loan(await core().get(f"/loans/{item['id']}", associations="repaymentSchedule")))
    recent.sort(key=lambda t: (t["date"] or "", t["id"] or 0), reverse=True)
    mobile = client.get("mobileNo") or ""
    return {
        "member": {
            "clientId": cid,
            "memberNo": client.get("accountNo"),
            "name": client.get("displayName"),
            "firstName": (client.get("firstname") or client.get("displayName") or "").split(" ")[0].title(),
            "office": client.get("officeName"),
            "mobile": (mobile[:4] + "•••" + mobile[-3:]) if len(mobile) > 7 else mobile,
            "device": ctx.member["device_name"],
        },
        "currency": savings[0]["currency"] if savings else "UGX",
        "savings": savings,
        "loans": loans,
        "recent": recent[:20],
        "channels": {"momoDeposits": _state.get("momo") is not None,
                     "momoSandbox": getattr(_state.get("momo"), "name", "") == "sandbox"},
        "limits": {"perTransaction": get_settings().limit_per_txn, "perDay": get_settings().limit_per_day,
                   "usedToday": store().moved_today(cid, today_local())},
    }


@app.get("/v1/savings/{savings_id}/transactions")
async def savings_transactions(savings_id: int, ctx: MemberContext = Depends(member_ctx)):
    detail = await owned_savings(ctx.client_id, savings_id, with_txns=True)
    account = map_savings(detail)
    txns = [map_txn(t, account["accountNo"]) for t in detail.get("transactions") or [] if not t.get("reversed")]
    return {"account": account, "transactions": txns}


@app.get("/v1/loans/{loan_id}")
async def loan_detail(loan_id: int, ctx: MemberContext = Depends(member_ctx)):
    return map_loan(await owned_loan(ctx.client_id, loan_id))


# ---------------------------------------------------------------- money movement

class RecipientBody(BaseModel):
    accountNo: str = Field(max_length=32)


class TransferBody(BaseModel):
    fromAccountId: int
    toAccountNo: str = Field(max_length=32)
    amount: float
    note: str = Field(default="", max_length=100)
    pin: str = Field(max_length=8)
    idempotencyKey: str = Field(min_length=8, max_length=64)


class RepayBody(BaseModel):
    fromAccountId: int
    amount: float
    pin: str = Field(max_length=8)
    idempotencyKey: str = Field(min_length=8, max_length=64)


@app.post("/v1/transfers/recipient")
async def recipient(body: RecipientBody, ctx: MemberContext = Depends(member_ctx)):
    throttle(_lookup_hits, ctx.client_id, 20, 3600, "Too many account lookups. Try again later.")
    target = await find_savings_by_account_no(body.accountNo)
    if not target or not (target.get("status") or {}).get("active"):
        raise ApiError(404, "not_found", "No active SACCO account has that number.")
    client = await core().get(f"/clients/{target['clientId']}")
    return {"accountNo": target["accountNo"], "name": mask_name(client),
            "own": target["clientId"] == ctx.client_id}


def check_amount(amount: float, ctx: MemberContext):
    s = get_settings()
    if not (amount > 0) or amount != round(amount):
        raise ApiError(422, "bad_amount", "Enter an amount in whole shillings.")
    if amount > s.limit_per_txn:
        raise ApiError(422, "over_limit", f"The most you can move in one transaction is UGX {s.limit_per_txn:,}.")
    used = store().moved_today(ctx.client_id, today_local())
    if used + amount > s.limit_per_day:
        left = max(0, s.limit_per_day - used)
        raise ApiError(422, "over_daily_limit", f"This would pass your daily limit. You can move UGX {left:,.0f} more today.")


def check_available(source: dict, amount: float):
    acc = map_savings(source)
    if not acc["active"]:
        raise ApiError(422, "inactive_account", "The account you are paying from is not active.")
    if amount > acc["available"]:
        raise ApiError(422, "insufficient_funds", f"Not enough money. Available balance is UGX {acc['available']:,.0f}.")


@app.post("/v1/transfers")
async def transfer(body: TransferBody, ctx: MemberContext = Depends(member_ctx)):
    st = store()
    async with _client_locks[ctx.client_id]:
        if (prior := st.idempotent_response(ctx.client_id, body.idempotencyKey)) is not None:
            return prior
        check_pin(ctx.member, body.pin, ctx.ip)
        check_amount(body.amount, ctx)
        source = await owned_savings(ctx.client_id, body.fromAccountId)
        target = await find_savings_by_account_no(body.toAccountNo)
        if not target or not (target.get("status") or {}).get("active"):
            raise ApiError(404, "not_found", "No active SACCO account has that number.")
        if target["id"] == source["id"]:
            raise ApiError(422, "same_account", "Choose a different account to send to.")
        check_available(source, body.amount)
        target_client = await core().get(f"/clients/{target['clientId']}")
        source_client = await core().get(f"/clients/{ctx.client_id}")
        date = today_local()
        note = re.sub(r"[\x00-\x1f]", " ", body.note).strip()
        description = f"Mobile transfer to {target['accountNo']}" + (f": {note}" if note else "")
        res = await core().post("/accounttransfers", {
            "fromOfficeId": source_client["officeId"], "fromClientId": ctx.client_id,
            "fromAccountType": 2, "fromAccountId": source["id"],
            "toOfficeId": target_client["officeId"], "toClientId": target["clientId"],
            "toAccountType": 2, "toAccountId": target["id"],
            "transferDate": date, "transferAmount": body.amount, "transferDescription": description[:200],
            "dateFormat": "yyyy-MM-dd", "locale": "en",
        })
        ref = (res or {}).get("resourceId")
        st.record_move(ctx.client_id, "transfer", body.amount, date, ref)
        after = map_savings(await core().get(f"/savingsaccounts/{source['id']}"))
        result = {
            "reference": f"TRF-{ref}" if ref else None,
            "date": date,
            "amount": body.amount,
            "from": {"accountNo": source["accountNo"], "product": after["product"]},
            "to": {"accountNo": target["accountNo"], "name": mask_name(target_client),
                   "own": target["clientId"] == ctx.client_id},
            "note": note,
            "availableAfter": after["available"],
        }
        st.save_idempotent_response(ctx.client_id, body.idempotencyKey, result)
        st.audit("member", "transfer", ctx.client_id,
                 {"from": source["accountNo"], "to": target["accountNo"], "amount": body.amount, "ref": ref}, ctx.ip)
        return result


@app.post("/v1/loans/{loan_id}/repayments")
async def repay(loan_id: int, body: RepayBody, ctx: MemberContext = Depends(member_ctx)):
    st = store()
    async with _client_locks[ctx.client_id]:
        if (prior := st.idempotent_response(ctx.client_id, body.idempotencyKey)) is not None:
            return prior
        check_pin(ctx.member, body.pin, ctx.ip)
        check_amount(body.amount, ctx)
        loan = map_loan(await owned_loan(ctx.client_id, loan_id))
        if not loan["active"]:
            raise ApiError(422, "loan_not_active", "This loan is not active, so it cannot be repaid yet.")
        if body.amount > loan["outstanding"]:
            raise ApiError(422, "over_outstanding", f"That is more than you owe. Outstanding balance is UGX {loan['outstanding']:,.0f}.")
        source = await owned_savings(ctx.client_id, body.fromAccountId)
        check_available(source, body.amount)
        client = await core().get(f"/clients/{ctx.client_id}")
        date = today_local()
        res = await core().post("/accounttransfers", {
            "fromOfficeId": client["officeId"], "fromClientId": ctx.client_id,
            "fromAccountType": 2, "fromAccountId": source["id"],
            "toOfficeId": client["officeId"], "toClientId": ctx.client_id,
            "toAccountType": 1, "toAccountId": loan["id"],
            "transferDate": date, "transferAmount": body.amount,
            "transferDescription": f"Mobile loan repayment {loan['accountNo']}",
            "dateFormat": "yyyy-MM-dd", "locale": "en",
        })
        ref = (res or {}).get("resourceId")
        st.record_move(ctx.client_id, "loan_repayment", body.amount, date, ref)
        after_loan = map_loan(await owned_loan(ctx.client_id, loan_id))
        after_sav = map_savings(await core().get(f"/savingsaccounts/{source['id']}"))
        result = {
            "reference": f"RPY-{ref}" if ref else None,
            "date": date,
            "amount": body.amount,
            "loan": {"accountNo": loan["accountNo"], "product": loan["product"],
                     "outstandingAfter": after_loan["outstanding"]},
            "from": {"accountNo": source["accountNo"], "availableAfter": after_sav["available"]},
        }
        st.save_idempotent_response(ctx.client_id, body.idempotencyKey, result)
        st.audit("member", "loan_repayment", ctx.client_id,
                 {"loan": loan["accountNo"], "from": source["accountNo"], "amount": body.amount, "ref": ref}, ctx.ip)
        return result


# ---------------------------------------------------------------- mobile-money deposits

class DepositBody(BaseModel):
    savingsId: int
    network: str = Field(max_length=10)
    phone: str = Field(max_length=20)
    amount: float
    idempotencyKey: str = Field(min_length=8, max_length=64)


def deposit_view(row) -> dict:
    return {"id": row["id"], "status": row["status"], "reason": row["reason"], "amount": row["amount"],
            "network": NETWORKS[row["network"]]["label"], "phone": row["msisdn"][:6] + "•••" + row["msisdn"][-3:],
            "reference": f"DEP-{row['fineract_id']}" if row["fineract_id"] else None,
            "providerRef": row["provider_ref"]}


@app.post("/v1/deposits/momo")
async def momo_deposit(body: DepositBody, ctx: MemberContext = Depends(member_ctx)):
    """Ask the member's mobile-money wallet to pay. Nothing is credited until the provider confirms."""
    provider = _state.get("momo")
    if provider is None:
        raise ApiError(503, "unavailable", "Mobile money deposits are not available yet. Deposit at any branch.")
    st, s = store(), get_settings()
    async with _client_locks[ctx.client_id]:
        if (prior := st.idempotent_response(ctx.client_id, body.idempotencyKey)) is not None:
            return prior
        network = body.network.lower()
        if network not in NETWORKS:
            raise ApiError(422, "bad_network", "Choose MTN MoMo or Airtel Money.")
        msisdn = normalize_msisdn(body.phone)
        if not msisdn:
            raise ApiError(422, "bad_phone", "Enter a valid Ugandan mobile number, e.g. 0772 123456.")
        if network_for(msisdn) != network:
            raise ApiError(422, "wrong_network", f"That number is not a {NETWORKS[network]['label']} number.")
        if not (body.amount > 0) or body.amount != round(body.amount):
            raise ApiError(422, "bad_amount", "Enter an amount in whole shillings.")
        if body.amount < s.momo_min_deposit or body.amount > s.momo_max_deposit:
            raise ApiError(422, "bad_amount",
                           f"Mobile money deposits must be between UGX {s.momo_min_deposit:,} and UGX {s.momo_max_deposit:,}.")
        account = map_savings(await owned_savings(ctx.client_id, body.savingsId))
        if not account["active"]:
            raise ApiError(422, "inactive_account", "That account is not active.")
        deposit_id = f"D{secrets.token_hex(6).upper()}"
        provider_ref = await provider.request_to_pay(network, msisdn, body.amount, deposit_id)
        st.create_deposit({"id": deposit_id, "client_id": ctx.client_id, "savings_id": account["id"], "network": network,
                           "msisdn": msisdn, "amount": body.amount, "provider_ref": provider_ref})
        st.audit("member", "momo_deposit_requested", ctx.client_id,
                 {"id": deposit_id, "network": network, "amount": body.amount, "account": account["accountNo"]}, ctx.ip)
        result = deposit_view(st.deposit(deposit_id))
        st.save_idempotent_response(ctx.client_id, body.idempotencyKey, result)
        return result


@app.get("/v1/deposits/{deposit_id}")
async def deposit_status(deposit_id: str, ctx: MemberContext = Depends(member_ctx)):
    """Poll a deposit. When the provider confirms, the savings account is credited exactly once."""
    st, s = store(), get_settings()
    row = st.deposit(deposit_id)
    if not row or row["client_id"] != ctx.client_id:
        raise ApiError(404, "not_found", "Deposit not found.")
    provider = _state.get("momo")
    if row["status"] == "pending" and provider is not None:
        async with _client_locks[ctx.client_id]:
            row = st.deposit(deposit_id)
            if row["status"] == "pending":
                status, reason = await provider.status(row["provider_ref"])
                if status == "successful":
                    payment_type = s.momo_payment_type_mtn if row["network"] == "mtn" else s.momo_payment_type_airtel
                    res = await core().post(f"/savingsaccounts/{row['savings_id']}/transactions?command=deposit", {
                        "transactionDate": today_local(), "transactionAmount": row["amount"],
                        "paymentTypeId": payment_type, "receiptNumber": row["provider_ref"],
                        "note": f"{NETWORKS[row['network']]['label']} deposit from {row['msisdn']} ({row['id']})",
                        "dateFormat": "yyyy-MM-dd", "locale": "en",
                    })
                    st.finish_deposit(deposit_id, "successful", fineract_id=(res or {}).get("resourceId"))
                    st.audit("member", "momo_deposit_credited", ctx.client_id,
                             {"id": deposit_id, "amount": row["amount"], "ref": (res or {}).get("resourceId")}, ctx.ip)
                elif status == "failed":
                    st.finish_deposit(deposit_id, "failed", reason=reason)
                    st.audit("member", "momo_deposit_failed", ctx.client_id, {"id": deposit_id, "reason": reason}, ctx.ip)
                row = st.deposit(deposit_id)
    return deposit_view(row)


# ---------------------------------------------------------------- staff (Desk) endpoints

async def staff_user(x_staff_authorization: str = Header(default="")) -> str:
    key = x_staff_authorization[6:] if x_staff_authorization.lower().startswith("basic ") else ""
    found = await core().staff_permissions(key) if key else None
    if not found:
        raise ApiError(401, "staff_auth", "Sign in to Desk again.")
    username, perms = found
    if "ALL_FUNCTIONS" not in perms and get_settings().staff_permission not in perms:
        raise ApiError(403, "staff_forbidden", "Your role cannot manage mobile banking.")
    return username


def member_status(client_id: int) -> dict:
    m = store().member(client_id)
    code = store().activation_code(client_id)
    if not m:
        return {"enrolled": False, "status": "none"}
    status = m["status"]
    if status == "active" and m["locked_until"] > now():
        status = "locked"
    return {
        "enrolled": True,
        "status": status,
        "device": m["device_name"],
        "activatedAt": m["activated_at"],
        "lastLoginAt": m["last_login_at"],
        "failedAttempts": m["failed_attempts"],
        "codeExpiresAt": code["expires_at"] if code and code["expires_at"] > now() else None,
    }


@app.get("/v1/admin/members/{client_id}")
async def admin_status(client_id: int, staff: str = Depends(staff_user)):
    return member_status(client_id)


@app.post("/v1/admin/members/{client_id}/activation")
async def admin_issue_code(client_id: int, request: Request, staff: str = Depends(staff_user)):
    """Issue a one-time code. Activating with it sets a new PIN and binds the member's phone."""
    client = await core().get(f"/clients/{client_id}")
    if not (client.get("active") or (client.get("status") or {}).get("value") == "Active"):
        raise ApiError(422, "inactive", "Only active members can use mobile banking.")
    st, s = store(), get_settings()
    member_no = norm_member_no(client.get("accountNo") or "")
    st.upsert_pending_member(client_id, member_no)
    if st.member(client_id)["status"] == "blocked":
        st.update_member(client_id, status="pending", failed_attempts=0, locked_until=0)
    code = f"{secrets.randbelow(10**8):08d}"
    st.put_activation_code(client_id, code, s.activation_code_hours * 3600, staff)
    st.audit(f"staff:{staff}", "activation_code_issued", client_id, None, client_ip(request))
    return {"code": f"{code[:4]} {code[4:]}", "memberNo": client.get("accountNo"),
            "expiresAt": now() + s.activation_code_hours * 3600, **{"state": member_status(client_id)}}


@app.post("/v1/admin/members/{client_id}/block")
async def admin_block(client_id: int, request: Request, staff: str = Depends(staff_user)):
    st = store()
    if not st.member(client_id):
        raise ApiError(404, "not_found", "This member is not enrolled.")
    st.update_member(client_id, status="blocked")
    st.delete_sessions_for(client_id)
    st.delete_activation_code(client_id)
    st.audit(f"staff:{staff}", "blocked", client_id, None, client_ip(request))
    return member_status(client_id)


@app.post("/v1/admin/members/{client_id}/unlock")
async def admin_unlock(client_id: int, request: Request, staff: str = Depends(staff_user)):
    """Clear a temporary PIN lock. A blocked member needs a new activation code instead."""
    st = store()
    m = st.member(client_id)
    if not m:
        raise ApiError(404, "not_found", "This member is not enrolled.")
    if m["status"] == "blocked":
        raise ApiError(422, "blocked", "This member is blocked. Issue a new activation code instead.")
    st.update_member(client_id, failed_attempts=0, locked_until=0)
    st.audit(f"staff:{staff}", "unlocked", client_id, None, client_ip(request))
    return member_status(client_id)
