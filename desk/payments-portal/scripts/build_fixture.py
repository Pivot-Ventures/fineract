#!/usr/bin/env python3
"""Build the payments portal demo book: 100 UGX intents.

The portal reads fixtures/intents.json when the gateway book is empty or
no internal key is stored. This does not call MTN, Airtel, or Fineract.

    python3 desk/payments-portal/scripts/build_fixture.py
    python3 desk/payments-portal/scripts/build_fixture.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ANCHOR = datetime(2026, 10, 2, 15, 30, tzinfo=timezone.utc)
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "intents.json"
DEMO_TAG = "demo-not-a-channel-secret"

MEMBERS = [
    "Nakato Grace",
    "Okello Daniel",
    "Namugga Sarah",
    "Kato Brian",
    "Achieng Mercy",
    "Mugisha Peter",
    "Nalwoga Joan",
    "Wasswa Isaac",
    "Namutebi Ruth",
    "Ssemakula David",
    "Akello Patricia",
    "Byaruhanga Moses",
    "Nabirye Esther",
    "Tumwesigye Paul",
    "Nansubuga Linda",
    "Ochen Samuel",
    "Babirye Diana",
    "Kiggundu Mark",
    "Atim Florence",
    "Lubega Joseph",
]

AMOUNTS = [
    "5000",
    "10000",
    "20000",
    "25000",
    "50000",
    "75000",
    "100000",
    "150000",
    "200000",
    "250000",
    "400000",
    "500000",
    "750000",
    "1000000",
    "1500000",
    "2000000",
]

STATUSES = (
    ["POSTED"] * 62
    + ["INITIATED"] * 8
    + ["AWAITING_PROVIDER"] * 8
    + ["POSTING_CORE"] * 6
    + ["PROVIDER_DECLINED"] * 6
    + ["CORE_REJECTED"] * 5
    + ["AMBIGUOUS"] * 5
)

CHANNELS = ["MTN_MOMO"] * 30 + ["AIRTEL_MONEY"] * 28 + ["BANK"] * 22 + ["CARD"] * 20
PREFIXES = ["25677", "25678", "25670", "25675", "25674", "25676"]


def decorate(status: str) -> tuple[str, str, str | None]:
    if status == "POSTED":
        return "SUCCESSFUL", "POSTED", None
    if status == "INITIATED":
        return "NONE", "NOT_POSTED", None
    if status == "AWAITING_PROVIDER":
        return "PENDING", "NOT_POSTED", None
    if status == "POSTING_CORE":
        return "SUCCESSFUL", "POSTING", None
    if status == "PROVIDER_DECLINED":
        return "FAILED", "NOT_POSTED", "PROVIDER_DECLINED"
    if status == "CORE_REJECTED":
        return "SUCCESSFUL", "REJECTED", "CORE_REJECTED"
    if status == "AMBIGUOUS":
        return "SUCCESSFUL", "AMBIGUOUS", "POSTING_TIMEOUT"
    raise ValueError(status)


def build_book() -> dict:
    if len(STATUSES) != 100 or len(CHANNELS) != 100:
        raise RuntimeError("status and channel plans must be 100")
    rng = random.Random(20261002)
    statuses = STATUSES[:]
    channels = CHANNELS[:]
    rng.shuffle(statuses)
    rng.shuffle(channels)
    drafts = []
    for index in range(100):
        status = statuses[index]
        channel = channels[index]
        provider_status, core_status, failure = decorate(status)
        disburse = rng.random() < 0.34
        if disburse:
            direction = "DEBIT"
            product = "SAVINGS_WITHDRAWAL"
            loan_id = None
        else:
            direction = "CREDIT"
            product = "LOAN_REPAYMENT" if rng.random() < 0.35 else "SAVINGS_DEPOSIT"
            loan_id = 2000 + (index % 25) if product == "LOAN_REPAYMENT" else None
        created = ANCHOR - timedelta(
            days=rng.randint(0, 40),
            hours=rng.randint(0, 14),
            minutes=rng.randint(0, 59),
        )
        updated = created + timedelta(minutes=rng.randint(1, 40))
        past_init = status != "INITIATED"
        webhook = status not in ("INITIATED", "AWAITING_PROVIDER")
        event_id = f"evt_{index + 1:04d}"
        digest = hashlib.sha256(f"{DEMO_TAG}|{event_id}".encode()).hexdigest()[:32]
        member = MEMBERS[index % len(MEMBERS)]
        drafts.append(
            {
                "created": created,
                "row": {
                    "status": status,
                    "coreStatus": core_status,
                    "providerStatus": provider_status,
                    "channel": channel,
                    "direction": direction,
                    "product": product,
                    "amount": rng.choice(AMOUNTS),
                    "currency": "UGX",
                    "savingsAccountId": 1000 + (index % 40),
                    "loanId": loan_id,
                    "msisdn": PREFIXES[index % len(PREFIXES)] + "***" + f"{rng.randint(0, 9999):04d}",
                    "memberName": member,
                    "externalReference": f"KLA-{1400 + index}",
                    "providerReference": f"{channel.lower()}-{index + 1:04d}" if past_init else None,
                    "providerTransactionId": f"TXN{880000 + index}" if past_init else None,
                    "fineractTransactionId": str(770000 + index) if status == "POSTED" else None,
                    "reversalIntentId": None,
                    "idempotencyKey": f"idem-phn-{index + 1:04d}",
                    "failureCode": failure,
                    "createdAt": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "updatedAt": updated.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "webhookEventId": event_id if webhook else None,
                    "hmacRef": f"v1={digest}" if webhook else None,
                },
            }
        )
    drafts.sort(key=lambda item: item["created"], reverse=True)
    intents = []
    for order, item in enumerate(drafts, start=1):
        row = item["row"]
        row["intentId"] = f"pi_{order:04d}"
        intents.append(row)
    return {
        "book": "phaneroo-payments-demo",
        "currency": "UGX",
        "count": len(intents),
        "anchor": "2026-10-02",
        "channelMode": "mock",
        "note": "Demo fixture for the payments portal. Masked MSISDNs only. HMAC refs are not channel secrets.",
        "intents": intents,
    }


def problems(book: dict) -> list[str]:
    issues = []
    intents = book.get("intents") or []
    if book.get("count") != 100 or len(intents) != 100:
        issues.append(f"expected 100 intents, found {len(intents)}")
    channels = {row["channel"] for row in intents}
    directions = {row["direction"] for row in intents}
    statuses = {row["status"] for row in intents}
    for required in ("MTN_MOMO", "AIRTEL_MONEY", "BANK", "CARD"):
        if required not in channels:
            issues.append("missing channel " + required)
    if "CREDIT" not in directions or "DEBIT" not in directions:
        issues.append("need both collect (CREDIT) and disburse (DEBIT)")
    for required in ("POSTED", "INITIATED", "AWAITING_PROVIDER", "PROVIDER_DECLINED", "CORE_REJECTED", "AMBIGUOUS"):
        if required not in statuses:
            issues.append("missing status " + required)
    posted = sum(1 for row in intents if row["status"] == "POSTED")
    pending = sum(1 for row in intents if row["status"] in ("INITIATED", "AWAITING_PROVIDER", "POSTING_CORE"))
    failed = sum(1 for row in intents if row["status"] in ("PROVIDER_DECLINED", "CORE_REJECTED", "AMBIGUOUS"))
    if posted < 50 or pending < 15 or failed < 10:
        issues.append(f"mix too thin posted={posted} pending={pending} failed={failed}")
    for row in intents:
        if row.get("currency") != "UGX":
            issues.append(row["intentId"] + " currency")
        amount = str(row.get("amount") or "")
        if not amount.isdigit() or amount.startswith("0"):
            issues.append(row["intentId"] + " amount must be whole shillings")
        msisdn = str(row.get("msisdn") or "")
        if "***" not in msisdn or len(msisdn) < 10:
            issues.append(row["intentId"] + " msisdn must be masked")
        if row["status"] == "POSTED" and not row.get("fineractTransactionId"):
            issues.append(row["intentId"] + " posted without fineract id")
        if row["status"] not in ("INITIATED", "AWAITING_PROVIDER") and not str(row.get("hmacRef") or "").startswith("v1="):
            issues.append(row["intentId"] + " missing mock hmac ref")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Write or check the payments demo book")
    parser.add_argument("--check", action="store_true", help="Validate the committed fixture and fail if it drifts")
    args = parser.parse_args()
    book = build_book()
    encoded = json.dumps(book, indent=2) + "\n"
    if args.check:
        if not FIXTURE.is_file():
            print("missing " + str(FIXTURE), file=sys.stderr)
            return 1
        current = FIXTURE.read_text(encoding="utf-8")
        if current != encoded:
            print("fixture drifted from build_fixture.py — re-run without --check", file=sys.stderr)
            return 1
        issues = problems(json.loads(current))
        if issues:
            print("\n".join(issues), file=sys.stderr)
            return 1
        print("ok 100 intents")
        return 0
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(encoded, encoding="utf-8")
    issues = problems(book)
    if issues:
        print("\n".join(issues), file=sys.stderr)
        return 1
    print(f"wrote {FIXTURE} ({book['count']} intents)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
