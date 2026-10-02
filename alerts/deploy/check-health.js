"use strict";

const http = require("http");

const port = Number(process.argv[2] || 8095);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("health check port is invalid\n");
  process.exit(1);
}

const req = http.get(
  {
    host: "127.0.0.1",
    port: port,
    path: "/alerts/api/v1/health",
    timeout: 2000
  },
  function (res) {
    const chunks = [];
    res.on("data", function (chunk) { chunks.push(chunk); });
    res.on("end", function () {
      const body = Buffer.concat(chunks).toString("utf8");
      process.stdout.write(body + "\n");
      if (res.statusCode !== 200) process.exit(1);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        process.exit(1);
      }
      if (!parsed || parsed.ok !== true || parsed.service !== "transactional-alerts") {
        process.exit(1);
      }
    });
  }
);

req.on("error", function (err) {
  process.stderr.write(String((err && err.message) || err) + "\n");
  process.exit(1);
});
req.on("timeout", function () {
  req.destroy();
  process.stderr.write("health check timed out\n");
  process.exit(1);
});
