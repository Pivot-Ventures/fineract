#!/usr/bin/env python3
"""Pivot SACCO Desk — local development server (static UI + Fineract reverse proxy).

Development only. Production is served by Caddy (static files + reverse proxy).

Serves an allowlist of desk/ files (*.html, assets/**, favicon, and the payments-portal/ and
transactional-alerts/ sub-apps) on 127.0.0.1:PORT and proxies /fineract-provider/* to
FINERACT_HOST:FINERACT_PORT so the browser talks to a single origin (no CORS). The member
gateway, alerts service and payments middleware are proxied too when their URLs are set,
mirroring deploy/production/caddy/routes.caddy. TLS verification is disabled only for a local Fineract
(localhost / 127.0.0.1 / host.docker.internal) with a self-signed certificate.

Usage:
  cd desk
  python3 server.py                 # http://127.0.0.1:5173/
  PORT=5191 python3 server.py       # another port

Environment:
  PORT            listen port (default 5173)
  FINERACT_HOST   upstream host (default localhost)
  FINERACT_PORT   upstream port (default 8443)
  GATEWAY_URL     member gateway for /mobile/api/*, e.g. http://127.0.0.1:8700 (optional)
  ALERTS_URL      alerts service for /alerts/api/*, e.g. http://127.0.0.1:8095 (optional)
  PAYMENTS_URL    payments middleware for /payments/*, e.g. http://127.0.0.1:3000 (optional)
"""
from __future__ import annotations

import http.client
import http.server
import mimetypes
import os
import posixpath
import ssl
import sys
import urllib.parse
from pathlib import Path

os.environ.setdefault("PYTHONUNBUFFERED", "1")

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
PORT = int(os.environ.get("PORT", "5173"))
UPSTREAM_HOST = os.environ.get("FINERACT_HOST", "localhost")
UPSTREAM_PORT = int(os.environ.get("FINERACT_PORT", "8443"))
PROXY_PREFIX = "/fineract-provider/"
MAX_BODY = 20 * 1024 * 1024  # 20 MB (client photos)
LOCAL_UPSTREAMS = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}
ALLOWED_HOSTS = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT}
STATIC_TYPES = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".woff", ".woff2"}
# Sub-apps served like the desk root: their *.html and assets/**. The portal's demo book
# (fixtures/*.json) is served in development only; production Caddy never serves it.
SUB_APPS = {"payments-portal": {"fixtures"}, "transactional-alerts": set()}
# path prefix -> (upstream base URL, prefix to strip, private sub-paths answered with 404)
SERVICE_PROXIES = {
    prefix: (url.rstrip("/"), strip, private)
    for prefix, url, strip, private in (
        ("/mobile/api/", os.environ.get("GATEWAY_URL", ""), "/mobile/api", ()),
        ("/alerts/api/", os.environ.get("ALERTS_URL", ""), "/alerts/api", ()),
        ("/payments/", os.environ.get("PAYMENTS_URL", ""), "",
         ("/payments/docs", "/payments/api-docs", "/payments/swagger", "/payments/internal/")),
    )
}

if UPSTREAM_HOST in LOCAL_UPSTREAMS:
    # Local Fineract ships a self-signed certificate.
    _SSL_CTX = ssl._create_unverified_context()  # noqa: S323 — local development only
else:
    _SSL_CTX = ssl.create_default_context()


def resolve_static(url_path: str) -> Path | None:
    """Map a request path to an allowlisted file, or None."""
    path = urllib.parse.unquote(url_path.split("?", 1)[0].split("#", 1)[0])
    norm = posixpath.normpath(path)
    if norm in ("/", "."):
        norm = "/index.html"
    elif path.endswith("/") and norm.lstrip("/") in SUB_APPS:
        norm += "/index.html"
    rel = norm.lstrip("/")
    if not rel or ".." in rel.split("/") or any(part.startswith(".") for part in rel.split("/")):
        return None
    target = (ROOT / rel).resolve()
    try:
        target.relative_to(ROOT)
    except ValueError:
        return None
    if not target.is_file() or target.suffix.lower() not in STATIC_TYPES | {".json"}:
        return None
    if target.parent == ROOT and target.suffix.lower() == ".html":
        return target
    if target.parent == ROOT and target.name in ("favicon.ico", "favicon.svg", "favicon.png"):
        return target
    parts = target.relative_to(ROOT).parts
    if parts[0] in SUB_APPS:
        if len(parts) == 2 and target.suffix.lower() == ".html":
            return target
        if len(parts) > 2 and (parts[1] == "assets" or (parts[1] in SUB_APPS[parts[0]] and target.suffix == ".json")):
            return target
        return None
    if target.suffix.lower() == ".json":
        return None
    try:
        target.relative_to(ASSETS)
        return target
    except ValueError:
        return None


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "PivotDesk"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---- helpers -------------------------------------------------------
    def _plain(self, status: int, text: str, extra_headers: dict | None = None):
        body = (text + "\n").encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").strip().lower()
        if host in ALLOWED_HOSTS:
            return True
        self._plain(421, "Misdirected request")
        return False

    def _is_proxy(self) -> bool:
        return self.path.startswith(PROXY_PREFIX) or self._service() is not None

    def _service(self):
        for prefix, conf in SERVICE_PROXIES.items():
            if self.path.startswith(prefix):
                return conf
        return None

    # ---- verbs ---------------------------------------------------------
    def do_GET(self):
        if not self._host_ok():
            return
        if self._is_proxy():
            return self._proxy()
        return self._static()

    def do_HEAD(self):
        self.do_GET()

    def _write_only(self):
        if not self._host_ok():
            return
        if self._is_proxy():
            return self._proxy()
        self._plain(405, "Method not allowed", {"Allow": "GET, HEAD"})

    do_POST = _write_only
    do_PUT = _write_only
    do_DELETE = _write_only
    do_PATCH = _write_only

    def do_OPTIONS(self):
        if not self._host_ok():
            return
        self._plain(405, "Method not allowed", {"Allow": "GET, HEAD"})

    # ---- static --------------------------------------------------------
    def _static(self):
        target = resolve_static(self.path)
        if target is None:
            return self._plain(404, "Not found")
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ---- proxy ---------------------------------------------------------
    def _proxy(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._plain(400, "Bad request")
        if length < 0:
            return self._plain(400, "Bad request")
        if length > MAX_BODY:
            self.close_connection = True
            return self._plain(413, "Request body too large")
        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            return self._plain(411, "Length required")
        body = self.rfile.read(length) if length else None

        hop_by_hop = {
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
            "accept-encoding", "origin", "referer", "cookie",
        }
        headers = {k: v for k, v in self.headers.items() if k.lower() not in hop_by_hop}
        # Avoid gzip/br from Fineract — we strip Content-Encoding below, so force identity.
        headers["Accept-Encoding"] = "identity"

        service = self._service()
        if service is not None:
            base, strip, private = service
            if not base or any(self.path.startswith(p) for p in private):
                return self._plain(404 if base else 502, "Not found" if base else "Service URL not set")
            # Only the member gateway may present the alerts service key, never a browser.
            headers = {k: v for k, v in headers.items() if k.lower() != "x-alerts-service-key"}
            up = urllib.parse.urlsplit(base)
            conn_cls = http.client.HTTPSConnection if up.scheme == "https" else http.client.HTTPConnection
            conn = conn_cls(up.hostname, up.port, timeout=60)
            target = up.path.rstrip("/") + self.path[len(strip):]
        else:
            conn = http.client.HTTPSConnection(UPSTREAM_HOST, UPSTREAM_PORT, context=_SSL_CTX, timeout=120)
            target = self.path
        try:
            conn.request(self.command, target, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
        except Exception as exc:  # noqa: BLE001 — report any upstream failure as 502
            sys.stderr.write("[proxy] upstream for %s error: %r\n" % (self.path.split("?", 1)[0], exc))
            return self._plain(502, "Upstream unavailable")
        finally:
            conn.close()

        self.send_response(resp.status)
        skip = {"transfer-encoding", "connection", "content-encoding", "content-length", "keep-alive",
                "access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods",
                "access-control-allow-headers", "access-control-expose-headers", "set-cookie"}
        for k, v in resp.getheaders():
            if k.lower() not in skip:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)


def main():
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Pivot SACCO Desk (development) → http://127.0.0.1:%s/" % PORT)
    print("Proxy %s → https://%s:%s%s (TLS verify %s)" % (
        PROXY_PREFIX, UPSTREAM_HOST, UPSTREAM_PORT, PROXY_PREFIX,
        "off (local)" if UPSTREAM_HOST in LOCAL_UPSTREAMS else "on"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
