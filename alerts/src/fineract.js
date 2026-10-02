"use strict";

/**
 * Staff (Desk) events carry only ids. Every fact in the message is read
 * here from Fineract with the staff member's own Basic credentials, so a
 * browser cannot choose the amount, the phone, or the text.
 */

const ID_RE = /^[1-9]\d{0,17}$/;

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function idOf(value, name) {
  const text = String(value == null ? "" : value).trim();
  if (!ID_RE.test(text)) throw fail(name + " must be a Fineract id", 400);
  return text;
}

async function get(path, principal, deps) {
  const config = deps.config;
  let res;
  try {
    res = await deps.http({
      url: config.fineractUrl + path,
      method: "GET",
      headers: {
        Accept: "application/json",
        "Fineract-Platform-TenantId": config.fineractTenant,
        Authorization: "Basic " + principal.basicKey
      }
    });
  } catch (err) {
    throw fail("core banking unreachable", 503);
  }
  if (res.status === 404) throw fail("not found in core banking", 404);
  if (res.status === 401 || res.status === 403) throw fail("staff cannot read this record", 403);
  if (res.status < 200 || res.status >= 300 || !res.json || typeof res.json !== "object") {
    throw fail("core banking error", 502);
  }
  return res.json;
}

function sameId(a, b) {
  return a === undefined || a === null || String(a) === String(b);
}

function receipt(tx, fallback) {
  const detail = tx && tx.paymentDetailData;
  const raw = detail && detail.receiptNumber ? String(detail.receiptNumber) : "";
  const clean = raw.replace(/[^A-Za-z0-9/_-]/g, "").slice(0, 30);
  return clean || fallback;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function savingsAvailable(account, tx) {
  const summary = (account && account.summary) || {};
  const pick = [summary.availableBalance, tx && tx.runningBalance, summary.accountBalance]
    .map(num).filter(function (n) { return n !== null; });
  return pick.length ? pick[0] : null;
}

async function member(clientId, principal, deps) {
  if (clientId === undefined || clientId === null || clientId === "") throw fail("account has no individual member", 422);
  const client = await get("/clients/" + encodeURIComponent(idOf(clientId, "clientId")), principal, deps);
  return { phone: client.mobileNo || "", memberName: client.displayName || "", memberId: String(clientId) };
}

function savingsTypeMatches(type, tx) {
  const t = (tx && tx.transactionType) || {};
  const code = String(t.code || "");
  if (type === "deposit") return t.deposit === true || /\.deposit$/.test(code);
  if (type === "withdrawal") return t.withdrawal === true || /\.withdrawal$/.test(code);
  return false;
}

function loanTypeMatches(type, tx) {
  const t = (tx && tx.type) || {};
  const code = String(t.code || "");
  if (type === "loan_disburse") return t.disbursement === true || /\.disbursement$/.test(code);
  if (type === "loan_repay") return t.repayment === true || /\.repayment$/.test(code);
  return false;
}

async function savingsFacts(type, body, principal, deps) {
  const accountId = idOf(body.savingsAccountId, "savingsAccountId");
  const txId = idOf(body.transactionId, "transactionId");
  const tx = await get("/savingsaccounts/" + accountId + "/transactions/" + txId, principal, deps);
  if (!sameId(tx.id, txId) || !sameId(tx.accountId, accountId)) throw fail("transaction does not belong to that account", 409);
  if (tx.reversed === true) throw fail("transaction is reversed", 409);
  if (!savingsTypeMatches(type, tx)) throw fail("transaction is not a " + type, 409);
  const account = await get("/savingsaccounts/" + accountId, principal, deps);
  const who = await member(account.clientId, principal, deps);
  return Object.assign(who, {
    key: type + ":" + accountId + ":" + txId,
    amount: num(tx.amount),
    currency: (tx.currency && tx.currency.code) || (account.currency && account.currency.code) || "UGX",
    account: account.accountNo || tx.accountNo || "",
    balance: savingsAvailable(account, tx),
    reference: receipt(tx, "TX" + txId),
    date: tx.date
  });
}

async function loanFacts(type, body, principal, deps) {
  const loanId = idOf(body.loanId, "loanId");
  const txId = idOf(body.transactionId, "transactionId");
  const tx = await get("/loans/" + loanId + "/transactions/" + txId, principal, deps);
  if (!sameId(tx.id, txId) || !sameId(tx.loanId, loanId)) throw fail("transaction does not belong to that loan", 409);
  if (tx.manuallyReversed === true || tx.reversed === true) throw fail("transaction is reversed", 409);
  if (!loanTypeMatches(type, tx)) throw fail("transaction is not a " + type, 409);
  const loan = await get("/loans/" + loanId, principal, deps);
  const who = await member(loan.clientId, principal, deps);
  const outstanding = num(tx.outstandingLoanBalance);
  return Object.assign(who, {
    key: type + ":" + loanId + ":" + txId,
    amount: num(tx.amount),
    currency: (tx.currency && tx.currency.code) || (loan.currency && loan.currency.code) || "UGX",
    account: loan.accountNo || "",
    balance: outstanding !== null ? outstanding : num(loan.summary && loan.summary.totalOutstanding),
    reference: receipt(tx, "TX" + txId),
    date: tx.date
  });
}

async function transferFacts(body, principal, deps) {
  const transferId = idOf(body.transferId, "transferId");
  const transfer = await get("/accounttransfers/" + transferId, principal, deps);
  if (!sameId(transfer.id, transferId)) throw fail("transfer id mismatch", 409);
  if (transfer.reversed === true) throw fail("transfer is reversed", 409);
  const fromType = transfer.fromAccountType || {};
  if (!(Number(fromType.id) === 2 || /savings/i.test(String(fromType.code || "")))) {
    throw fail("only transfers out of a savings account send an alert", 422);
  }
  const fromAccountId = idOf(transfer.fromAccount && transfer.fromAccount.id, "fromAccount");
  const account = await get("/savingsaccounts/" + fromAccountId, principal, deps);
  const clientId = account.clientId != null ? account.clientId : (transfer.fromClient && transfer.fromClient.id);
  const who = await member(clientId, principal, deps);
  return Object.assign(who, {
    key: "transfer:" + fromAccountId + ":" + transferId,
    amount: num(transfer.transferAmount),
    currency: (transfer.currency && transfer.currency.code) || "UGX",
    account: account.accountNo || (transfer.fromAccount && transfer.fromAccount.accountNo) || "",
    balance: savingsAvailable(account, null),
    reference: "TR" + transferId,
    date: transfer.transferDate
  });
}

const STAFF_TYPES = ["deposit", "withdrawal", "loan_disburse", "loan_repay", "transfer"];

async function staffFacts(body, principal, deps) {
  const type = String(body.type || "");
  if (STAFF_TYPES.indexOf(type) < 0) throw fail("type must be one of " + STAFF_TYPES.join(", "), 400);
  if (type === "deposit" || type === "withdrawal") return savingsFacts(type, body, principal, deps);
  if (type === "loan_disburse" || type === "loan_repay") return loanFacts(type, body, principal, deps);
  return transferFacts(body, principal, deps);
}

module.exports = { staffFacts, STAFF_TYPES };
