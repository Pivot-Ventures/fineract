/* Pivot SACCO Desk — write actions against live Fineract */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;
  var page = document.body.getAttribute("data-page") || "";
  var CTX = "pivot_teller_ctx";
  var CCY = "UGX";
  function ctx() {
    try { return JSON.parse(sessionStorage.getItem(CTX) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveCtx(patch) {
    var next = Object.assign(ctx(), patch || {});
    sessionStorage.setItem(CTX, JSON.stringify(next));
    return next;
  }
  function moneyPayload(amount, date, note) {
    return { locale: "en", dateFormat: "yyyy-MM-dd", txnDate: date || api.todayISO(), txnAmount: String(amount), currencyCode: CCY, txnNote: note || "" };
  }
  function cardByHeading(fragment) {
    var want = fragment.toLowerCase();
    var nodes = document.querySelectorAll(".card-h h2, h2");
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].textContent || "").trim().toLowerCase().indexOf(want) >= 0) return nodes[i].closest(".card");
    }
    return null;
  }
  function on(btn, fn) {
    if (!btn) return;
    api.markWired(btn);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      Promise.resolve(fn(btn)).catch(function (err) { api.toast(err.message || String(err), "error"); });
    });
  }
  function buttonsNamed(name) {
    return Array.prototype.filter.call(document.querySelectorAll("[data-mock]"), function (b) { return b.getAttribute("data-mock") === name; });
  }
  function txnRows(items) {
    if (!items || !items.length) return '<tr><td colspan="5">No cashier transactions yet</td></tr>';
    return items.map(function (t) {
      var type = (t.txnType && (t.txnType.value || t.txnType)) || "—";
      var id = t.txnType && t.txnType.id;
      var inn = (id === 101 || id === 103) ? api.formatMoney(t.txnAmount) : "—";
      var out = (id === 102 || id === 104) ? api.formatMoney(t.txnAmount) : "—";
      var when = t.createdDate ? String(t.createdDate).replace("T", " ").slice(0, 16) : api.formatDate(t.txnDate);
      return "<tr><td class=\"mono\">" + api.escapeHtml(when) + "</td><td>" + api.escapeHtml(String(type)) + "</td><td>" + api.escapeHtml(t.txnNote || "—") + "</td><td class=\"mono text-right\">" + inn + "</td><td class=\"mono text-right\">" + out + "</td></tr>";
    }).join("");
  }
  async function loadOffices() {
    var offices = await api.get("/offices");
    return Array.isArray(offices) ? offices : [];
  }
  async function ensureSession() {
    var c = ctx();
    var tellers = await api.get("/tellers");
    if (!Array.isArray(tellers) || !tellers.length) throw new Error("No tellers — create one under Tellers and cashiers");
    var tid = api.qs("tellerId") || c.tellerId || tellers[0].id;
    var pack = await api.get("/tellers/" + tid + "/cashiers");
    var list = pack.cashiers || [];
    if (!list.length) throw new Error("Teller has no cashier. Assign one on the teller page.");
    var cid = api.qs("cashierId") || c.cashierId || list[0].id;
    var cashier = list.filter(function (x) { return String(x.id) === String(cid); })[0] || list[0];
    var teller = tellers.filter(function (t) { return String(t.id) === String(tid); })[0] || tellers[0];
    return saveCtx({ tellerId: teller.id, tellerName: teller.name, officeId: teller.officeId, cashierId: cashier.id, cashierName: cashier.staffName, staffId: cashier.staffId });
  }
  async function summary(tellerId, cashierId) {
    return api.get("/tellers/" + tellerId + "/cashiers/" + cashierId + "/summaryandtransactions?currencyCode=" + CCY + "&limit=50");
  }
  var STATUS_OPTS = [
    { value: "100", label: "Pending (100)" },
    { value: "300", label: "Active (300)" },
    { value: "400", label: "Inactive (400)" },
    { value: "600", label: "Closed (600)" }
  ];
  var STATUS_MAP = { PENDING: "100", ACTIVE: "300", INACTIVE: "400", CLOSED: "600" };

  if (page === "tellers") {
    api.claimMocks(["Create teller", "Edit teller"]);
    var selectedId = null;
    var tbody = document.querySelector("#tellers-table tbody");
    var officeFilter = document.querySelector(".filters select");
    async function reload() {
      var pair = await Promise.all([api.get("/tellers"), loadOffices()]);
      var tellers = Array.isArray(pair[0]) ? pair[0] : [];
      var offices = pair[1];
      if (officeFilter) {
        var cur = officeFilter.value;
        officeFilter.innerHTML = '<option value="">All offices</option>' + offices.map(function (o) {
          return '<option value="' + o.id + '">' + api.escapeHtml(o.name) + "</option>";
        }).join("");
        if (cur) officeFilter.value = cur;
      }
      var oid = officeFilter && officeFilter.value;
      var rows = tellers.filter(function (t) { return !oid || String(t.officeId) === String(oid); });
      if (tbody) {
        tbody.innerHTML = rows.map(function (t) {
          var st = String(t.status || "—");
          return '<tr data-id="' + t.id + '"><td class="strong"><a href="teller-detail.html?id=' + t.id + '">' + api.escapeHtml(t.name) + "</a></td><td>" +
            api.escapeHtml(t.officeName || "") + "</td><td>" + api.escapeHtml(t.description || "—") + '</td><td><span class="status ' +
            (st.toLowerCase() === "active" ? "open" : "closed") + '">' + api.escapeHtml(st) + '</span></td><td class="mono">—</td><td><a class="btn btn-sm" href="teller-detail.html?id=' + t.id + '">Open</a></td></tr>';
        }).join("") || '<tr><td colspan="6">No tellers. Use Create teller.</td></tr>';
        tbody.querySelectorAll("tr[data-id]").forEach(function (tr) {
          tr.addEventListener("click", function () {
            selectedId = tr.getAttribute("data-id");
            tbody.querySelectorAll("tr").forEach(function (r) { r.style.outline = ""; });
            tr.style.outline = "2px solid #0E6B66";
          });
        });
      }
      api.setLiveBanner(true, "LIVE — GET /tellers · POST /tellers (status 300 = ACTIVE)");
    }
    if (officeFilter) officeFilter.addEventListener("change", function () { reload().catch(function (e) { api.toast(e.message, "error"); }); });
    buttonsNamed("Create teller").forEach(function (btn) {
      on(btn, async function () {
        var offices = await loadOffices();
        var v = await api.openDialog({
          title: "Create teller", submitLabel: "Create",
          fields: [
            { key: "name", label: "Teller name", value: "" },
            { key: "description", label: "Description", value: "Counter teller" },
            { key: "officeId", label: "Office", type: "select", value: "2", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
            { key: "startDate", label: "Start date", type: "date", value: api.todayISO() },
            { key: "status", label: "Status", type: "select", value: "300", options: STATUS_OPTS }
          ]
        });
        if (!v || !String(v.name || "").trim()) return;
        var res = await api.post("/tellers", {
          officeId: Number(v.officeId), name: v.name.trim(), description: v.description || "",
          status: Number(v.status), locale: "en", dateFormat: "yyyy-MM-dd", startDate: v.startDate || api.todayISO()
        });
        api.toast("Teller created #" + (res.resourceId || ""), "success");
        saveCtx({ tellerId: res.resourceId, officeId: Number(v.officeId), tellerName: v.name.trim() });
        await reload();
      });
    });
    buttonsNamed("Edit teller").forEach(function (btn) {
      on(btn, async function () {
        if (!selectedId) { api.toast("Click a teller row first, then Edit", "error"); return; }
        var teller = await api.get("/tellers/" + selectedId);
        var offices = await loadOffices();
        var v = await api.openDialog({
          title: "Edit teller #" + selectedId, submitLabel: "Save",
          fields: [
            { key: "name", label: "Teller name", value: teller.name || "" },
            { key: "description", label: "Description", value: teller.description || "" },
            { key: "officeId", label: "Office", type: "select", value: String(teller.officeId || ""), options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
            { key: "startDate", label: "Start date", type: "date", value: api.formatDate(teller.startDate) },
            { key: "status", label: "Status", type: "select", value: STATUS_MAP[teller.status] || "300", options: STATUS_OPTS }
          ]
        });
        if (!v) return;
        await api.put("/tellers/" + selectedId, {
          officeId: Number(v.officeId), name: v.name.trim(), description: v.description || "",
          status: Number(v.status), locale: "en", dateFormat: "yyyy-MM-dd", startDate: v.startDate
        });
        api.toast("Teller updated", "success");
        await reload();
      });
    });
    reload().catch(function (err) { api.setLiveBanner(false, err.message); api.toast(err.message, "error"); });
  }

  if (page === "teller-detail") {
    api.claimMocks(["Edit teller", "Create cashier", "Allocate cash", "POST allocate", "Edit cashier", "View cashier txns"]);
    var tellerId = api.qs("id");
    async function paintTxns(cashierId) {
      var sum = await summary(tellerId, cashierId);
      var items = (sum.cashierTransactions && sum.cashierTransactions.pageItems) || [];
      var tables = document.querySelectorAll("table.data");
      var txnTable = tables[1];
      if (txnTable && txnTable.querySelector("tbody")) {
        txnTable.querySelector("tbody").innerHTML = items.map(function (t) {
          return "<tr><td>" + api.formatDate(t.txnDate) + "</td><td>" + api.escapeHtml((t.txnType && t.txnType.value) || "—") + '</td><td class="mono text-right">' + api.formatMoney(t.txnAmount) + "</td></tr>";
        }).join("") || '<tr><td colspan="3">No transactions</td></tr>';
      }
    }
    async function editCashier(cashierId) {
      var cur = await api.get("/tellers/" + tellerId + "/cashiers/" + cashierId);
      var tmpl = await api.get("/tellers/" + tellerId + "/cashiers/template");
      var staff = tmpl.staffOptions || [];
      if (!staff.some(function (s) { return String(s.id) === String(cur.staffId); })) staff = [{ id: cur.staffId, displayName: cur.staffName }].concat(staff);
      var v = await api.openDialog({
        title: "Edit cashier #" + cashierId, submitLabel: "Save",
        fields: [
          { key: "staffId", label: "Staff", type: "select", value: String(cur.staffId), options: staff.map(function (s) { return { value: s.id, label: s.displayName }; }) },
          { key: "description", label: "Description", value: cur.description || "" },
          { key: "startDate", label: "From", type: "date", value: api.formatDate(cur.startDate) },
          { key: "endDate", label: "To", type: "date", value: api.formatDate(cur.endDate) },
          { key: "isFullDay", label: "Full day", type: "select", value: cur.isFullDay ? "true" : "false", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] }
        ]
      });
      if (!v) return;
      var body = { staffId: Number(v.staffId), description: v.description || "", isFullDay: v.isFullDay === "true", locale: "en", dateFormat: "yyyy-MM-dd", startDate: v.startDate, endDate: v.endDate };
      if (!body.isFullDay) { body.hourStartTime = "09"; body.minStartTime = "00"; body.hourEndTime = "17"; body.minEndTime = "00"; }
      await api.put("/tellers/" + tellerId + "/cashiers/" + cashierId, body);
      api.toast("Cashier updated", "success");
      await paint();
    }
    async function paint() {
      if (!tellerId) {
        var all = await api.get("/tellers");
        if (Array.isArray(all) && all[0]) tellerId = all[0].id;
      }
      if (!tellerId) throw new Error("No teller id");
      var teller = await api.get("/tellers/" + tellerId);
      saveCtx({ tellerId: teller.id, tellerName: teller.name, officeId: teller.officeId });
      var h1 = document.querySelector(".page-header h1");
      if (h1) h1.textContent = teller.name || ("Teller " + tellerId);
      var sub = document.querySelector(".page-sub");
      if (sub) sub.textContent = (teller.officeName || "") + " · status " + (teller.status || "") + " · id " + teller.id;
      var head = document.querySelector(".profile-head h2");
      if (head) head.innerHTML = api.escapeHtml(teller.name || "") + ' <span class="status ' + (teller.status === "ACTIVE" ? "open" : "closed") + '">' + api.escapeHtml(teller.status || "") + "</span>";
      var muted = document.querySelector(".profile-head .text-muted");
      if (muted) muted.textContent = "Office: " + (teller.officeName || teller.officeId) + " · POST status uses 300 = ACTIVE";
      var pack = await api.get("/tellers/" + tellerId + "/cashiers");
      var list = pack.cashiers || [];
      var tbody = document.querySelector("table.data tbody");
      if (tbody) {
        tbody.innerHTML = list.map(function (c) {
          return '<tr><td class="strong">' + api.escapeHtml(c.staffName || String(c.staffId)) + "</td><td>" + api.formatDate(c.startDate) + "</td><td>" + api.formatDate(c.endDate) + "</td><td>" + (c.isFullDay ? "Yes" : "No") + '</td><td><span class="status open">Assigned</span></td><td class="btn-group">' +
            '<button class="btn btn-sm" type="button" data-act="alloc" data-cashier="' + c.id + '">Allocate</button>' +
            '<a class="btn btn-sm btn-ghost" href="cashier-eod.html?tellerId=' + tellerId + "&cashierId=" + c.id + '">Settle</a>' +
            '<button class="btn btn-sm btn-ghost" type="button" data-act="editc" data-cashier="' + c.id + '">Edit</button>' +
            '<a class="btn btn-sm btn-ghost" href="teller.html?tellerId=' + tellerId + "&cashierId=" + c.id + '">Desk</a></td></tr>';
        }).join("") || '<tr><td colspan="6">No cashiers — assign one</td></tr>';
        tbody.querySelectorAll("[data-act=alloc]").forEach(function (b) {
          b.addEventListener("click", function () {
            saveCtx({ tellerId: Number(tellerId), cashierId: Number(b.getAttribute("data-cashier")) });
            var card = cardByHeading("Allocate cash");
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
            api.toast("Cashier #" + b.getAttribute("data-cashier") + " selected", "success");
          });
        });
        tbody.querySelectorAll("[data-act=editc]").forEach(function (b) {
          b.addEventListener("click", function () { editCashier(Number(b.getAttribute("data-cashier"))).catch(function (e) { api.toast(e.message, "error"); }); });
        });
      }
      var known = list.some(function (c) { return String(c.id) === String(ctx().cashierId); });
      var cashierId = known ? ctx().cashierId : (list[0] && list[0].id);
      if (cashierId) {
        var match = list.filter(function (c) { return String(c.id) === String(cashierId); })[0] || {};
        saveCtx({ cashierId: cashierId, cashierName: match.staffName });
        await paintTxns(cashierId);
      }
      api.setLiveBanner(true, "LIVE — /tellers/" + tellerId + " · cashiers · /allocate");
    }
    buttonsNamed("Edit teller").forEach(function (btn) {
      on(btn, async function () {
        var teller = await api.get("/tellers/" + tellerId);
        var offices = await loadOffices();
        var v = await api.openDialog({
          title: "Edit teller", submitLabel: "Save",
          fields: [
            { key: "name", label: "Name", value: teller.name || "" },
            { key: "description", label: "Description", value: teller.description || "" },
            { key: "officeId", label: "Office", type: "select", value: String(teller.officeId), options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
            { key: "startDate", label: "Start date", type: "date", value: api.formatDate(teller.startDate) },
            { key: "status", label: "Status", type: "select", value: STATUS_MAP[teller.status] || "300", options: STATUS_OPTS }
          ]
        });
        if (!v) return;
        await api.put("/tellers/" + tellerId, { officeId: Number(v.officeId), name: v.name.trim(), description: v.description || "", status: Number(v.status), locale: "en", dateFormat: "yyyy-MM-dd", startDate: v.startDate });
        api.toast("Teller updated", "success");
        await paint();
      });
    });
    buttonsNamed("Create cashier").forEach(function (btn) {
      on(btn, async function () {
        var tmpl = await api.get("/tellers/" + tellerId + "/cashiers/template");
        var staff = tmpl.staffOptions || [];
        if (!staff.length) { api.toast("No free staff for this office (cashier template staffOptions is empty)", "error"); return; }
        var v = await api.openDialog({
          title: "Assign cashier", submitLabel: "Assign",
          fields: [
            { key: "staffId", label: "Staff", type: "select", options: staff.map(function (s) { return { value: s.id, label: s.displayName }; }) },
            { key: "description", label: "Description", value: "Day cashier" },
            { key: "startDate", label: "From", type: "date", value: api.todayISO() },
            { key: "endDate", label: "To", type: "date", value: "2027-12-31" },
            { key: "isFullDay", label: "Full day", type: "select", value: "true", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] }
          ]
        });
        if (!v) return;
        var body = { staffId: Number(v.staffId), description: v.description || "", isFullDay: v.isFullDay !== "false", locale: "en", dateFormat: "yyyy-MM-dd", startDate: v.startDate, endDate: v.endDate };
        if (!body.isFullDay) { body.hourStartTime = "09"; body.minStartTime = "00"; body.hourEndTime = "17"; body.minEndTime = "00"; }
        var res = await api.post("/tellers/" + tellerId + "/cashiers", body);
        api.toast("Cashier assigned" + (res.subResourceId ? " #" + res.subResourceId : ""), "success");
        if (res.subResourceId) saveCtx({ tellerId: Number(tellerId), cashierId: res.subResourceId });
        await paint();
      });
    });
    buttonsNamed("POST allocate").forEach(function (btn) {
      on(btn, async function () {
        var c = ctx();
        if (!c.cashierId) throw new Error("Select a cashier row (Allocate) first");
        var card = cardByHeading("Allocate cash");
        var inputs = card ? card.querySelectorAll("input") : [];
        var amount = api.parseAmount(inputs[0] && inputs[0].value);
        var date = (inputs[1] && inputs[1].value) || api.todayISO();
        var note = (inputs[2] && inputs[2].value) || "Vault allocation";
        if (!amount || amount <= 0) throw new Error("Enter an allocate amount");
        var res = await api.post("/tellers/" + tellerId + "/cashiers/" + c.cashierId + "/allocate", moneyPayload(amount, date, note));
        api.toast("Allocated " + api.formatMoney(amount) + " (txn #" + (res.subResourceId || res.resourceId || "") + ")", "success");
        await paintTxns(c.cashierId);
      });
    });
    paint().catch(function (err) { api.setLiveBanner(false, err.message); api.toast(err.message, "error"); });
  }

  if (page === "teller") {
    api.claimMocks(["Open teller session", "Allocate cash", "Allocate", "Settle", "Cash in", "Cash out", "Repay", "Deposit", "Withdraw", "Shares", "Search"]);
    function kpiSet(label, value, meta) {
      document.querySelectorAll(".kpi-card").forEach(function (card) {
        var lab = card.querySelector(".kpi-label");
        if (lab && lab.textContent.toLowerCase().indexOf(label) >= 0) {
          var val = card.querySelector(".kpi-value");
          if (val) val.textContent = value;
          var m = card.querySelector(".kpi-meta");
          if (m && meta) m.textContent = meta;
        }
      });
    }
    async function paintDesk() {
      var c = await ensureSession();
      var sum = await summary(c.tellerId, c.cashierId);
      var items = (sum.cashierTransactions && sum.cashierTransactions.pageItems) || [];
      kpiSet("opening", api.formatMoney(sum.sumCashAllocation));
      kpiSet("allocated", api.formatMoney(sum.sumCashAllocation));
      kpiSet("cash in", api.formatMoney(sum.sumInwardCash));
      kpiSet("cash out", api.formatMoney(sum.sumOutwardCash));
      kpiSet("running", api.formatMoney(sum.netCash), (sum.cashierName || c.cashierName || "") + " · " + (sum.tellerName || ""));
      var sub = document.querySelector(".page-sub");
      if (sub) sub.textContent = (sum.tellerName || "") + " · " + (sum.cashierName || "") + " · drawer " + api.formatMoney(sum.netCash);
      var chip = document.querySelector(".topbar .chip.green");
      if (chip) chip.textContent = "Teller: " + (sum.tellerName || "Open");
      var tables = document.querySelectorAll("table.data");
      var txnBody = tables[1] && tables[1].querySelector("tbody");
      if (txnBody) txnBody.innerHTML = txnRows(items);
      var clients = await api.get("/clients?limit=50");
      var cbody = document.querySelector("#teller-members tbody");
      if (cbody) {
        cbody.innerHTML = (clients.pageItems || []).map(function (cl) {
          return '<tr><td class="mono">' + api.escapeHtml(cl.accountNo || String(cl.id)) + "</td><td>" + api.escapeHtml(cl.displayName || "") + "</td><td>" + api.escapeHtml(cl.officeName || "") + '</td><td><a class="btn btn-sm" href="client-detail.html?id=' + cl.id + '">Select</a></td></tr>';
        }).join("") || '<tr><td colspan="4">No clients</td></tr>';
      }
      api.setLiveBanner(true, "LIVE — cashier #" + c.cashierId + " on teller #" + c.tellerId);
      return c;
    }
    async function cashMove(command) {
      var sav = await api.get("/savingsaccounts?limit=100");
      var items = sav.pageItems || [];
      if (!items.length) throw new Error("No savings accounts to post cash against");
      var v = await api.openDialog({
        title: command === "deposit" ? "Cash in (savings deposit)" : "Cash out (savings withdrawal)",
        submitLabel: command === "deposit" ? "Cash in" : "Cash out",
        fields: [
          { key: "savingsAccountId", label: "Savings account", type: "select", options: items.map(function (s) { return { value: s.id, label: (s.accountNo || s.id) + " · " + (s.clientName || "") + " · " + api.formatMoney(s.accountBalance) }; }) },
          { key: "amount", label: "Amount (UGX)", type: "number", value: "10000" },
          { key: "note", label: "Note", value: command === "deposit" ? "Teller cash in" : "Teller cash out" }
        ]
      });
      if (!v) return;
      var amount = api.parseAmount(v.amount);
      if (!amount || amount <= 0) throw new Error("Enter an amount");
      await api.post("/savingsaccounts/" + v.savingsAccountId + "/transactions?command=" + command, {
        locale: "en", dateFormat: "yyyy-MM-dd", transactionDate: api.todayISO(), transactionAmount: String(amount), paymentTypeId: 4, note: v.note || command
      });
      api.toast((command === "deposit" ? "Cash in" : "Cash out") + " " + api.formatMoney(amount) + " posted", "success");
      await paintDesk();
    }
    on(buttonsNamed("Open teller session")[0], async function () {
      var tellers = await api.get("/tellers");
      if (!Array.isArray(tellers) || !tellers.length) throw new Error("Create a teller first");
      var options = [];
      for (var i = 0; i < tellers.length; i++) {
        var pack = await api.get("/tellers/" + tellers[i].id + "/cashiers");
        (pack.cashiers || []).forEach(function (c) {
          options.push({ value: tellers[i].id + ":" + c.id, label: tellers[i].name + " · " + (c.staffName || ("cashier " + c.id)) });
        });
      }
      if (!options.length) throw new Error("No cashier assignments yet");
      var cur = ctx();
      var v = await api.openDialog({
        title: "Open teller session", submitLabel: "Use this cashier",
        fields: [{ key: "pair", label: "Teller / cashier", type: "select", value: (cur.tellerId && cur.cashierId) ? (cur.tellerId + ":" + cur.cashierId) : options[0].value, options: options }]
      });
      if (!v) return;
      var parts = String(v.pair).split(":");
      saveCtx({ tellerId: Number(parts[0]), cashierId: Number(parts[1]) });
      api.toast("Session set to teller " + parts[0] + " / cashier " + parts[1], "success");
      await paintDesk();
    });
    buttonsNamed("Allocate cash").concat(buttonsNamed("Allocate")).forEach(function (btn) {
      on(btn, async function () {
        var c = await ensureSession();
        var v = await api.openDialog({
          title: "Allocate cash to " + (c.cashierName || ("cashier " + c.cashierId)), submitLabel: "Allocate",
          fields: [
            { key: "amount", label: "Amount (UGX)", type: "number", value: "100000" },
            { key: "date", label: "Date", type: "date", value: api.todayISO() },
            { key: "note", label: "Note", value: "Vault allocation" }
          ]
        });
        if (!v) return;
        var amount = api.parseAmount(v.amount);
        if (!amount || amount <= 0) throw new Error("Enter an amount");
        var res = await api.post("/tellers/" + c.tellerId + "/cashiers/" + c.cashierId + "/allocate", moneyPayload(amount, v.date, v.note));
        api.toast("Allocated " + api.formatMoney(amount) + " · txn #" + (res.subResourceId || res.resourceId || ""), "success");
        await paintDesk();
      });
    });
    buttonsNamed("Settle").forEach(function (btn) {
      on(btn, async function () {
        var c = await ensureSession();
        var sum = await summary(c.tellerId, c.cashierId);
        var v = await api.openDialog({
          title: "Settle cash from drawer", submitLabel: "Settle",
          fields: [
            { key: "amount", label: "Amount (UGX)", type: "number", value: String(sum.netCash || 0) },
            { key: "date", label: "Date", type: "date", value: api.todayISO() },
            { key: "note", label: "Note", value: "Settle to vault" }
          ]
        });
        if (!v) return;
        var amount = api.parseAmount(v.amount);
        if (!amount || amount <= 0) throw new Error("Enter an amount");
        var res = await api.post("/tellers/" + c.tellerId + "/cashiers/" + c.cashierId + "/settle", moneyPayload(amount, v.date, v.note));
        api.toast("Settled " + api.formatMoney(amount) + " · #" + (res.subResourceId || ""), "success");
        await paintDesk();
      });
    });
    buttonsNamed("Cash in").forEach(function (btn) { on(btn, function () { return cashMove("deposit"); }); });
    buttonsNamed("Cash out").forEach(function (btn) { on(btn, function () { return cashMove("withdrawal"); }); });
    buttonsNamed("Deposit").forEach(function (btn) { on(btn, function () { return cashMove("deposit"); }); });
    buttonsNamed("Withdraw").forEach(function (btn) { on(btn, function () { return cashMove("withdrawal"); }); });
    buttonsNamed("Repay").forEach(function (btn) {
      on(btn, async function () {
        var loans = await api.get("/loans?limit=100");
        var items = (loans.pageItems || []).filter(function (l) { return /active|overpaid/i.test((l.status && l.status.value) || ""); });
        if (!items.length) throw new Error("No active loans to repay");
        var v = await api.openDialog({
          title: "Repay loan (cash)", submitLabel: "Repay",
          fields: [
            { key: "loanId", label: "Loan", type: "select", options: items.map(function (l) { return { value: l.id, label: (l.accountNo || l.id) + " · " + (l.clientName || "") }; }) },
            { key: "amount", label: "Amount (UGX)", type: "number", value: "10000" }
          ]
        });
        if (!v) return;
        await api.post("/loans/" + v.loanId + "/transactions?command=repayment", { locale: "en", dateFormat: "yyyy-MM-dd", transactionDate: api.todayISO(), transactionAmount: String(api.parseAmount(v.amount)), paymentTypeId: 4 });
        api.toast("Repayment posted", "success");
        await paintDesk();
      });
    });
    buttonsNamed("Shares").forEach(function (btn) { on(btn, async function () { api.toast("Share purchase is unsupported — no share product on this tenant", "error"); }); });
    buttonsNamed("Search").forEach(function (btn) {
      on(btn, async function () {
        var input = document.querySelector("[data-table-search='#teller-members']");
        var q = input ? input.value.trim() : "";
        var data = await api.get("/clients?limit=50" + (q ? "&displayName=" + encodeURIComponent(q) : ""));
        var cbody = document.querySelector("#teller-members tbody");
        if (!cbody) return;
        cbody.innerHTML = (data.pageItems || []).map(function (cl) {
          return '<tr><td class="mono">' + api.escapeHtml(cl.accountNo || String(cl.id)) + "</td><td>" + api.escapeHtml(cl.displayName || "") + "</td><td>" + api.escapeHtml(cl.officeName || "") + '</td><td><a class="btn btn-sm" href="client-detail.html?id=' + cl.id + '">Select</a></td></tr>';
        }).join("") || '<tr><td colspan="4">No match</td></tr>';
      });
    });
    paintDesk().catch(function (err) { api.setLiveBanner(false, err.message); api.toast(err.message, "error"); });
  }

  if (page === "cashier-eod") {
    api.claimMocks(["POST settle"]);
    var denoms = [50000, 20000, 10000, 5000, 2000, 1000];
    function counted() {
      var inputs = document.querySelectorAll(".denom-row input");
      var total = 0;
      inputs.forEach(function (inp, i) { total += (denoms[i] || 0) * (api.parseAmount(inp.value) || 0); });
      return total;
    }
    async function paintEod() {
      var c = await ensureSession();
      var sum = await summary(c.tellerId, c.cashierId);
      var lines = document.querySelectorAll(".recon-box .recon-line");
      function setLine(i, n) {
        if (lines[i]) { var span = lines[i].querySelector(".mono"); if (span) span.textContent = Number(n || 0).toLocaleString("en-UG"); }
      }
      setLine(0, sum.sumCashAllocation); setLine(1, sum.sumCashAllocation); setLine(2, sum.sumInwardCash); setLine(3, sum.sumOutwardCash); setLine(4, sum.netCash);
      var chip = document.querySelector(".card-h .chip");
      if (chip) chip.textContent = (sum.cashierName || "") + " · " + (sum.tellerName || "");
      var countEl = document.querySelector(".denom-grid") && document.querySelector(".denom-grid").parentElement.querySelector("p .mono");
      var box = document.querySelector(".recon-box.warn");
      function refreshVar() {
        var got = counted();
        if (countEl) countEl.textContent = api.formatMoney(got);
        var diff = got - Number(sum.netCash || 0);
        if (box) {
          var mono = box.querySelector(".mono");
          if (mono) mono.textContent = (diff < 0 ? "-" : "+") + Math.abs(diff).toLocaleString("en-UG");
          var note = box.querySelector(".text-muted");
          if (note) note.textContent = diff === 0 ? "Drawer matches expected cash." : ("Variance " + api.formatMoney(diff) + " vs expected " + api.formatMoney(sum.netCash));
        }
      }
      document.querySelectorAll(".denom-row input").forEach(function (inp) { inp.addEventListener("input", refreshVar); });
      refreshVar();
      api.setLiveBanner(true, "LIVE — POST /tellers/" + c.tellerId + "/cashiers/" + c.cashierId + "/settle");
    }
    buttonsNamed("POST settle").forEach(function (btn) {
      on(btn, async function () {
        var c = await ensureSession();
        var card = cardByHeading("Settle cash");
        var inputs = card ? card.querySelectorAll("input, textarea") : [];
        var amount = api.parseAmount(inputs[0] && inputs[0].value);
        var date = (inputs[1] && inputs[1].value) || api.todayISO();
        var note = (inputs[2] && inputs[2].value) || "EOD settle";
        if (!amount || amount <= 0) throw new Error("Enter a settle amount");
        var res = await api.post("/tellers/" + c.tellerId + "/cashiers/" + c.cashierId + "/settle", moneyPayload(amount, date, note));
        api.toast("Settled " + api.formatMoney(amount) + " · #" + (res.subResourceId || ""), "success");
        await paintEod();
      });
    });
    paintEod().catch(function (err) { api.setLiveBanner(false, err.message); api.toast(err.message, "error"); });
  }

  if (page === "journal") {
    var form = document.getElementById("journal-form");
    if (form) {
      (async function () {
        var offices = await loadOffices();
        var gls = await api.get("/glaccounts");
        var pays = await api.get("/paymenttypes").catch(function () { return []; });
        if (!Array.isArray(gls)) gls = [];
        var detail = gls.filter(function (g) { return g.usage && g.usage.id === 1 && !g.disabled; });
        if (!detail.length) detail = gls;
        function fillSelect(sel, options) {
          if (!sel) return;
          sel.innerHTML = options.map(function (o) { return '<option value="' + o.id + '">' + api.escapeHtml(o.label) + "</option>"; }).join("");
        }
        var selects = form.querySelectorAll(".form-grid select");
        fillSelect(selects[0], offices.map(function (o) { return { id: o.id, label: o.name }; }));
        if (selects[0] && offices.some(function (o) { return o.id === 2; })) selects[0].value = "2";
        fillSelect(selects[1], [{ id: "UGX", label: "UGX" }]);
        var rules = await api.get("/accountingrules").catch(function () { return []; });
        fillSelect(selects[2], [{ id: "", label: "— None —" }].concat((Array.isArray(rules) ? rules : []).map(function (r) { return { id: r.id, label: r.name }; })));
        fillSelect(selects[3], (Array.isArray(pays) ? pays : []).map(function (p) { return { id: p.id, label: p.name }; }));
        var glOpts = detail.map(function (g) { return { id: g.id, label: (g.glCode || "") + " " + g.name }; });
        form.querySelectorAll("tbody select").forEach(function (sel, idx) {
          fillSelect(sel, glOpts);
          if (glOpts[idx]) sel.value = String(glOpts[idx].id);
        });
        var submit = form.querySelector("button[type=submit]");
        if (submit) submit.textContent = "Post journal";
        api.setLiveBanner(true, "LIVE — POST /journalentries");
        form.addEventListener("submit", async function (e) {
          e.preventDefault();
          try {
            var debits = [], credits = [];
            form.querySelectorAll("tbody tr").forEach(function (tr) {
              var gl = tr.querySelector("select");
              var inputs = tr.querySelectorAll("input");
              var d = api.parseAmount(inputs[0] && inputs[0].value);
              var cAmt = api.parseAmount(inputs[1] && inputs[1].value);
              if (d > 0) debits.push({ glAccountId: Number(gl.value), amount: d });
              if (cAmt > 0) credits.push({ glAccountId: Number(gl.value), amount: cAmt });
            });
            if (!debits.length || !credits.length) throw new Error("Enter at least one debit and one credit");
            var dateEl = form.querySelector('input[type="date"]');
            var textInputs = form.querySelectorAll(".form-grid input");
            var ref = textInputs[1];
            var narr = form.querySelector("textarea");
            var body = {
              officeId: Number(selects[0].value),
              transactionDate: (dateEl && dateEl.value) || api.todayISO(),
              currencyCode: "UGX",
              comments: (narr && narr.value) || "Manual journal",
              locale: "en", dateFormat: "yyyy-MM-dd", debits: debits, credits: credits
            };
            if (ref && ref.value) body.referenceNumber = ref.value;
            if (selects[3] && selects[3].value) body.paymentTypeId = Number(selects[3].value);
            if (selects[2] && selects[2].value) body.accountingRule = Number(selects[2].value);
            var res = await api.post("/journalentries", body);
            api.toast("Journal posted " + (res.transactionId || res.resourceId || ""), "success");
          } catch (err) { api.toast(err.message || String(err), "error"); }
        });
      })().catch(function (err) { api.toast(err.message, "error"); api.setLiveBanner(false, err.message); });
    }
  }

  if (page === "loan-apply") {
    (async function () {
      var clients = await api.get("/clients?limit=200");
      var products = await api.get("/loanproducts");
      var clientSel = null, productSel = null;
      document.querySelectorAll("label").forEach(function (lab) {
        var t = lab.textContent.trim().toLowerCase();
        var sel = lab.parentElement.querySelector("select");
        if (t === "client") clientSel = sel;
        if (t === "product") productSel = sel;
      });
      if (clientSel) clientSel.innerHTML = (clients.pageItems || []).map(function (c) { return '<option value="' + c.id + '">' + api.escapeHtml(c.displayName || c.id) + "</option>"; }).join("");
      if (productSel) productSel.innerHTML = (Array.isArray(products) ? products : []).map(function (p) { return '<option value="' + p.id + '">' + api.escapeHtml(p.name) + "</option>"; }).join("");
      var wizard = document.querySelector("[data-wizard]");
      if (!wizard) return;
      wizard.addEventListener("wizard:complete", async function (ev) {
        ev.preventDefault();
        try {
          var clientId = clientSel ? Number(clientSel.value) : 1;
          var productId = productSel ? Number(productSel.value) : 1;
          var tmpl = await api.get("/loans/template?templateType=individual&clientId=" + clientId + "&productId=" + productId);
          function idOf(o) { return o && (o.id !== undefined ? o.id : o); }
          var principalInput = null, termInput = null, disb = null, submitted = null;
          document.querySelectorAll(".form-row").forEach(function (row) {
            var lab = row.querySelector("label");
            var key = lab ? lab.textContent.trim().toLowerCase() : "";
            var input = row.querySelector("input");
            if (key.indexOf("principal") >= 0) principalInput = input;
            if (key.indexOf("term") >= 0) termInput = input;
            if (key.indexOf("disbursement") >= 0) disb = input;
            if (key.indexOf("submitted") >= 0) submitted = input;
          });
          var principal = api.parseAmount(principalInput && principalInput.value) || tmpl.principal;
          var term = Number(termInput && String(termInput.value).replace(/\D/g, "")) || tmpl.numberOfRepayments || 12;
          var submittedOn = (submitted && submitted.value) || api.todayISO();
          var expected = (disb && disb.value) || submittedOn;
          var created = await api.post("/loans", {
            clientId: clientId, productId: productId, principal: principal,
            loanTermFrequency: term, loanTermFrequencyType: idOf(tmpl.termPeriodFrequencyType) || 2,
            numberOfRepayments: tmpl.numberOfRepayments || term, repaymentEvery: tmpl.repaymentEvery || 1,
            repaymentFrequencyType: idOf(tmpl.repaymentFrequencyType) || 2,
            interestRatePerPeriod: tmpl.interestRatePerPeriod,
            amortizationType: idOf(tmpl.amortizationType), interestType: idOf(tmpl.interestType),
            interestCalculationPeriodType: idOf(tmpl.interestCalculationPeriodType),
            transactionProcessingStrategyCode: tmpl.transactionProcessingStrategyCode,
            expectedDisbursementDate: expected, submittedOnDate: submittedOn, loanType: "individual",
            dateFormat: "yyyy-MM-dd", locale: "en"
          });
          var loanId = created.loanId || created.resourceId;
          api.toast("Loan application #" + loanId + " submitted", "success");
          try {
            await api.post("/loans/" + loanId + "?command=approve", { approvedOnDate: submittedOn, approvedLoanAmount: principal, expectedDisbursementDate: expected, locale: "en", dateFormat: "yyyy-MM-dd" });
            await api.post("/loans/" + loanId + "?command=disburse", { actualDisbursementDate: expected, transactionAmount: principal, paymentTypeId: 4, locale: "en", dateFormat: "yyyy-MM-dd" });
            api.toast("Approved and disbursed loan #" + loanId, "success");
          } catch (stepErr) { api.toast("Loan #" + loanId + " saved but approve/disburse failed: " + stepErr.message, "error"); }
          setTimeout(function () { location.href = "loan-detail.html?id=" + loanId; }, 600);
        } catch (err) { api.toast(err.message || String(err), "error"); }
      });
      api.setLiveBanner(true, "LIVE — POST /loans from template, then approve and disburse");
    })().catch(function (err) { api.toast(err.message, "error"); });
  }

  if (page === "loan-detail") {
    api.claimMocks(["Repay", "Disburse"]);
    buttonsNamed("Repay").forEach(function (btn) {
      on(btn, async function () {
        var id = api.qs("id");
        if (!id) throw new Error("Open a loan with ?id=");
        var v = await api.openDialog({ title: "Repay loan #" + id, submitLabel: "Post repayment", fields: [
          { key: "amount", label: "Amount (UGX)", type: "number", value: "50000" },
          { key: "date", label: "Date", type: "date", value: api.todayISO() }
        ]});
        if (!v) return;
        await api.post("/loans/" + id + "/transactions?command=repayment", { locale: "en", dateFormat: "yyyy-MM-dd", transactionDate: v.date, transactionAmount: String(api.parseAmount(v.amount)), paymentTypeId: 4 });
        api.toast("Repayment posted", "success");
        location.reload();
      });
    });
    buttonsNamed("Disburse").forEach(function (btn) {
      on(btn, async function () {
        var id = api.qs("id");
        if (!id) throw new Error("Open a loan with ?id=");
        var loan = await api.get("/loans/" + id);
        var v = await api.openDialog({ title: "Disburse loan #" + id, submitLabel: "Disburse", fields: [
          { key: "amount", label: "Amount (UGX)", type: "number", value: String(loan.principal || loan.approvedPrincipal || "") },
          { key: "date", label: "Date", type: "date", value: api.todayISO() }
        ]});
        if (!v) return;
        await api.post("/loans/" + id + "?command=disburse", { actualDisbursementDate: v.date, transactionAmount: String(api.parseAmount(v.amount)), paymentTypeId: 4, locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Disbursed", "success");
        location.reload();
      });
    });
  }

  if (page === "savings-detail") {
    api.claimMocks(["Deposit", "Withdraw"]);
    function savTxn(command) {
      return async function () {
        var id = api.qs("id");
        if (!id) throw new Error("Open a savings account with ?id=");
        var v = await api.openDialog({ title: (command === "deposit" ? "Deposit" : "Withdraw") + " #" + id, submitLabel: command, fields: [
          { key: "amount", label: "Amount (UGX)", type: "number", value: "10000" },
          { key: "date", label: "Date", type: "date", value: api.todayISO() },
          { key: "note", label: "Note", value: command }
        ]});
        if (!v) return;
        await api.post("/savingsaccounts/" + id + "/transactions?command=" + command, { locale: "en", dateFormat: "yyyy-MM-dd", transactionDate: v.date, transactionAmount: String(api.parseAmount(v.amount)), paymentTypeId: 4, note: v.note });
        api.toast(command + " posted", "success");
        location.reload();
      };
    }
    buttonsNamed("Deposit").forEach(function (btn) { on(btn, savTxn("deposit")); });
    buttonsNamed("Withdraw").forEach(function (btn) { on(btn, savTxn("withdrawal")); });
  }

  if (page === "savings") {
    api.claimMocks(["Open savings"]);
    buttonsNamed("Open savings").forEach(function (btn) {
      on(btn, async function () {
        var clients = await api.get("/clients?limit=200");
        var products = await api.get("/savingsproducts");
        var v = await api.openDialog({ title: "Open savings account", submitLabel: "Open", fields: [
          { key: "clientId", label: "Client", type: "select", options: (clients.pageItems || []).map(function (c) { return { value: c.id, label: c.displayName }; }) },
          { key: "productId", label: "Product", type: "select", options: (Array.isArray(products) ? products : []).map(function (p) { return { value: p.id, label: p.name }; }) },
          { key: "date", label: "Date", type: "date", value: api.todayISO() }
        ]});
        if (!v) return;
        var created = await api.post("/savingsaccounts", { clientId: Number(v.clientId), productId: Number(v.productId), submittedOnDate: v.date, locale: "en", dateFormat: "yyyy-MM-dd" });
        var id = created.savingsId || created.resourceId;
        await api.post("/savingsaccounts/" + id + "?command=approve", { approvedOnDate: v.date, locale: "en", dateFormat: "yyyy-MM-dd" });
        await api.post("/savingsaccounts/" + id + "?command=activate", { activatedOnDate: v.date, locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Savings #" + id + " active", "success");
        location.href = "savings-detail.html?id=" + id;
      });
    });
  }

  function fillBody(tb, html) { if (tb) tb.innerHTML = html; }
  if (page === "groups") {
    api.claimMocks(["Create group"]);
    var tb = document.querySelector("table.data tbody");
    async function draw() {
      var data = await api.get("/groups?limit=200");
      var items = data.pageItems || [];
      fillBody(tb, items.map(function (g) {
        return "<tr><td class=\"strong\">" + api.escapeHtml(g.name || "") + "</td><td>" + api.escapeHtml(g.officeName || "") + "</td><td>" + api.escapeHtml(g.centerName || "—") + "</td><td>—</td><td>" + api.escapeHtml(api.statusLabel(g.status)) + "</td></tr>";
      }).join("") || '<tr><td colspan="5">No groups</td></tr>');
      api.setLiveBanner(true, "LIVE — /groups");
    }
    buttonsNamed("Create group").forEach(function (btn) {
      on(btn, async function () {
        var offices = await loadOffices();
        var v = await api.openDialog({ title: "Create group", submitLabel: "Create", fields: [
          { key: "name", label: "Name", value: "" },
          { key: "officeId", label: "Office", type: "select", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
          { key: "date", label: "Activation", type: "date", value: api.todayISO() }
        ]});
        if (!v || !v.name) return;
        var res = await api.post("/groups", { officeId: Number(v.officeId), name: v.name.trim(), active: true, activationDate: v.date, submittedOnDate: v.date, locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Group #" + (res.resourceId || res.groupId || "") + " created", "success");
        await draw();
      });
    });
    if (tb) draw().catch(function (e) { api.toast(e.message, "error"); });
  }
  if (page === "centres") {
    api.claimMocks(["Create centre"]);
    var tbC = document.querySelector("table.data tbody");
    async function drawC() {
      var data = await api.get("/centers?limit=200");
      var items = data.pageItems || [];
      fillBody(tbC, items.map(function (c) {
        return "<tr><td class=\"strong\">" + api.escapeHtml(c.name || "") + "</td><td>" + api.escapeHtml(c.officeName || "") + "</td><td>" + api.escapeHtml(c.staffName || "—") + "</td><td>—</td><td>" + api.escapeHtml(api.statusLabel(c.status)) + "</td></tr>";
      }).join("") || '<tr><td colspan="5">No centres</td></tr>');
      api.setLiveBanner(true, "LIVE — /centers");
    }
    buttonsNamed("Create centre").forEach(function (btn) {
      on(btn, async function () {
        var offices = await loadOffices();
        var v = await api.openDialog({ title: "Create centre", submitLabel: "Create", fields: [
          { key: "name", label: "Name", value: "" },
          { key: "officeId", label: "Office", type: "select", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
          { key: "date", label: "Activation", type: "date", value: api.todayISO() }
        ]});
        if (!v || !v.name) return;
        var res = await api.post("/centers", { officeId: Number(v.officeId), name: v.name.trim(), active: true, activationDate: v.date, submittedOnDate: v.date, locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Centre #" + (res.resourceId || "") + " created", "success");
        await drawC();
      });
    });
    if (tbC) drawC().catch(function (e) { api.toast(e.message, "error"); });
  }
  if (page === "collections") {
    api.claimMocks(["Follow up"]);
    (async function () {
      var data = await api.get("/loans?limit=200");
      var items = data.pageItems || [];
      var overdue = items.filter(function (l) { return l.inArrears || (l.summary && Number(l.summary.totalOverdue) > 0); });
      var show = overdue.length ? overdue : items;
      var tb = document.querySelector("table.data tbody");
      fillBody(tb, show.map(function (l) {
        var due = (l.summary && l.summary.totalOverdue) || l.totalOutstanding || l.principal;
        return '<tr><td><a href="client-detail.html?id=' + (l.clientId || "") + '">' + api.escapeHtml(l.clientName || "") + '</a></td><td class="mono">' + api.escapeHtml(l.accountNo || "") + "</td><td>" + api.escapeHtml(api.statusLabel(l.status)) + '</td><td class="mono text-right">' + api.formatMoney(due) + "</td><td>" + api.escapeHtml(l.loanOfficerName || "—") + '</td><td><a class="btn btn-sm" href="loan-detail.html?id=' + l.id + '">Open loan</a></td></tr>';
      }).join("") || '<tr><td colspan="6">No loans yet</td></tr>');
      api.setLiveBanner(true, overdue.length ? ("LIVE — " + overdue.length + " overdue") : "LIVE — no overdue loans; showing the portfolio");
    })().catch(function (e) { api.toast(e.message, "error"); });
  }
  async function runReport(name, params) {
    var q = new URLSearchParams(params || {});
    q.set("output-type", "JSON");
    return api.get("/runreports/" + encodeURIComponent(name) + "?" + q.toString());
  }
  function renderReport(data) {
    var headers = (data && data.columnHeaders) || [];
    var rows = (data && data.data) || [];
    if (!headers.length) return "<p>Report returned no table.</p>";
    var th = headers.map(function (h) { return "<th>" + api.escapeHtml(h.columnName || "") + "</th>"; }).join("");
    var body = rows.slice(0, 100).map(function (r) {
      var cells = r.row || [];
      return "<tr>" + cells.map(function (c) { return "<td>" + api.escapeHtml(c === null || c === undefined ? "" : String(c)) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return '<div class="table-wrap"><table class="data"><thead><tr>' + th + "</tr></thead><tbody>" + (body || '<tr><td colspan="6">No rows</td></tr>') + "</tbody></table></div>";
  }
  if (page === "reports") {
    api.claimMocks(["Run PAR", "Users", "Settings"]);
    buttonsNamed("Run PAR").forEach(function (btn) {
      on(btn, async function () {
        api.toast("Portfolio at Risk exists in /reports but its SQL fails on this database (BadSqlGrammar). Use Collections for live loans.", "error");
        api.setLiveBanner(true, "LIVE — PAR report unsupported on this DB; collections uses /loans");
      });
    });
    buttonsNamed("Users").forEach(function (btn) {
      on(btn, async function () {
        var users = await api.get("/users");
        var lines = (Array.isArray(users) ? users : []).map(function (u) { return u.username + " · " + (u.firstname || "") + " " + (u.lastname || ""); }).join("\n");
        window.alert(lines || "No users");
      });
    });
    buttonsNamed("Settings").forEach(function (btn) {
      on(btn, async function () { api.toast("There is no single settings write API. Codes, offices, and payment types are the live config surfaces.", "error"); });
    });
    api.setLiveBanner(true, "LIVE — Run uses /runreports");
  }
  if (page === "statement") {
    api.claimMocks(["Run statement"]);
    (async function () {
      var clients = await api.get("/clients?limit=200");
      var sel = document.querySelector(".filters select");
      if (sel) sel.innerHTML = (clients.pageItems || []).map(function (c) { return '<option value="' + c.id + '">' + api.escapeHtml(c.displayName || "") + "</option>"; }).join("");
      buttonsNamed("Run statement").forEach(function (btn) {
        on(btn, async function () {
          var id = sel ? sel.value : "1";
          var accounts = await api.get("/clients/" + id + "/accounts");
          var client = await api.get("/clients/" + id);
          var html = "";
          var savs = accounts.savingsAccounts || [];
          for (var i = 0; i < savs.length; i++) {
            var full = await api.get("/savingsaccounts/" + savs[i].id + "?associations=transactions");
            html += "<h3>Savings " + api.escapeHtml(full.accountNo || "") + " · " + api.formatMoney(full.summary && full.summary.accountBalance) + "</h3><table class=\"data\"><tbody>" +
              (full.transactions || []).map(function (t) { return "<tr><td>" + api.formatDate(t.date) + "</td><td>" + api.escapeHtml((t.transactionType && t.transactionType.value) || "") + "</td><td class=\"mono\">" + api.formatMoney(t.amount) + "</td><td class=\"mono\">" + api.formatMoney(t.runningBalance) + "</td></tr>"; }).join("") +
              "</tbody></table>";
          }
          var loans = accounts.loanAccounts || [];
          for (var j = 0; j < loans.length; j++) {
            var loan = await api.get("/loans/" + loans[j].id + "?associations=transactions");
            html += "<h3>Loan " + api.escapeHtml(loan.accountNo || "") + "</h3><table class=\"data\"><tbody>" +
              (loan.transactions || []).map(function (t) { return "<tr><td>" + api.formatDate(t.date) + "</td><td>" + api.escapeHtml((t.type && t.type.value) || "") + "</td><td class=\"mono\">" + api.formatMoney(t.amount) + "</td></tr>"; }).join("") +
              "</tbody></table>";
          }
          var box = document.querySelector(".statement");
          if (box) box.innerHTML = "<div class=\"strong\">" + api.escapeHtml(client.displayName || "") + " · #" + api.escapeHtml(client.accountNo || id) + "</div>" + (html || "<p>No account transactions</p>");
          api.toast("Statement loaded", "success");
          api.setLiveBanner(true, "LIVE — client account transactions");
        });
      });
    })().catch(function (e) { api.toast(e.message, "error"); });
  }

  async function mountNamedReport(pageName, reportName) {
    if (page !== pageName) return;
    var btn = document.querySelector("[data-mock]");
    async function go() {
      var params = { R_officeId: "1", R_endDate: api.todayISO(), locale: "en", dateFormat: "yyyy-MM-dd" };
      if (reportName.indexOf("Balance Sheet") < 0) params.R_startDate = api.todayISO().slice(0, 4) + "-01-01";
      var data = await runReport(reportName, params);
      var host = document.querySelector("table.data");
      if (host && host.parentElement) host.parentElement.innerHTML = renderReport(data);
      else {
        var card = document.querySelector(".card-b");
        if (card) card.innerHTML = renderReport(data);
      }
      api.setLiveBanner(true, "LIVE — /runreports/" + reportName);
      api.toast(reportName + " loaded", "success");
    }
    if (btn) { api.markWired(btn); on(btn, go); }
  }
  mountNamedReport("trial", "Trial Balance Table");
  mountNamedReport("is", "Income Statement Table");
  mountNamedReport("bs", "Balance Sheet Table");

  if (page === "accounting") {
    api.claimMocks(["Create GL", "POST /glaccounts"]);
    buttonsNamed("Create GL").concat(buttonsNamed("POST /glaccounts")).forEach(function (btn) {
      on(btn, async function () {
        var v = await api.openDialog({ title: "Create GL account", submitLabel: "Save", fields: [
          { key: "name", label: "Name", value: "" },
          { key: "glCode", label: "GL code", value: "" },
          { key: "type", label: "Type", type: "select", value: "1", options: [
            { value: "1", label: "Asset" }, { value: "2", label: "Liability" }, { value: "3", label: "Equity" }, { value: "4", label: "Income" }, { value: "5", label: "Expense" }
          ]},
          { key: "usage", label: "Usage", type: "select", value: "1", options: [{ value: "1", label: "Detail" }, { value: "2", label: "Header" }] }
        ]});
        if (!v || !v.name || !v.glCode) return;
        var res = await api.post("/glaccounts", { name: v.name.trim(), glCode: v.glCode.trim(), type: Number(v.type), usage: Number(v.usage), manualEntriesAllowed: true, description: v.name.trim() });
        api.toast("GL created #" + (res.resourceId || ""), "success");
        location.reload();
      });
    });
  }
  if (page === "closing") {
    api.claimMocks(["Create GL closure", "Delete closure"]);
    (async function () {
      var rows = await api.get("/glclosures");
      var tb = document.querySelector("table.data tbody");
      var list = Array.isArray(rows) ? rows : [];
      fillBody(tb, list.map(function (c) {
        return "<tr><td>" + api.escapeHtml(c.officeName || "") + "</td><td>" + api.formatDate(c.closingDate) + "</td><td>" + api.escapeHtml(c.comments || "") + "</td><td>" + api.escapeHtml(c.createdByUsername || "") + '</td><td><button class="btn btn-sm btn-ghost" data-del="' + c.id + '">Delete</button></td></tr>';
      }).join("") || '<tr><td colspan="5">No closures</td></tr>');
      if (tb) tb.querySelectorAll("[data-del]").forEach(function (b) {
        b.addEventListener("click", async function () {
          try { await api.del("/glclosures/" + b.getAttribute("data-del")); api.toast("Closure deleted", "success"); location.reload(); }
          catch (e) { api.toast(e.message, "error"); }
        });
      });
      buttonsNamed("Create GL closure").forEach(function (btn) {
        on(btn, async function () {
          var offices = await loadOffices();
          var v = await api.openDialog({ title: "Close period", submitLabel: "Close", fields: [
            { key: "officeId", label: "Office", type: "select", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
            { key: "closingDate", label: "Closing date", type: "date", value: api.todayISO() },
            { key: "comments", label: "Comments", value: "Period close" }
          ]});
          if (!v) return;
          await api.post("/glclosures", { officeId: Number(v.officeId), closingDate: v.closingDate, comments: v.comments, locale: "en", dateFormat: "yyyy-MM-dd" });
          api.toast("Period closed", "success");
          location.reload();
        });
      });
      api.setLiveBanner(true, "LIVE — /glclosures");
    })().catch(function (e) { api.toast(e.message, "error"); });
  }
  if (page === "rules") {
    api.claimMocks(["Create rule", "Post via rule"]);
    (async function () {
      var rules = await api.get("/accountingrules");
      var tb = document.querySelector("table.data tbody");
      if (tb && Array.isArray(rules)) {
        tb.innerHTML = rules.map(function (r) { return "<tr><td>" + api.escapeHtml(r.name || "") + "</td><td>" + api.escapeHtml(r.description || "") + "</td><td>" + api.escapeHtml(r.officeName || "All") + "</td></tr>"; }).join("") || '<tr><td colspan="3">No rules</td></tr>';
      }
      buttonsNamed("Create rule").forEach(function (btn) {
        on(btn, async function () {
          var gls = await api.get("/glaccounts");
          var opts = (Array.isArray(gls) ? gls : []).filter(function (g) { return g.usage && g.usage.id === 1; }).map(function (g) { return { value: g.id, label: g.glCode + " " + g.name }; });
          var offices = await loadOffices();
          var v = await api.openDialog({ title: "Accounting rule", submitLabel: "Create", fields: [
            { key: "name", label: "Name", value: "" },
            { key: "officeId", label: "Office", type: "select", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
            { key: "debit", label: "Debit GL", type: "select", options: opts },
            { key: "credit", label: "Credit GL", type: "select", options: opts }
          ]});
          if (!v || !v.name) return;
          await api.post("/accountingrules", { name: v.name.trim(), officeId: Number(v.officeId), description: v.name.trim(), accountToDebit: Number(v.debit), accountToCredit: Number(v.credit) });
          api.toast("Rule created", "success");
          location.reload();
        });
      });
      buttonsNamed("Post via rule").forEach(function (btn) { on(btn, async function () { location.href = "journal-entry.html"; }); });
      api.setLiveBanner(true, "LIVE — /accountingrules");
    })().catch(function (e) { api.toast(e.message, "error"); });
  }
  if (page === "mappings") {
    api.claimMocks(["Create mapping", "Edit"]);
    (async function () {
      var rows = await api.get("/financialactivityaccounts");
      var tb = document.querySelector("table.data tbody");
      if (tb && Array.isArray(rows)) {
        tb.innerHTML = rows.map(function (m) {
          var act = m.financialActivityData || {}; var gl = m.glAccountData || {};
          return "<tr><td>" + api.escapeHtml((act.name || "") + " (" + (act.id || "") + ")") + "</td><td>" + api.escapeHtml((gl.glCode || "") + " " + (gl.name || "")) + "</td><td>mapped</td></tr>";
        }).join("") || '<tr><td colspan="3">None</td></tr>';
      }
      buttonsNamed("Create mapping").forEach(function (btn) {
        on(btn, async function () {
          var gls = await api.get("/glaccounts");
          var opts = (Array.isArray(gls) ? gls : []).map(function (g) { return { value: g.id, label: (g.glCode || "") + " " + g.name }; });
          var v = await api.openDialog({ title: "Map financial activity", submitLabel: "Map", fields: [
            { key: "financialActivityId", label: "Activity", type: "select", options: [
              { value: "100", label: "100 assetTransfer" }, { value: "101", label: "101 cashAtMainVault" }, { value: "102", label: "102 cashAtTeller" }, { value: "103", label: "103 fundSource" }, { value: "200", label: "200 liabilityTransfer" }, { value: "300", label: "300 openingBalances" }
            ]},
            { key: "glAccountId", label: "GL", type: "select", options: opts }
          ]});
          if (!v) return;
          await api.post("/financialactivityaccounts", { financialActivityId: Number(v.financialActivityId), glAccountId: Number(v.glAccountId) });
          api.toast("Mapping saved", "success");
          location.reload();
        });
      });
      buttonsNamed("Edit").forEach(function (btn) { on(btn, async function () { api.toast("Post the same activity id again to replace the GL. Delete is not a stable call on this build.", "error"); }); });
      api.setLiveBanner(true, "LIVE — /financialactivityaccounts");
    })().catch(function (e) { api.toast(e.message, "error"); });
  }
  if (page === "accruals") {
    api.claimMocks(["Run accruals", "Create provisioning"]);
    buttonsNamed("Run accruals").forEach(function (btn) {
      on(btn, async function () {
        var v = await api.openDialog({ title: "Run accruals", submitLabel: "Run", fields: [{ key: "tillDate", label: "Till date", type: "date", value: api.todayISO() }] });
        if (!v) return;
        await api.post("/runaccruals", { tillDate: v.tillDate, locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Accrual run posted", "success");
      });
    });
    buttonsNamed("Create provisioning").forEach(function (btn) {
      on(btn, async function () {
        try {
          var crit = await api.get("/provisioningcriteria");
          api.toast("Provisioning criteria: " + (Array.isArray(crit) ? crit.length : "loaded") + ". Full criteria create is a multi-bucket payload and stays manual.", "success");
        } catch (e) { api.toast("Provisioning create is not a simple POST on this tenant: " + e.message, "error"); }
      });
    });
    api.setLiveBanner(true, "LIVE — POST /runaccruals");
  }
  if (page === "client-detail" || page === "onboard") {
    api.claimMocks(["Upload client image", "Update photo", "Close client", "Transfer client", "Open savings", "Edit client", "Add family", "Add address"]);
    document.querySelectorAll("[data-mock='Upload client image'], [data-mock='Update photo']").forEach(function (btn) {
      on(btn, async function () {
        var id = api.qs("id");
        if (!id) { api.toast("Create the client first. Image upload needs /clients/{id}/images.", "error"); return; }
        var input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = async function () {
          var file = input.files && input.files[0];
          if (!file) return;
          try { var fd = new FormData(); fd.append("file", file); await api.postForm("/clients/" + id + "/images", fd); api.toast("Photo uploaded", "success"); }
          catch (e) { api.toast(e.message || String(e), "error"); }
        };
        input.click();
      });
    });
  }
  if (page === "client-detail") {
    buttonsNamed("Open savings").forEach(function (btn) { on(btn, async function () { location.href = "savings.html"; }); });
    buttonsNamed("Edit client").forEach(function (btn) {
      on(btn, async function () {
        var id = api.qs("id");
        var c = await api.get("/clients/" + id);
        var v = await api.openDialog({ title: "Edit client", submitLabel: "Save", fields: [
          { key: "firstname", label: "First name", value: c.firstname || "" },
          { key: "lastname", label: "Last name", value: c.lastname || "" },
          { key: "mobileNo", label: "Mobile", value: c.mobileNo || "" }
        ]});
        if (!v) return;
        await api.put("/clients/" + id, { firstname: v.firstname, lastname: v.lastname, mobileNo: v.mobileNo });
        api.toast("Client updated", "success");
        location.reload();
      });
    });
    buttonsNamed("Close client").forEach(function (btn) {
      on(btn, async function () {
        var id = api.qs("id");
        var v = await api.openDialog({ title: "Close client", submitLabel: "Close", fields: [
          { key: "date", label: "Closure date", type: "date", value: api.todayISO() },
          { key: "closureReasonId", label: "Reason id", value: "1" }
        ]});
        if (!v) return;
        await api.post("/clients/" + id + "?command=close", { closureDate: v.date, closureReasonId: Number(v.closureReasonId), locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Client closed", "success");
      });
    });
    buttonsNamed("Transfer client").forEach(function (btn) {
      on(btn, async function () {
        var id = api.qs("id");
        var offices = await loadOffices();
        var v = await api.openDialog({ title: "Propose transfer", submitLabel: "Transfer", fields: [
          { key: "officeId", label: "Office", type: "select", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
          { key: "date", label: "Date", type: "date", value: api.todayISO() }
        ]});
        if (!v) return;
        await api.post("/clients/" + id + "?command=proposeTransfer", { destinationOfficeId: Number(v.officeId), transferDate: v.date, note: "Desk transfer", locale: "en", dateFormat: "yyyy-MM-dd" });
        api.toast("Transfer proposed", "success");
      });
    });
    buttonsNamed("Add family").concat(buttonsNamed("Add address")).forEach(function (btn) {
      on(btn, async function () { api.toast("Family and address datatables are not a single REST create on this tenant.", "error"); });
    });
  }
  if (page === "products") {
    api.claimMocks(["Create loan product", "Create charge", "Edit rate"]);
    buttonsNamed("Create loan product").forEach(function (btn) { on(btn, async function () { api.toast("Loan product create needs fund, strategy, and a full GL mapping. List stays live; the wizard is not posted.", "error"); }); });
    buttonsNamed("Create charge").forEach(function (btn) {
      on(btn, async function () {
        var v = await api.openDialog({ title: "Create charge", submitLabel: "Create", fields: [
          { key: "name", label: "Name", value: "Processing fee" },
          { key: "amount", label: "Amount", type: "number", value: "10000" }
        ]});
        if (!v) return;
        await api.post("/charges", { name: v.name, amount: api.parseAmount(v.amount), currencyCode: "UGX", chargeAppliesTo: 1, chargeTimeType: 1, chargeCalculationType: 1, chargePaymentMode: 0, active: true, locale: "en" });
        api.toast("Charge created", "success");
      });
    });
    buttonsNamed("Edit rate").forEach(function (btn) { on(btn, async function () { api.toast("No floating-rate chart is seeded. Edit stays unsupported.", "error"); }); });
  }
  if (page === "clients") {
    api.claimMocks(["Import", "Approve KYC"]);
    buttonsNamed("Import").forEach(function (btn) { on(btn, async function () { api.toast("CSV import is a bulk job, not a simple POST. Onboard one client from the wizard instead.", "error"); }); });
    buttonsNamed("Approve KYC").forEach(function (btn) { on(btn, async function () { api.toast("KYC review is not a Fineract command. Client activation already happens on create.", "error"); }); });
  }
})();
