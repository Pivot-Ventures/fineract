"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { buildSmsRequest, parseSmsResponse } = require("../src/providers/africas-talking");
const { buildWhatsAppRequest, parseWhatsAppResponse } = require("../src/providers/lipechat");
const { normalizePhone } = require("../src/phone");
const { loadConfig, healthBody } = require("../src/config");
const { createFileStore } = require("../src/store");
const { createApp } = require("../src/app");

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alerts-"));
  return createFileStore(path.join(dir, "store.json"));
}

function listen(app) {
  const server = http.createServer(function (req, res) {
    Promise.resolve(app(req, res)).catch(function (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

test("Africa's Talking adapter builds the form body and keeps the key in the header", function () {
  const built = buildSmsRequest({
    username: "sandbox",
    apiKey: "secret-key",
    from: "PHANEROO",
    to: "+256700000001",
    message: "Hello SACCO",
    baseUrl: "https://api.africastalking.com"
  });
  assert.equal(built.url, "https://api.africastalking.com/version1/messaging");
  assert.equal(built.method, "POST");
  assert.equal(built.headers.apiKey, "secret-key");
  assert.equal(built.headers["Content-Type"], "application/x-www-form-urlencoded");
  const params = new URLSearchParams(built.body);
  assert.equal(params.get("username"), "sandbox");
  assert.equal(params.get("to"), "+256700000001");
  assert.equal(params.get("message"), "Hello SACCO");
  assert.equal(params.get("from"), "PHANEROO");
  assert.equal(params.get("apiKey"), null);
  assert.equal(built.body, "username=sandbox&to=%2B256700000001&message=Hello+SACCO&from=PHANEROO");
});

test("Africa's Talking sandbox base URL still posts to /version1/messaging", function () {
  const built = buildSmsRequest({
    username: "sandbox",
    apiKey: "k",
    to: "+256700000001",
    message: "Hi",
    baseUrl: "https://api.sandbox.africastalking.com/"
  });
  assert.equal(built.url, "https://api.sandbox.africastalking.com/version1/messaging");
  assert.equal(new URLSearchParams(built.body).get("from"), null);
});

test("Africa's Talking response yields the provider message id", function () {
  const parsed = parseSmsResponse({
    status: 201,
    json: { SMSMessageData: { Recipients: [{ statusCode: 101, status: "Success", messageId: "ATXid_1" }] } }
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.providerId, "ATXid_1");
});

test("LipeChat adapter builds the template JSON", function () {
  const built = buildWhatsAppRequest({
    apiKey: "lip-secret",
    baseUrl: "https://gateway.lipachat.com",
    messageId: "11111111-1111-1111-1111-111111111111",
    to: "+256700000001",
    from: "254700111222",
    templateName: "sacco_deposit",
    languageCode: "en",
    placeholders: ["UGX", "1000", "0001", "R1"]
  });
  assert.equal(built.url, "https://gateway.lipachat.com/api/v1/whatsapp/template");
  assert.equal(built.method, "POST");
  assert.equal(built.headers.apiKey, "lip-secret");
  assert.equal(built.headers["Content-Type"], "application/json");
  assert.deepEqual(built.body, {
    messageId: "11111111-1111-1111-1111-111111111111",
    to: "+256700000001",
    from: "254700111222",
    template: {
      name: "sacco_deposit",
      languageCode: "en",
      components: { body: { placeholders: ["UGX", "1000", "0001", "R1"] } }
    }
  });
});

test("LipeChat response keeps a message id", function () {
  const parsed = parseWhatsAppResponse({ status: 200, json: { messageId: "mid-9" } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.providerId, "mid-9");
});

test("phone numbers gain the Uganda country code", function () {
  assert.equal(normalizePhone("0772 000 111"), "+256772000111");
  assert.equal(normalizePhone("+256772000111"), "+256772000111");
  assert.equal(normalizePhone("256772000111"), "+256772000111");
  assert.equal(normalizePhone("772000111"), "+256772000111");
  assert.throws(function () { normalizePhone("abc"); }, /phone/);
});

test("health flags stay boolean and never include secrets", function () {
  const config = loadConfig({
    AT_USERNAME: "sandbox",
    AT_API_KEY: "super-secret-at-key",
    LIPECHAT_API_KEY: "",
    LIPECHAT_FROM: "",
    ALERTS_API_KEY: "ops-secret"
  });
  const body = healthBody(config);
  assert.equal(body.providers.sms.configured, true);
  assert.equal(body.providers.sms.dryRun, false);
  assert.equal(body.providers.whatsapp.configured, false);
  assert.equal(body.providers.whatsapp.dryRun, true);
  assert.equal(body.providers.email.configured, false);
  const encoded = JSON.stringify(body);
  assert.equal(encoded.includes("super-secret-at-key"), false);
  assert.equal(encoded.includes("ops-secret"), false);
});

test("dry-run logs the intended payload and does not call HTTP", async function () {
  const calls = [];
  const logs = [];
  const config = loadConfig({
    ALERTS_DRY_RUN: "true",
    AT_USERNAME: "sandbox",
    AT_API_KEY: "super-secret-at-key",
    AT_SENDER_ID: "PHANEROO",
    LIPECHAT_API_KEY: "super-secret-lipe-key",
    LIPECHAT_FROM: "254700111222"
  });
  assert.equal(config.smsDryRun, true);
  assert.equal(config.whatsappDryRun, true);
  const app = createApp({
    store: tempStore(),
    config: config,
    log: function (line) { logs.push(line); },
    http: async function (req) { calls.push(req); return { status: 200, json: {} }; }
  });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const res = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/test-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "both",
        type: "deposit",
        phone: "0700000001",
        amount: 1000,
        currency: "UGX",
        account: "0001",
        reference: "R1"
      })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(json.deliveries.length, 2);
    assert.equal(json.deliveries[0].status, "dry_run");
    assert.equal(json.deliveries[1].status, "dry_run");
    const joined = logs.join("\n");
    assert.equal(joined.includes("super-secret-at-key"), false);
    assert.equal(joined.includes("super-secret-lipe-key"), false);
    assert.equal(joined.includes("alerts.dry_run"), true);
    assert.equal(joined.includes("username=sandbox"), true);
    assert.equal(joined.includes("Phaneroo+SACCO"), true);
    assert.equal(joined.includes("\"name\":\"sacco_deposit\""), true);
    assert.equal(joined.includes("[redacted]"), true);
    const listed = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/deliveries");
    const book = await listed.json();
    assert.equal(book.deliveries.length, 2);
    assert.equal(book.deliveries[0].channel, "whatsapp");
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test("mocked HTTP receives the Africa's Talking form and the LipeChat template", async function () {
  const calls = [];
  const config = loadConfig({
    AT_USERNAME: "sandbox",
    AT_API_KEY: "secret-key",
    AT_SENDER_ID: "PHANEROO",
    AT_BASE_URL: "https://api.africastalking.com",
    LIPECHAT_API_KEY: "lip-secret",
    LIPECHAT_FROM: "254700111222",
    LIPECHAT_BASE_URL: "https://gateway.lipachat.com"
  });
  assert.equal(config.smsDryRun, false);
  assert.equal(config.whatsappDryRun, false);
  const app = createApp({
    store: tempStore(),
    config: config,
    log: function () {},
    http: async function (req) {
      calls.push(req);
      if (req.headers["Content-Type"] === "application/json") {
        return { status: 200, json: { messageId: "lip-1" }, text: "" };
      }
      return {
        status: 201,
        json: { SMSMessageData: { Recipients: [{ statusCode: 101, status: "Success", messageId: "ATXid_1" }] } },
        text: ""
      };
    }
  });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const res = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/test-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "both",
        type: "deposit",
        phone: "+256700000001",
        amount: 1000,
        account: "0001",
        reference: "R1"
      })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    const sms = calls[0];
    const wa = calls[1];
    assert.equal(sms.url, "https://api.africastalking.com/version1/messaging");
    assert.equal(sms.headers.apiKey, "secret-key");
    assert.equal(sms.headers["Content-Type"], "application/x-www-form-urlencoded");
    const params = new URLSearchParams(sms.body);
    assert.equal(params.get("username"), "sandbox");
    assert.equal(params.get("to"), "+256700000001");
    assert.equal(params.get("message"), "Phaneroo SACCO: UGX 1000 deposited to account 0001. Ref R1.");
    assert.equal(params.get("from"), "PHANEROO");
    assert.equal(params.get("apiKey"), null);
    assert.equal(wa.url, "https://gateway.lipachat.com/api/v1/whatsapp/template");
    assert.equal(wa.headers.apiKey, "lip-secret");
    assert.equal(wa.headers["Content-Type"], "application/json");
    assert.equal(wa.body.to, "+256700000001");
    assert.equal(wa.body.from, "254700111222");
    assert.equal(typeof wa.body.messageId, "string");
    assert.equal(wa.body.template.name, "sacco_deposit");
    assert.equal(wa.body.template.languageCode, "en");
    assert.deepEqual(wa.body.template.components.body.placeholders, ["UGX", "1000", "0001", "R1"]);
    assert.equal(json.deliveries[0].status, "sent");
    assert.equal(json.deliveries[0].providerId, "ATXid_1");
    assert.equal(json.deliveries[1].status, "sent");
    assert.equal(json.deliveries[1].providerId, "lip-1");
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test("missing provider keys auto dry-run even when ALERTS_DRY_RUN is false", async function () {
  const calls = [];
  const config = loadConfig({ ALERTS_DRY_RUN: "false" });
  assert.equal(config.smsDryRun, true);
  const app = createApp({
    store: tempStore(),
    config: config,
    log: function () {},
    http: async function (req) { calls.push(req); return { status: 200, json: {} }; }
  });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const res = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "withdrawal", phone: "0772000111", amount: 50, account: "9" })
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(json.deliveries[0].channel, "sms");
    assert.equal(json.deliveries[0].status, "dry_run");
    assert.equal(json.deliveries[0].preview.includes("withdrawn"), true);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});

test("health is public and other routes honour the operator key", async function () {
  const config = loadConfig({ ALERTS_API_KEY: "ops-secret" });
  const app = createApp({ store: tempStore(), config: config, log: function () {}, http: async function () { return { status: 200, json: {} }; } });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const health = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/health");
    const healthBodyText = await health.text();
    assert.equal(health.status, 200);
    assert.equal(healthBodyText.includes("ops-secret"), false);
    const denied = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/templates");
    assert.equal(denied.status, 401);
    const allowed = await fetch("http://127.0.0.1:" + port + "/alerts/api/v1/templates", {
      headers: { "X-Alerts-Key": "ops-secret" }
    });
    const book = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(book.templates.some(function (row) { return row.type === "loan_disburse" && row.whatsappTemplateName === "sacco_loan_disburse"; }), true);
    assert.equal(book.templates.some(function (row) { return row.type === "loan_repay"; }), true);
    assert.equal(book.templates.some(function (row) { return row.type === "transfer"; }), true);
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
});
