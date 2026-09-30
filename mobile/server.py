#!/usr/bin/env python3
"""Pivosacc Mobile — static member UI + Fineract reverse proxy.

Serves mobile/ on :5174 and proxies /fineract-provider → https://localhost:8443
(same pattern as desk/ui-mockups server.py).

Usage:
  cd ~/Projects/sacco/fineract/mobile
  python3 server.py
  # open http://127.0.0.1:5174/
"""
from __future__ import annotations

import os
os.environ.setdefault("PYTHONUNBUFFERED", "1")

import http.client
import http.server
import ssl
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "5174"))
UPSTREAM_HOST = os.environ.get("FINERACT_HOST", "localhost")
UPSTREAM_PORT = int(os.environ.get("FINERACT_PORT", "8443"))
PROXY_PREFIX = "/fineract-provider"

_SSL_CTX = ssl._create_unverified_context()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def do_OPTIONS(self):
        if self.path.startswith(PROXY_PREFIX):
            self.send_response(204)
            self._cors()
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy()
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy()
        return super().do_HEAD()

    def do_POST(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy()
        self.send_error(405)

    def do_PUT(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy()
        self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy()
        self.send_error(405)

    def do_PATCH(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy()
        self.send_error(405)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, Fineract-Platform-TenantId, "
            "fineract-platform-tenantid, X-Fineract-Platform-TenantId",
        )
        self.send_header("Access-Control-Expose-Headers", "*")

    def _proxy(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        parsed = urllib.parse.urlparse(self.path)
        target_path = parsed.path
        if parsed.query:
            target_path = target_path + "?" + parsed.query

        conn = http.client.HTTPSConnection(
            UPSTREAM_HOST, UPSTREAM_PORT, context=_SSL_CTX, timeout=120
        )
        hop_by_hop = {
            "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
            "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
            "accept-encoding",
        }
        headers = {}
        for k, v in self.headers.items():
            if k.lower() not in hop_by_hop:
                headers[k] = v
        # Avoid gzip/br from Fineract — we strip Content-Encoding below, so force identity.
        headers["Accept-Encoding"] = "identity"
        try:
            conn.request(self.command, target_path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            self._cors()
            skip = {"transfer-encoding", "connection", "content-encoding", "content-length"}
            for k, v in resp.getheaders():
                if k.lower() not in skip:
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        except Exception as exc:
            msg = ("Fineract proxy error: %s. Is https://%s:%s up?\n" %
                   (exc, UPSTREAM_HOST, UPSTREAM_PORT)).encode()
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
        finally:
            conn.close()


def main():
    http.server.HTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Pivosacc Mobile → http://127.0.0.1:%s/" % PORT)
    print("Proxy %s → https://%s:%s%s" % (PROXY_PREFIX, UPSTREAM_HOST, UPSTREAM_PORT, PROXY_PREFIX))
    print("Root: %s" % ROOT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
