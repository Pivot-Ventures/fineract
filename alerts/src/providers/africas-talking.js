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

const AT_OK_CODES = [100, 101, 102];

/**
 * Success only when HTTP is 2xx, Recipients is a non-empty list, and every
 * recipient statusCode is 100 (Processed), 101 (Sent) or 102 (Queued).
 * Anything else is a failure carrying SMSMessageData.Message or the
 * recipient status as the reason.
 */
function parseSmsResponse(res) {
  const status = res && Number(res.status);
  const json = res && res.json && typeof res.json === "object" ? res.json : null;
  const data = json && json.SMSMessageData && typeof json.SMSMessageData === "object" ? json.SMSMessageData : null;
  const recipients = data && Array.isArray(data.Recipients) ? data.Recipients : [];
  const first = recipients[0] && typeof recipients[0] === "object" ? recipients[0] : null;
  const providerId = first && first.messageId && first.messageId !== "None" ? String(first.messageId) : "";
  const summary = data && data.Message ? String(data.Message) : "";
  if (!(status >= 200 && status < 300)) {
    const message = (json && (json.message || json.errorMessage)) || summary || String((res && res.text) || "").slice(0, 200) || ("HTTP " + status);
    return { ok: false, providerId: providerId, error: String(message) };
  }
  if (!recipients.length) {
    return { ok: false, providerId: "", error: summary || "Africa's Talking accepted no recipients" };
  }
  const rejected = recipients.filter(function (row) {
    return !row || AT_OK_CODES.indexOf(Number(row.statusCode)) < 0;
  });
  if (rejected.length) {
    const row = rejected[0] || {};
    return { ok: false, providerId: providerId, error: String(row.status || summary || ("statusCode " + row.statusCode)) };
  }
  return { ok: true, providerId: providerId, error: "" };
}

module.exports = { messagingUrl, buildSmsRequest, parseSmsResponse, AT_OK_CODES };
