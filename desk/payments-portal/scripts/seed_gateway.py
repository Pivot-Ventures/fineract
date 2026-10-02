#!/usr/bin/env python3
"""Load the demo book into a payments gateway that is in mock mode.

Dry-run unless --apply is set. PAYMENTS_BASE_URL is required (there is no
default host). Before --apply the script reads {base}/payments/health and
aborts unless every reported mode (channel modes and fineract) is "mock",
and --confirm-host must repeat the base URL's hostname.

Uses the partner header X-Api-Key from PAYMENTS_API_KEY. Does not read or
send MTN, Airtel, bank, or card secrets, and does not send savingsAccountId
or loanId (no real member accounts are touched). The portal shows
fixtures/intents.json only with ?demo=1; it does not need this step.

    PAYMENTS_BASE_URL=https://mock-gateway.example \\
    python3 desk/payments-portal/scripts/seed_gateway.py

    PAYMENTS_BASE_URL=https://mock-gateway.example \\
    PAYMENTS_API_KEY='partner-key' \\
    python3 desk/payments-portal/scripts/seed_gateway.py --apply --confirm-host mock-gateway.example
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "intents.json"


def payload(row: dict) -> dict:
    # savingsAccountId / loanId are deliberately left out: the demo book must not post to member accounts.
    return {
        "channel": row["channel"],
        "direction": row["direction"],
        "product": row["product"],
        "amount": str(row["amount"]),
        "currency": "UGX",
        "externalReference": row.get("externalReference") or row["intentId"],
        "narration": "Phaneroo demo book",
    }


def collect_modes(health: dict) -> dict:
    """Every mode the gateway reports, flattened to {name: value}."""
    mode = health.get("mode")
    if isinstance(mode, str):
        return {"mode": mode}
    if not isinstance(mode, dict):
        return {}
    modes = {}
    for name, value in mode.items():
        if isinstance(value, dict):
            for inner, inner_value in value.items():
                modes[f"{name}.{inner}"] = inner_value
        else:
            modes[name] = value
    return modes


def check_mock(base: str) -> str | None:
    """Return an error message unless /payments/health says every mode is mock."""
    url = base + "/payments/health"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "application/json"}), timeout=15) as response:
            health = json.loads(response.read().decode())
    except (urllib.error.URLError, ValueError, OSError) as exc:
        return f"could not read {url}: {exc}"
    if not isinstance(health, dict):
        return f"{url} did not return a JSON object"
    modes = collect_modes(health)
    if not modes:
        return f"{url} reported no modes; refusing to seed"
    if "fineract" not in modes:
        return f"{url} did not report a fineract mode; refusing to seed"
    not_mock = {name: value for name, value in modes.items() if str(value).lower() != "mock"}
    if not_mock:
        detail = ", ".join(f"{name}={value}" for name, value in sorted(not_mock.items()))
        return f"gateway is not fully in mock mode ({detail}); refusing to seed"
    print("health modes: " + ", ".join(f"{name}={value}" for name, value in sorted(modes.items())))
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed gateway payment intents from the demo book (mock gateways only)")
    parser.add_argument("--apply", action="store_true", help="POST each intent. Default is a dry-run.")
    parser.add_argument("--confirm-host", default="", help="Required with --apply: must equal the PAYMENTS_BASE_URL hostname.")
    args = parser.parse_args()

    base = os.environ.get("PAYMENTS_BASE_URL", "").strip().rstrip("/")
    if not base:
        print("PAYMENTS_BASE_URL is required (no default host).", file=sys.stderr)
        return 2
    host = urllib.parse.urlparse(base).hostname or ""
    if not host:
        print(f"PAYMENTS_BASE_URL has no hostname: {base}", file=sys.stderr)
        return 2

    book = json.loads(FIXTURE.read_text(encoding="utf-8"))
    intents = book["intents"]
    print(f"{len(intents)} intents · {base} · every gateway mode must be mock")

    if not args.apply:
        print("dry-run. First initiate body:")
        print(json.dumps(payload(intents[0]), indent=2))
        print(f"Pass --apply --confirm-host {host} with PAYMENTS_API_KEY to POST /payments/v1/payments/initiate.")
        return 0

    if args.confirm_host.strip().lower() != host.lower():
        print(f"--confirm-host must equal the base URL host ({host}).", file=sys.stderr)
        return 2
    key = os.environ.get("PAYMENTS_API_KEY", "")
    if not key:
        print("PAYMENTS_API_KEY is required for --apply", file=sys.stderr)
        return 2
    problem = check_mock(base)
    if problem:
        print(problem, file=sys.stderr)
        return 2

    url = base + "/payments/v1/payments/initiate"
    ok = 0
    failures = []
    for row in intents:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload(row)).encode(),
            method="POST",
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "X-Api-Key": key,
                "Idempotency-Key": row["idempotencyKey"],
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode()
            try:
                body = json.loads(raw) if raw else {}
            except ValueError:
                body = {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:400]
            print(f"{row['intentId']} HTTP {exc.code} {detail}", file=sys.stderr)
            failures.append((row["intentId"], f"HTTP {exc.code}"))
            continue
        except (urllib.error.URLError, OSError) as exc:
            print(f"{row['intentId']} error {exc}", file=sys.stderr)
            failures.append((row["intentId"], str(exc)))
            continue
        ok += 1
        result = body.get("intentId") or body.get("status") if isinstance(body, dict) else None
        print(f"{row['intentId']} -> {result or 'accepted'}")

    print(f"seed finished: {ok} ok, {len(failures)} failed of {len(intents)}")
    if failures:
        for intent_id, reason in failures:
            print(f"  failed {intent_id}: {reason}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
