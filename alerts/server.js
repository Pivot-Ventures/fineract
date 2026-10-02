"use strict";

const http = require("http");
const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");

function listen(port, host) {
  const config = loadConfig();
  const handler = createApp();
  const server = http.createServer(function (req, res) {
    Promise.resolve(handler(req, res)).catch(function (err) {
      if (res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal_error" }));
      console.error(JSON.stringify({ msg: "alerts.error", error: String(err && err.message || "").slice(0, 200) }));
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const chosenPort = Number(port || config.port);
  /* Loopback unless HOST says otherwise (the container sets HOST=0.0.0.0). */
  const chosenHost = host || config.host;
  server.listen(chosenPort, chosenHost, function () {
    console.log(JSON.stringify({
      msg: "alerts.listening",
      host: chosenHost,
      port: chosenPort,
      health: "/v1/health",
      mode: config.mode,
      channelOrder: config.channelOrder,
      staffAuth: Boolean(config.fineractUrl),
      serviceAuth: Boolean(config.serviceKey)
    }));
    if (!config.fineractUrl && !config.serviceKey) {
      console.error(JSON.stringify({ msg: "alerts.unconfigured", detail: "set FINERACT_URL and/or ALERTS_SERVICE_KEY; every route but /v1/health answers 503" }));
    }
  });
  return server;
}

if (require.main === module) listen();

module.exports = { listen };
