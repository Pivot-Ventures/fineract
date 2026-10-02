"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const context = { window: {}, console: console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../assets/product-forms.js"), "utf8"),
  context
);
const forms = context.window.PivotProductForms;

const GL_KEYS = [
  "fundSourceAccountId",
  "loanPortfolioAccountId",
  "transfersInSuspenseAccountId",
  "interestOnLoanAccountId",
  "incomeFromFeeAccountId",
  "incomeFromPenaltyAccountId",
  "writeOffAccountId",
  "overpaymentLiabilityAccountId",
  "incomeFromRecoveryAccountId",
  "savingsReferenceAccountId",
  "savingsControlAccountId",
  "interestOnSavingsAccountId",
  "overdraftPortfolioControlId",
  "lossesWrittenOffAccountId",
  "incomeFromInterestAccountId"
];

function ugxAndUsd() {
  return forms.currencyPack({
    selectedCurrencyOptions: [
      { code: "USD", name: "US Dollar", decimalPlaces: 2, displayLabel: "US Dollar (USD)" },
      { code: "UGX", name: "Uganda Shilling", decimalPlaces: 0, displayLabel: "Uganda Shilling (UGX)" }
    ]
  });
}

test("prefers UGX when the organisation has it selected", function () {
  const pack = ugxAndUsd();
  assert.equal(pack.code, "UGX");
  assert.equal(pack.options[0].value, "UGX");
  assert.equal(forms.digitsFor(pack, "UGX"), 0);
  assert.equal(forms.digitsFor(pack, "USD"), 2);
});

test("falls back to the first selected currency when UGX is absent", function () {
  const pack = forms.currencyPack({
    selectedCurrencyOptions: [{ code: "USD", name: "US Dollar", decimalPlaces: 2 }]
  });
  assert.equal(pack.code, "USD");
  assert.deepEqual(pack.options.map(function (o) { return o.value; }), ["USD"]);
});

test("does not throw when no currency is selected", function () {
  const pack = forms.currencyPack({});
  assert.equal(pack.code, "UGX");
  assert.equal(pack.options.length, 1);
  assert.equal(pack.options[0].value, "UGX");
  const empty = forms.currencyPack(null);
  assert.equal(empty.code, "UGX");
});

test("loan charge posts flat disbursement in the chosen currency", function () {
  const body = forms.chargePayload({
    name: "Processing fee",
    amount: "10000",
    currencyCode: "USD",
    chargeAppliesTo: "1",
    chargeTimeType: "1",
    chargeCalculationType: "1",
    active: "true"
  }, { pack: forms.currencyPack({ selectedCurrencyOptions: [{ code: "USD", decimalPlaces: 2 }] }) });
  assert.equal(body.currencyCode, "USD");
  assert.equal(body.chargeAppliesTo, 1);
  assert.equal(body.chargeTimeType, 1);
  assert.equal(body.chargeCalculationType, 1);
  assert.equal(body.chargePaymentMode, 0);
  assert.equal(body.penalty, false);
  assert.equal(body.amount, 10000);
});

test("savings charge omits payment mode and applies-to stays savings", function () {
  const body = forms.chargePayload({
    name: "Withdrawal fee",
    amount: "2.5",
    currencyCode: "USD",
    chargeAppliesTo: "2",
    chargeTimeType: "5",
    chargeCalculationType: "2",
    active: "true"
  }, { pack: forms.currencyPack({ selectedCurrencyOptions: [{ code: "USD", decimalPlaces: 2 }] }) });
  assert.equal(body.chargeAppliesTo, 2);
  assert.equal(body.chargeTimeType, 5);
  assert.equal(body.chargeCalculationType, 2);
  assert.equal(body.chargePaymentMode, undefined);
  assert.equal(body.amount, 2.5);
});

test("edit charge does not send applies-to", function () {
  const body = forms.chargePayload({
    name: "Processing fee",
    amount: "5000",
    currencyCode: "UGX",
    chargeAppliesTo: "1",
    chargeTimeType: "9",
    chargeCalculationType: "2",
    active: "false"
  }, { editing: true, pack: ugxAndUsd() });
  assert.equal(body.chargeAppliesTo, undefined);
  assert.equal(body.penalty, true);
  assert.equal(body.active, false);
  assert.equal(body.chargePaymentMode, 0);
});

test("rejects a loan time type on a savings charge", function () {
  assert.throws(function () {
    forms.chargePayload({
      name: "Bad",
      amount: "10",
      currencyCode: "UGX",
      chargeAppliesTo: "2",
      chargeTimeType: "1",
      chargeCalculationType: "1"
    }, { pack: ugxAndUsd() });
  }, /time type/);
});

test("loan product uses NONE accounting and the standard strategy", function () {
  const body = forms.loanProductPayload({
    name: "SACCO Declining Loan",
    shortName: "SDL",
    currencyCode: "UGX",
    principal: "1000000",
    minPrincipal: "100000",
    maxPrincipal: "50000000",
    numberOfRepayments: "12",
    minNumberOfRepayments: "3",
    maxNumberOfRepayments: "36",
    repaymentEvery: "1",
    interestRatePerPeriod: "2",
    minInterestRatePerPeriod: "0.5",
    maxInterestRatePerPeriod: "5"
  }, ugxAndUsd());
  assert.equal(body.accountingRule, 1);
  assert.equal(body.transactionProcessingStrategyCode, "mifos-standard-strategy");
  assert.equal(body.currencyCode, "UGX");
  assert.equal(body.digitsAfterDecimal, 0);
  assert.equal(body.repaymentFrequencyType, 2);
  assert.equal(body.interestRateFrequencyType, 2);
  GL_KEYS.forEach(function (key) { assert.equal(body[key], undefined); });
});

test("savings product matches the voluntary NONE fallback", function () {
  const body = forms.savingsProductPayload({
    name: "Voluntary Savings",
    shortName: "VS",
    description: "",
    currencyCode: "USD",
    nominalAnnualInterestRate: "3"
  }, forms.currencyPack({ selectedCurrencyOptions: [{ code: "USD", decimalPlaces: 2 }] }));
  assert.equal(body.accountingRule, 1);
  assert.equal(body.interestCompoundingPeriodType, 4);
  assert.equal(body.interestPostingPeriodType, 4);
  assert.equal(body.interestCalculationType, 1);
  assert.equal(body.interestCalculationDaysInYearType, 365);
  assert.equal(body.withdrawalFeeForTransfers, false);
  assert.equal(body.digitsAfterDecimal, 2);
  assert.equal(body.description, "Pivot SACCO voluntary savings");
  GL_KEYS.forEach(function (key) { assert.equal(body[key], undefined); });
});

test("short name and principal order are checked before post", function () {
  const pack = ugxAndUsd();
  assert.throws(function () {
    forms.loanProductPayload({
      name: "Wide",
      shortName: "TOOLONG",
      currencyCode: "UGX",
      principal: "1000",
      minPrincipal: "100",
      maxPrincipal: "5000",
      numberOfRepayments: "12",
      minNumberOfRepayments: "3",
      maxNumberOfRepayments: "36",
      repaymentEvery: "1",
      interestRatePerPeriod: "2",
      minInterestRatePerPeriod: "0.5",
      maxInterestRatePerPeriod: "5"
    }, pack);
  }, /Short name/);
  assert.throws(function () {
    forms.loanProductPayload({
      name: "Wide",
      shortName: "WIDE",
      currencyCode: "UGX",
      principal: "50",
      minPrincipal: "100",
      maxPrincipal: "5000",
      numberOfRepayments: "12",
      minNumberOfRepayments: "3",
      maxNumberOfRepayments: "36",
      repaymentEvery: "1",
      interestRatePerPeriod: "2",
      minInterestRatePerPeriod: "0.5",
      maxInterestRatePerPeriod: "5"
    }, pack);
  }, /Principal/);
});
