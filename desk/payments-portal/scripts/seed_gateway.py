#!/usr/bin/env python3
"""Load the demo book into a payments gateway that is already in mock mode.

Dry-run unless --apply is set. Uses the partner header X-Api-Key from
PAYMENTS_API_KEY. Does not read or send MTN, Airtel, bank, or card secrets.
The portal shows fixtures/intents.json without this step.

    python3 desk/payments-portal/scripts/seed_gateway.py
    PAYMENTS_BASE_URL=https://sacco.pivotventures.tech \\
    PAYMENTS_API_KEY='partner-key' \\
    python3 desk/payments-portal/scripts/seed_gateway.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "intents.json"


def payload(row: dict) -> dict:
    body = {
        "channel": row["channel"],
        "direction": row["direction"],
        "product": row["product"],
        "amount": str(row["amount"]),
        "currency": "UGX",
        "externalReference": row.get("externalReference") or row["intentId"],
        "narration": "Phaneroo demo book",
    }
    if row.get("savingsAccountId") is not None:
        body["savingsAccountId"] = row["savingsAccountId"]
    if row.get("loanId") is not None:
        body["loanId"] = row["loanId"]
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed gateway payment intents from the demo book")
    parser.add_argument("--apply", action="store_true", help="POST each intent. Default is a dry-run.")
    args = parser.parse_args()
    book = json.loads(FIXTURE.read_text(encoding="utf-8"))
    intents = book["intents"]
    base = os.environ.get("PAYMENTS_BASE_URL", "https://sacco.pivotventures.tech").rstrip("/")
    key = os.environ.get("PAYMENTS_API_KEY", "")
    print(f"{len(intents)} intents · {base} · channel mode expected mock")
    if not args.apply:
        sample = payload(intents[0])
        print("dry-run. First initiate body:")
        print(json.dumps(sample, indent=2))
        print("Pass --apply with PAYMENTS_API_KEY to POST /payments/v1/payments/initiate.")
        return 0
    if not key:
        print("PAYMENTS_API_KEY is required for --apply", file=sys.stderr)
        return 2
    url = base + "/payments/v1/payments/initiate"
    for row in intents:
        data = json.dumps(payload(row)).encode()
        request = urllib.request.Request(
            url,
            data=data,
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
                body = json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:400]
            print(f"{row['intentId']} HTTP {exc.code} {detail}", file=sys.stderr)
            return 1
        print(f"{row['intentId']} -> {body.get('intentId') or body.get('status')}")
    print("seed finished")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
