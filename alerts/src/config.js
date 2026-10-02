"use strict";

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
  const forceDry = source.ALERTS_DRY_RUN === "true" || source.ALERTS_DRY_RUN === "1";
  const smsConfigured = Boolean(at.username && at.apiKey);
  const whatsappConfigured = Boolean(lipe.apiKey && lipe.from);
  return {
    apiKey: source.ALERTS_API_KEY || "",
    emailFrom: source.ALERTS_EMAIL_FROM || "",
    at,
    lipe,
    smsConfigured,
    whatsappConfigured,
    emailConfigured: false,
    smsDryRun: forceDry || !smsConfigured,
    whatsappDryRun: forceDry || !whatsappConfigured
  };
}

function healthBody(config) {
  return {
    ok: true,
    service: "transactional-alerts",
    providers: {
      sms: {
        provider: "africastalking",
        configured: config.smsConfigured,
        dryRun: config.smsDryRun
      },
      whatsapp: {
        provider: "lipechat",
        configured: config.whatsappConfigured,
        dryRun: config.whatsappDryRun
      },
      email: {
        provider: "stub",
        configured: false,
        dryRun: true
      }
    }
  };
}

module.exports = { loadConfig, healthBody };
