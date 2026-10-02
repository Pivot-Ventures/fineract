"""Thin Fineract client used by the gateway with its own service credentials."""

import base64

import httpx


class FineractError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


def _error_message(data, status: int) -> str:
    if isinstance(data, dict):
        errors = data.get("errors")
        if isinstance(errors, list) and errors:
            msgs = [e.get("defaultUserMessage") or e.get("developerMessage") or "" for e in errors if isinstance(e, dict)]
            msgs = [m for m in msgs if m]
            if msgs:
                return "; ".join(msgs)
        for k in ("defaultUserMessage", "developerMessage"):
            if data.get(k):
                return str(data[k])
    return f"Core banking returned HTTP {status}"


class Fineract:
    def __init__(self, base_url: str, tenant: str, user: str, password: str, verify_tls: bool = True,
                 transport: httpx.AsyncBaseTransport | None = None):
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={
                "Fineract-Platform-TenantId": tenant,
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
            },
            timeout=httpx.Timeout(30.0, connect=10.0),
            verify=verify_tls,
            transport=transport,
        )
        self._base_url = base_url
        self._tenant = tenant
        self._verify = verify_tls
        self._transport = transport

    async def close(self):
        await self._client.aclose()

    async def _request(self, method: str, path: str, json=None, params=None, headers=None):
        try:
            res = await self._client.request(method, path, json=json, params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise FineractError(f"Core banking unreachable: {exc.__class__.__name__}", 503) from exc
        try:
            data = res.json() if res.content else None
        except ValueError:
            data = None
        if res.status_code >= 400:
            # 4xx from Fineract is a business rule (insufficient funds, closed account...): pass the
            # message through as a 422. Anything else is our problem, not the member's.
            status = 422 if 400 <= res.status_code < 500 and res.status_code not in (401, 403) else 502
            raise FineractError(_error_message(data, res.status_code), status)
        return data

    async def get(self, path: str, **params):
        return await self._request("GET", path, params=params or None)

    async def post(self, path: str, body: dict):
        return await self._request("POST", path, json=body)

    # ---------- staff check (Desk -> gateway admin calls) ----------
    async def staff_permissions(self, basic_key: str) -> tuple[str, set[str]] | None:
        """Validate a staff member's Desk credentials against Fineract; return (username, permissions)."""
        try:
            user, password = base64.b64decode(basic_key).decode().split(":", 1)
        except Exception:
            return None
        async with httpx.AsyncClient(base_url=self._base_url, verify=self._verify, transport=self._transport,
                                     timeout=20.0) as c:
            try:
                res = await c.post("/authentication", json={"username": user, "password": password},
                                   headers={"Fineract-Platform-TenantId": self._tenant, "Accept": "application/json"})
            except httpx.HTTPError:
                raise FineractError("Core banking unreachable", 503)
        if res.status_code != 200:
            return None
        data = res.json()
        if not data.get("authenticated"):
            return None
        return data.get("username", user), set(data.get("permissions") or [])
