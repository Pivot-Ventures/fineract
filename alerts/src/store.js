"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { defaultTemplates, TYPES, LEGACY_BODIES } = require("./templates");

const MAX_DELIVERIES = 500;
const MAX_IDEMPOTENCY = 5000;
const IDEMPOTENCY_TTL_MS = 14 * 24 * 3600 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
const HOUR_MS = 3600 * 1000;

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultTemplates()));
}

function kampalaDay(nowMs) {
  return new Date(nowMs + 3 * HOUR_MS).toISOString().slice(0, 10);
}

function emptyData() {
  return {
    templates: cloneDefaults(),
    deliveries: [],
    idempotency: {},
    quota: { day: "", dayCount: 0, phones: {} },
    fresh: true
  };
}

/* Adds missing seeded types, drops retired ones, replaces legacy seeded bodies. */
function migrate(data) {
  const defaults = cloneDefaults();
  const kept = data.templates.filter(function (row) { return row && TYPES.indexOf(row.type) >= 0; });
  defaults.forEach(function (seed) {
    const index = kept.findIndex(function (row) { return row.type === seed.type; });
    if (index < 0) kept.push(seed);
    else if (LEGACY_BODIES[seed.type] && kept[index].smsBody === LEGACY_BODIES[seed.type]) kept[index] = seed;
  });
  data.templates = kept;
  if (!data.idempotency || typeof data.idempotency !== "object" || Array.isArray(data.idempotency)) data.idempotency = {};
  if (!data.quota || typeof data.quota !== "object") data.quota = { day: "", dayCount: 0, phones: {} };
  if (!data.quota.phones || typeof data.quota.phones !== "object") data.quota.phones = {};
  return data;
}

function createFileStore(file, options) {
  const opts = options || {};
  const log = opts.log || function (line) { console.error(line); };
  let chain = Promise.resolve();
  /* Single-process mutex: every read-modify-write runs in order. */
  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(function () { return undefined; }, function () { return undefined; });
    return run;
  }

  async function quarantine(reason) {
    const target = file + ".corrupt-" + Date.now();
    try {
      await fs.rename(file, target);
    } catch (err) {
      /* Leave it in place if it cannot be moved; the next write replaces it. */
    }
    log(JSON.stringify({ msg: "alerts.store_corrupt", reason: reason, movedTo: path.basename(target) }));
    return emptyData();
  }

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return emptyData();
      throw err;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return quarantine("invalid JSON");
    }
    if (!data || !Array.isArray(data.templates) || !Array.isArray(data.deliveries)) {
      return quarantine("missing templates or deliveries");
    }
    return migrate(data);
  }

  async function write(data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    const body = JSON.stringify({
      version: 2,
      templates: data.templates,
      deliveries: data.deliveries,
      idempotency: data.idempotency,
      quota: data.quota
    }, null, 2);
    const handle = await fs.open(tmp, "w", 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.unlink(tmp).catch(function () { return undefined; });
      throw err;
    }
    data.fresh = false;
  }

  function pruneIdempotency(data, nowMs) {
    const keys = Object.keys(data.idempotency);
    keys.forEach(function (key) {
      const row = data.idempotency[key];
      const age = nowMs - Number(row && row.at || 0);
      if (!row || age > IDEMPOTENCY_TTL_MS || (row.pending && age > PENDING_TTL_MS)) delete data.idempotency[key];
    });
    const left = Object.keys(data.idempotency);
    if (left.length > MAX_IDEMPOTENCY) {
      left.sort(function (a, b) { return data.idempotency[a].at - data.idempotency[b].at; })
        .slice(0, left.length - MAX_IDEMPOTENCY)
        .forEach(function (key) { delete data.idempotency[key]; });
    }
  }

  return {
    file: file,
    async listTemplates() {
      return locked(async function () {
        const data = await read();
        if (data.fresh) await write(data);
        return data.templates;
      });
    },
    async getTemplate(type) {
      const rows = await this.listTemplates();
      return rows.filter(function (row) { return row.type === type; })[0] || null;
    },
    async putTemplate(template) {
      return locked(async function () {
        const data = await read();
        const index = data.templates.findIndex(function (row) { return row.type === template.type; });
        if (index < 0) data.templates.push(template);
        else data.templates[index] = template;
        await write(data);
        return template;
      });
    },
    async appendDeliveries(rows) {
      return locked(async function () {
        const data = await read();
        data.deliveries = data.deliveries.concat(rows).slice(-MAX_DELIVERIES);
        await write(data);
        return rows;
      });
    },
    async listDeliveries(limit) {
      return locked(async function () {
        const data = await read();
        const n = Math.max(1, Math.min(Number(limit) || 50, 200));
        return data.deliveries.slice(-n).reverse();
      });
    },
    /* Returns { state: "new" } after reserving the key, or the earlier outcome. */
    async beginIdempotent(key, nowMs) {
      return locked(async function () {
        const now = nowMs || Date.now();
        const data = await read();
        pruneIdempotency(data, now);
        const row = data.idempotency[key];
        if (row && row.pending) return { state: "pending" };
        if (row) return { state: "done", result: row.result };
        data.idempotency[key] = { at: now, pending: true };
        await write(data);
        return { state: "new" };
      });
    },
    async finishIdempotent(key, result, nowMs) {
      return locked(async function () {
        const data = await read();
        data.idempotency[key] = { at: nowMs || Date.now(), result: result };
        await write(data);
      });
    },
    async releaseIdempotent(key) {
      return locked(async function () {
        const data = await read();
        if (!data.idempotency[key]) return;
        delete data.idempotency[key];
        await write(data);
      });
    },
    /**
     * Atomically checks and counts one send to phoneKey (a hash, never the number).
     * limits: { perPhoneHourly, dailyCap }. Returns { ok } or { ok: false, reason }.
     */
    async consumeQuota(phoneKey, limits, nowMs) {
      return locked(async function () {
        const now = nowMs || Date.now();
        const data = await read();
        const quota = data.quota;
        const day = kampalaDay(now);
        if (quota.day !== day) { quota.day = day; quota.dayCount = 0; }
        Object.keys(quota.phones).forEach(function (key) {
          const kept = (quota.phones[key] || []).filter(function (at) { return now - at < HOUR_MS; });
          if (kept.length) quota.phones[key] = kept;
          else delete quota.phones[key];
        });
        const recent = quota.phones[phoneKey] || [];
        if (quota.dayCount >= limits.dailyCap) {
          await write(data);
          return { ok: false, reason: "daily send cap reached (" + limits.dailyCap + ")" };
        }
        if (recent.length >= limits.perPhoneHourly) {
          await write(data);
          return { ok: false, reason: "per-phone hourly limit reached (" + limits.perPhoneHourly + ")" };
        }
        recent.push(now);
        quota.phones[phoneKey] = recent;
        quota.dayCount += 1;
        await write(data);
        return { ok: true };
      });
    }
  };
}

module.exports = { createFileStore, MAX_DELIVERIES, kampalaDay };
