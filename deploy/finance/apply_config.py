#!/usr/bin/env python3
"""Apply Pivot SACCO finance configuration (pivot-sacco-config.json) to a Fineract tenant.

Idempotent: every item is matched by name / GL code and created only if missing. Existing
products and charges are never modified (Fineract restricts changes once accounts use them);
differences are reported as DRIFT for a human to resolve.

  python3 apply_config.py --review > REVIEW.md          # board sign-off sheet, no API calls
  python3 apply_config.py --url https://desk.example/fineract-provider/api/v1 \
      --user mifos [--tenant default] [--cacert root.crt] [--dry-run]

The password is read from $FINERACT_PASSWORD or prompted; it is never printed.
Standard library only.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCALE = "en"
DATE_FORMAT = "yyyy-MM-dd"
GL_TYPES = {"ASSET": 1, "LIABILITY": 2, "EQUITY": 3, "INCOME": 4, "EXPENSE": 5}
FIN_ACTIVITY_IDS = {
    "assetTransfer": 100, "cashAtMainVault": 101, "cashAtTeller": 102, "fundSource": 103,
    "liabilityTransfer": 200, "payableDividends": 201, "openingBalancesTransferContra": 300,
}
CHARGE_APPLIES_TO = {"loan": 1, "savings": 2, "client": 3, "shares": 4}


class ApiError(Exception):
    pass


class Fineract:
    def __init__(self, url: str, tenant: str, user: str, password: str, cacert: str | None, insecure: bool, dry_run: bool):
        self.base = url.rstrip("/")
        self.headers = {
            "Fineract-Platform-TenantId": tenant,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode(),
        }
        if insecure:
            host = urllib.parse.urlparse(url).hostname or ""
            if host not in ("localhost", "127.0.0.1"):
                sys.exit("--insecure is only allowed for localhost")
            self.ctx = ssl._create_unverified_context()
        else:
            self.ctx = ssl.create_default_context(cafile=cacert) if cacert else ssl.create_default_context()
        self.dry_run = dry_run

    def call(self, method: str, path: str, body: dict | None = None):
        if self.dry_run and method != "GET":
            print(f"    [dry-run] {method} {path}")
            return {"resourceId": 0}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=300) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            try:
                j = json.loads(detail)
                errs = j.get("errors") or []
                detail = "; ".join(x.get("developerMessage") or x.get("defaultUserMessage", "") for x in errs) or j.get("developerMessage", detail)
            except ValueError:
                pass
            raise ApiError(f"{method} {path} → HTTP {e.code}: {detail[:600]}") from None

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)

    def put(self, path, body):
        return self.call("PUT", path, body)


def items(resp):
    """Fineract list endpoints return either a list or a paged {pageItems: [...]}"""
    return resp.get("pageItems", []) if isinstance(resp, dict) else resp


class Applier:
    def __init__(self, api: Fineract, cfg: dict):
        self.api = api
        self.cfg = cfg
        self.gl: dict[str, int] = {}
        self.pay: dict[str, int] = {}
        self.charge: dict[str, int] = {}
        self.created = 0
        self.drift: list[str] = []

    def log(self, msg):
        print(msg, flush=True)

    def made(self, what):
        self.created += 1
        self.log(f"  + {what}")

    # --- tenant-wide settings -------------------------------------------------------------
    def currency(self):
        self.log("Currency")
        code = self.cfg["currency"]["code"]
        cur = self.api.get("/currencies")
        selected = [c["code"] for c in cur.get("selectedCurrencyOptions", [])]
        if code in selected:
            self.log(f"  = {code} enabled")
        else:
            # Add, never remove: Fineract refuses to drop a currency something already uses (e.g. USD on a fresh tenant).
            self.api.put("/currencies", {"currencies": selected + [code]})
            self.made(f"currency {code} enabled (alongside {selected})")
        extra = [c for c in selected if c != code]
        if extra:
            self.drift.append(f"Currencies {extra} are also enabled; products here use {code} only")

    def working_days(self):
        self.log("Working days")
        wd = self.cfg["workingDays"]
        rule = "FREQ=WEEKLY;INTERVAL=1;BYDAY=" + ",".join(wd["days"])
        cur = self.api.get("/workingdays")
        cur_type = (cur.get("repaymentRescheduleType") or {}).get("id")
        if cur.get("recurrence") == rule and cur_type == wd["repaymentRescheduleType"]:
            self.log(f"  = {rule}")
            return
        self.api.put("/workingdays", {
            "recurrence": rule, "repaymentRescheduleType": wd["repaymentRescheduleType"],
            "extendTermForDailyRepayments": wd["extendTermForDailyRepayments"], "locale": LOCALE,
        })
        self.made(f"working days {rule}")

    def global_configs(self):
        self.log("Global configuration")
        cur = {c["name"]: c for c in self.api.get("/configurations")["globalConfiguration"]}
        for want in self.cfg["globalConfigurations"]:
            c = cur[want["name"]]
            body = {"enabled": want["enabled"]}
            if "value" in want:
                body["value"] = want["value"]
            if c["enabled"] == want["enabled"] and ("value" not in want or c.get("value") == want["value"]):
                self.log(f"  = {want['name']}")
                continue
            self.api.put(f"/configurations/{c['id']}", body)
            self.made(f"{want['name']} → {body}")

    def codes(self):
        self.log("Code values")
        existing = {c["name"]: c["id"] for c in self.api.get("/codes")}
        for name, values in self.cfg["codes"].items():
            cid = existing.get(name)
            if cid is None:
                cid = self.api.post("/codes", {"name": name})["resourceId"]
                self.made(f"code {name}")
            have = {v["name"] for v in self.api.get(f"/codes/{cid}/codevalues")} if cid else set()
            for pos, v in enumerate(values, start=1):
                if v in have:
                    continue
                self.api.post(f"/codes/{cid}/codevalues", {"name": v, "position": pos, "isActive": True})
                self.made(f"{name}: {v}")

    # --- chart of accounts ------------------------------------------------------------------
    def gl_accounts(self):
        self.log("Chart of accounts")
        existing = {g["glCode"]: g for g in self.api.get("/glaccounts")}
        for acc in self.cfg["glAccounts"]:
            g = existing.get(acc["code"])
            if g:
                self.gl[acc["code"]] = g["id"]
                if g["name"] != acc["name"] or g["type"]["value"].upper() != acc["type"]:
                    self.drift.append(f"GL {acc['code']}: tenant has '{g['name']}' ({g['type']['value']}), config wants '{acc['name']}' ({acc['type']})")
                continue
            body = {
                "name": acc["name"], "glCode": acc["code"], "type": GL_TYPES[acc["type"]],
                "usage": 2 if acc.get("usage") == "HEADER" else 1,
                "manualEntriesAllowed": acc.get("usage") != "HEADER",
                "description": acc.get("_note", acc["name"]),
            }
            if acc.get("parent"):
                parent = existing.get(acc["parent"])
                if parent and parent["usage"]["value"].upper() != "HEADER":
                    # A pre-existing detail account holds the header's code: Fineract won't nest under it.
                    self.drift.append(f"GL {acc['code']} created without parent: existing {acc['parent']} '{parent['name']}' is a detail account")
                else:
                    body["parentId"] = self.gl[acc["parent"]]
            self.gl[acc["code"]] = self.api.post("/glaccounts", body)["resourceId"]
            self.made(f"GL {acc['code']} {acc['name']}")

    def financial_activities(self):
        self.log("Financial activity mappings")
        existing = {m["financialActivityData"]["id"]: m for m in self.api.get("/financialactivityaccounts")}
        for name, code in self.cfg["financialActivityMappings"].items():
            act = FIN_ACTIVITY_IDS[name]
            body = {"financialActivityId": act, "glAccountId": self.gl[code]}
            m = existing.get(act)
            if m and m["glAccountData"]["id"] == self.gl[code]:
                self.log(f"  = {name} → {code}")
            elif m:
                self.api.put(f"/financialactivityaccounts/{m['id']}", body)
                self.made(f"{name} → {code} (was {m['glAccountData'].get('glCode')})")
            else:
                self.api.post("/financialactivityaccounts", body)
                self.made(f"{name} → {code}")

    def payment_types(self):
        self.log("Payment types")
        existing = {p["name"]: p["id"] for p in self.api.get("/paymenttypes")}
        for pos, p in enumerate(self.cfg["paymentTypes"], start=1):
            if p["name"] not in existing:
                existing[p["name"]] = self.api.post("/paymenttypes", {
                    "name": p["name"], "description": p.get("_note", p["name"]),
                    "isCashPayment": bool(p.get("isCashPayment")), "position": pos,
                })["resourceId"]
                self.made(f"payment type {p['name']}")
            self.pay[p["name"]] = existing[p["name"]]

    def channel_mappings(self):
        return [{"paymentTypeId": self.pay[p["name"]], "fundSourceAccountId": self.gl[p["gl"]]} for p in self.cfg["paymentTypes"]]

    # --- charges ----------------------------------------------------------------------------
    def charges(self):
        self.log("Charges")
        existing = {c["name"]: c for c in self.api.get("/charges")}
        code = self.cfg["currency"]["code"]
        for ch in self.cfg["charges"]:
            if ch["name"] in existing:
                self.charge[ch["key"]] = existing[ch["name"]]["id"]
                e = existing[ch["name"]]
                if float(e.get("amount", 0)) != float(ch["amount"]):
                    self.drift.append(f"Charge '{ch['name']}': tenant amount {e.get('amount')}, config {ch['amount']}")
                continue
            body = {
                "name": ch["name"], "chargeAppliesTo": CHARGE_APPLIES_TO[ch["appliesTo"]], "currencyCode": code,
                "amount": ch["amount"], "chargeTimeType": ch["timeType"], "chargeCalculationType": ch["calculationType"],
                "penalty": bool(ch.get("penalty")), "active": True, "locale": LOCALE,
            }
            if ch["appliesTo"] == "loan":
                body["chargePaymentMode"] = 0
            if ch["timeType"] == 9:
                body["feeInterval"] = ch["feeInterval"]
                body["feeFrequency"] = ch["feeFrequency"]
            if ch["appliesTo"] in ("client", "shares"):
                body["incomeAccountId"] = self.gl[ch["incomeGl"]]
            self.charge[ch["key"]] = self.api.post("/charges", body)["resourceId"]
            self.made(f"charge {ch['name']}")

    def fee_mappings(self, keys):
        fees, penalties = [], []
        for ch in self.cfg["charges"]:
            if ch["key"] in keys:
                (penalties if ch.get("penalty") else fees).append({"chargeId": self.charge[ch["key"]], "incomeAccountId": self.gl[ch["incomeGl"]]})
        return fees, penalties

    # --- products ---------------------------------------------------------------------------
    def share_product(self):
        self.log("Share product")
        sp = self.cfg["shareProduct"]
        existing = {p["name"]: p for p in items(self.api.get("/products/share"))}
        if sp["name"] in existing:
            self.log(f"  = {sp['name']}")
            return
        g = sp["gl"]
        self.api.post("/products/share", {
            "name": sp["name"], "shortName": sp["shortName"], "description": sp["description"],
            "currencyCode": self.cfg["currency"]["code"], "digitsAfterDecimal": 0, "inMultiplesOf": 1,
            "totalShares": sp["totalShares"], "sharesIssued": sp["sharesIssued"], "unitPrice": sp["unitPrice"],
            "shareCapital": sp["unitPrice"] * sp["sharesIssued"],
            "minimumShares": sp["minimumShares"], "nominalShares": sp["nominalShares"], "maximumShares": sp["maximumShares"],
            "allowDividendCalculationForInactiveClients": False,
            "lockinPeriodFrequency": sp["lockinPeriod"], "lockinPeriodFrequencyType": sp["lockinPeriodType"],
            "minimumActivePeriodForDividends": sp["minimumActivePeriodForDividends"], "minimumactiveperiodFrequencyType": 0,
            "accountingRule": 2,
            "shareReferenceId": self.gl[g["shareReference"]], "shareSuspenseId": self.gl[g["shareSuspense"]],
            "shareEquityId": self.gl[g["shareEquity"]], "incomeFromFeeAccountId": self.gl[g["incomeFromFees"]],
            "marketPricePeriods": [], "chargesSelected": [], "locale": LOCALE,
        })
        self.made(f"share product {sp['name']} (cash accounting — Fineract supports only cash for shares)")

    def deposit_accounting(self, gl, charge_keys):
        fees, penalties = self.fee_mappings(charge_keys)
        return {
            "accountingRule": 3,
            "savingsReferenceAccountId": self.gl[self.cfg["defaultFundSource"]],
            "savingsControlAccountId": self.gl[gl["control"]],
            "transfersInSuspenseAccountId": self.gl["2340"],  # Fineract requires a liability here for deposits
            "interestOnSavingsAccountId": self.gl[gl["interestExpense"]],
            "interestPayableAccountId": self.gl[gl["interestPayable"]],
            "incomeFromFeeAccountId": self.gl["4230"],
            "incomeFromPenaltyAccountId": self.gl["4240"],
            "feesReceivableAccountId": self.gl["1320"],
            "penaltiesReceivableAccountId": self.gl["1330"],
            "interestReceivableAccountId": self.gl["1310"],
            "overdraftPortfolioControlId": self.gl["1340"],
            "incomeFromInterestId": self.gl["4330"],
            "writeOffAccountId": self.gl["5220"],
            "escheatLiabilityId": self.gl["2370"],
            "paymentChannelToFundSourceMappings": self.channel_mappings(),
            "feeToIncomeAccountMappings": fees,
            "penaltyToIncomeAccountMappings": penalties,
        }

    def savings_products(self):
        self.log("Savings products")
        existing = {p["name"]: p for p in self.api.get("/savingsproducts")}
        for sp in self.cfg["savingsProducts"]:
            if sp["name"] in existing:
                e = existing[sp["name"]]
                if float(e.get("nominalAnnualInterestRate", 0)) != float(sp["nominalAnnualInterestRate"]):
                    self.drift.append(f"Savings '{sp['name']}': tenant rate {e.get('nominalAnnualInterestRate')}%, config {sp['nominalAnnualInterestRate']}%")
                if (e.get("accountingRule") or {}).get("id") != 3:
                    self.drift.append(f"Savings '{sp['name']}': accounting is {(e.get('accountingRule') or {}).get('value')}, config wants accrual periodic")
                self.log(f"  = {sp['name']}")
                continue
            body = {
                "name": sp["name"], "shortName": sp["shortName"], "description": sp["description"],
                "currencyCode": self.cfg["currency"]["code"], "digitsAfterDecimal": 0, "inMultiplesOf": 1,
                "nominalAnnualInterestRate": sp["nominalAnnualInterestRate"],
                "interestCompoundingPeriodType": sp["compounding"], "interestPostingPeriodType": sp["posting"],
                "interestCalculationType": sp["calculation"], "interestCalculationDaysInYearType": sp["daysInYear"],
                "minRequiredOpeningBalance": sp["minRequiredOpeningBalance"],
                "minRequiredBalance": sp["minRequiredBalance"], "enforceMinRequiredBalance": sp["enforceMinRequiredBalance"],
                "withdrawalFeeForTransfers": False, "allowOverdraft": False, "isDormancyTrackingActive": False,
                "charges": [{"id": self.charge[k]} for k in sp["charges"]],
                "locale": LOCALE,
            }
            if sp.get("minBalanceForInterestCalculation"):
                body["minBalanceForInterestCalculation"] = sp["minBalanceForInterestCalculation"]
            if sp.get("lockinPeriod"):
                body["lockinPeriodFrequency"] = sp["lockinPeriod"]
                body["lockinPeriodFrequencyType"] = sp["lockinPeriodType"]
            body.update(self.deposit_accounting(sp["gl"], sp["charges"]))
            self.api.post("/savingsproducts", body)
            self.made(f"savings product {sp['name']}")

    def fixed_deposit_product(self):
        self.log("Fixed deposit product")
        fd = self.cfg["fixedDepositProduct"]
        existing = {p["name"] for p in self.api.get("/fixeddepositproducts")}
        if fd["name"] in existing:
            self.log(f"  = {fd['name']}")
            return
        body = {
            "name": fd["name"], "shortName": fd["shortName"], "description": fd["description"],
            "currencyCode": self.cfg["currency"]["code"], "digitsAfterDecimal": 0, "inMultiplesOf": 1,
            "interestCompoundingPeriodType": fd["compounding"], "interestPostingPeriodType": fd["posting"],
            "interestCalculationType": fd["calculation"], "interestCalculationDaysInYearType": fd["daysInYear"],
            "minDepositTerm": fd["minDepositTerm"], "minDepositTermTypeId": fd["depositTermType"],
            "maxDepositTerm": fd["maxDepositTerm"], "maxDepositTermTypeId": fd["depositTermType"],
            "inMultiplesOfDepositTerm": fd["inMultiplesOfDepositTerm"], "inMultiplesOfDepositTermTypeId": fd["depositTermType"],
            "minDepositAmount": fd["minDepositAmount"], "depositAmount": fd["depositAmount"], "maxDepositAmount": fd["maxDepositAmount"],
            "preClosurePenalApplicable": True, "preClosurePenalInterest": fd["preClosurePenalInterest"],
            "preClosurePenalInterestOnTypeId": fd["preClosurePenalInterestOnType"],
            "charts": [{
                "fromDate": "2020-01-01", "dateFormat": DATE_FORMAT, "locale": LOCALE,
                "chartSlabs": [{
                    "periodType": fd["depositTermType"], "fromPeriod": s["fromPeriod"], "toPeriod": s["toPeriod"],
                    "annualInterestRate": s["rate"], "description": f"{s['fromPeriod']}-{s['toPeriod']} months", "locale": LOCALE,
                } for s in fd["chartSlabs"]],
            }],
            "charges": [], "locale": LOCALE,
        }
        body.update(self.deposit_accounting(fd["gl"], []))
        for k in ("overdraftPortfolioControlId", "incomeFromInterestId", "writeOffAccountId", "escheatLiabilityId", "interestReceivableAccountId"):
            body.pop(k, None)
        self.api.post("/fixeddepositproducts", body)
        self.made(f"fixed deposit product {fd['name']}")

    def loan_products(self):
        self.log("Loan products")
        d = self.cfg["loanProductDefaults"]
        existing = {p["name"]: p for p in self.api.get("/loanproducts")}
        for lp in self.cfg["loanProducts"]:
            if lp["name"] in existing:
                e = existing[lp["name"]]
                if float(e.get("interestRatePerPeriod", 0)) != float(lp["interestRatePerPeriod"]):
                    self.drift.append(f"Loan '{lp['name']}': tenant rate {e.get('interestRatePerPeriod')}, config {lp['interestRatePerPeriod']}")
                if (e.get("accountingRule") or {}).get("id") != 3:
                    self.drift.append(f"Loan '{lp['name']}': accounting is {(e.get('accountingRule') or {}).get('value')}, config wants accrual periodic")
                self.log(f"  = {lp['name']}")
                continue
            g = {**d["gl"], **lp["gl"]}
            fees, penalties = self.fee_mappings(lp["charges"] + d.get("extraFeeMappings", []))
            body = {
                "name": lp["name"], "shortName": lp["shortName"], "description": lp["description"],
                "currencyCode": self.cfg["currency"]["code"], "digitsAfterDecimal": 0,
                "inMultiplesOf": d["inMultiplesOf"], "installmentAmountInMultiplesOf": d["installmentAmountInMultiplesOf"],
                "principal": lp["principal"], "minPrincipal": lp["minPrincipal"], "maxPrincipal": lp["maxPrincipal"],
                "numberOfRepayments": lp["numberOfRepayments"], "minNumberOfRepayments": lp["minNumberOfRepayments"],
                "maxNumberOfRepayments": lp["maxNumberOfRepayments"],
                "repaymentEvery": d["repaymentEvery"], "repaymentFrequencyType": d["repaymentFrequencyType"],
                "interestRatePerPeriod": lp["interestRatePerPeriod"], "minInterestRatePerPeriod": lp["minInterestRatePerPeriod"],
                "maxInterestRatePerPeriod": lp["maxInterestRatePerPeriod"], "interestRateFrequencyType": d["interestRateFrequencyType"],
                "amortizationType": d["amortizationType"], "interestType": d["interestType"],
                "interestCalculationPeriodType": d["interestCalculationPeriodType"],
                "transactionProcessingStrategyCode": d["transactionProcessingStrategyCode"],
                "daysInYearType": d["daysInYearType"], "daysInMonthType": d["daysInMonthType"],
                "isInterestRecalculationEnabled": False,
                "overdueDaysForNPA": d["overdueDaysForNPA"],
                "accountMovesOutOfNPAOnlyOnArrearsCompletion": d["accountMovesOutOfNPAOnlyOnArrearsCompletion"],
                "graceOnArrearsAgeing": d["graceOnArrearsAgeing"], "inArrearsTolerance": d["inArrearsTolerance"],
                "includeInBorrowerCycle": d["includeInBorrowerCycle"], "useBorrowerCycle": False,
                "holdGuaranteeFunds": bool(lp.get("holdGuaranteeFunds")),
                "charges": [{"id": self.charge[k]} for k in lp["charges"]],
                "accountingRule": 3,
                "fundSourceAccountId": self.gl[self.cfg["defaultFundSource"]],
                "loanPortfolioAccountId": self.gl[g["portfolio"]],
                "interestOnLoanAccountId": self.gl[g["interestIncome"]],
                "receivableInterestAccountId": self.gl[g["interestReceivable"]],
                "receivableFeeAccountId": self.gl[g["feesReceivable"]],
                "receivablePenaltyAccountId": self.gl[g["penaltiesReceivable"]],
                "transfersInSuspenseAccountId": self.gl[g["transfersSuspense"]],
                "incomeFromFeeAccountId": self.gl[g["incomeFromFees"]],
                "incomeFromPenaltyAccountId": self.gl[g["incomeFromPenalties"]],
                "incomeFromRecoveryAccountId": self.gl[g["incomeFromRecovery"]],
                "writeOffAccountId": self.gl[g["writeOff"]],
                "overpaymentLiabilityAccountId": self.gl[g["overpayment"]],
                "paymentChannelToFundSourceMappings": self.channel_mappings(),
                "feeToIncomeAccountMappings": fees, "penaltyToIncomeAccountMappings": penalties,
                "locale": LOCALE,
            }
            if lp.get("holdGuaranteeFunds"):
                body.update({k: lp[k] for k in ("mandatoryGuarantee", "minimumGuaranteeFromOwnFunds", "minimumGuaranteeFromGuarantor")})
            self.api.post("/loanproducts", body)
            self.made(f"loan product {lp['name']}")

    def provisioning(self):
        self.log("Loan loss provisioning")
        pv = self.cfg["provisioning"]
        existing = items(self.api.get("/provisioningcriteria"))
        if any(c.get("criteriaName") == pv["criteriaName"] for c in existing):
            self.log(f"  = {pv['criteriaName']}")
            return
        cats = {c["categoryName"]: c["id"] for c in self.api.get("/provisioningcategory")}
        products = [{"id": p["id"]} for p in self.api.get("/loanproducts") if p["name"] in {lp["name"] for lp in self.cfg["loanProducts"]}]
        self.api.post("/provisioningcriteria", {
            "criteriaName": pv["criteriaName"], "loanProducts": products, "locale": LOCALE,
            "definitions": [{
                "categoryId": cats[c["category"]], "categoryName": c["category"], "minAge": c["minAge"], "maxAge": c["maxAge"],
                "provisioningPercentage": c["percentage"], "liabilityAccount": self.gl[pv["liabilityGl"]],
                "expenseAccount": self.gl[pv["expenseGl"]],
            } for c in pv["categories"]],
        })
        self.made(f"provisioning criteria for {len(products)} loan products")

    def holidays(self):
        self.log("Holidays")
        offices = [{"officeId": o["id"]} for o in self.api.get("/offices")]
        existing = {h["name"] for h in self.api.get("/holidays?officeId=1")}
        for h in self.cfg["holidays"]:
            if h["name"] in existing:
                continue
            hid = self.api.post("/holidays", {
                "name": h["name"], "fromDate": h["date"], "toDate": h["date"],
                # "Next repayment date" (type 1) would stack the instalment onto next month's; move it to the next working day.
                "reschedulingType": 2, "repaymentsRescheduledTo": self.next_working_day(h["date"]),
                "offices": offices, "description": h.get("_note", h["name"]), "dateFormat": DATE_FORMAT, "locale": LOCALE,
            })["resourceId"]
            self.api.post(f"/holidays/{hid}?command=activate", {})
            self.made(f"holiday {h['date']} {h['name']} (all {len(offices)} offices)")

    def next_working_day(self, iso):
        """Day after `iso` that is a configured working day and not itself a configured holiday."""
        import datetime as dt
        codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
        work = set(self.cfg["workingDays"]["days"])
        holidays = {h["date"] for h in self.cfg["holidays"]}
        d = dt.date.fromisoformat(iso)
        while True:
            d += dt.timedelta(days=1)
            if codes[d.weekday()] in work and d.isoformat() not in holidays:
                return d.isoformat()

    def jobs(self):
        self.log("Scheduler jobs")
        jobs = {j["displayName"]: j for j in self.api.get("/jobs")}
        for name, active in [(n, True) for n in self.cfg["jobs"]["activate"]] + [(n, False) for n in self.cfg["jobs"]["deactivate"]]:
            j = jobs.get(name)
            if j is None:
                self.drift.append(f"Job '{name}' not found in this Fineract build")
            elif j["active"] != active:
                self.api.put(f"/jobs/{j['jobId']}", {"active": active})
                self.made(f"job '{name}' → {'active' if active else 'inactive'}")

    def run(self):
        steps = [self.currency, self.working_days, self.global_configs, self.codes, self.gl_accounts,
                 self.financial_activities, self.payment_types, self.charges, self.share_product,
                 self.savings_products, self.fixed_deposit_product, self.loan_products, self.provisioning,
                 self.holidays, self.jobs]
        for step in steps:
            step()
        self.log(f"\nDone: {self.created} item(s) created or changed.")
        if self.drift:
            self.log("\nDRIFT (existing tenant data differs from config — resolve by hand):")
            for d in self.drift:
                self.log(f"  ! {d}")


def review(cfg: dict) -> str:
    """Board sign-off sheet: every business value in one place."""
    gl = {a["code"]: a["name"] for a in cfg["glAccounts"]}
    charge = {c["key"]: c for c in cfg["charges"]}
    months = {2: "months", 3: "years"}
    out = [
        "# Pivot SACCO — finance configuration sign-off",
        "",
        f"Config version `{cfg['version']}`. These are **draft defaults**. Each value must be confirmed or corrected by the Board / Manager "
        "before `apply_config.py` runs against production. Loan and savings terms cannot be changed freely once members hold accounts.",
        "",
        "Accounting: **accrual (periodic)** for loans, savings and fixed deposits; cash for share capital (Fineract limitation). "
        f"Currency {cfg['currency']['code']}, {cfg['currency']['decimals']} decimals.",
        "",
        "## Loan products",
        "",
        "| Product | Amount (UGX) | Term (months) | Interest | Fees | Guarantee | Portfolio GL / income GL | ✔ |",
        "|---|---|---|---|---|---|---|---|",
    ]
    d = cfg["loanProductDefaults"]
    for lp in cfg["loanProducts"]:
        fees = ", ".join(charge[k]["name"] for k in lp["charges"])
        guar = (f"{lp['mandatoryGuarantee']}% ({lp['minimumGuaranteeFromOwnFunds']}% own savings + {lp['minimumGuaranteeFromGuarantor']}% guarantors)"
                if lp.get("holdGuaranteeFunds") else "none")
        out.append(f"| {lp['name']} | {lp['minPrincipal']:,}–{lp['maxPrincipal']:,} (default {lp['principal']:,}) | "
                   f"{lp['minNumberOfRepayments']}–{lp['maxNumberOfRepayments']} | {lp['interestRatePerPeriod']}% per month reducing "
                   f"(allowed {lp['minInterestRatePerPeriod']}–{lp['maxInterestRatePerPeriod']}%) | {fees} | {guar} | "
                   f"{lp['gl']['portfolio']} / {lp['gl']['interestIncome']} | ☐ |")
    out += ["", f"All loans: equal monthly instalments, amounts in multiples of UGX {d['inMultiplesOf']:,}, "
            f"non-performing after {d['overdueDaysForNPA']} days in arrears, repayments applied penalties → fees → interest → principal.", "",
            "## Savings and deposits", "",
            "| Product | Interest | Minimum balance | Withdrawal rules | Fees | Liability GL | ✔ |", "|---|---|---|---|---|---|---|"]
    posting = {4: "monthly", 5: "quarterly", 7: "annually", 11: "on each anniversary"}
    for sp in cfg["savingsProducts"]:
        lock = f"locked first {sp['lockinPeriod']} {months[sp['lockinPeriodType']]}" if sp.get("lockinPeriod") else "any time"
        fees = ", ".join(charge[k]["name"] + f" (UGX {charge[k]['amount']:,})" for k in sp["charges"]) or "none"
        out.append(f"| {sp['name']} | {sp['nominalAnnualInterestRate']}% p.a., posted {posting[sp['posting']]} | "
                   f"{sp['minRequiredBalance']:,} | {lock} | {fees} | {sp['gl']['control']} | ☐ |")
    fd = cfg["fixedDepositProduct"]
    slabs = "; ".join(f"{s['fromPeriod']}–{s['toPeriod']} m: {s['rate']}%" for s in fd["chartSlabs"])
    out.append(f"| {fd['name']} | {slabs} | min {fd['minDepositAmount']:,} | {fd['minDepositTerm']}–{fd['maxDepositTerm']} months; "
               f"early closure −{fd['preClosurePenalInterest']}% rate | none | {fd['gl']['control']} | ☐ |")
    sp = cfg["shareProduct"]
    out += ["", "## Share capital", "",
            f"- Share price **UGX {sp['unitPrice']:,}**; minimum **{sp['minimumShares']} shares** (UGX {sp['unitPrice'] * sp['minimumShares']:,}); "
            f"maximum {sp['maximumShares']:,} per member; {sp['totalShares']:,} authorised. ☐",
            f"- Shares locked for {sp['lockinPeriod']} months; dividends only for shares held {sp['minimumActivePeriodForDividends']}+ days. ☐",
            "", "## Fees and penalties", "", "| Charge | Applies to | Amount | Income GL | ✔ |", "|---|---|---|---|---|"]
    for c in cfg["charges"]:
        amt = f"{c['amount']}%" if c["calculationType"] != 1 else f"UGX {c['amount']:,}"
        if c.get("_note", "").startswith("Migration only"):
            amt = "set per loan (migration only)"
        out.append(f"| {c['name']} | {c['appliesTo']} | {amt} | {c['incomeGl']} {gl[c['incomeGl']]} | ☐ |")
    pv = cfg["provisioning"]
    out += ["", "## Loan loss provisioning", "", "| Category | Days in arrears | Provision | ✔ |", "|---|---|---|---|"]
    for c in pv["categories"]:
        out.append(f"| {c['category']} | {c['minAge']}–{c['maxAge'] if c['maxAge'] < 99999 else '∞'} | {c['percentage']}% | ☐ |")
    out += ["", "## Operations", "",
            f"- Working days: {', '.join(cfg['workingDays']['days'])}; repayments on a closed day move to the next working day. ☐",
            f"- Public holidays loaded: {len(cfg['holidays'])} (Eid dates are provisional until gazetted). ☐",
            "- Payment types → ledger: " + "; ".join(f"{p['name']} → {p['gl']}" for p in cfg["paymentTypes"]) + ". ☐",
            "", "## Chart of accounts", "", "| Code | Account | Type |", "|---|---|---|"]
    for a in cfg["glAccounts"]:
        name = f"**{a['name']}**" if a.get("usage") == "HEADER" else a["name"]
        out.append(f"| {a['code']} | {name} | {a['type'].title()} |")
    notes = []
    def walk(node, where):
        if isinstance(node, dict):
            label = node.get("name") or node.get("criteriaName") or where
            for k in ("_review", "_note"):
                if isinstance(node.get(k), str) and "REVIEW" in node[k]:
                    notes.append(f"- **{label}**: {node[k].replace('REVIEW: ', '').replace('REVIEW ', '')}")
            for k, v in node.items():
                if not k.startswith("_"):
                    walk(v, node.get("name") or k)
        elif isinstance(node, list):
            for v in node:
                walk(v, where)
    walk(cfg, "Settings")
    out += ["", "## Reviewer notes (policy details behind the numbers)", "", *notes,
            "", "First deposits are taken as normal deposits: Fineract's automatic opening-balance deposit is switched off because it "
            "would record cash that was never received (and would corrupt migrated balances).",
            "", "## Not modelled in Fineract (policy / manual controls)", "",
            "- Loan-to-savings multiple (e.g. 3× savings), check-off employer agreements, compulsory monthly contribution amount.",
            "- Withholding tax on savings interest (add a Fineract tax group if URA requires it).",
            "", "Approved by: ____________________  Title: ______________  Date: ___________", ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(HERE / "pivot-sacco-config.json"))
    ap.add_argument("--review", action="store_true", help="print the sign-off sheet (Markdown) and exit")
    ap.add_argument("--url", help="Fineract API base, e.g. https://desk.example/fineract-provider/api/v1")
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--user", default="mifos")
    ap.add_argument("--cacert", help="CA bundle, e.g. Caddy's internal root.crt")
    ap.add_argument("--insecure", action="store_true", help="skip TLS verification (localhost only)")
    ap.add_argument("--dry-run", action="store_true", help="read the tenant and show what would be created")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    if args.review:
        print(review(cfg))
        return 0
    if not args.url:
        ap.error("--url is required (or use --review)")
    password = os.environ.get("FINERACT_PASSWORD") or getpass.getpass(f"Password for {args.user}: ")
    api = Fineract(args.url, args.tenant, args.user, password, args.cacert, args.insecure, args.dry_run)
    try:
        Applier(api, cfg).run()
    except ApiError as e:
        print(f"\nFAILED: {e}\nNothing after this step was applied. Fix the cause and re-run; completed steps are skipped.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
