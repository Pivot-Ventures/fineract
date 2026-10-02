"use strict";

const UG_MOBILE = /^256[37]\d{8}$/;

function reject(message) {
  const err = new Error(message || "phone must be a Ugandan mobile number");
  err.status = 400;
  return err;
}

/**
 * Ugandan mobiles only: returns +256 followed by [37] and 8 digits.
 * Accepts 07XXXXXXXX, 7XXXXXXXX, 2567XXXXXXXX, +2567XXXXXXXX,
 * 25607XXXXXXXX (the trunk 0 after 256 is dropped), with spaces or dashes.
 * extraPrefixes (E.164, e.g. "+2547") admits other numbers only when they
 * are written in full international form. Everything else throws 400.
 */
function normalizePhone(raw, extraPrefixes) {
  const text = String(raw == null ? "" : raw).trim();
  let compact = text.replace(/[\s().-]/g, "");
  let international = false;
  if (compact.startsWith("+")) { international = true; compact = compact.slice(1); }
  else if (compact.startsWith("00")) { international = true; compact = compact.slice(2); }
  if (!/^\d{9,15}$/.test(compact)) throw reject();
  let digits = compact;
  if (!international && digits.length === 10 && digits.startsWith("0")) digits = "256" + digits.slice(1);
  else if (!international && digits.length === 9) digits = "256" + digits;
  else if (digits.length === 13 && digits.startsWith("2560")) digits = "256" + digits.slice(4);
  if (UG_MOBILE.test(digits)) return "+" + digits;
  const extra = (extraPrefixes || []).filter(function (prefix) {
    return international && ("+" + compact).startsWith(prefix);
  });
  if (extra.length && compact.length >= 10 && compact.length <= 15) return "+" + compact;
  throw reject();
}

/* +256772123456 -> +2567****456 */
function maskPhone(phone) {
  const text = String(phone || "");
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return "****";
  return (text.startsWith("+") ? "+" : "") + digits.slice(0, 4) + "****" + digits.slice(-3);
}

/* Masks anything that looks like a phone number inside free text. */
function maskDigits(text) {
  return String(text || "").replace(/\+?\d[\d\s-]{7,16}\d/g, function (found) {
    return maskPhone(found);
  });
}

module.exports = { normalizePhone, maskPhone, maskDigits };
