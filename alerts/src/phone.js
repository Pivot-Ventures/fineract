"use strict";

/**
 * Uganda-friendly international format. Africa's Talking and LipeChat
 * both want a country code. Returns E.164 with a leading plus.
 */
function normalizePhone(raw) {
  let digits = String(raw == null ? "" : raw).trim().replace(/[\s().-]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) {
    const err = new Error("phone must be digits, optionally starting with +");
    err.status = 400;
    throw err;
  }
  if (digits.startsWith("0") && digits.length === 10) digits = "256" + digits.slice(1);
  else if (digits.length === 9 && digits.startsWith("7")) digits = "256" + digits;
  if (digits.length < 10 || digits.length > 15) {
    const err = new Error("phone must include a country code (10–15 digits)");
    err.status = 400;
    throw err;
  }
  return "+" + digits;
}

module.exports = { normalizePhone };
