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

const FAILED_STATUS = ["error", "failed", "failure", "false", "rejected"];

/**
 * 2xx alone is not success: LipeChat can answer 200 with
 * { status: "error" | "failed" | false } or { success: false }.
 */
function parseWhatsAppResponse(res) {
  const status = res && Number(res.status);
  const json = res && res.json && typeof res.json === "object" && !Array.isArray(res.json) ? res.json : null;
  const data = json && json.data && typeof json.data === "object" ? json.data : null;
  const rawId = json && (json.messageId || json.id || (data && (data.messageId || data.id)));
  const providerId = rawId && (typeof rawId === "string" || typeof rawId === "number") ? String(rawId) : "";
  const message = json && [json.message, json.error, json.errorMessage, data && data.message]
    .filter(function (item) { return typeof item === "string" && item; })[0];
  if (!(status >= 200 && status < 300)) {
    return { ok: false, providerId: providerId, error: String(message || String((res && res.text) || "").slice(0, 200) || ("HTTP " + status)) };
  }
  if (json) {
    const flag = json.status;
    const flagText = typeof flag === "string" ? flag.trim().toLowerCase() : "";
    if (flag === false || FAILED_STATUS.indexOf(flagText) >= 0 || json.success === false || (data && data.status === false)) {
      return { ok: false, providerId: providerId, error: String(message || ("status " + String(flag))) };
    }
  }
  return { ok: true, providerId: providerId, error: "" };
}

module.exports = { templateUrl, buildWhatsAppRequest, parseWhatsAppResponse };
