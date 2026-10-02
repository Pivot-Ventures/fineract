"use strict";

const crypto = require("crypto");
const { buildContext, renderText, placeholderValues } = require("./render");
const at = require("./providers/africas-talking");
const lipe = require("./providers/lipechat");

function deliveryId() {
  return "dlv_" + crypto.randomBytes(8).toString("hex");
}

function scrub(text, secrets) {
  let out = String(text || "");
  (secrets || []).forEach(function (secret) {
    if (secret && String(secret).length > 4) out = out.split(String(secret)).join("[redacted]");
  });
  return out.slice(0, 300);
}

function record(fields) {
  return {
    id: deliveryId(),
    at: new Date().toISOString(),
    type: fields.type,
    channel: fields.channel,
    provider: fields.provider,
    status: fields.status,
    providerId: fields.providerId || "",
    error: fields.error || "",
    to: fields.to || "",
    reference: fields.reference || "",
    dryRun: Boolean(fields.dryRun),
    preview: String(fields.preview || "").slice(0, 320)
  };
}

async function sendSms(options) {
  const built = at.buildSmsRequest({
    username: options.config.at.username,
    apiKey: options.config.at.apiKey,
    from: options.config.at.senderId,
    to: options.event.phone,
    message: options.message,
    baseUrl: options.config.at.baseUrl
  });
  const secrets = [options.config.at.apiKey, options.config.apiKey];
  if (options.dryRun) {
    options.log(JSON.stringify({
      msg: "alerts.dry_run",
      channel: "sms",
      provider: "africastalking",
      to: options.event.phone,
      request: at.redactRequest(built)
    }));
    return record({
      type: options.event.type,
      channel: "sms",
      provider: "africastalking",
      status: "dry_run",
      to: options.event.phone,
      reference: options.event.reference,
      dryRun: true,
      preview: options.message
    });
  }
  try {
    const res = await options.http(built);
    const parsed = at.parseSmsResponse(res);
    return record({
      type: options.event.type,
      channel: "sms",
      provider: "africastalking",
      status: parsed.ok ? "sent" : "failed",
      providerId: parsed.providerId,
      error: scrub(parsed.error, secrets),
      to: options.event.phone,
      reference: options.event.reference,
      preview: options.message
    });
  } catch (err) {
    return record({
      type: options.event.type,
      channel: "sms",
      provider: "africastalking",
      status: "failed",
      error: scrub(err.message, secrets),
      to: options.event.phone,
      reference: options.event.reference,
      preview: options.message
    });
  }
}

async function sendWhatsApp(options) {
  const messageId = crypto.randomUUID();
  const built = lipe.buildWhatsAppRequest({
    apiKey: options.config.lipe.apiKey,
    baseUrl: options.config.lipe.baseUrl,
    messageId: messageId,
    to: options.event.phone,
    from: options.config.lipe.from,
    templateName: options.template.whatsappTemplateName,
    languageCode: options.template.whatsappLanguageCode || "en",
    placeholders: options.placeholders
  });
  const secrets = [options.config.lipe.apiKey, options.config.apiKey];
  const preview = options.template.whatsappTemplateName + " [" + options.placeholders.join(" | ") + "]";
  if (!options.template.whatsappTemplateName) {
    return record({
      type: options.event.type,
      channel: "whatsapp",
      provider: "lipechat",
      status: "failed",
      error: "whatsapp template name is empty",
      to: options.event.phone,
      reference: options.event.reference,
      preview: preview
    });
  }
  if (options.dryRun) {
    options.log(JSON.stringify({
      msg: "alerts.dry_run",
      channel: "whatsapp",
      provider: "lipechat",
      to: options.event.phone,
      request: lipe.redactRequest(built)
    }));
    return record({
      type: options.event.type,
      channel: "whatsapp",
      provider: "lipechat",
      status: "dry_run",
      to: options.event.phone,
      reference: options.event.reference,
      dryRun: true,
      preview: preview
    });
  }
  try {
    const res = await options.http(built);
    const parsed = lipe.parseWhatsAppResponse(res);
    return record({
      type: options.event.type,
      channel: "whatsapp",
      provider: "lipechat",
      status: parsed.ok ? "sent" : "failed",
      providerId: parsed.providerId,
      error: scrub(parsed.error, secrets),
      to: options.event.phone,
      reference: options.event.reference,
      preview: preview
    });
  } catch (err) {
    return record({
      type: options.event.type,
      channel: "whatsapp",
      provider: "lipechat",
      status: "failed",
      error: scrub(err.message, secrets),
      to: options.event.phone,
      reference: options.event.reference,
      preview: preview
    });
  }
}

function sendEmailStub(options) {
  const ctx = options.ctx;
  const preview = renderText(options.template.emailBody || options.template.smsBody, ctx);
  if (!options.event.email) {
    return record({
      type: options.event.type,
      channel: "email",
      provider: "stub",
      status: "skipped",
      error: "no email address",
      reference: options.event.reference,
      preview: preview
    });
  }
  options.log(JSON.stringify({
    msg: "alerts.email_stub",
    to: options.event.email,
    subject: renderText(options.template.emailSubject, ctx),
    preview: preview
  }));
  return record({
    type: options.event.type,
    channel: "email",
    provider: "stub",
    status: "stub",
    error: "email provider is not configured",
    to: options.event.email,
    reference: options.event.reference,
    dryRun: true,
    preview: preview
  });
}

/**
 * channels, when set, forces those channels for test-send.
 * Otherwise the template toggles decide.
 */
async function fanOut(event, deps) {
  const template = await deps.store.getTemplate(event.type);
  if (!template) {
    const err = new Error("unknown event type");
    err.status = 404;
    throw err;
  }
  const ctx = buildContext(event);
  const message = renderText(template.smsBody, ctx);
  const values = placeholderValues(template.whatsappPlaceholders, ctx);
  const force = deps.channels || null;
  const wantSms = force ? Boolean(force.sms) : Boolean(template.smsEnabled);
  const wantWa = force ? Boolean(force.whatsapp) : Boolean(template.whatsappEnabled);
  const wantEmail = force ? false : Boolean(template.emailEnabled);
  const rows = [];
  if (wantSms) {
    if (!message.trim()) {
      rows.push(record({
        type: event.type, channel: "sms", provider: "africastalking", status: "failed",
        error: "sms body is empty", to: event.phone, reference: event.reference
      }));
    } else {
      rows.push(await sendSms({
        config: deps.config, event: event, message: message, http: deps.http,
        dryRun: deps.config.smsDryRun, log: deps.log
      }));
    }
  }
  if (wantWa) {
    rows.push(await sendWhatsApp({
      config: deps.config, event: event, template: template, placeholders: values,
      http: deps.http, dryRun: deps.config.whatsappDryRun, log: deps.log
    }));
  }
  if (wantEmail) rows.push(sendEmailStub({ event: event, template: template, ctx: ctx, log: deps.log }));
  if (rows.length) await deps.store.appendDeliveries(rows);
  const failed = rows.filter(function (row) { return row.status === "failed"; });
  return {
    ok: failed.length !== rows.length || rows.length === 0,
    type: event.type,
    note: rows.length ? "" : "no channels enabled for this event type",
    deliveries: rows
  };
}

module.exports = { fanOut, sendSms, sendWhatsApp };
