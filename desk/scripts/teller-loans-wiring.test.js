"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desk = path.join(__dirname, "..");

function html(name) {
  return fs.readFileSync(path.join(desk, name), "utf8");
}

const tellerPages = ["teller.html", "tellers.html", "teller-detail.html", "cashier-eod.html"];
const loanPages = ["loans.html", "loan-detail.html", "loan-apply.html", "collections.html"];

test("teller pages load frontoffice.js and have no mock tiles", () => {
  for (const name of tellerPages) {
    const text = html(name);
    assert.equal(text.includes("data-mock"), false, name);
    assert.equal(text.includes("banner-mock"), false, name);
    assert.match(text, /assets\/frontoffice\.js/);
    assert.match(text, /assets\/frontoffice\.css/);
    assert.match(text, /assets\/app\.css/);
    assert.match(text, /Phaneroo SACCO/);
    assert.match(text, /Member desk · UGX/);
    assert.match(text, /recurring-deposits\.html/);
    assert.match(text, /settings\.html/);
    assert.match(text, /system\.html/);
  }
  assert.match(html("teller.html"), /data-cash-action/);
  assert.match(html("tellers.html"), /data-action="create-teller"/);
  assert.match(html("teller-detail.html"), /id="td-move-form"/);
  assert.match(html("cashier-eod.html"), /id="settle-form"/);
});

test("loans officer pages load loans.js and have no mock tiles", () => {
  for (const name of loanPages) {
    const text = html(name);
    assert.equal(text.includes("data-mock"), false, name);
    assert.equal(text.includes("banner-mock"), false, name);
    assert.equal(text.includes("frontoffice.js"), false, name);
    assert.match(text, /assets\/loans\.js/);
    assert.match(text, /assets\/app\.css/);
    assert.match(text, /Phaneroo SACCO/);
    assert.match(text, /Member desk · UGX/);
    assert.match(text, /settings\.html/);
    assert.match(text, /system\.html/);
  }
  assert.match(html("loans.html"), /id="loans-filter"/);
  assert.match(html("loan-detail.html"), /id="loan-actions"/);
  assert.match(html("loan-apply.html"), /id="la-client"/);
  assert.match(html("collections.html"), /id="col-bucket"/);
});

test("one owner each: frontoffice teller, pages.js loans fetch, loans.js paint", () => {
  const loans = fs.readFileSync(path.join(desk, "assets/loans.js"), "utf8");
  const pages = fs.readFileSync(path.join(desk, "assets/pages.js"), "utf8");
  const actions = fs.readFileSync(path.join(desk, "assets/actions.js"), "utf8");
  const frontoffice = fs.readFileSync(path.join(desk, "assets/frontoffice.js"), "utf8");
  const appCss = fs.readFileSync(path.join(desk, "assets/app.css"), "utf8");

  assert.match(frontoffice, /if \(page === "teller"\)/);
  assert.match(frontoffice, /if \(page === "tellers"\)/);
  assert.match(frontoffice, /if \(page === "teller-detail"\)/);
  assert.match(frontoffice, /if \(page === "cashier-eod"\)/);

  assert.match(pages, /if \(page === "loans"\)/);
  assert.match(pages, /loans-filter/);
  assert.match(pages, /emit\("desk:loan"/);
  assert.equal(/if \(page === "loans" && !document\.getElementById\("loans-filter"\)\)/.test(pages), false);

  assert.match(loans, /addEventListener\("desk:loan"/);
  assert.match(loans, /if \(page === "loan-apply"\)/);
  assert.match(loans, /if \(page === "loan-detail"\)/);
  assert.match(loans, /if \(page === "collections"\)/);
  assert.equal(/if \(page === "loans"\)/.test(loans), false);
  assert.equal(/function loadLoan|var loadLoan/.test(loans), false);

  assert.equal(/if \(page === "teller"\)/.test(actions), false);
  assert.equal(/if \(page === "tellers"\)/.test(actions), false);
  assert.equal(/if \(page === "loan-apply"\)/.test(actions), false);
  assert.equal(/if \(page === "collections"\)/.test(actions), false);
  assert.match(actions, /frontoffice\.js/);
  assert.match(actions, /see loans\.js/);

  assert.match(appCss, /--navy:\s*#1F3A0E/);
  assert.match(appCss, /--bg:\s*#F7F4EC/);
});
