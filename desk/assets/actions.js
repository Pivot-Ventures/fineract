/* Pivot SACCO Desk — write actions against live Fineract */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;

  var page = document.body.getAttribute("data-page") || "";
  var sess = api.getSession() || {};
  var esc = api.escapeHtml;
  var CCY = "UGX";
  var DATE = { locale: "en", dateFormat: "yyyy-MM-dd" };

  function $(id) { return document.getElementById(id); }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function refresh() { document.dispatchEvent(new CustomEvent("desk:refresh")); }
  function fail(err) { if (err && err.status !== 401) api.toast(err.message || String(err), "error"); }
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

  /* Tellers, cashiers, teller desk and cashier EOD live in assets/frontoffice.js. */

  /* ---------- money dialog shared by the savings pages ---------- */
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

  /* ================================================================ LOAN APPLICATION / LOAN DETAIL — see loans.js */

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
        var tpl = await api.get("/savingsaccounts/template?clientId=" + encodeURIComponent(clientId) + "&productId=" + encodeURIComponent(val.productId));
        var created = await api.post("/savingsaccounts", withDate({ clientId: Number(clientId), productId: Number(val.productId), submittedOnDate: val.date }));
        var id = created.savingsId || created.resourceId;
        result = id;
        /* The product's default charges (withdrawal fee, entrance fee) are attached one by one after creation:
           sending them in the create call crashes this Fineract build (NPE in SavingsAccountCharge). */
        var failedCharges = [];
        for (var ci = 0; ci < (tpl.charges || []).length; ci++) {
          var c = tpl.charges[ci];
          var cbody = { chargeId: c.chargeId || c.id, amount: c.amount };
          if (c.chargeTimeType && c.chargeTimeType.id === 2) cbody.dueDate = val.date;
          try {
            await api.post("/savingsaccounts/" + encodeURIComponent(id) + "/charges", withDate(cbody));
          } catch (err) {
            failedCharges.push(c.name);
          }
        }
        if (failedCharges.length) warning = "Charges not attached: " + failedCharges.join(", ") + ". Add them on the account before activating.";
        if (val.activate === "yes" && !failedCharges.length) {
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

  /* GROUPS / CENTRES: create, members, activation are in assets/members.js. */

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

  /* ================================================================ CLIENT DETAIL
   * Member onboarding and profile actions live in assets/members.js; only the
   * "Open savings" button stays here because it reuses openSavingsDialog. */
  if (page === "client-detail") {
    var memberForSavings = null;
    document.addEventListener("desk:client", function (e) { memberForSavings = e.detail; });
    on($("btn-open-savings"), function () {
      if (!memberForSavings) throw new Error("Member not loaded yet.");
      return openSavingsDialog({ id: memberForSavings.id, name: fullName(memberForSavings) });
    });
  }

  /* ================================================================ STAFF / USERS */
  /*
   * Fineract model: a teller (till) has cashiers; a cashier is a staff member of the teller's office;
   * a user (login) links to one staff record, which is how the desk finds "my" cashier drawer.
   */
  var PHONE_RE = /^\+?\d{7,15}$/;
  var YES_NO = [{ value: "false", label: "No" }, { value: "true", label: "Yes" }];
  function staffName(s) {
    return s.displayName || ((s.lastname || "") + ", " + (s.firstname || "")).replace(/^, |, $/g, "") || ("#" + s.id);
  }

  async function staffDialog(existing) {
    var offices = await loadOffices();
    if (!offices.length) throw new Error("No offices are available to you.");
    var fields = [
      { key: "firstname", label: "First name", required: true, value: existing ? existing.firstname || "" : "" },
      { key: "lastname", label: "Last name", required: true, value: existing ? existing.lastname || "" : "" },
      { key: "officeId", label: "Office", type: "select", required: true, value: existing ? String(existing.officeId) : defaultOffice(offices), options: officeOpts(offices) },
      { key: "isLoanOfficer", label: "Loan officer", type: "select", value: existing && existing.isLoanOfficer ? "true" : "false", options: YES_NO },
      { key: "mobileNo", label: "Mobile number", type: "tel", placeholder: "e.g. 0772123456", value: existing ? existing.mobileNo || "" : "",
        help: "Optional. 7–15 digits, optional leading +." + (existing ? " A saved number can be changed but not removed." : "") },
      { key: "externalId", label: "External ID", placeholder: "optional, e.g. payroll number", value: existing ? existing.externalId || "" : "",
        help: existing ? "Can be changed but not removed." : "" }
    ];
    if (existing) {
      fields.push({ key: "isActive", label: "Status", type: "select", value: existing.isActive ? "true" : "false",
        options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }],
        help: "Inactive staff cannot be assigned as cashier. Staff with clients or loans cannot be deactivated." });
    } else {
      fields.push({ key: "joiningDate", label: "Joining date", type: "date", required: true, value: api.todayISO(), max: api.todayISO() });
    }
    return api.openDialog({
      title: existing ? "Edit staff · " + staffName(existing) : "Add staff", submitLabel: existing ? "Save" : "Add staff",
      message: existing ? "" : "Staff members can be assigned to a teller as cashier and linked to a user login.",
      fields: fields,
      validate: function (v) {
        if (v.firstname.trim().length > 50 || v.lastname.trim().length > 50) return "First and last name must be 50 characters or fewer.";
        if (v.mobileNo.trim() && !PHONE_RE.test(v.mobileNo.trim())) return "Mobile number must be 7–15 digits (an optional leading + is allowed).";
        if (v.externalId.trim().length > 100) return "External ID must be 100 characters or fewer.";
        if (!existing && v.joiningDate > api.todayISO()) return "Joining date cannot be in the future.";
        return "";
      },
      onSubmit: function (v) {
        var body = { officeId: Number(v.officeId), firstname: v.firstname.trim(), lastname: v.lastname.trim(), isLoanOfficer: v.isLoanOfficer === "true" };
        if (v.mobileNo.trim()) body.mobileNo = v.mobileNo.trim();
        if (v.externalId.trim()) body.externalId = v.externalId.trim();
        if (existing) {
          /* PUT /staff ignores joiningDate and does not take locale / dateFormat. */
          body.isActive = v.isActive === "true";
          return api.put("/staff/" + encodeURIComponent(existing.id), body);
        }
        body.isActive = true;
        body.joiningDate = v.joiningDate;
        return api.post("/staff", withDate(body));
      }
    });
  }

  if (page === "staff") {
    var staffBody = document.querySelector("#staff-list tbody");
    var staffOffice = $("staff-office");
    var canEditStaff = api.can("UPDATE_STAFF");
    var reloadStaff = async function () {
      var oid = staffOffice ? staffOffice.value : "";
      var pair = await Promise.all([
        api.get("/staff?status=all" + (oid ? "&officeId=" + encodeURIComponent(oid) : "")),
        staffOffice && staffOffice.options.length <= 1 ? loadOffices() : Promise.resolve(null)
      ]);
      if (pair[1]) {
        staffOffice.innerHTML = '<option value="">All offices</option>' + pair[1].map(function (o) {
          return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
        }).join("");
      }
      var list = Array.isArray(pair[0]) ? pair[0] : ((pair[0] && pair[0].pageItems) || []);
      staffBody.innerHTML = list.map(function (s) {
        return '<tr><td class="strong">' + esc(staffName(s)) + "</td><td>" + esc(s.officeName || "") + "</td><td>" +
          (s.isLoanOfficer ? "Yes" : "No") + '</td><td class="mono">' + esc(s.mobileNo || "—") + "</td><td>" + esc(api.formatDate(s.joiningDate)) +
          "</td><td>" + api.statusBadge(s.isActive ? "Active" : "Inactive") + '</td><td class="btn-group">' +
          (canEditStaff ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-staff="' + esc(s.id) + '">Edit</button>' : "") + "</td></tr>";
      }).join("") || api.emptyRow(7, oid ? "No staff in this office yet." : "No staff yet. Add a staff member, then assign them to a teller as cashier.");
    };
    staffBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit-staff]");
      if (!b) return;
      api.get("/staff/" + encodeURIComponent(b.getAttribute("data-edit-staff"))).then(staffDialog).then(function (res) {
        if (res) { api.toast("Staff updated", "success"); return reloadStaff(); }
      }).catch(fail);
    });
    if (staffOffice) staffOffice.addEventListener("change", function () { reloadStaff().catch(fail); });
    onAction("create-staff", async function () {
      var res = await staffDialog(null);
      if (!res) return;
      api.toast("Staff added. Assign them to a teller under Tellers & cashiers, or give them a login under Users.", "success");
      await reloadStaff();
    });
    reloadStaff().catch(fail);
  }

  /* Client-side mirror of Fineract's built-in password policies (the server still validates). */
  var PW_POLICIES = {
    simple: /^.{1,50}$/,
    secure: /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?!.*\s).{6,50}$/,
    strong: /^(?!.*(.)\1)(?!.*\s)(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[^\w\s]).{12,50}$/
  };
  var STRONG_TEXT = "Password must be 12 to 50 characters long, containing at least one uppercase letter, one lowercase letter, " +
    "one numeric digit, and one special character, with no spaces or consecutive repeating characters";
  var pwPolicy = null;
  async function passwordPolicy() {
    if (pwPolicy) return pwPolicy;
    var p = await api.get("/passwordpreferences").catch(function () { return null; });
    pwPolicy = { key: (p && p.key) || "strong", description: (p && p.description) || STRONG_TEXT };
    return pwPolicy;
  }
  function passwordProblem(pw, policy) {
    var re = PW_POLICIES[policy.key];
    if (!re) return "";
    return re.test(pw) ? "" : policy.description + ".";
  }
  async function staffOptionsFor(officeId, keep) {
    if (!officeId) return [];
    var list = await api.get("/staff?status=active&officeId=" + encodeURIComponent(officeId));
    list = Array.isArray(list) ? list : [];
    if (keep && String(keep.officeId) === String(officeId) && !list.some(function (s) { return String(s.id) === String(keep.id); })) list = [keep].concat(list);
    return list.map(function (s) { return { value: s.id, label: staffName(s) }; });
  }

  async function userDialog(existing) {
    var res = await Promise.all([loadOffices(), api.get("/roles"), passwordPolicy()]);
    var offices = res[0];
    var policy = res[2];
    var selected = existing ? (existing.selectedRoles || []).map(function (r) { return String(r.id); }) : [];
    var roleOpts = (Array.isArray(res[1]) ? res[1] : []).filter(function (r) {
      return !r.disabled || selected.indexOf(String(r.id)) >= 0;
    }).map(function (r) { return { value: r.id, label: r.name }; });
    if (!roleOpts.length) throw new Error("No roles are enabled in Fineract. An administrator must create a role first.");
    var linked = existing && existing.staff ? existing.staff : null;
    var officeId = existing ? String(existing.officeId) : defaultOffice(offices);
    var staffOpts = await staffOptionsFor(officeId, linked);
    var fields = [];
    if (!existing) fields.push({ key: "username", label: "Username", required: true, autocomplete: "off" });
    fields.push(
      { key: "firstname", label: "First name", required: true, value: existing ? existing.firstname || "" : "" },
      { key: "lastname", label: "Last name", required: true, value: existing ? existing.lastname || "" : "" },
      { key: "email", label: "Email", type: "email", required: true, value: existing ? existing.email || "" : "", autocomplete: "off" },
      { key: "officeId", label: "Office", type: "select", required: true, value: officeId, options: officeOpts(offices),
        onChange: async function (val, dlg) { dlg.setOptions("staffId", await staffOptionsFor(val, linked), linked && String(linked.officeId) === String(val) ? linked.id : ""); } },
      { key: "staffId", label: "Staff record", type: "select", placeholder: "— None —", value: linked ? String(linked.id) : "", options: staffOpts, full: true,
        help: "Required for tellers / cashiers: link the user to the staff member assigned as cashier (same office). Create staff on the Staff page." },
      { key: "roles", label: "Roles", type: "checkboxes", required: true, value: selected, options: roleOpts },
      { key: "password", label: existing ? "New password" : "Password", type: "password", required: !existing, autocomplete: "new-password",
        help: (existing ? "Leave blank to keep the current password. " : "") + policy.description + "." },
      { key: "repeatPassword", label: "Repeat password", type: "password", required: !existing, autocomplete: "new-password" }
    );
    return api.openDialog({
      title: existing ? "Edit user · " + existing.username : "Add user", submitLabel: existing ? "Save" : "Create user",
      message: existing ? "" : "The user must change this password the first time they sign in. Share it with them privately.",
      fields: fields,
      validate: function (v) {
        if (!existing && (/\s/.test(v.username) || v.username.length > 100)) return "Username must have no spaces and be 100 characters or fewer.";
        if (v.firstname.trim().length > 100 || v.lastname.trim().length > 100) return "First and last name must be 100 characters or fewer.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) || v.email.trim().length > 254) return "Enter a valid email address.";
        if (!existing || v.password || v.repeatPassword) {
          if (!v.password) return "Enter the new password in both fields.";
          if (v.password !== v.repeatPassword) return "The two passwords do not match.";
          var problem = passwordProblem(v.password, policy);
          if (problem) return problem;
        }
        return "";
      },
      onSubmit: function (v) {
        var body = {
          firstname: v.firstname.trim(), lastname: v.lastname.trim(), email: v.email.trim(),
          officeId: Number(v.officeId), roles: v.roles.map(Number)
        };
        if (v.staffId) body.staffId = Number(v.staffId);
        else if (linked) body.staffId = null;
        if (v.password) { body.password = v.password; body.repeatPassword = v.repeatPassword; }
        if (existing) return api.put("/users/" + encodeURIComponent(existing.id), body);
        body.username = v.username.trim();
        body.sendPasswordToEmail = false;
        return api.post("/users", body);
      }
    });
  }

  if (page === "users") {
    var usersBody = document.querySelector("#users-list tbody");
    var canEditUser = api.can("UPDATE_USER");
    var reloadUsers = async function () {
      var users = await api.get("/users");
      users = Array.isArray(users) ? users : [];
      usersBody.innerHTML = users.map(function (u) {
        var name = ((u.firstname || "") + " " + (u.lastname || "")).trim();
        var staff = u.staff ? staffName(u.staff) : "";
        return '<tr><td class="mono strong">' + esc(u.username) + "</td><td>" + esc(name || "—") + "</td><td>" + esc(u.officeName || "") + "</td><td>" +
          (staff ? esc(staff) : '<span class="text-muted">Not linked</span>') + "</td><td>" +
          esc((u.selectedRoles || []).map(function (r) { return r.name; }).join(", ") || "—") + '</td><td class="btn-group">' +
          (canEditUser ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-user="' + esc(u.id) + '">Edit</button>' : "") + "</td></tr>";
      }).join("") || api.emptyRow(6, "No users");
    };
    passwordPolicy().then(function (p) {
      var el = $("password-policy");
      if (el) el.textContent = "Password policy: " + p.description + ". New users must change their password at first sign-in.";
    }).catch(fail);
    usersBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit-user]");
      if (!b) return;
      api.get("/users/" + encodeURIComponent(b.getAttribute("data-edit-user"))).then(userDialog).then(function (res) {
        if (res) { api.toast("User updated", "success"); return reloadUsers(); }
      }).catch(fail);
    });
    onAction("create-user", async function () {
      var res = await userDialog(null);
      if (!res) return;
      api.toast("User created. They must change the password at first sign-in.", "success");
      await reloadUsers();
    });
    reloadUsers().catch(fail);
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
