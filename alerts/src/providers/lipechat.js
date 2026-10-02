"use strict";

/**
 * LipeChat WhatsApp template send.
 * POST https://gateway.lipachat.com/api/v1/whatsapp/template
 * Header apiKey. Body matches the published template schema.
 */
function templateUrl(baseUrl) {
  const base = String(baseUrl || "https://gateway.lipachat.com").replace(/\/$/, "");
  if (/\/api\/v1\/whatsapp\/template$/.test(base)) return base;
  return base + "/api/v1/whatsapp/template";
}

function buildWhatsAppRequest(input) {
  return {
    url: templateUrl(input.baseUrl),
    method: "POST",
    headers: {
      apiKey: input.apiKey || "",
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: {
      messageId: input.messageId,
      to: input.to,
      from: input.from,
      template: {
        name: input.templateName,
        languageCode: input.languageCode || "en",
        components: {
          body: {
            placeholders: (input.placeholders || []).map(function (value) { return String(value); })
          }
        }
      }
    }
  };
}

function parseWhatsAppResponse(res) {
  const json = res && res.json;
  const providerId = json && (json.messageId || json.id || (json.data && (json.data.messageId || json.data.id)));
  if (res && res.status >= 200 && res.status < 300) {
    return { ok: true, providerId: providerId ? String(providerId) : "", error: "" };
  }
  const message = (json && (json.message || json.error || json.errorMessage)) || (res && res.text ? String(res.text).slice(0, 300) : "") || ("HTTP " + (res && res.status));
  return { ok: false, providerId: providerId ? String(providerId) : "", error: String(message) };
}

function redactRequest(built) {
  const headers = Object.assign({}, built.headers);
  if (headers.apiKey) headers.apiKey = "[redacted]";
  return { url: built.url, method: built.method, headers: headers, body: built.body };
}

module.exports = { templateUrl, buildWhatsAppRequest, parseWhatsAppResponse, redactRequest };
