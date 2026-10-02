"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../assets/desk-writes.js");

function gl(id, code, typeId, name) {
  return { id: id, glCode: code, name: name || code, disabled: false, type: { id: typeId }, usage: { id: 1 } };
}

const CHART = [
  gl(1, "1110", 1, "Cash on Hand"),
  gl(2, "1120", 1, "Cash at Bank"),
  gl(3, "1130", 1, "Loan portfolio"),
  gl(4, "2110", 2, "Member deposits"),
  gl(5, "2120", 2, "Suspense"),
  gl(6, "3100", 3, "Share capital"),
  gl(7, "4110", 4, "Interest income"),
  gl(8, "4120", 4, "Fee income"),
  gl(9, "4130", 4, "Penalty income"),
  gl(10, "5110", 5, "Interest expense"),
  gl(11, "5130", 5, "Write off"),
  gl(12, "5140", 5, "Losses written off")
];

const UGX = { selectedCurrencyOptions: [{ code: "UGX", decimalPlaces: 0 }, { code: "USD", decimalPlaces: 2 }] };
const USD = { selectedCurrencyOptions: [{ code: "USD", decimalPlaces: 2 }] };

test("currency prefers UGX and falls back without throwing", function () {
  assert.deepEqual(W.currencyPack(UGX), { code: "UGX", digitsAfterDecimal: 0 });
  assert.deepEqual(W.currencyPack(USD), { code: "USD", digitsAfterDecimal: 2 });
  assert.deepEqual(W.currencyPack({ selectedCurrencyOptions: [] }), { code: "UGX", digitsAfterDecimal: 0 });
  assert.deepEqual(W.currencyPack(null), { code: "UGX", digitsAfterDecimal: 0 });
});

test("pickGl prefers the live vault and teller codes", function () {
  assert.equal(W.pickGl(CHART, { code: "1110", typeId: 1 }).id, 1);
  assert.equal(W.pickGl(CHART, { code: "1120", typeId: 1 }).id, 2);
  assert.equal(W.pickGl(CHART, { code: "9999", typeId: 3 }).glCode, "3100");
});

test("floating rate period is explicit and not a differential", function () {
  const body = W.floatingRatePayload({
    name: "BOU base",
    isBaseLendingRate: "true",
    isActive: "true",
    fromDate: "2026-10-02",
    interestRate: "10.5"
  });
  assert.equal(body.isBaseLendingRate, true);
  assert.equal(body.ratePeriods.length, 1);
  assert.equal(body.ratePeriods[0].fromDate, "2026-10-02");
  assert.equal(body.ratePeriods[0].interestRate, 10.5);
  assert.equal(body.ratePeriods[0].isDifferentialToBaseLendingRate, false);
  assert.equal(body.ratePeriods[0].dateFormat, "yyyy-MM-dd");
  assert.throws(function () { W.floatingRatePayload({ name: "", fromDate: "2026-10-02", interestRate: "1" }); }, /Name/);
});

test("business date is the day before a floating-rate period", function () {
  const iso = W.businessDateIso([{ type: "BUSINESS_DATE", date: [2026, 10, 1] }], "2026-01-01");
  assert.equal(iso, "2026-10-01");
  assert.equal(W.addDays(iso, 1), "2026-10-02");
});

test("share product NONE omits GL ids and cash includes the four accounts", function () {
  const none = W.shareProductPayload({
    name: "Member shares", shortName: "MSHR", totalShares: "10000", nominalShares: "1", unitPrice: "10000", accountingRule: "1"
  }, W.currencyPack(UGX), CHART);
  assert.equal(none.accountingRule, 1);
  assert.equal(none.currencyCode, "UGX");
  assert.equal(none.shareReferenceId, undefined);
  assert.equal(none.nominalShares, 1);
  assert.equal(none.maximumShares, 10000);
  assert.equal(none.allowDividendCalculationForInactiveClients, false);

  const cash = W.shareProductPayload({
    name: "Member shares", totalShares: "10000", nominalShares: "5", unitPrice: "10000", accountingRule: "2"
  }, W.currencyPack(UGX), CHART);
  assert.equal(cash.shareReferenceId, 2);
  assert.equal(cash.shareSuspenseId, 5);
  assert.equal(cash.shareEquityId, 6);
  assert.equal(cash.incomeFromFeeAccountId, 8);
  assert.throws(function () {
    W.shareProductPayload({
      name: "Member shares", totalShares: "10", nominalShares: "5", unitPrice: "1", accountingRule: "2"
    }, W.currencyPack(UGX), CHART.filter(function (g) { return g.type.id !== 3; }));
  }, /shareEquityId/);
});

test("fixed deposit includes a chart and cash GLs only for rule 2", function () {
  const fd = W.fixedDepositPayload({
    name: "Fixed 12", interestRate: "8", depositAmount: "500000", accountingRule: "2"
  }, W.currencyPack(UGX), CHART);
  assert.equal(fd.interestPostingPeriodType, 4);
  assert.equal(fd.minDepositTermTypeId, 2);
  assert.equal(fd.depositAmount, 500000);
  assert.equal(fd.charts[0].chartSlabs[0].annualInterestRate, 8);
  assert.equal(fd.charts[0].fromDate, "2010-01-01");
  assert.equal(fd.savingsReferenceAccountId, 2);
  assert.equal(fd.savingsControlAccountId, 4);
  assert.equal(fd.overdraftPortfolioControlId, undefined);
  const none = W.fixedDepositPayload({
    name: "Fixed 12", interestRate: "8", depositAmount: "500000", accountingRule: "1"
  }, W.currencyPack(USD), CHART);
  assert.equal(none.currencyCode, "USD");
  assert.equal(none.savingsReferenceAccountId, undefined);
});

test("recurring deposit keeps the fixed-deposit chart and adds the schedule", function () {
  const rd = W.recurringDepositPayload({
    name: "Monthly RD", interestRate: "6", depositAmount: "20000", accountingRule: "1"
  }, W.currencyPack(UGX), CHART);
  assert.equal(rd.recurringFrequency, 1);
  assert.equal(rd.recurringFrequencyType, 2);
  assert.equal(rd.isMandatoryDeposit, false);
  assert.equal(rd.charts.length, 1);
});

test("loan and savings edits send cash GLs only for rule 2", function () {
  const loanNone = W.loanProductUpdate({
    name: "Growth", shortName: "GROW", principal: "1000000", numberOfRepayments: "12", interestRatePerPeriod: "2", accountingRule: "1"
  }, CHART);
  assert.equal(loanNone.accountingRule, 1);
  assert.equal(loanNone.fundSourceAccountId, undefined);
  assert.equal(loanNone.locale, "en");

  const loanCash = W.loanProductUpdate({
    name: "Growth", principal: "1000000", numberOfRepayments: "12", interestRatePerPeriod: "2", accountingRule: "2",
    fundSourceAccountId: "1"
  }, CHART);
  assert.equal(loanCash.fundSourceAccountId, 1);
  assert.equal(loanCash.loanPortfolioAccountId, 3);
  assert.equal(loanCash.interestOnLoanAccountId, 7);
  assert.equal(loanCash.writeOffAccountId, 11);

  const sav = W.savingsProductUpdate({
    name: "Voluntary", nominalAnnualInterestRate: "3", accountingRule: "2"
  }, CHART);
  assert.equal(sav.savingsReferenceAccountId, 2);
  assert.equal(sav.savingsControlAccountId, 4);
  assert.equal(sav.overdraftPortfolioControlId, 3);
  assert.equal(sav.lossesWrittenOffAccountId, 12);
});

test("provisioning, address, share purchase, and accounting rule payloads", function () {
  const criteria = W.provisioningCriteriaPayload({
    criteriaName: "Standard", categoryId: "3", minAge: "0", maxAge: "30", provisioningPercentage: "5",
    liabilityAccount: "4", expenseAccount: "11"
  });
  assert.equal(criteria.definitions.length, 1);
  assert.equal(criteria.definitions[0].liabilityAccount, 4);
  assert.equal(criteria.definitions[0].expenseAccount, 11);
  assert.throws(function () {
    W.provisioningCriteriaPayload({
      criteriaName: "Bad", categoryId: "3", minAge: "10", maxAge: "10", provisioningPercentage: "1",
      liabilityAccount: "4", expenseAccount: "11"
    });
  }, /Max age/);

  const entry = W.provisioningEntryPayload({ date: "2026-10-01", createjournalentries: "false" });
  assert.equal(entry.createjournalentries, false);
  assert.equal(entry.dateFormat, "yyyy-MM-dd");

  const addr = W.addressPayload({ addressTypeId: "1", addressLine1: "Plot 12", city: "Kampala", countryId: "9" });
  assert.equal(addr.addressTypeId, 1);
  assert.equal(addr.isActive, true);
  assert.equal(addr.countryId, 9);

  const buy = W.shareAccountPayload({
    clientId: "8", productId: "2", savingsAccountId: "15", requestedShares: "5", date: "2026-10-01"
  });
  assert.equal(buy.submittedDate, "2026-10-01");
  assert.equal(buy.applicationDate, "2026-10-01");
  assert.equal(W.shareApprovePayload("2026-10-01").approvedDate, "2026-10-01");
  assert.equal(W.shareActivatePayload("2026-10-01").activatedDate, "2026-10-01");

  const defaults = W.accountingRuleDefaults(CHART);
  assert.equal(defaults.debitId, 1);
  assert.equal(defaults.creditId, 4);
  const rule = W.accountingRulePayload({ name: "Vault to deposits", debit: "1", credit: "4", officeId: "2" });
  assert.equal(rule.accountToDebit, 1);
  assert.equal(rule.accountToCredit, 4);
  assert.throws(function () { W.accountingRulePayload({ name: "Same", debit: "1", credit: "1" }); }, /different/);
});

test("recurring deposit account and lifecycle payloads", function () {
  const open = W.recurringDepositAccountPayload({
    clientId: "8", productId: "3", submittedOnDate: "2026-10-01",
    depositAmount: "20000", depositPeriod: "12", linkAccountId: "15"
  });
  assert.equal(open.clientId, 8);
  assert.equal(open.productId, 3);
  assert.equal(open.depositPeriodFrequencyId, 2);
  assert.equal(open.mandatoryRecommendedDepositAmount, 20000);
  assert.equal(open.linkAccountId, 15);
  assert.equal(open.locale, "en");
  assert.equal(open.dateFormat, "yyyy-MM-dd");
  assert.throws(function () { W.recurringDepositAccountPayload({ productId: "3", submittedOnDate: "2026-10-01", depositAmount: "1", depositPeriod: "1" }); }, /Client/);

  assert.equal(W.recurringDepositApprovePayload("2026-10-02").approvedOnDate, "2026-10-02");
  assert.equal(W.recurringDepositActivatePayload("2026-10-03").activatedOnDate, "2026-10-03");
  const txn = W.recurringDepositTxnPayload({ date: "2026-10-04", amount: "20000", paymentTypeId: "4", note: "cash" });
  assert.equal(txn.transactionAmount, 20000);
  assert.equal(txn.paymentTypeId, 4);
  const close = W.recurringDepositClosePayload({ date: "2027-10-01", onAccountClosureId: "100", toSavingsAccountId: "15" });
  assert.equal(close.onAccountClosureId, 100);
  assert.equal(close.toSavingsAccountId, 15);
});

test("settings payloads: configuration, currencies, payment type, fund, holiday, working days", function () {
  assert.deepEqual(W.configurationUpdatePayload({ enabled: "false" }), { enabled: false });
  assert.equal(W.configurationUpdatePayload({ value: "12" }).value, 12);
  assert.equal(W.configurationUpdatePayload({ value: "enable-address" }).value, "enable-address");
  assert.throws(function () { W.configurationUpdatePayload({}); }, /enabled or a value/);

  assert.deepEqual(W.currenciesUpdatePayload(["ugx", "UGX", "usd"]), { currencies: ["UGX", "USD"] });
  assert.throws(function () { W.currenciesUpdatePayload(["xx"]); }, /at least one/);

  const pay = W.paymentTypePayload({ name: "Mobile money", description: "MTN", isCashPayment: "false", position: "2" });
  assert.equal(pay.isCashPayment, false);
  assert.equal(pay.position, 2);
  assert.deepEqual(W.fundPayload({ name: "Member fund", externalId: "MF-1" }), { name: "Member fund", externalId: "MF-1" });

  const holiday = W.holidayPayload({
    name: "Independence", officeId: "1", fromDate: "2026-10-09", toDate: "2026-10-09", reschedulingType: "2", repaymentsRescheduledTo: "2026-10-12"
  });
  assert.equal(holiday.reschedulingType, 2);
  assert.equal(holiday.offices[0].officeId, 1);
  assert.equal(holiday.repaymentsRescheduledTo, "2026-10-12");
  assert.throws(function () {
    W.holidayPayload({ name: "Bad", officeId: "1", fromDate: "2026-10-10", toDate: "2026-10-01" });
  }, /To date/);
  assert.throws(function () {
    W.holidayPayload({ name: "Specific", officeId: "1", fromDate: "2026-10-09", reschedulingType: "2" });
  }, /Reschedule to/);

  const days = W.workingDaysPayload({ days: ["MO", "tu", "MO"], repaymentRescheduleType: "2", extendTermForDailyRepayments: "true" });
  assert.equal(days.recurrence, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU");
  assert.equal(days.repaymentRescheduleType, 2);
  assert.equal(days.extendTermForDailyRepayments, true);
  assert.throws(function () { W.workingDaysPayload({ days: ["MO"], repaymentRescheduleType: "9" }); }, /1 to 4/);
});

test("account extras: standing instruction, reschedule, dividend, tax, delinquency, staff, user", function () {
  const si = W.standingInstructionPayload({
    name: "Monthly transfer", fromOfficeId: "1", fromClientId: "8", fromAccountId: "15", toAccountId: "16",
    amount: "5000", validFrom: "2026-10-01", recurrenceFrequency: "2", recurrenceOnMonthDay: "01 October"
  });
  assert.equal(si.fromAccountType, 2);
  assert.equal(si.transferType, 1);
  assert.equal(si.recurrenceFrequency, 2);
  assert.equal(si.monthDayFormat, "dd MMMM");
  assert.throws(function () { W.standingInstructionPayload({ name: "x", fromAccountId: "1", toAccountId: "2", amount: "1", validFrom: "2026-10-01" }); }, /from account/);
  assert.throws(function () {
    W.standingInstructionPayload({ name: "x", fromClientId: "1", fromAccountId: "1", toAccountId: "2", amount: "1", validFrom: "2026-10-01" });
  }, /From office/);

  const rs = W.loanReschedulePayload({
    loanId: "9", rescheduleFromDate: "2026-11-01", rescheduleReasonId: "4", extraTerms: "2", adjustedDueDate: "2026-11-15"
  });
  assert.equal(rs.loanId, 9);
  assert.equal(rs.submittedOnDate, "2026-11-01");
  assert.equal(rs.extraTerms, 2);
  assert.throws(function () {
    W.loanReschedulePayload({ loanId: "9", rescheduleFromDate: "2026-11-01", rescheduleReasonId: "4", adjustedDueDate: "2026-10-01" });
  }, /before the reschedule/);

  const div = W.shareDividendPayload({ dividendPeriodStartDate: "2026-01-01", dividendPeriodEndDate: "2026-10-01", dividendAmount: "100000" });
  assert.equal(div.dividendAmount, 100000);
  assert.throws(function () {
    W.shareDividendPayload({ dividendPeriodStartDate: "2026-10-01", dividendPeriodEndDate: "2026-01-01", dividendAmount: "1" });
  }, /Period end/);

  const tax = W.taxComponentPayload({ name: "WHT", percentage: "10", startDate: "2026-10-01", creditAccountId: "4" });
  assert.equal(tax.creditAccountType, 2);
  assert.equal(tax.percentage, 10);
  assert.throws(function () { W.taxComponentPayload({ name: "WHT", percentage: "10", startDate: "2026-10-01" }); }, /credit or debit/);
  const group = W.taxGroupPayload({ name: "Standard", taxComponentId: "3", startDate: "2026-10-01" });
  assert.equal(group.taxComponents[0].taxComponentId, 3);

  const range = W.delinquencyRangePayload({ classification: "Watch", minimumAgeDays: "1", maximumAgeDays: "30" });
  assert.equal(range.minimumAgeDays, 1);
  assert.throws(function () { W.delinquencyRangePayload({ classification: "Bad", minimumAgeDays: "30", maximumAgeDays: "30" }); }, /greater than minimum/);
  assert.deepEqual(W.delinquencyBucketPayload({ name: "Standard", ranges: "1, 2" }), { name: "Standard", ranges: [1, 2] });

  const staff = W.staffPayload({ officeId: "1", firstname: "Mary", lastname: "N", isLoanOfficer: "true", joiningDate: "2026-10-01", mobileNo: "0700" });
  assert.equal(staff.isLoanOfficer, true);
  assert.equal(staff.mobileNo, "0700");

  const user = W.userPayload({
    username: "teller1", firstname: "Mary", lastname: "N", email: "mary@example.com",
    officeId: "1", roles: "2", password: "secret", repeatPassword: "secret", staffId: "5"
  });
  assert.deepEqual(user.roles, [2]);
  assert.equal(user.sendPasswordToEmail, false);
  assert.equal(user.staffId, 5);
  const updated = W.userPayload({
    username: "teller1", firstname: "Mary", lastname: "N", email: "mary@example.com", officeId: "1", roles: [2]
  }, true);
  assert.equal(updated.password, undefined);
  assert.throws(function () {
    W.userPayload({ username: "a", firstname: "b", lastname: "c", email: "mary@example.com", officeId: "1", roles: "2", password: "a", repeatPassword: "b" });
  }, /do not match/);
  assert.throws(function () {
    W.userPayload({ username: "a", firstname: "b", lastname: "c", email: "not-an-email", officeId: "1", roles: "2", password: "a", repeatPassword: "a" });
  }, /valid email/);
});
