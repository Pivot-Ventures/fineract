/*
 * Pivot SACCO Desk — front office module: tellers & cashiers, teller day desk,
 * cash allocation / settlement (EOD), dashboard, offices and roles.
 * Loaded only by: dashboard, tellers, teller, teller-detail, cashier-eod, offices, roles.
 */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;

  var page = document.body.getAttribute("data-page") || "";
  var sess = api.getSession() || {};
  var esc = api.escapeHtml;
  var CTX = "pivot_teller_ctx";
  var CCY = "UGX";
  var DATE = { locale: "en", dateFormat: "yyyy-MM-dd" };
  var NOTES = [50000, 20000, 10000, 5000, 2000, 1000];
  var COINS = [500, 200, 100, 50];
  var TXN_IN = [103];
  var TXN_OUT = [104];

  /* ------------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v === null || v === undefined || v === "" ? "—" : String(v); }
  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function fail(err) { if (err && err.status !== 401) api.toast(err.message || String(err), "error"); }
  function money(n) { return api.formatMoney(n); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function ctx() {
    try { return JSON.parse(sessionStorage.getItem(CTX) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveCtx(patch) {
    var next = Object.assign(ctx(), patch || {});
    try { sessionStorage.setItem(CTX, JSON.stringify(next)); } catch (e) { /* storage unavailable */ }
    return next;
  }
  function on(el, fn) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.disabled || el.getAttribute("aria-busy") === "true") return;
      el.setAttribute("aria-busy", "true");
      Promise.resolve().then(function () { return fn(el); }).catch(fail).then(function () { el.removeAttribute("aria-busy"); });
    });
  }
  function onAction(name, fn) {
    document.querySelectorAll('[data-action="' + name + '"]').forEach(function (b) { on(b, fn); });
  }
  function onSubmitForm(form, fn) {
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      if (btn && btn.disabled) return;
      if (btn) btn.disabled = true;
      Promise.resolve().then(function () { return fn(form); }).catch(fail).then(function () { if (btn) btn.disabled = false; });
    });
  }
  function canNot(err) { return err && err.status === 403; }
  function titleCase(s) { s = String(s || ""); return s.charAt(0) + s.slice(1).toLowerCase(); }
  async function loadOffices() {
    var offices = await api.get("/offices");
    return Array.isArray(offices) ? offices : [];
  }
  function officeOpts(offices) { return offices.map(function (o) { return { value: o.id, label: o.name }; }); }
  function defaultOffice(offices) {
    var has = offices.some(function (o) { return String(o.id) === String(sess.officeId); });
    return has ? String(sess.officeId) : (offices[0] ? String(offices[0].id) : "");
  }
  function signed(n) { return (n < 0 ? "−" : n > 0 ? "+" : "") + api.formatNumber(Math.abs(n)); }
  function notice(id, kind, html) {
    var el = $(id);
    if (!el) return;
    if (!html) { el.hidden = true; el.innerHTML = ""; return; }
    el.className = "fo-notice " + (kind || "");
    el.innerHTML = html;
    el.hidden = false;
  }

  /* ------------------------------------------------------------------ teller / cashier data */
  async function summary(tellerId, cashierId, offset, limit) {
    return api.get("/tellers/" + encodeURIComponent(tellerId) + "/cashiers/" + encodeURIComponent(cashierId) +
      "/summaryandtransactions?currencyCode=" + CCY + "&offset=" + (offset || 0) + "&limit=" + (limit || 1));
  }
  /* Summary plus the most recent transactions (Fineract orders oldest first, so fetch the last page). */
  async function drawer(tellerId, cashierId, recent) {
    var first = await summary(tellerId, cashierId, 0, 1);
    var total = num(first.cashierTransactions && first.cashierTransactions.totalFilteredRecords);
    var items = [];
    if (total > 0 && recent) {
      var off = Math.max(0, total - recent);
      var last = await summary(tellerId, cashierId, off, recent);
      items = ((last.cashierTransactions && last.cashierTransactions.pageItems) || []).slice().reverse();
    }
    first.recent = items;
    first.totalTxns = total;
    return first;
  }
  function cashPayload(amount, date, note) {
    return withDate({ txnDate: date, txnAmount: String(amount), currencyCode: CCY, txnNote: note || "" });
  }
  function txnKind(t) {
    var id = t.txnType && t.txnType.id;
    if (id === 101) return "alloc";
    if (id === 102) return "settle";
    if (TXN_IN.indexOf(id) >= 0) return "in";
    if (TXN_OUT.indexOf(id) >= 0) return "out";
    return "other";
  }
  var KIND_LABEL = { alloc: "Allocation (vault → till)", settle: "Settlement (till → vault)", "in": "Cash in", out: "Cash out", other: "Other" };
  function inRange(c, day) {
    var s = api.formatDate(c.startDate), e = api.formatDate(c.endDate);
    return (!s || s === "—" || s <= day) && (!e || e === "—" || e >= day);
  }
  /* Every cashier on every teller: 1 + (number of tellers) requests, in parallel. */
  async function allDrawers() {
    var tellers = await api.get("/tellers");
    tellers = Array.isArray(tellers) ? tellers : [];
    var packs = await Promise.all(tellers.map(function (t) {
      return api.get("/tellers/" + encodeURIComponent(t.id) + "/cashiers").catch(function () { return { cashiers: [] }; });
    }));
    var out = [];
    tellers.forEach(function (t, i) {
      (packs[i].cashiers || []).forEach(function (c) { out.push({ teller: t, cashier: c }); });
    });
    return { tellers: tellers, drawers: out };
  }
  function ownDrawers(list) {
    if (!sess.staffId) return [];
    var today = api.todayISO();
    return list.filter(function (d) { return String(d.cashier.staffId) === String(sess.staffId); })
      .sort(function (a, b) { return (inRange(b.cashier, today) ? 1 : 0) - (inRange(a.cashier, today) ? 1 : 0); });
  }
  function drawerCtx(d) {
    return {
      tellerId: d.teller.id, tellerName: d.teller.name, officeName: d.teller.officeName,
      cashierId: d.cashier.id, cashierName: d.cashier.staffName, staffId: d.cashier.staffId,
      startDate: api.formatDate(d.cashier.startDate), endDate: api.formatDate(d.cashier.endDate)
    };
  }
  function drawerLabel(d) {
    return d.teller.name + " · " + (d.cashier.staffName || "cashier " + d.cashier.id) + " (" + (d.teller.officeName || "") + ")";
  }
  function txnRows(items, cols) {
    if (!items.length) return api.emptyRow(cols, "No cash movements on this drawer yet.");
    return items.map(function (t) {
      var k = txnKind(t);
      var inAmt = (k === "in" || k === "alloc") ? money(t.txnAmount) : "";
      var outAmt = (k === "out" || k === "settle") ? money(t.txnAmount) : "";
      var when = t.createdDate ? String(t.createdDate).replace("T", " ").slice(0, 16) : api.formatDate(t.txnDate);
      return '<tr><td class="mono">' + esc(when) + "</td><td>" + esc(KIND_LABEL[k]) + "</td><td>" + esc(t.txnNote || "—") +
        '</td><td class="mono text-right">' + inAmt + '</td><td class="mono text-right">' + outAmt + "</td></tr>";
    }).join("");
  }

  /* ------------------------------------------------------------------ denomination helper */
  function denomGridHtml(prefix) {
    function row(d, coin) {
      var id = prefix + "-d" + d;
      return '<div class="denom-row"><label for="' + id + '">' + api.formatNumber(d) + (coin ? " coin" : "") + ' ×</label>' +
        '<input id="' + id + '" data-denom="' + d + '" class="mono" inputmode="numeric" autocomplete="off" aria-describedby="' + prefix + '-sub-' + d + '" />' +
        '<span class="mono denom-sub" id="' + prefix + "-sub-" + d + '">—</span></div>';
    }
    return '<div class="denom-cols"><div><p class="denom-head">Notes</p>' + NOTES.map(function (d) { return row(d, false); }).join("") +
      '</div><div><p class="denom-head">Coins</p>' + COINS.map(function (d) { return row(d, true); }).join("") + "</div></div>";
  }
  /* Attaches to a container rendered with denomGridHtml. onChange(total|NaN, any) */
  function denomWidget(container, prefix, onChange) {
    container.innerHTML = denomGridHtml(prefix);
    var inputs = Array.prototype.slice.call(container.querySelectorAll("[data-denom]"));
    function parse(v) {
      var s = String(v || "").trim().replace(/,/g, "");
      if (!s) return 0;
      return /^\d{1,6}$/.test(s) ? Number(s) : NaN;
    }
    function state() {
      var total = 0, bad = false, any = false, lines = [];
      inputs.forEach(function (inp) {
        var d = Number(inp.getAttribute("data-denom"));
        var n = parse(inp.value);
        var sub = $(prefix + "-sub-" + d);
        if (inp.value.trim() !== "") any = true;
        inp.setAttribute("aria-invalid", isNaN(n) ? "true" : "false");
        if (isNaN(n)) { bad = true; if (sub) sub.textContent = "?"; return; }
        if (sub) sub.textContent = n ? api.formatNumber(n * d) : "—";
        if (n) lines.push([d, n]);
        total += n * d;
      });
      return { total: bad ? NaN : total, any: any, lines: lines };
    }
    inputs.forEach(function (inp) { inp.addEventListener("input", function () { onChange(state()); }); });
    return {
      state: state,
      reset: function () { inputs.forEach(function (i) { i.value = ""; }); onChange(state()); }
    };
  }

  /* ------------------------------------------------------------------ teller & cashier dialogs */
  var STATUS_OPTS = [
    { value: "300", label: "Active" }, { value: "100", label: "Pending" },
    { value: "400", label: "Inactive" }, { value: "600", label: "Closed" }
  ];
  var STATUS_MAP = { PENDING: "100", ACTIVE: "300", INACTIVE: "400", CLOSED: "600" };

  async function tellerDialog(existing) {
    var offices = await loadOffices();
    return api.openDialog({
      title: existing ? "Edit teller" : "Create teller", submitLabel: existing ? "Save" : "Create",
      fields: [
        { key: "name", label: "Teller name", required: true, value: existing ? existing.name : "", placeholder: "e.g. Counter 1" },
        { key: "description", label: "Description", value: existing ? existing.description || "" : "" },
        { key: "officeId", label: "Office", type: "select", required: true, value: existing ? String(existing.officeId) : defaultOffice(offices), options: officeOpts(offices) },
        { key: "startDate", label: "Start date", type: "date", required: true, value: existing ? api.formatDate(existing.startDate) : api.todayISO() },
        { key: "status", label: "Status", type: "select", value: existing ? (STATUS_MAP[existing.status] || "300") : "300", options: STATUS_OPTS }
      ],
      onSubmit: function (v) {
        var body = withDate({ officeId: Number(v.officeId), name: v.name.trim(), description: v.description || "", status: Number(v.status), startDate: v.startDate });
        return existing ? api.put("/tellers/" + encodeURIComponent(existing.id), body) : api.post("/tellers", body);
      }
    });
  }

  async function cashierDialog(tellerId, existing) {
    var tmpl = await api.get("/tellers/" + encodeURIComponent(tellerId) + "/cashiers/template");
    var staff = tmpl.staffOptions || [];
    if (existing && !staff.some(function (s) { return String(s.id) === String(existing.staffId); })) {
      staff = [{ id: existing.staffId, displayName: existing.staffName }].concat(staff);
    }
    if (!staff.length) {
      var go = await api.confirmDialog({
        title: "No staff to assign",
        message: "A cashier is a staff member assigned to a teller (till), and " + (tmpl.officeName || "this office") +
          " has no active staff yet. Create the staff member on the Staff page first, then come back and assign them.",
        confirmLabel: "Open Staff page"
      });
      if (go) location.href = "staff.html";
      return null;
    }
    var yearEnd = api.todayISO().slice(0, 4) + "-12-31";
    return api.openDialog({
      title: existing ? "Edit cashier" : "Assign cashier" + (tmpl.tellerName ? " · " + tmpl.tellerName : ""), submitLabel: existing ? "Save" : "Assign",
      message: existing ? "" : "Choose a staff member of " + (tmpl.officeName || "this office") + ". Cash in / out on the teller desk is recorded against the cashier whose staff record is linked to the signed-in user.",
      fields: [
        { key: "staffId", label: "Staff", type: "select", required: true, value: existing ? String(existing.staffId) : "", placeholder: "— Select staff —", options: staff.map(function (s) { return { value: s.id, label: s.displayName }; }) },
        { key: "description", label: "Description", value: existing ? existing.description || "" : "" },
        { key: "startDate", label: "From", type: "date", required: true, value: existing ? api.formatDate(existing.startDate) : api.todayISO() },
        { key: "endDate", label: "To", type: "date", required: true, value: existing ? api.formatDate(existing.endDate) : yearEnd, help: "Cash in / out only counts on the drawer between these dates." },
        { key: "isFullDay", label: "Full day", type: "select", value: existing && !existing.isFullDay ? "false" : "true", options: [{ value: "true", label: "Yes (all day)" }, { value: "false", label: "No (09:00–17:00)" }] }
      ],
      validate: function (v) { return v.endDate < v.startDate ? "“To” must be on or after “From”." : ""; },
      onSubmit: function (v) {
        var body = withDate({ staffId: Number(v.staffId), description: v.description || "", isFullDay: v.isFullDay !== "false", startDate: v.startDate, endDate: v.endDate });
        if (!body.isFullDay) { body.hourStartTime = "09"; body.minStartTime = "00"; body.hourEndTime = "17"; body.minEndTime = "00"; }
        var base = "/tellers/" + encodeURIComponent(tellerId) + "/cashiers";
        return existing ? api.put(base + "/" + encodeURIComponent(existing.id), body) : api.post(base, body);
      }
    });
  }

  /* ================================================================== TELLERS LIST */
  if (page === "tellers") {
    var tbody = document.querySelector("#tellers-table tbody");
    var officeFilter = $("tellers-office");
    var canEditTeller = api.can("UPDATE_TELLER");
    var canAssign = api.can("ALLOCATECASHIER_TELLER");
    var reloadTellers = async function () {
      var pair = await Promise.all([allDrawers(), loadOffices()]);
      var tellers = pair[0].tellers;
      var names = {};
      pair[0].drawers.forEach(function (d) {
        (names[d.teller.id] = names[d.teller.id] || []).push(d.cashier.staffName || ("#" + d.cashier.staffId));
      });
      if (officeFilter && officeFilter.options.length <= 1) {
        officeFilter.innerHTML = '<option value="">All offices</option>' + pair[1].map(function (o) {
          return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
        }).join("");
      }
      var oid = officeFilter && officeFilter.value;
      tbody.innerHTML = tellers.filter(function (t) { return !oid || String(t.officeId) === String(oid); }).map(function (t) {
        var href = "teller-detail.html?id=" + encodeURIComponent(t.id);
        var list = names[t.id] || [];
        return '<tr><td class="strong"><a href="' + href + '">' + esc(t.name) + "</a></td><td>" + esc(t.officeName || "") + "</td><td>" +
          esc(t.description || "—") + "</td><td>" + (list.length ? esc(list.join(", ")) : '<span class="text-muted">None yet</span>') + "</td><td>" +
          api.statusBadge(titleCase(t.status || "—")) + '</td><td class="btn-group">' +
          '<a class="btn btn-sm" href="' + href + '">Open</a>' +
          (canAssign ? '<button type="button" class="btn btn-sm btn-ghost" data-assign-cashier="' + esc(t.id) + '">Assign cashier</button>' : "") +
          (canEditTeller ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-teller="' + esc(t.id) + '">Edit</button>' : "") + "</td></tr>";
      }).join("") || api.emptyRow(6, "No tellers yet. Create a teller (till), then assign a staff member to it as cashier.");
    };
    var assignTo = async function (tellerId) {
      var res = await cashierDialog(tellerId, null);
      if (res) { api.toast("Cashier assigned", "success"); await reloadTellers(); }
    };
    tbody.addEventListener("click", function (e) {
      var a = e.target.closest("[data-assign-cashier]");
      if (a) {
        if (a.getAttribute("aria-busy") === "true") return;
        a.setAttribute("aria-busy", "true");
        assignTo(a.getAttribute("data-assign-cashier")).catch(fail).then(function () { a.removeAttribute("aria-busy"); });
        return;
      }
      var b = e.target.closest("[data-edit-teller]");
      if (!b) return;
      api.get("/tellers/" + encodeURIComponent(b.getAttribute("data-edit-teller"))).then(tellerDialog).then(function (res) {
        if (res) { api.toast("Teller updated", "success"); return reloadTellers(); }
      }).catch(fail);
    });
    if (officeFilter) officeFilter.addEventListener("change", function () { reloadTellers().catch(fail); });
    onAction("create-teller", async function () {
      var res = await tellerDialog(null);
      if (!res) return;
      api.toast("Teller created — now assign a cashier", "success");
      await reloadTellers();
      if (res.resourceId && canAssign) await assignTo(res.resourceId);
    });
    reloadTellers().catch(function (err) { fail(err); tbody.innerHTML = api.emptyRow(6, "Could not load tellers: " + err.message); });
  }

  /* ------------------------------------------------------------------ allocate / settle form (teller-detail + EOD) */
  /*
   * Wires a cash movement form.
   * opts: { form, prefix, mode: "allocate"|"settle"|"choose", getDrawer() → { c, sum }, onDone() }
   */
  function cashMoveForm(opts) {
    var form = opts.form;
    if (!form) return null;
    var p = opts.prefix;
    var grid = $(p + "-denoms");
    var amountIn = $(p + "-amount");
    var dateIn = $(p + "-date");
    var noteIn = $(p + "-note");
    var countedEl = $(p + "-counted");
    var useBtn = $(p + "-use-count");
    var varBox = $(p + "-variance");
    var widget = null;
    function mode() {
      if (opts.mode !== "choose") return opts.mode;
      var r = form.querySelector('input[name="' + p + '-mode"]:checked');
      return r ? r.value : "allocate";
    }
    function paintVariance(st) {
      if (!varBox) return;
      var d = opts.getDrawer();
      if (mode() !== "settle" || !d || !d.sum) { varBox.hidden = true; return; }
      var expected = num(d.sum.netCash);
      if (!st.any || isNaN(st.total)) {
        varBox.hidden = false;
        varBox.className = "recon-box";
        varBox.innerHTML = '<div class="recon-line"><span>System drawer balance</span><span class="mono">' + money(expected) + "</span></div>" +
          '<p class="text-muted small-note">' + (isNaN(st.total) ? "Counts must be whole numbers." : "Count the cash to see the variance.") + "</p>";
        return;
      }
      var diff = st.total - expected;
      varBox.hidden = false;
      varBox.className = "recon-box " + (diff === 0 ? "ok" : "warn");
      varBox.innerHTML = '<div class="recon-line"><span>System drawer balance</span><span class="mono">' + money(expected) + "</span></div>" +
        '<div class="recon-line"><span>Counted</span><span class="mono">' + money(st.total) + "</span></div>" +
        '<div class="recon-line total"><span>Variance (counted − system)</span><span class="mono">' + esc(signed(diff)) + "</span></div>" +
        '<p class="small-note">' + (diff === 0 ? "Counted cash matches the system balance." : (diff < 0 ? "Short by " : "Over by ") + money(Math.abs(diff)) + ". Explain the variance in the note before settling.") + "</p>";
    }
    function onCount(st) {
      if (countedEl) countedEl.textContent = !st.any ? "—" : (isNaN(st.total) ? "Check counts" : money(st.total));
      if (useBtn) useBtn.disabled = !st.any || isNaN(st.total) || st.total <= 0;
      paintVariance(st);
    }
    if (grid) widget = denomWidget(grid, p, onCount);
    if (dateIn) { dateIn.value = api.todayISO(); dateIn.max = api.todayISO(); }
    if (useBtn) {
      useBtn.disabled = true;
      useBtn.addEventListener("click", function () {
        var st = widget.state();
        if (st.total > 0) amountIn.value = api.formatNumber(st.total);
        amountIn.focus();
      });
    }
    form.querySelectorAll('input[name="' + p + '-mode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var btn = form.querySelector("button[type=submit]");
        if (btn) btn.textContent = mode() === "settle" ? "Review settlement" : "Review allocation";
        if (noteIn) noteIn.placeholder = mode() === "settle" ? "Settle to vault" : "Vault allocation";
        if (widget) paintVariance(widget.state());
      });
    });
    onSubmitForm(form, async function () {
      var d = opts.getDrawer();
      if (!d || !d.c) throw new Error("Choose a cashier first.");
      var m = mode();
      var amount = api.parseAmount(amountIn.value);
      var date = dateIn ? dateIn.value : api.todayISO();
      var note = noteIn ? noteIn.value.trim() : "";
      if (!(amount > 0)) throw new Error("Amount must be a whole number of UGX greater than zero (e.g. 500,000).");
      if (!api.isISODate(date)) throw new Error("Choose a valid date.");
      if (date > api.todayISO()) throw new Error("The date cannot be in the future.");
      var st = widget ? widget.state() : { any: false };
      if (st.any && isNaN(st.total)) throw new Error("Denomination counts must be whole numbers.");
      var expected = d.sum ? num(d.sum.netCash) : null;
      if (m === "settle" && expected !== null && amount > expected) {
        throw new Error("Cannot settle " + money(amount) + ": the drawer's system balance is only " + money(expected) + ".");
      }
      var lines = [["Teller (till)", d.c.tellerName || d.c.tellerId], ["Cashier", d.c.cashierName || d.c.cashierId], ["Amount", money(amount)], ["Date", date]];
      if (st.any) {
        lines.push(["Denominations", st.lines.map(function (l) { return l[1] + " × " + api.formatNumber(l[0]); }).join(", ") || "—"]);
        if (st.total !== amount) lines.push(["Counted total", money(st.total) + " (differs from amount)"]);
      }
      if (expected !== null) {
        lines.push(["Drawer balance before", money(expected)]);
        lines.push(["Drawer balance after", money(m === "settle" ? expected - amount : expected + amount)]);
      }
      if (m === "settle" && st.any && expected !== null) lines.push(["Variance (counted − system)", signed(st.total - expected)]);
      var settleNote = note || (m === "settle" ? "Settle to vault" : "Vault allocation");
      if (st.any && st.lines.length) settleNote += " [" + st.lines.map(function (l) { return l[1] + "x" + l[0]; }).join(" ") + "]";
      var ok = await api.confirmDialog({
        title: m === "settle" ? "Settle cash to vault" : "Allocate cash to till",
        summary: m === "settle" ? "Confirm settlement (till → vault)" : "Confirm allocation (vault → till)",
        lines: lines,
        note: m === "settle" ? "The cashier hands this cash to the vault custodian. Both should sign the printed EOD sheet." : "The vault custodian hands this cash to the cashier.",
        confirmLabel: (m === "settle" ? "Settle " : "Allocate ") + money(amount),
        onConfirm: function () {
          return api.post("/tellers/" + encodeURIComponent(d.c.tellerId) + "/cashiers/" + encodeURIComponent(d.c.cashierId) + "/" + (m === "settle" ? "settle" : "allocate"),
            cashPayload(amount, date, settleNote.slice(0, 500)));
        }
      });
      if (!ok) return;
      api.toast((m === "settle" ? "Settled " : "Allocated ") + money(amount), "success");
      amountIn.value = "";
      if (noteIn) noteIn.value = "";
      if (widget) widget.reset();
      if (opts.onDone) await opts.onDone(m, amount, st);
    });
    return { widget: widget, refresh: function () { if (widget) paintVariance(widget.state()); } };
  }

  function paintDrawerSummary(prefix, sum) {
    setText(prefix + "-allocated", money(sum.sumCashAllocation));
    setText(prefix + "-cash-in", money(sum.sumInwardCash));
    setText(prefix + "-cash-out", money(sum.sumOutwardCash));
    setText(prefix + "-settled", money(sum.sumCashSettlement));
    setText(prefix + "-balance", money(sum.netCash));
  }

  /* ================================================================== TELLER DETAIL */
  if (page === "teller-detail") {
    var tellerId = api.qs("id");
    var cashiers = [];
    var current = { c: null, sum: null };
    var teller = null;
    var canEditCashier = api.can("UPDATECASHIERALLOCATION_TELLER");
    var paintCashier = async function (cashierId) {
      var tb = document.querySelector("#cashier-txns tbody");
      var cashier = cashiers.filter(function (c) { return String(c.id) === String(cashierId); })[0];
      if (!cashier) {
        current = { c: null, sum: null };
        tb.innerHTML = api.emptyRow(5, "Select a cashier.");
        ["td-allocated", "td-cash-in", "td-cash-out", "td-settled", "td-balance"].forEach(function (id) { setText(id, "—"); });
        setText("td-drawer-name", "—");
        return;
      }
      tb.innerHTML = api.loadingRow(5);
      var sum = await drawer(tellerId, cashier.id, 20);
      current = { c: drawerCtx({ teller: teller, cashier: cashier }), sum: sum };
      paintDrawerSummary("td", sum);
      setText("td-drawer-name", cashier.staffName || cashier.staffId);
      tb.innerHTML = txnRows(sum.recent, 5);
      if (move) move.refresh();
      var eod = $("td-eod-link");
      if (eod) eod.href = "cashier-eod.html?tellerId=" + encodeURIComponent(tellerId) + "&cashierId=" + encodeURIComponent(cashier.id);
    };
    var paintTeller = async function () {
      if (!tellerId) throw new Error("Open a teller from the Tellers list.");
      teller = await api.get("/tellers/" + encodeURIComponent(tellerId));
      document.title = (teller.name || "Teller") + " · Phaneroo SACCO";
      setText("teller-title", teller.name || ("Teller " + tellerId));
      setText("page-sub", (teller.officeName || "") + " · started " + api.formatDate(teller.startDate));
      setText("teller-name", teller.name || "");
      setHtml("teller-status", api.statusBadge(titleCase(teller.status || "")));
      setText("teller-office", "Office: " + (teller.officeName || teller.officeId) + (teller.description ? " · " + teller.description : ""));
      var pack = await api.get("/tellers/" + encodeURIComponent(tellerId) + "/cashiers");
      cashiers = pack.cashiers || [];
      var today = api.todayISO();
      document.querySelector("#cashiers-table tbody").innerHTML = cashiers.map(function (c) {
        var q = "tellerId=" + encodeURIComponent(tellerId) + "&cashierId=" + encodeURIComponent(c.id);
        var live = inRange(c, today);
        return '<tr><td class="strong">' + esc(c.staffName || c.staffId) + "</td><td>" + esc(api.formatDate(c.startDate)) + " → " +
          esc(api.formatDate(c.endDate)) + (live ? "" : ' <span class="status closed">Not current</span>') + "</td><td>" + (c.isFullDay ? "Full day" : "09:00–17:00") +
          '</td><td class="btn-group"><button type="button" class="btn btn-sm btn-ghost" data-pick="' + esc(c.id) + '">Drawer</button>' +
          '<a class="btn btn-sm btn-ghost" href="cashier-eod.html?' + q + '">EOD</a>' +
          (canEditCashier ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-cashier="' + esc(c.id) + '">Edit</button>' : "") +
          "</td></tr>";
      }).join("") || '<tr class="empty-row"><td colspan="4">No cashiers yet. Use “＋ Assign cashier” above to pick a staff member of this office. ' +
        'If nobody is listed, <a href="staff.html">add the staff member</a> first, and give them a login under <a href="users.html">Users</a>.</td></tr>';
      var sel = $("td-cashier");
      sel.innerHTML = '<option value="">— Select cashier —</option>' + cashiers.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.staffName || c.staffId) + "</option>";
      }).join("");
      var want = api.qs("cashierId") || (String(ctx().tellerId) === String(tellerId) ? ctx().cashierId : "");
      var pick = cashiers.some(function (c) { return String(c.id) === String(want); }) ? String(want) : (cashiers.length === 1 ? String(cashiers[0].id) : "");
      sel.value = pick;
      await paintCashier(pick);
    };
    var move = cashMoveForm({
      form: $("td-move-form"), prefix: "td-move", mode: "choose",
      getDrawer: function () { return current; },
      onDone: function () { return paintCashier(current.c && current.c.cashierId); }
    });
    if (window.location.hash === "#settle") {
      var settleRadio = document.querySelector('input[name="td-move-mode"][value="settle"]');
      if (settleRadio) { settleRadio.checked = true; settleRadio.dispatchEvent(new Event("change")); }
    }
    $("td-cashier").addEventListener("change", function (e) {
      if (e.target.value) saveCtx({ tellerId: Number(tellerId), cashierId: Number(e.target.value) });
      paintCashier(e.target.value).catch(fail);
    });
    document.querySelector("#cashiers-table tbody").addEventListener("click", function (e) {
      var t = e.target.closest("[data-pick]");
      if (t) {
        $("td-cashier").value = t.getAttribute("data-pick");
        paintCashier(t.getAttribute("data-pick")).then(function () { var f = $("td-move-amount"); if (f) f.scrollIntoView({ block: "center" }); }).catch(fail);
        return;
      }
      var ed = e.target.closest("[data-edit-cashier]");
      if (ed) {
        var cur = cashiers.filter(function (c) { return String(c.id) === ed.getAttribute("data-edit-cashier"); })[0];
        cashierDialog(tellerId, cur).then(function (r) { if (r) { api.toast("Cashier updated", "success"); return paintTeller(); } }).catch(fail);
      }
    });
    onAction("edit-teller", async function () {
      var t = await api.get("/tellers/" + encodeURIComponent(tellerId));
      if (await tellerDialog(t)) { api.toast("Teller updated", "success"); await paintTeller(); }
    });
    onAction("create-cashier", async function () {
      if (await cashierDialog(tellerId, null)) { api.toast("Cashier assigned", "success"); await paintTeller(); }
    });
    paintTeller().catch(function (err) {
      fail(err);
      document.querySelector("#cashiers-table tbody").innerHTML = api.emptyRow(4, "Could not load: " + err.message);
    });
  }

  /* ================================================================== TELLER DAY DESK */
  if (page === "teller") {
    var desk = { own: null, view: null, sum: null, drawers: [] };
    var isSupervisor = api.can(["ALLOCATECASHTOCASHIER_TELLER", "SETTLECASHFROMCASHIER_TELLER"]);

    var cashType = async function () {
      var list = await api.paymentTypes();
      var cash = list.filter(function (p) { return p.isCashPayment; })[0];
      if (!cash) throw new Error("No payment type is marked as cash in Fineract, so cash in / out cannot reach the drawer. An administrator must mark the Cash payment type as a cash payment.");
      return cash;
    };
    var setCashButtons = function (enabled, why) {
      document.querySelectorAll("[data-cash-action]").forEach(function (b) {
        b.disabled = !enabled;
        b.setAttribute("aria-disabled", enabled ? "false" : "true");
        b.title = enabled ? "" : why;
      });
    };
    var paintDesk = async function () {
      if (!desk.drawers.length || !desk.view) {
        var all = await allDrawers();
        desk.drawers = all.drawers;
        var mine = ownDrawers(all.drawers);
        desk.own = mine[0] ? drawerCtx(mine[0]) : null;
        var c = ctx();
        var chosen = null;
        var wantT = api.qs("tellerId") || c.tellerId, wantC = api.qs("cashierId") || c.cashierId;
        if (isSupervisor && wantC) {
          chosen = all.drawers.filter(function (d) { return String(d.cashier.id) === String(wantC) && String(d.teller.id) === String(wantT); })[0];
        }
        desk.view = chosen ? drawerCtx(chosen) : desk.own;
      }
      var today = api.todayISO();
      var own = desk.own;
      var view = desk.view;
      var viewingOther = view && (!own || String(view.cashierId) !== String(own.cashierId));
      if (!own) {
        var msg = !sess.staffId ?
          "<strong>Your login is not linked to a staff record, so you have no cash drawer.</strong> Cash in / out at the counter is recorded on the drawer of the staff member linked to the signed-in user. " +
            "An administrator links your login to your staff record under <a href=\"users.html\">Users</a>, and assigns you to a till under <a href=\"tellers.html\">Tellers &amp; cashiers</a>." :
          "<strong>You (" + esc(sess.staffDisplayName || "your staff record") + ") are not assigned as cashier to any till.</strong> Ask your branch manager to assign you to a teller under <a href=\"tellers.html\">Tellers &amp; cashiers</a>.";
        notice("desk-notice", "warn", msg + (isSupervisor ? " As a supervisor you can still view a cashier's drawer with “View another drawer”." : ""));
        setCashButtons(false, "You have no cash drawer");
      } else if (!inRange({ startDate: own.startDate, endDate: own.endDate }, today)) {
        notice("desk-notice", "warn", "<strong>Your cashier assignment on " + esc(own.tellerName) + " runs " + esc(own.startDate) + " → " + esc(own.endDate) +
          ", which does not include today.</strong> Cash in / out today would not reach the drawer. Ask your branch manager to extend the assignment.");
        setCashButtons(false, "Your cashier assignment does not cover today");
      } else if (viewingOther) {
        notice("desk-notice", "info", "You are viewing <strong>" + esc(view.cashierName) + "</strong>'s drawer. Cash in / out you post is always recorded on <strong>your own</strong> drawer (" + esc(own.tellerName) + "). " +
          '<button type="button" class="btn btn-sm btn-ghost" data-action="view-own">Back to my drawer</button>');
        setCashButtons(true, "");
        document.querySelectorAll('[data-action="view-own"]').forEach(function (b) {
          on(b, function () { desk.view = own; saveCtx({ tellerId: own.tellerId, cashierId: own.cashierId }); return paintDesk(); });
        });
      } else {
        notice("desk-notice", "", "");
        setCashButtons(true, "");
      }
      if (!view) {
        ["kpi-allocated", "kpi-cash-in", "kpi-cash-out", "kpi-settled", "kpi-net"].forEach(function (id) { setText(id, "—"); });
        setText("page-sub", "No cash drawer");
        document.querySelector("#teller-txns tbody").innerHTML = api.emptyRow(5, "No drawer to show.");
        return null;
      }
      var sum = await drawer(view.tellerId, view.cashierId, 25);
      desk.sum = sum;
      setText("kpi-allocated", money(sum.sumCashAllocation));
      setText("kpi-cash-in", money(sum.sumInwardCash));
      setText("kpi-cash-out", money(sum.sumOutwardCash));
      setText("kpi-settled", money(sum.sumCashSettlement));
      setText("kpi-net", money(sum.netCash));
      var todays = sum.recent.filter(function (t) { return api.formatDate(t.txnDate) === today; });
      var tIn = 0, tOut = 0;
      todays.forEach(function (t) { var k = txnKind(t); if (k === "in") tIn += num(t.txnAmount); if (k === "out") tOut += num(t.txnAmount); });
      setText("kpi-net-meta", "Today: in " + api.formatNumber(tIn) + " · out " + api.formatNumber(tOut));
      setText("page-sub", (viewingOther ? "Viewing " : "My drawer · ") + view.cashierName + " · " + view.tellerName + " · " + (sum.officeName || view.officeName || "") +
        " · assignment " + view.startDate + " → " + view.endDate);
      document.querySelector("#teller-txns tbody").innerHTML = txnRows(sum.recent, 5);
      var tc = $("txn-count");
      if (tc) { tc.textContent = sum.totalTxns ? "Latest " + sum.recent.length + " of " + sum.totalTxns : ""; tc.hidden = !sum.totalTxns; }
      var eodLink = $("desk-eod-link");
      if (eodLink) eodLink.href = "cashier-eod.html?tellerId=" + encodeURIComponent(view.tellerId) + "&cashierId=" + encodeURIComponent(view.cashierId);
      var mgr = $("desk-manage-link");
      if (mgr) mgr.href = "teller-detail.html?id=" + encodeURIComponent(view.tellerId) + "&cashierId=" + encodeURIComponent(view.cashierId);
      return sum;
    };

    /* Cash in / out always posts with the Cash payment type, dated today, so it lands on the signed-in cashier's drawer. */
    var counterDialog = async function (kind) {
      if (!desk.own) throw new Error("You have no cash drawer. Ask an administrator to link your login to a staff record assigned as cashier.");
      var cash = await cashType();
      var isIn = kind !== "withdrawal";
      var isLoan = kind === "repay";
      var today = api.todayISO();
      var fields = [
        isLoan ?
          { key: "acct", label: "Loan", type: "search", required: true, placeholder: "Loan account no or member name", search: function (q) { return api.searchLoans(q, true); } } :
          { key: "acct", label: "Savings account", type: "search", required: true, placeholder: "Account no or member name", search: function (q) { return api.searchSavings(q, true); } },
        { key: "amount", label: "Cash amount (UGX)", amount: true, required: true },
        { key: "note", label: "Note / receipt no.", placeholder: "optional" }
      ];
      var acct = null;
      var title = isLoan ? "Loan repayment (cash in)" : (isIn ? "Deposit (cash in)" : "Withdrawal (cash out)");
      return api.openDialog({
        title: title, submitLabel: "Review", fields: fields,
        message: "Paid in cash at " + desk.own.tellerName + " · drawer of " + desk.own.cashierName + " · " + today,
        confirm: function (v) {
          var lines = [
            [isLoan ? "Loan" : "Account", v.acctLabel || v.acct], ["Amount", money(v.amount)],
            ["Payment type", cash.name], ["Date", today], ["Drawer", desk.own.tellerName + " · " + desk.own.cashierName]
          ];
          if (v.note) lines.push(["Note", v.note]);
          return {
            title: "Confirm " + title.toLowerCase(), lines: lines,
            note: isIn ? "Count the cash from the member before posting." : "Fineract checks the balance; count the cash out to the member only after this succeeds.",
            confirmLabel: (isLoan ? "Post repayment of " : isIn ? "Post deposit of " : "Post withdrawal of ") + money(v.amount)
          };
        },
        onSubmit: async function (v) {
          if (!isIn) {
            acct = await api.get("/savingsaccounts/" + encodeURIComponent(v.acct));
            var avail = num(acct.summary && (acct.summary.availableBalance !== undefined ? acct.summary.availableBalance : acct.summary.accountBalance));
            if (v.amount > avail) throw new Error("Insufficient balance: the member can withdraw at most " + money(avail) + " from #" + acct.accountNo + ".");
            var own = await drawer(desk.own.tellerId, desk.own.cashierId, 0);
            if (v.amount > num(own.netCash)) throw new Error("Your drawer holds only " + money(own.netCash) + ". Ask the vault custodian for a cash allocation first.");
          }
          var body = withDate({ transactionDate: today, transactionAmount: String(v.amount), paymentTypeId: Number(cash.id), note: v.note || "", receiptNumber: v.note ? v.note.slice(0, 50) : undefined });
          if (!v.note) delete body.receiptNumber;
          var path = isLoan ? "/loans/" + encodeURIComponent(v.acct) + "/transactions?command=repayment" :
            "/savingsaccounts/" + encodeURIComponent(v.acct) + "/transactions?command=" + (isIn ? "deposit" : "withdrawal");
          return api.post(path, body);
        }
      });
    };
    var afterPost = function (msg) {
      return async function (res) {
        if (!res) return;
        api.toast(msg, "success");
        if (desk.own) desk.view = desk.own;
        await paintDesk();
      };
    };

    onSubmitForm($("teller-search-form"), async function () {
      var q = $("teller-search").value.trim();
      var tb = document.querySelector("#teller-members tbody");
      if (q.length < 2) { tb.innerHTML = api.emptyRow(4, "Type at least 2 characters."); return; }
      tb.innerHTML = api.loadingRow(4, "Searching…");
      var rows = await api.searchClients(q);
      tb.innerHTML = rows.map(function (r) {
        return '<tr><td class="mono">' + esc(r.raw.entityAccountNo || r.value) + "</td><td>" + esc(r.label) + "</td><td>" + esc(r.raw.parentName || "") +
          '</td><td><a class="btn btn-sm" href="' + esc(r.href) + '">Open</a></td></tr>';
      }).join("") || api.emptyRow(4, "No match (search is case-sensitive)");
    });
    onAction("open-session", async function () {
      if (!desk.drawers.length) { var all = await allDrawers(); desk.drawers = all.drawers; }
      if (!desk.drawers.length) throw new Error("No cashier assignments yet. Assign a cashier under Tellers & cashiers.");
      var cur = desk.view;
      var v = await api.openDialog({
        title: "View another drawer", submitLabel: "Show drawer",
        message: "Supervisors can view any cashier's drawer. Cash in / out is still recorded on your own drawer.",
        fields: [{ key: "pair", label: "Teller / cashier", type: "select", required: true, value: cur ? cur.tellerId + ":" + cur.cashierId : "",
          options: desk.drawers.map(function (d) { return { value: d.teller.id + ":" + d.cashier.id, label: drawerLabel(d) }; }) }]
      });
      if (!v) return;
      var parts = String(v.pair).split(":");
      var d = desk.drawers.filter(function (x) { return String(x.teller.id) === parts[0] && String(x.cashier.id) === parts[1]; })[0];
      desk.view = drawerCtx(d);
      saveCtx({ tellerId: d.teller.id, cashierId: d.cashier.id });
      await paintDesk();
    });
    onAction("refresh-desk", function () { return paintDesk(); });
    onAction("deposit", function () { return counterDialog("deposit").then(afterPost("Deposit posted")); });
    onAction("withdrawal", function () { return counterDialog("withdrawal").then(afterPost("Withdrawal posted")); });
    onAction("repay", function () { return counterDialog("repay").then(afterPost("Repayment posted")); });
    if (!isSupervisor) document.querySelectorAll('[data-action="open-session"]').forEach(function (b) { b.hidden = true; });
    paintDesk().catch(function (err) {
      fail(err);
      document.querySelector("#teller-txns tbody").innerHTML = api.emptyRow(5, "Could not load the drawer: " + err.message);
    });
  }

  /* ================================================================== CASHIER EOD */
  if (page === "cashier-eod") {
    var eod = { c: null, sum: null, drawers: [] };
    var count = null;
    var paintCount = function (st) {
      setText("eod-counted", !st.any ? "—" : (isNaN(st.total) ? "Check counts" : money(st.total)));
      var box = $("eod-variance-box");
      var useBtn = $("eod-use-count");
      if (useBtn) useBtn.disabled = !st.any || isNaN(st.total) || st.total <= 0;
      if (!st.any || isNaN(st.total) || !eod.sum) {
        setText("eod-variance", "—");
        setText("eod-variance-note", isNaN(st.total) ? "Counts must be whole numbers." : "Enter the cash count to compare with the system balance.");
        box.className = "recon-box";
        return;
      }
      var diff = st.total - num(eod.sum.netCash);
      setText("eod-variance", signed(diff));
      setText("eod-variance-note", diff === 0 ? "Counted cash matches the system balance." :
        (diff < 0 ? "Short by " : "Over by ") + money(Math.abs(diff)) + " against the system balance of " + money(eod.sum.netCash) + ". Record the reason in the note.");
      box.className = "recon-box " + (diff === 0 ? "ok" : "warn");
      var pl = $("eod-print-count");
      if (pl) pl.innerHTML = st.lines.map(function (l) {
        return '<div class="recon-line"><span>' + api.formatNumber(l[0]) + " × " + l[1] + '</span><span class="mono">' + api.formatNumber(l[0] * l[1]) + "</span></div>";
      }).join("");
    };
    var paintEod = async function () {
      if (!eod.drawers.length) {
        var all = await allDrawers();
        eod.drawers = all.drawers;
        var sel = $("eod-drawer");
        sel.innerHTML = '<option value="">— Select drawer —</option>' + all.drawers.map(function (d) {
          return '<option value="' + esc(d.teller.id + ":" + d.cashier.id) + '">' + esc(drawerLabel(d)) + "</option>";
        }).join("");
        var c = ctx();
        var wantT = api.qs("tellerId") || c.tellerId, wantC = api.qs("cashierId") || c.cashierId;
        var mine = ownDrawers(all.drawers)[0];
        var pick = all.drawers.filter(function (d) { return String(d.teller.id) === String(wantT) && String(d.cashier.id) === String(wantC); })[0] || mine ||
          (all.drawers.length === 1 ? all.drawers[0] : null);
        if (pick) { sel.value = pick.teller.id + ":" + pick.cashier.id; eod.c = drawerCtx(pick); }
        if (!all.drawers.length) notice("eod-notice", "warn", "No cashier is assigned to any teller yet. Assign one under <a href=\"tellers.html\">Tellers &amp; cashiers</a>.");
      }
      if (!eod.c) {
        eod.sum = null;
        setText("page-sub", "Choose a drawer to reconcile.");
        return;
      }
      var sum = await drawer(eod.c.tellerId, eod.c.cashierId, 200);
      eod.sum = sum;
      setText("eod-allocated", api.formatNumber(sum.sumCashAllocation));
      setText("eod-cash-in", api.formatNumber(sum.sumInwardCash));
      setText("eod-cash-out", api.formatNumber(sum.sumOutwardCash));
      setText("eod-settled", api.formatNumber(sum.sumCashSettlement));
      setText("eod-expected", api.formatNumber(sum.netCash));
      setText("eod-cashier", eod.c.cashierName + " · " + eod.c.tellerName);
      setText("page-sub", "Teller " + eod.c.tellerName + " · cashier " + eod.c.cashierName + " · " + (sum.officeName || eod.c.officeName || ""));
      var today = api.todayISO();
      var todays = sum.recent.filter(function (t) { return api.formatDate(t.txnDate) === today; });
      var agg = { alloc: 0, "in": 0, out: 0, settle: 0, n: 0 };
      todays.forEach(function (t) { var k = txnKind(t); if (agg[k] !== undefined) { agg[k] += num(t.txnAmount); agg.n += 1; } });
      setText("eod-today", "Today (" + today + "): " + agg.n + " movements · allocated " + api.formatNumber(agg.alloc) + " · in " + api.formatNumber(agg["in"]) +
        " · out " + api.formatNumber(agg.out) + " · settled " + api.formatNumber(agg.settle));
      document.querySelector("#eod-txns tbody").innerHTML = todays.length ? txnRows(todays, 5) : api.emptyRow(5, "No cash movements today on this drawer.");
      setText("eod-print-meta", "Printed " + new Date().toLocaleString("en-UG", { timeZone: "Africa/Kampala" }) + " by " + (sess.username || "") + " · " + (sum.officeName || ""));
      var own = sess.staffId && String(eod.c.staffId) === String(sess.staffId);
      notice("eod-notice", own || !api.can("SETTLECASHFROMCASHIER_TELLER") ? "" : "info",
        own || !api.can("SETTLECASHFROMCASHIER_TELLER") ? "" : "You are settling <strong>" + esc(eod.c.cashierName) + "</strong>'s drawer. Count the cash together with the cashier.");
      if (count) paintCount(count.state());
    };
    var grid = $("eod-denoms");
    if (grid) count = denomWidget(grid, "eod", paintCount);
    $("eod-drawer").addEventListener("change", function (e) {
      var parts = String(e.target.value).split(":");
      var d = eod.drawers.filter(function (x) { return String(x.teller.id) === parts[0] && String(x.cashier.id) === parts[1]; })[0];
      eod.c = d ? drawerCtx(d) : null;
      if (d) saveCtx({ tellerId: d.teller.id, cashierId: d.cashier.id });
      if (count) count.reset();
      paintEod().catch(fail);
    });
    var useCount = $("eod-use-count");
    if (useCount) {
      useCount.disabled = true;
      useCount.addEventListener("click", function () {
        var st = count.state();
        if (st.total > 0) $("settle-amount").value = api.formatNumber(st.total);
        $("settle-amount").focus();
      });
    }
    if ($("settle-date")) { $("settle-date").value = api.todayISO(); $("settle-date").max = api.todayISO(); }
    onSubmitForm($("settle-form"), async function () {
      if (!eod.c || !eod.sum) throw new Error("Choose a drawer first.");
      var amount = api.parseAmount($("settle-amount").value);
      var date = $("settle-date").value;
      var note = $("settle-note").value.trim();
      if (!(amount > 0)) throw new Error("Settle amount must be a whole number of UGX greater than zero.");
      if (!api.isISODate(date) || date > api.todayISO()) throw new Error("Choose a valid date that is not in the future.");
      var expected = num(eod.sum.netCash);
      if (amount > expected) throw new Error("Cannot settle " + money(amount) + ": the drawer's system balance is only " + money(expected) + ".");
      var st = count ? count.state() : { any: false };
      if (st.any && isNaN(st.total)) throw new Error("Denomination counts must be whole numbers.");
      var lines = [["Teller (till)", eod.c.tellerName], ["Cashier", eod.c.cashierName], ["Settle amount", money(amount)], ["Date", date], ["System balance", money(expected)],
        ["Balance after settle", money(expected - amount)]];
      if (st.any) lines.push(["Counted", money(st.total)], ["Variance (counted − system)", signed(st.total - expected)]);
      if (st.any && st.total - expected !== 0 && !note) throw new Error("There is a variance of " + signed(st.total - expected) + ". Explain it in the note before settling.");
      var fullNote = (note || "EOD settle") + (st.any && st.lines.length ? " [" + st.lines.map(function (l) { return l[1] + "x" + l[0]; }).join(" ") + "]" : "");
      var ok = await api.confirmDialog({
        title: "Settle cash to vault", summary: "Confirm settlement (till → vault)", lines: lines, confirmLabel: "Settle " + money(amount),
        note: "Print the EOD sheet afterwards and have the cashier and the vault custodian sign it.",
        onConfirm: function () {
          return api.post("/tellers/" + encodeURIComponent(eod.c.tellerId) + "/cashiers/" + encodeURIComponent(eod.c.cashierId) + "/settle", cashPayload(amount, date, fullNote.slice(0, 500)));
        }
      });
      if (!ok) return;
      api.toast("Settled " + money(amount) + " to the vault", "success");
      $("settle-amount").value = "";
      setText("eod-print-settled", money(amount) + (st.any ? " · counted " + money(st.total) + " · variance " + signed(st.total - expected) : ""));
      if (note) setText("eod-print-note", note);
      $("settle-note").value = "";
      if (count) count.reset(); /* the counted cash has gone to the vault; keep the printed count lines */
      await paintEod();
    });
    paintEod().catch(fail);
  }

  /* ================================================================== DASHBOARD */
  if (page === "dashboard") {
    var tile = function (id, value, meta) {
      setText(id, value);
      if (meta !== undefined) setText(id + "-meta", meta);
    };
    var noAccess = function (id, err) {
      tile(id, "—", canNot(err) ? "No access" : "Could not load");
      var el = $(id + "-meta");
      if (el && err && !canNot(err)) el.title = err.message || "";
    };
    var safe = function (p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); };
    var dayDiff = function (iso, today) {
      var a = Date.parse(iso + "T00:00:00Z"), b = Date.parse(today + "T00:00:00Z");
      return isNaN(a) || isNaN(b) ? 0 : Math.round((b - a) / 86400000);
    };
    var queue = function (id, res, total, render, empty, link) {
      var box = $(id);
      if (!box) return;
      setText(id + "-count", res.ok ? api.formatNumber(total) : "—");
      if (!res.ok) { box.innerHTML = '<li class="text-muted">' + esc(canNot(res.e) ? "No access" : "Could not load: " + res.e.message) + "</li>"; return; }
      var items = render();
      box.innerHTML = items.length ? items.join("") + (total > items.length ? '<li><a href="' + link + '">All ' + api.formatNumber(total) + " →</a></li>" : "") :
        '<li class="text-muted">' + esc(empty) + "</li>";
    };
    var loadDash = async function () {
      setText("page-sub", "Currency UGX · " + (sess.officeName || "") + " · " + api.todayISO());
      var today = api.todayISO();
      var r = await Promise.all([
        safe(api.get("/clients?status=active&limit=1&offset=0")),
        safe(api.get("/loans?status=300&limit=5000&offset=0")),
        safe(api.get("/savingsaccounts?limit=5000&offset=0&fields=id,status,summary")),
        safe(api.get("/loans?status=100&limit=5&offset=0&orderBy=id&sortOrder=ASC")),
        safe(api.get("/loans?status=200&limit=5&offset=0&orderBy=id&sortOrder=ASC")),
        safe(api.get("/clients?status=pending&limit=5&offset=0&orderBy=id&sortOrder=ASC"))
      ]);
      /* The Portfolio at Risk report (overdue principal ÷ outstanding) is only needed when the loan list is not readable. */
      r[6] = r[1].ok || !api.can(["READ_Portfolio at Risk", "REPORTING_SUPER_USER"]) ? { ok: false, e: r[1].e } :
        await safe(api.get("/runreports/" + encodeURIComponent("Portfolio at Risk") + "?" + new URLSearchParams({
          R_officeId: String(sess.officeId || 1), R_loanOfficerId: "-1", R_currencyId: "-1", R_fundId: "-1",
          R_loanProductId: "-1", R_loanPurposeId: "-1", R_parType: "1", genericResultSet: "false"
        }).toString()));
      /* members */
      if (r[0].ok) tile("kpi-active-members", api.formatNumber(r[0].v.totalFilteredRecords || 0)); else noAccess("kpi-active-members", r[0].e);
      /* loans, outstanding, PAR */
      var parFromList = null;
      if (r[1].ok) {
        var loans = r[1].v.pageItems || [];
        var outstanding = 0, overdueP = 0, par30 = 0, inArrears = 0;
        loans.forEach(function (l) {
          var s = l.summary || {};
          var po = num(s.principalOutstanding);
          outstanding += po;
          overdueP += num(s.principalOverdue);
          var since = s.overdueSinceDate ? api.formatDate(s.overdueSinceDate) : "";
          var days = since ? dayDiff(since, today) : num(l.delinquent && l.delinquent.pastDueDays);
          if (days > 0) inArrears += 1;
          if (days > 30) par30 += po;
        });
        tile("kpi-active-loans", api.formatNumber(r[1].v.totalFilteredRecords || loans.length), inArrears + " in arrears");
        tile("kpi-outstanding", money(outstanding), "Principal outstanding · " + api.formatNumber(loans.length) + " loans");
        parFromList = { par30: outstanding ? par30 * 100 / outstanding : 0, par1: outstanding ? overdueP * 100 / outstanding : 0, at30: par30 };
      } else { noAccess("kpi-active-loans", r[1].e); noAccess("kpi-outstanding", r[1].e); }
      var reportPar = null;
      if (r[6].ok && Array.isArray(r[6].v) && r[6].v.length) {
        var row = r[6].v[0];
        var key = Object.keys(row).filter(function (k) { return /portfolio at risk/i.test(k); })[0];
        var val = key ? parseFloat(row[key]) : NaN;
        if (!isNaN(val)) reportPar = val;
      }
      if (parFromList) {
        tile("kpi-par", parFromList.par30.toFixed(2) + "%", "At risk: " + money(parFromList.at30) + " · overdue principal " + parFromList.par1.toFixed(2) + "% of portfolio");
        var pk = $("kpi-par-card");
        if (pk) pk.classList.toggle("fo-alert", parFromList.par30 > 5);
      } else if (reportPar !== null) {
        tile("kpi-par", reportPar.toFixed(2) + "%", "Overdue principal ÷ outstanding (PAR report, all arrears)");
      } else noAccess("kpi-par", r[1].ok ? r[6].e : r[1].e);
      /* savings */
      var savPending = [];
      if (r[2].ok) {
        var savs = r[2].v.pageItems || [];
        var bal = 0, active = 0;
        savs.forEach(function (s) {
          var sid = s.status && s.status.id;
          if (sid === 300) { active += 1; bal += num(s.summary && s.summary.accountBalance); }
          if (sid === 100 || sid === 200) savPending.push(s);
        });
        tile("kpi-savings", money(bal), api.formatNumber(active) + " active accounts");
      } else noAccess("kpi-savings", r[2].e);
      /* work queues */
      queue("q-loans-pending", r[3], r[3].ok ? r[3].v.totalFilteredRecords : 0, function () {
        return (r[3].v.pageItems || []).map(function (l) {
          return '<li><a href="loan-detail.html?id=' + encodeURIComponent(l.id) + '">' + esc(l.clientName || "") + "</a> · #" + esc(l.accountNo) +
            ' <span class="mono">' + money(l.principal) + "</span>" + ' <span class="text-muted">submitted ' + esc(api.formatDate(l.timeline && l.timeline.submittedOnDate)) + "</span></li>";
        });
      }, "No loans waiting for approval", "loans.html?status=100");
      queue("q-loans-approved", r[4], r[4].ok ? r[4].v.totalFilteredRecords : 0, function () {
        return (r[4].v.pageItems || []).map(function (l) {
          return '<li><a href="loan-detail.html?id=' + encodeURIComponent(l.id) + '">' + esc(l.clientName || "") + "</a> · #" + esc(l.accountNo) +
            ' <span class="mono">' + money(l.approvedPrincipal || l.principal) + "</span>" + ' <span class="text-muted">approved ' + esc(api.formatDate(l.timeline && l.timeline.approvedOnDate)) + "</span></li>";
        });
      }, "No approved loans waiting for disbursement", "loans.html?status=200");
      queue("q-clients-pending", r[5], r[5].ok ? r[5].v.totalFilteredRecords : 0, function () {
        return (r[5].v.pageItems || []).map(function (c) {
          return '<li><a href="client-detail.html?id=' + encodeURIComponent(c.id) + '">' + esc(c.displayName || "#" + c.id) + "</a> · " + esc(c.officeName || "") +
            ' <span class="text-muted">submitted ' + esc(api.formatDate(c.timeline && c.timeline.submittedOnDate)) + "</span></li>";
        });
      }, "No members waiting for activation", "clients.html");
      queue("q-savings-pending", r[2], savPending.length, function () {
        return savPending.slice(0, 5).map(function (s) {
          return '<li><a href="savings-detail.html?id=' + encodeURIComponent(s.id) + '">Savings #' + esc(s.accountNo || s.id) + "</a> · " +
            esc(api.statusLabel(s.status)) + "</li>";
        });
      }, "No savings accounts waiting for approval / activation", "savings.html");
      /* teller cash today (in the background: 1 + tellers + 2 × cashiers small requests) */
      loadCashToday().catch(function (err) { setText("kpi-cash-today", "—"); setText("kpi-cash-today-meta", canNot(err) ? "No access" : "Could not load"); });
      /* recent members */
      var recent = await safe(api.get("/clients?limit=6&offset=0&orderBy=id&sortOrder=DESC"));
      var tb = document.querySelector("#recent-members tbody");
      if (tb) {
        tb.innerHTML = !recent.ok ? api.emptyRow(4, canNot(recent.e) ? "No access" : "Could not load: " + recent.e.message) :
          ((recent.v.pageItems || []).map(function (c) {
            var t = c.timeline || {};
            return '<tr><td class="mono">' + esc(api.formatDate(t.activatedOnDate || t.submittedOnDate)) + '</td><td><a href="client-detail.html?id=' + encodeURIComponent(c.id) + '">' +
              esc(c.displayName || "#" + c.id) + "</a></td><td>" + esc(c.officeName || "—") + '</td><td class="mono text-right">' + esc(c.accountNo || c.id) + "</td></tr>";
          }).join("") || api.emptyRow(4, "No members yet"));
      }
    };
    var loadCashToday = async function () {
      var all = await allDrawers();
      var today = api.todayISO();
      var live = all.drawers.filter(function (d) { return inRange(d.cashier, today); });
      var sums = await Promise.all(live.map(function (d) { return drawer(d.teller.id, d.cashier.id, 200).catch(function () { return null; }); }));
      var tIn = 0, tOut = 0, held = 0;
      sums.forEach(function (s) {
        if (!s) return;
        held += num(s.netCash);
        s.recent.forEach(function (t) {
          if (api.formatDate(t.txnDate) !== today) return;
          var k = txnKind(t);
          if (k === "in") tIn += num(t.txnAmount);
          if (k === "out") tOut += num(t.txnAmount);
        });
      });
      tile("kpi-cash-today", "In " + api.formatNumber(tIn) + " · Out " + api.formatNumber(tOut), "Cash in tills now: " + money(held) + " · " + live.length + " drawer" + (live.length === 1 ? "" : "s"));
    };
    onAction("refresh-dashboard", function () { return loadDash(); });
    loadDash().catch(fail);
  }

  /* ================================================================== OFFICES */
  if (page === "offices") {
    var officesCache = [];
    var staffCache = [];
    var selectedOffice = "";
    var officeDialog = async function (existing) {
      var offices = officesCache.length ? officesCache : await loadOffices();
      var parents = offices.filter(function (o) { return !existing || String(o.id) !== String(existing.id); });
      var fields = [
        { key: "name", label: "Office (branch) name", required: true, value: existing ? existing.name : "", placeholder: "e.g. Kampala Road Branch" }
      ];
      if (!existing || existing.parentId) {
        fields.push({ key: "parentId", label: "Parent office", type: "select", required: true, value: existing ? String(existing.parentId) : (offices[0] ? String(offices[0].id) : ""), options: officeOpts(parents) });
      }
      fields.push(
        { key: "openingDate", label: "Opening date", type: "date", required: true, value: existing ? api.formatDate(existing.openingDate) : api.todayISO(), max: api.todayISO() },
        { key: "externalId", label: "External ID / branch code", value: existing ? existing.externalId || "" : "", placeholder: "optional" }
      );
      return api.openDialog({
        title: existing ? "Edit office · " + existing.name : "Create office (branch)", submitLabel: existing ? "Save" : "Create office",
        fields: fields,
        validate: function (v) { return v.name.trim().length > 100 ? "Office name must be 100 characters or fewer." : ""; },
        onSubmit: function (v) {
          var body = withDate({ name: v.name.trim(), openingDate: v.openingDate });
          if (v.parentId) body.parentId = Number(v.parentId);
          if (v.externalId.trim() || (existing && existing.externalId)) body.externalId = v.externalId.trim() || null;
          return existing ? api.put("/offices/" + encodeURIComponent(existing.id), body) : api.post("/offices", body);
        }
      });
    };
    var paintStaff = function () {
      var list = staffCache.filter(function (s) { return !selectedOffice || String(s.officeId) === String(selectedOffice); });
      var o = officesCache.filter(function (x) { return String(x.id) === String(selectedOffice); })[0];
      setText("staff-title", o ? "Staff · " + o.name : "Staff · all offices");
      document.querySelector("#staff-table tbody").innerHTML = list.map(function (s) {
        return '<tr><td class="strong">' + esc(s.displayName || ((s.firstname || "") + " " + (s.lastname || ""))) + "</td><td>" + esc(s.officeName || "") +
          "</td><td>" + (s.isLoanOfficer ? "Yes" : "No") + "</td><td>" + api.statusBadge(s.isActive ? "Active" : "Inactive") + "</td></tr>";
      }).join("") || api.emptyRow(4, o ? "No staff in " + o.name + " yet." : "No staff yet.");
    };
    var paintHolidays = async function () {
      var tb = document.querySelector("#holidays-table tbody");
      if (!tb) return;
      var oid = selectedOffice || sess.officeId || (officesCache[0] && officesCache[0].id);
      if (!oid) { tb.innerHTML = api.emptyRow(4, "No office"); return; }
      tb.innerHTML = api.loadingRow(4);
      try {
        var list = await api.get("/holidays?officeId=" + encodeURIComponent(oid));
        list = Array.isArray(list) ? list : [];
        tb.innerHTML = list.map(function (h) {
          return '<tr><td class="strong">' + esc(h.name) + "</td><td class=\"mono\">" + esc(api.formatDate(h.fromDate)) + (api.formatDate(h.toDate) !== api.formatDate(h.fromDate) ? " → " + esc(api.formatDate(h.toDate)) : "") +
            '</td><td class="mono">' + esc(h.repaymentsRescheduledTo ? api.formatDate(h.repaymentsRescheduledTo) : "—") + "</td><td>" + api.statusBadge(h.status) + "</td></tr>";
        }).join("") || api.emptyRow(4, "No holidays defined for this office.");
      } catch (err) {
        tb.innerHTML = api.emptyRow(4, canNot(err) ? "No access to holidays" : "Could not load holidays: " + err.message);
      }
    };
    var paintWorkingDays = async function () {
      var el = $("working-days");
      if (!el) return;
      try {
        var wd = await api.get("/workingdays");
        var m = /BYDAY=([A-Z,]+)/.exec(String(wd.recurrence || ""));
        var names = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
        var days = m ? m[1].split(",").map(function (d) { return names[d] || d; }) : [];
        el.innerHTML = '<p><span class="strong">Working days:</span> ' + esc(days.join(", ") || "—") + "</p>" +
          '<p class="text-muted small-note">Repayments due on a non-working day: ' + esc(api.statusLabel(wd.repaymentRescheduleType)) +
          (wd.extendTermForDailyRepayments ? " · daily-loan terms extended" : "") + "</p>";
      } catch (err) {
        el.innerHTML = '<p class="text-muted">' + esc(canNot(err) ? "No access to working days." : "Could not load working days: " + err.message) + "</p>";
      }
    };
    var paintOffices = async function () {
      var res = await Promise.all([loadOffices(), api.get("/staff?status=all").catch(function () { return []; })]);
      officesCache = res[0];
      staffCache = Array.isArray(res[1]) ? res[1] : (res[1].pageItems || []);
      var byParent = {};
      officesCache.forEach(function (o) { var p = o.parentId || 0; (byParent[p] = byParent[p] || []).push(o); });
      var staffCount = {};
      staffCache.forEach(function (s) { staffCount[s.officeId] = (staffCount[s.officeId] || 0) + 1; });
      var canEdit = api.can("UPDATE_OFFICE");
      var branch = function (pid) {
        var kids = byParent[pid] || [];
        if (!kids.length) return "";
        return "<ul" + (pid ? "" : ' class="tree"') + ">" + kids.map(function (o) {
          return '<li><div class="fo-office' + (String(o.id) === String(selectedOffice) ? " active" : "") + '"><button type="button" class="fo-linkbtn" data-office="' + esc(o.id) + '" aria-pressed="' +
            (String(o.id) === String(selectedOffice) ? "true" : "false") + '">' + esc(o.name) + '</button> <span class="text-muted small-note">opened ' + esc(api.formatDate(o.openingDate)) +
            (o.externalId ? " · " + esc(o.externalId) : "") + " · " + (staffCount[o.id] || 0) + " staff</span>" +
            (canEdit ? ' <button type="button" class="btn btn-sm btn-ghost" data-edit-office="' + esc(o.id) + '" aria-label="Edit ' + esc(o.name) + '">Edit</button>' : "") +
            "</div>" + branch(o.id) + "</li>";
        }).join("") + "</ul>";
      };
      setHtml("office-tree", branch(0) || '<p class="text-muted">No offices</p>');
      paintStaff();
    };
    $("office-tree").addEventListener("click", function (e) {
      var pick = e.target.closest("[data-office]");
      if (pick) {
        var id = pick.getAttribute("data-office");
        selectedOffice = String(selectedOffice) === id ? "" : id;
        paintOffices().then(paintHolidays).catch(fail);
        return;
      }
      var ed = e.target.closest("[data-edit-office]");
      if (!ed) return;
      if (ed.getAttribute("aria-busy") === "true") return;
      ed.setAttribute("aria-busy", "true");
      api.get("/offices/" + encodeURIComponent(ed.getAttribute("data-edit-office"))).then(officeDialog).then(function (r) {
        if (r) { api.toast("Office updated", "success"); return paintOffices(); }
      }).catch(fail).then(function () { ed.removeAttribute("aria-busy"); });
    });
    onAction("create-office", async function () {
      var r = await officeDialog(null);
      if (r) { api.toast("Office created", "success"); await paintOffices(); }
    });
    paintOffices().catch(function (err) { fail(err); setHtml("office-tree", '<p class="text-muted">Could not load offices: ' + esc(err.message) + "</p>"); })
      .then(function () { return Promise.all([paintHolidays(), paintWorkingDays()]); }).catch(fail);
  }

  /* ================================================================== ROLES */
  if (page === "roles") {
    var GROUP_LABELS = {
      portfolio: "Members, loans & savings accounts", transaction_loan: "Loan transactions", transaction_savings: "Savings & deposit transactions",
      organisation: "Organisation (offices, staff, products, holidays)", accounting: "Accounting", authorisation: "Users, roles & passwords",
      cash_mgmt: "Teller cash management", report: "Reports", configuration: "System configuration", portfolio_group: "Groups",
      portfolio_center: "Centres", LOAN_PROVISIONING: "Loan provisioning", account_transfer: "Standing instructions",
      collection_sheet: "Collection sheets", jobs: "Scheduler jobs", special: "Special (super user)", transaction_client: "Client transactions",
      SHAREACCOUNT: "Share accounts", SHAREPRODUCT: "Share products", datatable: "Data tables", infrastructure: "Infrastructure",
      loan_reschedule: "Loan rescheduling", SSBENEFICIARYTPT: "Self-service beneficiaries", interop: "Interoperation",
      investor: "Investors", loan_product_attribute: "Loan product attributes", externalservices: "External services", survey: "Surveys"
    };
    var GROUP_ORDER = ["cash_mgmt", "portfolio", "transaction_savings", "transaction_loan", "portfolio_group", "portfolio_center", "transaction_client",
      "report", "accounting", "LOAN_PROVISIONING", "organisation", "authorisation", "configuration", "special"];
    var CLIENT_BASE = ["READ_CLIENT", "READ_CLIENTIDENTIFIER", "READ_CLIENTIMAGE", "READ_CLIENTNOTE", "READ_CLIENTCHARGE", "READ_ADDRESS", "READ_FAMILYMEMBERS", "READ_DOCUMENT",
      "READ_SAVINGSACCOUNT", "READ_SAVINGNOTE", "READ_SAVINGSACCOUNTCHARGE", "READ_LOAN", "READ_LOANNOTE", "READ_GUARANTOR", "READ_COLLATERAL", "READ_GROUP", "READ_CENTER",
      "READ_OFFICE", "READ_STAFF", "READ_PAYMENTTYPE", "READ_CODE", "READ_CODEVALUE", "READ_LOANPRODUCT", "READ_SAVINGSPRODUCT", "READ_CHARGE", "READ_FUND", "READ_CURRENCY",
      "READ_HOLIDAY", "READ_WORKINGDAYS", "READ_CALENDAR", "READ_MEETING", "READ_FIXEDDEPOSITACCOUNT", "READ_RECURRINGDEPOSITACCOUNT", "READ_ACCOUNTTRANSFER", "READTRANSACTION_CLIENT"];
    var ONBOARD = ["CREATE_CLIENT", "UPDATE_CLIENT", "CREATE_CLIENTIDENTIFIER", "UPDATE_CLIENTIDENTIFIER", "CREATE_CLIENTIMAGE", "CREATE_CLIENTNOTE", "CREATE_ADDRESS", "UPDATE_ADDRESS",
      "CREATE_FAMILYMEMBERS", "UPDATE_FAMILYMEMBERS", "CREATE_DOCUMENT"];
    var TELLER_REPORTS = ["READ_REPORT", "READ_Client Saving Transactions", "READ_Savings Transactions", "READ_Client Listing", "READ_Client Savings Summary"];
    var STANDARD_ROLES = [
      { name: "Teller", description: "Front-office cashier: registers members, takes deposits and loan repayments, pays withdrawals from their own drawer.",
        codes: CLIENT_BASE.concat(["CREATE_CLIENT", "UPDATE_CLIENT", "CREATE_CLIENTIDENTIFIER", "CREATE_CLIENTIMAGE", "CREATE_CLIENTNOTE",
          "DEPOSIT_SAVINGSACCOUNT", "WITHDRAWAL_SAVINGSACCOUNT", "REPAYMENT_LOAN", "CREATE_SAVINGNOTE", "CREATE_LOANNOTE"], TELLER_REPORTS) },
      { name: "Loan Officer", description: "Registers members, captures loan applications, guarantors and collateral; cannot approve or disburse.",
        codes: CLIENT_BASE.concat(ONBOARD, ["CREATE_LOAN", "UPDATE_LOAN", "CREATE_GUARANTOR", "UPDATE_GUARANTOR", "DELETE_GUARANTOR", "CREATE_COLLATERAL", "UPDATE_COLLATERAL",
          "CREATE_LOANNOTE", "UPDATE_LOANNOTE", "CREATE_SAVINGSACCOUNT", "CREATE_GROUP", "UPDATE_GROUP", "ASSOCIATECLIENTS_GROUP", "CREATE_LOANCHARGE",
          "READ_REPORT", "READ_Loans Pending Approval", "READ_Portfolio at Risk", "READ_Active Loans - Details", "READ_Active Loans - Summary", "READ_Client Loans Listing",
          "READ_Expected Payments By Date - Basic", "READ_Loan Account Schedule", "READ_Aging Detail"]) },
      { name: "Branch Manager", description: "Approves and disburses loans, approves accounts and members, manages tellers and allocates / settles vault cash; all reports.",
        codes: CLIENT_BASE.concat(ONBOARD, ["ACTIVATE_CLIENT", "REJECT_CLIENT", "WITHDRAW_CLIENT", "CLOSE_CLIENT", "REACTIVATE_CLIENT", "ASSIGNSTAFF_CLIENT",
          "CREATE_LOAN", "UPDATE_LOAN", "APPROVE_LOAN", "REJECT_LOAN", "APPROVALUNDO_LOAN", "DISBURSE_LOAN", "DISBURSETOSAVINGS_LOAN", "DISBURSALUNDO_LOAN", "WITHDRAW_LOAN",
          "UPDATELOANOFFICER_LOAN", "WAIVEINTERESTPORTION_LOAN", "WAIVE_LOANCHARGE", "CREATE_GUARANTOR", "UPDATE_GUARANTOR", "CREATE_COLLATERAL",
          "CREATE_SAVINGSACCOUNT", "UPDATE_SAVINGSACCOUNT", "APPROVE_SAVINGSACCOUNT", "REJECT_SAVINGSACCOUNT", "ACTIVATE_SAVINGSACCOUNT", "APPROVALUNDO_SAVINGSACCOUNT",
          "CLOSE_SAVINGSACCOUNT", "DEPOSIT_SAVINGSACCOUNT", "WITHDRAWAL_SAVINGSACCOUNT", "REPAYMENT_LOAN", "UNDOTRANSACTION_SAVINGSACCOUNT",
          "CREATE_GROUP", "UPDATE_GROUP", "ACTIVATE_GROUP", "ASSOCIATECLIENTS_GROUP",
          "CREATE_TELLER", "UPDATE_TELLER", "ALLOCATECASHIER_TELLER", "UPDATECASHIERALLOCATION_TELLER", "DELETECASHIERALLOCATION_TELLER",
          "ALLOCATECASHTOCASHIER_TELLER", "SETTLECASHFROMCASHIER_TELLER", "READ_STAFF", "READ_USER", "READ_ROLE", "READ_JOURNALENTRY", "READ_GLACCOUNT"]),
        groups: ["report"] },
      { name: "Accountant", description: "Chart of accounts, journal entries, accruals, provisioning, period closures and financial reports.",
        codes: CLIENT_BASE.concat(["READ_JOURNALENTRY", "READ_GLACCOUNT", "READ_GLCLOSURE", "READ_ACCOUNTINGRULE", "READ_FINANCIALACTIVITYACCOUNT"]),
        groups: ["accounting", "LOAN_PROVISIONING", "report"] },
      { name: "Auditor", description: "Read-only access to every record and all reports. Cannot change anything.", reads: true, groups: ["report"] }
    ];

    var allPerms = null;
    var roles = [];
    var editing = null; /* { role, original: {code: bool}, perms: [] } */
    var canPerms = api.can("PERMISSIONS_ROLE");
    var canUpdate = api.can("UPDATE_ROLE");
    var canEnable = api.can(["ENABLE_ROLE", "DISABLE_ROLE"]);

    var ACTION_NAMES = {
      ALLOCATECASHIER: "Assign cashier to", ALLOCATECASHTOCASHIER: "Allocate vault cash to cashier on", SETTLECASHFROMCASHIER: "Settle cashier cash to vault on",
      UPDATECASHIERALLOCATION: "Edit cashier assignment on", DELETECASHIERALLOCATION: "Remove cashier assignment from", APPROVALUNDO: "Undo approval of",
      DISBURSALUNDO: "Undo disbursal of", WITHDRAWAL: "Withdraw from", REPAYMENT: "Repay", ALL_FUNCTIONS: "All functions", ALL_FUNCTIONS_READ: "Read everything",
      READTRANSACTION: "Read transactions of", UNDOTRANSACTION: "Undo transaction on", PROPOSETRANSFER: "Propose transfer of", ACCEPTTRANSFER: "Accept transfer of",
      ASSIGNSTAFF: "Assign staff to", UNASSIGNSTAFF: "Unassign staff from", ASSOCIATECLIENTS: "Add members to", DISASSOCIATECLIENTS: "Remove members from",
      UPDATELOANOFFICER: "Change loan officer of", WAIVEINTERESTPORTION: "Waive interest on", DISBURSETOSAVINGS: "Disburse to savings:"
    };
    var ENTITY_NAMES = {
      TELLER: "teller (till)", SAVINGSACCOUNT: "savings account", LOAN: "loan", CLIENT: "member (client)", CLIENTIDENTIFIER: "member ID document",
      CLIENTIMAGE: "member photo", CLIENTNOTE: "member note", GLACCOUNT: "GL account", GLCLOSURE: "period closure", JOURNALENTRY: "journal entry",
      LOANCHARGE: "loan charge", SAVINGSACCOUNTCHARGE: "savings charge", USER: "user", ROLE: "role", STAFF: "staff", OFFICE: "office", PAYMENTTYPE: "payment type"
    };
    var humanize = function (p) {
      if (p.grouping === "report") return String(p.entityName || p.code).replace(/^READ_/, "");
      var checker = /_CHECKER$/.test(p.code);
      var rawAction = String(p.actionName || "").replace(/_CHECKER$/, "");
      var action = ACTION_NAMES[rawAction] || ACTION_NAMES[p.code] || rawAction.replace(/_/g, " ").toLowerCase();
      var entity = ENTITY_NAMES[p.entityName] || String(p.entityName || "").replace(/_/g, " ").toLowerCase();
      var text = (action.charAt(0).toUpperCase() + action.slice(1)) + (entity && !ACTION_NAMES[p.code] ? " " + entity : "");
      return checker ? "Approve (checker): " + text : text;
    };
    var loadAllPerms = async function () {
      if (!allPerms) {
        var list = await api.get("/permissions?makerCheckerable=false");
        allPerms = Array.isArray(list) ? list : [];
      }
      return allPerms;
    };
    var standardCodes = function (def, perms) {
      var exists = {};
      perms.forEach(function (p) { exists[p.code] = p; });
      var want = (def.codes || []).slice();
      perms.forEach(function (p) {
        if ((def.groups || []).indexOf(p.grouping) >= 0 && !/_CHECKER$/.test(p.code)) want.push(p.code);
        if (def.reads && (/^READ/.test(p.code)) && !/_CHECKER$/.test(p.code)) want.push(p.code);
      });
      var ok = [], missing = [];
      want.forEach(function (c) {
        if (exists[c]) { if (ok.indexOf(c) < 0) ok.push(c); }
        else if (missing.indexOf(c) < 0) missing.push(c);
      });
      return { ok: ok, missing: missing };
    };

    var paintRoles = async function () {
      var list = await api.get("/roles");
      roles = Array.isArray(list) ? list : [];
      var tb = document.querySelector("#roles-table tbody");
      tb.innerHTML = roles.map(function (r) {
        return '<tr><td class="strong">' + esc(r.name) + "</td><td>" + esc(r.description || "—") + "</td><td>" + api.statusBadge(r.disabled ? "Disabled" : "Active") +
          '</td><td class="btn-group">' +
          '<button type="button" class="btn btn-sm" data-role-perms="' + esc(r.id) + '">' + (canPerms ? "Permissions" : "View permissions") + "</button>" +
          (canUpdate ? '<button type="button" class="btn btn-sm btn-ghost" data-role-edit="' + esc(r.id) + '">Rename</button>' : "") +
          (canEnable && r.id !== 1 ? '<button type="button" class="btn btn-sm btn-ghost" data-role-toggle="' + esc(r.id) + '">' + (r.disabled ? "Enable" : "Disable") + "</button>" : "") +
          "</td></tr>";
      }).join("") || api.emptyRow(4, "No roles");
    };

    var roleDialog = function (existing) {
      return api.openDialog({
        title: existing ? "Rename role · " + existing.name : "Create role", submitLabel: existing ? "Save" : "Create role",
        message: existing ? "" : "After creating the role, choose its permissions.",
        fields: [
          { key: "name", label: "Role name", required: true, value: existing ? existing.name : "", placeholder: "e.g. Teller" },
          { key: "description", label: "Description", type: "textarea", required: true, value: existing ? existing.description || "" : "" }
        ],
        validate: function (v) {
          if (v.name.trim().length > 100) return "Role name must be 100 characters or fewer.";
          var clash = roles.filter(function (r) { return r.name.toLowerCase() === v.name.trim().toLowerCase() && (!existing || r.id !== existing.id); })[0];
          return clash ? "A role named “" + clash.name + "” already exists." : "";
        },
        onSubmit: function (v) {
          var body = { name: v.name.trim(), description: v.description.trim() };
          return existing ? api.put("/roles/" + encodeURIComponent(existing.id), body) : api.post("/roles", body);
        }
      });
    };

    /* ---------- permission editor ---------- */
    var editor = $("perm-editor");
    var permBody = $("perm-groups");
    var filterIn = $("perm-filter");
    var onlySel = $("perm-only-selected");
    var paintPermCount = function () {
      if (!editing) return;
      var boxes = permBody.querySelectorAll("input[data-code]");
      var n = 0, changed = 0;
      boxes.forEach(function (b) {
        if (b.checked) n += 1;
        if (b.checked !== !!editing.original[b.getAttribute("data-code")]) changed += 1;
      });
      setText("perm-count", n + " granted" + (changed ? " · " + changed + " unsaved change" + (changed === 1 ? "" : "s") : ""));
      permBody.querySelectorAll("details[data-group]").forEach(function (d) {
        var all = d.querySelectorAll("input[data-code]");
        var on = d.querySelectorAll("input[data-code]:checked");
        var c = d.querySelector(".perm-group-count");
        if (c) c.textContent = on.length + " / " + all.length;
      });
      var save = $("perm-save");
      if (save) save.disabled = !changed || !canPerms;
    };
    var applyFilter = function () {
      var q = (filterIn.value || "").trim().toLowerCase();
      var only = onlySel.checked;
      var checkers = $("perm-show-checker") && $("perm-show-checker").checked;
      permBody.querySelectorAll("details[data-group]").forEach(function (d) {
        var shown = 0;
        d.querySelectorAll("label[data-row]").forEach(function (l) {
          var box = l.querySelector("input");
          var hit = (!q || l.getAttribute("data-row").indexOf(q) >= 0) && (!only || box.checked) &&
            (checkers || box.checked || !/_CHECKER$/.test(box.getAttribute("data-code")));
          l.hidden = !hit;
          if (hit) shown += 1;
        });
        d.hidden = !shown;
        if (q && shown) d.open = true;
      });
    };
    var openEditor = async function (roleId) {
      var res = await Promise.all([api.get("/roles/" + encodeURIComponent(roleId) + "/permissions"), loadAllPerms()]);
      var data = res[0];
      var perms = (data.permissionUsageData || []).slice();
      var known = {};
      perms.forEach(function (p) { known[p.code] = true; });
      res[1].forEach(function (p) { if (!known[p.code]) perms.push(Object.assign({}, p, { selected: false })); });
      var original = {};
      perms.forEach(function (p) { original[p.code] = !!p.selected; });
      editing = { role: roles.filter(function (r) { return String(r.id) === String(roleId); })[0] || { id: roleId, name: data.name }, original: original };
      var groups = {};
      perms.forEach(function (p) { (groups[p.grouping] = groups[p.grouping] || []).push(p); });
      var order = GROUP_ORDER.filter(function (g) { return groups[g]; }).concat(Object.keys(groups).filter(function (g) { return GROUP_ORDER.indexOf(g) < 0; }).sort());
      var dis = canPerms ? "" : " disabled";
      permBody.innerHTML = order.map(function (g, gi) {
        var items = groups[g].slice().sort(function (a, b) { return humanize(a).localeCompare(humanize(b)); });
        return '<details data-group="' + esc(g) + '"' + (gi === 0 ? " open" : "") + '><summary><span class="strong">' + esc(GROUP_LABELS[g] || g) + '</span> <span class="perm-group-count text-muted"></span></summary>' +
          (canPerms ? '<div class="btn-group perm-group-actions"><button type="button" class="btn btn-sm btn-ghost" data-group-all="' + esc(g) + '">Select all</button>' +
            '<button type="button" class="btn btn-sm btn-ghost" data-group-none="' + esc(g) + '">Clear</button>' +
            '<button type="button" class="btn btn-sm btn-ghost" data-group-read="' + esc(g) + '">Read-only</button></div>' : "") +
          '<div class="perm-grid">' + items.map(function (p, i) {
            var id = "perm-" + gi + "-" + i;
            var hay = (p.code + " " + humanize(p)).toLowerCase();
            return '<label class="perm-item" for="' + id + '" data-row="' + esc(hay) + '"><input type="checkbox" id="' + id + '" data-code="' + esc(p.code) + '"' + (p.selected ? " checked" : "") + dis + " />" +
              '<span><span class="perm-name">' + esc(humanize(p)) + '</span><span class="perm-code mono">' + esc(p.code) + "</span></span></label>";
          }).join("") + "</div></details>";
      }).join("");
      setText("perm-title", "Permissions · " + (editing.role.name || data.name));
      editor.hidden = false;
      filterIn.value = "";
      onlySel.checked = false;
      applyFilter();
      paintPermCount();
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
      $("perm-title").focus();
    };
    permBody.addEventListener("change", paintPermCount);
    permBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-group-all],[data-group-none],[data-group-read]");
      if (!b) return;
      var g = b.getAttribute("data-group-all") || b.getAttribute("data-group-none") || b.getAttribute("data-group-read");
      var mode = b.hasAttribute("data-group-all") ? "all" : (b.hasAttribute("data-group-none") ? "none" : "read");
      permBody.querySelectorAll('details[data-group="' + g + '"] label[data-row]').forEach(function (l) {
        if (l.hidden) return;
        var box = l.querySelector("input");
        var code = box.getAttribute("data-code");
        box.checked = mode === "all" ? true : (mode === "none" ? false : /^READ/.test(code));
      });
      paintPermCount();
    });
    filterIn.addEventListener("input", applyFilter);
    onlySel.addEventListener("change", applyFilter);
    if ($("perm-show-checker")) $("perm-show-checker").addEventListener("change", applyFilter);
    $("perm-cancel").addEventListener("click", function () { editor.hidden = true; editing = null; });
    on($("perm-save"), async function () {
      if (!editing) return;
      var changes = {};
      var added = [], removed = [];
      permBody.querySelectorAll("input[data-code]").forEach(function (b) {
        var code = b.getAttribute("data-code");
        if (b.checked !== !!editing.original[code]) {
          changes[code] = b.checked;
          (b.checked ? added : removed).push(code);
        }
      });
      if (!added.length && !removed.length) return;
      if (String(editing.role.id) === "1" && removed.indexOf("ALL_FUNCTIONS") >= 0) {
        throw new Error("The Super user role must keep ALL_FUNCTIONS, or nobody may be able to administer the system.");
      }
      var ok = await api.confirmDialog({
        title: "Save permissions", summary: editing.role.name,
        lines: [["Granted", String(added.length)], ["Removed", String(removed.length)]].concat(
          added.slice(0, 6).map(function (c) { return ["+", c]; }), removed.slice(0, 6).map(function (c) { return ["−", c]; })),
        note: "Users with this role get the new permissions the next time they sign in.",
        confirmLabel: "Save permissions",
        onConfirm: function () { return api.put("/roles/" + encodeURIComponent(editing.role.id) + "/permissions", { permissions: changes }); }
      });
      if (!ok) return;
      api.toast("Permissions saved for " + editing.role.name, "success");
      await openEditor(editing.role.id);
    });

    $("roles-table").addEventListener("click", function (e) {
      var p = e.target.closest("[data-role-perms]");
      var ed = e.target.closest("[data-role-edit]");
      var tg = e.target.closest("[data-role-toggle]");
      var btn = p || ed || tg;
      if (!btn || btn.getAttribute("aria-busy") === "true") return;
      btn.setAttribute("aria-busy", "true");
      var work;
      if (p) work = openEditor(p.getAttribute("data-role-perms"));
      else if (ed) {
        var role = roles.filter(function (r) { return String(r.id) === ed.getAttribute("data-role-edit"); })[0];
        work = roleDialog(role).then(function (r) { if (r) { api.toast("Role updated", "success"); return paintRoles(); } });
      } else {
        var rr = roles.filter(function (r) { return String(r.id) === tg.getAttribute("data-role-toggle"); })[0];
        var cmd = rr.disabled ? "enable" : "disable";
        work = api.confirmDialog({
          title: (rr.disabled ? "Enable" : "Disable") + " role", summary: rr.name,
          lines: [["Role", rr.name], ["Action", rr.disabled ? "Enable" : "Disable"]],
          note: rr.disabled ? "Users with this role regain its permissions." : "Fineract refuses to disable a role that is still assigned to users — remove it from those users first.",
          confirmLabel: rr.disabled ? "Enable role" : "Disable role",
          onConfirm: function () { return api.post("/roles/" + encodeURIComponent(rr.id) + "?command=" + cmd, {}); }
        }).then(function (ok) { if (ok) { api.toast("Role " + cmd + "d", "success"); return paintRoles(); } });
      }
      Promise.resolve(work).catch(fail).then(function () { btn.removeAttribute("aria-busy"); });
    });

    onAction("create-role", async function () {
      var r = await roleDialog(null);
      if (!r) return;
      api.toast("Role created — now choose its permissions", "success");
      await paintRoles();
      if (r.resourceId && canPerms) await openEditor(r.resourceId);
    });

    onAction("create-standard-roles", async function () {
      var perms = await loadAllPerms();
      var plan = STANDARD_ROLES.map(function (def) {
        var existing = roles.filter(function (r) { return r.name.toLowerCase() === def.name.toLowerCase(); })[0];
        var codes = standardCodes(def, perms);
        return { def: def, existing: existing, codes: codes };
      });
      var ok = await api.confirmDialog({
        title: "Create standard SACCO roles",
        message: "Creates the roles below with permissions checked against this Fineract server. Roles that already exist keep their current permissions and only get the missing standard ones added.",
        summary: "Roles", lines: plan.map(function (p) {
          return [p.def.name, (p.existing ? "exists — add missing" : "create") + " · " + p.codes.ok.length + " permissions"];
        }),
        note: "Teller: counter cash only (no allocate / settle). Loan Officer: applications, no approval. Branch Manager: approvals, disbursement, vault cash. Accountant: accounting. Auditor: read-only.",
        confirmLabel: "Create roles"
      });
      if (!ok) return;
      var done = [], problems = [];
      for (var i = 0; i < plan.length; i++) {
        var p = plan[i];
        try {
          var id = p.existing && p.existing.id;
          var grant = p.codes.ok;
          if (!id) {
            var res = await api.post("/roles", { name: p.def.name, description: p.def.description });
            id = res.resourceId;
          } else {
            var cur = await api.get("/roles/" + encodeURIComponent(id) + "/permissions");
            var have = {};
            (cur.permissionUsageData || []).forEach(function (x) { if (x.selected) have[x.code] = true; });
            grant = grant.filter(function (c) { return !have[c]; });
          }
          if (grant.length) {
            var body = {};
            grant.forEach(function (c) { body[c] = true; });
            await api.put("/roles/" + encodeURIComponent(id) + "/permissions", { permissions: body });
          }
          done.push(p.def.name + (p.existing ? " (+" + grant.length + ")" : ""));
          if (p.codes.missing.length) problems.push(p.def.name + ": skipped unknown " + p.codes.missing.join(", "));
        } catch (err) {
          problems.push(p.def.name + ": " + (err.message || err));
        }
      }
      await paintRoles();
      api.toast("Standard roles ready: " + done.join(", "), "success");
      if (problems.length) notice("roles-notice", "warn", "<strong>Some permissions were not granted:</strong><br>" + problems.map(esc).join("<br>"));
      else notice("roles-notice", "ok", "Standard roles are ready. Assign them to users on the <a href=\"users.html\">Users</a> page.");
    });

    paintRoles().catch(function (err) {
      fail(err);
      document.querySelector("#roles-table tbody").innerHTML = api.emptyRow(4, "Could not load roles: " + err.message);
    });
  }
})();
