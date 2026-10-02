/* Remaining Fineract screens: settings, system, staff, users, taxes,
 * delinquency, standing instructions, loan reschedule, share dividends,
 * recurring-deposit products, and an honest client workbook import. */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;
  var W = window.DeskWrites;
  var page = document.body.getAttribute("data-page") || "";
  var esc = api.escapeHtml;

  function $(id) { return document.getElementById(id); }
  function writes() {
    if (!W) throw new Error("desk-writes.js is not loaded");
    return W;
  }
  function listOf(data) {
    if (Array.isArray(data)) return data;
    if (!data) return [];
    if (Array.isArray(data.pageItems)) return data.pageItems;
    if (Array.isArray(data.globalConfiguration)) return data.globalConfiguration;
    return [];
  }
  function fail(err) {
    if (err && err.status === 401) return;
    api.toast((err && err.message) || String(err), "error");
  }
  function setRows(id, html, cols, empty) {
    var tb = document.querySelector("#" + id + " tbody");
    if (!tb) return;
    tb.innerHTML = html || api.emptyRow(cols, empty || "Nothing here yet");
  }
  function today() { return api.todayISO(); }

  function openForm(title, fields, onSubmit, submitLabel) {
    return api.openDialog({ title: title, submitLabel: submitLabel || "Save", fields: fields, onSubmit: onSubmit });
  }

  /* ------------------------------------------------------- staff & users */
  if (page === "staff") {
    var staffRows = [];
    var offices = [];
    function paintStaff() {
      var officeId = ($("staff-office") || {}).value || "";
      var rows = staffRows.filter(function (s) { return !officeId || String(s.officeId) === String(officeId); });
      setRows("staff-list", rows.map(function (s) {
        var name = s.displayName || ((s.firstname || "") + " " + (s.lastname || ""));
        return "<tr><td class=\"strong\">" + esc(name) + "</td><td>" + esc(s.officeName || "") + "</td><td>" +
          (s.isLoanOfficer ? "Yes" : "No") + "</td><td>" + esc(s.mobileNo || "—") + "</td><td>" +
          esc(api.formatDate(s.joiningDate)) + "</td><td>" + api.statusBadge(s.isActive === false ? "Inactive" : "Active") +
          '</td><td><button type="button" class="btn btn-sm btn-ghost" data-staff="' + esc(s.id) + '">Edit</button></td></tr>';
      }).join(""), 7, "No staff yet");
    }
    async function loadStaff() {
      var pack = await Promise.all([
        api.get("/offices"),
        api.get("/staff?status=all").catch(function () { return api.get("/staff"); })
      ]);
      offices = listOf(pack[0]);
      staffRows = listOf(pack[1]);
      var sel = $("staff-office");
      if (sel) {
        var current = sel.value;
        sel.innerHTML = '<option value="">All offices</option>' + offices.map(function (o) {
          return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
        }).join("");
        sel.value = current;
        sel.onchange = paintStaff;
      }
      paintStaff();
    }
    function staffFields(current) {
      current = current || {};
      return [
        { key: "officeId", label: "Office", type: "select", value: current.officeId ? String(current.officeId) : (offices[0] ? String(offices[0].id) : ""), options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
        { key: "firstname", label: "First name", value: current.firstname || "", required: true },
        { key: "lastname", label: "Last name", value: current.lastname || "", required: true },
        { key: "mobileNo", label: "Mobile", value: current.mobileNo || "" },
        { key: "joiningDate", label: "Joined", type: "date", value: api.formatDate(current.joiningDate) === "—" ? today() : api.formatDate(current.joiningDate) },
        { key: "isLoanOfficer", label: "Loan officer", type: "select", value: current.isLoanOfficer ? "true" : "false", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] }
      ];
    }
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-action=create-staff]");
      var edit = e.target.closest && e.target.closest("[data-staff]");
      if (!btn && !edit) return;
      e.preventDefault();
      var current = edit ? staffRows.filter(function (s) { return String(s.id) === edit.getAttribute("data-staff"); })[0] : null;
      openForm(current ? "Edit staff" : "Add staff", staffFields(current), function (v) {
        var body = writes().staffPayload(v);
        var req = current ? api.put("/staff/" + current.id, body) : api.post("/staff", body);
        return req.then(function () { api.toast(current ? "Staff updated" : "Staff added", "success"); return loadStaff(); });
      }).catch(fail);
    });
    loadStaff().catch(function (err) {
      fail(err);
      setRows("staff-list", "", 7, "Could not load staff: " + (err.message || err));
    });
  }

  if (page === "users") {
    var userRows = [];
    var userTemplate = null;
    function paintUsers() {
      setRows("users-list", userRows.map(function (u) {
        var roles = (u.selectedRoles || []).map(function (r) { return r.name; }).join(", ");
        return "<tr><td class=\"mono\">" + esc(u.username) + "</td><td>" + esc(u.firstname + " " + u.lastname) + "</td><td>" +
          esc(u.officeName || "") + "</td><td>" + esc(u.staffName || "—") + "</td><td>" + esc(roles || "—") +
          '</td><td><button type="button" class="btn btn-sm btn-ghost" data-user="' + esc(u.id) + '">Edit</button></td></tr>';
      }).join(""), 6, "No users");
      var note = $("password-policy");
      if (note) {
        note.textContent = "Fineract checks the password when you save. A rejected password is not stored. New users are told to change it the first time they sign in.";
      }
    }
    async function loadUsers() {
      var pack = await Promise.all([
        api.get("/users"),
        api.get("/users/template").catch(function () { return {}; })
      ]);
      userRows = listOf(pack[0]);
      userTemplate = pack[1] || {};
      paintUsers();
    }
    function userFields(current) {
      var t = userTemplate || {};
      var officeOpts = (t.allowedOffices || []).map(function (o) { return { value: o.id, label: o.name }; });
      var roleOpts = (t.availableRoles || []).map(function (r) { return { value: r.id, label: r.name }; });
      var staffOpts = [{ value: "", label: "Not linked" }].concat((t.staffOptions || []).map(function (s) { return { value: s.id, label: s.displayName }; }));
      var selectedRole = current && current.selectedRoles && current.selectedRoles[0] ? String(current.selectedRoles[0].id) : "";
      var fields = [
        { key: "username", label: "Username", value: current ? current.username : "", required: true },
        { key: "firstname", label: "First name", value: current ? current.firstname : "", required: true },
        { key: "lastname", label: "Last name", value: current ? current.lastname : "", required: true },
        { key: "email", label: "Email", type: "email", value: current ? current.email : "", required: true },
        { key: "officeId", label: "Office", type: "select", value: current && current.officeId ? String(current.officeId) : "", options: officeOpts },
        { key: "staffId", label: "Staff record", type: "select", value: current && current.staffId ? String(current.staffId) : "", options: staffOpts },
        { key: "roles", label: "Role", type: "select", value: selectedRole, options: roleOpts },
        { key: "password", label: current ? "New password (leave blank to keep)" : "Password", type: "password" },
        { key: "repeatPassword", label: "Repeat password", type: "password" }
      ];
      return fields;
    }
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-action=create-user]");
      var edit = e.target.closest && e.target.closest("[data-user]");
      if (!btn && !edit) return;
      e.preventDefault();
      var current = edit ? userRows.filter(function (u) { return String(u.id) === edit.getAttribute("data-user"); })[0] : null;
      openForm(current ? "Edit user" : "Add user", userFields(current), function (v) {
        var body = writes().userPayload(v, !!current);
        var req = current ? api.put("/users/" + current.id, body) : api.post("/users", body);
        return req.then(function () { api.toast(current ? "User updated" : "User created", "success"); return loadUsers(); });
      }).catch(fail);
    });
    loadUsers().catch(function (err) {
      fail(err);
      setRows("users-list", "", 6, "Could not load users: " + (err.message || err));
    });
  }

  /* ------------------------------------------------------------- settings */
  if (page === "settings") {
    var configs = [];
    function paintConfigs() {
      var q = (($("cfg-search") || {}).value || "").trim().toLowerCase();
      var rows = configs.filter(function (c) {
        return !q || String(c.name || "").toLowerCase().indexOf(q) >= 0 || String(c.description || "").toLowerCase().indexOf(q) >= 0;
      });
      setRows("cfg-table", rows.map(function (c) {
        var value = c.value === null || c.value === undefined || c.value === "" ? "—" : String(c.value);
        return "<tr><td class=\"mono\">" + esc(c.name) + "</td><td>" + esc(c.description || "") + "</td><td>" +
          api.statusBadge(c.enabled ? "Enabled" : "Disabled") + "</td><td class=\"mono\">" + esc(value) + "</td><td class=\"btn-group\">" +
          '<button type="button" class="btn btn-sm" data-cfg-toggle="' + esc(c.id) + '">' + (c.enabled ? "Disable" : "Enable") + "</button>" +
          '<button type="button" class="btn btn-sm btn-ghost" data-cfg-value="' + esc(c.id) + '">Set value</button></td></tr>';
      }).join(""), 5, "No configurations matched");
    }
    function paintCurrencies(data) {
      var box = $("currency-list");
      if (!box) return;
      var selected = {};
      (data.selectedCurrencyOptions || []).forEach(function (c) { selected[c.code] = true; });
      var options = data.currencyOptions || [];
      box.innerHTML = options.map(function (c) {
        return '<label class="check"><input type="checkbox" data-ccy="' + esc(c.code) + '"' + (selected[c.code] ? " checked" : "") + " /> " +
          esc(c.code) + " · " + esc(c.name || "") + "</label>";
      }).join("") || "<p>No currencies returned.</p>";
    }
    function paintSimple(table, rows, cells, empty, cols) {
      setRows(table, rows.map(cells).join(""), cols || 4, empty);
    }
    async function loadSettings() {
      var pack = await Promise.all([
        api.get("/configurations").catch(function (err) { return { error: err }; }),
        api.get("/currencies").catch(function (err) { return { error: err }; }),
        api.get("/paymenttypes").catch(function () { return []; }),
        api.get("/funds").catch(function () { return []; }),
        api.get("/holidays").catch(function () { return []; }),
        api.get("/workingdays").catch(function () { return {}; }),
        api.get("/offices").catch(function () { return []; }),
        api.get("/taxes/component").catch(function (err) { return { error: err }; }),
        api.get("/taxes/group").catch(function (err) { return { error: err }; }),
        api.get("/glaccounts").catch(function () { return []; }),
        api.get("/delinquency/ranges").catch(function (err) { return { error: err }; }),
        api.get("/delinquency/buckets").catch(function (err) { return { error: err }; })
      ]);
      configs = pack[0] && pack[0].error ? [] : listOf(pack[0]);
      if (pack[0] && pack[0].error) setRows("cfg-table", "", 5, pack[0].error.message || "Could not load configurations");
      else paintConfigs();
      if (pack[1] && pack[1].error) {
        var box = $("currency-list");
        if (box) box.textContent = pack[1].error.message || "Could not load currencies";
      } else paintCurrencies(pack[1] || {});
      var pays = listOf(pack[2]);
      paintSimple("pay-table", pays, function (p) {
        return "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.description || "") + "</td><td>" + (p.isCashPayment ? "Cash" : "Non-cash") +
          "</td><td>" + esc(p.position) +           '</td><td><button type="button" class="btn btn-sm btn-ghost" data-pay="' + esc(p.id) + '">Edit</button></td></tr>';
      }, "No payment types", 5);
      var funds = listOf(pack[3]);
      paintSimple("fund-table", funds, function (f) {
        return "<tr><td>" + esc(f.name) + "</td><td class=\"mono\">" + esc(f.externalId || "—") +
          '</td><td><button type="button" class="btn btn-sm btn-ghost" data-fund="' + esc(f.id) + '">Edit</button></td><td></td></tr>';
      }, "No funds");
      var holidays = listOf(pack[4]);
      setRows("holiday-table", holidays.map(function (h) {
        return "<tr><td>" + esc(h.name) + "</td><td>" + esc(api.formatDate(h.fromDate)) + "</td><td>" + esc(api.formatDate(h.toDate)) +
          "</td><td>" + api.statusBadge(h.status || "") + "</td><td>" +
          (h.status && /active/i.test(api.statusLabel(h.status)) ? "" : '<button type="button" class="btn btn-sm" data-holiday-activate="' + esc(h.id) + '">Activate</button>') +
          "</td></tr>";
      }).join(""), 5, "No holidays");
      var days = pack[5] || {};
      var byday = ((days.recurrence || "").split("BYDAY=")[1] || "").split(",").filter(Boolean);
      document.querySelectorAll("[data-day]").forEach(function (box) {
        box.checked = byday.indexOf(box.getAttribute("data-day")) >= 0;
      });
      var resched = $("wd-resched");
      if (resched && days.repaymentRescheduleType) resched.value = String(days.repaymentRescheduleType.id || days.repaymentRescheduleType);
      var ext = $("wd-extend");
      if (ext) ext.checked = !!days.extendTermForDailyRepayments;
      window.__deskOffices = listOf(pack[6]);
      window.__deskPays = pays;
      window.__deskFunds = funds;
      window.__deskGls = listOf(pack[9]);
      paintTaxes(pack[7], pack[8]);
      paintDelinquency(pack[10], pack[11]);
      var hash = (location.hash || "").replace("#", "");
      if (hash) {
        var tab = document.querySelector('[data-tab="' + hash + '"]');
        if (tab) tab.click();
      }
    }
    function paintTaxes(components, groups) {
      var note = $("tax-note");
      if (components && components.error) {
        if (note) note.textContent = "Tax components could not be loaded: " + components.error.message;
        setRows("tax-components", "", 4, "Unavailable");
      } else {
        var rows = listOf(components);
        window.__deskTaxComponents = rows;
        setRows("tax-components", rows.map(function (t) {
          return "<tr><td>" + esc(t.name) + "</td><td class=\"mono\">" + esc(t.percentage) + "%</td><td>" + esc(api.formatDate(t.startDate)) + "</td><td></td></tr>";
        }).join(""), 4, "No tax components");
      }
      if (groups && groups.error) {
        setRows("tax-groups", "", 3, groups.error.message || "Unavailable");
      } else {
        setRows("tax-groups", listOf(groups).map(function (g) {
          return "<tr><td>" + esc(g.name) + "</td><td>" + esc((g.taxAssociations || []).length) + "</td><td></td></tr>";
        }).join(""), 3, "No tax groups");
      }
    }
    function paintDelinquency(ranges, buckets) {
      var note = $("delinq-note");
      if (ranges && ranges.error && ranges.error.status === 404) {
        if (note) note.textContent = "This Fineract build did not return /delinquency/ranges. Desk will not invent buckets.";
        setRows("delinq-ranges", "", 3, "API not available");
        setRows("delinq-buckets", "", 2, "API not available");
        var add = $("delinq-add");
        if (add) add.disabled = true;
        return;
      }
      if (ranges && ranges.error) {
        if (note) note.textContent = ranges.error.message;
        setRows("delinq-ranges", "", 3, "Could not load ranges");
        return;
      }
      var rangeRows = listOf(ranges);
      window.__deskRanges = rangeRows;
      setRows("delinq-ranges", rangeRows.map(function (r) {
        return "<tr><td>" + esc(r.classification) + "</td><td class=\"mono\">" + esc(r.minimumAgeDays) + "–" + esc(r.maximumAgeDays) + "</td><td></td></tr>";
      }).join(""), 3, "No delinquency ranges");
      if (buckets && buckets.error) {
        setRows("delinq-buckets", "", 2, buckets.error.message || "Could not load buckets");
        return;
      }
      setRows("delinq-buckets", listOf(buckets).map(function (b) {
        return "<tr><td>" + esc(b.name) + "</td><td>" + esc((b.ranges || []).map(function (r) { return r.classification || r.id; }).join(", ") || "—") + "</td></tr>";
      }).join(""), 2, "No delinquency buckets");
    }

    var cfgSearch = $("cfg-search");
    if (cfgSearch) cfgSearch.addEventListener("input", paintConfigs);
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var toggle = t.closest("[data-cfg-toggle]");
      var valueBtn = t.closest("[data-cfg-value]");
      var payBtn = t.closest("[data-pay]");
      var fundBtn = t.closest("[data-fund]");
      var holBtn = t.closest("[data-holiday-activate]");
      if (toggle) {
        var row = configs.filter(function (c) { return String(c.id) === toggle.getAttribute("data-cfg-toggle"); })[0];
        api.put("/configurations/" + row.id, writes().configurationUpdatePayload({ enabled: row.enabled ? "false" : "true" }))
          .then(function () { api.toast(row.name + (row.enabled ? " disabled" : " enabled"), "success"); return loadSettings(); }).catch(fail);
      }
      if (valueBtn) {
        var cfg = configs.filter(function (c) { return String(c.id) === valueBtn.getAttribute("data-cfg-value"); })[0];
        openForm("Set " + cfg.name, [{ key: "value", label: "Value", value: cfg.value == null ? "" : String(cfg.value) }], function (v) {
          return api.put("/configurations/" + cfg.id, writes().configurationUpdatePayload({ value: v.value }))
            .then(function () { api.toast("Configuration saved", "success"); return loadSettings(); });
        }).catch(fail);
      }
      if (payBtn) editPayment(payBtn.getAttribute("data-pay"));
      if (fundBtn) editFund(fundBtn.getAttribute("data-fund"));
      if (holBtn) {
        api.post("/holidays/" + holBtn.getAttribute("data-holiday-activate") + "?command=activate", {})
          .then(function () { api.toast("Holiday activated", "success"); return loadSettings(); }).catch(fail);
      }
    });
    function editPayment(id) {
      var current = (window.__deskPays || []).filter(function (p) { return String(p.id) === String(id); })[0] || {};
      openForm(id ? "Edit payment type" : "Add payment type", [
        { key: "name", label: "Name", value: current.name || "", required: true },
        { key: "description", label: "Description", value: current.description || "" },
        { key: "isCashPayment", label: "Cash payment", type: "select", value: current.isCashPayment ? "true" : "false", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
        { key: "position", label: "Position", type: "number", value: current.position != null ? String(current.position) : "1" }
      ], function (v) {
        var body = writes().paymentTypePayload(v);
        var req = id ? api.put("/paymenttypes/" + id, body) : api.post("/paymenttypes", body);
        return req.then(function () { api.toast("Payment type saved", "success"); return loadSettings(); });
      }).catch(fail);
    }
    function editFund(id) {
      var current = (window.__deskFunds || []).filter(function (f) { return String(f.id) === String(id); })[0] || {};
      openForm(id ? "Edit fund" : "Add fund", [
        { key: "name", label: "Name", value: current.name || "", required: true },
        { key: "externalId", label: "External id", value: current.externalId || "" }
      ], function (v) {
        var body = writes().fundPayload(v);
        var req = id ? api.put("/funds/" + id, body) : api.post("/funds", body);
        return req.then(function () { api.toast("Fund saved", "success"); return loadSettings(); });
      }).catch(fail);
    }
    var payAdd = $("pay-add");
    if (payAdd) payAdd.addEventListener("click", function () { editPayment(null); });
    var fundAdd = $("fund-add");
    if (fundAdd) fundAdd.addEventListener("click", function () { editFund(null); });
    var holAdd = $("holiday-add");
    if (holAdd) holAdd.addEventListener("click", function () {
      var offices = window.__deskOffices || [];
      openForm("Add holiday", [
        { key: "name", label: "Name", required: true },
        { key: "fromDate", label: "From", type: "date", value: today() },
        { key: "toDate", label: "To", type: "date", value: today() },
        { key: "officeId", label: "Office", type: "select", options: offices.map(function (o) { return { value: o.id, label: o.name }; }) },
        { key: "reschedulingType", label: "Reschedule loans", type: "select", value: "1", options: [{ value: "1", label: "Next repayment date" }, { value: "2", label: "A specific date" }] },
        { key: "repaymentsRescheduledTo", label: "Specific date", type: "date", showWhen: { key: "reschedulingType", values: ["2"] } }
      ], function (v) {
        return api.post("/holidays", writes().holidayPayload(v)).then(function () {
          api.toast("Holiday created. Activate it when the dates are final.", "success");
          return loadSettings();
        });
      }).catch(fail);
    });
    var wdSave = $("wd-save");
    if (wdSave) wdSave.addEventListener("click", function () {
      var days = [];
      document.querySelectorAll("[data-day]:checked").forEach(function (b) { days.push(b.getAttribute("data-day")); });
      var body;
      try {
        body = writes().workingDaysPayload({
          days: days,
          repaymentRescheduleType: ($("wd-resched") || {}).value,
          extendTermForDailyRepayments: ($("wd-extend") || {}).checked ? "true" : "false"
        });
      } catch (err) { fail(err); return; }
      api.put("/workingdays", body).then(function () { api.toast("Working days saved", "success"); }).catch(fail);
    });
    var ccySave = $("ccy-save");
    if (ccySave) ccySave.addEventListener("click", function () {
      var codes = [];
      document.querySelectorAll("[data-ccy]:checked").forEach(function (b) { codes.push(b.getAttribute("data-ccy")); });
      var body;
      try { body = writes().currenciesUpdatePayload(codes); } catch (err) { fail(err); return; }
      api.put("/currencies", body).then(function () { api.toast("Currencies saved", "success"); return loadSettings(); }).catch(fail);
    });
    var taxAdd = $("tax-add");
    if (taxAdd) taxAdd.addEventListener("click", function () {
      var gls = (window.__deskGls || []).filter(function (g) { return g.type && (g.type.id === 2 || g.type.id === 5); });
      openForm("Add tax component", [
        { key: "name", label: "Name", required: true },
        { key: "percentage", label: "Percentage", type: "number", value: "18" },
        { key: "startDate", label: "Start date", type: "date", value: "2010-01-01" },
        { key: "creditAccountId", label: "Credit GL (liability or expense)", type: "select", options: [{ value: "", label: "None" }].concat(gls.map(function (g) { return { value: g.id, label: g.glCode + " " + g.name }; })) }
      ], function (v) {
        var gl = gls.filter(function (g) { return String(g.id) === String(v.creditAccountId); })[0];
        v.creditAccountType = gl && gl.type ? gl.type.id : 2;
        return api.post("/taxes/component", writes().taxComponentPayload(v)).then(function () {
          api.toast("Tax component created", "success");
          return loadSettings();
        });
      }).catch(fail);
    });
    var taxGroupAdd = $("tax-group-add");
    if (taxGroupAdd) taxGroupAdd.addEventListener("click", function () {
      var comps = window.__deskTaxComponents || [];
      if (!comps.length) { api.toast("Create a tax component first", "error"); return; }
      openForm("Add tax group", [
        { key: "name", label: "Name", required: true },
        { key: "taxComponentId", label: "Component", type: "select", options: comps.map(function (c) { return { value: c.id, label: c.name }; }) },
        { key: "startDate", label: "Start date", type: "date", value: today() }
      ], function (v) {
        return api.post("/taxes/group", writes().taxGroupPayload(v)).then(function () {
          api.toast("Tax group created", "success");
          return loadSettings();
        });
      }).catch(fail);
    });
    var delinqAdd = $("delinq-add");
    if (delinqAdd) delinqAdd.addEventListener("click", function () {
      openForm("Add delinquency range", [
        { key: "classification", label: "Classification", required: true, value: "PAR 1-30" },
        { key: "minimumAgeDays", label: "Minimum age (days)", type: "number", value: "1" },
        { key: "maximumAgeDays", label: "Maximum age (days)", type: "number", value: "30" }
      ], function (v) {
        return api.post("/delinquency/ranges", writes().delinquencyRangePayload(v)).then(function () {
          api.toast("Delinquency range created", "success");
          return loadSettings();
        });
      }).catch(fail);
    });
    var bucketAdd = $("delinq-bucket-add");
    if (bucketAdd) bucketAdd.addEventListener("click", function () {
      var ranges = window.__deskRanges || [];
      if (!ranges.length) { api.toast("Create a range first", "error"); return; }
      openForm("Add delinquency bucket", [
        { key: "name", label: "Name", required: true },
        { key: "ranges", label: "Range", type: "select", options: ranges.map(function (r) { return { value: r.id, label: r.classification + " (" + r.minimumAgeDays + "–" + r.maximumAgeDays + ")" }; }) }
      ], function (v) {
        return api.post("/delinquency/buckets", writes().delinquencyBucketPayload(v)).then(function () {
          api.toast("Delinquency bucket created", "success");
          return loadSettings();
        });
      }).catch(fail);
    });
    loadSettings().catch(function (err) { fail(err); });
  }

  /* --------------------------------------------------------------- system */
  if (page === "system") {
    var jobs = [];
    function paintJobs() {
      setRows("job-table", jobs.map(function (j) {
        return "<tr><td class=\"strong\">" + esc(j.displayName || j.shortName || j.jobId) + "</td><td class=\"mono\">" + esc(j.cronExpression || "—") +
          "</td><td>" + (j.active ? "Active" : "Inactive") + "</td><td>" + esc(j.lastRunHistory && j.lastRunHistory.jobRunStartTime || "—") +
          '</td><td class="btn-group"><button type="button" class="btn btn-sm btn-amber" data-job-run="' + esc(j.jobId) + '">Run</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-job-hist="' + esc(j.jobId) + '">History</button></td></tr>';
      }).join(""), 5, "No scheduler jobs");
    }
    function paintAudits(rows) {
      setRows("audit-table", rows.map(function (a) {
        var maker = a.maker || a.madeBy || "";
        return "<tr><td class=\"mono\">" + esc(a.id) + "</td><td>" + esc(api.formatDate(a.madeOnDate) + " " + (a.madeOnTime || "")) +
          "</td><td>" + esc(maker) + "</td><td>" + esc(a.actionName) + "</td><td>" + esc(a.entityName) +
          "</td><td class=\"mono\">" + esc(a.resourceId || "") + "</td><td>" + esc(a.processingResult || "") + "</td></tr>";
      }).join(""), 7, "No audit rows");
    }
    function paintChecker(rows) {
      setRows("checker-table", rows.map(function (a) {
        return "<tr><td class=\"mono\">" + esc(a.id) + "</td><td>" + esc(a.maker || "") + "</td><td>" + esc(a.actionName) + " " + esc(a.entityName) +
          "</td><td>" + esc(api.formatDate(a.madeOnDate)) + '</td><td class="btn-group">' +
          '<button type="button" class="btn btn-sm btn-amber" data-mc="approve" data-id="' + esc(a.id) + '">Approve</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-mc="reject" data-id="' + esc(a.id) + '">Reject</button></td></tr>';
      }).join(""), 5, "No commands waiting for a checker");
    }
    async function loadSystem() {
      var pack = await Promise.all([
        api.get("/jobs"),
        api.get("/scheduler").catch(function () { return null; }),
        api.get("/makercheckers").catch(function (err) { return { error: err }; }),
        api.get("/caches").catch(function () { return []; }),
        api.get("/hooks").catch(function () { return []; })
      ]);
      jobs = listOf(pack[0]);
      paintJobs();
      var sched = pack[1];
      var label = $("scheduler-state");
      if (label) label.textContent = sched ? ("Scheduler is " + (sched.active ? "running" : "stopped")) : "Scheduler status unavailable";
      if (pack[2] && pack[2].error) {
        setRows("checker-table", "", 5, pack[2].error.message || "Maker-checker list unavailable");
      } else paintChecker(listOf(pack[2]));
      var caches = listOf(pack[3]);
      setRows("cache-table", caches.map(function (c) {
        var type = c.cacheType || {};
        return "<tr><td>" + esc(type.value || type.code || "") + "</td><td>" + (c.enabled ? "In use" : "Off") +
          '</td><td>' + (c.enabled ? "" : '<button type="button" class="btn btn-sm" data-cache="' + esc(type.id) + '">Switch to this</button>') + "</td></tr>";
      }).join(""), 3, "No cache types");
      setRows("hook-table", listOf(pack[4]).map(function (h) {
        return "<tr><td>" + esc(h.displayName || h.name) + "</td><td>" + (h.isActive ? "Active" : "Inactive") + "</td><td class=\"mono\">" + esc(h.id) + "</td></tr>";
      }).join(""), 3, "No hooks. Creating a hook needs a template URL and event list, so Desk only lists them.");
    }
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var run = t.closest("[data-job-run]");
      var hist = t.closest("[data-job-hist]");
      var mc = t.closest("[data-mc]");
      var cache = t.closest("[data-cache]");
      var start = t.closest("[data-action=scheduler-start]");
      var stop = t.closest("[data-action=scheduler-stop]");
      if (run) {
        api.confirmDialog({
          title: "Run job", summary: "Run this scheduler job now?", confirmLabel: "Run job",
          onConfirm: function () { return api.post("/jobs/" + run.getAttribute("data-job-run") + "?command=executeJob", {}); }
        }).then(function (ok) { if (ok) { api.toast("Job started", "success"); loadSystem().catch(fail); } });
      }
      if (hist) {
        api.get("/jobs/" + hist.getAttribute("data-job-hist") + "/runhistory").then(function (data) {
          var rows = listOf(data);
          var tb = document.querySelector("#job-history tbody");
          if (!tb) return;
          tb.innerHTML = rows.map(function (h) {
            return "<tr><td>" + esc(h.version || h.jobRunStartTime || "") + "</td><td>" + esc(h.status || "") + "</td><td>" + esc(h.jobRunErrorLog || h.jobRunErrorMessage || h.triggerType || "—") + "</td></tr>";
          }).join("") || api.emptyRow(3, "No history for this job");
          var card = $("job-history-card");
          if (card) card.hidden = false;
        }).catch(fail);
      }
      if (mc) {
        var cmd = mc.getAttribute("data-mc");
        api.post("/makercheckers/" + mc.getAttribute("data-id") + "?command=" + cmd, {}).then(function () {
          api.toast(cmd === "approve" ? "Approved" : "Rejected", "success");
          return loadSystem();
        }).catch(fail);
      }
      if (cache) {
        api.put("/caches", { cacheType: Number(cache.getAttribute("data-cache")) }).then(function () {
          api.toast("Cache switched. Fineract clears the previous cache.", "success");
          return loadSystem();
        }).catch(fail);
      }
      if (start || stop) {
        api.post("/scheduler?command=" + (start ? "start" : "stop"), {}).then(function () {
          api.toast(start ? "Scheduler started" : "Scheduler stopped", "success");
          return loadSystem();
        }).catch(fail);
      }
    });
    var auditForm = $("audit-filter");
    if (auditForm) auditForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var params = new URLSearchParams();
      params.set("paged", "true");
      params.set("limit", "50");
      params.set("offset", "0");
      ["actionName", "entityName", "makerDateTimeFrom", "makerDateTimeTo"].forEach(function (key) {
        var el = auditForm.querySelector("[name=" + key + "]");
        if (el && el.value) params.set(key, el.value);
      });
      api.get("/audits?" + params.toString()).then(function (data) { paintAudits(listOf(data)); }).catch(fail);
    });
    loadSystem().then(function () {
      return api.get("/audits?paged=true&limit=50&offset=0");
    }).then(function (data) { if (data) paintAudits(listOf(data)); }).catch(fail);
  }

  /* ------------------------------------------------ standing instructions */
  function standingCard() {
    return $("standing-instructions");
  }
  if (standingCard() && (page === "savings-detail" || page === "client-detail")) {
    async function contextForStanding() {
      var id = api.qs("id");
      if (!id) return null;
      if (page === "client-detail") {
        var client = await api.get("/clients/" + id);
        var accounts = await api.get("/clients/" + id + "/accounts");
        return { clientId: client.id, officeId: client.officeId, savings: (accounts.savingsAccounts || []).filter(function (s) { return s.status && s.status.active; }) };
      }
      var sav = await api.get("/savingsaccounts/" + id);
      var accounts2 = await api.get("/clients/" + sav.clientId + "/accounts");
      return { clientId: sav.clientId, officeId: sav.officeId, savings: (accounts2.savingsAccounts || []).filter(function (s) { return s.status && s.status.active; }), fromAccountId: sav.id };
    }
    async function loadStanding() {
      var ctx = await contextForStanding();
      if (!ctx) return;
      window.__deskSi = ctx;
      var q = "/standinginstructions?limit=50&offset=0&clientId=" + encodeURIComponent(ctx.clientId);
      if (ctx.fromAccountId) q += "&fromAccountType=2&fromAccountId=" + encodeURIComponent(ctx.fromAccountId);
      var data = await api.get(q);
      var rows = listOf(data);
      setRows("si-table", rows.map(function (s) {
        return "<tr><td>" + esc(s.name) + "</td><td class=\"mono\">" + esc(s.fromAccount && (s.fromAccount.accountNo || s.fromAccount.id)) +
          " → " + esc(s.toAccount && (s.toAccount.accountNo || s.toAccount.id)) + "</td><td class=\"mono\">" + api.formatMoney(s.amount) +
          "</td><td>" + api.statusBadge(s.status || "") + '</td><td><button type="button" class="btn btn-sm btn-ghost" data-si-cancel="' + esc(s.id) + '">Cancel</button></td></tr>';
      }).join(""), 5, "No standing instructions");
    }
    var siAdd = $("si-add");
    if (siAdd) siAdd.addEventListener("click", function () {
      var ctx = window.__deskSi;
      if (!ctx || ctx.savings.length < 1) { api.toast("An active savings account is required", "error"); return; }
      var opts = ctx.savings.map(function (s) { return { value: s.id, label: (s.accountNo || s.id) + " · " + (s.productName || "Savings") }; });
      openForm("Create standing instruction", [
        { key: "name", label: "Name", required: true, value: "Monthly transfer" },
        { key: "fromAccountId", label: "From savings", type: "select", value: ctx.fromAccountId ? String(ctx.fromAccountId) : "", options: opts },
        { key: "toAccountId", label: "To savings", type: "select", options: opts },
        { key: "amount", label: "Amount (UGX)", amount: true, required: true },
        { key: "validFrom", label: "Valid from", type: "date", value: today() },
        { key: "recurrenceInterval", label: "Every N months", type: "number", value: "1" }
      ], function (v) {
        if (String(v.fromAccountId) === String(v.toAccountId)) throw new Error("From and to accounts must be different");
        var body = writes().standingInstructionPayload({
          name: v.name,
          fromOfficeId: ctx.officeId,
          fromClientId: ctx.clientId,
          fromAccountType: 2,
          fromAccountId: v.fromAccountId,
          toOfficeId: ctx.officeId,
          toClientId: ctx.clientId,
          toAccountType: 2,
          toAccountId: v.toAccountId,
          transferType: 1,
          amount: v.amount,
          priority: 2,
          status: 1,
          instructionType: 1,
          recurrenceType: 1,
          recurrenceFrequency: 2,
          recurrenceInterval: v.recurrenceInterval,
          validFrom: v.validFrom
        });
        return api.post("/standinginstructions", body).then(function () {
          api.toast("Standing instruction created", "success");
          return loadStanding();
        });
      }).catch(fail);
    });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-si-cancel]");
      if (!btn) return;
      api.put("/standinginstructions/" + btn.getAttribute("data-si-cancel") + "?command=delete", {}).then(function () {
        api.toast("Standing instruction cancelled", "success");
        return loadStanding();
      }).catch(fail);
    });
    loadStanding().catch(function (err) {
      fail(err);
      setRows("si-table", "", 5, "Could not load standing instructions: " + (err.message || err));
    });
  }

  /* ---------------------------------------------------- loan reschedule */
  if (page === "loan-detail" && $("loan-reschedules")) {
    var loanId = api.qs("id");
    function loadReschedules() {
      if (!loanId) return Promise.resolve();
      return api.get("/rescheduleloans?loanId=" + encodeURIComponent(loanId)).then(function (data) {
        var rows = listOf(data);
        setRows("loan-reschedules", rows.map(function (r) {
          var st = r.status || {};
          var pending = st.pendingApproval || st.id === 100 || /pending/i.test(api.statusLabel(st));
          return "<tr><td>" + esc(api.formatDate(r.rescheduleFromDate)) + "</td><td>" + esc(r.rescheduleReasonCodeValue && r.rescheduleReasonCodeValue.name || "") +
            "</td><td>" + api.statusBadge(st) + "</td><td class=\"btn-group\">" +
            (pending ? '<button type="button" class="btn btn-sm btn-amber" data-rs="approve" data-id="' + esc(r.id) + '">Approve</button><button type="button" class="btn btn-sm btn-ghost" data-rs="reject" data-id="' + esc(r.id) + '">Reject</button>' : "") +
            "</td></tr>";
        }).join(""), 4, "No reschedule requests");
      });
    }
    var rsBtn = document.querySelector("[data-action=loan-reschedule]");
    if (rsBtn) rsBtn.addEventListener("click", function () {
      api.get("/codes").then(function (codes) {
        var code = (codes || []).filter(function (c) { return c.name === "LoanRescheduleReason"; })[0];
        if (!code) throw new Error("Loan reschedule reasons are not configured (code LoanRescheduleReason)");
        return api.get("/codes/" + code.id + "/codevalues");
      }).then(function (values) {
        values = values || [];
        if (!values.length) throw new Error("Add at least one LoanRescheduleReason code value before rescheduling");
        return openForm("Reschedule loan", [
          { key: "rescheduleFromDate", label: "Reschedule from", type: "date", value: today() },
          { key: "submittedOnDate", label: "Submitted on", type: "date", value: today() },
          { key: "rescheduleReasonId", label: "Reason", type: "select", options: values.map(function (v) { return { value: v.id, label: v.name }; }) },
          { key: "adjustedDueDate", label: "Move due date to (optional)", type: "date" },
          { key: "extraTerms", label: "Extra installments (optional)", type: "number" },
          { key: "rescheduleReasonComment", label: "Comment" }
        ], function (v) {
          v.loanId = loanId;
          return api.post("/rescheduleloans", writes().loanReschedulePayload(v)).then(function () {
            api.toast("Reschedule submitted for checker approval", "success");
            return loadReschedules();
          });
        });
      }).catch(fail);
    });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-rs]");
      if (!btn) return;
      var cmd = btn.getAttribute("data-rs");
      var body = cmd === "approve" ? { approvedOnDate: today(), locale: "en", dateFormat: "yyyy-MM-dd" } : { rejectedOnDate: today(), locale: "en", dateFormat: "yyyy-MM-dd" };
      api.post("/rescheduleloans/" + btn.getAttribute("data-id") + "?command=" + cmd, body).then(function () {
        api.toast(cmd === "approve" ? "Reschedule approved" : "Reschedule rejected", "success");
        return loadReschedules();
      }).catch(fail);
    });
    loadReschedules().catch(function (err) { setRows("loan-reschedules", "", 4, err.message || "Could not load reschedules"); });
  }

  /* ------------------------------------------------------ share dividends */
  if ((page === "shares" || page === "share-detail") && $("share-dividends")) {
    function loadDividends() {
      return api.get("/products/share").then(function (products) {
        products = listOf(products);
        var sel = $("div-product");
        if (sel && !sel.options.length) {
          sel.innerHTML = products.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("");
        }
        if (!products.length) {
          setRows("share-dividends", "", 5, "Create a share product before posting a dividend");
          return;
        }
        var id = sel ? sel.value : products[0].id;
        return api.get("/shareproduct/" + encodeURIComponent(id) + "/dividend").then(function (data) {
          var rows = listOf(data);
          setRows("share-dividends", rows.map(function (d) {
            var st = d.status || {};
            var pending = /pending|submitted/i.test(api.statusLabel(st)) || st.id === 100;
            return "<tr><td>" + esc(api.formatDate(d.dividendPeriodStartDate)) + " – " + esc(api.formatDate(d.dividendPeriodEndDate)) +
              "</td><td class=\"mono\">" + api.formatMoney(d.amount || d.dividendAmount) + "</td><td>" + api.statusBadge(st) +
              "</td><td>" + (pending ? '<button type="button" class="btn btn-sm btn-amber" data-div-approve="' + esc(d.id) + '" data-product="' + esc(id) + '">Approve</button>' : "") +
              "</td><td></td></tr>";
          }).join(""), 5, "No dividends for this product");
        });
      });
    }
    var divProduct = $("div-product");
    if (divProduct) divProduct.addEventListener("change", function () { loadDividends().catch(fail); });
    var divAdd = $("div-add");
    if (divAdd) divAdd.addEventListener("click", function () {
      var id = divProduct && divProduct.value;
      if (!id) { api.toast("Choose a share product", "error"); return; }
      openForm("Create dividend", [
        { key: "dividendPeriodStartDate", label: "Period start", type: "date", value: api.yearStartISO() },
        { key: "dividendPeriodEndDate", label: "Period end", type: "date", value: today() },
        { key: "dividendAmount", label: "Amount to distribute (UGX)", amount: true, required: true }
      ], function (v) {
        return api.post("/shareproduct/" + id + "/dividend", writes().shareDividendPayload(v)).then(function () {
          api.toast("Dividend created. Approve it to post to members.", "success");
          return loadDividends();
        });
      }).catch(fail);
    });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-div-approve]");
      if (!btn) return;
      api.post("/shareproduct/" + btn.getAttribute("data-product") + "/dividend/" + btn.getAttribute("data-div-approve") + "?command=approve", {})
        .then(function () { api.toast("Dividend approved", "success"); return loadDividends(); }).catch(fail);
    });
    loadDividends().catch(function (err) { setRows("share-dividends", "", 5, err.message || "Could not load dividends"); });
  }

  /* ------------------------------------------ recurring deposit products */
  if (page === "recurring-deposits" && $("rd-products")) {
    function loadRdProducts() {
      return api.get("/recurringdepositproducts").then(function (rows) {
        rows = listOf(rows);
        window.__deskRdProducts = rows;
        setRows("rd-products", rows.map(function (p) {
          return "<tr><td>" + esc(p.name) + "</td><td class=\"mono\">" + esc(p.shortName || "") + "</td><td class=\"mono\">" +
            esc(p.nominalAnnualInterestRate != null ? p.nominalAnnualInterestRate + "%" : "—") + "</td><td class=\"mono\">" +
            api.formatMoney(p.depositAmount) + '</td><td><button type="button" class="btn btn-sm btn-ghost" data-rd-product="' + esc(p.id) + '">Edit</button></td></tr>';
        }).join(""), 5, "No recurring deposit products yet");
      });
    }
    function productDialog(current) {
      current = current || {};
      return openForm(current.id ? "Edit recurring deposit product" : "Create recurring deposit product", [
        { key: "name", label: "Name", value: current.name || "Monthly RD", required: true },
        { key: "shortName", label: "Short name (4)", value: current.shortName || "MRD", maxLength: 4 },
        { key: "interestRate", label: "Interest % p.a.", value: current.nominalAnnualInterestRate != null ? String(current.nominalAnnualInterestRate) : "6" },
        { key: "depositAmount", label: "Deposit / installment amount", value: current.depositAmount != null ? String(current.depositAmount) : "20000" },
        { key: "accountingRule", label: "Accounting", type: "select", value: String(current.accountingRule && current.accountingRule.id || 1), options: [{ value: "1", label: "None" }, { value: "2", label: "Cash" }] }
      ], function (v) {
        return Promise.all([api.get("/currencies"), api.get("/glaccounts")]).then(function (pack) {
          var body = writes().recurringDepositPayload(v, writes().currencyPack(pack[0]), listOf(pack[1]));
          var req = current.id ? api.put("/recurringdepositproducts/" + current.id, body) : api.post("/recurringdepositproducts", body);
          return req.then(function () {
            api.toast(current.id ? "Product updated" : "Recurring deposit product created", "success");
            return loadRdProducts();
          });
        });
      });
    }
    var add = $("rd-product-add");
    if (add) add.addEventListener("click", function () { productDialog(null).catch(fail); });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-rd-product]");
      if (!btn) return;
      var current = (window.__deskRdProducts || []).filter(function (p) { return String(p.id) === btn.getAttribute("data-rd-product"); })[0];
      if (!current) return;
      api.get("/recurringdepositproducts/" + current.id).then(function (full) { return productDialog(full); }).catch(fail);
    });
    loadRdProducts().catch(function (err) { setRows("rd-products", "", 5, err.message || "Could not load products"); });
  }

  /* ------------------------------------------------ honest client import */
  if (page === "clients" && $("client-import")) {
    var panel = $("client-import");
    var openBtn = $("client-import-open");
    if (openBtn) openBtn.addEventListener("click", function () { panel.hidden = false; });
    function paintImports(rows) {
      setRows("import-table", (rows || []).map(function (r) {
        return "<tr><td class=\"mono\">" + esc(r.importId || r.importTime || "") + "</td><td>" + esc(r.name || r.documentName || "workbook") +
          "</td><td>" + esc(api.formatDate(r.importTime)) + "</td><td>" + esc(r.completed === false ? "Processing" : (r.endTime ? "Finished" : "Accepted")) +
          "</td><td class=\"mono\">" + esc(r.totalRecords != null ? r.totalRecords : "—") + "</td></tr>";
      }).join(""), 5, "No client imports yet");
    }
    function refreshImports() {
      return api.get("/imports?entityType=client").then(function (rows) { paintImports(listOf(rows)); }).catch(function (err) {
        setRows("import-table", "", 5, "Import history could not be loaded (" + (err.message || "error") + "). An upload is still reported by its own response.");
      });
    }
    var download = $("import-download");
    if (download) download.addEventListener("click", function () {
      api.get("/offices").then(function (offices) {
        var office = (listOf(offices)[0] || {}).id || 1;
        var path = "/clients/downloadtemplate?legalFormType=CLIENTS_PERSON&officeId=" + encodeURIComponent(office) + "&dateFormat=" + encodeURIComponent("dd MMMM yyyy");
        return api.getBlob(path);
      }).then(function (file) {
        var url = URL.createObjectURL(file.blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = file.name && file.name !== "download" ? file.name : "clients-import.xls";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        api.toast("Workbook template downloaded. Fill that file. A CSV is not this import.", "success");
      }).catch(fail);
    });
    var upload = $("import-upload");
    if (upload) upload.addEventListener("click", function () {
      var input = $("import-file");
      var file = input && input.files && input.files[0];
      var status = $("import-status");
      if (!file) { api.toast("Choose the filled workbook first", "error"); return; }
      if (/\.csv$/i.test(file.name)) {
        if (status) status.textContent = "Fineract's client bulk import expects the downloaded Excel workbook, not a CSV. Desk did not upload this file and did not create any members.";
        api.toast("CSV was not uploaded", "error");
        return;
      }
      var body = new FormData();
      body.append("file", file, file.name);
      body.append("locale", "en");
      body.append("dateFormat", "dd MMMM yyyy");
      api.postForm("/clients/uploadtemplate?legalFormType=CLIENTS_PERSON", body).then(function (data) {
        var id = data && data.resourceId ? data.resourceId : data;
        if (status) status.textContent = "Fineract accepted the workbook as import " + id + ". Row errors, if any, stay on the import record. Desk does not mark members as created until they appear in the client list.";
        api.toast("Workbook accepted as import " + id, "success");
        return refreshImports();
      }).catch(function (err) {
        if (status) status.textContent = "Upload failed: " + (err.message || err) + ". No members were imported.";
        fail(err);
      });
    });
    refreshImports();
  }
})();
