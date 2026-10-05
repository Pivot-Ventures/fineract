"use strict";

const { FIELDS } = require("./templates");

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const amountFormat = new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 });

function formatAmount(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return (currency || "UGX") + " " + amountFormat.format(n);
}

/* Last four characters only: ****1234 */
function maskAccount(value) {
  const text = String(value == null ? "" : value).replace(/[^A-Za-z0-9]/g, "");
  if (!text) return "";
  return "****" + text.slice(-4);
}

/* Fineract dates arrive as [yyyy, m, d] or "yyyy-MM-dd". */
function formatDate(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return String(value[0]).padStart(4, "0") + "-" + String(value[1]).padStart(2, "0") + "-" + String(value[2]).padStart(2, "0");
  }
  const text = String(value == null ? "" : value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function today(nowMs) {
  /* Africa/Kampala is UTC+3 all year. */
  return new Date((nowMs || Date.now()) + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function plain(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f{}[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * facts come from Fineract (staff events) or the validated service body.
 * Only the whitelisted fields for the type ever reach a template.
 */
function buildContext(type, facts, config) {
  const allowed = FIELDS[type] || [];
  const f = facts || {};
  const all = {
    amount: formatAmount(f.amount, f.currency),
    account: maskAccount(f.account),
    balance: formatAmount(f.balance, f.currency),
    reference: plain(f.reference, 40),
    date: formatDate(f.date) || today(f.nowMs),
    memberName: plain(f.memberName, 60),
    branch: plain((config && config.branchContact) || "your SACCO branch", 60)
  };
  const ctx = {};
  allowed.forEach(function (key) { ctx[key] = all[key] || ""; });
  return ctx;
}

function fill(text, ctx) {
  return text.replace(TOKEN_RE, function (_m, key) {
    return Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] != null ? String(ctx[key]) : "";
  });
}

function renderText(body, ctx) {
  const withSections = String(body || "").replace(/\[\[([^[\]]*)\]\]/g, function (_m, inner) {
    const names = [];
    inner.replace(TOKEN_RE, function (_t, key) { names.push(key); return ""; });
    const complete = names.every(function (key) { return ctx[key] != null && String(ctx[key]) !== ""; });
    return complete ? fill(inner, ctx) : "";
  });
  return fill(withSections, ctx).replace(/[ \t]{2,}/g, " ").trim();
}

function placeholderValues(names, ctx) {
  return (names || []).map(function (name) {
    return ctx[name] == null ? "" : String(ctx[name]);
  });
}

/* Returns the tokens in a template body that the type does not allow. */
function unknownTokens(type, text) {
  const allowed = FIELDS[type] || [];
  const bad = [];
  String(text || "").replace(TOKEN_RE, function (_m, key) {
    if (allowed.indexOf(key) < 0 && bad.indexOf(key) < 0) bad.push(key);
    return "";
  });
  return bad;
}

module.exports = {
  buildContext, renderText, placeholderValues, unknownTokens,
  formatAmount, maskAccount, formatDate, today
};
