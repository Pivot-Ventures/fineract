"use strict";

const crypto = require("crypto");

const STAFF_TTL_MS = 60 * 1000;
const MAX_CACHE = 500;

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

/* Hash both sides first so neither the length nor the prefix leaks. */
function safeEqual(provided, expected) {
  if (!provided || !expected) return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

function staffKeyOf(header) {
  const text = String(header || "").trim();
  const match = text.match(/^Basic\s+([A-Za-z0-9+/=]{4,1024})$/);
  return match ? match[1] : "";
}

/**
 * Two callers:
 *  - service: X-Alerts-Service-Key equal to ALERTS_SERVICE_KEY (member gateway)
 *  - staff:   X-Staff-Authorization: Basic <Desk key>, checked against Fineract
 *             POST /authentication; a positive answer is cached ~60 s by sha256(key).
 * With neither ALERTS_SERVICE_KEY nor FINERACT_URL configured nothing is open.
 */
function createAuth(deps) {
  const cache = new Map();
  const now = deps.now || Date.now;

  async function verifyStaff(config, basicKey) {
    const cacheKey = sha256(basicKey).toString("hex");
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now()) return hit.staff;
    if (hit) cache.delete(cacheKey);
    let user;
    let password;
    try {
      const decoded = Buffer.from(basicKey, "base64").toString("utf8");
      const index = decoded.indexOf(":");
      if (index <= 0) throw new Error("no colon");
      user = decoded.slice(0, index);
      password = decoded.slice(index + 1);
    } catch (err) {
      throw fail("unauthorized", 401);
    }
    let res;
    try {
      res = await deps.http({
        url: config.fineractUrl + "/authentication",
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Fineract-Platform-TenantId": config.fineractTenant
        },
        body: { username: user, password: password }
      });
    } catch (err) {
      throw fail("core banking unreachable", 503);
    }
    if (res.status >= 500) throw fail("core banking unavailable", 503);
    const data = res.json || {};
    if (res.status !== 200 || !data.authenticated) throw fail("unauthorized", 401);
    const staff = {
      kind: "staff",
      username: String(data.username || user).slice(0, 100),
      permissions: Array.isArray(data.permissions) ? data.permissions.map(String) : [],
      basicKey: basicKey
    };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { expires: now() + STAFF_TTL_MS, staff: { kind: staff.kind, username: staff.username, permissions: staff.permissions } });
    return staff;
  }

  async function authenticate(req, config) {
    if (!config.serviceKey && !config.fineractUrl) throw fail("alerts service is not configured for authentication", 503);
    const serviceHeader = req.headers["x-alerts-service-key"];
    if (serviceHeader !== undefined) {
      if (config.serviceKey && safeEqual(serviceHeader, config.serviceKey)) return { kind: "service" };
      throw fail("unauthorized", 401);
    }
    const staffHeader = req.headers["x-staff-authorization"];
    if (staffHeader !== undefined) {
      const basicKey = staffKeyOf(staffHeader);
      if (!basicKey) throw fail("unauthorized", 401);
      if (!config.fineractUrl) throw fail("staff sign-in is not configured", 503);
      const staff = await verifyStaff(config, basicKey);
      /* The cached entry never holds the key; re-attach it for this request only. */
      return { kind: "staff", username: staff.username, permissions: staff.permissions, basicKey: basicKey };
    }
    throw fail("unauthorized", 401);
  }

  function isAdmin(principal, config) {
    if (!principal || principal.kind !== "staff") return false;
    const perms = principal.permissions || [];
    return perms.indexOf("ALL_FUNCTIONS") >= 0 || perms.indexOf(config.adminPermission) >= 0;
  }

  return { authenticate: authenticate, isAdmin: isAdmin, cache: cache };
}

module.exports = { createAuth, safeEqual, sha256 };
