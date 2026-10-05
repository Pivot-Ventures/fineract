"use strict";

// Health probe for the alerts service, run on the droplet by
// install-on-host.sh. Talks to the service directly (not through the
// proxy), so the path is /v1/health. Behind the proxy the same endpoint is
// /alerts/api/v1/health.
//
// Usage: node check-health.js [port] [host]
// Exits 0 when healthy, 1 otherwise. Never prints response headers or
// environment values.

const port = Number(process.argv[2] || 8095);
const host = String(process.argv[3] || "127.0.0.1");
const TIMEOUT_MS = 3000;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write("health check port is invalid\n");
  process.exit(1);
}
if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(host)) {
  process.stderr.write("health check host must be loopback\n");
  process.exit(1);
}

const url = "http://" + host + ":" + port + "/v1/health";

async function main() {
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    const reason = err && err.name === "TimeoutError"
      ? "timed out after " + TIMEOUT_MS + "ms"
      : String((err && err.cause && err.cause.code) || (err && err.message) || err);
    process.stderr.write("health check failed: " + url + " " + reason + "\n");
    return 1;
  }

  const text = (await res.text()).slice(0, 4096);
  if (res.status !== 200) {
    process.stderr.write("health check failed: " + url + " HTTP " + res.status + "\n");
    return 1;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    process.stderr.write("health check failed: response is not JSON\n");
    return 1;
  }
  const ok = body && (body.ok === true || body.status === "ok");
  if (!ok) {
    process.stderr.write("health check failed: service did not report ok\n");
    return 1;
  }
  // Print only non-sensitive summary fields.
  const summary = { ok: true };
  if (typeof body.service === "string") summary.service = body.service;
  if (typeof body.version === "string") summary.version = body.version;
  if (typeof body.live === "boolean") summary.live = body.live;
  if (typeof body.dryRun === "boolean") summary.dryRun = body.dryRun;
  process.stdout.write(JSON.stringify(summary) + "\n");
  return 0;
}

main().then(
  function (code) { process.exit(code); },
  function (err) {
    process.stderr.write("health check crashed: " + String((err && err.message) || err) + "\n");
    process.exit(1);
  }
);
