"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../assets/transactional-alerts.js"), "utf8");

test("the hook does not use FineractAPI.get, sessionStorage keys, or Fineract lookups", function () {
  assert.doesNotMatch(src, /FineractAPI\.get\s*\(/);
  assert.doesNotMatch(src, /sessionStorage/);
  assert.doesNotMatch(src, /X-Alerts-Key/);
  assert.doesNotMatch(src, /fineract-provider/);
});

function load(fetchImpl, sessionImpl) {
  const sandbox = {
    fetch: fetchImpl,
    FineractAPI: {
      getSession: sessionImpl || function () {
        return { tenantId: "default", base64EncodedAuthenticationKey: "dGVsbGVyOnB3" };
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

function wait() {
  return new Promise(function (resolve) { setTimeout(resolve, 20); });
}

function recorder() {
  const calls = [];
  const fn = function (url, opts) {
    calls.push({ url: String(url), opts: opts, body: JSON.parse(opts.body) });
    return Promise.resolve({ ok: true });
  };
  fn.calls = calls;
  return fn;
}

test("deposit sends only the ids, with the staff session header and keepalive", async function () {
  const fetchMock = recorder();
  const sandbox = load(fetchMock);
  sandbox.TransactionalAlerts.notify({
    type: "deposit", savingsAccountId: 15, transactionId: 501,
    amount: 999, phone: "0772000111", memberId: 4, meta: { memberName: "x" }
  });
  await wait();
  assert.equal(fetchMock.calls.length, 1);
  const call = fetchMock.calls[0];
  assert.equal(call.url, "/alerts/api/v1/events");
  assert.deepEqual(call.body, { type: "deposit", transactionId: "501", savingsAccountId: "15" });
  assert.equal(call.opts.headers["X-Staff-Authorization"], "Basic dGVsbGVyOnB3");
  assert.equal(call.opts.keepalive, true);
  assert.equal(call.opts.method, "POST");
});

test("loan and transfer payloads", async function () {
  const fetchMock = recorder();
  const sandbox = load(fetchMock);
  sandbox.TransactionalAlerts.notify({ type: "loan_repay", loanId: "7", transactionId: "801" });
  sandbox.TransactionalAlerts.notify({ type: "loan_disburse", loanId: 7, transactionId: 802 });
  sandbox.TransactionalAlerts.notify({ type: "transfer", transferId: 90, amount: 5 });
  sandbox.TransactionalAlerts.notify({ type: "withdrawal", savingsAccountId: 15, transactionId: 503 });
  await wait();
  assert.deepEqual(fetchMock.calls.map(function (c) { return c.body; }), [
    { type: "loan_repay", transactionId: "801", loanId: "7" },
    { type: "loan_disburse", transactionId: "802", loanId: "7" },
    { type: "transfer", transferId: "90" },
    { type: "withdrawal", transactionId: "503", savingsAccountId: "15" }
  ]);
});

test("nothing is sent without an id, for a pending maker-checker result, for other types, or without a session", async function () {
  const fetchMock = recorder();
  const sandbox = load(fetchMock);
  sandbox.TransactionalAlerts.notify({ type: "deposit", savingsAccountId: 15 });
  sandbox.TransactionalAlerts.notify({ type: "deposit", savingsAccountId: 15, transactionId: undefined });
  sandbox.TransactionalAlerts.notify({ type: "deposit", savingsAccountId: 15, transactionId: "15/../1" });
  sandbox.TransactionalAlerts.notify({ type: "deposit", savingsAccountId: 15, transactionId: 15, pending: true });
  sandbox.TransactionalAlerts.notify({ type: "pin", memberId: 9 });
  sandbox.TransactionalAlerts.notify({ type: "activation", memberId: 9 });
  sandbox.TransactionalAlerts.notify({ type: "transfer" });
  sandbox.TransactionalAlerts.notify(null);
  await wait();
  assert.equal(fetchMock.calls.length, 0);
  const noSession = recorder();
  load(noSession, function () { return null; }).TransactionalAlerts.notify({ type: "transfer", transferId: 1 });
  await wait();
  assert.equal(noSession.calls.length, 0);
});

test("notify does not throw when fetch rejects or throws", async function () {
  const rejecting = load(function () { return Promise.reject(new Error("offline")); });
  assert.doesNotThrow(function () {
    rejecting.TransactionalAlerts.notify({ type: "withdrawal", savingsAccountId: 1, transactionId: 2 });
  });
  const throwing = load(function () { throw new Error("blocked"); });
  assert.doesNotThrow(function () {
    throwing.TransactionalAlerts.notify({ type: "withdrawal", savingsAccountId: 1, transactionId: 2 });
  });
  await wait();
});
