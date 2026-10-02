"use strict";

const fs = require("fs/promises");
const path = require("path");
const { defaultTemplates } = require("./templates");

const MAX_DELIVERIES = 500;

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultTemplates()));
}

function createFileStore(file) {
  let chain = Promise.resolve();
  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(function () { return undefined; }, function () { return undefined; });
    return run;
  }

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return { templates: cloneDefaults(), deliveries: [], fresh: true };
      throw err;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      const broken = new Error("alerts store is not valid JSON");
      broken.status = 500;
      throw broken;
    }
    if (!data || !Array.isArray(data.templates) || !Array.isArray(data.deliveries)) {
      const broken = new Error("alerts store is missing templates or deliveries");
      broken.status = 500;
      throw broken;
    }
    return data;
  }

  async function write(data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    const body = { templates: data.templates, deliveries: data.deliveries };
    await fs.writeFile(tmp, JSON.stringify(body, null, 2));
    await fs.rename(tmp, file);
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
    async deleteTemplate(type) {
      return locked(async function () {
        const data = await read();
        const next = data.templates.filter(function (row) { return row.type !== type; });
        if (next.length === data.templates.length) return false;
        data.templates = next;
        await write(data);
        return true;
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
    }
  };
}

function defaultDataFile() {
  return process.env.ALERTS_DATA_FILE || path.join(__dirname, "..", "data", "store.json");
}

module.exports = { createFileStore, defaultDataFile, MAX_DELIVERIES };
