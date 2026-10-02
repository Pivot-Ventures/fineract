/* ===== SAVINGS/SHARES/FD ===== */
/*
 * Pivot SACCO Desk — savings, shares and fixed deposits.
 * Pages: savings, savings-detail, shares, share-detail, fixed-deposits, fd-detail.
 * Reads and writes go straight to Fineract; every money movement has a review step.
 */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;

  var page = document.body.getAttribute("data-page") || "";
  var PAGES = ["savings", "savings-detail", "shares", "share-detail", "fixed-deposits", "fd-detail"];
  if (PAGES.indexOf(page) < 0) return;

  var esc = api.escapeHtml;
  var money = api.formatMoney;
  var DATE = { locale: "en", dateFormat: "yyyy-MM-dd" };
  var PAGE_SIZE = 25;
  var BULK = 1000;
  var SUFFIX = document.title.indexOf(" · ") >= 0 ? document.title.slice(document.title.indexOf(" · ")) : "";

  /* ------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function enc(v) { return encodeURIComponent(v); }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  }
  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function plural(n, word) { return api.formatNumber(n) + " " + word + (Number(n) === 1 ? "" : "s"); }
  function actions(name) { return Array.prototype.slice.call(document.querySelectorAll('[data-action="' + name + '"]')); }
  function permitted(el) {
    var codes = (el.getAttribute("data-perm") || "").split(/\s+/).filter(Boolean);
    return !codes.length || api.can(codes);
  }
  /* Shows an action button only when the account state allows it AND the user has the permission. */
  function toggle(name, cond) { actions(name).forEach(function (b) { b.hidden = !(cond && permitted(b)); }); }
  function optionLabel(field, value) {
    var o = (field.options || []).filter(function (x) { return String(x.value) === String(value); })[0];
    return o ? o.label : String(value);
  }

  /* Turns Fineract validation codes into sentences a teller can act on. */
  var CODE_TEXT = {
    "error.msg.savingsaccount.transaction.insufficient.account.balance": "Insufficient balance: the amount (plus any withdrawal fee or minimum balance) is more than the account can pay.",
    "validation.msg.sharesaccount.cannot.be.redeemed.due.to.lockinperiod": "These shares are still inside the lock-in period and cannot be redeemed yet.",
    "validation.msg.sharesaccount.cannot.be.redeemed.due.to.insufficient.shares": "The member does not hold that many shares.",
    "validation.msg.sharesaccount.cannot.be.redeemed.due.to.insufficient.shares.for.this.redeem.date": "The member did not hold that many shares on that date.",
    "validation.msg.sharesaccount.exceeding.maximum.limit.defined.in.the.shareproduct": "That would take the member above the maximum shares allowed by the product.",
    "validation.msg.savingsaccount.close.results.in.balance.not.zero": "The account still has a balance. Choose how to pay it out.",
    "error.msg.postInterest.notDone": "Interest must be posted on the closing date first.",
    "error.msg.countInterest": "Interest cannot be posted before the account's last transaction date.",
    "error.msg.savingsaccount.transaction.account.is.blocked": "The account is blocked. Unblock it first.",
    "error.msg.savingsaccount.transaction.debit.is.blocked": "Withdrawals are blocked on this account.",
    "error.msg.savingsaccount.transaction.credit.is.blocked": "Deposits are blocked on this account."
  };
  function sentence(s) {
    s = String(s || "").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  function friendly(err) {
    if (!err || err.status === 401) return err;
    var errs = err.data && err.data.errors;
    if (!errs || !errs.length) return err;
    var seen = {};
    var msgs = errs.map(function (e) {
      var code = e.userMessageGlobalisationCode || "";
      if (CODE_TEXT[code]) return CODE_TEXT[code];
      var m = e.defaultUserMessage || "";
      /* Some Fineract errors put a parameter name in defaultUserMessage — the developer message is the real text. */
      if (!m || /^[A-Za-z_]+$/.test(m) || m === "Validation errors exist.") m = e.developerMessage || m;
      m = m.replace(/^Failed data validation due to:\s*/, "");
      if (/^[a-z0-9.]+\.?$/.test(m)) m = m.replace(/\.$/, "").split(".").join(" ") + ".";
      return sentence(m);
    }).filter(function (m) { if (!m || seen[m]) return false; seen[m] = 1; return true; });
    var out = new Error(msgs.join(" ") || err.message);
    out.status = err.status;
    out.data = err.data;
    return out;
  }
  function call(method, path, body) {
    var p = method === "get" ? api.get(path) : api[method](path, body);
    return p.catch(function (err) { throw friendly(err); });
  }
  function fail(err) { if (err && err.status !== 401) api.toast((friendly(err) || {}).message || String(err), "error"); }

  /* Click handler with a busy guard so a double click cannot start two flows. */
  function on(el, fn) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.getAttribute("aria-busy") === "true") return;
      el.setAttribute("aria-busy", "true");
      Promise.resolve().then(function () { return fn(el); }).catch(fail).then(function () { el.removeAttribute("aria-busy"); });
    });
  }
  function onAction(name, fn) { actions(name).forEach(function (b) { on(b, fn); }); }

  /* Runs a loader; on failure shows the error instead of leaving stale content. */
  function run(fn) {
    return Promise.resolve().then(fn).then(function () { api.clearStatus(); }).catch(function (err) {
      if (err && err.status === 401) return;
      err = friendly(err);
      document.querySelectorAll("tr.loading-row td").forEach(function (td) { td.textContent = "Could not load: " + (err.message || err); });
      if (!err.status) api.setStatus("Cannot reach Fineract — data may be stale. " + (err.message || ""));
      api.toast(err.message || String(err), "error");
    });
  }

  function dateField(label, key, value) {
    return { key: key || "date", label: label || "Date", type: "date", required: true, value: value || api.todayISO(), max: api.todayISO() };
  }
  function receiptField() {
    return { key: "receipt", label: "Receipt / reference no.", placeholder: "e.g. MoMo transaction ID or receipt book no.", autocomplete: "off" };
  }
  function noteField() { return { key: "note", label: "Note", placeholder: "optional" }; }
  function wholeNumber(v) {
    var s = String(v === undefined || v === null ? "" : v).trim().replace(/,/g, "");
    if (!/^\d+$/.test(s)) return NaN;
    var n = Number(s);
    return n > 0 && Number.isSafeInteger(n) ? n : NaN;
  }

  /* Payment types for member money — "Migration" is only for loading legacy balances. */
  async function payTypeField(label) {
    var list = (await api.paymentTypes()).filter(function (p) { return !/migration/i.test(p.name || ""); });
    if (!list.length) throw new Error("No payment types are configured in Fineract. Add Cash, MTN Mobile Money, etc. first.");
    var def = list.filter(function (p) { return p.isCashPayment; })[0] || list[0];
    return {
      key: "paymentTypeId", label: label || "Payment type", type: "select", required: true, value: String(def.id),
      options: list.map(function (p) { return { value: p.id, label: p.name }; })
    };
  }
  function paymentBits(v) {
    var out = { paymentTypeId: Number(v.paymentTypeId) };
    if (v.receipt && String(v.receipt).trim()) out.receiptNumber = String(v.receipt).trim().slice(0, 50);
    return out;
  }

  async function chooseMember(title) {
    var v = await api.openDialog({
      title: title, submitLabel: "Continue",
      fields: [{ key: "clientId", label: "Member", type: "search", required: true, placeholder: "Member name, account no or phone", search: api.searchClients }]
    });
    if (!v) return null;
    return { id: v.clientId, name: (v.clientIdLabel || "").replace(/\s*\(.*$/, "") || ("#" + v.clientId) };
  }

  async function clientOffice(clientId) {
    var c = await call("get", "/clients/" + enc(clientId));
    return c.officeId;
  }

  async function memberSavings(clientId) {
    var res = await call("get", "/clients/" + enc(clientId) + "/accounts");
    return (res.savingsAccounts || []).filter(function (s) {
      return s.status && s.status.active && (!s.depositType || s.depositType.id === 100);
    });
  }
  function savingsLabel(s) {
    var bal = s.accountBalance !== undefined ? s.accountBalance : (s.summary && s.summary.accountBalance);
    return "#" + s.accountNo + " · " + (s.productName || s.savingsProductName || "Savings") + (bal !== undefined ? " · " + money(bal) : "");
  }

  /* Savings typeahead: account numbers via /search, names via the member's accounts (case-insensitive is not possible server-side). */
  async function searchMemberSavings(q) {
    if (/\d{3,}/.test(q)) return api.searchSavings(q, true);
    var members = (await api.searchClients(q)).slice(0, 6);
    var lists = await Promise.all(members.map(function (m) {
      return memberSavings(m.value).then(function (rows) {
        return rows.map(function (s) { return { value: s.id, label: "#" + s.accountNo + " · " + m.label, sub: s.productName || "Savings" }; });
      }).catch(function () { return []; });
    }));
    return [].concat.apply([], lists).slice(0, 20);
  }

  /* ------------------------------------------------------------ list pages */
  /*
   * Plain view: server paging. Any search / filter: all accounts are fetched once (in chunks)
   * and filtered here, so name search is case-insensitive and product / status filters work.
   */
  function accountList(opts) {
    var tbody = document.querySelector("#dep-table tbody");
    var pager = $("dep-pager");
    var search = $("dep-search"), statusSel = $("dep-status"), productSel = $("dep-product");
    var offset = 0;
    var all = null;
    function renderPager(shown, total) {
      var from = total ? offset + 1 : 0;
      var to = offset + shown;
      pager.innerHTML = '<span class="pager-info">Showing ' + from + "–" + to + " of " + api.formatNumber(total) + "</span>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-page="prev"' + (offset <= 0 ? " disabled" : "") + ">‹ Prev</button>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-page="next"' + (to >= total ? " disabled" : "") + ">Next ›</button>";
      pager.querySelectorAll("button[data-page]").forEach(function (b) {
        b.addEventListener("click", function () {
          run(function () { return load(b.getAttribute("data-page") === "next" ? offset + PAGE_SIZE : Math.max(0, offset - PAGE_SIZE)); });
        });
      });
    }
    async function load(newOffset) {
      offset = Math.max(0, newOffset || 0);
      var q = search ? search.value.trim().toLowerCase() : "";
      var st = statusSel ? statusSel.value : "";
      var pr = productSel ? productSel.value : "";
      var items, total;
      tbody.innerHTML = api.loadingRow(opts.cols, q || st || pr ? "Searching all accounts…" : "Loading…");
      try {
        if (q || st || pr) {
          if (!all) all = (await opts.fetchAll()).filter(opts.keep || function () { return true; });
          var rows = all.filter(function (a) {
            if (st && String(a.status && a.status.id) !== st) return false;
            if (pr && String(opts.productId(a)) !== pr) return false;
            if (!q) return true;
            return [a.accountNo, a.clientName, a.externalId, a.clientId && "#" + a.clientId].some(function (x) {
              return x && String(x).toLowerCase().indexOf(q) >= 0;
            });
          });
          total = rows.length;
          items = rows.slice(offset, offset + PAGE_SIZE);
        } else {
          var res = await opts.fetchPage(offset, PAGE_SIZE);
          items = res.pageItems || [];
          total = typeof res.totalFilteredRecords === "number" ? res.totalFilteredRecords : items.length;
        }
      } catch (err) {
        tbody.innerHTML = api.emptyRow(opts.cols, "Could not load: " + ((friendly(err) || {}).message || err));
        pager.innerHTML = "";
        throw err;
      }
      tbody.innerHTML = items.length ? items.map(opts.row).join("") : api.emptyRow(opts.cols, opts.empty);
      renderPager(items.length, total);
    }
    var form = $("dep-filter");
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); run(function () { return load(0); }); });
    [statusSel, productSel].forEach(function (s) { if (s) s.addEventListener("change", function () { run(function () { return load(0); }); }); });
    return { load: load, refresh: function () { all = null; return load(offset); } };
  }

  async function fetchChunks(pathFn) {
    var out = [];
    for (var off = 0; off < 200000; off += BULK) {
      var res = await call("get", pathFn(off, BULK));
      var items = Array.isArray(res) ? res : (res.pageItems || []);
      out = out.concat(items);
      var total = res && typeof res.totalFilteredRecords === "number" ? res.totalFilteredRecords : null;
      if (items.length < BULK || (total !== null && out.length >= total)) break;
    }
    return out;
  }

  function memberCell(a) {
    return a.clientId ? '<a href="client-detail.html?id=' + enc(a.clientId) + '">' + esc(a.clientName || "—") + "</a>" : esc(a.clientName || "—");
  }

  /* =========================================================== SAVINGS LIST */
  if (page === "savings") {
    var savList = accountList({
      cols: 6, empty: "No savings accounts found",
      fetchPage: function (off, lim) { return call("get", "/savingsaccounts?offset=" + off + "&limit=" + lim + "&orderBy=id&sortOrder=DESC"); },
      fetchAll: function () { return fetchChunks(function (off, lim) { return "/savingsaccounts?offset=" + off + "&limit=" + lim + "&orderBy=id&sortOrder=DESC"; }); },
      keep: function (s) { return !s.depositType || s.depositType.id === 100; },
      productId: function (s) { return s.savingsProductId; },
      row: function (s) {
        var fd = s.depositType && s.depositType.id === 200;
        var href = (fd ? "fd-detail.html?id=" : "savings-detail.html?id=") + enc(s.id);
        var bal = s.summary ? s.summary.accountBalance : s.accountBalance;
        return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(s.accountNo || s.id) + "</a></td>" +
          "<td>" + memberCell(s) + "</td><td>" + esc(s.savingsProductName || "") + "</td>" +
          "<td class=\"mono text-right\">" + (bal !== undefined ? money(bal) : "—") + "</td>" +
          "<td>" + api.statusBadge(s.status) + "</td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\" aria-label=\"Open account " + esc(s.accountNo || s.id) + "\">View</a></td></tr>";
      }
    });
    run(async function () {
      var products = await call("get", "/savingsproducts").catch(function () { return []; });
      var sel = $("dep-product");
      if (sel && Array.isArray(products)) {
        sel.innerHTML = '<option value="">All products</option>' + products.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>";
        }).join("");
      }
      await savList.load(0);
    });
    document.addEventListener("desk:refresh", function () { run(savList.refresh); });
  }

  /* =========================================================== SAVINGS DETAIL */
  if (page === "savings-detail") {
    var savId = api.qs("id");
    var acct = null;
    var stmtFrom = $("sav-from"), stmtTo = $("sav-to");
    if (stmtTo) { stmtTo.value = api.todayISO(); stmtTo.max = api.todayISO(); }
    if (stmtFrom) { stmtFrom.value = api.yearStartISO(); stmtFrom.max = api.todayISO(); }

    var isHold = function (t) { var ty = t.transactionType || {}; return !!(ty.amountHold || ty.amountRelease); };
    var isLedger = function (t) { var ty = t.transactionType || {}; return !isHold(t) && !ty.accrual && !t.reversed; };
    var isCredit = function (t) {
      if (t.entryType) return t.entryType === "CREDIT";
      var ty = t.transactionType || {};
      return !!(ty.deposit || ty.interestPosting || ty.dividendPayout || ty.approveTransfer);
    };
    var txDate = function (t) { return api.formatDate(t.date || t.transactionDate); };
    var activeHolds = function (a) {
      return (a.transactions || []).filter(function (t) {
        return t.transactionType && t.transactionType.amountHold && !t.reversed && !Number(t.releaseTransactionId);
      });
    };
    var withdrawalFee = function (a) {
      return (a.charges || []).filter(function (c) { return c.isActive !== false && c.chargeTimeType && c.chargeTimeType.id === 5; })[0] || null;
    };
    var feeText = function (c) {
      if (!c) return "None";
      var calc = c.chargeCalculationType || {};
      return calc.id === 1 || /flat/i.test(calc.value || "") ? money(c.amount) + " per withdrawal" : c.amountOrPercentage + "% of the amount";
    };
    var feeFor = function (c, amount) {
      if (!c) return 0;
      var calc = c.chargeCalculationType || {};
      return calc.id === 1 || /flat/i.test(calc.value || "") ? num(c.amount) : Math.round(amount * num(c.amountOrPercentage) / 100);
    };
    var available = function (a) {
      var s = a.summary || {};
      var avail = s.availableBalance !== undefined ? num(s.availableBalance) : num(s.accountBalance);
      /* Fineract's available balance ignores the product's minimum balance, but withdrawals enforce it. */
      return Math.max(0, avail - (a.enforceMinRequiredBalance ? num(a.minRequiredBalance) : 0));
    };

    var renderStatement = function () {
      var tb = document.querySelector("#sav-txns tbody");
      if (!tb || !acct) return;
      var from = stmtFrom && stmtFrom.value ? stmtFrom.value : "0000-01-01";
      var to = stmtTo && stmtTo.value ? stmtTo.value : "9999-12-31";
      if (from > to) { tb.innerHTML = api.emptyRow(7, "The start date is after the end date."); return; }
      var txns = (acct.transactions || []).filter(function (t) { return !isHold(t) && !(t.transactionType || {}).accrual; }).slice();
      txns.sort(function (a, b) { var d = txDate(a).localeCompare(txDate(b)); return d || (num(a.id) - num(b.id)); });
      var opening = 0, bal = 0, totalIn = 0, totalOut = 0;
      var rows = [];
      var canUndo = api.can("UNDOTRANSACTION_SAVINGSACCOUNT") && acct.status && acct.status.active;
      txns.forEach(function (t) {
        var d = txDate(t);
        var cr = isCredit(t);
        var amt = num(t.amount);
        if (d < from) { if (isLedger(t)) opening += cr ? amt : -amt; return; }
        if (d > to) return;
        if (!rows.length) bal = opening;
        var type = (t.transactionType && t.transactionType.value) || "";
        var pd = t.paymentDetailData || {};
        var ref = [pd.paymentType && pd.paymentType.name, pd.receiptNumber, t.note].filter(Boolean).join(" · ");
        if (t.reversed) {
          rows.push('<tr class="txn-reversed"><td>' + esc(d) + "</td><td>" + esc(type) + " (reversed)</td><td>" + esc(ref) +
            '</td><td class="mono text-right" colspan="2">' + money(amt) + ' — not counted</td><td class="mono text-right">' + money(bal) + "</td><td></td></tr>");
          return;
        }
        bal += cr ? amt : -amt;
        if (cr) totalIn += amt; else totalOut += amt;
        var ty = t.transactionType || {};
        var undo = canUndo && (ty.deposit || ty.withdrawal) ?
          '<button type="button" class="btn btn-sm btn-ghost" data-undo="' + esc(t.id) + '" aria-label="Undo ' + esc(type) + " of " + esc(money(amt)) + " on " + esc(d) + '">Undo</button>' : "";
        rows.push("<tr><td>" + esc(d) + "</td><td>" + esc(type) + "</td><td>" + esc(ref) + "</td>" +
          '<td class="mono text-right">' + (cr ? "" : money(amt)) + '</td><td class="mono text-right">' + (cr ? money(amt) : "") +
          '</td><td class="mono text-right">' + money(bal) + "</td><td>" + undo + "</td></tr>");
      });
      if (!rows.length) bal = opening;
      var head = '<tr class="total-row"><td>' + esc(from === "0000-01-01" ? "" : from) + '</td><td colspan="4">Opening balance</td><td class="mono text-right">' + money(opening) + "</td><td></td></tr>";
      var foot = '<tr class="total-row"><td>' + esc(to === "9999-12-31" ? "" : to) + '</td><td colspan="2">Closing balance · in ' + money(totalIn) + " · out " + money(totalOut) +
        '</td><td></td><td></td><td class="mono text-right">' + money(bal) + "</td><td></td></tr>";
      tb.innerHTML = head + (rows.length ? rows.join("") : api.emptyRow(7, "No transactions in this period")) + foot;
      setText("sav-stmt-head", (acct.clientName || "") + " · " + (acct.savingsProductName || "") + " #" + acct.accountNo + " · " + from + " to " + to);
      tb.querySelectorAll("button[data-undo]").forEach(function (b) {
        on(b, function () { return undoTxn(b.getAttribute("data-undo")); });
      });
    };

    var paintSavings = async function () {
      if (!savId) { setText("page-sub", "No account selected."); throw new Error("Open a savings account from the list."); }
      var a = await call("get", "/savingsaccounts/" + enc(savId) + "?associations=transactions,charges");
      if (a.depositType && a.depositType.id === 200) { location.replace("fd-detail.html?id=" + enc(savId)); return; }
      acct = a;
      var s = a.summary || {};
      var st = a.status || {};
      var sub = a.subStatus || {};
      document.title = "Savings " + (a.accountNo || savId) + SUFFIX;
      setText("sav-title", "Savings " + (a.accountNo || savId));
      setText("page-sub", (a.clientName || "") + " · " + (a.savingsProductName || ""));
      setText("sav-product", a.savingsProductName);
      setHtml("sav-status", api.statusBadge(st));
      var blockText = sub.block ? "Blocked" : sub.blockDebit ? "Withdrawals blocked" : sub.blockCredit ? "Deposits blocked" : (sub.dormant ? "Dormant" : (sub.inactive ? "Inactive" : ""));
      setHtml("sav-substatus", blockText ? '<span class="status overdue">' + esc(blockText) + "</span>" : "");
      setText("sav-account", "#" + (a.accountNo || savId));
      var link = $("sav-client");
      if (link) { link.textContent = a.clientName || "—"; link.href = "client-detail.html?id=" + enc(a.clientId || ""); }
      var holds = activeHolds(a);
      var onHold = holds.reduce(function (t, h) { return t + num(h.amount); }, 0);
      setText("sav-balance", money(s.accountBalance));
      setText("sav-available", s.availableBalance !== undefined ? money(s.availableBalance) : "");
      setText("sav-onhold", onHold ? money(onHold) : "None");
      setText("sav-interest", a.nominalAnnualInterestRate !== undefined ? a.nominalAnnualInterestRate + "% p.a." : "");
      setText("sav-interest-due", money(s.interestNotPosted || 0));
      setText("sav-wfee", feeText(withdrawalFee(a)));
      setText("sav-minbal", a.enforceMinRequiredBalance && num(a.minRequiredBalance) ? money(a.minRequiredBalance) : "None");
      setText("sav-lockin", a.lockinPeriodFrequency ? a.lockinPeriodFrequency + " " + String((a.lockinPeriodFrequencyType || {}).value || "").toLowerCase() : "None");
      var tl = a.timeline || {};
      setText("sav-opened", api.formatDate(tl.activatedOnDate || tl.submittedOnDate));

      var active = !!st.active;
      var anyBlock = !!(sub.block || sub.blockDebit || sub.blockCredit);
      toggle("sav-approve", !!st.submittedAndPendingApproval);
      toggle("sav-activate", !!st.approved && !active);
      toggle("sav-deposit", active && !sub.block && !sub.blockCredit);
      toggle("sav-withdraw", active && !sub.block && !sub.blockDebit);
      toggle("sav-transfer", active && !sub.block && !sub.blockDebit);
      toggle("sav-post-interest", active);
      toggle("sav-hold", active);
      toggle("sav-block", active && !anyBlock);
      actions("sav-unblock").forEach(function (b) {
        var code = sub.blockDebit ? "UNBLOCKDEBIT_SAVINGSACCOUNT" : sub.blockCredit ? "UNBLOCKCREDIT_SAVINGSACCOUNT" : "UNBLOCK_SAVINGSACCOUNT";
        b.hidden = !(active && anyBlock && api.can(code));
      });
      toggle("sav-close", active);

      /* charges */
      var charges = (a.charges || []).filter(function (c) { return c.isActive !== false; });
      var cc = $("sav-charges-card");
      if (cc) cc.hidden = !charges.length;
      var ctb = document.querySelector("#sav-charges tbody");
      if (ctb) {
        var canPay = active && api.can("PAY_SAVINGSACCOUNTCHARGE");
        var canWaive = active && api.can("WAIVE_SAVINGSACCOUNTCHARGE");
        ctb.innerHTML = charges.map(function (c) {
          var isWfee = c.chargeTimeType && c.chargeTimeType.id === 5;
          var out = num(c.amountOutstanding);
          var btns = "";
          if (!isWfee && out > 0) {
            if (canPay) btns += '<button type="button" class="btn btn-sm btn-amber" data-pay-charge="' + esc(c.id) + '" aria-label="Pay ' + esc(c.name) + '">Pay</button> ';
            if (canWaive) btns += '<button type="button" class="btn btn-sm btn-ghost" data-waive-charge="' + esc(c.id) + '" aria-label="Waive ' + esc(c.name) + '">Waive</button>';
          }
          return "<tr><td>" + esc(c.name) + "</td><td>" + esc((c.chargeTimeType || {}).value || "") + "</td><td>" + esc(c.dueDate ? api.formatDate(c.dueDate) : (isWfee ? "On each withdrawal" : "—")) +
            '</td><td class="mono text-right">' + (isWfee ? esc(feeText(c)) : money(c.amount)) + '</td><td class="mono text-right">' + (isWfee ? "—" : money(num(c.amountPaid) + num(c.amountWaived))) +
            '</td><td class="mono text-right">' + (isWfee ? "—" : (out > 0 ? '<strong>' + money(out) + "</strong>" : money(0))) + "</td><td>" + btns + "</td></tr>";
        }).join("");
        ctb.querySelectorAll("[data-pay-charge]").forEach(function (b) { on(b, function () { return payCharge(b.getAttribute("data-pay-charge")); }); });
        ctb.querySelectorAll("[data-waive-charge]").forEach(function (b) { on(b, function () { return waiveCharge(b.getAttribute("data-waive-charge")); }); });
      }

      /* holds */
      var hc = $("sav-holds-card");
      if (hc) hc.hidden = !holds.length;
      var htb = document.querySelector("#sav-holds tbody");
      if (htb) {
        var canRelease = active && api.can("RELEASEAMOUNT_SAVINGSACCOUNT");
        htb.innerHTML = holds.map(function (h) {
          return "<tr><td>" + esc(txDate(h)) + "</td><td>" + esc(h.reasonForBlock || "—") + '</td><td class="mono text-right">' + money(h.amount) + "</td><td>" +
            (canRelease ? '<button type="button" class="btn btn-sm btn-ghost" data-release="' + esc(h.id) + '" aria-label="Release hold of ' + esc(money(h.amount)) + '">Release</button>' : "") + "</td></tr>";
        }).join("");
        htb.querySelectorAll("[data-release]").forEach(function (b) { on(b, function () { return releaseHold(b.getAttribute("data-release")); }); });
      }
      renderStatement();
    };
    var refreshSavings = function () { return run(paintSavings); };

    var acctLabel = function () { return "#" + acct.accountNo + " · " + (acct.savingsProductName || "") + " · " + (acct.clientName || ""); };
    var need = function () { if (!acct) throw new Error("Account not loaded yet."); return acct; };
    var done = function (msg) { return function (r) { if (r) { api.toast(msg, "success"); return refreshSavings(); } }; };

    var cashDialog = async function (kind) {
      var a = need();
      var isDep = kind === "deposit";
      var pt = await payTypeField();
      var fee = isDep ? null : withdrawalFee(a);
      var avail = available(a);
      return api.openDialog({
        title: (isDep ? "Deposit to " : "Withdraw from ") + "#" + a.accountNo, submitLabel: "Review",
        message: isDep ? (a.clientName || "") + " · " + (a.savingsProductName || "") + " · balance " + money((a.summary || {}).accountBalance) :
          "Available to withdraw: " + money(avail) + (a.enforceMinRequiredBalance && num(a.minRequiredBalance) ? " (keeps the " + money(a.minRequiredBalance) + " minimum balance)" : "") + " · Withdrawal fee: " + feeText(fee),
        fields: [{ key: "amount", label: "Amount (UGX)", amount: true, required: true }, pt, receiptField(), dateField(), noteField()],
        validate: function (v) {
          if (!isDep) {
            var f = feeFor(fee, v.amount);
            if (v.amount + f > avail) return "Amount " + money(v.amount) + (f ? " plus withdrawal fee " + money(f) : "") + " is more than the available balance " + money(avail) + ".";
          }
          return "";
        },
        confirm: function (v) {
          var f = isDep ? 0 : feeFor(fee, v.amount);
          return {
            title: isDep ? "Confirm deposit" : "Confirm withdrawal",
            lines: [["Member", a.clientName || ""], ["Account", "#" + a.accountNo + " · " + (a.savingsProductName || "")], ["Amount", money(v.amount)]]
              .concat(isDep ? [] : [["Withdrawal fee", f ? money(f) : "None"], ["Total debited", money(v.amount + f)]])
              .concat([["Payment type", optionLabel(pt, v.paymentTypeId)], ["Receipt / ref", v.receipt || "—"], ["Date", v.date]]),
            note: isDep ? "" : "Pay the member " + money(v.amount) + " only after this is posted.",
            confirmLabel: (isDep ? "Post deposit of " : "Post withdrawal of ") + money(v.amount)
          };
        },
        onSubmit: function (v) {
          return call("post", "/savingsaccounts/" + enc(a.id) + "/transactions?command=" + (isDep ? "deposit" : "withdrawal"), withDate(Object.assign({
            transactionDate: v.date, transactionAmount: String(v.amount), note: v.note || ""
          }, paymentBits(v))));
        }
      }).then(done(isDep ? "Deposit posted" : "Withdrawal posted"));
    };

    var transferDialog = async function () {
      var a = need();
      var own = (await memberSavings(a.clientId)).filter(function (s) { return String(s.id) !== String(a.id); });
      var toField = {
        key: "to", label: "Transfer to", type: "select", required: true, placeholder: "— Choose the receiving account —",
        options: own.map(function (s) { return { value: s.id, label: "Member's own " + savingsLabel(s) }; })
          .concat([{ value: "other", label: "Another member's savings account (search below)" }])
      };
      var avail = available(a);
      return api.openDialog({
        title: "Transfer from #" + a.accountNo, submitLabel: "Review",
        message: "Available: " + money(avail) + ". Transfers do not move cash — no payment type is needed.",
        fields: [toField,
          { key: "otherId", label: "Other member's account", type: "search", placeholder: "Account number or member name", search: searchMemberSavings },
          { key: "amount", label: "Amount (UGX)", amount: true, required: true }, dateField("Transfer date"),
          { key: "description", label: "Description", placeholder: "e.g. Move to compulsory savings", value: "" }],
        validate: function (v) {
          if (v.to === "other" && !v.otherId) return "Choose the other member's account from the search results.";
          var target = v.to === "other" ? v.otherId : v.to;
          if (String(target) === String(a.id)) return "Choose a different account to transfer to.";
          if (v.amount > avail) return "Amount is more than the available balance " + money(avail) + ".";
          return "";
        },
        confirm: function (v) {
          return {
            title: "Confirm transfer",
            lines: [["From", acctLabel()], ["To", v.to === "other" ? (v.otherIdLabel || v.otherId) : optionLabel(toField, v.to)], ["Amount", money(v.amount)], ["Date", v.date]],
            confirmLabel: "Transfer " + money(v.amount)
          };
        },
        onSubmit: async function (v) {
          var toId = v.to === "other" ? v.otherId : v.to;
          var target = await call("get", "/savingsaccounts/" + enc(toId));
          var offices = await Promise.all([clientOffice(a.clientId), clientOffice(target.clientId)]);
          return call("post", "/accounttransfers", withDate({
            fromOfficeId: offices[0], fromClientId: a.clientId, fromAccountType: 2, fromAccountId: Number(a.id),
            toOfficeId: offices[1], toClientId: target.clientId, toAccountType: 2, toAccountId: Number(toId),
            transferDate: v.date, transferAmount: String(v.amount),
            transferDescription: (v.description || "").trim() || ("Transfer from #" + a.accountNo + " to #" + target.accountNo)
          }));
        }
      }).then(done("Transfer posted"));
    };

    var stateDialog = function (cmd, label, dateKey) {
      var a = need();
      return api.openDialog({
        title: label + " #" + a.accountNo, submitLabel: label,
        message: (a.clientName || "") + " · " + (a.savingsProductName || ""),
        fields: [dateField(label + " on", "date")],
        onSubmit: function (v) {
          var body = {}; body[dateKey] = v.date;
          return call("post", "/savingsaccounts/" + enc(a.id) + "?command=" + cmd, withDate(body));
        }
      }).then(done(label === "Approve" ? "Account approved" : "Account activated"));
    };

    var postInterestDialog = function () {
      var a = need();
      return api.openDialog({
        title: "Post interest to #" + a.accountNo, submitLabel: "Review",
        message: "Interest earned but not yet posted: " + money((a.summary || {}).interestNotPosted || 0) + ". Interest is normally posted by the scheduled job.",
        fields: [dateField("Post interest as on")],
        confirm: function (v) {
          return { title: "Confirm interest posting", lines: [["Account", acctLabel()], ["As on", v.date], ["Rate", (a.nominalAnnualInterestRate || 0) + "% p.a."]], confirmLabel: "Post interest" };
        },
        onSubmit: function (v) {
          return call("post", "/savingsaccounts/" + enc(a.id) + "?command=postInterest", withDate({ transactionDate: v.date, isPostInterestAsOn: true }));
        }
      }).then(done("Interest posted"));
    };

    var holdDialog = function () {
      var a = need();
      return api.openDialog({
        title: "Hold an amount on #" + a.accountNo, submitLabel: "Review",
        message: "A hold reduces the available balance (e.g. loan guarantee or dispute) until it is released.",
        fields: [{ key: "amount", label: "Amount to hold (UGX)", amount: true, required: true },
          { key: "reason", label: "Reason", required: true, placeholder: "e.g. Guarantor for loan 000000045" }, dateField()],
        validate: function (v) { return v.amount > available(a) ? "Amount is more than the available balance " + money(available(a)) + "." : ""; },
        confirm: function (v) { return { title: "Confirm hold", lines: [["Account", acctLabel()], ["Amount", money(v.amount)], ["Reason", v.reason], ["Date", v.date]], confirmLabel: "Hold " + money(v.amount) }; },
        onSubmit: function (v) {
          return call("post", "/savingsaccounts/" + enc(a.id) + "/transactions?command=holdAmount",
            withDate({ transactionDate: v.date, transactionAmount: String(v.amount), reasonForBlock: v.reason.trim() }));
        }
      }).then(done("Amount placed on hold"));
    };

    var releaseHold = function (txId) {
      var a = need();
      var h = activeHolds(a).filter(function (t) { return String(t.id) === String(txId); })[0];
      return api.confirmDialog({
        title: "Release hold", summary: "Release this hold?",
        lines: [["Account", acctLabel()], ["Amount", money(h ? h.amount : 0)], ["Reason", (h && h.reasonForBlock) || "—"]],
        confirmLabel: "Release hold",
        onConfirm: function () { return call("post", "/savingsaccounts/" + enc(a.id) + "/transactions/" + enc(txId) + "?command=releaseAmount", {}); }
      }).then(done("Hold released"));
    };

    var blockDialog = function () {
      var a = need();
      var opts = [{ value: "block", label: "Block all deposits and withdrawals", perm: "BLOCK_SAVINGSACCOUNT" },
        { value: "blockDebit", label: "Block withdrawals only", perm: "BLOCKDEBIT_SAVINGSACCOUNT" },
        { value: "blockCredit", label: "Block deposits only", perm: "BLOCKCREDIT_SAVINGSACCOUNT" }].filter(function (o) { return api.can(o.perm); });
      var f = { key: "cmd", label: "Block", type: "select", required: true, value: opts[0] ? opts[0].value : "", options: opts };
      return api.openDialog({
        title: "Block #" + a.accountNo, submitLabel: "Review",
        fields: [f, { key: "reason", label: "Reason", required: true, placeholder: "e.g. Deceased member, court order, dispute" }],
        confirm: function (v) { return { title: "Confirm block", lines: [["Account", acctLabel()], ["Action", optionLabel(f, v.cmd)], ["Reason", v.reason]], confirmLabel: "Block account" }; },
        onSubmit: function (v) { return call("post", "/savingsaccounts/" + enc(a.id) + "?command=" + v.cmd, { reasonForBlock: v.reason.trim() }); }
      }).then(done("Account blocked"));
    };

    var unblock = function () {
      var a = need();
      var sub = a.subStatus || {};
      var cmd = sub.blockDebit ? "unblockDebit" : sub.blockCredit ? "unblockCredit" : "unblock";
      return api.confirmDialog({
        title: "Unblock #" + a.accountNo, summary: "Allow transactions again?", lines: [["Account", acctLabel()], ["Current state", (sub.value || "")]],
        confirmLabel: "Unblock",
        onConfirm: function () { return call("post", "/savingsaccounts/" + enc(a.id) + "?command=" + cmd, {}); }
      }).then(done("Account unblocked"));
    };

    var payCharge = async function (chargeId) {
      var a = need();
      var c = (a.charges || []).filter(function (x) { return String(x.id) === String(chargeId); })[0];
      if (!c) throw new Error("Charge not found — refresh the page.");
      var out = num(c.amountOutstanding);
      return api.openDialog({
        title: "Pay " + c.name, submitLabel: "Review",
        message: "Outstanding: " + money(out) + ". The charge is paid from this account's balance (available " + money(available(a)) + ").",
        fields: [{ key: "amount", label: "Amount (UGX)", amount: true, required: true, placeholder: api.formatNumber(out) }, dateField("Payment date")],
        validate: function (v) {
          if (v.amount > out) return "Amount is more than the outstanding " + money(out) + ".";
          if (v.amount > available(a)) return "The account's available balance (" + money(available(a)) + ") is too low. Take a deposit first.";
          return "";
        },
        confirm: function (v) { return { title: "Confirm charge payment", lines: [["Account", acctLabel()], ["Charge", c.name], ["Amount", money(v.amount)], ["Date", v.date]], confirmLabel: "Pay " + money(v.amount) }; },
        onSubmit: function (v) {
          return call("post", "/savingsaccounts/" + enc(a.id) + "/charges/" + enc(chargeId) + "?command=paycharge", withDate({ amount: String(v.amount), dueDate: v.date }));
        }
      }).then(done("Charge paid"));
    };

    var waiveCharge = function (chargeId) {
      var a = need();
      var c = (a.charges || []).filter(function (x) { return String(x.id) === String(chargeId); })[0] || {};
      return api.confirmDialog({
        title: "Waive " + (c.name || "charge"), summary: "Waive the outstanding amount?",
        lines: [["Account", acctLabel()], ["Charge", c.name || ""], ["Outstanding", money(c.amountOutstanding)]], confirmLabel: "Waive charge",
        onConfirm: function () { return call("post", "/savingsaccounts/" + enc(a.id) + "/charges/" + enc(chargeId) + "?command=waive", {}); }
      }).then(done("Charge waived"));
    };

    var undoTxn = function (txId) {
      var a = need();
      var t = (a.transactions || []).filter(function (x) { return String(x.id) === String(txId); })[0] || {};
      return api.confirmDialog({
        title: "Undo transaction", summary: "Reverse this transaction?",
        lines: [["Account", acctLabel()], ["Transaction", ((t.transactionType || {}).value || "") + " on " + txDate(t)], ["Amount", money(t.amount)]],
        note: "Use this only to correct a posting mistake. Any withdrawal fee is reversed too.",
        confirmLabel: "Undo transaction",
        onConfirm: function () {
          return call("post", "/savingsaccounts/" + enc(a.id) + "/transactions/" + enc(txId) + "?command=undo", {});
        }
      }).then(done("Transaction reversed"));
    };

    var closeDialog = async function () {
      var a = need();
      if (activeHolds(a).length) throw new Error("Release the amounts on hold before closing this account.");
      var owing = (a.charges || []).filter(function (c) { return c.isActive !== false && num(c.amountOutstanding) > 0 && !(c.chargeTimeType && c.chargeTimeType.id === 5); });
      if (owing.length) throw new Error("Pay or waive the outstanding charges first (" + owing.map(function (c) { return c.name; }).join(", ") + ").");
      var own = (await memberSavings(a.clientId)).filter(function (s) { return String(s.id) !== String(a.id); });
      var pt = await payTypeField("Pay out by");
      var bal = num((a.summary || {}).accountBalance);
      var minKeep = a.enforceMinRequiredBalance ? num(a.minRequiredBalance) : 0;
      var how = {
        key: "how", label: "Balance (" + money(bal) + ")", type: "select", required: true, value: "cash",
        options: [{ value: "cash", label: "Pay out to the member" }].concat(own.map(function (s) { return { value: s.id, label: "Transfer to " + savingsLabel(s) }; }))
      };
      var split = function (v) {
        if (v.how === "cash") return { transfer: 0, cash: bal };
        var t = Math.max(0, bal - minKeep);
        return { transfer: t, cash: bal - t };
      };
      return api.openDialog({
        title: "Close #" + a.accountNo, submitLabel: "Review",
        message: "Interest earned up to the closing date is posted first. Balance now: " + money(bal) + (num((a.summary || {}).interestNotPosted) ? " + interest not yet posted " + money(a.summary.interestNotPosted) : "") + ".",
        fields: [how, pt, receiptField(), dateField("Closing date"), noteField()],
        confirm: function (v) {
          var s = split(v);
          var lines = [["Account", acctLabel()], ["Closing date", v.date], ["Balance (before interest)", money(bal)]];
          if (s.transfer) lines.push(["Transfer to", optionLabel(how, v.how).replace(/^Transfer to /, "") + " · " + money(s.transfer)]);
          if (s.cash || v.how === "cash") lines.push(["Pay out (" + optionLabel(pt, v.paymentTypeId) + ")", money(s.cash) + " + any interest posted"]);
          return {
            title: "Confirm account closure", lines: lines,
            note: v.how !== "cash" && minKeep ? "The product keeps a minimum balance of " + money(minKeep) + " that cannot be transferred, so it is paid out with the closure." : "This cannot be undone from Desk.",
            confirmLabel: "Close account"
          };
        },
        onSubmit: async function (v) {
          var s = split(v);
          /* 1. Post interest up to the closing date (nothing to post is fine). */
          await call("post", "/savingsaccounts/" + enc(a.id) + "?command=postInterest", withDate({ transactionDate: v.date, isPostInterestAsOn: true })).catch(function () { return null; });
          /* 2. Transfer what can be transferred to the member's other account. */
          if (s.transfer > 0) {
            var office = await clientOffice(a.clientId);
            await call("post", "/accounttransfers", withDate({
              fromOfficeId: office, fromClientId: a.clientId, fromAccountType: 2, fromAccountId: Number(a.id),
              toOfficeId: office, toClientId: a.clientId, toAccountType: 2, toAccountId: Number(v.how),
              transferDate: v.date, transferAmount: String(s.transfer), transferDescription: "Closure of #" + a.accountNo
            }));
          }
          /* 3. Close; whatever is left (interest, minimum balance) is paid out with the chosen payment type. */
          var fresh = await call("get", "/savingsaccounts/" + enc(a.id));
          var left = num((fresh.summary || {}).accountBalance);
          var body = { closedOnDate: v.date, withdrawBalance: left > 0, postInterestValidationOnClosure: false, note: v.note || "Account closed" };
          if (left > 0) Object.assign(body, paymentBits(v));
          return call("post", "/savingsaccounts/" + enc(a.id) + "?command=close", withDate(body)).catch(function (err) {
            if (s.transfer > 0) err.message = "Transferred " + money(s.transfer) + ", but the account was not closed: " + err.message;
            throw err;
          });
        }
      }).then(done("Account closed"));
    };

    onAction("sav-deposit", function () { return cashDialog("deposit"); });
    onAction("sav-withdraw", function () { return cashDialog("withdrawal"); });
    onAction("sav-transfer", transferDialog);
    onAction("sav-approve", function () { return stateDialog("approve", "Approve", "approvedOnDate"); });
    onAction("sav-activate", function () { return stateDialog("activate", "Activate", "activatedOnDate"); });
    onAction("sav-post-interest", postInterestDialog);
    onAction("sav-hold", holdDialog);
    onAction("sav-block", blockDialog);
    onAction("sav-unblock", unblock);
    onAction("sav-close", closeDialog);
    var sform = $("sav-stmt-form");
    if (sform) sform.addEventListener("submit", function (e) { e.preventDefault(); renderStatement(); });
    document.addEventListener("desk:refresh", refreshSavings);
    refreshSavings();
  }

  /* =========================================================== SHARES */
  var shareProducts = null;
  async function loadShareProducts() {
    if (shareProducts) return shareProducts;
    var res = await call("get", "/products/share");
    var list = Array.isArray(res) ? res : (res.pageItems || []);
    shareProducts = await Promise.all(list.map(function (p) { return call("get", "/products/share/" + enc(p.id)); }));
    return shareProducts;
  }
  function productById(list, id) { return list.filter(function (p) { return String(p.id) === String(id); })[0] || list[0] || {}; }
  function sharesHeld(a) { return num((a.summary || a).totalApprovedShares); }
  function isPendingPurchase(p) { return p.status && (p.status.id === 100 || /applied|pending/i.test((p.status.code || "") + (p.status.value || ""))); }

  async function openShareAccount(preset) {
    var products = await loadShareProducts();
    if (!products.length) throw new Error("No share product is configured in Fineract.");
    var member = preset || await chooseMember("Open share account — choose member");
    if (!member) return;
    var product = products[0];
    if (products.length > 1) {
      var pv = await api.openDialog({
        title: "Share product", submitLabel: "Continue",
        fields: [{ key: "productId", label: "Product", type: "select", required: true, options: products.map(function (p) { return { value: p.id, label: p.name }; }) }]
      });
      if (!pv) return;
      product = productById(products, pv.productId);
    }
    var tpl = await call("get", "/accounts/share/template?clientId=" + enc(member.id) + "&productId=" + enc(product.id));
    var savs = (tpl.clientSavingsAccounts || []).filter(function (s) { return !s.status || s.status.active; });
    if (!savs.length) throw new Error(member.name + " has no active savings account. Open a Voluntary Savings account first — share dividends are paid into it.");
    var vol = savs.filter(function (s) { return /voluntary/i.test(s.savingsProductName || ""); })[0] || savs[0];
    var price = num(tpl.currentMarketPrice || product.unitPrice);
    var min = num(product.minimumShares), max = num(product.maximumShares);
    var canActivate = api.can("APPROVE_SHAREACCOUNT") && api.can("ACTIVATE_SHAREACCOUNT");
    var savField = {
      key: "savingsAccountId", label: "Dividends paid into", type: "select", required: true, value: String(vol.id),
      options: savs.map(function (s) { return { value: s.id, label: "#" + s.accountNo + " · " + (s.savingsProductName || "Savings") }; })
    };
    var actField = canActivate ? { key: "activate", label: "After submitting", type: "select", value: "yes", options: [{ value: "yes", label: "Approve and activate now" }, { value: "no", label: "Leave pending approval" }] } : null;
    var result = null, warning = "";
    var v = await api.openDialog({
      title: "Open share account for " + member.name, submitLabel: "Review",
      message: product.name + ": " + money(price) + " per share · minimum " + plural(min, "share") + (max ? " · maximum " + api.formatNumber(max) : ""),
      fields: [{ key: "shares", label: "Number of shares", required: true, placeholder: "e.g. " + (min || 5), autocomplete: "off" }, savField, dateField("Application date")].concat(actField ? [actField] : []),
      validate: function (val) {
        var n = wholeNumber(val.shares);
        if (!n) return "Number of shares must be a whole number greater than zero.";
        if (min && n < min) return "The minimum is " + plural(min, "share") + ".";
        if (max && n > max) return "The maximum is " + plural(max, "share") + ".";
        val.sharesN = n;
        return "";
      },
      confirm: function (val) {
        return {
          title: "Confirm share purchase",
          lines: [["Member", member.name], ["Shares", api.formatNumber(val.sharesN)], ["Unit price", money(price)], ["Total to collect", money(val.sharesN * price)],
            ["Dividends to", optionLabel(savField, val.savingsAccountId)], ["Date", val.date]],
          note: "Collect " + money(val.sharesN * price) + " from the member. " + (product.lockinPeriod ? "Shares are locked in for " + product.lockinPeriod + " " + String((product.lockPeriodTypeEnum || {}).value || "").toLowerCase() + "." : ""),
          confirmLabel: "Open share account"
        };
      },
      onSubmit: async function (val) {
        var body = {
          clientId: Number(member.id), productId: Number(product.id), submittedDate: val.date, applicationDate: val.date,
          savingsAccountId: Number(val.savingsAccountId), requestedShares: val.sharesN, unitPrice: price
        };
        if (product.lockinPeriod && product.lockPeriodTypeEnum) { body.lockinPeriodFrequency = product.lockinPeriod; body.lockinPeriodFrequencyType = product.lockPeriodTypeEnum.id; }
        if (product.minimumActivePeriod && product.minimumActivePeriodForDividendsTypeEnum) {
          body.minimumActivePeriod = product.minimumActivePeriod; body.minimumActivePeriodFrequencyType = product.minimumActivePeriodForDividendsTypeEnum.id;
        }
        var created = await call("post", "/accounts/share", withDate(body));
        result = created.resourceId;
        if (val.activate === "yes") {
          try {
            await call("post", "/accounts/share/" + enc(result) + "?command=approve", withDate({ approvedDate: val.date }));
            await call("post", "/accounts/share/" + enc(result) + "?command=activate", withDate({ activatedDate: val.date }));
          } catch (err) { warning = err.message; }
        }
      }
    });
    if (v && result) {
      api.toast(warning ? "Share account created but not activated: " + warning : "Share account opened", warning ? "error" : "success");
      setTimeout(function () { location.href = "share-detail.html?id=" + enc(result); }, warning ? 2500 : 300);
    }
  }

  if (page === "shares") {
    var shrList = accountList({
      cols: 7, empty: "No share accounts found",
      fetchPage: function (off, lim) { return call("get", "/accounts/share?offset=" + off + "&limit=" + lim); },
      fetchAll: function () { return fetchChunks(function (off, lim) { return "/accounts/share?offset=" + off + "&limit=" + lim; }); },
      productId: function (a) { return a.productId; },
      row: function (a) {
        var href = "share-detail.html?id=" + enc(a.id);
        var held = sharesHeld(a);
        var price = num(productById(shareProducts || [], a.productId).unitPrice);
        return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(a.accountNo) + "</a></td><td>" + memberCell(a) + "</td><td>" + esc(a.productName || "") +
          '</td><td class="mono text-right">' + api.formatNumber(held) + '</td><td class="mono text-right">' + (price ? money(held * price) : "—") +
          "</td><td>" + api.statusBadge(a.status) + '</td><td><a class="btn btn-sm btn-ghost" href="' + href + '" aria-label="Open share account ' + esc(a.accountNo) + '">View</a></td></tr>';
      }
    });
    run(async function () {
      var products = await loadShareProducts().catch(function () { return []; });
      if (products.length) {
        var p = products[0];
        setText("shr-sub", p.name + " · " + money(p.unitPrice) + " per share · minimum " + plural(p.minimumShares, "share") +
          (p.lockinPeriod ? " · lock-in " + p.lockinPeriod + " " + String((p.lockPeriodTypeEnum || {}).value || "").toLowerCase() : ""));
      }
      await shrList.load(0);
    });
    onAction("shr-open", function () { return openShareAccount(null); });
    document.addEventListener("desk:refresh", function () { run(shrList.refresh); });
  }

  if (page === "share-detail") {
    var shrId = api.qs("id");
    var shr = null;
    var shrPrice = 0;
    var shrProduct = {};
    var paintShare = async function () {
      if (!shrId) { setText("page-sub", "No account selected."); throw new Error("Open a share account from the list."); }
      var res = await Promise.all([call("get", "/accounts/share/" + enc(shrId)), loadShareProducts().catch(function () { return []; })]);
      var a = shr = res[0];
      shrProduct = productById(res[1], a.productId);
      shrPrice = num(a.currentMarketPrice || shrProduct.unitPrice);
      var st = a.status || {};
      var sum = a.summary || {};
      document.title = "Shares " + a.accountNo + SUFFIX;
      setText("shr-title", "Share account " + a.accountNo);
      setText("page-sub", (a.clientName || "") + " · " + (a.productName || ""));
      setText("shr-product", a.productName);
      setHtml("shr-status", api.statusBadge(st));
      setText("shr-account", "#" + a.accountNo);
      var link = $("shr-client");
      if (link) { link.textContent = a.clientName || "—"; link.href = "client-detail.html?id=" + enc(a.clientId || ""); }
      var held = num(sum.totalApprovedShares);
      setText("shr-held", api.formatNumber(held));
      setText("shr-pending", api.formatNumber(sum.totalPendingForApprovalShares || 0));
      setText("shr-price", money(shrPrice));
      setText("shr-value", money(held * shrPrice));
      setHtml("shr-savings", a.savingsAccountId ? '<a href="savings-detail.html?id=' + enc(a.savingsAccountId) + '">#' + esc(a.savingsAccountNumber || a.savingsAccountId) + "</a>" : "—");
      var lp = a.lockinPeriod || a.lockinPeriodFrequency;
      var lt = a.lockPeriodTypeEnum && a.lockPeriodTypeEnum.id !== 4 ? a.lockPeriodTypeEnum.value : "";
      setText("shr-lockin", lp && lt ? lp + " " + String(lt).toLowerCase() + " from each purchase" : "None");
      setText("shr-activated", api.formatDate((a.timeline || {}).activatedDate));
      var active = !!st.active;
      toggle("shr-approve", !!st.submittedAndPendingApproval);
      toggle("shr-activate", !!st.approved && !active);
      toggle("shr-buy", active);
      toggle("shr-redeem", active && held > 0);

      var tb = document.querySelector("#shr-txns tbody");
      var canApprove = active && api.can("APPROVEADDITIONALSHARES_SHAREACCOUNT");
      var canReject = active && api.can("REJECTADDITIONALSHARES_SHAREACCOUNT");
      var rows = (a.purchasedShares || []).slice().sort(function (x, y) {
        var d = api.formatDate(y.purchasedDate).localeCompare(api.formatDate(x.purchasedDate)); return d || (num(y.id) - num(x.id));
      });
      tb.innerHTML = rows.map(function (p) {
        var btns = "";
        if (isPendingPurchase(p)) {
          if (canApprove) btns += '<button type="button" class="btn btn-sm btn-amber" data-approve-purchase="' + esc(p.id) + '">Approve</button> ';
          if (canReject) btns += '<button type="button" class="btn btn-sm btn-ghost" data-reject-purchase="' + esc(p.id) + '">Reject</button>';
        }
        return "<tr><td>" + esc(api.formatDate(p.purchasedDate)) + "</td><td>" + esc((p.type || {}).value || "") + '</td><td class="mono text-right">' + api.formatNumber(p.numberOfShares) +
          '</td><td class="mono text-right">' + money(p.purchasedPrice) + '</td><td class="mono text-right">' + money(p.amount) + "</td><td>" + api.statusBadge(p.status) + "</td><td>" + btns + "</td></tr>";
      }).join("") || api.emptyRow(7, "No share transactions");
      tb.querySelectorAll("[data-approve-purchase]").forEach(function (b) { on(b, function () { return decidePurchase(b.getAttribute("data-approve-purchase"), true); }); });
      tb.querySelectorAll("[data-reject-purchase]").forEach(function (b) { on(b, function () { return decidePurchase(b.getAttribute("data-reject-purchase"), false); }); });
    };
    var refreshShare = function () { return run(paintShare); };
    var shrDone = function (msg) { return function (r) { if (r) { api.toast(msg, "success"); return refreshShare(); } }; };
    var shrNeed = function () { if (!shr) throw new Error("Account not loaded yet."); return shr; };

    var decidePurchase = function (pid, approve) {
      var a = shrNeed();
      var p = (a.purchasedShares || []).filter(function (x) { return String(x.id) === String(pid); })[0] || {};
      return api.confirmDialog({
        title: (approve ? "Approve" : "Reject") + " share purchase", summary: approve ? "Approve this purchase?" : "Reject this purchase?",
        lines: [["Member", a.clientName || ""], ["Shares", api.formatNumber(p.numberOfShares)], ["Amount", money(p.amount)], ["Requested on", api.formatDate(p.purchasedDate)]],
        confirmLabel: approve ? "Approve purchase" : "Reject purchase",
        onConfirm: function () {
          return call("post", "/accounts/share/" + enc(a.id) + "?command=" + (approve ? "approveadditionalshares" : "rejectadditionalshares"), { requestedShares: [{ id: Number(pid) }] });
        }
      }).then(shrDone(approve ? "Purchase approved" : "Purchase rejected"));
    };

    var buyShares = function () {
      var a = shrNeed();
      var held = sharesHeld(a), pending = num((a.summary || {}).totalPendingForApprovalShares);
      var max = num(shrProduct.maximumShares);
      var canApprove = api.can("APPROVEADDITIONALSHARES_SHAREACCOUNT");
      var resultId = null, warning = "";
      return api.openDialog({
        title: "Buy shares — " + (a.clientName || ""), submitLabel: "Review",
        message: "Holds " + plural(held, "share") + (pending ? " (+" + api.formatNumber(pending) + " pending)" : "") + " · " + money(shrPrice) + " per share" + (max ? " · maximum " + api.formatNumber(max) : ""),
        fields: [{ key: "shares", label: "Number of shares", required: true, autocomplete: "off", placeholder: "e.g. 5" }, dateField("Purchase date")].concat(canApprove ?
          [{ key: "approve", label: "After submitting", type: "select", value: "yes", options: [{ value: "yes", label: "Approve now (cash received)" }, { value: "no", label: "Leave for approval" }] }] : []),
        validate: function (v) {
          var n = wholeNumber(v.shares);
          if (!n) return "Number of shares must be a whole number greater than zero.";
          if (max && held + pending + n > max) return "That would exceed the maximum of " + plural(max, "share") + ".";
          v.sharesN = n;
          return "";
        },
        confirm: function (v) {
          return {
            title: "Confirm share purchase",
            lines: [["Member", a.clientName || ""], ["Account", "#" + a.accountNo], ["Shares", api.formatNumber(v.sharesN)], ["Unit price", money(shrPrice)], ["Total to collect", money(v.sharesN * shrPrice)], ["Date", v.date]],
            note: "Collect " + money(v.sharesN * shrPrice) + " from the member before posting.",
            confirmLabel: "Buy " + plural(v.sharesN, "share")
          };
        },
        onSubmit: async function (v) {
          var r = await call("post", "/accounts/share/" + enc(a.id) + "?command=applyadditionalshares", withDate({ requestedDate: v.date, requestedShares: v.sharesN, unitPrice: shrPrice }));
          resultId = r && r.changes && r.changes.additionalshares;
          if (v.approve === "yes" && resultId) {
            try {
              await call("post", "/accounts/share/" + enc(a.id) + "?command=approveadditionalshares", { requestedShares: [{ id: Number(resultId) }] });
            } catch (err) { warning = err.message; }
          }
          return v;
        }
      }).then(function (r) {
        if (!r) return;
        if (warning) api.toast("Purchase recorded but not approved: " + warning, "error");
        else api.toast(r.approve === "yes" ? "Shares purchased" : "Purchase submitted for approval", "success");
        return refreshShare();
      });
    };

    var redeemShares = function () {
      var a = shrNeed();
      var held = sharesHeld(a);
      var min = num(shrProduct.minimumShares);
      return api.openDialog({
        title: "Redeem shares — " + (a.clientName || ""), submitLabel: "Review",
        message: "Holds " + plural(held, "share") + " worth " + money(held * shrPrice) + ". Members must keep at least " + plural(min, "share") + " unless they redeem all.",
        fields: [{ key: "shares", label: "Number of shares to redeem", required: true, autocomplete: "off" }, dateField("Redemption date")],
        validate: function (v) {
          var n = wholeNumber(v.shares);
          if (!n) return "Number of shares must be a whole number greater than zero.";
          if (n > held) return "The member holds only " + plural(held, "share") + ".";
          if (min && held - n > 0 && held - n < min) return "The member would be left with " + plural(held - n, "share") + " — below the minimum of " + min + ". Redeem all " + held + " or fewer.";
          v.sharesN = n;
          return "";
        },
        confirm: function (v) {
          return {
            title: "Confirm redemption",
            lines: [["Member", a.clientName || ""], ["Account", "#" + a.accountNo], ["Shares", api.formatNumber(v.sharesN)], ["Unit price", money(shrPrice)], ["Amount to pay member", money(v.sharesN * shrPrice)], ["Shares left", api.formatNumber(held - v.sharesN)], ["Date", v.date]],
            note: "Pay the member " + money(v.sharesN * shrPrice) + " only after this is posted.",
            confirmLabel: "Redeem " + plural(v.sharesN, "share")
          };
        },
        onSubmit: function (v) {
          return call("post", "/accounts/share/" + enc(a.id) + "?command=redeemshares", withDate({ requestedDate: v.date, requestedShares: v.sharesN, unitPrice: shrPrice }));
        }
      }).then(shrDone("Shares redeemed"));
    };

    var shrState = function (cmd, label, key) {
      var a = shrNeed();
      return api.openDialog({
        title: label + " share account #" + a.accountNo, submitLabel: label,
        message: (a.clientName || "") + " · " + plural(num((a.summary || {}).totalPendingForApprovalShares) || sharesHeld(a), "share"),
        fields: [dateField(label + " on")],
        onSubmit: function (v) { var b = {}; b[key] = v.date; return call("post", "/accounts/share/" + enc(a.id) + "?command=" + cmd, withDate(b)); }
      }).then(shrDone(label === "Approve" ? "Share account approved" : "Share account activated"));
    };

    onAction("shr-approve", function () { return shrState("approve", "Approve", "approvedDate"); });
    onAction("shr-activate", function () { return shrState("activate", "Activate", "activatedDate"); });
    onAction("shr-buy", buyShares);
    onAction("shr-redeem", redeemShares);
    document.addEventListener("desk:refresh", refreshShare);
    refreshShare();
  }

  /* =========================================================== FIXED DEPOSITS */
  var fdProducts = null;
  async function loadFdProducts() {
    if (fdProducts) return fdProducts;
    var list = await call("get", "/fixeddepositproducts");
    fdProducts = await Promise.all((Array.isArray(list) ? list : []).map(function (p) { return call("get", "/fixeddepositproducts/" + enc(p.id)); }));
    return fdProducts;
  }
  function chartRate(product, months) {
    var slabs = ((product.activeChart || {}).chartSlabs || []).filter(function (s) { return !s.periodType || s.periodType.id === 2; });
    var hit = slabs.filter(function (s) { return months >= num(s.fromPeriod) && (s.toPeriod === null || s.toPeriod === undefined || months <= num(s.toPeriod)); })[0];
    return hit ? num(hit.annualInterestRate) : num(product.nominalAnnualInterestRate);
  }
  function termOptions(product) {
    var min = num(product.minDepositTerm) || 1, max = num(product.maxDepositTerm) || 60, step = num(product.inMultiplesOfDepositTerm) || 1;
    var out = [];
    for (var m = min; m <= max && out.length < 120; m += step) out.push({ value: m, label: m + " months — " + chartRate(product, m) + "% p.a." });
    return out;
  }
  var MATURITY = { 100: "Pay out (withdraw deposit)", 200: "Transfer to savings", 300: "Re-invest principal and interest", 400: "Re-invest principal only" };

  async function openFixedDeposit(preset) {
    var products = await loadFdProducts();
    if (!products.length) throw new Error("No fixed deposit product is configured in Fineract.");
    var member = preset || await chooseMember("Open fixed deposit — choose member");
    if (!member) return;
    var product = products[0];
    if (products.length > 1) {
      var pv = await api.openDialog({ title: "Fixed deposit product", submitLabel: "Continue", fields: [{ key: "productId", label: "Product", type: "select", required: true, options: products.map(function (p) { return { value: p.id, label: p.name }; }) }] });
      if (!pv) return;
      product = productById(products, pv.productId);
    }
    var savs = await memberSavings(member.id);
    var minAmt = num(product.minDepositAmount), maxAmt = num(product.maxDepositAmount);
    var terms = termOptions(product);
    var fundField = {
      key: "fund", label: "Funded by", type: "select", required: true, value: "cash",
      options: [{ value: "cash", label: "Cash deposit at activation" }].concat(savs.map(function (s) { return { value: s.id, label: "Transfer from " + savingsLabel(s) }; }))
    };
    var vol = savs.filter(function (s) { return /voluntary/i.test(s.productName || ""); })[0] || savs[0];
    var matField = {
      key: "maturity", label: "At maturity", type: "select", required: true, value: vol ? "200:" + vol.id : "100",
      options: savs.map(function (s) { return { value: "200:" + s.id, label: "Transfer to #" + s.accountNo + " · " + (s.productName || "Savings") }; })
        .concat([{ value: "100", label: MATURITY[100] }, { value: "300", label: MATURITY[300] }, { value: "400", label: MATURITY[400] }])
    };
    var termField = { key: "term", label: "Term (rate from chart)", type: "select", required: true, value: terms[0] ? String(terms[0].value) : "", options: terms };
    var canActivate = api.can("APPROVE_FIXEDDEPOSITACCOUNT") && api.can("ACTIVATE_FIXEDDEPOSITACCOUNT");
    var actField = canActivate ? { key: "activate", label: "After submitting", type: "select", value: "yes", options: [{ value: "yes", label: "Approve and activate now" }, { value: "no", label: "Leave pending approval" }] } : null;
    var result = null, warning = "";
    var v = await api.openDialog({
      title: "Open fixed deposit for " + member.name, submitLabel: "Review",
      message: product.name + ": " + money(minAmt) + " to " + money(maxAmt) + (product.preClosurePenalApplicable ? " · early closure penalty " + num(product.preClosurePenalInterest) + "% of the interest rate" : ""),
      fields: [{ key: "amount", label: "Deposit amount (UGX)", amount: true, required: true }, termField, fundField, matField, dateField("Submitted on")].concat(actField ? [actField] : []),
      validate: function (val) {
        if (minAmt && val.amount < minAmt) return "The minimum deposit is " + money(minAmt) + ".";
        if (maxAmt && val.amount > maxAmt) return "The maximum deposit is " + money(maxAmt) + ".";
        if (val.fund !== "cash") {
          var src = savs.filter(function (s) { return String(s.id) === String(val.fund); })[0];
          var bal = src ? num(src.accountBalance) : 0;
          if (val.activate !== "no" && val.amount > bal) return "Savings account #" + (src ? src.accountNo : "") + " has only " + money(bal) + ".";
        }
        return "";
      },
      confirm: function (val) {
        var months = Number(val.term), rate = chartRate(product, months);
        var est = Math.round(val.amount * Math.pow(1 + rate / 1200, months));
        return {
          title: "Confirm fixed deposit",
          lines: [["Member", member.name], ["Deposit", money(val.amount)], ["Term", months + " months"], ["Interest rate", rate + "% p.a. (chart)"],
            ["Estimated maturity amount", "≈ " + money(est)], ["Funded by", optionLabel(fundField, val.fund)], ["At maturity", optionLabel(matField, val.maturity)], ["Date", val.date]],
          note: val.fund === "cash" ? "Collect " + money(val.amount) + " from the member; the cash deposit is recorded when the account is activated." :
            money(val.amount) + " moves from savings when the account is activated. Fineract calculates the exact maturity amount on activation.",
          confirmLabel: "Open fixed deposit"
        };
      },
      onSubmit: async function (val) {
        var mat = String(val.maturity).split(":");
        var body = {
          clientId: Number(member.id), productId: Number(product.id), submittedOnDate: val.date, depositAmount: val.amount,
          depositPeriod: Number(val.term), depositPeriodFrequencyId: 2, maturityInstructionId: Number(mat[0])
        };
        if (mat[1]) body.transferToSavingsId = Number(mat[1]);
        if (val.fund !== "cash") body.linkAccountId = Number(val.fund);
        var created = await call("post", "/fixeddepositaccounts", withDate(body));
        result = created.savingsId || created.resourceId;
        if (val.activate === "yes") {
          try {
            await call("post", "/fixeddepositaccounts/" + enc(result) + "?command=approve", withDate({ approvedOnDate: val.date }));
            await call("post", "/fixeddepositaccounts/" + enc(result) + "?command=activate", withDate({ activatedOnDate: val.date }));
          } catch (err) { warning = err.message; }
        }
      }
    });
    if (v && result) {
      api.toast(warning ? "Fixed deposit created but not activated: " + warning : "Fixed deposit opened", warning ? "error" : "success");
      setTimeout(function () { location.href = "fd-detail.html?id=" + enc(result); }, warning ? 2500 : 300);
    }
  }

  if (page === "fixed-deposits") {
    var fdList = accountList({
      cols: 9, empty: "No fixed deposits yet",
      fetchPage: function (off, lim) { return call("get", "/fixeddepositaccounts?paged=true&offset=" + off + "&limit=" + lim + "&orderBy=id&sortOrder=DESC"); },
      fetchAll: function () { return fetchChunks(function (off, lim) { return "/fixeddepositaccounts?paged=true&offset=" + off + "&limit=" + lim + "&orderBy=id&sortOrder=DESC"; }); },
      productId: function (a) { return a.depositProductId; },
      row: function (a) {
        var href = "fd-detail.html?id=" + enc(a.id);
        return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(a.accountNo) + "</a></td><td>" + memberCell(a) + '</td><td class="mono text-right">' + money(a.depositAmount) +
          "</td><td>" + esc(a.depositPeriod ? a.depositPeriod + " " + String((a.depositPeriodFrequency || {}).value || "").toLowerCase() : "—") +
          '</td><td class="text-right">' + esc(a.nominalAnnualInterestRate !== undefined ? num(a.nominalAnnualInterestRate) + "%" : "—") + "</td><td>" + esc(api.formatDate(a.maturityDate)) +
          '</td><td class="mono text-right">' + (a.maturityAmount !== undefined ? money(a.maturityAmount) : "—") + "</td><td>" + api.statusBadge(a.status) +
          '</td><td><a class="btn btn-sm btn-ghost" href="' + href + '" aria-label="Open fixed deposit ' + esc(a.accountNo) + '">View</a></td></tr>';
      }
    });
    run(async function () {
      var products = await loadFdProducts().catch(function () { return []; });
      var rows = [];
      products.forEach(function (p) {
        ((p.activeChart || {}).chartSlabs || []).slice().sort(function (x, y) { return num(x.fromPeriod) - num(y.fromPeriod); }).forEach(function (s) {
          rows.push("<tr><td>" + esc(p.name) + "</td><td>" + esc(s.description || (s.fromPeriod + "–" + (s.toPeriod || "") + " " + String((s.periodType || {}).value || "").toLowerCase())) +
            '</td><td class="mono text-right">' + esc(num(s.annualInterestRate)) + "%</td></tr>");
        });
      });
      var card = $("fd-chart-card");
      if (card && rows.length) { card.hidden = false; document.querySelector("#fd-chart tbody").innerHTML = rows.join(""); }
      await fdList.load(0);
    });
    onAction("fd-open", function () { return openFixedDeposit(null); });
    document.addEventListener("desk:refresh", function () { run(fdList.refresh); });
  }

  if (page === "fd-detail") {
    var fdId = api.qs("id");
    var fd = null;
    var paintFd = async function () {
      if (!fdId) { setText("page-sub", "No account selected."); throw new Error("Open a fixed deposit from the list."); }
      var a = fd = await call("get", "/fixeddepositaccounts/" + enc(fdId) + "?associations=linkedAccount,transactions");
      var st = a.status || {};
      document.title = "Fixed deposit " + a.accountNo + SUFFIX;
      setText("fd-title", "Fixed deposit " + a.accountNo);
      setText("page-sub", (a.clientName || "") + " · " + (a.depositProductName || ""));
      setText("fd-product", a.depositProductName);
      setHtml("fd-status", api.statusBadge(st));
      setText("fd-account", "#" + a.accountNo);
      var link = $("fd-client");
      if (link) { link.textContent = a.clientName || "—"; link.href = "client-detail.html?id=" + enc(a.clientId || ""); }
      setText("fd-amount", money(a.depositAmount));
      setText("fd-term", a.depositPeriod ? a.depositPeriod + " " + String((a.depositPeriodFrequency || {}).value || "").toLowerCase() : "");
      setText("fd-rate", num(a.nominalAnnualInterestRate) + "% p.a.");
      setText("fd-activated", api.formatDate((a.timeline || {}).activatedOnDate));
      setText("fd-maturity-date", a.maturityDate ? api.formatDate(a.maturityDate) : "Set on activation");
      setText("fd-maturity-amount", a.maturityAmount !== undefined ? money(a.maturityAmount) : "Set on activation");
      setText("fd-balance", money((a.summary || {}).accountBalance || 0));
      setHtml("fd-linked", a.linkedAccount ? 'Transfer from <a href="savings-detail.html?id=' + enc(a.linkedAccount.id) + '">#' + esc(a.linkedAccount.accountNo) + "</a>" : "Cash deposit");
      var instr = (a.onAccountClosure && a.onAccountClosure.value) || (a.maturityInstructionId && MATURITY[a.maturityInstructionId]) || "—";
      setHtml("fd-instruction", esc(instr) + (a.transferToSavingsAccount ? ' → <a href="savings-detail.html?id=' + enc(a.transferToSavingsAccount.id) + '">#' + esc(a.transferToSavingsAccount.accountNo) + "</a>" : ""));
      setText("fd-penalty", a.preClosurePenalApplicable ? num(a.preClosurePenalInterest) + "% off the rate (" + String((a.preClosurePenalInterestOnType || {}).value || "").toLowerCase() + ")" : "None");
      var active = !!st.active;
      var matured = !!st.matured || st.id === 800;
      toggle("fd-approve", !!st.submittedAndPendingApproval);
      toggle("fd-activate", !!st.approved && !active);
      toggle("fd-preclose", active && !matured);
      toggle("fd-close", matured);
      var tb = document.querySelector("#fd-txns tbody");
      tb.innerHTML = (a.transactions || []).map(function (t) {
        var type = ((t.transactionType || {}).value || "") + (t.reversed ? " (reversed)" : "");
        return "<tr" + (t.reversed ? ' class="txn-reversed"' : "") + "><td>" + esc(api.formatDate(t.date)) + "</td><td>" + esc(type) + '</td><td class="mono text-right">' + money(t.amount) +
          '</td><td class="mono text-right">' + money(t.runningBalance) + "</td></tr>";
      }).join("") || api.emptyRow(4, "No transactions yet");
    };
    var refreshFd = function () { return run(paintFd); };
    var fdDone = function (msg) { return function (r) { if (r) { api.toast(msg, "success"); return refreshFd(); } }; };
    var fdNeed = function () { if (!fd) throw new Error("Account not loaded yet."); return fd; };

    var fdApprove = function () {
      var a = fdNeed();
      return api.openDialog({
        title: "Approve fixed deposit #" + a.accountNo, submitLabel: "Approve",
        message: (a.clientName || "") + " · " + money(a.depositAmount) + " for " + a.depositPeriod + " months at " + num(a.nominalAnnualInterestRate) + "%",
        fields: [dateField("Approved on")],
        onSubmit: function (v) { return call("post", "/fixeddepositaccounts/" + enc(a.id) + "?command=approve", withDate({ approvedOnDate: v.date })); }
      }).then(fdDone("Fixed deposit approved"));
    };
    var fdActivate = function () {
      var a = fdNeed();
      var src = a.linkedAccount ? "Transfer of " + money(a.depositAmount) + " from savings #" + a.linkedAccount.accountNo : "Cash deposit of " + money(a.depositAmount) + " — collect it from the member";
      return api.openDialog({
        title: "Activate fixed deposit #" + a.accountNo, submitLabel: "Review",
        message: src + ".",
        fields: [dateField("Activated on")],
        confirm: function (v) {
          return { title: "Confirm activation", lines: [["Member", a.clientName || ""], ["Deposit", money(a.depositAmount)], ["Funding", src], ["Term", a.depositPeriod + " months at " + num(a.nominalAnnualInterestRate) + "%"], ["Date", v.date]], confirmLabel: "Activate and post " + money(a.depositAmount) };
        },
        onSubmit: function (v) { return call("post", "/fixeddepositaccounts/" + enc(a.id) + "?command=activate", withDate({ activatedOnDate: v.date })); }
      }).then(fdDone("Fixed deposit activated"));
    };

    /* Premature close: preview the payable amount on a date, then close with transfer or payout. */
    var fdCloseFlow = async function (premature) {
      var a = fdNeed();
      var date = api.todayISO();
      var payable = num(a.maturityAmount);
      var savs = [];
      if (premature) {
        var dv = await api.openDialog({
          title: "Premature close #" + a.accountNo + " — preview", submitLabel: "Calculate",
          message: "The early-closure penalty reduces the interest rate" + (a.preClosurePenalApplicable ? " by " + num(a.preClosurePenalInterest) + "%" : "") + ".",
          fields: [dateField("Close on")]
        });
        if (!dv) return;
        date = dv.date;
        var preview = await call("post", "/fixeddepositaccounts/" + enc(a.id) + "?command=calculatePrematureAmount", withDate({ closedOnDate: date }));
        payable = num(preview.maturityAmount);
        savs = (preview.savingsAccounts || []).filter(function (s) { return !s.status || s.status.active; });
      } else {
        savs = await memberSavings(a.clientId);
      }
      var pt = await payTypeField("Pay out by");
      var dest = {
        key: "dest", label: "Proceeds", type: "select", required: true,
        value: savs[0] ? String(savs[0].id) : "cash",
        options: savs.map(function (s) { return { value: s.id, label: "Transfer to #" + s.accountNo + " · " + (s.savingsProductName || s.productName || "Savings") }; })
          .concat([{ value: "cash", label: "Pay out to the member (use payment type below)" }])
      };
      var fields = [dest, pt, receiptField()];
      if (!premature) fields.push(dateField("Close on"));
      fields.push(noteField());
      return api.openDialog({
        title: (premature ? "Premature close" : "Close on maturity") + " #" + a.accountNo, submitLabel: "Review",
        message: "Amount payable" + (premature ? " on " + date : "") + ": " + money(payable) + " (deposit " + money(a.depositAmount) + ").",
        fields: fields,
        confirm: function (v) {
          return {
            title: "Confirm closure",
            lines: [["Member", a.clientName || ""], ["Account", "#" + a.accountNo], ["Close on", premature ? date : v.date], ["Amount payable", money(payable)],
              ["Proceeds", v.dest === "cash" ? "Pay out · " + optionLabel(pt, v.paymentTypeId) : optionLabel(dest, v.dest)]],
            note: premature ? "Closing early forfeits part of the interest. This cannot be undone from Desk." : "",
            confirmLabel: premature ? "Close early" : "Close fixed deposit"
          };
        },
        onSubmit: function (v) {
          var body = { closedOnDate: premature ? date : v.date, note: v.note || "" };
          if (v.dest === "cash") { body.onAccountClosureId = 100; Object.assign(body, paymentBits(v)); }
          else { body.onAccountClosureId = 200; body.toSavingsAccountId = Number(v.dest); body.transferDescription = "Fixed deposit #" + a.accountNo + " closure"; }
          return call("post", "/fixeddepositaccounts/" + enc(a.id) + "?command=" + (premature ? "prematureClose" : "close"), withDate(body));
        }
      }).then(fdDone("Fixed deposit closed"));
    };

    onAction("fd-approve", fdApprove);
    onAction("fd-activate", fdActivate);
    onAction("fd-preclose", function () { return fdCloseFlow(true); });
    onAction("fd-close", function () { return fdCloseFlow(false); });
    document.addEventListener("desk:refresh", refreshFd);
    refreshFd();
  }
})();
/* ===== END SAVINGS/SHARES/FD ===== */
