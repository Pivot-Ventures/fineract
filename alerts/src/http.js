"use strict";

const TIMEOUT_MS = 10000;

/**
 * Every outbound call (providers and Fineract) goes through here.
 * req: { url, method, headers, body }  ->  { status, json, text }
 */
async function defaultHttp(req) {
  const init = {
    method: req.method || "GET",
    headers: req.headers || {},
    signal: AbortSignal.timeout(TIMEOUT_MS)
  };
  if (req.body !== undefined && req.body !== null) {
    init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  const res = await fetch(req.url, init);
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (err) { json = null; }
  }
  return { status: res.status, text: text.slice(0, 4000), json: json };
}

module.exports = { defaultHttp, TIMEOUT_MS };
