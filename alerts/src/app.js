"use strict";

const { loadConfig, healthBody, settingsBody, CHANNELS } = require("./config");
const { createFileStore } = require("./store");
const { createAuth } = require("./auth");
const { deliver, record } = require("./dispatch");
const { staffFacts } = require("./fineract");
const { normalizePhone, maskPhone } = require("./phone");
const { buildContext, unknownTokens } = require("./render");
const { TYPES } = require("./templates");
const { defaultHttp } = require("./http");

/* Caddy strips /alerts/api, so the service normally sees /v1/...; the long form still works direct. */
const PREFIXES = ["/v1", "/alerts/api/v1"];
const SERVICE_TYPES = ["transfer", "loan_repay", "pin", "activation", "mobile_blocked"];
const RATE_WINDOW_MS = 60 * 1000;

function bad(message, status) {
  const err = new Error(message);
  err.status = status || 400;
  return err;
}

function clip(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function asBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function placeholdersOf(type, source, existing) {
  let list;
  if (Array.isArray(source)) list = source;
  else if (typeof source === "string") list = source.split(",");
  else return (existing && existing.whatsappPlaceholders) || [];
  list = list.map(function (item) { return clip(item, 40); }).filter(function (item) { return item; }).slice(0, 12);
  const unknown = list.filter(function (item) { return unknownTokens(type, "{{" + item + "}}").length || !/^[A-Za-z0-9_]+$/.test(item); });
  if (unknown.length) throw bad("placeholders not allowed for " + type + ": " + unknown.join(", "));
  return list;
}

function sanitizeTemplate(input, existing) {
  const source = input || {};
  const base = existing || {};
  const type = base.type || clip(source.type, 41);
  if (TYPES.indexOf(type) < 0) throw bad("unknown event type", 404);
  const smsBody = clip(source.smsBody != null ? source.smsBody : base.smsBody || "", 480);
  const unknown = unknownTokens(type, smsBody);
  if (unknown.length) throw bad("tokens not allowed for " + type + ": " + unknown.join(", "));
  return {
    type: type,
    label: clip(source.label != null ? source.label : base.label || type, 80),
    smsEnabled: asBool(source.smsEnabled, base.smsEnabled !== undefined ? base.smsEnabled : true),
    whatsappEnabled: asBool(source.whatsappEnabled, base.whatsappEnabled !== undefined ? base.whatsappEnabled : false),
    smsBody: smsBody,
    whatsappTemplateName: clip(source.whatsappTemplateName != null ? source.whatsappTemplateName : base.whatsappTemplateName || "", 64)
      .replace(/[^A-Za-z0-9_]/g, ""),
    whatsappLanguageCode: clip(source.whatsappLanguageCode != null ? source.whatsappLanguageCode : base.whatsappLanguageCode || "en", 16)
      .replace(/[^A-Za-z_-]/g, "") || "en",
    whatsappPlaceholders: placeholdersOf(type, source.whatsappPlaceholders, base)
  };
}

function money(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e13) throw bad(name + " must be a number");
  return n;
}

function text(value, name, max, pattern) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw bad(name + " must be a string");
  const out = String(value).trim();
  if (out.length > max) throw bad(name + " is too long");
  if (pattern && out && !pattern.test(out)) throw bad(name + " has invalid characters");
  return out;
}

/* Gateway (service) events: trusted content, still validated. */
function sanitizeServiceEvent(body, config) {
  const type = clip(body.type, 41);
  if (SERVICE_TYPES.indexOf(type) < 0) throw bad("type must be one of " + SERVICE_TYPES.join(", "));
  const idempotencyKey = text(body.idempotencyKey, "idempotencyKey", 100, /^[\x21-\x7e]+$/);
  if (!idempotencyKey) throw bad("idempotencyKey is required");
  const context = body.context == null ? {} : body.context;
  if (typeof context !== "object" || Array.isArray(context)) throw bad("context must be an object");
  return {
    type: type,
    idempotencyKey: idempotencyKey,
    memberId: text(body.memberId, "memberId", 64, /^[A-Za-z0-9_-]+$/),
    phone: normalizePhone(body.phone, config.extraPrefixes),
    facts: {
      amount: money(context.amount, "context.amount"),
      balance: money(context.balance, "context.balance"),
      account: text(context.account, "context.account", 32, /^[A-Za-z0-9 -]+$/),
      reference: text(context.reference, "context.reference", 40, /^[A-Za-z0-9 _./-]+$/),
      memberName: text(context.memberName, "context.memberName", 60, /^[^\u0000-\u001f\u007f{}[\]]+$/),
      currency: "UGX"
    }
  };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > 16384) {
        reject(bad("payload too large", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw bad("JSON body required");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad("JSON object required");
  return parsed;
}

function send(res, status, payload, extra) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(body)
  }, extra || {}));
  res.end(body);
}

function stripPrefix(pathname) {
  for (const prefix of PREFIXES) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length);
  }
  return null;
}

function match(method, route) {
  if (route === "/health" && method === "GET") return { name: "health" };
  if (route === "/events" && method === "POST") return { name: "events" };
  if (route === "/templates" && method === "GET") return { name: "templates.list", admin: true };
  if (route === "/deliveries" && method === "GET") return { name: "deliveries", admin: true };
  if (route === "/settings" && method === "GET") return { name: "settings", admin: true };
  if (route === "/test-send" && method === "POST") return { name: "test", admin: true };
  const found = route.match(/^\/templates\/([a-z][a-z0-9_]{0,40})$/);
  if (found && method === "GET") return { name: "templates.get", type: found[1], admin: true };
  if (found && method === "PUT") return { name: "templates.put", type: found[1], admin: true };
  return null;
}

function createRateLimiter(now) {
  const buckets = new Map();
  return function hit(key, limit) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || t - bucket.start >= RATE_WINDOW_MS) {
      if (buckets.size > 10000) {
        buckets.forEach(function (value, k) { if (t - value.start >= RATE_WINDOW_MS) buckets.delete(k); });
      }
      bucket = { start: t, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit ? 0 : Math.ceil((bucket.start + RATE_WINDOW_MS - t) / 1000);
  };
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map(function (item) { return item.trim(); })
      .filter(function (item) { return item; });
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

const SAMPLE = {
  amount: 150000,
  balance: 1500000,
  account: "000001234",
  reference: "TEST",
  memberName: "Test Member",
  currency: "UGX"
};

function createApp(overrides) {
  const options = overrides || {};
  const configOf = options.config ? function () { return options.config; } : function () { return loadConfig(); };
  const startConfig = configOf();
  const log = options.log || function (line) { console.log(line); };
  const store = options.store || createFileStore(startConfig.dataFile, { log: log });
  const http = options.http || defaultHttp;
  const now = options.now || Date.now;
  const auth = createAuth({ http: http, now: now });
  const limit = createRateLimiter(now);

  async function runOnce(key, work) {
    const begun = await store.beginIdempotent(key);
    if (begun.state === "done") return Object.assign({}, begun.result, { duplicate: true });
    if (begun.state === "pending") return { ok: true, duplicate: true, status: "pending", deliveries: [] };
    let result;
    try {
      result = await work();
    } catch (err) {
      await store.releaseIdempotent(key);
      throw err;
    }
    await store.finishIdempotent(key, result);
    return result;
  }

  async function staffEvent(body, principal, config) {
    const facts = await staffFacts(body, principal, { http: http, config: config });
    return runOnce(facts.key, async function () {
      let phone = "";
      try {
        phone = normalizePhone(facts.phone, config.extraPrefixes);
      } catch (err) {
        const row = record({ type: body.type, source: "staff", status: "skipped", error: facts.phone ? "member mobile number is not a valid Ugandan mobile" : "member has no mobile number" });
        log(JSON.stringify({ msg: "alerts.delivery", type: row.type, source: "staff", status: row.status, error: row.error }));
        await store.appendDeliveries([row]);
        return { ok: false, type: body.type, status: "skipped", reason: row.error, deliveries: [row] };
      }
      return deliver({
        type: body.type,
        source: "staff",
        phone: phone,
        ctx: buildContext(body.type, facts, config)
      }, { store: store, http: http, config: config, log: log });
    });
  }

  async function serviceEvent(body, config) {
    const event = sanitizeServiceEvent(body, config);
    return runOnce("svc:" + event.idempotencyKey, function () {
      return deliver({
        type: event.type,
        source: "service",
        phone: event.phone,
        ctx: buildContext(event.type, event.facts, config)
      }, { store: store, http: http, config: config, log: log });
    });
  }

  return async function handler(req, res) {
    const config = configOf();
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const route = stripPrefix(url.pathname.replace(/\/+$/, "") || "/");
      const matched = route === null ? null : match(req.method, route);
      if (matched && matched.name === "health") {
        send(res, 200, healthBody(config));
        return;
      }
      const wait = limit(clientIp(req, config), config.ratePerMinute);
      if (wait) {
        send(res, 429, { error: "too many requests" }, { "Retry-After": String(wait) });
        return;
      }
      if (!matched) {
        send(res, 404, { error: "not_found" });
        return;
      }
      const principal = await auth.authenticate(req, config);
      if (matched.admin && !auth.isAdmin(principal, config)) {
        send(res, 403, { error: "forbidden", required: config.adminPermission });
        return;
      }
      if (matched.name === "events") {
        const body = await readJson(req);
        const result = principal.kind === "service"
          ? await serviceEvent(body, config)
          : await staffEvent(body, principal, config);
        send(res, 200, result);
        return;
      }
      if (matched.name === "settings") {
        send(res, 200, settingsBody(config));
        return;
      }
      if (matched.name === "templates.list") {
        send(res, 200, { templates: await store.listTemplates() });
        return;
      }
      if (matched.name === "templates.get") {
        const row = await store.getTemplate(matched.type);
        if (!row) throw bad("unknown event type", 404);
        send(res, 200, row);
        return;
      }
      if (matched.name === "templates.put") {
        const current = await store.getTemplate(matched.type);
        if (!current) throw bad("unknown event type", 404);
        const template = sanitizeTemplate(await readJson(req), current);
        await store.putTemplate(template);
        log(JSON.stringify({ msg: "alerts.template_updated", type: template.type, by: principal.username }));
        send(res, 200, template);
        return;
      }
      if (matched.name === "deliveries") {
        send(res, 200, { deliveries: await store.listDeliveries(url.searchParams.get("limit")) });
        return;
      }
      if (matched.name === "test") {
        const body = await readJson(req);
        const type = clip(body.type, 41);
        if (TYPES.indexOf(type) < 0) throw bad("unknown event type", 404);
        const channel = clip(body.channel || "", 16);
        if (channel && CHANNELS.indexOf(channel) < 0) throw bad("channel must be sms or whatsapp");
        const phone = normalizePhone(body.phone, config.extraPrefixes);
        log(JSON.stringify({ msg: "alerts.test_send", type: type, to: maskPhone(phone), by: principal.username }));
        const result = await deliver({
          type: type,
          source: "test",
          phone: phone,
          channels: channel ? [channel] : config.channelOrder,
          ctx: buildContext(type, SAMPLE, config)
        }, { store: store, http: http, config: config, log: log });
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: "not_found" });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) log(JSON.stringify({ msg: "alerts.error", status: status, error: String(err.message || "internal_error").slice(0, 200) }));
      if (!res.headersSent) send(res, status, { error: status === 500 ? "internal_error" : err.message });
    }
  };
}

module.exports = { createApp, sanitizeTemplate, sanitizeServiceEvent, SERVICE_TYPES };
