"use strict";

const path = require("path");

const CHANNELS = ["sms", "whatsapp"];

function intOf(value, fallback, min, max) {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function channelOrder(raw) {
  const list = String(raw || "sms").split(",").map(function (item) { return item.trim().toLowerCase(); })
    .filter(function (item) { return item; });
  const out = [];
  list.forEach(function (item) {
    if (CHANNELS.indexOf(item) >= 0 && out.indexOf(item) < 0) out.push(item);
  });
  return out.length ? out : ["sms"];
}

function prefixes(raw) {
  return String(raw || "").split(",").map(function (item) { return item.trim(); })
    .filter(function (item) { return /^\+\d{1,6}$/.test(item); });
}

function dataFile(source) {
  if (source.ALERTS_DATA_FILE) return source.ALERTS_DATA_FILE;
  if (source.ALERTS_DATA_DIR) return path.join(source.ALERTS_DATA_DIR, "store.json");
  return path.join(__dirname, "..", "data", "store.json");
}

function loadConfig(env) {
  const source = env || process.env;
  const at = {
    username: source.AT_USERNAME || "",
    apiKey: source.AT_API_KEY || "",
    senderId: source.AT_SENDER_ID || "",
    baseUrl: source.AT_BASE_URL || "https://api.africastalking.com"
  };
  const lipe = {
    apiKey: source.LIPECHAT_API_KEY || "",
    from: source.LIPECHAT_FROM || "",
    baseUrl: source.LIPECHAT_BASE_URL || "https://gateway.lipachat.com"
  };
  /* Live only when explicitly asked for AND the provider has credentials. */
  const live = source.ALERTS_LIVE === "true";
  const smsConfigured = Boolean(at.username && at.apiKey);
  const whatsappConfigured = Boolean(lipe.apiKey && lipe.from);
  const smsLive = live && smsConfigured;
  const whatsappLive = live && whatsappConfigured;
  return {
    host: source.HOST || "127.0.0.1",
    port: intOf(source.PORT, 8095, 1, 65535),
    fineractUrl: String(source.FINERACT_URL || "").replace(/\/+$/, ""),
    fineractTenant: source.FINERACT_TENANT || "default",
    serviceKey: source.ALERTS_SERVICE_KEY || "",
    adminPermission: source.ALERTS_ADMIN_PERMISSION || "ALL_FUNCTIONS",
    live: live,
    at: at,
    lipe: lipe,
    smsConfigured: smsConfigured,
    whatsappConfigured: whatsappConfigured,
    smsLive: smsLive,
    whatsappLive: whatsappLive,
    smsDryRun: !smsLive,
    whatsappDryRun: !whatsappLive,
    mode: smsLive || whatsappLive ? "live" : "dry-run",
    channelOrder: channelOrder(source.ALERTS_CHANNEL_ORDER),
    perPhoneHourly: intOf(source.ALERTS_PER_PHONE_HOURLY, 10, 1, 1000),
    dailyCap: intOf(source.ALERTS_DAILY_CAP, 2000, 1, 1000000),
    ratePerMinute: intOf(source.ALERTS_RATE_PER_MINUTE, 120, 1, 100000),
    trustProxy: source.ALERTS_TRUST_PROXY === "true",
    extraPrefixes: prefixes(source.ALERTS_EXTRA_PREFIXES),
    branchContact: String(source.ALERTS_BRANCH_CONTACT || "your SACCO branch").slice(0, 60),
    dataFile: dataFile(source)
  };
}

/* Public. No secrets, no configuration detail beyond the mode. */
function healthBody(config) {
  return { ok: true, mode: config.mode };
}

/* Staff admin only. Booleans and limits; never keys. */
function settingsBody(config) {
  return {
    mode: config.mode,
    liveRequested: config.live,
    channelOrder: config.channelOrder,
    perPhoneHourly: config.perPhoneHourly,
    dailyCap: config.dailyCap,
    ratePerMinute: config.ratePerMinute,
    adminPermission: config.adminPermission,
    extraPrefixes: config.extraPrefixes,
    branchContact: config.branchContact,
    staffAuth: Boolean(config.fineractUrl),
    serviceAuth: Boolean(config.serviceKey),
    providers: {
      sms: { provider: "africastalking", configured: config.smsConfigured, live: config.smsLive },
      whatsapp: { provider: "lipechat", configured: config.whatsappConfigured, live: config.whatsappLive }
    }
  };
}

module.exports = { loadConfig, healthBody, settingsBody, CHANNELS };
