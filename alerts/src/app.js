"use strict";

const crypto = require("crypto");
const { loadConfig, healthBody } = require("./config");
const { createFileStore, defaultDataFile } = require("./store");
const { fanOut } = require("./dispatch");
const { normalizePhone } = require("./phone");

const PREFIX = "/alerts/api/v1";
const TYPE_RE = /^[a-z][a-z0-9_]{0,40}$/;

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

function safeEqual(provided, expected) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function authorized(req, config) {
  if (!config.apiKey) return true;
  const header = req.headers["x-alerts-key"] || "";
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  return safeEqual(header, config.apiKey) || safeEqual(bearer, config.apiKey);
}

function sanitizeTemplate(input, existing) {
  const source = input || {};
  const type = clip((existing && existing.type) || source.type, 41);
  if (!TYPE_RE.test(type)) throw bad("type must match [a-z][a-z0-9_]*");
  let placeholders;
  if (Array.isArray(source.whatsappPlaceholders)) {
    placeholders = source.whatsappPlaceholders.map(function (item) { return clip(item, 40); })
      .filter(function (item) { return /^[A-Za-z0-9_]+$/.test(item); })
      .slice(0, 12);
  } else if (typeof source.whatsappPlaceholders === "string") {
    placeholders = source.whatsappPlaceholders.split(",").map(function (item) { return clip(item, 40); })
      .filter(function (item) { return /^[A-Za-z0-9_]+$/.test(item); })
      .slice(0, 12);
  } else {
    placeholders = (existing && existing.whatsappPlaceholders) || [];
  }
  const base = existing || {};
  return {
    type: type,
    label: clip(source.label != null ? source.label : base.label || type, 80),
    smsEnabled: asBool(source.smsEnabled, base.smsEnabled !== undefined ? base.smsEnabled : true),
    whatsappEnabled: asBool(source.whatsappEnabled, base.whatsappEnabled !== undefined ? base.whatsappEnabled : false),
    emailEnabled: asBool(source.emailEnabled, base.emailEnabled !== undefined ? base.emailEnabled : false),
    smsBody: clip(source.smsBody != null ? source.smsBody : base.smsBody || "", 640),
    whatsappTemplateName: clip(source.whatsappTemplateName != null ? source.whatsappTemplateName : base.whatsappTemplateName || "", 64),
    whatsappLanguageCode: clip(source.whatsappLanguageCode != null ? source.whatsappLanguageCode : base.whatsappLanguageCode || "en", 16) || "en",
    whatsappPlaceholders: placeholders,
    emailSubject: clip(source.emailSubject != null ? source.emailSubject : base.emailSubject || "", 120),
    emailBody: clip(source.emailBody != null ? source.emailBody : base.emailBody || "", 640)
  };
}

function sanitizeMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return out;
  Object.keys(meta).forEach(function (key) {
    if (Object.keys(out).length >= 20) return;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) return;
    const value = meta[key];
    if (value == null || typeof value === "object") return;
    out[key] = String(value).slice(0, 200);
  });
  return out;
}

function sanitizeEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("JSON object required");
  const type = clip(body.type, 41);
  if (!TYPE_RE.test(type)) throw bad("type is required");
  const phone = normalizePhone(body.phone);
  let amount = null;
  if (body.amount != null && body.amount !== "") {
    amount = Number(body.amount);
    if (!Number.isFinite(amount)) throw bad("amount must be a number");
  }
  return {
    type: type,
    memberId: clip(body.memberId, 64),
    phone: phone,
    email: clip(body.email, 120),
    amount: amount,
    currency: clip(body.currency || "UGX", 8) || "UGX",
    account: clip(body.account, 64),
    reference: clip(body.reference, 80),
    meta: sanitizeMeta(body.meta)
  };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > 65536) {
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
  if (!raw) throw bad("JSON body required");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw bad("JSON body required");
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function match(method, pathname) {
  if (pathname === PREFIX + "/health" && method === "GET") return { name: "health" };
  if (pathname === PREFIX + "/events" && method === "POST") return { name: "events" };
  if (pathname === PREFIX + "/templates" && method === "GET") return { name: "templates.list" };
  if (pathname === PREFIX + "/templates" && method === "POST") return { name: "templates.create" };
  if (pathname === PREFIX + "/deliveries" && method === "GET") return { name: "deliveries" };
  if (pathname === PREFIX + "/test-send" && method === "POST") return { name: "test" };
  const found = pathname.match(/^\/alerts\/api\/v1\/templates\/([a-z][a-z0-9_]{0,40})$/);
  if (!found) return null;
  if (method === "GET") return { name: "templates.get", type: found[1] };
  if (method === "PUT") return { name: "templates.put", type: found[1] };
  if (method === "DELETE") return { name: "templates.delete", type: found[1] };
  return null;
}

function createApp(overrides) {
  const options = overrides || {};
  const store = options.store || createFileStore(defaultDataFile());
  const http = options.http || defaultHttp;
  const log = options.log || function (line) { console.log(line); };
  const configOf = options.config ? function () { return options.config; } : function () { return loadConfig(); };

  return async function handler(req, res) {
    const config = configOf();
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const route = match(req.method, pathname);
      if (!route) {
        send(res, 404, { error: "not_found" });
        return;
      }
      if (route.name !== "health" && !authorized(req, config)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (route.name === "health") {
        send(res, 200, healthBody(config));
        return;
      }
      if (route.name === "templates.list") {
        send(res, 200, { templates: await store.listTemplates() });
        return;
      }
      if (route.name === "templates.get") {
        const row = await store.getTemplate(route.type);
        if (!row) {
          send(res, 404, { error: "unknown event type" });
          return;
        }
        send(res, 200, row);
        return;
      }
      if (route.name === "templates.create") {
        const template = sanitizeTemplate(await readJson(req), null);
        const existing = await store.getTemplate(template.type);
        if (existing) {
          send(res, 409, { error: "template already exists" });
          return;
        }
        send(res, 201, await store.putTemplate(template));
        return;
      }
      if (route.name === "templates.put") {
        const current = await store.getTemplate(route.type);
        const template = sanitizeTemplate(Object.assign({}, await readJson(req), { type: route.type }), current);
        send(res, 200, await store.putTemplate(template));
        return;
      }
      if (route.name === "templates.delete") {
        const removed = await store.deleteTemplate(route.type);
        if (!removed) {
          send(res, 404, { error: "unknown event type" });
          return;
        }
        send(res, 200, { deleted: route.type });
        return;
      }
      if (route.name === "deliveries") {
        const limit = url.searchParams.get("limit");
        send(res, 200, { deliveries: await store.listDeliveries(limit) });
        return;
      }
      if (route.name === "events") {
        const event = sanitizeEvent(await readJson(req));
        const result = await fanOut(event, { store: store, http: http, config: config, log: log });
        send(res, 200, result);
        return;
      }
      if (route.name === "test") {
        const body = await readJson(req);
        const channel = clip(body.channel || "both", 16);
        if (channel !== "sms" && channel !== "whatsapp" && channel !== "both") {
          throw bad("channel must be sms, whatsapp, or both");
        }
        const event = sanitizeEvent(body);
        const result = await fanOut(event, {
          store: store,
          http: http,
          config: config,
          log: log,
          channels: { sms: channel === "sms" || channel === "both", whatsapp: channel === "whatsapp" || channel === "both" }
        });
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: "not_found" });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) log(JSON.stringify({ msg: "alerts.error", error: err.message || "internal_error" }));
      if (!res.headersSent) send(res, status, { error: status >= 500 ? "internal_error" : err.message });
    }
  };
}

async function defaultHttp(req) {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: typeof req.body === "string" ? req.body : JSON.stringify(req.body)
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (err) { json = null; }
  }
  return { status: res.status, text: text, json: json };
}

module.exports = { createApp, sanitizeTemplate, sanitizeEvent, PREFIX };
