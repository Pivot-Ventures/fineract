#!/usr/bin/env python3
"""
Idempotent Apache Fineract starter seed for Pivot SACCO Desk (UGX).
Safe to re-run: skips creates when a matching name/code already exists.
Does NOT wipe volumes or touch docker-compose.

Usage:
  export PATH="$HOME/.docker/bin:$PATH"
  python3 desk/scripts/seed-fineract.py

Env overrides:
  FINERACT_BASE  (default https://localhost:8443/fineract-provider/api/v1)
  FINERACT_USER / FINERACT_PASS / FINERACT_TENANT
"""
from __future__ import annotations

import base64
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from typing import Any, Optional

BASE = os.environ.get(
    "FINERACT_BASE", "https://localhost:8443/fineract-provider/api/v1"
).rstrip("/")
USER = os.environ.get("FINERACT_USER", "mifos")
PASS = os.environ.get("FINERACT_PASS", "password")
TENANT = os.environ.get("FINERACT_TENANT", "default")
DATE_FMT = "dd MMMM yyyy"
LOCALE = "en"
# HO opened 2009; use a joining/opening date after that
JOIN_DATE = "01 January 2020"
TODAY = "30 September 2026"
CASHIER_END = "31 December 2027"

CTX = ssl._create_unverified_context()
LOG: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)
    LOG.append(msg)


def req(
    method: str,
    path: str,
    body: Optional[dict] = None,
    auth: Optional[str] = None,
) -> tuple[int, Any]:
    url = path if path.startswith("http") else f"{BASE}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {
        "Fineract-Platform-TenantId": TENANT,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if auth:
        headers["Authorization"] = f"Basic {auth}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, context=CTX, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {"message": str(e)}
        except json.JSONDecodeError:
            parsed = {"raw": raw[:800], "message": str(e)}
        return e.code, parsed


def resource_id(resp: Any) -> Optional[int]:
    if not isinstance(resp, dict):
        return None
    for k in ("resourceId", "officeId", "clientId", "savingsId", "loanId", "staffId"):
        if resp.get(k) is not None:
            return int(resp[k])
    changes = resp.get("changes") or {}
    if isinstance(changes, dict) and changes.get("resourceId") is not None:
        return int(changes["resourceId"])
    return None


def find_by_name(items: list, name: str, key: str = "name") -> Optional[dict]:
    name_l = name.strip().lower()
    for it in items or []:
        if str(it.get(key, "")).strip().lower() == name_l:
            return it
    return None


def find_gl_by_code(items: list, code: str) -> Optional[dict]:
    for it in items or []:
        if str(it.get("glCode", "")).strip() == code:
            return it
    return None


def main() -> int:
    log(f"== Fineract seed against {BASE} ==")

    # --- Auth ---
    code, auth_body = req(
        "POST",
        "/authentication",
        {"username": USER, "password": PASS},
    )
    if code != 200 or not isinstance(auth_body, dict):
        log(f"AUTH FAILED http={code} body={auth_body}")
        return 1
    key = auth_body.get("base64EncodedAuthenticationKey")
    if not key:
        # fallback classic basic
        key = base64.b64encode(f"{USER}:{PASS}".encode()).decode()
    log(f"AUTH ok userId={auth_body.get('userId')} office={auth_body.get('officeName')}")

    created: dict[str, Any] = {}

    # --- Currencies: keep USD, add UGX ---
    code, cur = req("GET", "/currencies", auth=key)
    selected = [
        c["code"]
        for c in (cur or {}).get("selectedCurrencyOptions", [])
    ]
    if "UGX" not in selected:
        new_list = sorted(set(selected + ["UGX", "USD"]))
        c2, r2 = req("PUT", "/currencies", {"currencies": new_list}, auth=key)
        log(f"CURRENCY put UGX+USD http={c2} resp={r2} selected_was={selected}")
        created["currencies"] = new_list
    else:
        log(f"CURRENCY skip UGX already selected={selected}")
        created["currencies"] = selected

    # --- Office: Kampala Main under HO ---
    code, offices = req("GET", "/offices", auth=key)
    offices = offices or []
    ho = find_by_name(offices, "Head Office") or {"id": 1, "name": "Head Office"}
    kampala = find_by_name(offices, "Kampala Main")
    if kampala:
        log(f"OFFICE skip Kampala Main id={kampala['id']}")
        office_id = kampala["id"]
    else:
        c2, r2 = req(
            "POST",
            "/offices",
            {
                "name": "Kampala Main",
                "parentId": ho["id"],
                "openingDate": JOIN_DATE,
                "dateFormat": DATE_FMT,
                "locale": LOCALE,
                "externalId": "KLA-MAIN",
            },
            auth=key,
        )
        office_id = resource_id(r2) or (r2.get("resourceId") if isinstance(r2, dict) else None)
        log(f"OFFICE create Kampala Main http={c2} id={office_id} resp={r2}")
        if not office_id:
            office_id = ho["id"]
            log("OFFICE fallback to Head Office")
    created["officeId"] = office_id
    created["headOfficeId"] = ho["id"]

    # Prefer creating staff/products at Head Office (client Nakato is there);
    # teller can sit at Kampala Main or HO. Use HO for staff + products; Kampala for teller.
    work_office = ho["id"]

    # --- Chart of accounts (DETAIL leaf accounts) ---
    # type: 1 ASSET, 2 LIABILITY, 3 EQUITY, 4 INCOME, 5 EXPENSE; usage 1 DETAIL
    gl_defs = [
        ("1110", "Cash on Hand", 1),
        ("1120", "Cash at Bank - UGX", 1),
        ("1130", "Loans Portfolio", 1),
        ("1140", "Interest Receivable", 1),
        ("2110", "Savings Deposits Control", 2),
        ("2120", "Suspense / Clearing", 2),
        ("3110", "Opening Balances Contra", 3),
        ("3120", "Retained Earnings", 3),
        ("4110", "Interest Income on Loans", 4),
        ("4120", "Fee Income", 4),
        ("4130", "Income from Penalties", 4),
        ("5110", "Interest Expense on Savings", 5),
        ("5120", "Operating Expenses", 5),
        ("5130", "Loan Write-Off Expense", 5),
        ("5140", "Credit Losses / Bad Debt", 5),
    ]
    code, gls = req("GET", "/glaccounts", auth=key)
    gls = gls or []
    gl_ids: dict[str, int] = {}
    for gl_code, name, typ in gl_defs:
        existing = find_gl_by_code(gls, gl_code) or find_by_name(gls, name)
        if existing:
            gl_ids[gl_code] = existing["id"]
            log(f"GL skip {gl_code} {name} id={existing['id']}")
            continue
        c2, r2 = req(
            "POST",
            "/glaccounts",
            {
                "name": name,
                "glCode": gl_code,
                "manualEntriesAllowed": True,
                "type": typ,
                "usage": 1,
                "description": f"Pivot SACCO seed: {name}",
            },
            auth=key,
        )
        rid = resource_id(r2)
        if rid:
            gl_ids[gl_code] = rid
            gls.append({"id": rid, "glCode": gl_code, "name": name})
        log(f"GL create {gl_code} {name} http={c2} id={rid} err={'' if rid else r2}")
    created["glAccounts"] = gl_ids

    # Refresh GLs
    code, gls = req("GET", "/glaccounts", auth=key)
    gls = gls or []
    for g in gls:
        gl_ids.setdefault(g.get("glCode"), g["id"])

    # --- Financial activity mappings (tellers / transfers) ---
    # 100 assetTransfer, 200 liabilityTransfer, 101 cashAtMainVault,
    # 102 cashAtTeller, 300 openingBalancesTransferContra, 103 fundSource
    fam_defs = [
        (101, "1110"),  # cashAtMainVault -> Cash on Hand
        (102, "1110"),  # cashAtTeller -> Cash on Hand
        (103, "1120"),  # fundSource -> Cash at Bank
        (100, "1120"),  # assetTransfer
        (200, "2120"),  # liabilityTransfer
        (300, "3110"),  # openingBalancesTransferContra
    ]
    code, fams = req("GET", "/financialactivityaccounts", auth=key)
    fams = fams if isinstance(fams, list) else []
    existing_acts = {f.get("financialActivityData", {}).get("id") for f in fams}
    # alternate shape
    for f in fams:
        if "financialActivity" in f and isinstance(f["financialActivity"], dict):
            existing_acts.add(f["financialActivity"].get("id"))
        if f.get("financialActivityId"):
            existing_acts.add(f["financialActivityId"])

    for act_id, gl_code in fam_defs:
        if act_id in existing_acts:
            log(f"FAM skip activity={act_id}")
            continue
        gl_id = gl_ids.get(gl_code)
        if not gl_id:
            log(f"FAM skip activity={act_id} missing GL {gl_code}")
            continue
        c2, r2 = req(
            "POST",
            "/financialactivityaccounts",
            {"financialActivityId": act_id, "glAccountId": gl_id},
            auth=key,
        )
        log(f"FAM create activity={act_id} gl={gl_code}/{gl_id} http={c2} resp={r2}")
    created["financialActivityMappings"] = fam_defs

    # --- Payment type: Cash (for teller) ---
    code, pts = req("GET", "/paymenttypes", auth=key)
    pts = pts or []
    cash_pt = find_by_name(pts, "Cash")
    if cash_pt:
        cash_pt_id = cash_pt["id"]
        log(f"PAYMENTTYPE skip Cash id={cash_pt_id}")
    else:
        c2, r2 = req(
            "POST",
            "/paymenttypes",
            {
                "name": "Cash",
                "description": "Cash over the counter",
                "isCashPayment": True,
                "position": 0,
            },
            auth=key,
        )
        cash_pt_id = resource_id(r2)
        log(f"PAYMENTTYPE create Cash http={c2} id={cash_pt_id} resp={r2}")
    created["cashPaymentTypeId"] = cash_pt_id

    # --- Staff: loan officer + cashier ---
    code, staff_list = req("GET", "/staff", auth=key)
    staff_list = staff_list if isinstance(staff_list, list) else []

    def ensure_staff(firstname: str, lastname: str, is_loan_officer: bool) -> Optional[int]:
        display = f"{firstname} {lastname}"
        # match by lastname+firstname
        for s in staff_list:
            if (
                str(s.get("firstname", "")).lower() == firstname.lower()
                and str(s.get("lastname", "")).lower() == lastname.lower()
            ):
                log(f"STAFF skip {display} id={s['id']}")
                return s["id"]
        body = {
            "officeId": work_office,
            "firstname": firstname,
            "lastname": lastname,
            "isLoanOfficer": is_loan_officer,
            "joiningDate": JOIN_DATE,
            "dateFormat": DATE_FMT,
            "locale": LOCALE,
            "mobileNo": "+256700000001" if is_loan_officer else "+256700000002",
        }
        c2, r2 = req("POST", "/staff", body, auth=key)
        rid = resource_id(r2)
        if rid:
            staff_list.append(
                {"id": rid, "firstname": firstname, "lastname": lastname}
            )
        log(f"STAFF create {display} http={c2} id={rid} resp={'' if rid else r2}")
        return rid

    lo_id = ensure_staff("Amina", "LoanOfficer", True)
    cashier_id = ensure_staff("Joseph", "Cashier", False)
    created["loanOfficerStaffId"] = lo_id
    created["cashierStaffId"] = cashier_id

    # Extra cashier at Kampala Main (office_id) for local teller coverage
    def ensure_staff_at(office, firstname, lastname, is_loan_officer):
        for s in staff_list:
            if (
                str(s.get("firstname", "")).lower() == firstname.lower()
                and str(s.get("lastname", "")).lower() == lastname.lower()
                and int(s.get("officeId", work_office)) == int(office)
            ):
                log(f"STAFF skip {firstname} {lastname} @office={office} id={s['id']}")
                return s["id"]
        # also match by name alone if already exists elsewhere
        for s in staff_list:
            if (
                str(s.get("firstname", "")).lower() == firstname.lower()
                and str(s.get("lastname", "")).lower() == lastname.lower()
            ):
                log(f"STAFF skip {firstname} {lastname} exists id={s['id']} office={s.get('officeId')}")
                return s["id"]
        c2, r2 = req(
            "POST",
            "/staff",
            {
                "officeId": office,
                "firstname": firstname,
                "lastname": lastname,
                "isLoanOfficer": is_loan_officer,
                "joiningDate": JOIN_DATE,
                "dateFormat": DATE_FMT,
                "locale": LOCALE,
                "mobileNo": "+256700000003",
            },
            auth=key,
        )
        rid = resource_id(r2)
        if rid:
            staff_list.append(
                {
                    "id": rid,
                    "firstname": firstname,
                    "lastname": lastname,
                    "officeId": office,
                }
            )
        log(f"STAFF create {firstname} {lastname} @office={office} http={c2} id={rid}")
        return rid

    kampala_cashier_id = ensure_staff_at(office_id, "Mary", "Teller", False)
    created["kampalaCashierStaffId"] = kampala_cashier_id

    # --- Charge: simple loan disbursement fee ---
    code, charges = req("GET", "/charges", auth=key)
    charges = charges or []
    fee = find_by_name(charges, "Loan Processing Fee")
    if fee:
        charge_id = fee["id"]
        log(f"CHARGE skip Loan Processing Fee id={charge_id}")
    else:
        c2, r2 = req(
            "POST",
            "/charges",
            {
                "name": "Loan Processing Fee",
                "chargeAppliesTo": 1,  # Loan
                "currencyCode": "UGX",
                "amount": 10000,
                "chargeTimeType": 1,  # Disbursement
                "chargeCalculationType": 1,  # Flat
                "chargePaymentMode": 0,  # Regular
                "active": True,
                "penalty": False,
                "locale": LOCALE,
            },
            auth=key,
        )
        charge_id = resource_id(r2)
        log(f"CHARGE create Loan Processing Fee http={c2} id={charge_id} resp={'' if charge_id else r2}")
    created["chargeId"] = charge_id

    # --- Loan product: declining balance SACCO loan (cash accounting) ---
    code, lps = req("GET", "/loanproducts", auth=key)
    lps = lps or []
    lp = find_by_name(lps, "SACCO Declining Loan")
    if lp:
        loan_product_id = lp["id"]
        log(f"LOANPRODUCT skip SACCO Declining Loan id={loan_product_id}")
    else:
        body = {
            "name": "SACCO Declining Loan",
            "shortName": "SDL",
            "currencyCode": "UGX",
            "digitsAfterDecimal": 0,
            "inMultiplesOf": 1000,
            "principal": 1000000,
            "minPrincipal": 100000,
            "maxPrincipal": 50000000,
            "numberOfRepayments": 12,
            "minNumberOfRepayments": 3,
            "maxNumberOfRepayments": 36,
            "repaymentEvery": 1,
            "repaymentFrequencyType": 2,  # Months
            "interestRatePerPeriod": 2.0,
            "minInterestRatePerPeriod": 0.5,
            "maxInterestRatePerPeriod": 5.0,
            "interestRateFrequencyType": 2,  # Per month
            "amortizationType": 1,  # Equal installments
            "interestType": 0,  # Declining balance
            "interestCalculationPeriodType": 1,  # Same as repayment
            "transactionProcessingStrategyCode": "mifos-standard-strategy",
            "accountingRule": 2,  # Cash based
            "fundSourceAccountId": gl_ids.get("1120"),
            "loanPortfolioAccountId": gl_ids.get("1130"),
            "transfersInSuspenseAccountId": gl_ids.get("2120"),
            "interestOnLoanAccountId": gl_ids.get("4110"),
            "incomeFromFeeAccountId": gl_ids.get("4120"),
            "incomeFromPenaltyAccountId": gl_ids.get("4130"),
            "writeOffAccountId": gl_ids.get("5130"),
            "overpaymentLiabilityAccountId": gl_ids.get("2120"),
            "incomeFromRecoveryAccountId": gl_ids.get("4120"),
            "daysInMonthType": 1,
            "daysInYearType": 365,
            "isInterestRecalculationEnabled": False,
            "includeInBorrowerCycle": True,
            "useBorrowerCycle": False,
            "locale": LOCALE,
        }
        if charge_id:
            body["charges"] = [{"id": charge_id}]
        c2, r2 = req("POST", "/loanproducts", body, auth=key)
        loan_product_id = resource_id(r2)
        log(
            f"LOANPRODUCT create SACCO Declining Loan http={c2} id={loan_product_id} "
            f"resp={'' if loan_product_id else json.dumps(r2)[:600]}"
        )
        # If cash accounting failed, retry with NONE
        if not loan_product_id and c2 >= 400:
            body_none = {
                k: v
                for k, v in body.items()
                if k
                not in {
                    "fundSourceAccountId",
                    "loanPortfolioAccountId",
                    "transfersInSuspenseAccountId",
                    "interestOnLoanAccountId",
                    "incomeFromFeeAccountId",
                    "incomeFromPenaltyAccountId",
                    "writeOffAccountId",
                    "overpaymentLiabilityAccountId",
                    "charges",
                }
            }
            body_none["accountingRule"] = 1
            c3, r3 = req("POST", "/loanproducts", body_none, auth=key)
            loan_product_id = resource_id(r3)
            log(
                f"LOANPRODUCT retry NONE accounting http={c3} id={loan_product_id} "
                f"resp={'' if loan_product_id else json.dumps(r3)[:600]}"
            )
    created["loanProductId"] = loan_product_id

    # --- Savings product: voluntary savings ---
    code, sps = req("GET", "/savingsproducts", auth=key)
    sps = sps or []
    sp = find_by_name(sps, "Voluntary Savings")
    if sp:
        savings_product_id = sp["id"]
        log(f"SAVINGSPRODUCT skip Voluntary Savings id={savings_product_id}")
    else:
        body = {
            "name": "Voluntary Savings",
            "shortName": "VS",
            "description": "Pivot SACCO voluntary savings (UGX)",
            "currencyCode": "UGX",
            "digitsAfterDecimal": 0,
            "inMultiplesOf": 100,
            "nominalAnnualInterestRate": 3.0,
            "interestCompoundingPeriodType": 4,  # Monthly
            "interestPostingPeriodType": 4,  # Monthly
            "interestCalculationType": 1,  # Daily balance
            "interestCalculationDaysInYearType": 365,
            "withdrawalFeeForTransfers": False,
            "allowOverdraft": False,
            "enforceMinRequiredBalance": False,
            "minRequiredOpeningBalance": 10000,
            "accountingRule": 2,  # Cash
            "savingsReferenceAccountId": gl_ids.get("2110"),
            "savingsControlAccountId": gl_ids.get("2110"),
            "interestOnSavingsAccountId": gl_ids.get("5110"),
            "incomeFromFeeAccountId": gl_ids.get("4120"),
            "incomeFromPenaltyAccountId": gl_ids.get("4130"),
            "transfersInSuspenseAccountId": gl_ids.get("2120"),
            "overdraftPortfolioControlId": gl_ids.get("2110"),
            "lossesWrittenOffAccountId": gl_ids.get("5140"),
            "incomeFromInterestAccountId": gl_ids.get("4120"),
            "locale": LOCALE,
        }
        # Cash savings: reference = asset (cash/bank), control = liability deposits
        body["savingsReferenceAccountId"] = gl_ids.get("1120")  # Cash at Bank asset
        body["savingsControlAccountId"] = gl_ids.get("2110")
        c2, r2 = req("POST", "/savingsproducts", body, auth=key)
        savings_product_id = resource_id(r2)
        log(
            f"SAVINGSPRODUCT create Voluntary Savings http={c2} id={savings_product_id} "
            f"resp={'' if savings_product_id else json.dumps(r2)[:600]}"
        )
        if not savings_product_id and c2 >= 400:
            body_none = {
                "name": "Voluntary Savings",
                "shortName": "VS",
                "description": "Pivot SACCO voluntary savings (UGX)",
                "currencyCode": "UGX",
                "digitsAfterDecimal": 0,
                "inMultiplesOf": 100,
                "nominalAnnualInterestRate": 3.0,
                "interestCompoundingPeriodType": 4,
                "interestPostingPeriodType": 4,
                "interestCalculationType": 1,
                "interestCalculationDaysInYearType": 365,
                "withdrawalFeeForTransfers": False,
                "accountingRule": 1,
                "locale": LOCALE,
            }
            c3, r3 = req("POST", "/savingsproducts", body_none, auth=key)
            savings_product_id = resource_id(r3)
            log(
                f"SAVINGSPRODUCT retry NONE http={c3} id={savings_product_id} "
                f"resp={'' if savings_product_id else json.dumps(r3)[:600]}"
            )
    created["savingsProductId"] = savings_product_id

    # --- Teller + cashier assignment + float ---
    code, tellers = req("GET", "/tellers", auth=key)
    tellers = tellers if isinstance(tellers, list) else []
    teller = find_by_name(tellers, "Kampala Main Teller")
    if teller:
        teller_id = teller["id"]
        log(f"TELLER skip Kampala Main Teller id={teller_id}")
    else:
        c2, r2 = req(
            "POST",
            "/tellers",
            {
                "name": "Kampala Main Teller",
                "officeId": office_id,
                "description": "Main counter teller",
                "status": 300,
                "startDate": JOIN_DATE,
                "dateFormat": DATE_FMT,
                "locale": LOCALE,
            },
            auth=key,
        )
        teller_id = resource_id(r2)
        log(f"TELLER create http={c2} id={teller_id} resp={'' if teller_id else r2}")
        # If Kampala office fails for teller (staff elsewhere), retry at HO
        if not teller_id:
            c3, r3 = req(
                "POST",
                "/tellers",
                {
                    "name": "Kampala Main Teller",
                    "officeId": work_office,
                    "description": "Main counter teller",
                    "status": 300,
                    "startDate": JOIN_DATE,
                    "dateFormat": DATE_FMT,
                    "locale": LOCALE,
                },
                auth=key,
            )
            teller_id = resource_id(r3)
            log(f"TELLER retry at HO http={c3} id={teller_id} resp={'' if teller_id else r3}")
    created["tellerId"] = teller_id

    cashier_txn_id = None
    if teller_id and cashier_id:
        c2, cashiers = req("GET", f"/tellers/{teller_id}/cashiers", auth=key)
        cashier_items = []
        if isinstance(cashiers, dict):
            cashier_items = cashiers.get("cashiers") or cashiers.get("pageItems") or []
        elif isinstance(cashiers, list):
            cashier_items = cashiers
        existing_c = None
        for c in cashier_items:
            if c.get("staffId") == cashier_id or str(c.get("staffName", "")).endswith(
                "Cashier"
            ):
                existing_c = c
                break
        if existing_c:
            cas_id = existing_c.get("id") or existing_c.get("cashierId")
            log(f"CASHIER skip staff={cashier_id} id={cas_id}")
        else:
            c2, r2 = req(
                "POST",
                f"/tellers/{teller_id}/cashiers",
                {
                    "staffId": cashier_id,
                    "description": "Day cashier",
                    "startDate": TODAY,
                    "endDate": CASHIER_END,
                    "isFullDay": True,
                    "dateFormat": DATE_FMT,
                    "locale": LOCALE,
                },
                auth=key,
            )
            cas_id = resource_id(r2)
            # some versions return resourceId as cashier id nested
            if not cas_id and isinstance(r2, dict):
                cas_id = (r2.get("changes") or {}).get("cashierId") or r2.get(
                    "subResourceId"
                )
            log(f"CASHIER assign http={c2} id={cas_id} resp={'' if cas_id else r2}")
            created["cashierAssignmentId"] = cas_id

            if cas_id:
                c3, r3 = req(
                    "POST",
                    f"/tellers/{teller_id}/cashiers/{cas_id}/allocate",
                    {
                        "txnDate": TODAY,
                        "currencyCode": "UGX",
                        "txnAmount": 500000,
                        "txnNote": "Opening float seed",
                        "dateFormat": DATE_FMT,
                        "locale": LOCALE,
                    },
                    auth=key,
                )
                cashier_txn_id = resource_id(r3)
                log(
                    f"CASHIER allocate float 500000 UGX http={c3} id={cashier_txn_id} "
                    f"resp={'' if cashier_txn_id else r3}"
                )
        created["cashierAssignmentId"] = created.get("cashierAssignmentId") or (
            existing_c.get("id") if existing_c else None
        )

    # --- Optional: open savings for Nakato Grace #1 ---
    savings_account_id = None
    if savings_product_id:
        code, client = req("GET", "/clients/1", auth=key)
        if isinstance(client, dict) and client.get("active"):
            # check existing savings
            c2, accts = req("GET", "/clients/1/accounts", auth=key)
            existing_sav = []
            if isinstance(accts, dict):
                existing_sav = accts.get("savingsAccounts") or []
            if existing_sav:
                savings_account_id = existing_sav[0].get("id")
                log(f"SAVINGSACCOUNT skip client#1 already has id={savings_account_id}")
            else:
                c3, r3 = req(
                    "POST",
                    "/savingsaccounts",
                    {
                        "clientId": 1,
                        "productId": savings_product_id,
                        "locale": LOCALE,
                        "dateFormat": DATE_FMT,
                        "submittedOnDate": TODAY,
                    },
                    auth=key,
                )
                savings_account_id = resource_id(r3)
                log(
                    f"SAVINGSACCOUNT submit http={c3} id={savings_account_id} "
                    f"resp={'' if savings_account_id else r3}"
                )
                if savings_account_id:
                    c4, r4 = req(
                        "POST",
                        f"/savingsaccounts/{savings_account_id}?command=approve",
                        {
                            "locale": LOCALE,
                            "dateFormat": DATE_FMT,
                            "approvedOnDate": TODAY,
                        },
                        auth=key,
                    )
                    log(f"SAVINGSACCOUNT approve http={c4} resp={r4}")
                    c5, r5 = req(
                        "POST",
                        f"/savingsaccounts/{savings_account_id}?command=activate",
                        {
                            "locale": LOCALE,
                            "dateFormat": DATE_FMT,
                            "activatedOnDate": TODAY,
                        },
                        auth=key,
                    )
                    log(f"SAVINGSACCOUNT activate http={c5} resp={r5}")
        else:
            log(f"CLIENT#1 not active or missing: {client}")
    created["savingsAccountId"] = savings_account_id

    # --- Verify ---
    log("\n== VERIFY ==")
    counts = {}
    for ep in [
        "glaccounts",
        "loanproducts",
        "savingsproducts",
        "staff",
        "tellers",
        "offices",
        "charges",
        "currencies",
        "financialactivityaccounts",
        "paymenttypes",
    ]:
        c, data = req("GET", f"/{ep}", auth=key)
        if ep == "currencies":
            sel = [x["code"] for x in (data or {}).get("selectedCurrencyOptions", [])]
            counts[ep] = sel
            log(f"  {ep}: selected={sel} http={c}")
        elif isinstance(data, list):
            counts[ep] = len(data)
            names = [
                x.get("name") or x.get("displayName") or x.get("glCode") or x.get("id")
                for x in data[:12]
            ]
            log(f"  {ep}: count={len(data)} sample={names} http={c}")
        elif isinstance(data, dict) and "pageItems" in data:
            counts[ep] = data.get("totalFilteredRecords", len(data["pageItems"]))
            log(f"  {ep}: count={counts[ep]} http={c}")
        else:
            counts[ep] = data
            log(f"  {ep}: http={c} type={type(data).__name__}")

    # Write summary JSON next to this script (gitignored local output)
    summary = {"created": created, "counts": counts, "log_tail": LOG[-40:]}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed-fineract-last-run.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    log(f"\nSummary written to {out}")
    log("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
