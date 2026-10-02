"use strict";

function buildContext(event) {
  const ctx = {
    type: event.type || "",
    memberId: event.memberId || "",
    phone: event.phone || "",
    email: event.email || "",
    amount: event.amount == null ? "" : String(event.amount),
    currency: event.currency || "UGX",
    account: event.account || "",
    reference: event.reference || ""
  };
  const meta = event.meta || {};
  Object.keys(meta).forEach(function (key) {
    if (ctx[key]) return;
    ctx[key] = meta[key] == null ? "" : String(meta[key]);
  });
  return ctx;
}

function renderText(body, ctx) {
  return String(body || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (_m, key) {
    return ctx[key] == null ? "" : String(ctx[key]);
  });
}

function placeholderValues(names, ctx) {
  return (names || []).map(function (name) {
    return ctx[name] == null ? "" : String(ctx[name]);
  });
}

module.exports = { buildContext, renderText, placeholderValues };
