"use strict";

/**
 * Africa's Talking SMS.
 * Live:  POST https://api.africastalking.com/version1/messaging
 * Sandbox host is selected with AT_BASE_URL.
 * Auth is the apiKey header. username, to, message, and optional from
 * are application/x-www-form-urlencoded fields.
 */
function messagingUrl(baseUrl) {
  const base = String(baseUrl || "https://api.africastalking.com").replace(/\/$/, "");
  if (/\/version1\/messaging$/.test(base)) return base;
  return base + "/version1/messaging";
}

function buildSmsRequest(input) {
  const params = new URLSearchParams();
  params.set("username", input.username || "");
  params.set("to", input.to || "");
  params.set("message", input.message || "");
  if (input.from) params.set("from", input.from);
  return {
    url: messagingUrl(input.baseUrl),
    method: "POST",
    headers: {
      apiKey: input.apiKey || "",
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  };
}

function parseSmsResponse(res) {
  const json = res && res.json;
  const recipients = json && json.SMSMessageData && json.SMSMessageData.Recipients;
  const first = Array.isArray(recipients) ? recipients[0] : null;
  if (res && res.status >= 400) {
    const message = (json && (json.message || json.errorMessage)) || (res.text || "").slice(0, 300) || ("HTTP " + res.status);
    return { ok: false, providerId: first && first.messageId ? String(first.messageId) : "", error: String(message) };
  }
  if (first) {
    const code = Number(first.statusCode);
    const failed = Number.isFinite(code) && code >= 400;
    return {
      ok: !failed,
      providerId: first.messageId ? String(first.messageId) : "",
      error: failed ? String(first.status || "rejected") : ""
    };
  }
  if (res && res.status >= 200 && res.status < 300) {
    return { ok: true, providerId: "", error: "" };
  }
  return { ok: false, providerId: "", error: "unexpected Africa's Talking response" };
}

function redactRequest(built) {
  const headers = Object.assign({}, built.headers);
  if (headers.apiKey) headers.apiKey = "[redacted]";
  return { url: built.url, method: built.method, headers: headers, body: built.body };
}

module.exports = { messagingUrl, buildSmsRequest, parseSmsResponse, redactRequest };
