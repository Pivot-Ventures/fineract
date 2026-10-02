"use strict";

const http = require("http");
const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");

function listen(port) {
  const handler = createApp();
  const server = http.createServer(function (req, res) {
    Promise.resolve(handler(req, res)).catch(function (err) {
      if (res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal_error" }));
      console.error(JSON.stringify({ msg: "alerts.error", error: err && err.message }));
    });
  });
  const chosen = Number(port || process.env.PORT || 8095);
  server.listen(chosen, "0.0.0.0", function () {
    const config = loadConfig();
    console.log(JSON.stringify({
      msg: "alerts.listening",
      port: chosen,
      health: "/alerts/api/v1/health",
      smsDryRun: config.smsDryRun,
      whatsappDryRun: config.whatsappDryRun
    }));
  });
  return server;
}

if (require.main === module) listen();

module.exports = { listen };
