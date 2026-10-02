"""Mobile-money deposits (MTN MoMo, Airtel Money).

A deposit is a collection request: the member approves it on their phone with their mobile-money
PIN, the provider confirms, and only then is the savings account credited in Fineract. The gateway
never credits an account before the provider says the money arrived.

Providers implement `request_to_pay` and `status`. Only `SandboxProvider` exists today: it
simulates approval a few seconds after the request and must never be enabled in production.
Wiring the real MTN MoMo Collections / Airtel Money APIs means adding a provider here.
"""

import re
import secrets
import time

NETWORKS = {
    # Uganda number ranges (national significant number prefixes).
    "mtn": {"label": "MTN MoMo", "prefixes": ("76", "77", "78", "79", "31", "39")},
    "airtel": {"label": "Airtel Money", "prefixes": ("70", "74", "75", "20")},
}


def normalize_msisdn(phone: str) -> str | None:
    """Return 2567XXXXXXXX, or None if it is not a Ugandan mobile number."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("256"):
        digits = digits[3:]
    elif digits.startswith("0"):
        digits = digits[1:]
    return f"256{digits}" if re.fullmatch(r"[2-9]\d{8}", digits) else None


def network_for(msisdn: str) -> str | None:
    nsn = msisdn[3:]
    for name, net in NETWORKS.items():
        if nsn.startswith(net["prefixes"]):
            return name
    return None


class SandboxProvider:
    """Simulates a collection: approved after `approve_after` seconds.

    Test numbers: a number ending in 000 is declined (as if the member rejected it or had too
    little in their wallet); one ending in 999 never answers (times out).
    """

    name = "sandbox"
    timeout_seconds = 120

    def __init__(self, approve_after: float = 6.0):
        self.approve_after = approve_after
        self._requests: dict[str, dict] = {}

    async def request_to_pay(self, network: str, msisdn: str, amount: float, reference: str) -> str:
        ref = f"{network.upper()}-SBX-{secrets.token_hex(5).upper()}"
        self._requests[ref] = {"msisdn": msisdn, "amount": amount, "at": time.monotonic()}
        return ref

    async def status(self, provider_ref: str) -> tuple[str, str]:
        """Return (status, reason): status is pending | successful | failed."""
        req = self._requests.get(provider_ref)
        if not req:
            return "failed", "Unknown request."
        age = time.monotonic() - req["at"]
        if req["msisdn"].endswith("999"):
            return ("failed", "No response from your phone. Try again.") if age > self.timeout_seconds else ("pending", "")
        if age < self.approve_after:
            return "pending", ""
        if req["msisdn"].endswith("000"):
            return "failed", "The payment was declined on your phone or your wallet balance is too low."
        return "successful", ""
