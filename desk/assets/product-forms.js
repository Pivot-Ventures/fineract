/* Pivot SACCO Desk — charge and product payloads (accounting NONE). */
(function (root) {
  "use strict";

  /* Time types that do not need feeOnMonthDay / feeInterval. */
  var LOAN_TIME = [
    { value: "1", label: "Disbursement" },
    { value: "2", label: "Specified due date" },
    { value: "8", label: "Instalment fee" },
    { value: "9", label: "Overdue instalment" }
  ];
  var SAVINGS_TIME = [
    { value: "5", label: "Withdrawal fee" },
    { value: "3", label: "Savings activation" },
    { value: "4", label: "Savings closure" },
    { value: "2", label: "Specified due date" },
    { value: "11", label: "Weekly fee" },
    { value: "10", label: "Overdraft fee" },
    { value: "16", label: "No activity fee" }
  ];
  var CALC = [
    { value: "1", label: "Flat" },
    { value: "2", label: "Percent of amount" }
  ];

  function idsOf(options) {
    return options.map(function (o) { return Number(o.value); });
  }

  function currencyPack(data) {
    var selected = (data && data.selectedCurrencyOptions) || [];
    if (!Array.isArray(selected)) selected = [];
    var digitsByCode = {};
    selected.forEach(function (c) {
      if (!c || !c.code) return;
      digitsByCode[c.code] = c.decimalPlaces != null ? Number(c.decimalPlaces) : (c.code === "UGX" ? 0 : 2);
    });
    var options = selected.filter(function (c) { return c && c.code; }).map(function (c) {
      return { value: c.code, label: c.displayLabel || (c.name ? c.name + " (" + c.code + ")" : c.code) };
    });
    options.sort(function (a, b) {
      if (a.value === "UGX") return -1;
      if (b.value === "UGX") return 1;
      return String(a.label).localeCompare(String(b.label));
    });
    var preferred = null;
    for (var i = 0; i < selected.length; i++) {
      if (selected[i] && selected[i].code === "UGX") { preferred = selected[i]; break; }
    }
    if (!preferred && selected.length && selected[0] && selected[0].code) preferred = selected[0];
    var code = preferred ? preferred.code : "UGX";
    if (!options.length) options = [{ value: "UGX", label: "UGX" }];
    return { code: code, options: options, digitsByCode: digitsByCode };
  }

  function digitsFor(pack, code) {
    if (pack && pack.digitsByCode && pack.digitsByCode[code] != null && !isNaN(pack.digitsByCode[code])) {
      return pack.digitsByCode[code];
    }
    return code === "UGX" ? 0 : 2;
  }

  function fail(message) {
    throw new Error(message);
  }

  function text(v, label, max) {
    var s = String(v == null ? "" : v).trim();
    if (!s) fail(label + " is required");
    if (max && s.length > max) fail(label + " must be at most " + max + " characters");
    return s;
  }

  function num(v, label) {
    var n = Number(String(v == null ? "" : v).replace(/,/g, "").trim());
    if (!isFinite(n)) fail(label + " must be a number");
    return n;
  }

  function positive(v, label) {
    var n = num(v, label);
    if (n <= 0) fail(label + " must be greater than zero");
    return n;
  }

  function whole(v, label) {
    var n = num(v, label);
    if (n < 1 || Math.round(n) !== n) fail(label + " must be a whole number of at least 1");
    return n;
  }

  function nonNeg(v, label) {
    var n = num(v, label);
    if (n < 0) fail(label + " cannot be negative");
    return n;
  }

  function ordered(min, mid, max, label) {
    if (min > mid || mid > max) fail(label + " is out of order. Enter a minimum, then a default, then a maximum.");
  }

  function money(v, label, digits) {
    var n = positive(v, label);
    if (digits === 0 && Math.round(n) !== n) fail(label + " must be a whole number for this currency");
    return n;
  }

  function chargePayload(v, opts) {
    opts = opts || {};
    v = v || {};
    var applies = Number(v.chargeAppliesTo);
    var time = Number(v.chargeTimeType);
    var calc = Number(v.chargeCalculationType);
    if (applies !== 1 && applies !== 2) fail("Choose loan or savings");
    var allowed = applies === 1 ? idsOf(LOAN_TIME) : idsOf(SAVINGS_TIME);
    if (allowed.indexOf(time) < 0) fail("That time type is not valid for this charge");
    if (calc !== 1 && calc !== 2) fail("Calculation must be flat or percent of amount");
    var code = text(v.currencyCode, "Currency", 3);
    var amount = positive(v.amount, calc === 1 ? "Amount" : "Percent");
    if (calc === 1) amount = money(amount, "Amount", digitsFor(opts.pack, code));
    var body = {
      name: text(v.name, "Name", 100),
      amount: amount,
      currencyCode: code,
      chargeTimeType: time,
      chargeCalculationType: calc,
      active: String(v.active) !== "false",
      penalty: time === 9,
      locale: "en"
    };
    if (!opts.editing) body.chargeAppliesTo = applies;
    if (applies === 1) body.chargePaymentMode = opts.paymentMode != null ? Number(opts.paymentMode) : 0;
    return body;
  }

  function loanProductPayload(v, pack) {
    v = v || {};
    var code = text(v.currencyCode, "Currency", 3);
    var digits = digitsFor(pack, code);
    var principal = money(v.principal, "Principal", digits);
    var minPrincipal = money(v.minPrincipal, "Minimum principal", digits);
    var maxPrincipal = money(v.maxPrincipal, "Maximum principal", digits);
    ordered(minPrincipal, principal, maxPrincipal, "Principal");
    var numberOfRepayments = whole(v.numberOfRepayments, "Repayments");
    var minNumberOfRepayments = whole(v.minNumberOfRepayments, "Minimum repayments");
    var maxNumberOfRepayments = whole(v.maxNumberOfRepayments, "Maximum repayments");
    ordered(minNumberOfRepayments, numberOfRepayments, maxNumberOfRepayments, "Repayments");
    var interest = nonNeg(v.interestRatePerPeriod, "Interest rate");
    var minInterest = nonNeg(v.minInterestRatePerPeriod, "Minimum interest");
    var maxInterest = nonNeg(v.maxInterestRatePerPeriod, "Maximum interest");
    ordered(minInterest, interest, maxInterest, "Interest rate");
    return {
      name: text(v.name, "Name", 100),
      shortName: text(v.shortName, "Short name", 4),
      currencyCode: code,
      digitsAfterDecimal: digits,
      inMultiplesOf: 1,
      principal: principal,
      minPrincipal: minPrincipal,
      maxPrincipal: maxPrincipal,
      numberOfRepayments: numberOfRepayments,
      minNumberOfRepayments: minNumberOfRepayments,
      maxNumberOfRepayments: maxNumberOfRepayments,
      repaymentEvery: whole(v.repaymentEvery || 1, "Repayment every"),
      repaymentFrequencyType: 2,
      interestRatePerPeriod: interest,
      minInterestRatePerPeriod: minInterest,
      maxInterestRatePerPeriod: maxInterest,
      interestRateFrequencyType: 2,
      amortizationType: 1,
      interestType: 0,
      interestCalculationPeriodType: 1,
      transactionProcessingStrategyCode: "mifos-standard-strategy",
      accountingRule: 1,
      daysInMonthType: 1,
      daysInYearType: 365,
      isInterestRecalculationEnabled: false,
      includeInBorrowerCycle: true,
      useBorrowerCycle: false,
      locale: "en"
    };
  }

  function savingsProductPayload(v, pack) {
    v = v || {};
    var code = text(v.currencyCode, "Currency", 3);
    var description = String(v.description == null ? "" : v.description).trim();
    return {
      name: text(v.name, "Name", 100),
      shortName: text(v.shortName, "Short name", 4),
      description: description || "Pivot SACCO voluntary savings",
      currencyCode: code,
      digitsAfterDecimal: digitsFor(pack, code),
      inMultiplesOf: 1,
      nominalAnnualInterestRate: nonNeg(v.nominalAnnualInterestRate, "Annual interest"),
      interestCompoundingPeriodType: 4,
      interestPostingPeriodType: 4,
      interestCalculationType: 1,
      interestCalculationDaysInYearType: 365,
      withdrawalFeeForTransfers: false,
      accountingRule: 1,
      locale: "en"
    };
  }

  function timeOptions(appliesTo) {
    return String(appliesTo) === "2" ? SAVINGS_TIME : LOAN_TIME;
  }

  function principalDefaults(code) {
    if (code === "UGX") return { principal: "1000000", minPrincipal: "100000", maxPrincipal: "50000000" };
    return { principal: "1000", minPrincipal: "100", maxPrincipal: "50000" };
  }

  root.PivotProductForms = {
    LOAN_TIME: LOAN_TIME,
    SAVINGS_TIME: SAVINGS_TIME,
    CALC: CALC,
    currencyPack: currencyPack,
    digitsFor: digitsFor,
    chargePayload: chargePayload,
    loanProductPayload: loanProductPayload,
    savingsProductPayload: savingsProductPayload,
    timeOptions: timeOptions,
    principalDefaults: principalDefaults
  };
})(typeof window !== "undefined" ? window : global);
