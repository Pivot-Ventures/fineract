"use strict";

/* Every outbound call is mocked. Nothing here can reach a real SMS or WhatsApp provider. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { buildSmsRequest, parseSmsResponse } = require("../src/providers/africas-talking");
const { buildWhatsAppRequest, parseWhatsAppResponse } = require("../src/providers/lipechat");
const { normalizePhone, maskPhone } = require("../src/phone");
const { loadConfig, healthBody } = require("../src/config");
const { createFileStore } = require("../src/store");
const { createApp } = require("../src/app");
const { defaultHttp } = require("../src/http");
const { defaultTemplates } = require("../src/templates");

const FINERACT = "http://fineract.test/fineract-provider/api/v1";
const AT_URL = "https://api.africastalking.com/version1/messaging";
const LIPE_URL = "https://gateway.lipachat.com/api/v1/whatsapp/template";
const SERVICE_KEY = "svc-key-0123456789abcdef";
const MEMBER_PHONE_DIGITS = "772123456";

function b64(text) { return Buffer.from(text).toString("base64"); }
const TELLER = b64("teller:pw");
const ADMIN = b64("admin:pw");
const AUDITOR = b64("auditor:pw");

const USERS = {
  "teller:pw": ["READ_SAVINGSACCOUNT", "DEPOSIT_SAVINGSACCOUNT"],
  "admin:pw": ["ALL_FUNCTIONS"],
  "auditor:pw": ["ALERTS_ADMIN"]
};

function fineractRecords() {
  return {
    "/savingsaccounts/15/transactions/501": {
      id: 501, accountId: 15, amount: 250000, runningBalance: 1250000, reversed: false, date: [2026, 10, 2],
      transactionType: { id: 1, code: "savingsAccountTransactionType.deposit", deposit: true, withdrawal: false },
      currency: { code: "UGX" }, paymentDetailData: { receiptNumber: "RCPT-9" }
    },
    "/savingsaccounts/15/transactions/502": {
      id: 502, accountId: 15, amount: 1000, reversed: true, date: [2026, 10, 2],
      transactionType: { id: 1, code: "savingsAccountTransactionType.deposit", deposit: true }
    },
    "/savingsaccounts/15/transactions/503": {
      id: 503, accountId: 15, amount: 1000, reversed: false, date: [2026, 10, 2],
      transactionType: { id: 2, code: "savingsAccountTransactionType.withdrawal", deposit: false, withdrawal: true }
    },
    "/savingsaccounts/15": {
      id: 15, accountNo: "000000015", clientId: 4, currency: { code: "UGX" },
      summary: { accountBalance: 1250000, availableBalance: 1200000 }
    },
    "/savingsaccounts/16": { id: 16, accountNo: "000000016", clientId: 5, summary: { availableBalance: 10 } },
    "/savingsaccounts/16/transactions/601": {
      id: 601, accountId: 16, amount: 5000, reversed: false, date: [2026, 10, 2],
      transactionType: { code: "savingsAccountTransactionType.deposit", deposit: true }
    },
    "/clients/4": { id: 4, mobileNo: "0772 123 456", displayName: "Achieng Auma" },
    "/clients/5": { id: 5, mobileNo: "+44 7700 900123", displayName: "Abroad Member" },
    "/loans/7/transactions/801": {
      id: 801, amount: 100000, outstandingLoanBalance: 400000, manuallyReversed: false, date: [2026, 10, 1],
      type: { id: 2, code: "loanTransactionType.repayment", repayment: true, disbursement: false }, currency: { code: "UGX" }
    },
    "/loans/7": { id: 7, accountNo: "000000007", clientId: 4, summary: { totalOutstanding: 400000 } },
    "/accounttransfers/90": {
      id: 90, reversed: false, transferAmount: 30000, transferDate: [2026, 10, 2], currency: { code: "UGX" },
      fromAccountType: { id: 2, code: "accountType.savings" }, fromAccount: { id: 15, accountNo: "000000015" },
      fromClient: { id: 4 }, toAccountType: { id: 2 }, toAccount: { id: 16 }
    }
  };
}

function atOk() {
  return { status: 201, json: { SMSMessageData: { Message: "Sent to 1/1", Recipients: [{ statusCode: 101, status: "Success", messageId: "ATXid_1", number: "+256772123456" }] } }, text: "" };
}

function mockHttp(overrides) {
  const o = overrides || {};
  const calls = [];
  const records = fineractRecords();
  async function handler(req) {
    calls.push(req);
    if (req.url === FINERACT + "/authentication") {
      const pass = USERS[req.body.username + ":" + req.body.password];
      if (!pass) return { status: 401, json: { userMessageGlobalisationCode: "error.msg.not.authenticated" }, text: "" };
      return { status: 200, json: { authenticated: true, username: req.body.username, permissions: pass }, text: "" };
    }
    if (req.url.startsWith(FINERACT + "/")) {
      const pathPart = req.url.slice(FINERACT.length);
      const row = records[pathPart];
      return row ? { status: 200, json: row, text: "" } : { status: 404, json: { developerMessage: "not found" }, text: "" };
    }
    if (req.url === AT_URL) return o.at ? o.at(req) : atOk();
    if (req.url === LIPE_URL) return o.lipe ? o.lipe(req) : { status: 200, json: { status: "success", data: { messageId: "lip-1" } }, text: "" };
    throw new Error("unexpected URL " + req.url);
  }
  handler.calls = calls;
  handler.providerCalls = function () { return calls.filter(function (c) { return c.url === AT_URL || c.url === LIPE_URL; }); };
  return handler;
}

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-"));
  return path.join(dir, "store.json");
}

const LIVE_ENV = {
  FINERACT_URL: FINERACT,
  ALERTS_SERVICE_KEY: SERVICE_KEY,
  ALERTS_LIVE: "true",
  AT_USERNAME: "sandbox",
  AT_API_KEY: "super-secret-at-key",
  AT_SENDER_ID: "PHANEROO",
  LIPECHAT_API_KEY: "super-secret-lipe-key",
  LIPECHAT_FROM: "254700111222"
};

async function harness(env, options) {
  const opts = options || {};
  const logs = [];
  const file = tempFile();
  const httpMock = opts.http || mockHttp(opts.mock);
  const config = loadConfig(Object.assign({ ALERTS_DATA_FILE: file }, env));
  const log = function (line) { logs.push(line); };
  const store = createFileStore(file, { log: log });
  const app = createApp({ store: store, config: config, log: log, http: httpMock });
  const server = http.createServer(function (req, res) {
    Promise.resolve(app(req, res)).catch(function (err) {
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    });
  });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  const base = "http://127.0.0.1:" + server.address().port + "/v1";
  async function call(method, route, body, headers) {
    const res = await fetch(base + route, {
      method: method,
      headers: Object.assign({ "content-type": "application/json" }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (err) { json = null; }
    return { status: res.status, json: json };
  }
  return {
    call: call,
    logs: logs,
    http: httpMock,
    store: store,
    file: file,
    staff: function (key) { return { "X-Staff-Authorization": "Basic " + key }; },
    service: function (key) { return { "X-Alerts-Service-Key": key || SERVICE_KEY }; },
    close: function () { return new Promise(function (resolve) { server.close(resolve); }); }
  };
}

function serviceEvent(extra) {
  return Object.assign({
    type: "transfer",
    idempotencyKey: "gw-transfer-1",
    memberId: "4",
    phone: "0772123456",
    context: { amount: 1500000, account: "000000015", balance: 20000, reference: "MB123", memberName: "Achieng" }
  }, extra || {});
}

/* ------------------------------------------------------------ adapters */

test("Africa's Talking adapter builds the form body and keeps the key in the header", function () {
  const built = buildSmsRequest({
    username: "sandbox", apiKey: "secret-key", from: "PHANEROO", to: "+256700000001", message: "Hello SACCO",
    baseUrl: "https://api.sandbox.africastalking.com/"
  });
  assert.equal(built.url, "https://api.sandbox.africastalking.com/version1/messaging");
  assert.equal(built.headers.apiKey, "secret-key");
  assert.equal(built.body, "username=sandbox&to=%2B256700000001&message=Hello+SACCO&from=PHANEROO");
});

test("Africa's Talking: success needs 2xx, recipients, and status 100/101/102 for each", function () {
  assert.deepEqual(parseSmsResponse(atOk()), { ok: true, providerId: "ATXid_1", error: "" });
  const empty = parseSmsResponse({ status: 201, json: { SMSMessageData: { Message: "Sent to 0/1 Total Cost: 0", Recipients: [] } } });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Sent to 0\/1/);
  const missing = parseSmsResponse({ status: 200, json: {} });
  assert.equal(missing.ok, false);
  const rejected = parseSmsResponse({ status: 201, json: { SMSMessageData: { Recipients: [{ statusCode: 403, status: "InvalidPhoneNumber" }] } } });
  assert.deepEqual([rejected.ok, rejected.error], [false, "InvalidPhoneNumber"]);
  const mixed = parseSmsResponse({ status: 201, json: { SMSMessageData: { Recipients: [{ statusCode: 101 }, { statusCode: 406, status: "UserInBlacklist" }] } } });
  assert.equal(mixed.ok, false);
  const http500 = parseSmsResponse({ status: 500, json: null, text: "boom" });
  assert.equal(http500.ok, false);
  assert.equal(parseSmsResponse({ status: 201, json: { SMSMessageData: { Recipients: [{ statusCode: 102, messageId: "q" }] } } }).ok, true);
});

test("LipeChat adapter builds the template JSON", function () {
  const built = buildWhatsAppRequest({
    apiKey: "lip-secret", baseUrl: "https://gateway.lipachat.com", messageId: "m-1", to: "+256700000001",
    from: "254700111222", templateName: "sacco_deposit", languageCode: "en", placeholders: ["UGX 1,000", "****0001"]
  });
  assert.equal(built.url, LIPE_URL);
  assert.equal(built.headers.apiKey, "lip-secret");
  assert.deepEqual(built.body.template, { name: "sacco_deposit", languageCode: "en", components: { body: { placeholders: ["UGX 1,000", "****0001"] } } });
});

test("LipeChat: a 2xx with an error body is a failure; bodies are parsed defensively", function () {
  assert.equal(parseWhatsAppResponse({ status: 200, json: { status: "error", message: "template not approved" } }).ok, false);
  assert.equal(parseWhatsAppResponse({ status: 200, json: { status: "error", message: "template not approved" } }).error, "template not approved");
  assert.equal(parseWhatsAppResponse({ status: 200, json: { status: "FAILED" } }).ok, false);
  assert.equal(parseWhatsAppResponse({ status: 200, json: { status: false } }).ok, false);
  assert.equal(parseWhatsAppResponse({ status: 200, json: { success: false } }).ok, false);
  assert.equal(parseWhatsAppResponse({ status: 400, json: null, text: "bad" }).ok, false);
  assert.equal(parseWhatsAppResponse({ status: 200, json: ["odd"] }).ok, true);
  assert.deepEqual(parseWhatsAppResponse({ status: 200, json: { status: "success", data: { messageId: "mid-9" } } }), { ok: true, providerId: "mid-9", error: "" });
});

test("every outbound fetch carries a 10 s timeout signal", async function () {
  const original = global.fetch;
  let seen = null;
  global.fetch = async function (url, init) { seen = init; return new Response("{}", { status: 200 }); };
  try {
    await defaultHttp({ url: "http://example.test/x", method: "POST", headers: {}, body: { a: 1 } });
  } finally {
    global.fetch = original;
  }
  assert.ok(seen.signal instanceof AbortSignal);
  assert.equal(seen.body, "{\"a\":1}");
});

/* ------------------------------------------------------------ phone */

test("phone normalisation accepts Ugandan mobiles only", function () {
  const valid = {
    "0772123456": "+256772123456",
    "0772 123 456": "+256772123456",
    "0772-123-456": "+256772123456",
    "772123456": "+256772123456",
    "256772123456": "+256772123456",
    "+256772123456": "+256772123456",
    "+256 772 123 456": "+256772123456",
    "2560772123456": "+256772123456",
    "+2560772123456": "+256772123456",
    "00256772123456": "+256772123456",
    "0392123456": "+256392123456"
  };
  Object.keys(valid).forEach(function (raw) { assert.equal(normalizePhone(raw), valid[raw], raw); });
  const rejected = ["+447700900123", "+19005550123", "07721234567", "2567721234567", "077212345", "0812345678",
    "+254712345678", "25677212345", "abc", "", null, "+256 772 123 4567", "0772123456x"];
  rejected.forEach(function (raw) {
    assert.throws(function () { normalizePhone(raw); }, /Ugandan mobile/, String(raw));
  });
  assert.equal(normalizePhone("+254712345678", ["+2547"]), "+254712345678");
  assert.throws(function () { normalizePhone("254712345678", ["+2547"]); }, /Ugandan/);
  assert.equal(maskPhone("+256772123456"), "+2567****456");
});

/* ------------------------------------------------------------ config */

test("dry-run unless ALERTS_LIVE=true and credentials are present; health has no secrets", function () {
  const creds = { AT_USERNAME: "u", AT_API_KEY: "super-secret-at-key", LIPECHAT_API_KEY: "lk-secret", LIPECHAT_FROM: "2547" };
  assert.equal(loadConfig(creds).mode, "dry-run");
  assert.equal(loadConfig(Object.assign({ ALERTS_LIVE: "1" }, creds)).mode, "dry-run");
  assert.equal(loadConfig({ ALERTS_LIVE: "true" }).mode, "dry-run");
  const live = loadConfig(Object.assign({ ALERTS_LIVE: "true", ALERTS_SERVICE_KEY: "ops-secret" }, creds));
  assert.equal(live.mode, "live");
  assert.equal(live.smsLive, true);
  const body = JSON.stringify(healthBody(live));
  assert.equal(body, "{\"ok\":true,\"mode\":\"live\"}");
  assert.equal(loadConfig({}).host, "127.0.0.1");
  assert.deepEqual(loadConfig({}).channelOrder, ["sms"]);
  assert.deepEqual(loadConfig({ ALERTS_CHANNEL_ORDER: "whatsapp, sms" }).channelOrder, ["whatsapp", "sms"]);
  assert.deepEqual(loadConfig({ ALERTS_CHANNEL_ORDER: "carrier-pigeon" }).channelOrder, ["sms"]);
});

test("credentials without ALERTS_LIVE never call a provider", async function () {
  const env = Object.assign({}, LIVE_ENV);
  delete env.ALERTS_LIVE;
  const h = await harness(env);
  try {
    const res = await h.call("POST", "/events", serviceEvent(), h.service());
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "dry_run");
    assert.equal(h.http.providerCalls().length, 0);
    const health = await h.call("GET", "/health");
    assert.deepEqual(health.json, { ok: true, mode: "dry-run" });
  } finally { await h.close(); }
});

/* ------------------------------------------------------------ auth */

test("nothing configured: every route except health answers 503", async function () {
  const h = await harness({});
  try {
    assert.equal((await h.call("GET", "/health")).status, 200);
    assert.equal((await h.call("POST", "/events", serviceEvent())).status, 503);
    assert.equal((await h.call("POST", "/events", serviceEvent(), h.service("anything"))).status, 503);
    assert.equal((await h.call("GET", "/templates", undefined, h.staff(ADMIN))).status, 503);
  } finally { await h.close(); }
});

test("unauthenticated and wrong credentials get 401; old X-Alerts-Key is ignored", async function () {
  const h = await harness(LIVE_ENV);
  try {
    assert.equal((await h.call("POST", "/events", serviceEvent())).status, 401);
    assert.equal((await h.call("POST", "/events", serviceEvent(), { "X-Alerts-Key": SERVICE_KEY })).status, 401);
    assert.equal((await h.call("POST", "/events", serviceEvent(), h.service("wrong"))).status, 401);
    assert.equal((await h.call("GET", "/templates", undefined, h.staff(b64("teller:nope")))).status, 401);
    assert.equal((await h.call("GET", "/templates", undefined, { "X-Staff-Authorization": "Bearer x" })).status, 401);
    assert.equal(h.http.providerCalls().length, 0);
  } finally { await h.close(); }
});

test("service key sends a validated gateway event", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const res = await h.call("POST", "/events", serviceEvent(), h.service());
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "sent");
    assert.equal(res.json.deliveries[0].to, "+2567****456");
    const sms = h.http.providerCalls();
    assert.equal(sms.length, 1);
    const params = new URLSearchParams(sms[0].body);
    assert.equal(params.get("to"), "+256772123456");
    assert.equal(params.get("message"), "Phaneroo SACCO: UGX 1,500,000 transferred from account ****0015 on " + params.get("message").match(/on (\d{4}-\d{2}-\d{2})/)[1] + ". Available balance UGX 20,000. Ref MB123.");
    assert.equal((await h.call("POST", "/events", serviceEvent({ type: "deposit", idempotencyKey: "x2" }), h.service())).status, 400);
    assert.equal((await h.call("POST", "/events", serviceEvent({ idempotencyKey: "" }), h.service())).status, 400);
    assert.equal((await h.call("POST", "/events", serviceEvent({ idempotencyKey: "k".repeat(101) }), h.service())).status, 400);
    assert.equal((await h.call("POST", "/events", serviceEvent({ idempotencyKey: "x3", phone: "+447700900123" }), h.service())).status, 400);
    assert.equal((await h.call("POST", "/events", serviceEvent({ idempotencyKey: "x4", context: { amount: "lots" } }), h.service())).status, 400);
    assert.equal((await h.call("POST", "/events", serviceEvent({ idempotencyKey: "x5", context: { memberName: "{{x}}" } }), h.service())).status, 400);
    const pin = await h.call("POST", "/events", { type: "activation", idempotencyKey: "act-1", phone: "0772123456", context: {} }, h.service());
    assert.equal(pin.json.status, "sent");
    assert.equal(new URLSearchParams(h.http.providerCalls()[1].body).get("message"),
      "Phaneroo SACCO: mobile banking was activated on a new phone. If this wasn't you, call your SACCO branch now.");
    assert.equal((await h.call("GET", "/templates", undefined, h.service())).status, 403);
  } finally { await h.close(); }
});

test("staff are verified against Fineract /authentication and cached", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const first = await h.call("GET", "/templates", undefined, h.staff(ADMIN));
    assert.equal(first.status, 200);
    const second = await h.call("GET", "/templates", undefined, h.staff(ADMIN));
    assert.equal(second.status, 200);
    const auths = h.http.calls.filter(function (c) { return c.url === FINERACT + "/authentication"; });
    assert.equal(auths.length, 1);
    assert.deepEqual(auths[0].body, { username: "admin", password: "pw" });
    assert.equal(auths[0].headers["Fineract-Platform-TenantId"], "default");
    assert.equal(h.logs.join("\n").includes(ADMIN), false);
  } finally { await h.close(); }
});

test("admin routes need ALL_FUNCTIONS or ALERTS_ADMIN_PERMISSION", async function () {
  const h = await harness(Object.assign({ ALERTS_ADMIN_PERMISSION: "ALERTS_ADMIN" }, LIVE_ENV));
  try {
    const denied = await h.call("GET", "/templates", undefined, h.staff(TELLER));
    assert.equal(denied.status, 403);
    assert.equal(denied.json.required, "ALERTS_ADMIN");
    assert.equal((await h.call("GET", "/deliveries", undefined, h.staff(TELLER))).status, 403);
    assert.equal((await h.call("GET", "/settings", undefined, h.staff(TELLER))).status, 403);
    assert.equal((await h.call("POST", "/test-send", { type: "deposit", phone: "0772123456" }, h.staff(TELLER))).status, 403);
    assert.equal((await h.call("GET", "/templates", undefined, h.staff(AUDITOR))).status, 200);
    const settings = await h.call("GET", "/settings", undefined, h.staff(ADMIN));
    assert.equal(settings.status, 200);
    assert.equal(settings.json.mode, "live");
    const text = JSON.stringify(settings.json);
    assert.equal(text.includes("super-secret"), false);
    assert.equal(text.includes(SERVICE_KEY), false);
  } finally { await h.close(); }
});

/* ------------------------------------------------------------ staff events */

test("staff deposit event reads the facts from Fineract and ignores browser-supplied amount and phone", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const res = await h.call("POST", "/events", {
      type: "deposit", savingsAccountId: 15, transactionId: 501,
      amount: 999999999, phone: "0700000000", memberId: "99", reference: "FORGED", meta: { memberName: "x" }
    }, h.staff(TELLER));
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "sent");
    const reads = h.http.calls.filter(function (c) { return c.method === "GET"; });
    assert.deepEqual(reads.map(function (c) { return c.url.slice(FINERACT.length); }),
      ["/savingsaccounts/15/transactions/501", "/savingsaccounts/15", "/clients/4"]);
    reads.forEach(function (c) { assert.equal(c.headers.Authorization, "Basic " + TELLER); });
    const sms = h.http.providerCalls()[0];
    const params = new URLSearchParams(sms.body);
    assert.equal(params.get("to"), "+256772123456");
    assert.equal(params.get("message"),
      "Phaneroo SACCO: UGX 250,000 deposited to account ****0015 on 2026-10-02. Available balance UGX 1,200,000. Ref RCPT-9.");
    assert.equal(params.get("message").includes("999"), false);
    assert.equal(params.get("message").includes("FORGED"), false);
  } finally { await h.close(); }
});

test("staff loan repayment and transfer events", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const loan = await h.call("POST", "/events", { type: "loan_repay", loanId: 7, transactionId: 801 }, h.staff(TELLER));
    assert.equal(loan.json.status, "sent");
    assert.equal(new URLSearchParams(h.http.providerCalls()[0].body).get("message"),
      "Phaneroo SACCO: UGX 100,000 received for loan ****0007 on 2026-10-01. Loan balance UGX 400,000. Ref TX801.");
    const transfer = await h.call("POST", "/events", { type: "transfer", transferId: 90 }, h.staff(TELLER));
    assert.equal(transfer.json.status, "sent");
    assert.equal(new URLSearchParams(h.http.providerCalls()[1].body).get("message"),
      "Phaneroo SACCO: UGX 30,000 transferred from account ****0015 on 2026-10-02. Available balance UGX 1,200,000. Ref TR90.");
    assert.equal((await h.call("POST", "/events", { type: "loan_disburse", loanId: 7, transactionId: 801 }, h.staff(TELLER))).status, 409);
    assert.equal((await h.call("POST", "/events", { type: "pin", memberId: 4 }, h.staff(TELLER))).status, 400);
    assert.equal((await h.call("POST", "/events", { type: "deposit", savingsAccountId: "15/../16", transactionId: 501 }, h.staff(TELLER))).status, 400);
  } finally { await h.close(); }
});

test("reversed, mismatched, and missing (maker-checker pending) transactions send nothing", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const reversed = await h.call("POST", "/events", { type: "deposit", savingsAccountId: 15, transactionId: 502 }, h.staff(TELLER));
    assert.equal(reversed.status, 409);
    assert.match(reversed.json.error, /reversed/);
    const mismatch = await h.call("POST", "/events", { type: "deposit", savingsAccountId: 15, transactionId: 503 }, h.staff(TELLER));
    assert.equal(mismatch.status, 409);
    const missing = await h.call("POST", "/events", { type: "withdrawal", savingsAccountId: 15, transactionId: 999 }, h.staff(TELLER));
    assert.equal(missing.status, 404);
    assert.equal(h.http.providerCalls().length, 0);
  } finally { await h.close(); }
});

test("a member whose mobile is not Ugandan is skipped, not sent", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const res = await h.call("POST", "/events", { type: "deposit", savingsAccountId: 16, transactionId: 601 }, h.staff(TELLER));
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "skipped");
    assert.equal(h.http.providerCalls().length, 0);
  } finally { await h.close(); }
});

test("idempotent repeat returns the earlier result without sending again", async function () {
  const h = await harness(LIVE_ENV);
  try {
    const event = { type: "deposit", savingsAccountId: 15, transactionId: 501 };
    const first = await h.call("POST", "/events", event, h.staff(TELLER));
    const second = await h.call("POST", "/events", event, h.staff(TELLER));
    assert.equal(first.json.status, "sent");
    assert.equal(second.json.duplicate, true);
    assert.equal(second.json.status, "sent");
    assert.equal(second.json.deliveries[0].id, first.json.deliveries[0].id);
    const gw1 = await h.call("POST", "/events", serviceEvent({ idempotencyKey: "same" }), h.service());
    const gw2 = await h.call("POST", "/events", serviceEvent({ idempotencyKey: "same", context: { amount: 1 } }), h.service());
    assert.equal(gw1.json.status, "sent");
    assert.equal(gw2.json.duplicate, true);
    assert.equal(h.http.providerCalls().length, 2);
  } finally { await h.close(); }
});

/* ------------------------------------------------------------ caps, rate limit */

test("per-phone hourly limit and global daily cap record skipped deliveries", async function () {
  const h = await harness(Object.assign({ ALERTS_PER_PHONE_HOURLY: "2" }, LIVE_ENV));
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal((await h.call("POST", "/events", serviceEvent({ idempotencyKey: "p" + i }), h.service())).json.status, "sent");
    }
    const third = await h.call("POST", "/events", serviceEvent({ idempotencyKey: "p2" }), h.service());
    assert.equal(third.json.status, "skipped");
    assert.match(third.json.reason, /per-phone hourly limit/);
    assert.equal(h.http.providerCalls().length, 2);
  } finally { await h.close(); }
  const d = await harness(Object.assign({ ALERTS_DAILY_CAP: "1" }, LIVE_ENV));
  try {
    assert.equal((await d.call("POST", "/events", serviceEvent({ idempotencyKey: "d1" }), d.service())).json.status, "sent");
    const second = await d.call("POST", "/events", serviceEvent({ idempotencyKey: "d2", phone: "0701000001" }), d.service());
    assert.equal(second.json.status, "skipped");
    assert.match(second.json.reason, /daily send cap/);
    const book = await d.call("GET", "/deliveries", undefined, d.staff(ADMIN));
    assert.equal(book.json.deliveries[0].status, "skipped");
    const stored = JSON.parse(fs.readFileSync(d.file, "utf8"));
    assert.equal(stored.quota.dayCount, 1);
    assert.equal(JSON.stringify(stored).includes("701000001"), false);
  } finally { await d.close(); }
});

test("per-IP rate limit on non-health routes", async function () {
  const h = await harness(Object.assign({ ALERTS_RATE_PER_MINUTE: "3" }, LIVE_ENV));
  try {
    for (let i = 0; i < 3; i++) assert.equal((await h.call("GET", "/templates")).status, 401);
    assert.equal((await h.call("GET", "/templates")).status, 429);
    assert.equal((await h.call("GET", "/health")).status, 200);
  } finally { await h.close(); }
});

/* ------------------------------------------------------------ logging, privacy */

test("logs and the deliveries API never hold a full phone number or a message body", async function () {
  const h = await harness(LIVE_ENV);
  try {
    await h.call("POST", "/events", { type: "deposit", savingsAccountId: 15, transactionId: 501 }, h.staff(TELLER));
    await h.call("POST", "/events", serviceEvent(), h.service());
    await h.call("POST", "/test-send", { type: "pin", phone: "+256 772 123 456", channel: "sms" }, h.staff(ADMIN));
    const book = await h.call("GET", "/deliveries", undefined, h.staff(ADMIN));
    const stored = JSON.parse(fs.readFileSync(h.file, "utf8"));
    const all = h.logs.join("\n") + JSON.stringify(book.json) + JSON.stringify(stored);
    assert.equal(all.includes(MEMBER_PHONE_DIGITS), false);
    /* Templates hold the wording; logs, deliveries, and idempotency results must not hold a rendered body. */
    const rendered = h.logs.join("\n") + JSON.stringify(book.json) + JSON.stringify(stored.deliveries) + JSON.stringify(stored.idempotency);
    assert.equal(rendered.includes("UGX 250,000"), false);
    assert.equal(rendered.includes("deposited"), false);
    assert.equal(all.includes(TELLER), false);
    assert.equal(all.includes("super-secret"), false);
    assert.ok(book.json.deliveries.length >= 3);
    book.json.deliveries.forEach(function (row) {
      assert.equal(row.to, "+2567****456");
      assert.equal(row.preview, undefined);
    });
  } finally { await h.close(); }
});

/* ------------------------------------------------------------ channel order */

test("channel order: whatsapp first, SMS only when WhatsApp fails; never both on success", async function () {
  async function enableWhatsApp(h) {
    const res = await h.call("PUT", "/templates/transfer", { whatsappEnabled: true }, h.staff(ADMIN));
    assert.equal(res.status, 200);
  }
  const ok = await harness(Object.assign({ ALERTS_CHANNEL_ORDER: "whatsapp,sms" }, LIVE_ENV));
  try {
    await enableWhatsApp(ok);
    const res = await ok.call("POST", "/events", serviceEvent(), ok.service());
    assert.equal(res.json.status, "sent");
    assert.deepEqual(ok.http.providerCalls().map(function (c) { return c.url; }), [LIPE_URL]);
  } finally { await ok.close(); }
  const fallback = await harness(Object.assign({ ALERTS_CHANNEL_ORDER: "whatsapp,sms" }, LIVE_ENV), {
    mock: { lipe: function () { return { status: 200, json: { status: "error", message: "template not approved" } }; } }
  });
  try {
    await enableWhatsApp(fallback);
    const res = await fallback.call("POST", "/events", serviceEvent(), fallback.service());
    assert.equal(res.json.status, "sent");
    assert.deepEqual(res.json.deliveries.map(function (r) { return r.channel + ":" + r.status; }), ["whatsapp:failed", "sms:sent"]);
    assert.deepEqual(fallback.http.providerCalls().map(function (c) { return c.url; }), [LIPE_URL, AT_URL]);
  } finally { await fallback.close(); }
  const smsOnly = await harness(LIVE_ENV);
  try {
    await enableWhatsApp(smsOnly);
    await smsOnly.call("POST", "/events", serviceEvent(), smsOnly.service());
    assert.deepEqual(smsOnly.http.providerCalls().map(function (c) { return c.url; }), [AT_URL]);
  } finally { await smsOnly.close(); }
  const atDown = await harness(LIVE_ENV, { mock: { at: function () { return { status: 201, json: { SMSMessageData: { Message: "Sent to 0/1", Recipients: [] } } }; } } });
  try {
    const res = await atDown.call("POST", "/events", serviceEvent(), atDown.service());
    assert.equal(res.json.status, "failed");
    assert.equal(res.json.ok, false);
  } finally { await atDown.close(); }
});

/* ------------------------------------------------------------ templates */

test("templates cannot use tokens outside the type's whitelist (no codes, no PINs)", async function () {
  const h = await harness(LIVE_ENV);
  try {
    assert.equal((await h.call("PUT", "/templates/activation", { smsBody: "Your code is {{code}}" }, h.staff(ADMIN))).status, 400);
    assert.equal((await h.call("PUT", "/templates/pin", { smsBody: "PIN {{pin}}" }, h.staff(ADMIN))).status, 400);
    assert.equal((await h.call("PUT", "/templates/pin", { smsBody: "{{amount}}" }, h.staff(ADMIN))).status, 400);
    assert.equal((await h.call("PUT", "/templates/deposit", { whatsappPlaceholders: "amount, phone" }, h.staff(ADMIN))).status, 400);
    assert.equal((await h.call("PUT", "/templates/nonsense", { smsBody: "x" }, h.staff(ADMIN))).status, 404);
    const ok = await h.call("PUT", "/templates/deposit", { smsBody: "Got {{amount}} on {{account}}" }, h.staff(ADMIN));
    assert.equal(ok.status, 200);
    const types = defaultTemplates().map(function (t) { return t.type; });
    assert.deepEqual(types, ["deposit", "withdrawal", "loan_disburse", "loan_repay", "transfer", "pin", "activation", "mobile_blocked"]);
    const activation = defaultTemplates().filter(function (t) { return t.type === "activation"; })[0];
    assert.match(activation.smsBody, /activated on a new phone/);
    assert.equal(/code/i.test(activation.smsBody), false);
  } finally { await h.close(); }
});

/* ------------------------------------------------------------ store */

test("a corrupt store is set aside, logged once, and the service keeps working", async function () {
  const file = tempFile();
  fs.writeFileSync(file, "{not json");
  const logs = [];
  const store = createFileStore(file, { log: function (line) { logs.push(line); } });
  const templates = await store.listTemplates();
  assert.equal(templates.length, 8);
  const siblings = fs.readdirSync(path.dirname(file));
  assert.equal(siblings.filter(function (n) { return /^store\.json\.corrupt-\d+$/.test(n); }).length, 1);
  assert.equal(logs.filter(function (l) { return l.includes("alerts.store_corrupt"); }).length, 1);
  await store.appendDeliveries([{ id: "d1", status: "dry_run" }]);
  await store.listDeliveries(5);
  assert.equal(logs.filter(function (l) { return l.includes("alerts.store_corrupt"); }).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).deliveries.length, 1);
  assert.equal(siblings.filter(function (n) { return n.endsWith(".tmp"); }).length, 0);
});

test("a legacy store gains new types and loses the old activation text", async function () {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({
    templates: [{ type: "activation", smsBody: "Phaneroo SACCO: savings account {{account}} is now active.", smsEnabled: true }, { type: "custom_old", smsBody: "x" }],
    deliveries: []
  }));
  const store = createFileStore(file, { log: function () {} });
  const rows = await store.listTemplates();
  assert.equal(rows.some(function (r) { return r.type === "custom_old"; }), false);
  assert.equal(rows.some(function (r) { return r.type === "mobile_blocked"; }), true);
  assert.match(rows.filter(function (r) { return r.type === "activation"; })[0].smsBody, /new phone/);
});
