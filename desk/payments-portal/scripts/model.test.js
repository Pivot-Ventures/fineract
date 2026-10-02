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

var qs = model.portalQuery({
  channel: "MTN_MOMO",
  direction: "",
  status: "POSTED",
  product: "SAVINGS_DEPOSIT",
  partnerId: "demo-portal",
  from: "2026-09-01",
  to: "2026-10-02",
  q: "Nakato",
  limit: 8,
  offset: 0
});
assert.ok(qs.indexOf("channel=MTN_MOMO") >= 0);
assert.ok(qs.indexOf("direction=") === -1);
assert.ok(qs.indexOf("partnerId=demo-portal") >= 0);
assert.ok(qs.indexOf("limit=8") >= 0);
assert.ok(qs.indexOf("offset=0") >= 0);
assert.ok(qs.indexOf("q=Nakato") >= 0);

var portalList = model.normalizePortalList({
  items: [{
    intentId: "pi_1",
    amount: "100",
    timeline: [{ label: "Initiated", status: "completed", at: "2026-10-02T10:00:00Z" }]
  }],
  total: 42
});
assert.strictEqual(portalList.total, 42);
assert.strictEqual(portalList.items[0].intentId, "pi_1");
assert.strictEqual(portalList.items[0].timeline[0].state, "done");
assert.strictEqual(model.normalizePortalList([{ intentId: "pi_2", amount: 5 }]).total, 1);

var hookStep = model.normalizeTimeline({
  steps: [{ title: "Webhook", state: "failed", message: "declined", code: "E1" }]
});
assert.strictEqual(hookStep[0].label, "Webhook");
assert.strictEqual(hookStep[0].state, "failed");
assert.strictEqual(hookStep[0].code, "E1");

var fromWrap = model.intentFromPortal({
  intent: { intentId: "pi_9", amount: "1", channel: "MTN_MOMO" },
  timeline: { events: [{ name: "Fineract posted", status: "POSTED" }] }
});
assert.strictEqual(fromWrap.intentId, "pi_9");
assert.strictEqual(fromWrap.timeline[0].state, "done");

var summaryApi = model.normalizeSummary({
  grossVolume: 1000,
  successRate: 0.62,
  settledVolume: 800,
  posted: 62,
  pending: 20,
  failed: 18,
  channels: [{ channel: "MTN_MOMO", volume: 400, count: 30, successRate: 0.8 }]
});
assert.strictEqual(summaryApi.volumeAll, 1000);
assert.strictEqual(summaryApi.volumePosted, 800);
assert.ok(Math.abs(summaryApi.successRate - 62) < 0.01);
assert.strictEqual(summaryApi.byChannel.MTN_MOMO.volume, 400);
assert.strictEqual(summaryApi.byChannel.MTN_MOMO.posted, 24);
assert.strictEqual(summaryApi.byChannel.CARD.count, 0);
assert.strictEqual(model.normalizeSummary(null), null);

/* ---- CSV escaping (formula injection) ---- */
assert.strictEqual(model.csvEscape("=1+1"), "'=1+1");
assert.strictEqual(model.csvEscape("+256700"), "'+256700");
assert.strictEqual(model.csvEscape("-5"), "'-5");
assert.strictEqual(model.csvEscape("@SUM(A1)"), "'@SUM(A1)");
assert.strictEqual(model.csvEscape("\tx"), "'\tx");
assert.strictEqual(model.csvEscape("\rx"), "\"'\rx\"");
assert.strictEqual(model.csvEscape("a,b"), '"a,b"');
assert.strictEqual(model.csvEscape('say "hi"'), '"say ""hi"""');
assert.strictEqual(model.csvEscape("line\nbreak"), '"line\nbreak"');
assert.strictEqual(model.csvEscape("=HYPERLINK(\"x\",\"y\")"), '"\'=HYPERLINK(""x"",""y"")"');
assert.strictEqual(model.csvEscape(null), "");
assert.strictEqual(model.csvEscape(1200), "1200");
var evil = model.toCsv([model.normalizeIntent({ intentId: "pi_e", memberName: "=cmd|' /C calc'!A0", amount: "5" })]);
assert.ok(evil.split("\n")[1].indexOf(",'=cmd") >= 0, "formula neutralised in toCsv");
var demoCsv = model.toCsv(intents.slice(0, 1), { demo: true });
assert.strictEqual(demoCsv.split("\n")[0], model.DEMO_CSV_LINE);
assert.ok(demoCsv.split("\n")[1].indexOf("createdAt,") === 0);
var packCsv = model.packsToCsv([{ id: "stl_1", day: "2026-10-02", channel: "MTN_MOMO", count: 2, volume: 10, posted: 10 }], { demo: true });
assert.strictEqual(packCsv.split("\n")[0], model.DEMO_CSV_LINE);
assert.strictEqual(packCsv.split("\n")[2], "stl_1,2026-10-02,MTN_MOMO,2,10,10,Settled");
assert.strictEqual(model.packsToCsv([]).split("\n")[0], "packId,date,channel,txns,volume,corePosted,status");

/* ---- amount parsing ---- */
function amt(raw) { return model.parseWholeShillings(raw); }
assert.strictEqual(model.MAX_INITIATE_UGX, 5000000);
assert.deepStrictEqual([amt("50000").ok, amt("50000").value], [true, "50000"]);
assert.strictEqual(amt("1,234,000").value, "1234000");
assert.strictEqual(amt(" 2,500 ").value, "2500");
assert.strictEqual(amt("007").value, "7");
assert.strictEqual(amt("5,000,000").ok, true);
assert.strictEqual(amt("5000001").ok, false);
assert.strictEqual(amt("99999999999999999999").ok, false);
["", "0", "0,000", "12.50", "1e6", "1E3", "-500", "+500", "1,23", "12,3456", "1 000", "UGX 500", "0x10", "50k", "1,000.00", "Infinity"].forEach(function (bad) {
  var parsed = amt(bad);
  assert.strictEqual(parsed.ok, false, "reject " + JSON.stringify(bad));
  assert.ok(parsed.error.length > 0);
});
assert.strictEqual(model.parseWholeShillings("2,000", 1000).ok, false);
assert.strictEqual(model.formatUgx(amt("1,234,000").value), "UGX 1,234,000");

/* ---- KPIs: collections, settled, success rate ---- */
var kpiRows = [
  { intentId: "k1", status: "POSTED", direction: "CREDIT", channel: "MTN_MOMO", amount: "1000", createdAt: "2026-10-02T08:00:00Z" },
  { intentId: "k2", status: "REVERSED", direction: "CREDIT", channel: "MTN_MOMO", amount: "500", createdAt: "2026-10-02T08:00:00Z" },
  { intentId: "k3", status: "AWAITING_PROVIDER", direction: "CREDIT", channel: "MTN_MOMO", amount: "300", createdAt: "2026-10-02T08:00:00Z" },
  { intentId: "k4", status: "PROVIDER_DECLINED", direction: "CREDIT", channel: "AIRTEL_MONEY", amount: "200", createdAt: "2026-10-02T08:00:00Z" },
  { intentId: "k5", status: "AMBIGUOUS", direction: "DEBIT", channel: "BANK", amount: "100", createdAt: "2026-10-02T08:00:00Z" },
  { intentId: "k6", status: "POSTED", direction: "DEBIT", channel: "BANK", amount: "50", createdAt: "2026-10-02T08:00:00Z" },
  { intentId: "k7", status: "CORE_REJECTED", direction: "DEBIT", channel: "CARD", amount: "25", createdAt: "2026-10-02T08:00:00Z" }
].map(model.normalizeIntent);
var k = model.summarize(kpiRows);
assert.strictEqual(k.collect, 1000, "collections = POSTED CREDIT only");
assert.strictEqual(k.collectInitiated, 2000);
assert.strictEqual(k.disburse, 50, "disbursements = POSTED DEBIT only");
assert.strictEqual(k.volumePosted, 1050, "REVERSED not settled to core");
assert.strictEqual(k.posted, 2, "REVERSED not posted");
assert.strictEqual(k.reversed, 1);
assert.strictEqual(k.pending, 1);
assert.strictEqual(k.failed, 3);
assert.strictEqual(k.ambiguous, 1);
assert.strictEqual(k.completed, 4, "POSTED + declined + rejected; no pending/ambiguous/reversed");
assert.strictEqual(k.successRate, 50);
assert.strictEqual(k.byChannel.MTN_MOMO.completed, 1);
assert.strictEqual(k.byChannel.BANK.completed, 1);
assert.strictEqual(model.summarize([kpiRows[2], kpiRows[4]]).successRate, null, "no completed runs -> null");
assert.strictEqual(model.formatRate(null), "—");
assert.strictEqual(model.formatRate(50), "50.0%");
assert.strictEqual(model.bucket("REVERSED"), "reversed");
assert.strictEqual(model.filterIntents(kpiRows, { status: "posted" }).length, 2);
var kpiPacks = model.settlementPacks(kpiRows);
var mtnPack = kpiPacks.filter(function (p) { return p.channel === "MTN_MOMO"; })[0];
assert.strictEqual(mtnPack.posted, 1000, "reversed not in pack posted");
assert.strictEqual(model.packSettled(mtnPack), false);
assert.strictEqual(model.todayKampala(new Date("2026-10-01T22:30:00Z")), "2026-10-02", "Kampala is UTC+3");

/* ---- date filters with unreadable createdAt ---- */
var dated = [
  model.normalizeIntent({ intentId: "d1", createdAt: "2026-10-02T09:00:00Z", amount: "1" }),
  model.normalizeIntent({ intentId: "d2", createdAt: "not-a-date", amount: "1" }),
  model.normalizeIntent({ intentId: "d3", createdAt: "", amount: "1" })
];
assert.deepStrictEqual(model.filterIntents(dated, { from: "2026-10-01" }).map(function (r) { return r.intentId; }), ["d1"]);
assert.deepStrictEqual(model.filterIntents(dated, { to: "2026-10-03" }).map(function (r) { return r.intentId; }), ["d1"]);
assert.strictEqual(model.filterIntents(dated, {}).length, 3, "no date filter keeps every row");

/* ---- byNewest across offsets ---- */
var offsets = [
  { intentId: "o1", createdAt: "2026-10-02T10:00:00+03:00" },
  { intentId: "o2", createdAt: "2026-10-02T08:30:00Z" },
  { intentId: "o3", createdAt: "garbage" },
  { intentId: "o4", createdAt: "2026-10-02T09:00:00-02:00" }
];
assert.deepStrictEqual(offsets.slice().sort(model.byNewest).map(function (r) { return r.intentId; }), ["o4", "o2", "o1", "o3"]);

/* ---- retry request ---- */
var declined = model.normalizeIntent({ intentId: "r1", status: "PROVIDER_DECLINED" });
var ambiguousRun = model.normalizeIntent({ intentId: "r2", status: "AMBIGUOUS", providerReference: "MTN-123" });
assert.strictEqual(model.retryRequest(declined, { note: "checked with MTN", confirmNotPosted: false }).ok, false);
assert.strictEqual(model.retryRequest(declined, { note: "short", confirmNotPosted: true }).ok, false);
var okRetry = model.retryRequest(declined, { note: "checked with MTN", confirmNotPosted: true });
assert.strictEqual(okRetry.ok, true);
assert.strictEqual(okRetry.body.confirmNotPosted, true);
assert.strictEqual(model.retryRequest(ambiguousRun, { note: "checked with MTN", confirmNotPosted: true }).ok, false);
assert.strictEqual(model.retryRequest(ambiguousRun, { note: "checked with MTN", confirmNotPosted: true, providerReference: "MTN-999" }).ok, false);
assert.strictEqual(model.retryRequest(ambiguousRun, { note: "checked with MTN", confirmNotPosted: true, providerReference: "MTN-123" }).ok, true);
assert.strictEqual(model.retryRequest(model.normalizeIntent({ status: "POSTED" }), { note: "checked with MTN", confirmNotPosted: true }).ok, false);

/* ---- page plan ---- */
var many = [];
for (var i = 0; i < 20; i++) many.push({ intentId: "p" + i });
var srv = model.pagePlan(many.slice(0, 8), 20, 1, 8);
assert.strictEqual(srv.mode, "server");
assert.strictEqual(srv.total, 20);
var cli = model.pagePlan(many, 20, 2, 8);
assert.strictEqual(cli.mode, "client");
assert.deepStrictEqual(cli.rows.map(function (r) { return r.intentId; }), ["p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15"]);
assert.ok(cli.note.length > 0);
var bad = model.pagePlan(many.slice(0, 12), 50, 1, 8);
assert.strictEqual(bad.mode, "untrusted");
assert.strictEqual(bad.rows.length, 0);

var css = fs.readFileSync(path.join(__dirname, "..", "assets", "portal.css"), "utf8");
assert.ok(css.indexOf("#1F3A0E") >= 0, "forest green");
assert.ok(css.indexOf("#F8A11B") >= 0, "amber");
["purple", "violet", "#7C3AED", "#4A2480", "#2A1548", "#C9A227", "#5C2D9B"].forEach(function (token) {
  assert.strictEqual(css.toLowerCase().indexOf(token.toLowerCase()), -1, "banned " + token);
});

console.log("ok model " + intents.length + " posted " + summary.posted + " pending " + summary.pending + " failed " + summary.failed);
