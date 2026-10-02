"use strict";

const crypto = require("crypto");
const { renderText, placeholderValues } = require("./render");
const { maskPhone, maskDigits } = require("./phone");
const at = require("./providers/africas-talking");
const lipe = require("./providers/lipechat");

function deliveryId() {
  return "dlv_" + crypto.randomBytes(8).toString("hex");
}

function phoneKey(phone) {
  return crypto.createHash("sha256").update("alerts-phone:" + phone).digest("hex").slice(0, 32);
}

/* Provider errors can echo keys or numbers back; never store either. */
function scrub(text, secrets) {
  let out = String(text || "");
  (secrets || []).forEach(function (secret) {
    if (secret && String(secret).length > 4) out = out.split(String(secret)).join("[redacted]");
  });
  return maskDigits(out).slice(0, 200);
}

/* Stored and returned rows: masked phone, no message body. */
function record(fields) {
  return {
    id: deliveryId(),
    at: new Date().toISOString(),
    type: fields.type,
    source: fields.source || "",
    channel: fields.channel || "",
    provider: fields.provider || "",
    status: fields.status,
    providerId: fields.providerId || "",
    error: fields.error || "",
    to: maskPhone(fields.phone),
    dryRun: Boolean(fields.dryRun),
    length: Number(fields.length) || 0
  };
}

function logLine(log, row) {
  log(JSON.stringify({
    msg: "alerts.delivery",
    type: row.type,
    source: row.source,
    channel: row.channel,
    status: row.status,
    to: row.to,
    dryRun: row.dryRun,
    providerId: row.providerId,
    error: row.error
  }));
}

async function sendSms(job, deps) {
  const config = deps.config;
  const message = renderText(job.template.smsBody, job.ctx);
  const base = { type: job.type, source: job.source, channel: "sms", provider: "africastalking", phone: job.phone, length: message.length };
  if (!message) return record(Object.assign(base, { status: "failed", error: "sms body is empty" }));
  if (!config.smsLive) return record(Object.assign(base, { status: "dry_run", dryRun: true }));
  const built = at.buildSmsRequest({
    username: config.at.username,
    apiKey: config.at.apiKey,
    from: config.at.senderId,
    to: job.phone,
    message: message,
    baseUrl: config.at.baseUrl
  });
  const secrets = [config.at.apiKey, config.serviceKey];
  try {
    const parsed = at.parseSmsResponse(await deps.http(built));
    return record(Object.assign(base, {
      status: parsed.ok ? "sent" : "failed",
      providerId: parsed.providerId,
      error: scrub(parsed.error, secrets)
    }));
  } catch (err) {
    return record(Object.assign(base, { status: "failed", error: scrub(err.name === "TimeoutError" ? "provider timed out" : err.message, secrets) }));
  }
}

async function sendWhatsApp(job, deps) {
  const config = deps.config;
  const name = job.template.whatsappTemplateName;
  const values = placeholderValues(job.template.whatsappPlaceholders, job.ctx);
  const base = { type: job.type, source: job.source, channel: "whatsapp", provider: "lipechat", phone: job.phone, length: values.join("").length };
  if (!name) return record(Object.assign(base, { status: "failed", error: "whatsapp template name is empty" }));
  if (!config.whatsappLive) return record(Object.assign(base, { status: "dry_run", dryRun: true }));
  const built = lipe.buildWhatsAppRequest({
    apiKey: config.lipe.apiKey,
    baseUrl: config.lipe.baseUrl,
    messageId: crypto.randomUUID(),
    to: job.phone,
    from: config.lipe.from,
    templateName: name,
    languageCode: job.template.whatsappLanguageCode || "en",
    placeholders: values
  });
  const secrets = [config.lipe.apiKey, config.serviceKey];
  try {
    const parsed = lipe.parseWhatsAppResponse(await deps.http(built));
    return record(Object.assign(base, {
      status: parsed.ok ? "sent" : "failed",
      providerId: parsed.providerId,
      error: scrub(parsed.error, secrets)
    }));
  } catch (err) {
    return record(Object.assign(base, { status: "failed", error: scrub(err.name === "TimeoutError" ? "provider timed out" : err.message, secrets) }));
  }
}

function summarize(type, rows, reason) {
  const statuses = rows.map(function (row) { return row.status; });
  let status = "skipped";
  if (statuses.indexOf("sent") >= 0) status = "sent";
  else if (statuses.indexOf("dry_run") >= 0) status = "dry_run";
  else if (statuses.indexOf("failed") >= 0) status = "failed";
  return {
    ok: status === "sent" || status === "dry_run",
    type: type,
    status: status,
    reason: reason || (status === "failed" ? rows[rows.length - 1].error : ""),
    deliveries: rows
  };
}

/**
 * job: { type, phone (normalised), ctx (whitelisted), source, channels? }
 * Channels are tried in ALERTS_CHANNEL_ORDER (filtered by the template
 * toggles, or forced for a test-send). The first success stops the chain;
 * a failure falls through to the next channel. Never both on success.
 */
async function deliver(job, deps) {
  const template = await deps.store.getTemplate(job.type);
  const log = deps.log;
  let rows = [];
  let reason = "";
  if (!template) {
    reason = "no template for this event type";
  } else {
    const order = job.channels || deps.config.channelOrder.filter(function (channel) {
      return channel === "sms" ? template.smsEnabled : template.whatsappEnabled;
    });
    if (!order.length) {
      reason = "no channel enabled for this event type";
    } else {
      const quota = await deps.store.consumeQuota(phoneKey(job.phone), {
        perPhoneHourly: deps.config.perPhoneHourly,
        dailyCap: deps.config.dailyCap
      });
      if (!quota.ok) {
        reason = quota.reason;
      } else {
        for (const channel of order) {
          const row = channel === "sms"
            ? await sendSms(Object.assign({ template: template }, job), deps)
            : await sendWhatsApp(Object.assign({ template: template }, job), deps);
          rows.push(row);
          if (row.status === "sent" || row.status === "dry_run") break;
        }
      }
    }
  }
  if (!rows.length) {
    rows = [record({ type: job.type, source: job.source, status: "skipped", error: reason, phone: job.phone })];
  }
  rows.forEach(function (row) { logLine(log, row); });
  await deps.store.appendDeliveries(rows);
  return summarize(job.type, rows, reason);
}

module.exports = { deliver, sendSms, sendWhatsApp, phoneKey, record };
