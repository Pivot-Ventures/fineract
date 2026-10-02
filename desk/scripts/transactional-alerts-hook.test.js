"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../assets/transactional-alerts.js"), "utf8");

test("the hook does not use FineractAPI.get", function () {
  assert.doesNotMatch(src, /FineractAPI\.get\s*\(/);
});

function load(fetchImpl, sessionImpl) {
  const sandbox = {
    fetch: fetchImpl,
    sessionStorage: { getItem: function () { return ""; } },
    FineractAPI: {
      BASE: "/fineract-provider/api/v1",
      DEFAULT_TENANT: "default",
      getSession: sessionImpl || function () {
        return { tenantId: "default", base64EncodedAuthenticationKey: "staff-key" };
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

function wait() {
  return new Promise(function (resolve) { setTimeout(resolve, 30); });
}

test("notify posts the event when the phone is already known", async function () {
  const calls = [];
  const sandbox = load(function (url, opts) {
    calls.push({ url: String(url), opts: opts });
    return Promise.resolve({ ok: true, json: async function () { return {}; } });
  });
  sandbox.TransactionalAlerts.notify({ type: "deposit", phone: "0772000111", amount: 10, account: "1" });
  await wait();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/alerts/api/v1/events");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.type, "deposit");
  assert.equal(body.phone, "0772000111");
  assert.equal(body.amount, 10);
  assert.equal(calls[0].opts.keepalive, true);
});

test("notify looks up mobileNo and skips the event when the member has none", async function () {
  const calls = [];
  const sandbox = load(function (url) {
    calls.push(String(url));
    return Promise.resolve({
      ok: true,
      json: async function () { return { id: 9, mobileNo: "" }; }
    });
  });
  sandbox.TransactionalAlerts.notify({ type: "pin", memberId: "9" });
  await wait();
  assert.deepEqual(calls, ["/fineract-provider/api/v1/clients/9"]);
});

test("notify resolves a teller savings account before posting", async function () {
  const calls = [];
  const sandbox = load(function (url, opts) {
    calls.push({ url: String(url), opts: opts });
    if (String(url).indexOf("/savingsaccounts/") >= 0) {
      return Promise.resolve({ ok: true, json: async function () { return { accountNo: "0008", clientId: 4, clientName: "Achieng" }; } });
    }
    if (String(url).indexOf("/clients/") >= 0) {
      return Promise.resolve({ ok: true, json: async function () { return { mobileNo: "0772000222", displayName: "Achieng" }; } });
    }
    return Promise.resolve({ ok: true, json: async function () { return { ok: true }; } });
  });
  sandbox.TransactionalAlerts.notify({ type: "deposit", savingsAccountId: "15", amount: 5000, currency: "UGX" });
  await wait();
  assert.equal(calls[0].url, "/fineract-provider/api/v1/savingsaccounts/15");
  assert.equal(calls[0].opts.headers.Authorization, "Basic staff-key");
  assert.equal(calls[1].url, "/fineract-provider/api/v1/clients/4");
  const body = JSON.parse(calls[2].opts.body);
  assert.equal(body.phone, "0772000222");
  assert.equal(body.account, "0008");
  assert.equal(body.memberId, "4");
  assert.equal(body.meta.memberName, "Achieng");
});

test("notify does not throw when fetch fails", async function () {
  const sandbox = load(function () { return Promise.reject(new Error("offline")); });
  assert.doesNotThrow(function () {
    sandbox.TransactionalAlerts.notify({ type: "withdrawal", phone: "0772000111", amount: 1 });
  });
  await wait();
});
