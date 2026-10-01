/*
 * Pivot SACCO Desk — Accounting & Reports module (reads + writes).
 * Loaded only by the accounting, journal, closing, mapping, rule, accrual, financial-statement,
 * report-catalogue and member-statement pages (instead of pages.js / actions.js).
 */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;

  var page = document.body.getAttribute("data-page") || "";
  var sess = api.getSession() || {};
  var esc = api.escapeHtml;
  var DATE = { locale: "en", dateFormat: "yyyy-MM-dd" };
  var INCEPTION = "1970-01-01";
  var SACCO = "Phaneroo SACCO";
  var LOGO = "assets/phaneroo-logo.png";
  var TYPE_NAMES = { 1: "Assets", 2: "Liabilities", 3: "Equity", 4: "Income", 5: "Expenses" };
  var TYPE_SINGULAR = { 1: "Asset", 2: "Liability", 3: "Equity", 4: "Income", 5: "Expense" };

  /* ------------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function round2(n) { return Math.round(n * 100) / 100; }
  /* Accounting format: whole UGX, negatives in brackets. */
  function amt(n) {
    if (n === null || n === undefined || n === "") return "";
    var v = Number(n);
    if (isNaN(v)) return "";
    v = Math.round(v);
    return v < 0 ? "(" + api.formatNumber(-v) + ")" : api.formatNumber(v);
  }
  function friendlyError(err) {
    var m = (err && (err.message || String(err))) || "Unknown error";
    if (/BadSqlGrammar|SQLGrammar|PSQLException|syntax error|operator does not exist/i.test(m)) {
      return "This report's SQL does not run on this database (PostgreSQL). An administrator must apply the report fixes " +
        "(Fineract changeset 0255) to this tenant. Other reports still work.";
    }
    if (err && err.status === 403 && /permission|not authori[sz]ed/i.test(m)) return "You do not have permission for this. " + m;
    if (err && err.status === 500) return "Fineract could not complete this request (server error). " + (m === "HTTP 500" ? "" : m);
    return m;
  }
  function toastErr(err) { if (err && err.status !== 401) api.toast(friendlyError(err), "error"); }
  function run(fn) {
    return Promise.resolve().then(fn).then(function () { api.clearStatus(); }).catch(function (err) {
      if (err && err.status === 401) return;
      document.querySelectorAll("tr.loading-row td").forEach(function (td) { td.textContent = "Could not load: " + friendlyError(err); });
      if (err && !err.status) api.setStatus("Cannot reach Fineract — data may be stale. " + (err.message || ""));
      toastErr(err);
    });
  }
  /* Click handler with a busy guard so a double click cannot start two flows. */
  function onClick(el, fn) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.getAttribute("aria-busy") === "true") return;
      el.setAttribute("aria-busy", "true");
      Promise.resolve().then(function () { return fn(el); }).catch(toastErr).then(function () { el.removeAttribute("aria-busy"); });
    });
  }
  function onSubmit(form, fn) {
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      if (btn && btn.disabled) return;
      if (btn) btn.disabled = true;
      Promise.resolve().then(function () { return fn(form); }).catch(toastErr).then(function () { if (btn) btn.disabled = false; });
    });
  }
  function arr(x) { return Array.isArray(x) ? x : ((x && x.pageItems) || []); }

  var officesPromise = null;
  function loadOffices() {
    if (!officesPromise) {
      officesPromise = api.get("/offices?orderBy=hierarchy").then(arr).catch(function (e) { officesPromise = null; throw e; });
    }
    return officesPromise;
  }
  function officeLabel(o) {
    var dec = String(o.nameDecorated || o.name || "");
    var depth = (dec.match(/^\.*/) || [""])[0].length / 4;
    return (depth > 0 ? new Array(Math.round(depth) + 1).join("  ") + "· " : "") + (o.name || "");
  }
  function fillOffices(select, offices, opts) {
    if (!select) return;
    opts = opts || {};
    select.innerHTML = (opts.allLabel ? '<option value="">' + esc(opts.allLabel) + "</option>" : "") + offices.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(officeLabel(o)) + "</option>";
    }).join("");
    var want = opts.selected !== undefined ? opts.selected : "";
    if (want !== "" && offices.some(function (o) { return String(o.id) === String(want); })) select.value = String(want);
  }
  function defaultOffice(offices) {
    var has = offices.some(function (o) { return String(o.id) === String(sess.officeId); });
    return has ? String(sess.officeId) : (offices[0] ? String(offices[0].id) : "");
  }
  function selectedText(sel) { return sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text.replace(/^[\s ·]+/, "") : ""; }

  var glPromise = null;
  function loadGls(force) {
    if (!glPromise || force) glPromise = api.get("/glaccounts").then(arr).catch(function (e) { glPromise = null; throw e; });
    return glPromise;
  }
  function glType(g) { return g && g.type ? Number(g.type.id) : 0; }
  function isHeader(g) { return g && g.usage && Number(g.usage.id) === 2; }
  function glLabel(g) { return (g.glCode ? g.glCode + " · " : "") + (g.name || ""); }
  function byCode(a, b) { return String(a.glCode || "").localeCompare(String(b.glCode || ""), undefined, { numeric: true }); }

  /* Generic result set → { cols: [{name, type}], rows: [[...]] } */
  function resultSet(data) {
    var cols = ((data && data.columnHeaders) || []).map(function (h) {
      return { name: String(h.columnName || ""), type: String(h.columnDisplayType || h.columnType || "").toUpperCase() };
    });
    var rows = ((data && data.data) || []).map(function (r) { return r.row || []; });
    return { cols: cols, rows: rows };
  }
  function rowObjects(data) {
    var rs = resultSet(data);
    var keys = rs.cols.map(function (c) { return c.name.toLowerCase(); });
    return rs.rows.map(function (r) {
      var o = {};
      r.forEach(function (v, i) { o[keys[i]] = v; });
      return o;
    });
  }
  function runReport(name, params) {
    var p = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { p.set("R_" + k, params[k]); });
    p.set("locale", "en");
    p.set("dateFormat", "yyyy-MM-dd");
    p.set("genericResultSet", "true");
    return api.get("/runreports/" + encodeURIComponent(name) + "?" + p.toString());
  }

  /* CSV export (client-side, UTF-8 with BOM so Excel opens it correctly). */
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) v = api.formatDate(v);
    var s = String(v);
    if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; /* spreadsheet formula injection */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv(filename, header, rows) {
    var lines = [header].concat(rows).map(function (r) { return r.map(csvCell).join(","); });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/[^\w.\- ]+/g, "_");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function fileStamp() { return api.todayISO(); }

  /* Print header shown only on paper. */
  function printHead(title, sub) {
    var el = $("print-head");
    if (!el) return;
    el.innerHTML = '<img src="' + LOGO + '" alt="" class="print-logo" /><div><div class="print-sacco">' + esc(SACCO) + "</div>" +
      '<div class="print-title">' + esc(title) + "</div>" + (sub ? '<div class="print-sub">' + esc(sub) + "</div>" : "") +
      '<div class="print-sub">Printed ' + esc(api.todayISO()) + " by " + esc(sess.username || "") + "</div></div>";
  }

  /* Simple modal (read view). buttons: [{label, cls, onClick(close) }] */
  function modal(title, bodyHtml, buttons) {
    var lastFocus = document.activeElement;
    var overlay = document.createElement("div");
    overlay.className = "dialog-overlay acct-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    var tid = "acct-modal-" + Date.now();
    overlay.setAttribute("aria-labelledby", tid);
    var box = document.createElement("div");
    box.className = "card dialog dialog-wide";
    box.innerHTML = '<div class="card-h"><h2 id="' + tid + '">' + esc(title) + '</h2></div><div class="card-b"><div class="acct-modal-body">' + bodyHtml +
      '</div><div class="form-actions acct-modal-actions"></div></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.body.classList.add("acct-modal-open");
    var actionsEl = box.querySelector(".acct-modal-actions");
    function close() {
      overlay.remove();
      document.body.classList.remove("acct-modal-open");
      document.removeEventListener("keydown", onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    (buttons || []).concat([{ label: "Close", cls: "btn-ghost", onClick: function (c) { c(); } }]).forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn " + (b.cls || "");
      btn.textContent = b.label;
      onClick(btn, function () { return b.onClick(close, btn); });
      actionsEl.appendChild(btn);
    });
    var first = actionsEl.querySelector("button");
    if (first) first.focus();
    return { close: close, box: box };
  }

  /* ================================================================== CHART OF ACCOUNTS */
  if (page === "accounting") {
    var coaBody = document.querySelector("#coa-table tbody");
    var coaAsAt = $("coa-asat");
    coaAsAt.value = api.todayISO();
    coaAsAt.max = api.todayISO();
    var coaState = { gls: [], bal: {}, balOk: false };

    var coaBalances = async function (asAt) {
      /* Fineract's /glaccounts?fetchRunningBalance=true fails on PostgreSQL, so balances come from the
         Trial Balance report (all offices, from inception to the as-at date). */
      try {
        var rows = rowObjects(await runReport("Trial Balance Table", { officeId: 1, startDate: INCEPTION, endDate: asAt }));
        var out = {};
        rows.forEach(function (r) {
          var v = r.debit !== null && r.debit !== undefined ? num(r.debit) : num(r.credit);
          out[String(r.glcode)] = v;
        });
        return { ok: true, bal: out };
      } catch (err) {
        return { ok: false, bal: {}, err: err };
      }
    };

    var paintCoa = function () {
      var q = ($("coa-filter").value || "").toLowerCase().trim();
      var typeF = $("coa-type").value;
      var showDisabled = $("coa-disabled").checked;
      var gls = coaState.gls;
      var byId = {}, kids = {};
      gls.forEach(function (g) { byId[g.id] = g; });
      gls.forEach(function (g) {
        var p = g.parentId && byId[g.parentId] ? g.parentId : 0;
        (kids[p] = kids[p] || []).push(g);
      });
      Object.keys(kids).forEach(function (k) { kids[k].sort(byCode); });
      var total = {};
      function sumOf(g) {
        if (total[g.id] !== undefined) return total[g.id];
        var v = isHeader(g) ? 0 : num(coaState.bal[String(g.glCode)]);
        (kids[g.id] || []).forEach(function (c) { if (glType(c) === glType(g)) v += sumOf(c); });
        total[g.id] = v;
        return v;
      }
      var canEdit = api.can("UPDATE_GLACCOUNT");
      var html = "";
      var typeTotals = {};
      function rowHtml(g, depth) {
        var b = sumOf(g);
        var hdr = isHeader(g);
        var cls = (hdr ? "coa-header" : "") + (g.disabled ? " coa-disabled" : "");
        return "<tr class=\"" + cls.trim() + "\" data-gl=\"" + esc(g.id) + "\">" +
          "<td class=\"mono\">" + esc(g.glCode || "") + "</td>" +
          "<td><span class=\"coa-name lvl-" + Math.min(depth, 6) + "\">" + (hdr ? "<strong>" + esc(g.name) + "</strong>" : esc(g.name)) + "</span></td>" +
          "<td>" + esc(TYPE_SINGULAR[glType(g)] || "") + "</td>" +
          "<td>" + (hdr ? "Header" : "Detail") + "</td>" +
          "<td class=\"mono text-right\">" + (coaState.balOk ? (hdr ? "<strong>" + amt(b) + "</strong>" : amt(b)) : "—") + "</td>" +
          "<td>" + (hdr ? "—" : (g.manualEntriesAllowed ? "Allowed" : "System only")) + "</td>" +
          "<td>" + (g.disabled ? "<span class=\"status closed\">Disabled</span>" : "<span class=\"status active\">Active</span>") + "</td>" +
          "<td class=\"nowrap\">" + (canEdit ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-edit-gl=\"" + esc(g.id) + "\" aria-label=\"Edit " + esc(g.glCode + " " + g.name) + "\">Edit</button>" : "") +
          " <a class=\"btn btn-sm btn-ghost\" href=\"journals.html?gl=" + encodeURIComponent(g.id) + "\" aria-label=\"Journal entries for " + esc(g.glCode + " " + g.name) + "\">Entries</a></td></tr>";
      }
      function matches(g) {
        if (!showDisabled && g.disabled) return false;
        if (!q) return true;
        return (String(g.glCode || "") + " " + (g.name || "")).toLowerCase().indexOf(q) >= 0;
      }
      function subtreeMatches(g) {
        if (matches(g)) return true;
        return (kids[g.id] || []).some(subtreeMatches);
      }
      function walk(list, depth) {
        list.forEach(function (g) {
          if (!subtreeMatches(g)) return;
          html += rowHtml(g, depth);
          walk(kids[g.id] || [], depth + 1);
        });
      }
      [1, 2, 3, 4, 5].forEach(function (t) {
        if (typeF && String(t) !== typeF) return;
        var roots = (kids[0] || []).filter(function (g) { return glType(g) === t; });
        var tt = 0;
        gls.forEach(function (g) { if (glType(g) === t && !isHeader(g)) tt += num(coaState.bal[String(g.glCode)]); });
        typeTotals[t] = tt;
        if (!roots.length) return;
        html += "<tr class=\"group-row\"><td colspan=\"4\"><strong>" + esc(TYPE_NAMES[t]) + "</strong></td><td class=\"mono text-right\"><strong>" +
          (coaState.balOk ? amt(tt) : "—") + "</strong></td><td colspan=\"3\"></td></tr>";
        walk(roots, 0);
      });
      coaBody.innerHTML = html || api.emptyRow(8, gls.length ? "No accounts match this filter" : "No GL accounts yet");
      var chk = $("coa-check");
      if (coaState.balOk) {
        var a = typeTotals[1] || 0, l = typeTotals[2] || 0, e = typeTotals[3] || 0, inc = typeTotals[4] || 0, ex = typeTotals[5] || 0;
        var diff = round2(a + ex - (l + e + inc));
        var counts = gls.filter(function (g) { return !isHeader(g); }).length + " detail · " + gls.filter(isHeader).length + " header accounts";
        chk.innerHTML = "<span>" + esc(counts) + "</span> · <span>Debits (assets + expenses) " + amt(a + ex) + " · Credits (liabilities + equity + income) " + amt(l + e + inc) + "</span> " +
          (Math.abs(diff) < 1 ? "<span class=\"status active\">Ledger balances</span>" : "<span class=\"status overdue\">Out of balance by " + amt(diff) + "</span>");
      } else {
        chk.textContent = "Balances could not be loaded: " + friendlyError(coaState.balErr);
      }
    };

    var loadCoa = async function () {
      coaBody.innerHTML = api.loadingRow(8);
      var res = await Promise.all([loadGls(true), coaBalances(coaAsAt.value || api.todayISO())]);
      coaState.gls = res[0];
      coaState.bal = res[1].bal;
      coaState.balOk = res[1].ok;
      coaState.balErr = res[1].err;
      paintCoa();
    };

    ["coa-filter", "coa-type", "coa-disabled"].forEach(function (id) {
      $(id).addEventListener(id === "coa-filter" ? "input" : "change", paintCoa);
    });
    $("coa-asat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!api.isISODate(coaAsAt.value)) { api.toast("Choose a valid date", "error"); return; }
      run(loadCoa);
    });

    var glDialog = async function (g) {
      var gls = await loadGls(true);
      var headers = gls.filter(isHeader).filter(function (h) { return !g || h.id !== g.id; }).sort(byCode);
      var typeOpts = [1, 2, 3, 4, 5].map(function (t) { return { value: String(t), label: TYPE_SINGULAR[t] }; });
      var fields = [
        { key: "name", label: "Account name", required: true, value: g ? g.name : "" },
        { key: "glCode", label: "GL code", required: true, value: g ? g.glCode : "", help: "Use the chart's numbering, e.g. 1150 under 1100" },
        { key: "type", label: "Type", type: "select", required: true, value: g ? String(glType(g)) : "1", options: typeOpts },
        { key: "usage", label: "Usage", type: "select", required: true, value: g ? String(g.usage.id) : "1",
          options: [{ value: "1", label: "Detail (can be posted to)" }, { value: "2", label: "Header (groups accounts)" }] },
        { key: "parentId", label: "Parent header", type: "select", value: g && g.parentId ? String(g.parentId) : "", placeholder: "— None (top level) —",
          options: headers.map(function (h) { return { value: String(h.id), label: glLabel(h) + " (" + TYPE_SINGULAR[glType(h)] + ")" }; }) },
        { key: "manual", label: "Manual journal entries", type: "select", value: g ? String(!!g.manualEntriesAllowed) : "true",
          options: [{ value: "true", label: "Allowed" }, { value: "false", label: "Not allowed (system postings only)" }] },
        { key: "description", label: "Description", type: "textarea", value: g ? (g.description || "") : "" }
      ];
      if (g) fields.splice(6, 0, { key: "disabled", label: "Status", type: "select", value: String(!!g.disabled),
        options: [{ value: "false", label: "Active" }, { value: "true", label: "Disabled (no new postings)" }] });
      var v = await api.openDialog({
        title: g ? "Edit GL account " + g.glCode : "Create GL account", submitLabel: g ? "Save changes" : "Create account", fields: fields,
        validate: function (val) {
          if (!/^[A-Za-z0-9.\-]{1,45}$/.test(String(val.glCode || "").trim())) return "GL code: letters, digits, dot or dash only.";
          if (val.parentId) {
            var p = headers.filter(function (h) { return String(h.id) === String(val.parentId); })[0];
            if (p && String(glType(p)) !== String(val.type)) return "The parent header must be of the same type (" + TYPE_SINGULAR[glType(p)] + ").";
          }
          var clash = gls.filter(function (x) { return String(x.glCode) === String(val.glCode).trim() && (!g || x.id !== g.id); })[0];
          if (clash) return "GL code " + val.glCode + " is already used by " + clash.name + ".";
          return "";
        },
        onSubmit: function (val) {
          var body = {
            name: val.name.trim(), glCode: String(val.glCode).trim(), type: Number(val.type), usage: Number(val.usage),
            manualEntriesAllowed: val.manual === "true", description: (val.description || "").trim() || val.name.trim()
          };
          if (val.parentId) body.parentId = Number(val.parentId);
          if (g) {
            body.disabled = val.disabled === "true";
            return api.put("/glaccounts/" + encodeURIComponent(g.id), body);
          }
          return api.post("/glaccounts", body);
        }
      });
      if (v) {
        api.toast(g ? "GL account updated" : "GL account created", "success");
        await loadCoa();
      }
    };
    onClick($("coa-new"), function () { return glDialog(null); });
    coaBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-edit-gl]");
      if (!b) return;
      var g = coaState.gls.filter(function (x) { return String(x.id) === b.getAttribute("data-edit-gl"); })[0];
      if (g) glDialog(g).catch(toastErr);
    });
    onClick($("coa-csv"), function () {
      var rows = coaState.gls.slice().sort(byCode).map(function (g) {
        return [g.glCode, g.name, TYPE_SINGULAR[glType(g)], isHeader(g) ? "Header" : "Detail",
          (coaState.gls.filter(function (p) { return p.id === g.parentId; })[0] || {}).glCode || "",
          isHeader(g) ? "" : (coaState.balOk ? Math.round(num(coaState.bal[String(g.glCode)])) : ""),
          g.manualEntriesAllowed ? "Yes" : "No", g.disabled ? "Disabled" : "Active"];
      });
      downloadCsv("chart-of-accounts-" + coaAsAt.value + ".csv",
        ["GL code", "Name", "Type", "Usage", "Parent code", "Balance as at " + coaAsAt.value + " (UGX)", "Manual entries", "Status"], rows);
    });
    run(loadCoa);
  }

  /* ================================================================== JOURNALS */
  var voucherHtml = function (legs) {
    var f = legs[0] || {};
    var dr = 0, cr = 0;
    var rows = legs.slice().sort(function (a, b) {
      var ad = a.entryType && a.entryType.value === "DEBIT" ? 0 : 1, bd = b.entryType && b.entryType.value === "DEBIT" ? 0 : 1;
      return ad - bd || byCode({ glCode: a.glAccountCode }, { glCode: b.glAccountCode });
    }).map(function (j) {
      var isDr = j.entryType && j.entryType.value === "DEBIT";
      if (isDr) dr += num(j.amount); else cr += num(j.amount);
      return "<tr><td class=\"mono\">" + esc(j.glAccountCode || "") + "</td><td>" + esc(j.glAccountName || "") + "</td><td>" + esc(j.officeName || "") +
        "</td><td class=\"mono text-right\">" + (isDr ? api.formatNumber(j.amount) : "") + "</td><td class=\"mono text-right\">" + (isDr ? "" : api.formatNumber(j.amount)) + "</td></tr>";
    }).join("");
    var det = f.transactionDetails || {};
    var pay = det.paymentDetails || {};
    var meta = [
      ["Transaction ID", f.transactionId],
      ["Value date", api.formatDate(f.transactionDate)],
      ["Office", f.officeName],
      ["Reference", f.referenceNumber || "—"],
      ["Source", f.manualEntry ? "Manual journal" : ((f.entityType && f.entityType.value) || "System") + (f.entityId ? " #" + f.entityId : "")],
      ["Payment type", (pay.paymentType && pay.paymentType.name) || "—"],
      ["Posted by", (f.createdByUserName || "—") + (f.createdDate ? " · " + api.formatDate(f.createdDate) : "")],
      ["Status", f.reversed ? "REVERSED" : "Posted"]
    ];
    return "<div class=\"voucher\" id=\"voucher\"><div class=\"voucher-head\"><img src=\"" + LOGO + "\" alt=\"\" class=\"voucher-logo\" /><div><div class=\"voucher-sacco\">" + esc(SACCO) +
      "</div><div class=\"voucher-title\">Journal voucher</div></div>" + (f.reversed ? "<span class=\"status overdue\">Reversed</span>" : "") + "</div>" +
      "<dl class=\"voucher-meta\">" + meta.map(function (m) { return "<div><dt>" + esc(m[0]) + "</dt><dd>" + esc(m[1] === undefined || m[1] === null ? "—" : m[1]) + "</dd></div>"; }).join("") + "</dl>" +
      "<p class=\"voucher-narr\"><strong>Narration:</strong> " + esc(f.comments || "—") + "</p>" +
      "<div class=\"table-wrap\"><table class=\"data\"><thead><tr><th>GL</th><th>Account</th><th>Office</th><th class=\"text-right\">Debit (UGX)</th><th class=\"text-right\">Credit (UGX)</th></tr></thead><tbody>" + rows +
      "</tbody><tfoot><tr class=\"strong total-row\"><td colspan=\"3\">Totals " + (Math.abs(dr - cr) < 0.01 ? "" : "— NOT BALANCED") + "</td><td class=\"mono text-right\">" + api.formatNumber(dr) +
      "</td><td class=\"mono text-right\">" + api.formatNumber(cr) + "</td></tr></tfoot></table></div>" +
      "<div class=\"voucher-sign\"><div>Prepared by<br /><span>" + esc(f.createdByUserName || "") + "</span></div><div>Checked by<br /><span>&nbsp;</span></div><div>Approved by<br /><span>&nbsp;</span></div></div></div>";
  };
  var showVoucher = async function (txnId, onChange) {
    var data = await api.get("/journalentries?transactionId=" + encodeURIComponent(txnId) + "&transactionDetails=true&offset=0&limit=200");
    var legs = arr(data);
    if (!legs.length) throw new Error("No journal entry found with transaction ID " + txnId + ".");
    var f = legs[0];
    var buttons = [{ label: "Print voucher", cls: "", onClick: function () { document.body.classList.add("print-modal"); window.print(); document.body.classList.remove("print-modal"); } }];
    if (!f.reversed && f.manualEntry && api.can("REVERSE_JOURNALENTRY")) {
      buttons.unshift({
        label: "Reverse entry", cls: "btn-danger", onClick: async function (close) {
          var res = null;
          var v = await api.openDialog({
            title: "Reverse journal " + txnId, submitLabel: "Review",
            message: "A reversing entry with the opposite debits and credits is posted. The original stays on the ledger, marked reversed.",
            fields: [{ key: "comments", label: "Reason for reversal", type: "textarea", required: true }],
            validate: function (val) { return String(val.comments || "").trim().length < 5 ? "Give a reason (at least 5 characters)." : ""; },
            confirm: function (val) {
              return { title: "Confirm reversal", lines: [["Transaction", txnId], ["Value date", api.formatDate(f.transactionDate)], ["Reason", val.comments.trim()]], confirmLabel: "Reverse entry" };
            },
            onSubmit: function (val) {
              return api.post("/journalentries/" + encodeURIComponent(txnId) + "?command=reverse", { comments: val.comments.trim() }).then(function (x) { res = x; });
            }
          });
          if (!v) return;
          api.toast("Entry reversed" + (res && res.transactionId ? " · reversal " + res.transactionId : ""), "success");
          close();
          if (onChange) onChange();
        }
      });
    }
    var note = !f.manualEntry && !f.reversed ? "<p class=\"text-muted small-note no-print\">System entries are reversed by undoing the source transaction (loan, savings or teller), not here.</p>" : "";
    modal("Journal " + txnId, voucherHtml(legs) + note, buttons);
  };

  if (page === "journals") {
    var jeBody = document.querySelector("#je-table tbody");
    var jePager = $("je-pager");
    var JE_LIMIT = 50;
    var jeOffset = 0;
    var jeLast = [];
    var jeParams = function () {
      var p = new URLSearchParams({ orderBy: "id", sortOrder: "DESC" });
      var from = $("je-from").value, to = $("je-to").value;
      if (from) p.set("fromDate", from);
      if (to) p.set("toDate", to);
      if (from || to) { p.set("dateFormat", "yyyy-MM-dd"); p.set("locale", "en"); }
      if ($("je-office").value) p.set("officeId", $("je-office").value);
      if ($("je-gl").value) p.set("glAccountId", $("je-gl").value);
      if ($("je-manual").value) p.set("manualEntriesOnly", "true");
      if ($("je-txn").value.trim()) p.set("transactionId", $("je-txn").value.trim());
      return p;
    };
    var jeRow = function (j) {
      var isDr = j.entryType && j.entryType.value === "DEBIT";
      var src = j.manualEntry ? "Manual" : ((j.entityType && j.entityType.value) ? String(j.entityType.value).replace(/_/g, " ").toLowerCase() : "System");
      return "<tr" + (j.reversed ? " class=\"je-reversed\"" : "") + "><td>" + esc(api.formatDate(j.transactionDate)) + "</td>" +
        "<td><button type=\"button\" class=\"link-btn mono\" data-txn=\"" + esc(j.transactionId) + "\" aria-label=\"Open journal " + esc(j.transactionId) + "\">" + esc(j.transactionId || j.id) + "</button></td>" +
        "<td>" + esc(j.officeName || "") + "</td>" +
        "<td><span class=\"mono\">" + esc(j.glAccountCode || "") + "</span> " + esc(j.glAccountName || "") + "</td>" +
        "<td class=\"mono text-right\">" + (isDr ? api.formatNumber(j.amount) : "") + "</td>" +
        "<td class=\"mono text-right\">" + (isDr ? "" : api.formatNumber(j.amount)) + "</td>" +
        "<td>" + esc(j.referenceNumber || "") + "</td>" +
        "<td>" + esc(j.comments || "") + (j.reversed ? " <span class=\"status closed\">Reversed</span>" : "") + "</td>" +
        "<td>" + esc(src) + "</td><td>" + esc(j.createdByUserName || "") + "</td></tr>";
    };
    var jeFilterPage = function () {
      var q = ($("je-quick").value || "").toLowerCase().trim();
      var items = q ? jeLast.filter(function (j) {
        return [j.referenceNumber, j.comments, j.glAccountName, j.glAccountCode, j.transactionId, j.createdByUserName].join(" ").toLowerCase().indexOf(q) >= 0;
      }) : jeLast;
      var dr = 0, cr = 0;
      items.forEach(function (j) { if (j.entryType && j.entryType.value === "DEBIT") dr += num(j.amount); else cr += num(j.amount); });
      jeBody.innerHTML = items.map(jeRow).join("") || api.emptyRow(10, q ? "Nothing on this page matches “" + q + "”" : "No journal entries for these filters");
      $("je-page-totals").textContent = items.length ? "This page: debits " + api.formatNumber(dr) + " · credits " + api.formatNumber(cr) : "";
    };
    var loadJe = async function (offset) {
      jeOffset = Math.max(0, offset || 0);
      jeBody.innerHTML = api.loadingRow(10);
      var p = jeParams();
      p.set("offset", jeOffset);
      p.set("limit", JE_LIMIT);
      var data;
      try {
        data = await api.get("/journalentries?" + p.toString());
      } catch (err) {
        jeBody.innerHTML = api.emptyRow(10, "Could not load: " + friendlyError(err));
        jePager.innerHTML = "";
        throw err;
      }
      jeLast = arr(data);
      var total = typeof data.totalFilteredRecords === "number" ? data.totalFilteredRecords : jeLast.length;
      jeFilterPage();
      var to = jeOffset + jeLast.length;
      jePager.innerHTML = '<span class="pager-info">Lines ' + (total ? jeOffset + 1 : 0) + "–" + to + " of " + api.formatNumber(total) + "</span>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-pg="prev"' + (jeOffset <= 0 ? " disabled" : "") + ">‹ Prev</button>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-pg="next"' + (to >= total ? " disabled" : "") + ">Next ›</button>";
    };
    jePager.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pg]");
      if (!b || b.disabled) return;
      run(function () { return loadJe(b.getAttribute("data-pg") === "next" ? jeOffset + JE_LIMIT : jeOffset - JE_LIMIT); });
    });
    $("je-quick").addEventListener("input", jeFilterPage);
    jeBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-txn]");
      if (!b) return;
      showVoucher(b.getAttribute("data-txn"), function () { run(function () { return loadJe(jeOffset); }); }).catch(toastErr);
    });
    $("je-filter").addEventListener("submit", function (e) {
      e.preventDefault();
      var from = $("je-from").value, to = $("je-to").value;
      if (from && to && from > to) { api.toast("From date must be on or before To date", "error"); return; }
      run(function () { return loadJe(0); });
    });
    $("je-reset").addEventListener("click", function () {
      ["je-from", "je-to", "je-txn", "je-quick"].forEach(function (id) { $(id).value = ""; });
      ["je-office", "je-gl", "je-manual"].forEach(function (id) { $(id).value = ""; });
      run(function () { return loadJe(0); });
    });
    onClick($("je-csv"), async function () {
      var p = jeParams();
      var all = [], off = 0, total = Infinity;
      while (off < total && off < 10000) {
        p.set("offset", off);
        p.set("limit", 500);
        var d = await api.get("/journalentries?" + p.toString());
        var items = arr(d);
        total = typeof d.totalFilteredRecords === "number" ? d.totalFilteredRecords : items.length;
        all = all.concat(items);
        if (!items.length) break;
        off += items.length;
      }
      downloadCsv("journal-entries-" + fileStamp() + ".csv",
        ["Date", "Transaction ID", "Office", "GL code", "GL account", "Debit", "Credit", "Reference", "Narration", "Manual", "Reversed", "Posted by"],
        all.map(function (j) {
          var isDr = j.entryType && j.entryType.value === "DEBIT";
          return [api.formatDate(j.transactionDate), j.transactionId, j.officeName, j.glAccountCode, j.glAccountName, isDr ? j.amount : "", isDr ? "" : j.amount,
            j.referenceNumber || "", j.comments || "", j.manualEntry ? "Yes" : "No", j.reversed ? "Yes" : "No", j.createdByUserName || ""];
        }));
      if (total > all.length) api.toast("Exported the first " + all.length + " lines; narrow the filters for the rest.", "error");
    });
    run(async function () {
      var res = await Promise.all([loadOffices(), loadGls()]);
      fillOffices($("je-office"), res[0], { allLabel: "All offices" });
      $("je-gl").innerHTML = '<option value="">All GL accounts</option>' + res[1].filter(function (g) { return !isHeader(g); }).sort(byCode).map(function (g) {
        return '<option value="' + esc(g.id) + '">' + esc(glLabel(g)) + "</option>";
      }).join("");
      if (api.qs("gl")) $("je-gl").value = api.qs("gl");
      if (api.qs("txn")) $("je-txn").value = api.qs("txn");
      await loadJe(0);
      if (api.qs("txn")) await showVoucher(api.qs("txn"), function () { run(function () { return loadJe(jeOffset); }); });
    });
  }

  /* ================================================================== MANUAL JOURNAL */
  if (page === "journal") {
    var jForm = $("journal-form");
    var linesBody = document.querySelector("#je-lines tbody");
    var glOpts = [];
    var rules = [];
    var lineSeq = 0;
    var jeError = function (msg) { var el = $("je-error"); el.textContent = msg || ""; el.hidden = !msg; };
    var optHtml = function (selected) {
      return '<option value="">— Select GL account —</option>' + glOpts.map(function (g) {
        return '<option value="' + esc(g.id) + '"' + (String(g.id) === String(selected || "") ? " selected" : "") + ">" + esc(g.label) + "</option>";
      }).join("");
    };
    var addLine = function (glId, side) {
      lineSeq += 1;
      var n = lineSeq;
      var tr = document.createElement("tr");
      tr.innerHTML = '<td><label class="sr-only" for="je-gl-' + n + '">GL account, line ' + n + "</label>" +
        '<select id="je-gl-' + n + '" class="je-gl">' + optHtml(glId) + "</select></td>" +
        '<td><label class="sr-only" for="je-dr-' + n + '">Debit, line ' + n + '</label><input id="je-dr-' + n + '" class="mono text-right je-dr" inputmode="numeric" autocomplete="off"' + (side === "cr" ? " disabled" : "") + " /></td>" +
        '<td><label class="sr-only" for="je-cr-' + n + '">Credit, line ' + n + '</label><input id="je-cr-' + n + '" class="mono text-right je-cr" inputmode="numeric" autocomplete="off"' + (side === "dr" ? " disabled" : "") + " /></td>" +
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
        var a = api.parseAmount(drRaw || crRaw);
        if (!(a > 0)) { out.error = out.error || label + ": amount must be a whole number of UGX greater than zero (e.g. 150,000)."; return; }
        if (!gl.value) { out.error = out.error || label + ": choose a GL account."; return; }
        var entry = { glAccountId: Number(gl.value), amount: a, label: gl.options[gl.selectedIndex].text };
        if (drRaw) { out.debits.push(entry); out.dr += a; } else { out.credits.push(entry); out.cr += a; }
      });
      return out;
    };
    var updateTotals = function () {
      var r = readLines();
      $("je-total-dr").textContent = api.formatNumber(r.dr);
      $("je-total-cr").textContent = api.formatNumber(r.cr);
      var d = $("je-diff");
      if (!r.dr && !r.cr) { d.textContent = ""; d.className = "je-diff"; return; }
      var diff = r.dr - r.cr;
      d.textContent = diff === 0 ? "Balanced" : "Difference " + api.formatNumber(Math.abs(diff)) + (diff > 0 ? " (more debits)" : " (more credits)");
      d.className = "je-diff " + (diff === 0 ? "ok" : "bad");
    };
    linesBody.addEventListener("input", updateTotals);
    linesBody.addEventListener("change", updateTotals);
    linesBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-remove-line]");
      if (!b) return;
      if (linesBody.querySelectorAll("tr").length <= 2) { api.toast("A journal needs at least two lines", "error"); return; }
      b.closest("tr").remove();
      updateTotals();
    });
    $("je-add-line").addEventListener("click", function () { addLine(); });
    var applyRule = function () {
      var id = $("je-rule").value;
      var r = rules.filter(function (x) { return String(x.id) === id; })[0];
      linesBody.innerHTML = "";
      if (!r) { addLine(); addLine(); updateTotals(); return; }
      var drs = r.debitAccounts || [], crs = r.creditAccounts || [];
      drs.forEach(function (a) { addLine(a.id, "dr"); });
      crs.forEach(function (a) { addLine(a.id, "cr"); });
      if (!drs.length) addLine(null, "dr");
      if (!crs.length) addLine(null, "cr");
      if (r.officeId && $("je-office-sel").querySelector('option[value="' + r.officeId + '"]')) $("je-office-sel").value = String(r.officeId);
      updateTotals();
    };
    $("je-rule").addEventListener("change", applyRule);
    var resetForm = function () {
      $("je-narration").value = "";
      $("je-ref").value = "";
      $("je-receipt").value = "";
      applyRule();
    };
    run(async function () {
      var res = await Promise.all([
        loadOffices(), loadGls(),
        api.paymentTypes().catch(function () { return []; }),
        api.get("/accountingrules").catch(function () { return []; })
      ]);
      var offices = res[0];
      glOpts = res[1].filter(function (g) { return !isHeader(g) && !g.disabled && g.manualEntriesAllowed; }).sort(byCode)
        .map(function (g) { return { id: g.id, label: glLabel(g) }; });
      fillOffices($("je-office-sel"), offices, { selected: defaultOffice(offices) });
      $("je-date").value = api.todayISO();
      $("je-date").max = api.todayISO();
      $("je-paytype").innerHTML = '<option value="">— None —</option>' + (res[2] || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("");
      rules = arr(res[3]);
      $("je-rule").innerHTML = '<option value="">— None —</option>' + rules.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + "</option>"; }).join("");
      if (api.qs("rule")) $("je-rule").value = api.qs("rule");
      if (!glOpts.length) jeError("No GL accounts allow manual entries. Enable “Manual journal entries” on an account under Chart of accounts.");
      resetForm();
    });
    onSubmit(jForm, async function () {
      jeError("");
      var officeSel = $("je-office-sel");
      var date = $("je-date").value;
      var narration = $("je-narration").value.trim();
      var r = readLines();
      if (!officeSel.value) return jeError("Choose an office.");
      if (!api.isISODate(date)) return jeError("Choose a valid value date.");
      if (date > api.todayISO()) return jeError("The value date cannot be in the future.");
      if (!narration) return jeError("Narration is required — say what the entry is for.");
      if (r.error) return jeError(r.error);
      if (!r.debits.length || !r.credits.length) return jeError("Enter at least one debit line and one credit line.");
      if (r.dr !== r.cr) return jeError("Debits (" + api.formatNumber(r.dr) + ") must equal credits (" + api.formatNumber(r.cr) + ").");
      var body = withDate({
        officeId: Number(officeSel.value), transactionDate: date, currencyCode: $("je-currency").value || "UGX", comments: narration,
        debits: r.debits.map(function (d) { return { glAccountId: d.glAccountId, amount: d.amount }; }),
        credits: r.credits.map(function (c) { return { glAccountId: c.glAccountId, amount: c.amount }; })
      });
      if ($("je-ref").value.trim()) body.referenceNumber = $("je-ref").value.trim();
      if ($("je-paytype").value) {
        body.paymentTypeId = Number($("je-paytype").value);
        if ($("je-receipt").value.trim()) body.receiptNumber = $("je-receipt").value.trim();
      }
      if ($("je-rule").value) body.accountingRule = Number($("je-rule").value);
      var lines = [["Office", selectedText(officeSel)], ["Value date", date], ["Narration", narration]];
      if (body.referenceNumber) lines.push(["Reference", body.referenceNumber]);
      r.debits.forEach(function (d) { lines.push(["Dr " + d.label, api.formatMoney(d.amount)]); });
      r.credits.forEach(function (c) { lines.push(["Cr " + c.label, api.formatMoney(c.amount)]); });
      lines.push(["Total", api.formatMoney(r.dr)]);
      var result = null;
      var ok = await api.confirmDialog({
        title: "Post journal entry", summary: "Confirm journal", lines: lines, confirmLabel: "Post journal of " + api.formatMoney(r.dr),
        onConfirm: function () { return api.post("/journalentries", body).then(function (x) { result = x; }); }
      });
      if (!ok) return;
      var txn = result && result.transactionId;
      api.toast("Journal posted" + (txn ? " · " + txn : ""), "success");
      var done = $("je-done");
      if (txn && done) {
        done.innerHTML = "Posted journal <strong class=\"mono\">" + esc(txn) + "</strong>. <a href=\"journals.html?txn=" + encodeURIComponent(txn) + "\">View / print voucher</a>";
        done.hidden = false;
      }
      resetForm();
    });
  }

  /* ================================================================== CLOSING ENTRIES */
  if (page === "closing") {
    var paintClosures = async function () {
      var list = arr(await api.get("/glclosures"));
      list.sort(function (a, b) { return api.formatDate(b.closingDate).localeCompare(api.formatDate(a.closingDate)); });
      var latest = {};
      list.forEach(function (c) { if (!latest[c.officeId]) latest[c.officeId] = c.id; });
      var canDelete = api.can("DELETE_GLCLOSURE");
      document.querySelector("#closures-table tbody").innerHTML = list.map(function (c) {
        var isLatest = latest[c.officeId] === c.id;
        return "<tr><td>" + esc(c.officeName || "") + "</td><td class=\"mono\">" + esc(api.formatDate(c.closingDate)) + (isLatest ? " <span class=\"chip green\">Current</span>" : "") +
          "</td><td>" + esc(c.comments || "") + "</td><td>" + esc(c.createdByUsername || "") + "</td><td>" + esc(api.formatDate(c.createdDate)) + "</td><td>" +
          (canDelete && isLatest ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-closure=\"" + esc(c.id) + "\" data-label=\"" +
            esc((c.officeName || "") + " · " + api.formatDate(c.closingDate)) + "\">Re-open</button>" : "") + "</td></tr>";
      }).join("") || api.emptyRow(6, "No periods closed yet");
    };
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-del-closure]");
      if (!b) return;
      api.confirmDialog({
        title: "Re-open period", message: "Delete the closure “" + b.getAttribute("data-label") + "”? Journal entries on or before that date will be allowed again for this office.",
        confirmLabel: "Delete closure",
        onConfirm: function () { return api.del("/glclosures/" + encodeURIComponent(b.getAttribute("data-del-closure"))); }
      }).then(function (ok) { if (ok) { api.toast("Closure deleted — period re-opened", "success"); run(paintClosures); } }).catch(toastErr);
    });
    onClick(document.querySelector('[data-action="create-closure"]'), async function () {
      var offices = await loadOffices();
      var opts = offices.map(function (o) { return { value: String(o.id), label: o.name }; });
      var v = await api.openDialog({
        title: "Close accounting period", submitLabel: "Review",
        fields: [
          { key: "officeId", label: "Office", type: "select", required: true, value: defaultOffice(offices), options: opts },
          { key: "closingDate", label: "Closing date", type: "date", required: true, value: api.todayISO(), max: api.todayISO(), help: "Usually the last day of the month" },
          { key: "comments", label: "Comments", required: true, placeholder: "e.g. September 2026 month-end close" }
        ],
        validate: function (val) { return val.closingDate > api.todayISO() ? "The closing date cannot be in the future." : ""; },
        confirm: function (val) {
          return { title: "Confirm period close", lines: [["Office", (opts.filter(function (o) { return o.value === val.officeId; })[0] || {}).label], ["Closing date", val.closingDate], ["Comments", val.comments]],
            note: "Journal entries and transactions dated on or before this date will be blocked for this office.", confirmLabel: "Close period" };
        },
        onSubmit: function (val) { return api.post("/glclosures", withDate({ officeId: Number(val.officeId), closingDate: val.closingDate, comments: val.comments.trim() })); }
      });
      if (v) { api.toast("Period closed", "success"); await paintClosures(); }
    });
    run(paintClosures);
  }

  /* ================================================================== FINANCIAL ACTIVITY MAPPINGS */
  function activityName(a) {
    var n = String((a && a.name) || "");
    var known = { assetTransfer: "Asset transfer (suspense)", liabilityTransfer: "Liability transfer (suspense)", cashAtMainVault: "Cash at main vault",
      cashAtTeller: "Cash at teller", fundSource: "Fund source", payableDividends: "Dividends payable", openingBalancesTransferContra: "Opening balances contra" };
    if (known[n]) return known[n];
    var h = n.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return h.charAt(0).toUpperCase() + h.slice(1);
  }
  if (page === "mappings") {
    var mapTemplate = null;
    var mappings = [];
    var paintMappings = async function () {
      var res = await Promise.all([api.get("/financialactivityaccounts"), api.get("/financialactivityaccounts/template").catch(function () { return null; })]);
      mappings = arr(res[0]);
      mapTemplate = res[1];
      var canEdit = api.can("UPDATE_FINANCIALACTIVITYACCOUNT"), canDel = api.can("DELETE_FINANCIALACTIVITYACCOUNT");
      document.querySelector("#mappings-table tbody").innerHTML = mappings.map(function (m) {
        var act = m.financialActivityData || {}, gl = m.glAccountData || {};
        return "<tr><td class=\"strong\">" + esc(activityName(act)) + "</td><td>" + esc(String(act.mappedGLAccountType || "").toLowerCase()) + "</td><td><span class=\"mono\">" + esc(gl.glCode || "") + "</span> " + esc(gl.name || "") +
          "</td><td class=\"nowrap\">" + (canEdit ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-edit-map=\"" + esc(m.id) + "\">Change</button> " : "") +
          (canDel ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-map=\"" + esc(m.id) + "\">Remove</button>" : "") + "</td></tr>";
      }).join("") || api.emptyRow(4, "No mappings yet — map at least “Cash at teller”, “Cash at main vault” and “Opening balances contra”.");
      var missing = ((mapTemplate && mapTemplate.financialActivityOptions) || []).filter(function (a) {
        return !mappings.some(function (m) { return m.financialActivityData && m.financialActivityData.id === a.id; });
      });
      $("mappings-missing").textContent = missing.length ? "Not mapped yet: " + missing.map(activityName).join(", ") + "." : "All financial activities are mapped.";
    };
    var mapDialog = async function (m) {
      if (!mapTemplate) mapTemplate = await api.get("/financialactivityaccounts/template");
      var acts = mapTemplate.financialActivityOptions || [];
      var go = mapTemplate.glAccountOptions || {};
      var allGl = [].concat(go.assetAccountOptions || [], go.liabilityAccountOptions || [], go.equityAccountOptions || []);
      if (!allGl.length) allGl = (await loadGls()).filter(function (g) { return !isHeader(g) && glType(g) <= 3; });
      var typeOf = function (g) { return String((g.type && g.type.value) || "").toUpperCase(); };
      var v = await api.openDialog({
        title: m ? "Change mapping" : "Map financial activity", submitLabel: "Save mapping",
        fields: [
          { key: "act", label: "Financial activity", type: "select", required: true, placeholder: "— Select —", value: m ? String(m.financialActivityData.id) : "",
            options: acts.map(function (a) { return { value: String(a.id), label: activityName(a) + " (" + String(a.mappedGLAccountType || "").toLowerCase() + ")" }; }) },
          { key: "gl", label: "GL account", type: "select", required: true, placeholder: "— Select —", value: m ? String(m.glAccountData.id) : "",
            options: allGl.slice().sort(byCode).map(function (g) { return { value: String(g.id), label: glLabel(g) + " — " + TYPE_SINGULAR[glType(g)] }; }) }
        ],
        validate: function (val) {
          var a = acts.filter(function (x) { return String(x.id) === val.act; })[0];
          var g = allGl.filter(function (x) { return String(x.id) === val.gl; })[0];
          if (a && g && a.mappedGLAccountType && typeOf(g) && typeOf(g) !== String(a.mappedGLAccountType).toUpperCase()) {
            var ty = String(a.mappedGLAccountType).toLowerCase();
            return "“" + activityName(a) + "” must map to " + (/^[aeiou]/.test(ty) ? "an " : "a ") + ty + " account.";
          }
          if (!m && mappings.some(function (x) { return x.financialActivityData && String(x.financialActivityData.id) === val.act; })) return "This activity is already mapped — use Change.";
          return "";
        },
        onSubmit: function (val) {
          var body = { financialActivityId: Number(val.act), glAccountId: Number(val.gl) };
          return m ? api.put("/financialactivityaccounts/" + encodeURIComponent(m.id), body) : api.post("/financialactivityaccounts", body);
        }
      });
      if (v) { api.toast("Mapping saved", "success"); await paintMappings(); }
    };
    onClick(document.querySelector('[data-action="create-mapping"]'), function () { return mapDialog(null); });
    document.querySelector("#mappings-table tbody").addEventListener("click", function (e) {
      var ed = e.target.closest("[data-edit-map]"), dl = e.target.closest("[data-del-map]");
      var id = (ed || dl) && (ed || dl).getAttribute(ed ? "data-edit-map" : "data-del-map");
      var m = mappings.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!m) return;
      if (ed) { mapDialog(m).catch(toastErr); return; }
      api.confirmDialog({
        title: "Remove mapping", message: "Remove the mapping for “" + activityName(m.financialActivityData) + "”? Transactions that need it will fail until it is mapped again.",
        confirmLabel: "Remove mapping", onConfirm: function () { return api.del("/financialactivityaccounts/" + encodeURIComponent(m.id)); }
      }).then(function (ok) { if (ok) { api.toast("Mapping removed", "success"); run(paintMappings); } }).catch(toastErr);
    });
    run(paintMappings);
  }

  /* ================================================================== ACCOUNTING RULES */
  if (page === "rules") {
    var rulesList = [];
    var paintRules = async function () {
      rulesList = arr(await api.get("/accountingrules"));
      var accts = function (list) {
        return (list || []).map(function (a) { return (a.glCode ? a.glCode + " " : "") + (a.name || a.glAccountName || ""); }).join(", ") || "—";
      };
      var canDel = api.can("DELETE_ACCOUNTINGRULE"), canPost = api.can("CREATE_JOURNALENTRY");
      document.querySelector("#rules-table tbody").innerHTML = rulesList.map(function (r) {
        return "<tr><td class=\"strong\">" + esc(r.name || "") + (r.description && r.description !== r.name ? "<div class=\"text-muted small-note\">" + esc(r.description) + "</div>" : "") +
          "</td><td>" + esc(accts(r.debitAccounts)) + "</td><td>" + esc(accts(r.creditAccounts)) + "</td><td>" + esc(r.officeName || "All") + "</td><td class=\"nowrap\">" +
          (canPost ? "<a class=\"btn btn-sm\" href=\"journal-entry.html?rule=" + encodeURIComponent(r.id) + "\">Post</a> " : "") +
          (canDel ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-rule=\"" + esc(r.id) + "\">Delete</button>" : "") + "</td></tr>";
      }).join("") || api.emptyRow(5, "No rules yet. Create one for postings you make often (e.g. bank charges, rent, staff salaries).");
    };
    onClick(document.querySelector('[data-action="create-rule"]'), async function () {
      var res = await Promise.all([loadGls(), loadOffices()]);
      var opts = res[0].filter(function (g) { return !isHeader(g) && !g.disabled; }).sort(byCode)
        .map(function (g) { return { value: String(g.id), label: glLabel(g) }; });
      var v = await api.openDialog({
        title: "Create accounting rule", submitLabel: "Create rule",
        fields: [
          { key: "name", label: "Name", required: true, placeholder: "e.g. Bank charges" },
          { key: "officeId", label: "Office", type: "select", required: true, value: defaultOffice(res[1]), options: res[1].map(function (o) { return { value: String(o.id), label: o.name }; }) },
          { key: "debit", label: "Debit GL account", type: "select", required: true, placeholder: "— Select —", options: opts },
          { key: "credit", label: "Credit GL account", type: "select", required: true, placeholder: "— Select —", options: opts },
          { key: "description", label: "Description", type: "textarea" }
        ],
        validate: function (val) { return val.debit === val.credit ? "Debit and credit accounts must differ." : ""; },
        onSubmit: function (val) {
          return api.post("/accountingrules", { name: val.name.trim(), officeId: Number(val.officeId), description: (val.description || "").trim() || val.name.trim(),
            accountToDebit: Number(val.debit), accountToCredit: Number(val.credit) });
        }
      });
      if (v) { api.toast("Rule created", "success"); await paintRules(); }
    });
    document.querySelector("#rules-table tbody").addEventListener("click", function (e) {
      var b = e.target.closest("[data-del-rule]");
      if (!b) return;
      var r = rulesList.filter(function (x) { return String(x.id) === b.getAttribute("data-del-rule"); })[0];
      api.confirmDialog({
        title: "Delete rule", message: "Delete the rule “" + (r ? r.name : "") + "”? Journals already posted with it are not affected.", confirmLabel: "Delete rule",
        onConfirm: function () { return api.del("/accountingrules/" + encodeURIComponent(b.getAttribute("data-del-rule"))); }
      }).then(function (ok) { if (ok) { api.toast("Rule deleted", "success"); run(paintRules); } }).catch(toastErr);
    });
    run(paintRules);
  }

  /* ================================================================== ACCRUALS / PROVISIONING */
  if (page === "accruals") {
    var till = $("accrual-till");
    till.value = api.todayISO();
    till.max = api.todayISO();
    onSubmit($("accruals-form"), async function () {
      if (!api.isISODate(till.value)) throw new Error("Choose a valid till date.");
      if (till.value > api.todayISO()) throw new Error("The till date cannot be in the future.");
      var ok = await api.confirmDialog({
        title: "Run periodic accruals", summary: "Confirm accrual run",
        lines: [["Accrue up to", till.value], ["Covers", "Loan interest, fees and penalties due on or before this date"]], confirmLabel: "Run accruals",
        onConfirm: function () { return api.post("/runaccruals", withDate({ tillDate: till.value })); }
      });
      if (ok) {
        api.toast("Accruals posted up to " + till.value, "success");
        $("accrual-result").innerHTML = "Accruals run up to <strong>" + esc(till.value) + "</strong>. <a href=\"journals.html\">See journal entries</a> · <a href=\"income-statement.html\">Income statement</a>";
        $("accrual-result").hidden = false;
      }
    });
    run(async function () {
      var data = await api.get("/provisioningentries?offset=0&limit=25").catch(function (err) {
        if (err && (err.status === 404 || err.status === 403)) return [];
        throw err;
      });
      var items = arr(data);
      document.querySelector("#provisioning-table tbody").innerHTML = items.map(function (p) {
        return "<tr><td>" + esc(api.formatDate(p.createdDate)) + "</td><td>" + esc(p.createdUser || p.createdByUsername || "—") +
          "</td><td class=\"mono text-right\">" + (p.reservedAmount !== undefined ? api.formatNumber(p.reservedAmount) : "—") + "</td><td>" + (p.journalEntry ? "Yes" : "No") + "</td></tr>";
      }).join("") || api.emptyRow(4, "No provisioning entries yet");
    });
  }

  /* ================================================================== FINANCIAL STATEMENTS */
  if (page === "trial" || page === "is" || page === "bs") {
    var fsForm = $("report-form");
    var fsOut = $("report-output");
    var hasStart = !!$("rpt-start");
    var cumul = $("rpt-cumulative");
    var TITLES = { trial: "Trial balance", is: "Income statement", bs: "Balance sheet" };
    var fsExport = null;
    if (hasStart) $("rpt-start").value = api.yearStartISO();
    $("rpt-end").value = api.todayISO();
    $("rpt-end").max = api.todayISO();
    if (cumul) {
      var syncCumul = function () { $("rpt-start").disabled = cumul.checked; };
      cumul.addEventListener("change", syncCumul);
      syncCumul();
    }

    /* Map each GL code to its top-level type and its immediate parent header, for a grouped layout. */
    var hierarchy = function (gls) {
      var byId = {}, byCodeMap = {};
      gls.forEach(function (g) { byId[g.id] = g; byCodeMap[String(g.glCode)] = g; });
      return function (code) {
        var g = byCodeMap[String(code)];
        if (!g) return { type: 0, parent: null, gl: null };
        var p = g.parentId ? byId[g.parentId] : null;
        return { type: glType(g), parent: p, gl: g };
      };
    };
    /* Groups rows {code, name, value} by parent header; returns html rows + total. */
    var groupedRows = function (rows, look, valueCols) {
      var groups = {}, order = [];
      rows.forEach(function (r) {
        var h = look(r.code);
        var key = h.parent ? String(h.parent.glCode) : "_";
        if (!groups[key]) { groups[key] = { header: h.parent, rows: [] }; order.push(key); }
        groups[key].rows.push(r);
      });
      order.sort(function (a, b) { return a === "_" ? 1 : b === "_" ? -1 : a.localeCompare(b, undefined, { numeric: true }); });
      var html = "";
      order.forEach(function (k) {
        var g = groups[k];
        g.rows.sort(function (a, b) { return String(a.code).localeCompare(String(b.code), undefined, { numeric: true }); });
        var showHeader = g.header && order.length > 1 || (g.header && g.rows.length > 1);
        if (showHeader) html += "<tr class=\"fs-sub\"><td class=\"mono\">" + esc(g.header.glCode) + "</td><td colspan=\"" + valueCols + "\">" + esc(g.header.name) + "</td></tr>";
        g.rows.forEach(function (r) { html += r.html; });
        if (showHeader && order.length > 1 && g.rows.length > 1) {
          var sub = g.rows.reduce(function (s, r) { return s + r.value; }, 0);
          html += "<tr class=\"fs-subtotal\"><td></td><td>Total " + esc(g.header.name.toLowerCase()) + "</td>" + (valueCols === 3 ? "<td></td>" : "") + "<td class=\"mono text-right\">" + amt(sub) + "</td></tr>";
        }
      });
      return html;
    };

    var renderTrial = function (rows, look) {
      var dr = 0, cr = 0;
      var exp = [];
      var items = rows.map(function (r) {
        /* Fineract returns the net balance on the account's natural side; a negative (contra) balance belongs on the other side. */
        var d = r.debit !== null && r.debit !== undefined ? num(r.debit) : null;
        var c = r.credit !== null && r.credit !== undefined ? num(r.credit) : null;
        var net = d !== null ? d : -(c || 0); /* + = debit */
        var dv = net > 0 ? net : 0, cv = net < 0 ? -net : 0;
        dr += dv; cr += cv;
        return { code: r.glcode, name: r.name, dv: dv, cv: cv, type: look(r.glcode).type };
      }).filter(function (x) { return Math.round(x.dv) !== 0 || Math.round(x.cv) !== 0 || $("rpt-zero").checked; });
      var html = "<table class=\"data fs-table\"><thead><tr><th>GL code</th><th>Account</th><th class=\"text-right\">Debit (UGX)</th><th class=\"text-right\">Credit (UGX)</th></tr></thead><tbody>";
      [1, 2, 3, 4, 5, 0].forEach(function (t) {
        var list = items.filter(function (x) { return x.type === t; });
        if (!list.length) return;
        var sd = 0, sc = 0;
        html += "<tr class=\"group-row\"><td colspan=\"4\"><strong>" + esc(TYPE_NAMES[t] || "Other") + "</strong></td></tr>";
        html += groupedRows(list.map(function (x) {
          sd += x.dv; sc += x.cv;
          exp.push([TYPE_NAMES[t] || "Other", x.code, x.name, Math.round(x.dv), Math.round(x.cv)]);
          return { code: x.code, value: x.dv - x.cv, html: "<tr><td class=\"mono\">" + esc(x.code) + "</td><td>" + esc(x.name) + "</td><td class=\"mono text-right\">" + (x.dv ? amt(x.dv) : "") +
            "</td><td class=\"mono text-right\">" + (x.cv ? amt(x.cv) : "") + "</td></tr>" };
        }), look, 3).replace(/<tr class="fs-subtotal">[\s\S]*?<\/tr>/g, "");
        html += "<tr class=\"fs-subtotal\"><td></td><td>Total " + esc((TYPE_NAMES[t] || "other").toLowerCase()) + "</td><td class=\"mono text-right\">" + amt(sd) + "</td><td class=\"mono text-right\">" + amt(sc) + "</td></tr>";
      });
      if (!items.length) html += api.emptyRow(4, "No postings in this period");
      var diff = round2(dr - cr);
      html += "</tbody><tfoot><tr class=\"strong total-row\"><td></td><td>Totals</td><td class=\"mono text-right\">" + amt(dr) + "</td><td class=\"mono text-right\">" + amt(cr) + "</td></tr></tfoot></table>";
      var badge = Math.abs(diff) < 1 ? "<span class=\"status active\">Balanced — debits equal credits</span>" : "<span class=\"status overdue\">Out of balance by UGX " + amt(Math.abs(diff)) + "</span>";
      fsExport = { header: ["Type", "GL code", "Account", "Debit (UGX)", "Credit (UGX)"], rows: exp.concat([["", "", "Totals", Math.round(dr), Math.round(cr)]]) };
      return "<div class=\"fs-check\">" + badge + "</div>" + html;
    };

    var renderIs = function (rows, look) {
      var exp = [];
      var inc = 0, ex = 0;
      var section = function (label, list, sign) {
        if (!list.length) return "";
        var tot = 0;
        var body = groupedRows(list.map(function (r) {
          var v = num(r.balance) * sign;
          tot += v;
          exp.push([label, r.glcode, r.name, Math.round(v)]);
          return { code: r.glcode, value: v, html: "<tr><td class=\"mono\">" + esc(r.glcode) + "</td><td>" + esc(r.name) + "</td><td class=\"mono text-right\">" + amt(v) + "</td></tr>" };
        }), look, 2);
        if (label === "Income") inc = tot; else ex = tot;
        return "<tr class=\"group-row\"><td colspan=\"3\"><strong>" + label + "</strong></td></tr>" + body +
          "<tr class=\"fs-subtotal strong\"><td></td><td>Total " + label.toLowerCase() + "</td><td class=\"mono text-right\">" + amt(tot) + "</td></tr>";
      };
      var isInc = function (r) { return /income/i.test(String(r.incomeorexpense)) || look(r.glcode).type === 4; };
      rows = rows.filter(function (r) { return Math.round(num(r.balance)) !== 0; });
      var incRows = rows.filter(isInc);
      var exRows = rows.filter(function (r) { return !isInc(r); });
      var html = "<table class=\"data fs-table\"><thead><tr><th>GL code</th><th>Account</th><th class=\"text-right\">Amount (UGX)</th></tr></thead><tbody>" +
        section("Income", incRows, 1) + section("Expenses", exRows, 1);
      if (!rows.length) html += api.emptyRow(3, "No income or expenses in this period");
      var net = inc - ex;
      html += "</tbody><tfoot><tr class=\"strong total-row\"><td></td><td>" + (net >= 0 ? "Net surplus for the period" : "Net deficit for the period") + "</td><td class=\"mono text-right\">" + amt(net) + "</td></tr></tfoot></table>";
      fsExport = { header: ["Section", "GL code", "Account", "Amount (UGX)"], rows: exp.concat([["", "", "Total income", Math.round(inc)], ["", "", "Total expenses", Math.round(ex)], ["", "", "Net surplus / (deficit)", Math.round(net)]]) };
      return html;
    };

    var renderBs = function (rows, look, surplus) {
      var exp = [];
      var totals = { 1: 0, 2: 0, 3: 0 };
      var typeOfRow = function (r) {
        var t = look(r.glcode).type;
        if (t) return t;
        var b = String(r.balancetype || "").toLowerCase();
        return b.indexOf("asset") >= 0 ? 1 : b.indexOf("liab") >= 0 ? 2 : 3;
      };
      var html = "<table class=\"data fs-table\"><thead><tr><th>GL code</th><th>Account</th><th class=\"text-right\">Balance (UGX)</th></tr></thead><tbody>";
      [1, 2, 3].forEach(function (t) {
        var list = rows.filter(function (r) { return typeOfRow(r) === t && Math.round(num(r.balance)) !== 0; });
        var label = TYPE_NAMES[t];
        var body = groupedRows(list.map(function (r) {
          var v = num(r.balance);
          totals[t] += v;
          exp.push([label, r.glcode, r.name, Math.round(v)]);
          return { code: r.glcode, value: v, html: "<tr><td class=\"mono\">" + esc(r.glcode) + "</td><td>" + esc(r.name) + "</td><td class=\"mono text-right\">" + amt(v) + "</td></tr>" };
        }), look, 2);
        if (t === 3 && surplus !== null && Math.round(surplus) !== 0) {
          body += "<tr class=\"fs-derived\"><td></td><td>Current surplus / (deficit) not yet closed to reserves <span class=\"text-muted small-note\">(income less expenses to date)</span></td><td class=\"mono text-right\">" + amt(surplus) + "</td></tr>";
          totals[3] += surplus;
          exp.push([label, "", "Current surplus / (deficit) not yet closed", Math.round(surplus)]);
        }
        html += "<tr class=\"group-row\"><td colspan=\"3\"><strong>" + label + "</strong></td></tr>" + (body || api.emptyRow(3, "None")) +
          "<tr class=\"fs-subtotal strong\"><td></td><td>Total " + label.toLowerCase() + "</td><td class=\"mono text-right\">" + amt(totals[t]) + "</td></tr>";
      });
      var le = totals[2] + totals[3];
      var diff = round2(totals[1] - le);
      html += "</tbody><tfoot><tr class=\"strong total-row\"><td></td><td>Total liabilities and equity</td><td class=\"mono text-right\">" + amt(le) + "</td></tr></tfoot></table>";
      var badge = surplus === null ? "<span class=\"status pending\">Surplus to date could not be computed</span>" :
        Math.abs(diff) < 1 ? "<span class=\"status active\">Balanced — assets equal liabilities + equity</span>" : "<span class=\"status overdue\">Difference UGX " + amt(diff) + "</span>";
      fsExport = { header: ["Section", "GL code", "Account", "Balance (UGX)"], rows: exp.concat([["", "", "Total assets", Math.round(totals[1])], ["", "", "Total liabilities and equity", Math.round(le)]]) };
      return "<div class=\"fs-check\">" + badge + "</div>" + html;
    };

    var runFs = async function () {
      var sel = $("rpt-office");
      var office = sel.value;
      var end = $("rpt-end").value;
      var cumulative = cumul && cumul.checked;
      var start = hasStart ? (cumulative ? INCEPTION : $("rpt-start").value) : "";
      if (!office) throw new Error("Choose an office.");
      if (!api.isISODate(end) || (hasStart && !api.isISODate(start))) throw new Error("Enter valid dates.");
      if (hasStart && start > end) throw new Error("From date must be on or before To date.");
      fsOut.innerHTML = "<p class=\"text-muted\">Running report…</p>";
      fsExport = null;
      var name = fsForm.getAttribute("data-report");
      var params = { officeId: office, endDate: end };
      if (hasStart) params.startDate = start;
      var range = hasStart ? (cumulative ? "Balances as at " + end : start + " to " + end) : "As at " + end;
      var sub = selectedText(sel) + (String(office) === "1" ? " (all offices)" : "") + " · " + range;
      $("report-sub").textContent = sub;
      printHead(TITLES[page], sub);
      try {
        var calls = [runReport(name, params), loadGls().catch(function () { return []; })];
        if (page === "bs") calls.push(runReport("Income Statement Table", { officeId: office, startDate: INCEPTION, endDate: end }).then(rowObjects).catch(function () { return null; }));
        var res = await Promise.all(calls);
        var rows = rowObjects(res[0]);
        var look = hierarchy(res[1] || []);
        if (page === "trial") fsOut.innerHTML = renderTrial(rows, look);
        else if (page === "is") fsOut.innerHTML = renderIs(rows, look);
        else {
          var surplus = null;
          if (res[2]) {
            surplus = 0;
            res[2].forEach(function (r) {
              var isI = /income/i.test(String(r.incomeorexpense)) || look(r.glcode).type === 4;
              surplus += isI ? num(r.balance) : -num(r.balance);
            });
          }
          fsOut.innerHTML = renderBs(rows, look, surplus);
        }
      } catch (err) {
        fsOut.innerHTML = "<div class=\"empty-state error\"><strong>Could not run the report</strong><p>" + esc(friendlyError(err)) + "</p></div>";
        throw err;
      }
    };
    onSubmit(fsForm, runFs);
    if ($("rpt-zero")) $("rpt-zero").addEventListener("change", function () { run(runFs); });
    onClick($("rpt-csv"), function () {
      if (!fsExport) throw new Error("Run the report first.");
      downloadCsv(TITLES[page].toLowerCase().replace(/\s+/g, "-") + "-" + $("rpt-end").value + ".csv", fsExport.header,
        [[TITLES[page] + " — " + $("report-sub").textContent]].concat(fsExport.rows));
    });
    onClick($("rpt-print"), function () { window.print(); });
    run(async function () {
      var offices = await loadOffices();
      fillOffices($("rpt-office"), offices, { selected: offices.some(function (o) { return String(o.id) === "1"; }) ? "1" : defaultOffice(offices) });
      await runFs();
    });
  }

  /* ================================================================== REPORT CATALOGUE */
  if (page === "reports") {
    var PRIORITY = [
      ["Portfolio at Risk", "Overdue share of the active loan portfolio (PAR %)."],
      ["Active Loans - Summary", "Active loans totals by office, officer and product."],
      ["Active Loans - Details", "Every active loan with balances and arrears."],
      ["Aging Summary (Arrears in Months)", "Loans in arrears bucketed by months overdue."],
      ["Loans Pending Approval", "Applications waiting for approval."],
      ["Loans Awaiting Disbursal", "Approved loans not yet disbursed."],
      ["Funds Disbursed Between Dates Summary", "Amounts disbursed in a date range."],
      ["Expected Payments By Date - Basic", "Instalments falling due in a date range."],
      ["Client Listing", "All members of an office."],
      ["Savings Accounts Dormancy Report", "Inactive, dormant and escheat savings accounts."],
      ["Trial Balance Summary Report", "Opening, movements and closing by GL and product."]
    ];
    var HIDE_CAT = { "(NULL)": 1, "None": 1, "Quipo": 1, "": 1 };
    var HIDE_NAME = { "FullReportList": 1, "ReportCategoryList": 1, "TxnRunningBalances": 1 };
    /* Fineract stretchy parameter name → request variable and input kind. */
    var PARAMS = {
      OfficeIdSelectOne: { v: "officeId", label: "Office", kind: "office" },
      loanOfficerIdSelectAll: { v: "loanOfficerId", label: "Loan officer", kind: "officer" },
      currencyIdSelectAll: { v: "currencyId", label: "Currency", kind: "currency" },
      fundIdSelectAll: { v: "fundId", label: "Fund", kind: "fund" },
      loanProductIdSelectAll: { v: "loanProductId", label: "Loan product", kind: "product" },
      loanPurposeIdSelectAll: { v: "loanPurposeId", label: "Loan purpose", kind: "purpose" },
      parTypeSelect: { v: "parType", label: "PAR basis", kind: "fixed", opts: [["1", "Principal only"], ["2", "Principal + interest"], ["3", "Principal + interest + fees"], ["4", "Principal + interest + fees + penalties"]] },
      startDateSelect: { v: "startDate", label: "From date", kind: "date", def: "start" },
      endDateSelect: { v: "endDate", label: "To date", kind: "date", def: "end" },
      obligDateTypeSelect: { v: "obligDateType", label: "Obligation date", kind: "fixed", opts: [["1", "Closed date"], ["2", "Disbursal date"]] },
      SavingsAccountSubStatus: { v: "subStatus", label: "Savings sub-status", kind: "fixed", opts: [["200", "Dormant"], ["100", "Inactive"], ["300", "Escheat"]] },
      SelectGLAccountNO: { v: "GLAccountNO", label: "GL account", kind: "gl" }
    };
    var reports = [];
    var current = null;
    var lastResult = null;
    var listEl = $("rpt-list");
    var formEl = $("rpt-params");
    var outEl = $("rpt-output");

    var lookups = {};
    var lookup = function (kind, officeId) {
      var key = kind + ":" + (officeId || "");
      if (lookups[key]) return lookups[key];
      var p;
      if (kind === "office") p = loadOffices().then(function (os) { return os.map(function (o) { return [String(o.id), officeLabel(o)]; }); });
      else if (kind === "officer") {
        p = api.get("/staff?status=active&loanOfficersOnly=true" + (officeId ? "&officeId=" + encodeURIComponent(officeId) + "&staffInOfficeHierarchy=true" : ""))
          .then(arr).then(function (s) { return s.map(function (x) { return [String(x.id), x.displayName || ((x.firstname || "") + " " + (x.lastname || ""))]; }); });
      } else if (kind === "currency") {
        p = api.get("/currencies").then(function (c) { return ((c && c.selectedCurrencyOptions) || []).map(function (x) { return [x.code, x.code + " · " + x.name]; }); });
      } else if (kind === "fund") p = api.get("/funds").then(arr).then(function (f) { return f.map(function (x) { return [String(x.id), x.name]; }); });
      else if (kind === "product") p = api.get("/loanproducts").then(arr).then(function (f) { return f.map(function (x) { return [String(x.id), x.name]; }); });
      else if (kind === "purpose") {
        p = api.get("/codes").then(arr).then(function (codes) {
          var c = codes.filter(function (x) { return /^loan ?purpose$/i.test(x.name); })[0];
          return c ? api.get("/codes/" + c.id + "/codevalues").then(arr) : [];
        }).then(function (vals) { return vals.map(function (x) { return [String(x.id), x.name]; }); });
      } else if (kind === "gl") p = loadGls().then(function (g) { return g.filter(function (x) { return !isHeader(x); }).sort(byCode).map(function (x) { return [String(x.id), glLabel(x)]; }); });
      else p = Promise.resolve([]);
      lookups[key] = p.catch(function () { delete lookups[key]; return []; });
      return lookups[key];
    };
    var paramDef = function (name) {
      if (PARAMS[name]) return PARAMS[name];
      var v = String(name).replace(/(SelectOne|SelectAll|Select)$/, "");
      return { v: v.charAt(0).toLowerCase() + v.slice(1), label: v.replace(/([a-z])([A-Z])/g, "$1 $2"), kind: "generic", name: name };
    };

    var renderList = function () {
      var q = ($("rpt-search").value || "").toLowerCase().trim();
      var match = function (r) { return !q || (r.reportName + " " + (r.reportCategory || "")).toLowerCase().indexOf(q) >= 0; };
      var byName = {};
      reports.forEach(function (r) { byName[r.reportName] = r; });
      var html = "";
      var pri = PRIORITY.filter(function (p) { return byName[p[0]] && match(byName[p[0]]); });
      if (pri.length) {
        html += "<h3 class=\"rpt-cat\">Recommended</h3><ul class=\"rpt-items\">" + pri.map(function (p) {
          var r = byName[p[0]];
          return "<li><button type=\"button\" class=\"rpt-item" + (current && current.id === r.id ? " active" : "") + "\" data-report-id=\"" + esc(r.id) + "\"><strong>" + esc(r.reportName) +
            "</strong><span>" + esc(p[1]) + "</span></button></li>";
        }).join("") + "</ul>";
      }
      var cats = {};
      reports.forEach(function (r) { if (match(r)) (cats[r.reportCategory || "Other"] = cats[r.reportCategory || "Other"] || []).push(r); });
      Object.keys(cats).sort().forEach(function (c) {
        html += "<h3 class=\"rpt-cat\">" + esc(c) + "</h3><ul class=\"rpt-items\">" + cats[c].sort(function (a, b) { return a.reportName.localeCompare(b.reportName); }).map(function (r) {
          return "<li><button type=\"button\" class=\"rpt-item compact" + (current && current.id === r.id ? " active" : "") + "\" data-report-id=\"" + esc(r.id) + "\">" + esc(r.reportName) + "</button></li>";
        }).join("") + "</ul>";
      });
      listEl.innerHTML = html || "<p class=\"text-muted\">No reports match.</p>";
    };

    var fillSelect = async function (sel, def, officeId) {
      var opts = def.kind === "fixed" ? def.opts : await lookup(def.kind, officeId);
      if (def.kind === "generic") {
        try {
          var d = resultSet(await api.get("/runreports/" + encodeURIComponent(def.name) + "?parameterType=true"));
          opts = d.rows.map(function (r) { return [String(r[0]), String(r.length > 1 ? r[1] : r[0])]; });
        } catch (e) { opts = []; }
      }
      var all = def.kind !== "office" && def.kind !== "fixed" && def.kind !== "gl" && def.kind !== "generic";
      var prev = sel.value;
      sel.innerHTML = (all ? '<option value="-1">All</option>' : "") + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("");
      if (prev && sel.querySelector('option[value="' + CSS.escape(prev) + '"]')) sel.value = prev;
      else if (def.kind === "office") {
        var want = sel.querySelector('option[value="1"]') ? "1" : String(sess.officeId || "");
        if (sel.querySelector('option[value="' + CSS.escape(want) + '"]')) sel.value = want;
      }
      return opts.length;
    };

    var selectReport = async function (r) {
      current = r;
      lastResult = null;
      renderList();
      try { history.replaceState(null, "", "reports.html?report=" + encodeURIComponent(r.reportName)); } catch (e) { /* ignore */ }
      $("rpt-title").textContent = r.reportName;
      var pri = PRIORITY.filter(function (p) { return p[0] === r.reportName; })[0];
      $("rpt-desc").textContent = pri ? pri[1] : (r.reportCategory ? r.reportCategory + " report" : "");
      $("rpt-actions").hidden = true;
      outEl.innerHTML = "<div class=\"empty-state\">Set the parameters and press Run.</div>";
      var names = (r.reportParameters || []).map(function (p) { return p.parameterName; });
      var defs = names.map(paramDef);
      /* Office first, so officers can follow it. */
      defs.sort(function (a, b) { return (a.kind === "office" ? 0 : 1) - (b.kind === "office" ? 0 : 1); });
      var html = "";
      defs.forEach(function (d) {
        var id = "rp-" + d.v;
        html += "<div class=\"form-row\"><label for=\"" + id + "\">" + esc(d.label) + "</label>";
        if (d.kind === "date") {
          html += "<input id=\"" + id + "\" type=\"date\" data-var=\"" + esc(d.v) + "\" required value=\"" + (d.def === "start" ? api.todayISO().slice(0, 8) + "01" : api.todayISO()) + "\" />";
        } else if (d.kind === "generic" && !/Select/.test(d.name)) {
          html += "<input id=\"" + id + "\" data-var=\"" + esc(d.v) + "\" />";
        } else {
          html += "<select id=\"" + id + "\" data-var=\"" + esc(d.v) + "\" data-kind=\"" + esc(d.kind) + "\"><option value=\"\">Loading…</option></select>";
        }
        html += "</div>";
      });
      formEl.innerHTML = "<div class=\"form-grid\">" + (html || "<p class=\"text-muted\">This report has no parameters.</p>") + "</div>" +
        "<div class=\"form-actions\"><button type=\"submit\" class=\"btn btn-amber\">Run report</button></div>";
      await Promise.all(defs.filter(function (d) { return d.kind !== "date" && !(d.kind === "generic" && !/Select/.test(d.name)); }).map(function (d) {
        return fillSelect($("rp-" + d.v), d, d.kind === "officer" ? (sess.officeId || "") : "");
      }));
      var off = formEl.querySelector('[data-kind="office"]');
      var offc = formEl.querySelector('[data-kind="officer"]');
      if (off && offc) {
        await fillSelect(offc, PARAMS.loanOfficerIdSelectAll, off.value);
        off.addEventListener("change", function () { fillSelect(offc, PARAMS.loanOfficerIdSelectAll, off.value).catch(toastErr); });
      }
    };

    var fmtCell = function (v, col) {
      if (v === null || v === undefined) return "";
      if (Array.isArray(v)) return api.formatDate(v);
      if (col.num) {
        var n = Number(v);
        if (isNaN(n)) return String(v);
        return n.toLocaleString("en-UG", { maximumFractionDigits: col.dec ? 2 : 0 });
      }
      return String(v);
    };
    var isNumericCol = function (c, rows, i) {
      if (/DECIMAL|DOUBLE|NUMERIC|FLOAT|MONEY/.test(c.type)) return { num: true, dec: true, sum: true };
      if (/INTEGER|BIGINT|LONG|INT/.test(c.type)) return { num: !/(^|\s)(id|no\.?|number)$/i.test(c.name) && !/account|phone|mobile/i.test(c.name), dec: false, sum: false };
      /* Percentages and amounts that come back as text (e.g. PAR %) */
      if (/%|amount|outstanding|overdue|principal|interest|balance|fees|penalt/i.test(c.name) &&
        rows.length && rows.every(function (r) { return r[i] === null || r[i] === "" || !isNaN(Number(r[i])); })) return { num: true, dec: true, sum: !/%/.test(c.name) };
      return { num: false };
    };
    var renderResult = function (data, r, paramsText) {
      var rs = resultSet(data);
      var cols = rs.cols.map(function (c, i) { return Object.assign({}, c, isNumericCol(c, rs.rows, i)); });
      lastResult = { cols: cols, rows: rs.rows, report: r, params: paramsText };
      var head = "<tr>" + cols.map(function (c) { return "<th" + (c.num ? " class=\"text-right\"" : "") + " scope=\"col\">" + esc(c.name) + "</th>"; }).join("") + "</tr>";
      var body = rs.rows.map(function (row) {
        return "<tr>" + cols.map(function (c, i) { return "<td" + (c.num ? " class=\"mono text-right\"" : "") + ">" + esc(fmtCell(row[i], c)) + "</td>"; }).join("") + "</tr>";
      }).join("");
      var foot = "";
      if (rs.rows.length > 1 && cols.some(function (c) { return c.sum; })) {
        foot = "<tfoot><tr class=\"strong total-row\">" + cols.map(function (c, i) {
          if (i === 0) return "<td>Total (" + rs.rows.length + ")</td>";
          if (!c.sum) return "<td></td>";
          var s = rs.rows.reduce(function (t, row) { return t + num(row[i]); }, 0);
          return "<td class=\"mono text-right\">" + esc(fmtCell(s, c)) + "</td>";
        }).join("") + "</tr></tfoot>";
      }
      outEl.innerHTML = "<p class=\"rpt-meta\">" + esc(api.formatNumber(rs.rows.length)) + " row" + (rs.rows.length === 1 ? "" : "s") + " · " + esc(paramsText) + "</p>" +
        (rs.rows.length ? "<div class=\"table-wrap\"><table class=\"data rpt-table\"><thead>" + head + "</thead><tbody>" + body + "</tbody>" + foot + "</table></div>"
          : "<div class=\"empty-state\">The report ran but returned no rows for these parameters.</div>");
      $("rpt-actions").hidden = !rs.rows.length;
    };

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!current) return;
      var btn = formEl.querySelector("button[type=submit]");
      if (btn && btn.disabled) return;
      var params = {}, text = [], bad = "";
      formEl.querySelectorAll("[data-var]").forEach(function (el) {
        var v = el.value;
        if (el.type === "date" && !api.isISODate(v)) bad = bad || "Enter a valid " + (el.labels && el.labels[0] ? el.labels[0].textContent : "date") + ".";
        if (el.tagName === "SELECT" && v === "") bad = bad || "Choose a value for " + (el.labels && el.labels[0] ? el.labels[0].textContent : el.getAttribute("data-var")) + ".";
        params[el.getAttribute("data-var")] = v;
        var lab = el.labels && el.labels[0] ? el.labels[0].textContent : el.getAttribute("data-var");
        text.push(lab + ": " + (el.tagName === "SELECT" ? selectedText(el) : v));
      });
      if (!bad && params.startDate && params.endDate && params.startDate > params.endDate) bad = "From date must be on or before To date.";
      if (bad) { api.toast(bad, "error"); return; }
      if (btn) btn.disabled = true;
      outEl.innerHTML = "<p class=\"text-muted\">Running " + esc(current.reportName) + "…</p>";
      $("rpt-actions").hidden = true;
      var r = current;
      var paramsText = text.join(" · ");
      printHead(r.reportName, paramsText);
      runReport(r.reportName, params).then(function (data) {
        if (current === r) renderResult(data, r, paramsText);
      }).catch(function (err) {
        if (err && err.status === 401) return;
        outEl.innerHTML = "<div class=\"empty-state error\"><strong>Could not run " + esc(r.reportName) + "</strong><p>" + esc(friendlyError(err)) + "</p></div>";
      }).then(function () { if (btn) btn.disabled = false; });
    });
    listEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-report-id]");
      if (!b) return;
      var r = reports.filter(function (x) { return String(x.id) === b.getAttribute("data-report-id"); })[0];
      if (r) selectReport(r).then(function () { var f = formEl.querySelector("select, input"); if (f) f.focus(); }).catch(toastErr);
    });
    $("rpt-search").addEventListener("input", renderList);
    onClick($("rpt-csv"), function () {
      if (!lastResult) throw new Error("Run the report first.");
      downloadCsv(lastResult.report.reportName + " " + fileStamp() + ".csv", lastResult.cols.map(function (c) { return c.name; }),
        lastResult.rows.map(function (row) { return row.map(function (v) { return Array.isArray(v) ? api.formatDate(v) : v; }); }));
    });
    onClick($("rpt-print"), function () { window.print(); });
    run(async function () {
      var all = arr(await api.get("/reports"));
      reports = all.filter(function (r) {
        return String(r.reportType || "Table") === "Table" && r.useReport !== false && !HIDE_CAT[String(r.reportCategory || "")] && !HIDE_NAME[r.reportName];
      });
      renderList();
      var want = api.qs("report");
      var r = reports.filter(function (x) { return x.reportName === want; })[0] || reports.filter(function (x) { return x.reportName === "Portfolio at Risk"; })[0];
      if (r) await selectReport(r);
    });
  }

  /* ================================================================== MEMBER STATEMENT */
  if (page === "statement") {
    var stInput = $("st-client");
    var chosen = null;
    $("st-from").value = api.yearStartISO();
    $("st-to").value = api.todayISO();
    $("st-to").max = api.todayISO();
    api.typeahead(stInput, {
      fetch: api.searchClients,
      onInput: function () { chosen = null; },
      onSelect: function (item) { chosen = { id: item.value, name: item.label }; stInput.value = item.label; }
    });
    var stExport = [];
    var d10 = function (d) { return api.formatDate(d); };
    var savCredit = function (t) {
      if (t.entryType) return String(t.entryType).toUpperCase() === "CREDIT";
      var ty = t.transactionType || {};
      return !!(ty.deposit || ty.interestPosting || ty.dividendPayout || ty.approveTransfer || /deposit|interest posting|dividend|transfer.*(in|approve)/i.test(ty.value || ""));
    };
    var savSection = function (acct, txns, from, to) {
      var list = txns.filter(function (t) { return !(t.transactionType && /accrual/i.test(t.transactionType.value || "")); })
        .sort(function (a, b) { var x = d10(a.date), y = d10(b.date); return x === y ? a.id - b.id : (x < y ? -1 : 1); });
      var opening = 0, closing = null, cr = 0, dr = 0;
      list.forEach(function (t) { if (!t.reversed && d10(t.date) < from && t.runningBalance !== undefined && t.runningBalance !== null) opening = num(t.runningBalance); });
      closing = opening;
      var rows = list.filter(function (t) { return d10(t.date) >= from && d10(t.date) <= to; }).map(function (t) {
        var isCr = savCredit(t);
        var label = ((t.transactionType && t.transactionType.value) || "") + (t.reversed ? " (reversed)" : "");
        if (!t.reversed) {
          if (isCr) cr += num(t.amount); else dr += num(t.amount);
          if (t.runningBalance !== undefined && t.runningBalance !== null) closing = num(t.runningBalance);
          else closing += isCr ? num(t.amount) : -num(t.amount);
        }
        var ref = (t.paymentDetailData && (t.paymentDetailData.receiptNumber || (t.paymentDetailData.paymentType && t.paymentDetailData.paymentType.name))) || "";
        stExport.push(["Savings " + (acct.accountNo || acct.id), d10(t.date), label, ref, isCr ? "" : t.amount, isCr ? t.amount : "", t.reversed ? "" : closing]);
        return "<tr" + (t.reversed ? " class=\"je-reversed\"" : "") + "><td>" + esc(d10(t.date)) + "</td><td>" + esc(label) + "</td><td>" + esc(ref) + "</td><td class=\"mono text-right\">" +
          (isCr ? "" : api.formatNumber(t.amount)) + "</td><td class=\"mono text-right\">" + (isCr ? api.formatNumber(t.amount) : "") + "</td><td class=\"mono text-right\">" + (t.reversed ? "" : amt(closing)) + "</td></tr>";
      });
      return {
        summary: ["Savings", (acct.accountNo || acct.id) + " · " + (acct.productName || ""), opening, cr, dr, closing],
        html: "<h3 class=\"section-title\">Savings " + esc(acct.accountNo || acct.id) + " · " + esc(acct.productName || "") + " <span class=\"text-muted small-note\">" + esc(api.statusLabel(acct.status)) + "</span></h3>" +
          "<div class=\"table-wrap mb-16\"><table class=\"data st-table\"><thead><tr><th>Date</th><th>Description</th><th>Ref / channel</th><th class=\"text-right\">Withdrawals</th><th class=\"text-right\">Deposits</th><th class=\"text-right\">Balance</th></tr></thead><tbody>" +
          "<tr class=\"st-open\"><td>" + esc(from) + "</td><td colspan=\"4\">Opening balance</td><td class=\"mono text-right\">" + amt(opening) + "</td></tr>" +
          (rows.join("") || "<tr class=\"empty-row\"><td colspan=\"6\">No transactions in this period</td></tr>") +
          "</tbody><tfoot><tr class=\"strong total-row\"><td>" + esc(to) + "</td><td colspan=\"2\">Closing balance</td><td class=\"mono text-right\">" + api.formatNumber(dr) + "</td><td class=\"mono text-right\">" + api.formatNumber(cr) +
          "</td><td class=\"mono text-right\">" + amt(closing) + "</td></tr></tfoot></table></div>"
      };
    };
    var loanSection = function (acct, full, from, to) {
      var txns = (full.transactions || []).filter(function (t) { return !(t.type && (t.type.accrual || /accrual/i.test(t.type.value || ""))); })
        .sort(function (a, b) { var x = d10(a.date), y = d10(b.date); return x === y ? a.id - b.id : (x < y ? -1 : 1); });
      var opening = 0;
      txns.forEach(function (t) { if (!t.manuallyReversed && d10(t.date) < from && t.outstandingLoanBalance !== undefined) opening = num(t.outstandingLoanBalance); });
      var closing = opening, paid = 0, disb = 0;
      var rows = txns.filter(function (t) { return d10(t.date) >= from && d10(t.date) <= to; }).map(function (t) {
        var label = ((t.type && t.type.value) || "") + (t.manuallyReversed ? " (reversed)" : "");
        var isDisb = t.type && t.type.disbursement;
        if (!t.manuallyReversed) {
          if (isDisb) disb += num(t.amount); else if (t.type && (t.type.repayment || t.type.repaymentAtDisbursement || /repayment|recovery|payoff/i.test(t.type.value || ""))) paid += num(t.amount);
          if (t.outstandingLoanBalance !== undefined && t.outstandingLoanBalance !== null) closing = num(t.outstandingLoanBalance);
        }
        stExport.push(["Loan " + (acct.accountNo || acct.id), d10(t.date), label, "", t.amount, t.principalPortion || "", t.interestPortion || "",
          num(t.feeChargesPortion) + num(t.penaltyChargesPortion), t.manuallyReversed ? "" : closing]);
        return "<tr" + (t.manuallyReversed ? " class=\"je-reversed\"" : "") + "><td>" + esc(d10(t.date)) + "</td><td>" + esc(label) + "</td><td class=\"mono text-right\">" + api.formatNumber(t.amount) +
          "</td><td class=\"mono text-right\">" + (t.principalPortion ? api.formatNumber(t.principalPortion) : "") + "</td><td class=\"mono text-right\">" + (t.interestPortion ? api.formatNumber(t.interestPortion) : "") +
          "</td><td class=\"mono text-right\">" + (num(t.feeChargesPortion) + num(t.penaltyChargesPortion) ? api.formatNumber(num(t.feeChargesPortion) + num(t.penaltyChargesPortion)) : "") +
          "</td><td class=\"mono text-right\">" + (t.manuallyReversed ? "" : amt(closing)) + "</td></tr>";
      });
      var s = full.summary || {};
      var arrears = num(s.totalOverdue);
      return {
        summary: ["Loan", (acct.accountNo || acct.id) + " · " + (acct.productName || ""), opening, disb, paid, closing],
        html: "<h3 class=\"section-title\">Loan " + esc(acct.accountNo || acct.id) + " · " + esc(acct.productName || "") + " <span class=\"text-muted small-note\">" + esc(api.statusLabel(full.status || acct.status)) +
          (full.timeline && full.timeline.actualDisbursementDate ? " · disbursed " + esc(d10(full.timeline.actualDisbursementDate)) : "") + " · principal " + esc(api.formatNumber(full.principal)) +
          (arrears ? " · <strong class=\"text-danger\">in arrears " + esc(api.formatNumber(arrears)) + "</strong>" : "") + "</span></h3>" +
          "<div class=\"table-wrap mb-16\"><table class=\"data st-table\"><thead><tr><th>Date</th><th>Transaction</th><th class=\"text-right\">Amount</th><th class=\"text-right\">Principal</th><th class=\"text-right\">Interest</th><th class=\"text-right\">Fees &amp; penalties</th><th class=\"text-right\">Principal outstanding</th></tr></thead><tbody>" +
          "<tr class=\"st-open\"><td>" + esc(from) + "</td><td colspan=\"5\">Opening principal outstanding</td><td class=\"mono text-right\">" + amt(opening) + "</td></tr>" +
          (rows.join("") || "<tr class=\"empty-row\"><td colspan=\"7\">No transactions in this period</td></tr>") +
          "</tbody><tfoot><tr class=\"strong total-row\"><td>" + esc(to) + "</td><td colspan=\"5\">Closing principal outstanding</td><td class=\"mono text-right\">" + amt(closing) + "</td></tr></tfoot></table></div>"
      };
    };
    var shareSection = function (acct, full, from, to) {
      var list = (full.purchasedShares || []).filter(function (p) {
        var st = String((p.status && (p.status.code || p.status.value)) || "").toLowerCase();
        return st.indexOf("approved") >= 0 || st === "";
      }).sort(function (a, b) { var x = d10(a.purchasedDate), y = d10(b.purchasedDate); return x === y ? a.id - b.id : (x < y ? -1 : 1); });
      var isRedeem = function (p) { return /redeem/i.test(String((p.type && (p.type.code || p.type.value)) || "")); };
      var openN = 0, openV = 0;
      list.forEach(function (p) { if (d10(p.purchasedDate) < from) { var s = isRedeem(p) ? -1 : 1; openN += s * num(p.numberOfShares); openV += s * num(p.amount); } });
      var n = openN, v = openV;
      var rows = list.filter(function (p) { var d = d10(p.purchasedDate); return d >= from && d <= to; }).map(function (p) {
        var s = isRedeem(p) ? -1 : 1;
        n += s * num(p.numberOfShares); v += s * num(p.amount);
        stExport.push(["Shares " + (acct.accountNo || acct.id), d10(p.purchasedDate), isRedeem(p) ? "Redeemed" : "Purchased", p.numberOfShares, p.purchasedPrice, p.amount, n, v]);
        return "<tr><td>" + esc(d10(p.purchasedDate)) + "</td><td>" + (isRedeem(p) ? "Shares redeemed" : "Shares purchased") + "</td><td class=\"mono text-right\">" + api.formatNumber(p.numberOfShares) +
          "</td><td class=\"mono text-right\">" + api.formatNumber(p.purchasedPrice) + "</td><td class=\"mono text-right\">" + api.formatNumber(p.amount) + "</td><td class=\"mono text-right\">" + api.formatNumber(n) +
          "</td><td class=\"mono text-right\">" + amt(v) + "</td></tr>";
      });
      return {
        summary: ["Shares", (acct.accountNo || acct.id) + " · " + (acct.productName || ""), openV, v - openV > 0 ? v - openV : 0, v - openV < 0 ? openV - v : 0, v],
        html: "<h3 class=\"section-title\">Shares " + esc(acct.accountNo || acct.id) + " · " + esc(acct.productName || "") + "</h3>" +
          "<div class=\"table-wrap mb-16\"><table class=\"data st-table\"><thead><tr><th>Date</th><th>Description</th><th class=\"text-right\">Shares</th><th class=\"text-right\">Price</th><th class=\"text-right\">Amount</th><th class=\"text-right\">Shares held</th><th class=\"text-right\">Value</th></tr></thead><tbody>" +
          "<tr class=\"st-open\"><td>" + esc(from) + "</td><td colspan=\"4\">Opening holding</td><td class=\"mono text-right\">" + api.formatNumber(openN) + "</td><td class=\"mono text-right\">" + amt(openV) + "</td></tr>" +
          (rows.join("") || "<tr class=\"empty-row\"><td colspan=\"7\">No share transactions in this period</td></tr>") +
          "</tbody><tfoot><tr class=\"strong total-row\"><td>" + esc(to) + "</td><td colspan=\"4\">Closing holding</td><td class=\"mono text-right\">" + api.formatNumber(n) + "</td><td class=\"mono text-right\">" + amt(v) + "</td></tr></tfoot></table></div>"
      };
    };

    var runStatement = async function () {
      if (!chosen) throw new Error("Choose a member from the search results.");
      var from = $("st-from").value, to = $("st-to").value;
      if (!api.isISODate(from) || !api.isISODate(to)) throw new Error("Enter valid dates.");
      if (from > to) throw new Error("From date must be on or before To date.");
      var body = $("st-body");
      body.innerHTML = "<p class=\"text-muted\">Loading statement…</p>";
      stExport = [];
      var enc = encodeURIComponent(chosen.id);
      var base = await Promise.all([api.get("/clients/" + enc), api.get("/clients/" + enc + "/accounts")]);
      var client = base[0], accounts = base[1] || {};
      var savs = (accounts.savingsAccounts || []).filter(function (s) { return !(s.status && (s.status.submittedAndPendingApproval || s.status.rejected || s.status.withdrawnByApplicant)); });
      var loans = (accounts.loanAccounts || []).filter(function (l) { return !(l.status && (l.status.pendingApproval || l.status.waitingForDisbursal || l.status.rejected || l.status.withdrawnByClient)); });
      var shares = (accounts.shareAccounts || []).filter(function (s) { return !(s.status && (s.status.submittedAndPendingApproval || s.status.rejected)); });
      var res = await Promise.all([
        Promise.all(savs.map(function (s) {
          return api.get("/savingsaccounts/" + encodeURIComponent(s.id) + "?associations=transactions").then(function (full) { return savSection(s, full.transactions || [], from, to); });
        })),
        Promise.all(loans.map(function (l) {
          return api.get("/loans/" + encodeURIComponent(l.id) + "?associations=transactions").then(function (full) { return loanSection(l, full, from, to); });
        })),
        Promise.all(shares.map(function (s) {
          return api.get("/accounts/share/" + encodeURIComponent(s.id)).then(function (full) { return shareSection(s, full, from, to); }).catch(function () { return null; });
        }))
      ]);
      var sections = res[0].concat(res[2].filter(Boolean)).concat(res[1]);
      var name = client.displayName || ((client.firstname || "") + " " + (client.lastname || "")).trim();
      $("st-name").textContent = name;
      $("st-acno").textContent = "Member no. " + (client.accountNo || client.id) + (client.externalId ? " · " + client.externalId : "");
      $("st-office").textContent = (client.officeName || "") + (client.mobileNo ? " · " + client.mobileNo : "");
      $("st-range").textContent = "Period: " + from + " to " + to;
      $("st-printed").textContent = "Printed " + api.todayISO() + " by " + (sess.username || "");
      var sumHtml = sections.length ? "<div class=\"table-wrap mb-16\"><table class=\"data st-summary\"><thead><tr><th>Account</th><th></th><th class=\"text-right\">Opening</th><th class=\"text-right\">In / disbursed</th><th class=\"text-right\">Out / repaid</th><th class=\"text-right\">Closing</th></tr></thead><tbody>" +
        sections.map(function (s) {
          var x = s.summary;
          return "<tr><td class=\"strong\">" + esc(x[0]) + "</td><td>" + esc(x[1]) + "</td><td class=\"mono text-right\">" + amt(x[2]) + "</td><td class=\"mono text-right\">" + api.formatNumber(x[3]) +
            "</td><td class=\"mono text-right\">" + api.formatNumber(x[4]) + "</td><td class=\"mono text-right strong\">" + amt(x[5]) + "</td></tr>";
        }).join("") + "</tbody></table></div>" : "";
      body.innerHTML = sections.length ? "<h3 class=\"section-title\">Summary</h3>" + sumHtml + sections.map(function (s) { return s.html; }).join("") +
        "<p class=\"text-muted small-note st-foot\">Loan balances show principal outstanding. Accrual entries are not listed. Please report any discrepancy to the SACCO office within 30 days.</p>"
        : "<div class=\"empty-state\">This member has no active savings, share or disbursed loan accounts.</div>";
      $("st-actions").hidden = !sections.length;
      try { history.replaceState(null, "", "member-statement.html?clientId=" + enc + "&from=" + from + "&to=" + to); } catch (e) { /* ignore */ }
    };
    onSubmit($("statement-form"), runStatement);
    onClick($("st-print"), function () { window.print(); });
    onClick($("st-csv"), function () {
      if (!stExport.length) throw new Error("Run the statement first.");
      downloadCsv("statement-" + ($("st-name").textContent || "member").replace(/\s+/g, "-") + "-" + $("st-to").value + ".csv",
        ["Account", "Date", "Description", "Ref", "Debit / amount", "Credit / principal", "Balance / interest", "Fees", "Outstanding"], stExport);
    });
    var preset = api.qs("clientId");
    if (preset) {
      if (api.isISODate(api.qs("from"))) $("st-from").value = api.qs("from");
      if (api.isISODate(api.qs("to"))) $("st-to").value = api.qs("to");
      run(async function () {
        var c = await api.get("/clients/" + encodeURIComponent(preset));
        chosen = { id: c.id, name: c.displayName };
        stInput.value = c.displayName || "";
        await runStatement();
      });
    }
  }

})();
