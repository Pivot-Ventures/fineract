/* Pivot SACCO Desk — write actions against live Fineract */
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

  function $(id) { return document.getElementById(id); }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function refresh() { document.dispatchEvent(new CustomEvent("desk:refresh")); }
  function fail(err) { if (err && err.status !== 401) api.toast(err.message || String(err), "error"); }
  function ctx() {
    try { return JSON.parse(sessionStorage.getItem(CTX) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveCtx(patch) {
    var next = Object.assign(ctx(), patch || {});
    sessionStorage.setItem(CTX, JSON.stringify(next));
    return next;
  }
  function fullName(c) {
    return c.displayName || ((c.firstname || "") + " " + (c.lastname || "")).trim() || ("#" + c.id);
  }
  /* Click handler with a busy guard so a double click cannot start two flows. */
  function on(el, fn) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.getAttribute("aria-busy") === "true") return;
      el.setAttribute("aria-busy", "true");
      Promise.resolve().then(function () { return fn(el); }).catch(fail).then(function () {
        el.removeAttribute("aria-busy");
      });
    });
  }
  function actions(name) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-action="' + name + '"]'));
  }
  function onAction(name, fn) { actions(name).forEach(function (b) { on(b, fn); }); }
  /* Disables a form's submit button while fn runs. */
  function onSubmitForm(form, fn) {
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      if (btn && btn.disabled) return;
      if (btn) btn.disabled = true;
      Promise.resolve().then(function () { return fn(form); }).catch(fail).then(function () {
        if (btn) btn.disabled = false;
      });
    });
  }
  function optionLabel(field, value) {
    var o = (field.options || []).filter(function (x) { return String(x.value) === String(value); })[0];
    return o ? o.label : String(value);
  }
  function officeOpts(offices) {
    return offices.map(function (o) { return { value: o.id, label: o.name }; });
  }
  async function loadOffices() {
    var offices = await api.get("/offices");
    return Array.isArray(offices) ? offices : [];
  }
  function defaultOffice(offices) {
    var has = offices.some(function (o) { return String(o.id) === String(sess.officeId); });
    return has ? String(sess.officeId) : (offices[0] ? String(offices[0].id) : "");
  }
  function amountField(label) {
    return { key: "amount", label: label || "Amount (UGX)", amount: true, required: true };
  }
  function dateField(label, key) {
    return { key: key || "date", label: label || "Date", type: "date", required: true, value: api.todayISO(), max: api.todayISO() };
  }
  function noteField(placeholder) {
    return { key: "note", label: "Note", placeholder: placeholder || "optional" };
  }

  /* ================================================================ TELLERS / CASHIERS */
  var STATUS_OPTS = [
    { value: "300", label: "Active" },
    { value: "100", label: "Pending" },
    { value: "400", label: "Inactive" },
    { value: "600", label: "Closed" }
  ];
  var STATUS_MAP = { PENDING: "100", ACTIVE: "300", INACTIVE: "400", CLOSED: "600" };

  async function summary(tellerId, cashierId) {
    return api.get("/tellers/" + encodeURIComponent(tellerId) + "/cashiers/" + encodeURIComponent(cashierId) +
      "/summaryandtransactions?currencyCode=" + CCY + "&offset=0&limit=50");
  }
  function cashPayload(amount, date, note) {
    return withDate({ txnDate: date, txnAmount: String(amount), currencyCode: CCY, txnNote: note || "" });
  }

  /* Resolve the teller/cashier for the desk: URL → saved context → the signed-in user's own drawer → first cashier. */
  async function ensureSession() {
    var c = ctx();
    var tellers = await api.get("/tellers");
    if (!Array.isArray(tellers) || !tellers.length) throw new Error("No tellers yet — create one under Tellers & cashiers.");
    var wantT = api.qs("tellerId") || c.tellerId;
    var wantC = api.qs("cashierId") || c.cashierId;
    var ordered = tellers.filter(function (t) { return String(t.id) === String(wantT); })
      .concat(tellers.filter(function (t) { return String(t.id) !== String(wantT); }));
    var fallback = null;
    for (var i = 0; i < ordered.length; i++) {
      var pack = await api.get("/tellers/" + encodeURIComponent(ordered[i].id) + "/cashiers");
      var list = pack.cashiers || [];
      var match = list.filter(function (x) {
        return wantC ? String(x.id) === String(wantC) && String(ordered[i].id) === String(wantT || ordered[i].id) : String(x.staffId) === String(sess.staffId);
      })[0];
      if (!fallback && list.length) fallback = { teller: ordered[i], cashier: list[0] };
      if (match) { fallback = { teller: ordered[i], cashier: match }; break; }
    }
    if (!fallback) throw new Error("No cashier is assigned to any teller yet. Assign one on the teller page.");
    return saveCtx({
      tellerId: fallback.teller.id, tellerName: fallback.teller.name, officeId: fallback.teller.officeId,
      cashierId: fallback.cashier.id, cashierName: fallback.cashier.staffName, staffId: fallback.cashier.staffId
    });
  }

  async function tellerDialog(existing) {
    var offices = await loadOffices();
    var fields = [
      { key: "name", label: "Teller name", required: true, value: existing ? existing.name : "" },
      { key: "description", label: "Description", value: existing ? existing.description || "" : "" },
      { key: "officeId", label: "Office", type: "select", required: true, value: existing ? String(existing.officeId) : defaultOffice(offices), options: officeOpts(offices) },
      { key: "startDate", label: "Start date", type: "date", required: true, value: existing ? api.formatDate(existing.startDate) : api.todayISO() },
      { key: "status", label: "Status", type: "select", value: existing ? (STATUS_MAP[existing.status] || "300") : "300", options: STATUS_OPTS }
    ];
    return api.openDialog({
      title: existing ? "Edit teller" : "Create teller", submitLabel: existing ? "Save" : "Create", fields: fields,
      onSubmit: function (v) {
        var body = withDate({ officeId: Number(v.officeId), name: v.name.trim(), description: v.description || "", status: Number(v.status), startDate: v.startDate });
        return existing ? api.put("/tellers/" + encodeURIComponent(existing.id), body) : api.post("/tellers", body);
      }
    });
  }

  if (page === "tellers") {
    var tbody = document.querySelector("#tellers-table tbody");
    var officeFilter = $("tellers-office");
    var canEditTeller = api.can("UPDATE_TELLER");
    var reloadTellers = async function () {
      var pair = await Promise.all([api.get("/tellers"), loadOffices()]);
      var tellers = Array.isArray(pair[0]) ? pair[0] : [];
      if (officeFilter && officeFilter.options.length <= 1) {
        officeFilter.innerHTML = '<option value="">All offices</option>' + pair[1].map(function (o) {
          return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
        }).join("");
      }
      var oid = officeFilter && officeFilter.value;
      tbody.innerHTML = tellers.filter(function (t) { return !oid || String(t.officeId) === String(oid); }).map(function (t) {
        var st = String(t.status || "—");
        var href = "teller-detail.html?id=" + encodeURIComponent(t.id);
        return '<tr><td class="strong"><a href="' + href + '">' + esc(t.name) + "</a></td><td>" + esc(t.officeName || "") + "</td><td>" +
          esc(t.description || "—") + "</td><td>" + api.statusBadge(st.charAt(0) + st.slice(1).toLowerCase()) + '</td><td class="btn-group">' +
          '<a class="btn btn-sm" href="' + href + '">Open</a>' +
          (canEditTeller ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-teller="' + esc(t.id) + '">Edit</button>' : "") + "</td></tr>";
      }).join("") || api.emptyRow(5, "No tellers yet.");
    };
    tbody.addEventListener("click", function (e) {
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
      api.toast("Teller created", "success");
      await reloadTellers();
    });
    reloadTellers().catch(fail);
  }

  if (page === "teller-detail") {
    var tellerId = api.qs("id");
    var cashiers = [];
    var canEditCashier = api.can("UPDATECASHIERALLOCATION_TELLER");
    var paintTxns = async function (cashierId) {
      var tb = document.querySelector("#cashier-txns tbody");
      if (!cashierId) { tb.innerHTML = api.emptyRow(3, "Select a cashier."); return; }
      tb.innerHTML = api.loadingRow(3);
      var sum = await summary(tellerId, cashierId);
      var items = (sum.cashierTransactions && sum.cashierTransactions.pageItems) || [];
      tb.innerHTML = items.map(function (t) {
        return "<tr><td>" + esc(api.formatDate(t.txnDate)) + "</td><td>" + esc((t.txnType && t.txnType.value) || "—") +
          '</td><td class="mono text-right">' + api.formatMoney(t.txnAmount) + "</td></tr>";
      }).join("") || api.emptyRow(3, "No transactions for " + (sum.cashierName || "this cashier"));
    };
    var cashierDialog = async function (existing) {
      var tmpl = await api.get("/tellers/" + encodeURIComponent(tellerId) + "/cashiers/template");
      var staff = tmpl.staffOptions || [];
      if (existing && !staff.some(function (s) { return String(s.id) === String(existing.staffId); })) {
        staff = [{ id: existing.staffId, displayName: existing.staffName }].concat(staff);
      }
      if (!staff.length) throw new Error("No available staff in this office to assign as cashier.");
      return api.openDialog({
        title: existing ? "Edit cashier" : "Assign cashier", submitLabel: existing ? "Save" : "Assign",
        fields: [
          { key: "staffId", label: "Staff", type: "select", required: true, value: existing ? String(existing.staffId) : "", placeholder: "— Select staff —", options: staff.map(function (s) { return { value: s.id, label: s.displayName }; }) },
          { key: "description", label: "Description", value: existing ? existing.description || "" : "" },
          { key: "startDate", label: "From", type: "date", required: true, value: existing ? api.formatDate(existing.startDate) : api.todayISO() },
          { key: "endDate", label: "To", type: "date", required: true, value: existing ? api.formatDate(existing.endDate) : "" },
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
    };
    var paintTeller = async function () {
      if (!tellerId) throw new Error("Open a teller from the Tellers list.");
      var teller = await api.get("/tellers/" + encodeURIComponent(tellerId));
      document.title = (teller.name || "Teller") + " · Pivot SACCO Desk";
      $("teller-title").textContent = teller.name || ("Teller " + tellerId);
      $("page-sub").textContent = (teller.officeName || "") + " · started " + api.formatDate(teller.startDate);
      $("teller-name").textContent = teller.name || "";
      var st = String(teller.status || "");
      $("teller-status").innerHTML = api.statusBadge(st.charAt(0) + st.slice(1).toLowerCase());
      $("teller-office").textContent = "Office: " + (teller.officeName || teller.officeId) + (teller.description ? " · " + teller.description : "");
      var pack = await api.get("/tellers/" + encodeURIComponent(tellerId) + "/cashiers");
      cashiers = pack.cashiers || [];
      var tb = document.querySelector("#cashiers-table tbody");
      tb.innerHTML = cashiers.map(function (c) {
        var q = "tellerId=" + encodeURIComponent(tellerId) + "&cashierId=" + encodeURIComponent(c.id);
        return '<tr><td class="strong">' + esc(c.staffName || c.staffId) + "</td><td>" + esc(api.formatDate(c.startDate)) + "</td><td>" +
          esc(api.formatDate(c.endDate)) + "</td><td>" + (c.isFullDay ? "Yes" : "No") + '</td><td class="btn-group">' +
          '<button type="button" class="btn btn-sm btn-ghost" data-txns="' + esc(c.id) + '">Transactions</button>' +
          '<a class="btn btn-sm btn-ghost" href="cashier-eod.html?' + q + '">Settle</a>' +
          '<a class="btn btn-sm btn-ghost" href="teller.html?' + q + '">Desk</a>' +
          (canEditCashier ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-cashier="' + esc(c.id) + '">Edit</button>' : "") +
          "</td></tr>";
      }).join("") || api.emptyRow(5, "No cashiers — assign one.");
      var sel = $("alloc-cashier");
      if (sel) {
        sel.innerHTML = '<option value="">— Select cashier —</option>' + cashiers.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.staffName || c.staffId) + "</option>";
        }).join("");
        var remembered = cashiers.some(function (c) { return String(c.id) === String(ctx().cashierId); }) ? ctx().cashierId : "";
        sel.value = remembered ? String(remembered) : (cashiers.length === 1 ? String(cashiers[0].id) : "");
        await paintTxns(sel.value);
      }
    };
    document.querySelector("#cashiers-table tbody").addEventListener("click", function (e) {
      var t = e.target.closest("[data-txns]");
      if (t) {
        var sel = $("alloc-cashier");
        if (sel) sel.value = t.getAttribute("data-txns");
        paintTxns(t.getAttribute("data-txns")).catch(fail);
        return;
      }
      var ed = e.target.closest("[data-edit-cashier]");
      if (ed) {
        var cur = cashiers.filter(function (c) { return String(c.id) === ed.getAttribute("data-edit-cashier"); })[0];
        cashierDialog(cur).then(function (r) { if (r) { api.toast("Cashier updated", "success"); return paintTeller(); } }).catch(fail);
      }
    });
    var allocSel = $("alloc-cashier");
    if (allocSel) allocSel.addEventListener("change", function () { paintTxns(allocSel.value).catch(fail); });
    if ($("alloc-date")) { $("alloc-date").value = api.todayISO(); $("alloc-date").max = api.todayISO(); }
    onSubmitForm($("allocate-form"), async function () {
      var cashierId = $("alloc-cashier").value;
      var amount = api.parseAmount($("alloc-amount").value);
      var date = $("alloc-date").value;
      var note = $("alloc-note").value.trim();
      if (!cashierId) throw new Error("Choose a cashier.");
      if (!(amount > 0)) throw new Error("Amount must be a whole number of UGX greater than zero.");
      if (!api.isISODate(date)) throw new Error("Choose a valid date.");
      var cashier = cashiers.filter(function (c) { return String(c.id) === String(cashierId); })[0] || {};
      var ok = await api.confirmDialog({
        title: "Allocate cash", summary: "Allocate cash to cashier", confirmLabel: "Allocate " + api.formatMoney(amount),
        lines: [["Teller", $("teller-name").textContent], ["Cashier", cashier.staffName || cashierId], ["Amount", api.formatMoney(amount)], ["Date", date]],
        onConfirm: function () {
          return api.post("/tellers/" + encodeURIComponent(tellerId) + "/cashiers/" + encodeURIComponent(cashierId) + "/allocate", cashPayload(amount, date, note || "Vault allocation"));
        }
      });
      if (!ok) return;
      saveCtx({ tellerId: Number(tellerId), cashierId: Number(cashierId) });
      api.toast("Allocated " + api.formatMoney(amount), "success");
      $("alloc-amount").value = "";
      $("alloc-note").value = "";
      await paintTxns(cashierId);
    });
    onAction("edit-teller", async function () {
      var teller = await api.get("/tellers/" + encodeURIComponent(tellerId));
      if (await tellerDialog(teller)) { api.toast("Teller updated", "success"); await paintTeller(); }
    });
    onAction("create-cashier", async function () {
      if (await cashierDialog(null)) { api.toast("Cashier assigned", "success"); await paintTeller(); }
    });
    paintTeller().catch(fail);
  }

  /* ---------- money dialogs shared by teller desk, savings and loan pages ---------- */
  async function savingsTxnDialog(command, account) {
    var pt = await api.paymentTypeField();
    var isDeposit = command === "deposit";
    var fields = [];
    if (!account) {
      fields.push({ key: "savingsId", label: "Savings account", type: "search", required: true, placeholder: "Account no or member name", search: function (q) { return api.searchSavings(q, true); } });
    }
    fields.push(amountField(), pt, dateField(), noteField());
    return api.openDialog({
      title: isDeposit ? "Deposit (cash in)" : "Withdraw (cash out)", submitLabel: "Review", fields: fields,
      confirm: function (v) {
        return {
          title: isDeposit ? "Confirm deposit" : "Confirm withdrawal",
          lines: [
            ["Account", account ? "#" + account.accountNo + " · " + (account.clientName || "") : (v.savingsIdLabel || v.savingsId)],
            ["Amount", api.formatMoney(v.amount)], ["Payment type", optionLabel(pt, v.paymentTypeId)], ["Date", v.date]
          ],
          confirmLabel: (isDeposit ? "Post deposit of " : "Post withdrawal of ") + api.formatMoney(v.amount)
        };
      },
      onSubmit: function (v) {
        var id = account ? account.id : v.savingsId;
        return api.post("/savingsaccounts/" + encodeURIComponent(id) + "/transactions?command=" + command, withDate({
          transactionDate: v.date, transactionAmount: String(v.amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || ""
        }));
      }
    });
  }

  async function repayDialog(loan) {
    var pt = await api.paymentTypeField();
    var fields = [];
    if (!loan) {
      fields.push({ key: "loanId", label: "Loan", type: "search", required: true, placeholder: "Loan account no or member name", search: function (q) { return api.searchLoans(q, true); } });
    }
    fields.push(amountField("Repayment amount (UGX)"), pt, dateField("Transaction date"), noteField());
    return api.openDialog({
      title: "Loan repayment", submitLabel: "Review", fields: fields,
      message: loan && loan.summary ? "Outstanding: " + api.formatMoney(loan.summary.totalOutstanding) + (Number(loan.summary.totalOverdue) > 0 ? " · Overdue: " + api.formatMoney(loan.summary.totalOverdue) : "") : "",
      confirm: function (v) {
        return {
          title: "Confirm repayment",
          lines: [
            ["Loan", loan ? "#" + loan.accountNo : (v.loanIdLabel || v.loanId)], ["Member", loan ? loan.clientName || "" : ""],
            ["Amount", api.formatMoney(v.amount)], ["Payment type", optionLabel(pt, v.paymentTypeId)], ["Date", v.date]
          ].filter(function (l) { return l[1]; }),
          confirmLabel: "Post repayment of " + api.formatMoney(v.amount)
        };
      },
      onSubmit: function (v) {
        var id = loan ? loan.id : v.loanId;
        return api.post("/loans/" + encodeURIComponent(id) + "/transactions?command=repayment", withDate({
          transactionDate: v.date, transactionAmount: String(v.amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || ""
        }));
      }
    });
  }

  function cashDialog(kind, c, sum) {
    var isAlloc = kind === "allocate";
    return api.openDialog({
      title: (isAlloc ? "Allocate cash to " : "Settle cash from ") + (c.cashierName || "cashier " + c.cashierId), submitLabel: "Review",
      message: sum ? "Current drawer: " + api.formatMoney(sum.netCash) : "",
      fields: [amountField(), dateField(), noteField(isAlloc ? "Vault allocation" : "Settle to vault")],
      confirm: function (v) {
        return {
          title: isAlloc ? "Confirm allocation" : "Confirm settlement",
          lines: [["Teller", c.tellerName || c.tellerId], ["Cashier", c.cashierName || c.cashierId], ["Amount", api.formatMoney(v.amount)], ["Date", v.date]],
          confirmLabel: (isAlloc ? "Allocate " : "Settle ") + api.formatMoney(v.amount)
        };
      },
      onSubmit: function (v) {
        return api.post("/tellers/" + encodeURIComponent(c.tellerId) + "/cashiers/" + encodeURIComponent(c.cashierId) + "/" + (isAlloc ? "allocate" : "settle"),
          cashPayload(v.amount, v.date, v.note || (isAlloc ? "Vault allocation" : "Settle to vault")));
      }
    });
  }

  if (page === "teller") {
    var setK = function (id, v) { var el = $(id); if (el) el.textContent = v; };
    var txnRows = function (items) {
      if (!items.length) return api.emptyRow(5, "No cashier transactions yet");
      return items.map(function (t) {
        var type = (t.txnType && (t.txnType.value || t.txnType)) || "—";
        var id = t.txnType && t.txnType.id;
        var inn = (id === 101 || id === 103) ? api.formatMoney(t.txnAmount) : "—";
        var out = (id === 102 || id === 104) ? api.formatMoney(t.txnAmount) : "—";
        var when = t.createdDate ? String(t.createdDate).replace("T", " ").slice(0, 16) : api.formatDate(t.txnDate);
        return '<tr><td class="mono">' + esc(when) + "</td><td>" + esc(type) + "</td><td>" + esc(t.txnNote || "—") +
          '</td><td class="mono text-right">' + inn + '</td><td class="mono text-right">' + out + "</td></tr>";
      }).join("");
    };
    var paintDesk = async function () {
      var c = await ensureSession();
      var sum = await summary(c.tellerId, c.cashierId);
      setK("kpi-allocated", api.formatMoney(sum.sumCashAllocation));
      setK("kpi-cash-in", api.formatMoney(sum.sumInwardCash));
      setK("kpi-cash-out", api.formatMoney(sum.sumOutwardCash));
      setK("kpi-settled", api.formatMoney(sum.sumCashSettlement));
      setK("kpi-net", api.formatMoney(sum.netCash));
      setK("kpi-net-meta", (sum.cashierName || c.cashierName || "") + " · " + (sum.tellerName || c.tellerName || ""));
      setK("page-sub", "Teller " + (sum.tellerName || c.tellerName || "") + " · cashier " + (sum.cashierName || c.cashierName || "") + " · " + (sum.officeName || ""));
      document.querySelector("#teller-txns tbody").innerHTML = txnRows((sum.cashierTransactions && sum.cashierTransactions.pageItems) || []);
      return sum;
    };
    var afterPost = function (msg) {
      return function (res) {
        if (!res) return;
        api.toast(msg, "success");
        return paintDesk();
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
          '</td><td><a class="btn btn-sm" href="' + esc(r.href) + '">Select</a></td></tr>';
      }).join("") || api.emptyRow(4, "No match (search is case-sensitive)");
    });
    onAction("open-session", async function () {
      var tellers = await api.get("/tellers");
      if (!Array.isArray(tellers) || !tellers.length) throw new Error("Create a teller first.");
      var packs = await Promise.all(tellers.map(function (t) { return api.get("/tellers/" + encodeURIComponent(t.id) + "/cashiers"); }));
      var options = [];
      packs.forEach(function (pack, i) {
        (pack.cashiers || []).forEach(function (c) {
          options.push({ value: tellers[i].id + ":" + c.id, label: tellers[i].name + " · " + (c.staffName || "cashier " + c.id) });
        });
      });
      if (!options.length) throw new Error("No cashier assignments yet.");
      var cur = ctx();
      var v = await api.openDialog({
        title: "Choose teller / cashier", submitLabel: "Use this cashier",
        fields: [{ key: "pair", label: "Teller / cashier", type: "select", required: true, value: cur.tellerId ? cur.tellerId + ":" + cur.cashierId : "", options: options }]
      });
      if (!v) return;
      var parts = String(v.pair).split(":");
      saveCtx({ tellerId: Number(parts[0]), cashierId: Number(parts[1]) });
      if (api.qs("tellerId") || api.qs("cashierId")) { location.href = "teller.html"; return; }
      await paintDesk();
    });
    onAction("allocate", async function () {
      var c = await ensureSession();
      return cashDialog("allocate", c, null).then(afterPost("Cash allocated"));
    });
    onAction("settle", async function () {
      var c = await ensureSession();
      var sum = await summary(c.tellerId, c.cashierId);
      return cashDialog("settle", c, sum).then(afterPost("Cash settled"));
    });
    onAction("deposit", function () { return savingsTxnDialog("deposit", null).then(afterPost("Deposit posted")); });
    onAction("withdrawal", function () { return savingsTxnDialog("withdrawal", null).then(afterPost("Withdrawal posted")); });
    onAction("repay", function () { return repayDialog(null).then(afterPost("Repayment posted")); });
    paintDesk().catch(fail);
  }

  if (page === "cashier-eod") {
    var eod = { expected: null, c: null };
    var parseCount = function (v) {
      var s = String(v || "").trim().replace(/,/g, "");
      if (!s) return 0;
      return /^\d+$/.test(s) ? Number(s) : NaN;
    };
    var counted = function () {
      var total = 0, bad = false;
      document.querySelectorAll("[data-denom]").forEach(function (inp) {
        var n = parseCount(inp.value);
        inp.setAttribute("aria-invalid", isNaN(n) ? "true" : "false");
        if (isNaN(n)) bad = true;
        else total += n * Number(inp.getAttribute("data-denom"));
      });
      return bad ? NaN : total;
    };
    var anyCount = function () {
      return Array.prototype.some.call(document.querySelectorAll("[data-denom]"), function (i) { return i.value.trim() !== ""; });
    };
    var refreshVariance = function () {
      var got = counted();
      var box = $("eod-variance-box");
      if (!anyCount()) {
        $("eod-counted").textContent = "—";
        $("eod-variance").textContent = "—";
        $("eod-variance-note").textContent = "Enter the denomination count to compare with the expected drawer.";
        box.className = "recon-box";
        return;
      }
      if (isNaN(got)) {
        $("eod-counted").textContent = "—";
        $("eod-variance").textContent = "—";
        $("eod-variance-note").textContent = "Counts must be whole numbers.";
        box.className = "recon-box warn";
        return;
      }
      $("eod-counted").textContent = api.formatMoney(got);
      if (eod.expected === null) return;
      var diff = got - eod.expected;
      $("eod-variance").textContent = (diff < 0 ? "−" : diff > 0 ? "+" : "") + api.formatNumber(Math.abs(diff));
      $("eod-variance-note").textContent = diff === 0 ? "Counted cash matches the expected drawer." :
        (diff < 0 ? "Short by " : "Over by ") + api.formatMoney(Math.abs(diff)) + " against expected " + api.formatMoney(eod.expected) + ".";
      box.className = "recon-box " + (diff === 0 ? "ok" : "warn");
    };
    var paintEod = async function () {
      var c = await ensureSession();
      var sum = await summary(c.tellerId, c.cashierId);
      eod.c = c;
      eod.expected = Number(sum.netCash || 0);
      $("eod-allocated").textContent = api.formatNumber(sum.sumCashAllocation);
      $("eod-cash-in").textContent = api.formatNumber(sum.sumInwardCash);
      $("eod-cash-out").textContent = api.formatNumber(sum.sumOutwardCash);
      $("eod-settled").textContent = api.formatNumber(sum.sumCashSettlement);
      $("eod-expected").textContent = api.formatNumber(sum.netCash);
      $("eod-cashier").textContent = (sum.cashierName || c.cashierName || "") + " · " + (sum.tellerName || c.tellerName || "");
      $("page-sub").textContent = "Teller " + (sum.tellerName || "") + " · cashier " + (sum.cashierName || "") + " · " + (sum.officeName || "");
      refreshVariance();
    };
    document.querySelectorAll("[data-denom]").forEach(function (inp) { inp.addEventListener("input", refreshVariance); });
    if ($("settle-date")) { $("settle-date").value = api.todayISO(); $("settle-date").max = api.todayISO(); }
    onSubmitForm($("settle-form"), async function () {
      if (!eod.c) throw new Error("Cashier not loaded yet.");
      var amount = api.parseAmount($("settle-amount").value);
      var date = $("settle-date").value;
      var note = $("settle-note").value.trim();
      if (!(amount > 0)) throw new Error("Settle amount must be a whole number of UGX greater than zero.");
      if (!api.isISODate(date)) throw new Error("Choose a valid date.");
      var got = counted();
      var lines = [["Teller", eod.c.tellerName || eod.c.tellerId], ["Cashier", eod.c.cashierName || eod.c.cashierId],
        ["Settle amount", api.formatMoney(amount)], ["Date", date], ["Expected drawer", api.formatMoney(eod.expected)]];
      if (anyCount() && !isNaN(got)) lines.push(["Counted", api.formatMoney(got)], ["Variance", api.formatMoney(got - eod.expected)]);
      var ok = await api.confirmDialog({
        title: "Settle cash to vault", summary: "Confirm settlement", lines: lines, confirmLabel: "Settle " + api.formatMoney(amount),
        onConfirm: function () {
          return api.post("/tellers/" + encodeURIComponent(eod.c.tellerId) + "/cashiers/" + encodeURIComponent(eod.c.cashierId) + "/settle", cashPayload(amount, date, note || "EOD settle"));
        }
      });
      if (!ok) return;
      api.toast("Settled " + api.formatMoney(amount), "success");
      $("settle-amount").value = "";
      await paintEod();
    });
    paintEod().catch(fail);
  }

  /* ================================================================ JOURNAL ENTRY */
  if (page === "journal") {
    var form = $("journal-form");
    var linesBody = document.querySelector("#je-lines tbody");
    var glOpts = [];
    var lineSeq = 0;
    var jeError = function (msg) { var el = $("je-error"); el.textContent = msg || ""; el.hidden = !msg; };
    var addLine = function () {
      lineSeq += 1;
      var n = lineSeq;
      var tr = document.createElement("tr");
      tr.innerHTML = '<td><label class="sr-only" for="je-gl-' + n + '">GL account, line ' + n + "</label>" +
        '<select id="je-gl-' + n + '" class="je-gl"><option value="">— Select GL account —</option>' + glOpts.map(function (g) {
          return '<option value="' + esc(g.id) + '">' + esc(g.label) + "</option>";
        }).join("") + "</select></td>" +
        '<td><label class="sr-only" for="je-dr-' + n + '">Debit, line ' + n + '</label><input id="je-dr-' + n + '" class="mono text-right je-dr" inputmode="numeric" autocomplete="off" /></td>' +
        '<td><label class="sr-only" for="je-cr-' + n + '">Credit, line ' + n + '</label><input id="je-cr-' + n + '" class="mono text-right je-cr" inputmode="numeric" autocomplete="off" /></td>' +
        '<td><button type="button" class="btn btn-sm btn-ghost" data-remove-line aria-label="Remove line ' + n + '">✕</button></td>';
      linesBody.appendChild(tr);
    };
    var readLines = function () {
      var out = { debits: [], credits: [], dr: 0, cr: 0, error: "" };
      linesBody.querySelectorAll("tr").forEach(function (tr, i) {
        var gl = tr.querySelector(".je-gl");
        var drRaw = tr.querySelector(".je-dr").value.trim();
        var crRaw = tr.querySelector(".je-cr").value.trim();
        if (!drRaw && !crRaw) return;
        var label = "Line " + (i + 1);
        if (drRaw && crRaw) { out.error = out.error || label + ": enter a debit or a credit, not both."; return; }
        var amt = api.parseAmount(drRaw || crRaw);
        if (!(amt > 0)) { out.error = out.error || label + ": amount must be a whole number of UGX greater than zero."; return; }
        if (!gl.value) { out.error = out.error || label + ": choose a GL account."; return; }
        var entry = { glAccountId: Number(gl.value), amount: amt, label: gl.options[gl.selectedIndex].text };
        if (drRaw) { out.debits.push(entry); out.dr += amt; } else { out.credits.push(entry); out.cr += amt; }
      });
      return out;
    };
    var updateTotals = function () {
      var r = readLines();
      $("je-total-dr").textContent = api.formatNumber(r.dr);
      $("je-total-cr").textContent = api.formatNumber(r.cr);
    };
    linesBody.addEventListener("input", updateTotals);
    linesBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-remove-line]");
      if (!b) return;
      if (linesBody.querySelectorAll("tr").length <= 2) { api.toast("A journal needs at least two lines", "error"); return; }
      b.closest("tr").remove();
      updateTotals();
    });
    $("je-add-line").addEventListener("click", addLine);
    var resetForm = function () {
      linesBody.innerHTML = "";
      addLine(); addLine();
      $("je-narration").value = "";
      $("je-ref").value = "";
      updateTotals();
    };
    (async function () {
      var res = await Promise.all([
        loadOffices(), api.get("/glaccounts"),
        api.paymentTypes().catch(function () { return []; }),
        api.get("/accountingrules").catch(function () { return []; })
      ]);
      var offices = res[0];
      var gls = Array.isArray(res[1]) ? res[1] : [];
      glOpts = gls.filter(function (g) { return g.usage && g.usage.id === 1 && !g.disabled && g.manualEntriesAllowed; })
        .sort(function (a, b) { return String(a.glCode).localeCompare(String(b.glCode)); })
        .map(function (g) { return { id: g.id, label: (g.glCode || "") + " " + g.name }; });
      $("je-office-sel").innerHTML = offices.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>"; }).join("");
      $("je-office-sel").value = defaultOffice(offices);
      $("je-date").value = api.todayISO();
      $("je-date").max = api.todayISO();
      $("je-paytype").innerHTML = '<option value="">— None —</option>' + res[2].map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("");
      var rules = Array.isArray(res[3]) ? res[3] : [];
      $("je-rule").innerHTML = '<option value="">— None —</option>' + rules.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + "</option>"; }).join("");
      if (api.qs("rule")) $("je-rule").value = api.qs("rule");
      if (!glOpts.length) jeError("No GL accounts allow manual entries. Create or enable one under Chart of accounts.");
      resetForm();
    })().catch(fail);
    onSubmitForm(form, async function () {
      jeError("");
      var officeSel = $("je-office-sel");
      var date = $("je-date").value;
      var narration = $("je-narration").value.trim();
      var r = readLines();
      if (!officeSel.value) return jeError("Choose an office.");
      if (!api.isISODate(date)) return jeError("Choose a valid value date.");
      if (!narration) return jeError("Narration is required.");
      if (r.error) return jeError(r.error);
      if (!r.debits.length || !r.credits.length) return jeError("Enter at least one debit line and one credit line.");
      if (r.dr !== r.cr) return jeError("Debits (" + api.formatNumber(r.dr) + ") must equal credits (" + api.formatNumber(r.cr) + ").");
      var body = withDate({
        officeId: Number(officeSel.value), transactionDate: date, currencyCode: CCY, comments: narration,
        debits: r.debits.map(function (d) { return { glAccountId: d.glAccountId, amount: d.amount }; }),
        credits: r.credits.map(function (c) { return { glAccountId: c.glAccountId, amount: c.amount }; })
      });
      if ($("je-ref").value.trim()) body.referenceNumber = $("je-ref").value.trim();
      if ($("je-paytype").value) body.paymentTypeId = Number($("je-paytype").value);
      if ($("je-rule").value) body.accountingRule = Number($("je-rule").value);
      var lines = [["Office", officeSel.options[officeSel.selectedIndex].text], ["Value date", date]];
      r.debits.forEach(function (d) { lines.push(["Dr " + d.label, api.formatMoney(d.amount)]); });
      r.credits.forEach(function (c) { lines.push(["Cr " + c.label, api.formatMoney(c.amount)]); });
      lines.push(["Total", api.formatMoney(r.dr)]);
      var result = null;
      var ok = await api.confirmDialog({
        title: "Post journal entry", summary: "Confirm journal", lines: lines, confirmLabel: "Post journal of " + api.formatMoney(r.dr),
        onConfirm: function () { return api.post("/journalentries", body).then(function (x) { result = x; }); }
      });
      if (!ok) return;
      api.toast("Journal posted" + (result && result.transactionId ? " · " + result.transactionId : ""), "success");
      resetForm();
    });
  }

  /* ================================================================ LOAN APPLICATION */
  if (page === "loan-apply") {
    var wiz = $("loan-wizard");
    var la = { client: null, tmpl: null, products: [] };
    var laErr = function (msg) { var el = $("la-error"); el.textContent = msg || ""; el.hidden = !msg; };
    var clientInput = $("la-client");
    var productSel = $("la-product");
    $("la-submitted").value = api.todayISO();
    $("la-submitted").max = api.todayISO();
    $("la-disbursement").value = api.todayISO();

    var loadTemplate = async function () {
      la.tmpl = null;
      if (!la.client || !productSel.value) return;
      var t = await api.get("/loans/template?templateType=individual&clientId=" + encodeURIComponent(la.client.id) + "&productId=" + encodeURIComponent(productSel.value));
      la.tmpl = t;
      var prod = t.product || {};
      $("la-principal-help").textContent = prod.minPrincipal !== undefined ?
        "Allowed: " + api.formatMoney(prod.minPrincipal) + " – " + api.formatMoney(prod.maxPrincipal) : "";
      $("la-repayments").value = t.numberOfRepayments || "";
      $("la-frequency").value = "Every " + (t.repaymentEvery || 1) + " " + ((t.repaymentFrequencyType && t.repaymentFrequencyType.value) || "").toLowerCase();
      $("la-interest").value = t.interestRatePerPeriod !== undefined ? t.interestRatePerPeriod + " " + ((t.interestRateFrequencyType && t.interestRateFrequencyType.value) || "").toLowerCase() : "";
      $("la-amortization").value = (t.amortizationType && t.amortizationType.value) || "";
      var officers = t.loanOfficerOptions || [];
      $("la-officer").innerHTML = '<option value="">— None —</option>' + officers.map(function (o) {
        return '<option value="' + esc(o.id) + '">' + esc(o.displayName) + "</option>";
      }).join("");
      var charges = t.charges || [];
      document.querySelector("#la-charges tbody").innerHTML = charges.map(function (c) {
        var pct = c.chargeCalculationType && c.chargeCalculationType.id !== 1;
        return "<tr><td>" + esc(c.name || "") + '</td><td class="mono text-right">' + (pct ? esc(c.amount) + "%" : api.formatMoney(c.amount)) + "</td></tr>";
      }).join("") || api.emptyRow(2, "This product has no default charges.");
    };

    api.typeahead(clientInput, {
      fetch: api.searchClients,
      onInput: function () { la.client = null; $("la-client-note").textContent = "Choose a member from the search results."; },
      onSelect: function (item) {
        la.client = { id: item.value, name: item.label };
        clientInput.value = item.label;
        $("la-client-note").textContent = "Selected: " + item.label + " (" + item.sub + ")";
        loadTemplate().catch(fail);
      }
    });
    productSel.addEventListener("change", function () { loadTemplate().catch(fail); });

    (async function () {
      var products = await api.get("/loanproducts");
      la.products = Array.isArray(products) ? products : [];
      productSel.innerHTML = '<option value="">— Select product —</option>' + la.products.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>";
      }).join("");
      var pre = api.qs("clientId");
      if (pre) {
        var c = await api.get("/clients/" + encodeURIComponent(pre));
        la.client = { id: c.id, name: fullName(c) };
        clientInput.value = fullName(c);
        $("la-client-note").textContent = "Selected: " + fullName(c) + " (#" + (c.accountNo || c.id) + ")";
      }
    })().catch(fail);

    var validateStep = function (step) {
      if (step === 0) {
        if (!la.client) return "Choose a member from the search results.";
        if (!productSel.value) return "Choose a loan product.";
        if (!api.isISODate($("la-submitted").value)) return "Enter the submitted date.";
        if (!la.tmpl) return "Loading product terms… try again in a moment.";
      }
      if (step === 1) {
        var p = api.parseAmount($("la-principal").value);
        if (!(p > 0)) return "Principal must be a whole number of UGX greater than zero.";
        var prod = la.tmpl.product || {};
        if (prod.minPrincipal !== undefined && (p < prod.minPrincipal || p > prod.maxPrincipal)) return "Principal must be between " + api.formatMoney(prod.minPrincipal) + " and " + api.formatMoney(prod.maxPrincipal) + ".";
        var n = Number($("la-repayments").value);
        if (!Number.isInteger(n) || n < 1) return "Number of repayments must be a whole number of at least 1.";
        if (!api.isISODate($("la-disbursement").value)) return "Enter the expected disbursement date.";
        if ($("la-disbursement").value < $("la-submitted").value) return "Expected disbursement cannot be before the submitted date.";
      }
      return "";
    };
    wiz.addEventListener("wizard:beforenext", function (ev) {
      var problem = validateStep(ev.detail.step);
      laErr(problem);
      if (problem) ev.preventDefault();
    });
    wiz.addEventListener("wizard:step", function (ev) {
      if (ev.detail.step !== 3) return;
      $("la-review-client").textContent = la.client ? la.client.name : "—";
      $("la-review-product").textContent = productSel.options[productSel.selectedIndex] ? productSel.options[productSel.selectedIndex].text : "—";
      $("la-review-principal").textContent = api.formatMoney(api.parseAmount($("la-principal").value));
      $("la-review-term").textContent = $("la-repayments").value + " × " + $("la-frequency").value.toLowerCase();
      $("la-review-disb").textContent = $("la-disbursement").value;
    });
    wiz.addEventListener("wizard:complete", async function (ev) {
      var btn = ev.detail.button;
      var problem = validateStep(0) || validateStep(1);
      if (problem) { laErr(problem); return; }
      laErr("");
      var t = la.tmpl;
      var idOf = function (o) { return o && (o.id !== undefined ? o.id : o); };
      var n = Number($("la-repayments").value);
      var every = t.repaymentEvery || 1;
      var body = withDate({
        clientId: Number(la.client.id), productId: Number(productSel.value), principal: api.parseAmount($("la-principal").value),
        loanTermFrequency: n * every, loanTermFrequencyType: idOf(t.repaymentFrequencyType),
        numberOfRepayments: n, repaymentEvery: every, repaymentFrequencyType: idOf(t.repaymentFrequencyType),
        interestRatePerPeriod: t.interestRatePerPeriod, amortizationType: idOf(t.amortizationType), interestType: idOf(t.interestType),
        interestCalculationPeriodType: idOf(t.interestCalculationPeriodType),
        transactionProcessingStrategyCode: t.transactionProcessingStrategyCode,
        expectedDisbursementDate: $("la-disbursement").value, submittedOnDate: $("la-submitted").value, loanType: "individual"
      });
      if ($("la-officer").value) body.loanOfficerId = Number($("la-officer").value);
      if ((t.charges || []).length) {
        body.charges = t.charges.map(function (c) {
          var ch = { chargeId: c.chargeId, amount: c.amount };
          if (c.dueDate) ch.dueDate = api.formatDate(c.dueDate);
          return ch;
        });
      }
      btn.disabled = true;
      btn.textContent = "Submitting…";
      try {
        var created = await api.post("/loans", body);
        var loanId = created.loanId || created.resourceId;
        api.toast("Loan application submitted", "success");
        location.href = "loan-detail.html?id=" + encodeURIComponent(loanId);
      } catch (err) {
        laErr(err.message || String(err));
        btn.disabled = false;
        btn.textContent = "Submit application";
      }
    });
  }

  /* ================================================================ LOAN DETAIL */
  if (page === "loan-detail") {
    var box = $("loan-actions");
    var current = null;
    var principalOf = function (loan) { return loan.approvedPrincipal || loan.principal || loan.proposedPrincipal; };
    var done = function (msg) { return function (r) { if (r) { api.toast(msg, "success"); refresh(); } }; };
    var approve = async function () {
      var loan = current;
      var fields = [
        dateField("Approved on", "date"),
        { key: "amount", label: "Approved amount (UGX)", amount: true, placeholder: "Leave blank to approve " + api.formatNumber(loan.proposedPrincipal || loan.principal), help: "Proposed: " + api.formatMoney(loan.proposedPrincipal || loan.principal) },
        { key: "expected", label: "Expected disbursement", type: "date", required: true, value: api.formatDate(loan.timeline && loan.timeline.expectedDisbursementDate) },
        noteField()
      ];
      return api.openDialog({
        title: "Approve loan #" + loan.accountNo, submitLabel: "Review", fields: fields,
        validate: function (v) { return v.expected < v.date ? "Expected disbursement cannot be before the approval date." : ""; },
        confirm: function (v) {
          return {
            title: "Confirm approval",
            lines: [["Member", loan.clientName], ["Loan", "#" + loan.accountNo + " · " + loan.loanProductName],
              ["Approved amount", api.formatMoney(v.amount || loan.proposedPrincipal || loan.principal)], ["Approved on", v.date], ["Expected disbursement", v.expected]],
            confirmLabel: "Approve loan"
          };
        },
        onSubmit: function (v) {
          var body = withDate({ approvedOnDate: v.date, expectedDisbursementDate: v.expected, note: v.note || "" });
          if (v.amount) body.approvedLoanAmount = v.amount;
          return api.post("/loans/" + encodeURIComponent(loan.id) + "?command=approve", body);
        }
      }).then(done("Loan approved"));
    };
    var reject = async function () {
      var loan = current;
      return api.openDialog({
        title: "Reject loan #" + loan.accountNo, submitLabel: "Review",
        fields: [dateField("Rejected on"), { key: "note", label: "Reason", type: "textarea", required: true }],
        confirm: function (v) {
          return { title: "Confirm rejection", lines: [["Member", loan.clientName], ["Loan", "#" + loan.accountNo], ["Amount", api.formatMoney(loan.proposedPrincipal || loan.principal)], ["Rejected on", v.date]], note: "This cannot be undone from Desk.", confirmLabel: "Reject loan" };
        },
        onSubmit: function (v) {
          return api.post("/loans/" + encodeURIComponent(loan.id) + "?command=reject", withDate({ rejectedOnDate: v.date, note: v.note }));
        }
      }).then(done("Loan rejected"));
    };
    var disburse = async function () {
      var loan = current;
      var pt = await api.paymentTypeField();
      return api.openDialog({
        title: "Disburse loan #" + loan.accountNo, submitLabel: "Review",
        message: "Approved amount: " + api.formatMoney(principalOf(loan)),
        fields: [dateField("Disbursement date"), amountField("Disbursement amount (UGX)"), pt, noteField()],
        confirm: function (v) {
          return {
            title: "Confirm disbursement",
            lines: [["Member", loan.clientName], ["Loan", "#" + loan.accountNo + " · " + loan.loanProductName], ["Amount", api.formatMoney(v.amount)],
              ["Payment type", optionLabel(pt, v.paymentTypeId)], ["Date", v.date]],
            confirmLabel: "Disburse " + api.formatMoney(v.amount)
          };
        },
        onSubmit: function (v) {
          return api.post("/loans/" + encodeURIComponent(loan.id) + "?command=disburse", withDate({
            actualDisbursementDate: v.date, transactionAmount: String(v.amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || ""
          }));
        }
      }).then(done("Loan disbursed"));
    };
    var repay = function () { return repayDialog(current).then(done("Repayment posted")); };

    document.addEventListener("desk:loan", function (e) {
      current = e.detail;
      var st = current.status || {};
      var list = [];
      if (st.pendingApproval) {
        if (api.can("APPROVE_LOAN")) list.push(["approve", "Approve", "btn-amber", approve]);
        if (api.can("REJECT_LOAN")) list.push(["reject", "Reject", "btn-ghost", reject]);
      } else if (st.waitingForDisbursal) {
        if (api.can("DISBURSE_LOAN")) list.push(["disburse", "Disburse", "btn-amber", disburse]);
      } else if (st.active) {
        if (api.can("REPAYMENT_LOAN")) list.push(["repay", "Repay", "btn-amber", repay]);
      }
      box.innerHTML = "";
      list.forEach(function (a) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn " + a[2];
        b.textContent = a[1];
        b.setAttribute("data-loan-action", a[0]);
        on(b, a[3]);
        box.appendChild(b);
      });
    });
  }

  /* ================================================================ SAVINGS */
  async function openSavingsDialog(preset) {
    var products = await api.get("/savingsproducts");
    products = Array.isArray(products) ? products : [];
    if (!products.length) throw new Error("No savings products are configured.");
    var canActivate = api.can(["APPROVE_SAVINGSACCOUNT"]) && api.can(["ACTIVATE_SAVINGSACCOUNT"]);
    var fields = [
      preset ? null : { key: "clientId", label: "Member", type: "search", required: true, search: api.searchClients },
      { key: "productId", label: "Product", type: "select", required: true, placeholder: "— Select product —", value: products.length === 1 ? String(products[0].id) : "", options: products.map(function (p) { return { value: p.id, label: p.name }; }) },
      dateField("Submitted on"),
      canActivate ? { key: "activate", label: "After submitting", type: "select", value: "yes", options: [{ value: "yes", label: "Approve and activate now" }, { value: "no", label: "Leave pending approval" }] } : null
    ].filter(Boolean);
    var result = null;
    var warning = "";
    var v = await api.openDialog({
      title: "Open savings account" + (preset ? " for " + preset.name : ""), submitLabel: "Open account", fields: fields,
      onSubmit: async function (val) {
        var clientId = preset ? preset.id : val.clientId;
        var created = await api.post("/savingsaccounts", withDate({ clientId: Number(clientId), productId: Number(val.productId), submittedOnDate: val.date }));
        var id = created.savingsId || created.resourceId;
        result = id;
        if (val.activate === "yes") {
          /* The account exists now — never let a retry create a second one. */
          try {
            await api.post("/savingsaccounts/" + encodeURIComponent(id) + "?command=approve", withDate({ approvedOnDate: val.date }));
            await api.post("/savingsaccounts/" + encodeURIComponent(id) + "?command=activate", withDate({ activatedOnDate: val.date }));
          } catch (err) {
            warning = err.message || String(err);
          }
        }
      }
    });
    if (v && result) {
      api.toast(warning ? "Account created but not activated: " + warning : "Savings account opened", warning ? "error" : "success");
      setTimeout(function () { location.href = "savings-detail.html?id=" + encodeURIComponent(result); }, warning ? 2500 : 300);
    }
  }
  if (page === "savings") onAction("open-savings", function () { return openSavingsDialog(null); });

  if (page === "savings-detail") {
    var account = null;
    document.addEventListener("desk:savings", function (e) {
      account = e.detail;
      var active = !!(account.status && account.status.active);
      actions("deposit").forEach(function (b) { b.hidden = !(active && api.can("DEPOSIT_SAVINGSACCOUNT")); });
      actions("withdrawal").forEach(function (b) { b.hidden = !(active && api.can("WITHDRAWAL_SAVINGSACCOUNT")); });
    });
    var post = function (command, msg) {
      return function () {
        if (!account) throw new Error("Account not loaded yet.");
        return savingsTxnDialog(command, account).then(function (r) { if (r) { api.toast(msg, "success"); refresh(); } });
      };
    };
    onAction("deposit", post("deposit", "Deposit posted"));
    onAction("withdrawal", post("withdrawal", "Withdrawal posted"));
  }

  /* ================================================================ GROUPS / CENTRES */
  function groupDialog(kind) {
    return async function () {
      var offices = await loadOffices();
      var v = await api.openDialog({
        title: kind === "group" ? "Create group" : "Create centre", submitLabel: "Create",
        fields: [
          { key: "name", label: "Name", required: true },
          { key: "officeId", label: "Office", type: "select", required: true, value: defaultOffice(offices), options: officeOpts(offices) },
          dateField("Activation date")
        ],
        onSubmit: function (val) {
          return api.post(kind === "group" ? "/groups" : "/centers", withDate({ officeId: Number(val.officeId), name: val.name.trim(), active: true, activationDate: val.date, submittedOnDate: val.date }));
        }
      });
      if (v) { api.toast(kind === "group" ? "Group created" : "Centre created", "success"); refresh(); }
    };
  }
  if (page === "groups") onAction("create-group", groupDialog("group"));
  if (page === "centres") onAction("create-centre", groupDialog("centre"));

  /* ================================================================ ACCOUNTING */
  if (page === "accounting") {
    var glParent = $("gl-parent");
    var fillParents = async function () {
      var gls = await api.get("/glaccounts");
      var type = $("gl-type").value;
      var headers = (Array.isArray(gls) ? gls : []).filter(function (g) { return g.usage && g.usage.id === 2 && String(g.type && g.type.id) === type; });
      glParent.innerHTML = '<option value="">— None —</option>' + headers.map(function (g) {
        return '<option value="' + esc(g.id) + '">' + esc((g.glCode || "") + " " + g.name) + "</option>";
      }).join("");
    };
    if (glParent) {
      $("gl-type").addEventListener("change", function () { fillParents().catch(fail); });
      fillParents().catch(fail);
    }
    onSubmitForm($("gl-form"), async function (f) {
      var name = $("gl-name").value.trim();
      var code = $("gl-code").value.trim();
      if (!name || !code) throw new Error("Name and GL code are required.");
      var body = { name: name, glCode: code, type: Number($("gl-type").value), usage: Number($("gl-usage").value), manualEntriesAllowed: $("gl-manual").value === "true", description: name };
      if (glParent.value) body.parentId = Number(glParent.value);
      await api.post("/glaccounts", body);
      api.toast("GL account created", "success");
      f.reset();
      await fillParents();
      refresh();
    });
  }

  if (page === "closing") {
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-del-closure]");
      if (!b) return;
      api.confirmDialog({
        title: "Delete period closure", message: "Delete the closure “" + b.getAttribute("data-label") + "”? Journal entries on or before that date will be allowed again.",
        confirmLabel: "Delete closure",
        onConfirm: function () { return api.del("/glclosures/" + encodeURIComponent(b.getAttribute("data-del-closure"))); }
      }).then(function (ok) { if (ok) { api.toast("Closure deleted", "success"); refresh(); } }).catch(fail);
    });
    onAction("create-closure", async function () {
      var offices = await loadOffices();
      var officeField = { key: "officeId", label: "Office", type: "select", required: true, value: defaultOffice(offices), options: officeOpts(offices) };
      var v = await api.openDialog({
        title: "Close period", submitLabel: "Review",
        fields: [officeField, dateField("Closing date", "closingDate"), { key: "comments", label: "Comments", required: true }],
        confirm: function (val) {
          return { title: "Confirm period close", lines: [["Office", optionLabel(officeField, val.officeId)], ["Closing date", val.closingDate]], note: "Journal entries dated on or before this date will be blocked for this office.", confirmLabel: "Close period" };
        },
        onSubmit: function (val) { return api.post("/glclosures", withDate({ officeId: Number(val.officeId), closingDate: val.closingDate, comments: val.comments })); }
      });
      if (v) { api.toast("Period closed", "success"); refresh(); }
    });
  }

  if (page === "rules") {
    onAction("create-rule", async function () {
      var res = await Promise.all([api.get("/glaccounts"), loadOffices()]);
      var opts = (Array.isArray(res[0]) ? res[0] : []).filter(function (g) { return g.usage && g.usage.id === 1 && !g.disabled; })
        .map(function (g) { return { value: g.id, label: (g.glCode || "") + " " + g.name }; });
      var v = await api.openDialog({
        title: "Create accounting rule", submitLabel: "Create",
        fields: [
          { key: "name", label: "Name", required: true },
          { key: "officeId", label: "Office", type: "select", required: true, value: defaultOffice(res[1]), options: officeOpts(res[1]) },
          { key: "debit", label: "Debit GL", type: "select", required: true, placeholder: "— Select —", options: opts },
          { key: "credit", label: "Credit GL", type: "select", required: true, placeholder: "— Select —", options: opts },
          { key: "description", label: "Description" }
        ],
        validate: function (val) { return val.debit === val.credit ? "Debit and credit accounts must differ." : ""; },
        onSubmit: function (val) {
          return api.post("/accountingrules", { name: val.name.trim(), officeId: Number(val.officeId), description: val.description || val.name.trim(), accountToDebit: Number(val.debit), accountToCredit: Number(val.credit) });
        }
      });
      if (v) { api.toast("Rule created", "success"); refresh(); }
    });
    onSubmitForm($("rule-post-form"), async function () {
      var id = $("rule-post-select").value;
      if (!id) throw new Error("Choose a rule.");
      location.href = "journal-entry.html?rule=" + encodeURIComponent(id);
    });
  }

  if (page === "mappings") {
    onAction("create-mapping", async function () {
      var gls = await api.get("/glaccounts");
      var opts = (Array.isArray(gls) ? gls : []).filter(function (g) { return g.usage && g.usage.id === 1; })
        .map(function (g) { return { value: g.id, label: (g.glCode || "") + " " + g.name }; });
      var v = await api.openDialog({
        title: "Map financial activity", submitLabel: "Save mapping",
        fields: [
          { key: "financialActivityId", label: "Activity", type: "select", required: true, placeholder: "— Select —", options: [
            { value: "100", label: "Asset transfer" }, { value: "101", label: "Cash at main vault" }, { value: "102", label: "Cash at teller" },
            { value: "103", label: "Fund source" }, { value: "200", label: "Liability transfer" }, { value: "300", label: "Opening balances contra" }
          ] },
          { key: "glAccountId", label: "GL account", type: "select", required: true, placeholder: "— Select —", options: opts }
        ],
        onSubmit: function (val) { return api.post("/financialactivityaccounts", { financialActivityId: Number(val.financialActivityId), glAccountId: Number(val.glAccountId) }); }
      });
      if (v) { api.toast("Mapping saved", "success"); refresh(); }
    });
  }

  if (page === "accruals") {
    var till = $("accrual-till");
    if (till) { till.value = api.todayISO(); till.max = api.todayISO(); }
    onSubmitForm($("accruals-form"), async function () {
      if (!api.isISODate(till.value)) throw new Error("Choose a valid till date.");
      var ok = await api.confirmDialog({
        title: "Run accruals", summary: "Confirm accrual run", lines: [["Till date", till.value]], confirmLabel: "Run accruals",
        onConfirm: function () { return api.post("/runaccruals", withDate({ tillDate: till.value })); }
      });
      if (ok) api.toast("Accruals run up to " + till.value, "success");
    });
  }

  /* ================================================================ CLIENT ONBOARD */
  if (page === "onboard") {
    var ob = $("onboard-wizard");
    var obErr = function (msg) { var el = $("ob-error"); el.textContent = msg || ""; el.hidden = !msg; };
    var val = function (id) { var el = $(id); return el ? String(el.value || "").trim() : ""; };
    $("ob-submitted").value = api.todayISO();
    $("ob-submitted").max = api.todayISO();
    $("ob-dob").max = api.todayISO();
    var fillStaff = async function () {
      var t = await api.get("/clients/template?officeId=" + encodeURIComponent($("ob-office").value));
      $("ob-staff").innerHTML = '<option value="">— None —</option>' + (t.staffOptions || []).map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.displayName) + "</option>";
      }).join("");
    };
    (async function () {
      var t = await api.get("/clients/template");
      var offices = t.officeOptions || [];
      $("ob-office").innerHTML = offices.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>"; }).join("");
      $("ob-office").value = defaultOffice(offices);
      var genders = t.genderOptions || [];
      $("ob-gender").innerHTML = '<option value="">' + (genders.length ? "— Not set —" : "— None configured —") + "</option>" + genders.map(function (g) {
        return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>";
      }).join("");
      await fillStaff();
      var codes = await api.get("/codes").catch(function () { return []; });
      var code = (Array.isArray(codes) ? codes : []).filter(function (c) { return c.name === "Customer Identifier"; })[0];
      var values = code ? await api.get("/codes/" + encodeURIComponent(code.id) + "/codevalues").catch(function () { return []; }) : [];
      values = (Array.isArray(values) ? values : []).filter(function (v) { return v.active !== false; });
      if (values.length) {
        $("ob-doctype").innerHTML = '<option value="">— None —</option>' + values.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>"; }).join("");
      } else {
        $("ob-doctype").disabled = true;
        $("ob-dockey").disabled = true;
        $("ob-doctype-note").textContent = "No identifier types are configured. Add values to the “Customer Identifier” code in Fineract to capture ID numbers.";
      }
    })().catch(fail);
    $("ob-office").addEventListener("change", function () { fillStaff().catch(fail); });

    var obValidate = function (step) {
      if (step === 0) {
        if (!val("ob-firstname") || !val("ob-lastname")) return "First and last name are required.";
        if (val("ob-dob") && val("ob-dob") > api.todayISO()) return "Date of birth cannot be in the future.";
        if (val("ob-email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("ob-email"))) return "Enter a valid email address or leave it blank.";
      }
      if (step === 1) {
        var f = $("ob-photo").files && $("ob-photo").files[0];
        if (f && !/^image\//.test(f.type)) return "The photo must be an image file.";
        if (f && f.size > 5 * 1024 * 1024) return "The photo must be smaller than 5 MB.";
      }
      if (step === 2) {
        if (!!val("ob-doctype") !== !!val("ob-dockey")) return "Enter both the document type and the document number, or neither.";
      }
      if (step === 3) {
        if (!val("ob-office")) return "Choose an office.";
        if (!api.isISODate(val("ob-submitted"))) return "Enter the activation date.";
      }
      return "";
    };
    ob.addEventListener("wizard:beforenext", function (ev) {
      var p = obValidate(ev.detail.step);
      obErr(p);
      if (p) ev.preventDefault();
    });
    ob.addEventListener("wizard:step", function (ev) {
      if (ev.detail.step !== 4) return;
      var officeSel = $("ob-office");
      var docSel = $("ob-doctype");
      $("ob-review-name").textContent = val("ob-firstname") + " " + val("ob-lastname");
      $("ob-review-mobile").textContent = val("ob-mobile") || "—";
      $("ob-review-office").textContent = officeSel.options[officeSel.selectedIndex] ? officeSel.options[officeSel.selectedIndex].text : "—";
      $("ob-review-id").textContent = val("ob-dockey") ? docSel.options[docSel.selectedIndex].text + " · " + val("ob-dockey") : "—";
      $("ob-review-date").textContent = val("ob-submitted");
    });
    ob.addEventListener("wizard:complete", async function (ev) {
      var btn = ev.detail.button;
      for (var s = 0; s < 4; s++) {
        var p = obValidate(s);
        if (p) { obErr(p); return; }
      }
      obErr("");
      var payload = withDate({
        officeId: Number(val("ob-office")), firstname: val("ob-firstname"), lastname: val("ob-lastname"),
        legalFormId: 1, active: true, activationDate: val("ob-submitted"), submittedOnDate: val("ob-submitted")
      });
      if (val("ob-mobile")) payload.mobileNo = val("ob-mobile");
      if (val("ob-email")) payload.emailAddress = val("ob-email");
      if (val("ob-external")) payload.externalId = val("ob-external");
      if (val("ob-dob")) payload.dateOfBirth = val("ob-dob");
      if (val("ob-gender")) payload.genderId = Number(val("ob-gender"));
      if (val("ob-staff")) payload.staffId = Number(val("ob-staff"));
      btn.disabled = true;
      btn.textContent = "Creating…";
      var id = null;
      try {
        var res = await api.post("/clients", payload);
        id = res.clientId || res.resourceId;
      } catch (err) {
        obErr(err.message || String(err));
        btn.disabled = false;
        btn.textContent = "Create member";
        return;
      }
      var warnings = [];
      var photo = $("ob-photo").files && $("ob-photo").files[0];
      if (photo) {
        try { var fd = new FormData(); fd.append("file", photo, photo.name); await api.postForm("/clients/" + encodeURIComponent(id) + "/images", fd); }
        catch (err) { warnings.push("photo: " + err.message); }
      }
      if (val("ob-doctype") && val("ob-dockey")) {
        try { await api.post("/clients/" + encodeURIComponent(id) + "/identifiers", { documentTypeId: Number(val("ob-doctype")), documentKey: val("ob-dockey"), status: "Active" }); }
        catch (err) { warnings.push("identifier: " + err.message); }
      }
      api.toast(warnings.length ? "Member created, but some details failed — " + warnings.join("; ") : "Member created", warnings.length ? "error" : "success");
      setTimeout(function () { location.href = "client-detail.html?id=" + encodeURIComponent(id); }, warnings.length ? 2500 : 300);
    });
  }

  /* ================================================================ CLIENT DETAIL */
  if (page === "client-detail") {
    var client = null;
    var cid = api.qs("id");
    document.addEventListener("desk:client", function (e) { client = e.detail; });
    var need = function () { if (!client) throw new Error("Member not loaded yet."); return client; };
    var photoBtn = $("btn-update-photo");
    if (photoBtn) {
      var photoInput = document.createElement("input");
      photoInput.type = "file";
      photoInput.accept = "image/*";
      photoInput.hidden = true;
      photoInput.setAttribute("aria-hidden", "true");
      photoInput.tabIndex = -1;
      document.body.appendChild(photoInput);
      photoBtn.addEventListener("click", function () {
        if (photoBtn.disabled) return;
        photoInput.value = "";
        photoInput.click();
      });
      photoInput.addEventListener("change", function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) { api.toast("Choose an image file", "error"); return; }
        if (file.size > 5 * 1024 * 1024) { api.toast("The photo must be smaller than 5 MB", "error"); return; }
        var fd = new FormData();
        fd.append("file", file, file.name);
        photoBtn.disabled = true;
        api.postForm("/clients/" + encodeURIComponent(cid) + "/images", fd).then(function () {
          api.toast("Photo uploaded", "success");
        }).catch(fail).then(function () { photoBtn.disabled = false; });
      });
    }
    on($("btn-open-savings"), function () {
      var c = need();
      return openSavingsDialog({ id: c.id, name: c.displayName || fullName(c) });
    });
    on($("btn-edit"), async function () {
      var c = need();
      var v = await api.openDialog({
        title: "Edit member", submitLabel: "Save",
        fields: [
          { key: "firstname", label: "First name", required: true, value: c.firstname || "" },
          { key: "lastname", label: "Last name", required: true, value: c.lastname || "" },
          { key: "mobileNo", label: "Mobile", type: "tel", value: c.mobileNo || "" }
        ],
        onSubmit: function (val) { return api.put("/clients/" + encodeURIComponent(cid), { firstname: val.firstname.trim(), lastname: val.lastname.trim(), mobileNo: val.mobileNo.trim() }); }
      });
      if (v) { api.toast("Member updated", "success"); refresh(); }
    });
    on($("btn-close"), async function () {
      var c = need();
      var codes = await api.get("/codes");
      var code = (Array.isArray(codes) ? codes : []).filter(function (x) { return x.name === "ClientClosureReason"; })[0];
      var reasons = code ? await api.get("/codes/" + encodeURIComponent(code.id) + "/codevalues") : [];
      reasons = (Array.isArray(reasons) ? reasons : []).filter(function (r) { return r.active !== false; });
      if (!reasons.length) throw new Error("No closure reasons are configured. Ask an administrator to add values to the “ClientClosureReason” code in Fineract.");
      var reasonField = { key: "reason", label: "Reason", type: "select", required: true, placeholder: "— Select reason —", options: reasons.map(function (r) { return { value: r.id, label: r.name }; }) };
      var v = await api.openDialog({
        title: "Close member", submitLabel: "Review",
        fields: [dateField("Closure date"), reasonField],
        confirm: function (val) {
          return { title: "Confirm closure", lines: [["Member", fullName(c)], ["Reason", optionLabel(reasonField, val.reason)], ["Closure date", val.date]], note: "The member must have no open loans or savings accounts.", confirmLabel: "Close member" };
        },
        onSubmit: function (val) { return api.post("/clients/" + encodeURIComponent(cid) + "?command=close", withDate({ closureDate: val.date, closureReasonId: Number(val.reason) })); }
      });
      if (v) { api.toast("Member closed", "success"); refresh(); }
    });
    on($("btn-transfer"), async function () {
      var c = need();
      var offices = (await loadOffices()).filter(function (o) { return String(o.id) !== String(c.officeId); });
      if (!offices.length) throw new Error("There is no other office to transfer to.");
      var officeField = { key: "officeId", label: "Destination office", type: "select", required: true, placeholder: "— Select office —", options: officeOpts(offices) };
      var v = await api.openDialog({
        title: "Propose transfer", submitLabel: "Review",
        fields: [officeField, dateField("Transfer date"), noteField()],
        confirm: function (val) {
          return { title: "Confirm transfer proposal", lines: [["Member", fullName(c)], ["From", c.officeName || ""], ["To", optionLabel(officeField, val.officeId)], ["Date", val.date]], confirmLabel: "Propose transfer" };
        },
        onSubmit: function (val) { return api.post("/clients/" + encodeURIComponent(cid) + "?command=proposeTransfer", withDate({ destinationOfficeId: Number(val.officeId), transferDate: val.date, note: val.note || "" })); }
      });
      if (v) { api.toast("Transfer proposed", "success"); refresh(); }
    });
  }

  /* ================================================================ PRODUCTS */
  if (page === "products") {
    onAction("create-charge", async function () {
      var v = await api.openDialog({
        title: "Create loan charge", submitLabel: "Create",
        message: "Creates a flat loan charge collected at disbursement.",
        fields: [{ key: "name", label: "Name", required: true }, amountField()],
        onSubmit: function (val) {
          return api.post("/charges", {
            name: val.name.trim(), amount: val.amount, currencyCode: CCY, chargeAppliesTo: 1, chargeTimeType: 1,
            chargeCalculationType: 1, chargePaymentMode: 0, active: true, locale: "en"
          });
        }
      });
      if (v) { api.toast("Charge created", "success"); refresh(); }
    });
  }

  /* ================================================================ REPORTS / ADMIN */
  if (page === "reports") {
    onAction("list-users", async function () {
      var users = await api.get("/users");
      users = Array.isArray(users) ? users : [];
      $("users-output").innerHTML = '<table class="data"><thead><tr><th>Username</th><th>Name</th><th>Office</th><th>Roles</th></tr></thead><tbody>' +
        (users.map(function (u) {
          return "<tr><td class=\"mono\">" + esc(u.username) + "</td><td>" + esc(((u.firstname || "") + " " + (u.lastname || "")).trim()) + "</td><td>" +
            esc(u.officeName || "") + "</td><td>" + esc((u.selectedRoles || []).map(function (r) { return r.name; }).join(", ")) + "</td></tr>";
        }).join("") || api.emptyRow(4, "No users")) + "</tbody></table>";
    });
  }
})();
