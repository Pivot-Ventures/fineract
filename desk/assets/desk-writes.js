/* Payload builders for desk writes that Fineract accepts without a wizard. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.PivotDeskWrites = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var LOAN_CASH_FIELDS = [
    { key: "fundSourceAccountId", label: "Fund source (asset)", typeId: 1, code: "1120" },
    { key: "loanPortfolioAccountId", label: "Loan portfolio (asset)", typeId: 1, code: "1130" },
    { key: "transfersInSuspenseAccountId", label: "Transfers in suspense (liability)", typeId: 2, code: "2120" },
    { key: "interestOnLoanAccountId", label: "Interest income", typeId: 4, code: "4110" },
    { key: "incomeFromFeeAccountId", label: "Fee income", typeId: 4, code: "4120" },
    { key: "incomeFromPenaltyAccountId", label: "Penalty income", typeId: 4, code: "4130" },
    { key: "writeOffAccountId", label: "Write-off (expense)", typeId: 5, code: "5130" },
    { key: "overpaymentLiabilityAccountId", label: "Overpayment (liability)", typeId: 2, code: "2120", reuse: true },
    { key: "incomeFromRecoveryAccountId", label: "Recovery income", typeId: 4, code: "4120", reuse: true }
  ];
  var DEPOSIT_CASH_FIELDS = [
    { key: "savingsReferenceAccountId", label: "Savings reference (asset)", typeId: 1, code: "1120" },
    { key: "savingsControlAccountId", label: "Savings control (liability)", typeId: 2, code: "2110" },
    { key: "transfersInSuspenseAccountId", label: "Transfers in suspense (liability)", typeId: 2, code: "2120" },
    { key: "interestOnSavingsAccountId", label: "Interest on savings (expense)", typeId: 5, code: "5110" },
    { key: "incomeFromFeeAccountId", label: "Fee income", typeId: 4, code: "4120" },
    { key: "incomeFromPenaltyAccountId", label: "Penalty income", typeId: 4, code: "4130" }
  ];
  var SAVINGS_CASH_FIELDS = DEPOSIT_CASH_FIELDS.concat([
    { key: "overdraftPortfolioControlId", label: "Overdraft portfolio (asset)", typeId: 1, code: "1130" },
    { key: "incomeFromInterestAccountId", label: "Income from interest", typeId: 4, code: "4120", reuse: true },
    { key: "lossesWrittenOffAccountId", label: "Losses written off (expense)", typeId: 5, code: "5140" }
  ]);
  var SHARE_CASH_FIELDS = [
    { key: "shareReferenceId", label: "Share reference (asset)", typeId: 1, code: "1120" },
    { key: "shareSuspenseId", label: "Share suspense (liability)", typeId: 2, code: "2120" },
    { key: "shareEquityId", label: "Share equity", typeId: 3, code: "3100" },
    { key: "incomeFromFeeAccountId", label: "Fee income", typeId: 4, code: "4120" }
  ];

  function asList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.pageItems)) return data.pageItems;
    return [];
  }

  function glTypeId(g) {
    if (!g || g.type == null) return null;
    if (typeof g.type === "object") return Number(g.type.id);
    return Number(g.type);
  }

  function isDetail(g) {
    if (!g || g.usage == null) return true;
    var id = typeof g.usage === "object" ? g.usage.id : g.usage;
    return Number(id) === 1;
  }

  function activeGls(gls) {
    return (gls || []).filter(function (g) { return g && !g.disabled && g.id != null; });
  }

  function pickGl(gls, opts) {
    opts = opts || {};
    function choose(list) {
      var pool = list.filter(function (g) {
        if (opts.typeId != null && glTypeId(g) !== Number(opts.typeId)) return false;
        if (opts.excludeIds && opts.excludeIds.map(Number).indexOf(Number(g.id)) >= 0) return false;
        return true;
      });
      if (opts.code) {
        var coded = pool.filter(function (g) { return String(g.glCode) === String(opts.code); })[0];
        if (coded) return coded;
      }
      return pool[0] || null;
    }
    var all = activeGls(gls);
    return choose(all.filter(isDetail)) || choose(all);
  }

  function glId(g) {
    return g && g.id != null ? Number(g.id) : null;
  }

  function glOptions(gls, typeId) {
    var detail = activeGls(gls).filter(isDetail);
    var pool = detail.length ? detail : activeGls(gls);
    return pool.filter(function (g) {
      return typeId == null || glTypeId(g) === Number(typeId);
    }).map(function (g) {
      return { value: String(g.id), label: ((g.glCode || "") + " " + (g.name || "")).trim() };
    });
  }

  function currencyPack(currencies) {
    var selected = [];
    if (currencies && Array.isArray(currencies.selectedCurrencyOptions)) selected = currencies.selectedCurrencyOptions;
    else if (Array.isArray(currencies)) selected = currencies;
    var ugx = null;
    for (var i = 0; i < selected.length; i++) {
      if (selected[i] && selected[i].code === "UGX") ugx = selected[i];
    }
    var chosen = ugx || selected[0] || null;
    var digits = 2;
    if (chosen && chosen.decimalPlaces != null) digits = Number(chosen.decimalPlaces);
    else if (!chosen || chosen.code === "UGX") digits = 0;
    return { code: chosen ? chosen.code : "UGX", digitsAfterDecimal: digits };
  }

  function shortName(name) {
    var s = String(name || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
    if (s.length < 2) s = (s + "PR").slice(0, 4);
    return s.slice(0, 4);
  }

  function num(v) {
    if (v == null || v === "") return NaN;
    return Number(String(v).replace(/,/g, ""));
  }

  function boolOf(v) {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  function enumId(v) {
    if (v && typeof v === "object" && v.id != null) return Number(v.id);
    if (v == null || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function addDays(iso, days) {
    var d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
    if (isNaN(d.getTime())) return iso;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function isoFromApiDate(v) {
    if (!v) return null;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    if (Array.isArray(v) && v.length >= 3) {
      var m = String(v[1]).padStart(2, "0");
      var d = String(v[2]).padStart(2, "0");
      return v[0] + "-" + m + "-" + d;
    }
    return null;
  }

  function businessDateIso(rows, fallback) {
    var list = asList(rows);
    var i;
    for (i = 0; i < list.length; i++) {
      var t = list[i] && (list[i].type || list[i].description);
      var label = typeof t === "object" ? (t.value || t.code || "") : String(t || "");
      if (/BUSINESS/i.test(label) || label === "") {
        var iso = isoFromApiDate(list[i].date);
        if (iso && /BUSINESS/i.test(label)) return iso;
      }
    }
    for (i = 0; i < list.length; i++) {
      var any = isoFromApiDate(list[i] && list[i].date);
      if (any) return any;
    }
    return fallback;
  }

  function cashMap(gls, specs, form) {
    var out = {};
    var used = [];
    specs.forEach(function (spec) {
      var chosen = form && form[spec.key] != null && form[spec.key] !== "" ? Number(form[spec.key]) : null;
      if (!chosen) {
        var picked = pickGl(gls, { code: spec.code, typeId: spec.typeId, excludeIds: spec.reuse ? [] : used });
        chosen = glId(picked);
      }
      out[spec.key] = chosen || null;
      if (chosen && !spec.reuse) used.push(chosen);
    });
    return out;
  }

  function missingKeys(map) {
    return Object.keys(map).filter(function (k) { return !map[k]; });
  }

  function applyCash(body, gls, specs, form) {
    if (Number(form.accountingRule) !== 2) return body;
    var map = cashMap(gls, specs, form);
    var missing = missingKeys(map);
    if (missing.length) {
      throw new Error("Cash accounting needs a GL for: " + missing.join(", "));
    }
    Object.keys(map).forEach(function (k) { body[k] = map[k]; });
    return body;
  }

  function accountingRuleDefault(gls, specs) {
    return missingKeys(cashMap(gls, specs, {})).length ? "1" : "2";
  }

  function glDialogFields(gls, specs, current) {
    current = current || {};
    return specs.map(function (spec) {
      var picked = current[spec.key] || glId(pickGl(gls, { code: spec.code, typeId: spec.typeId }));
      return {
        key: spec.key,
        label: spec.label,
        type: "select",
        options: glOptions(gls, spec.typeId),
        value: picked ? String(picked) : "",
        showWhen: { key: "accountingRule", values: ["2"] }
      };
    });
  }

  function accountingField(value) {
    return {
      key: "accountingRule",
      label: "Accounting",
      type: "select",
      value: String(value || "1"),
      options: [
        { value: "1", label: "None (no GL)" },
        { value: "2", label: "Cash" }
      ]
    };
  }

  function requireText(value, label) {
    var s = String(value || "").trim();
    if (!s) throw new Error(label + " is required");
    return s;
  }

  function requirePositive(value, label) {
    var n = num(value);
    if (!(n > 0)) throw new Error(label + " must be greater than zero");
    return n;
  }

  function floatingRatePayload(form) {
    var name = requireText(form.name, "Name");
    if (name.length > 200) throw new Error("Name must be 200 characters or fewer");
    var fromDate = requireText(form.fromDate, "From date");
    var rate = num(form.interestRate);
    if (isNaN(rate) || rate < 0) throw new Error("Interest rate must be zero or greater");
    var base = boolOf(form.isBaseLendingRate);
    return {
      name: name,
      isBaseLendingRate: base,
      isActive: form.isActive == null || form.isActive === "" ? true : boolOf(form.isActive),
      ratePeriods: [{
        fromDate: fromDate,
        interestRate: rate,
        isDifferentialToBaseLendingRate: false,
        locale: "en",
        dateFormat: "yyyy-MM-dd"
      }]
    };
  }

  function depositChart(fromDate, annualRate) {
    return [{
      fromDate: fromDate || "2010-01-01",
      dateFormat: "yyyy-MM-dd",
      locale: "en",
      isPrimaryGroupingByAmount: false,
      chartSlabs: [{
        description: "Standard",
        periodType: 2,
        fromPeriod: 1,
        toPeriod: 24,
        annualInterestRate: num(annualRate),
        locale: "en"
      }]
    }];
  }

  function productCore(form, currency) {
    var name = requireText(form.name, "Name");
    var sn = shortName(form.shortName || name);
    if (sn.length > 4) throw new Error("Short name must be 4 characters or fewer");
    return {
      name: name,
      shortName: sn,
      description: String(form.description || name).trim().slice(0, 500),
      currencyCode: currency.code,
      digitsAfterDecimal: currency.digitsAfterDecimal,
      inMultiplesOf: 1,
      locale: "en"
    };
  }

  function shareProductPayload(form, currency, gls) {
    var body = productCore(form, currency);
    var total = requirePositive(form.totalShares, "Total shares");
    var nominal = requirePositive(form.nominalShares, "Nominal shares");
    var price = requirePositive(form.unitPrice, "Unit price");
    if (nominal > total) throw new Error("Nominal shares cannot exceed total shares");
    body.totalShares = total;
    body.sharesIssued = nominal;
    body.unitPrice = price;
    body.minimumShares = nominal > 1 ? 1 : nominal;
    body.nominalShares = nominal;
    body.maximumShares = total;
    body.allowDividendCalculationForInactiveClients = false;
    body.accountingRule = Number(form.accountingRule) === 2 ? 2 : 1;
    return applyCash(body, gls, SHARE_CASH_FIELDS, form);
  }

  function fixedDepositPayload(form, currency, gls) {
    var body = productCore(form, currency);
    var rate = requirePositive(form.interestRate, "Interest rate");
    var deposit = requirePositive(form.depositAmount, "Deposit amount");
    body.nominalAnnualInterestRate = rate;
    body.interestCompoundingPeriodType = 4;
    body.interestPostingPeriodType = 4;
    body.interestCalculationType = 1;
    body.interestCalculationDaysInYearType = 365;
    body.minDepositTerm = 6;
    body.minDepositTermTypeId = 2;
    body.maxDepositTerm = 24;
    body.maxDepositTermTypeId = 2;
    body.depositAmount = deposit;
    body.preClosurePenalApplicable = false;
    body.accountingRule = Number(form.accountingRule) === 2 ? 2 : 1;
    body.charts = depositChart("2010-01-01", rate);
    return applyCash(body, gls, DEPOSIT_CASH_FIELDS, form);
  }

  function recurringDepositPayload(form, currency, gls) {
    var body = fixedDepositPayload(form, currency, gls);
    body.isMandatoryDeposit = false;
    body.allowWithdrawal = true;
    body.recurringFrequency = 1;
    body.recurringFrequencyType = 2;
    return body;
  }

  function loanProductUpdate(form, gls) {
    var name = requireText(form.name, "Name");
    var body = {
      name: name,
      shortName: shortName(form.shortName || name),
      locale: "en",
      principal: requirePositive(form.principal, "Principal"),
      numberOfRepayments: requirePositive(form.numberOfRepayments, "Repayments"),
      interestRatePerPeriod: num(form.interestRatePerPeriod)
    };
    if (isNaN(body.interestRatePerPeriod) || body.interestRatePerPeriod < 0) {
      throw new Error("Interest rate must be zero or greater");
    }
    body.accountingRule = Number(form.accountingRule) === 2 ? 2 : 1;
    return applyCash(body, gls, LOAN_CASH_FIELDS, form);
  }

  function savingsProductUpdate(form, gls) {
    var name = requireText(form.name, "Name");
    var body = {
      name: name,
      shortName: shortName(form.shortName || name),
      description: String(form.description || name).trim().slice(0, 500),
      locale: "en",
      nominalAnnualInterestRate: num(form.nominalAnnualInterestRate)
    };
    if (isNaN(body.nominalAnnualInterestRate) || body.nominalAnnualInterestRate < 0) {
      throw new Error("Interest rate must be zero or greater");
    }
    body.accountingRule = Number(form.accountingRule) === 2 ? 2 : 1;
    return applyCash(body, gls, SAVINGS_CASH_FIELDS, form);
  }

  function provisioningCriteriaPayload(form) {
    var minAge = num(form.minAge);
    var maxAge = num(form.maxAge);
    if (isNaN(minAge) || minAge < 0) throw new Error("Min age must be zero or greater");
    if (!(maxAge > minAge)) throw new Error("Max age must be greater than min age");
    var pct = num(form.provisioningPercentage);
    if (isNaN(pct) || pct < 0) throw new Error("Provisioning percent must be zero or greater");
    if (!form.categoryId) throw new Error("Pick a provisioning category");
    if (!form.liabilityAccount || !form.expenseAccount) throw new Error("Pick a liability GL and an expense GL");
    return {
      criteriaName: requireText(form.criteriaName, "Criteria name"),
      locale: "en",
      definitions: [{
        categoryId: Number(form.categoryId),
        minAge: minAge,
        maxAge: maxAge,
        provisioningPercentage: pct,
        liabilityAccount: Number(form.liabilityAccount),
        expenseAccount: Number(form.expenseAccount)
      }]
    };
  }

  function provisioningEntryPayload(form) {
    return {
      date: requireText(form.date, "Date"),
      locale: "en",
      dateFormat: "yyyy-MM-dd",
      createjournalentries: boolOf(form.createjournalentries)
    };
  }

  function addressPayload(form) {
    if (!form.addressTypeId) throw new Error("Pick an address type");
    var body = {
      addressTypeId: Number(form.addressTypeId),
      addressLine1: requireText(form.addressLine1, "Address line"),
      city: String(form.city || "").trim(),
      isActive: true
    };
    if (form.countryId) body.countryId = Number(form.countryId);
    if (form.stateProvinceId) body.stateProvinceId = Number(form.stateProvinceId);
    if (form.postalCode) body.postalCode = String(form.postalCode).trim();
    return body;
  }

  function shareAccountPayload(form) {
    var shares = requirePositive(form.requestedShares, "Shares");
    var date = requireText(form.date, "Date");
    if (!form.clientId || !form.productId || !form.savingsAccountId) {
      throw new Error("Client, share product, and savings account are required");
    }
    return {
      clientId: Number(form.clientId),
      productId: Number(form.productId),
      savingsAccountId: Number(form.savingsAccountId),
      requestedShares: shares,
      submittedDate: date,
      applicationDate: date,
      locale: "en",
      dateFormat: "yyyy-MM-dd"
    };
  }

  function shareApprovePayload(date) {
    return { approvedDate: date, locale: "en", dateFormat: "yyyy-MM-dd" };
  }

  function shareActivatePayload(date) {
    return { activatedDate: date, locale: "en", dateFormat: "yyyy-MM-dd" };
  }

  function accountingRulePayload(form) {
    var name = requireText(form.name, "Name");
    if (!form.debit || !form.credit) throw new Error("Pick a debit GL and a credit GL");
    if (String(form.debit) === String(form.credit)) throw new Error("Debit and credit must be different accounts");
    var body = {
      name: name,
      description: name,
      accountToDebit: Number(form.debit),
      accountToCredit: Number(form.credit)
    };
    if (form.officeId) body.officeId = Number(form.officeId);
    return body;
  }

  function accountingRuleDefaults(gls) {
    var debit = pickGl(gls, { code: "1110", typeId: 1 }) || pickGl(gls, { code: "1120", typeId: 1 });
    var credit = pickGl(gls, { code: "2110", typeId: 2 }) || pickGl(gls, { typeId: 5 }) || pickGl(gls, { typeId: 2 });
    return { debitId: glId(debit), creditId: glId(credit) };
  }

  return {
    LOAN_CASH_FIELDS: LOAN_CASH_FIELDS,
    DEPOSIT_CASH_FIELDS: DEPOSIT_CASH_FIELDS,
    SAVINGS_CASH_FIELDS: SAVINGS_CASH_FIELDS,
    SHARE_CASH_FIELDS: SHARE_CASH_FIELDS,
    asList: asList,
    glTypeId: glTypeId,
    pickGl: pickGl,
    glOptions: glOptions,
    currencyPack: currencyPack,
    shortName: shortName,
    addDays: addDays,
    isoFromApiDate: isoFromApiDate,
    businessDateIso: businessDateIso,
    enumId: enumId,
    accountingRuleDefault: accountingRuleDefault,
    glDialogFields: glDialogFields,
    accountingField: accountingField,
    floatingRatePayload: floatingRatePayload,
    shareProductPayload: shareProductPayload,
    fixedDepositPayload: fixedDepositPayload,
    recurringDepositPayload: recurringDepositPayload,
    loanProductUpdate: loanProductUpdate,
    savingsProductUpdate: savingsProductUpdate,
    provisioningCriteriaPayload: provisioningCriteriaPayload,
    provisioningEntryPayload: provisioningEntryPayload,
    addressPayload: addressPayload,
    shareAccountPayload: shareAccountPayload,
    shareApprovePayload: shareApprovePayload,
    shareActivatePayload: shareActivatePayload,
    accountingRulePayload: accountingRulePayload,
    accountingRuleDefaults: accountingRuleDefaults
  };
});
