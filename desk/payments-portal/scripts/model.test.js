#!/usr/bin/env node
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var model = require("../assets/model.js");

var fixturePath = path.join(__dirname, "..", "fixtures", "intents.json");
var book = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
var intents = book.intents.map(model.normalizeIntent);

assert.strictEqual(intents.length, 100);
assert.strictEqual(book.currency, "UGX");

var summary = model.summarize(intents);
assert.ok(summary.posted >= 50, "posted");
assert.ok(summary.pending >= 15, "pending");
assert.ok(summary.failed >= 10, "failed");
assert.ok(summary.collect > 0 && summary.disburse > 0, "collect and disburse");
["MTN_MOMO", "AIRTEL_MONEY", "BANK", "CARD"].forEach(function (id) {
  assert.ok(summary.byChannel[id].count > 0, id);
});

intents.forEach(function (row) {
  assert.strictEqual(row.currency, "UGX");
  assert.ok(/^[1-9][0-9]*$/.test(row.amount), row.intentId);
  var steps = model.timeline(row);
  assert.strictEqual(steps.length, 4);
  assert.strictEqual(steps[0].label, "Initiated");
  assert.strictEqual(steps[0].state, "done");
  assert.strictEqual(steps[1].label, "Channel ack");
  assert.strictEqual(steps[2].label, "Webhook");
  assert.strictEqual(steps[3].label, "Fineract posted");
  if (row.status === "POSTED") {
    assert.strictEqual(steps[3].state, "done");
    assert.strictEqual(steps[2].state, "done");
  }
  if (row.status === "INITIATED") assert.strictEqual(steps[1].state, "current");
  if (row.status === "PROVIDER_DECLINED") assert.strictEqual(steps[2].state, "failed");
  if (row.status === "CORE_REJECTED" || row.status === "AMBIGUOUS") assert.strictEqual(steps[3].state, "failed");
  if (model.canRetry(row)) {
    var patch = model.retryPatch(row, "Operator retry from payments portal");
    assert.ok(patch.status === "AWAITING_PROVIDER" || patch.status === "POSTING_CORE");
  }
});

var onlyMtn = model.filterIntents(intents, { channel: "MTN_MOMO", direction: "CREDIT" });
assert.ok(onlyMtn.length > 0);
onlyMtn.forEach(function (row) {
  assert.strictEqual(row.channel, "MTN_MOMO");
  assert.strictEqual(row.direction, "CREDIT");
});

var failed = model.filterIntents(intents, { status: "failed" });
assert.strictEqual(failed.length, summary.failed);

var window = model.bookWindow(intents);
assert.ok(window.from <= window.to);

assert.strictEqual(model.modeFor("MTN_MOMO", { mode: { mtnMomo: "mock", channel: "live" } }), "mock");
assert.strictEqual(model.modeFor("AIRTEL_MONEY", { mode: { airtelMoney: "sandbox" } }), "sandbox");
assert.strictEqual(model.modeFor("BANK", { mode: { channel: "live" } }), "live");
assert.strictEqual(model.modeFor("CARD", {}), "");

var wrapped = model.normalizeList({ items: [{ intentId: "pi_x", amount: 10 }] });
assert.strictEqual(wrapped.length, 1);
assert.strictEqual(model.normalizeIntent(wrapped[0]).amount, "10");

var csv = model.toCsv(intents.slice(0, 2));
assert.ok(csv.indexOf("createdAt,intentId,") === 0);
assert.ok(csv.split("\n")[0].indexOf("currency") >= 0);
assert.strictEqual(csv.split("\n").length, 4);

var named = model.filterIntents(intents, { text: "Nakato" });
assert.ok(named.length > 0);

var packs = model.settlementPacks(intents);
assert.ok(packs.length >= 4, "settlement packs");
assert.ok(packs[0].id.indexOf("stl_") === 0);
assert.strictEqual(model.statusTone("AMBIGUOUS"), "ambiguous");
assert.strictEqual(model.statusTone("POSTED"), "posted");
assert.strictEqual(model.channelVisual("CARD").slug, "card");

var css = fs.readFileSync(path.join(__dirname, "..", "assets", "portal.css"), "utf8");
assert.ok(css.indexOf("#1F3A0E") >= 0, "forest green");
assert.ok(css.indexOf("#F8A11B") >= 0, "amber");
["purple", "violet", "#7C3AED", "#4A2480", "#2A1548", "#C9A227", "#5C2D9B"].forEach(function (token) {
  assert.strictEqual(css.toLowerCase().indexOf(token.toLowerCase()), -1, "banned " + token);
});

console.log("ok model " + intents.length + " posted " + summary.posted + " pending " + summary.pending + " failed " + summary.failed);
