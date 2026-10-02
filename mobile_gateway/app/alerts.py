"""Best-effort transactional alerts (SMS) through the SACCO alerts service, server to server.

Alerts are fire-and-forget: they run as background tasks after the member's request has done its
work, and any failure is logged (without phone numbers, PINs or tokens) and dropped. Never put an
activation code, PIN, session token or device key in an event.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

import httpx

log = logging.getLogger("gateway.alerts")

TYPES = ("transfer", "loan_repay", "pin", "activation", "mobile_blocked")
CONTEXT_KEYS = ("amount", "account", "balance", "reference", "memberName")


class Alerts:
    def __init__(self, url: str, service_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self._url = url.rstrip("/") + "/v1/events"
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(5.0), transport=transport,
                                         headers={"X-Alerts-Service-Key": service_key})
        self._tasks: set[asyncio.Task] = set()

    def notify(self, kind: str, client_id: int, idempotency_key: str, context: dict,
               client: dict | None, fetch_client: Callable[[], Awaitable[dict]]):
        """Schedule one event. `client` is the Fineract client record if the caller already has it;
        otherwise `fetch_client` is awaited inside the background task, never in the request path."""
        if kind not in TYPES:
            raise ValueError(f"unknown alert type {kind}")
        task = asyncio.get_running_loop().create_task(
            self._deliver(kind, client_id, idempotency_key[:100], context, client, fetch_client))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _deliver(self, kind, client_id, idempotency_key, context, client, fetch_client):
        try:
            if client is None:
                client = await fetch_client()
            phone = str((client or {}).get("mobileNo") or "").strip()
            if not phone:
                return
            ctx = {k: context[k] for k in CONTEXT_KEYS if context.get(k) not in (None, "")}
            res = await self._client.post(self._url, json={
                "type": kind, "idempotencyKey": idempotency_key, "memberId": str(client_id),
                "phone": phone, "context": ctx,
            })
            if res.status_code >= 300:
                log.warning("alert %s for member %s rejected: HTTP %s", kind, client_id, res.status_code)
        except Exception as exc:  # best effort: never let an alert affect the member
            log.warning("alert %s for member %s not sent: %s", kind, client_id, exc.__class__.__name__)

    async def drain(self, timeout: float = 6.0):
        """Wait for in-flight alerts (shutdown, tests)."""
        if self._tasks:
            await asyncio.wait(set(self._tasks), timeout=timeout)

    async def close(self):
        await self.drain()
        await self._client.aclose()
