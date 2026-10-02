/* Pivot SACCO Desk — read-side page wiring against live Fineract */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api) return;

  var page = document.body.getAttribute("data-page") || "";
  var PAGE_SIZE = 25;
  var esc = api.escapeHtml;

  function $(id) { return document.getElementById(id); }
  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  }
  function setHtml(id, html) {
    var el = $(id);
    if (el) el.innerHTML = html;
  }
  function count(res) {
    if (!res) return 0;
    if (typeof res.totalFilteredRecords === "number") return res.totalFilteredRecords;
    return (res.pageItems || []).length;
  }
  function fullName(c) {
    return c.displayName || ((c.firstname || "") + " " + (c.lastname || "")).trim() || ("#" + c.id);
  }
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }
  function onRefresh(fn) {
    document.addEventListener("desk:refresh", function () { run(fn); });
  }

  /* Runs a page loader; on failure shows the error instead of leaving stale content. */
  function run(fn) {
    return Promise.resolve().then(fn).then(function () {
      api.clearStatus();
    }).catch(function (err) {
      if (err && err.status === 401) return;
      document.querySelectorAll("tr.loading-row td").forEach(function (td) {
        td.textContent = "Could not load: " + (err.message || err);
      });
      if (!err.status) api.setStatus("Cannot reach Fineract — data may be stale. " + (err.message || ""));
      api.toast(err.message || String(err), "error");
    });
  }

  /*
   * Server-side paging.
   * opts: { tbody, pager, cols, limit, fetch(offset, limit) → { items, total, paged }, row(item), empty }
   */
  function pagedList(opts) {
    var limit = opts.limit || PAGE_SIZE;
    var offset = 0;
    var pager = opts.pager;
    function renderPager(shown, total, paged) {
      if (!pager) return;
      if (!paged) {
        pager.innerHTML = '<span class="pager-info">' + (shown ? "Showing " + shown + " match" + (shown === 1 ? "" : "es") : "") + "</span>";
        return;
      }
      var from = total ? offset + 1 : 0;
      var to = offset + shown;
      pager.innerHTML = '<span class="pager-info">Showing ' + from + "–" + to + " of " + api.formatNumber(total) + "</span>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-page="prev"' + (offset <= 0 ? " disabled" : "") + ">‹ Prev</button>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-page="next"' + (to >= total ? " disabled" : "") + ">Next ›</button>";
      pager.querySelectorAll("button[data-page]").forEach(function (b) {
        b.addEventListener("click", function () {
          var next = b.getAttribute("data-page") === "next" ? offset + limit : Math.max(0, offset - limit);
          run(function () { return load(next); });
        });
      });
    }
    async function load(newOffset) {
      offset = Math.max(0, newOffset || 0);
      opts.tbody.innerHTML = api.loadingRow(opts.cols);
      try {
        var res = await opts.fetch(offset, limit);
        var items = res.items || [];
        opts.tbody.innerHTML = items.length ? items.map(opts.row).join("") : api.emptyRow(opts.cols, opts.empty || "Nothing found");
        renderPager(items.length, res.total || 0, res.paged !== false);
      } catch (err) {
        opts.tbody.innerHTML = api.emptyRow(opts.cols, "Could not load: " + (err.message || err));
        if (pager) pager.innerHTML = "";
        throw err;
      }
    }
    return { load: load, reset: function () { return load(0); }, current: function () { return load(offset); } };
  }

  function officeOptions(select, offices, selected, allLabel) {
    if (!select) return;
    select.innerHTML = (allLabel ? '<option value="">' + esc(allLabel) + "</option>" : "") + offices.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
    }).join("");
    if (selected !== undefined && selected !== null && selected !== "") select.value = String(selected);
  }

  async function loadOffices() {
    var offices = await api.get("/offices");
    return Array.isArray(offices) ? offices : [];
  }

  /* =================================================================== LOGIN */
  if (page === "login") {
    if (api.isLoggedIn()) {
      location.replace("dashboard.html");
      return;
    }
    var loginForm = $("login-form");
    var renewForm = $("renew-form");
    var tenantInput = $("login-tenant");
    var pending = null;
    if (tenantInput && !tenantInput.value) tenantInput.value = api.DEFAULT_TENANT;
    var notice = $("login-notice");
    if (notice) {
      var msg = api.qs("expired") ? "Your session has expired. Please sign in again." :
        api.qs("idle") ? "You were signed out after 30 minutes of inactivity." : "";
      if (msg) { notice.textContent = msg; notice.hidden = false; }
    }
    function showErr(id, text) {
      var el = $(id);
      if (!el) return;
      el.textContent = text || "";
      el.hidden = !text;
    }
    function friendly(err) {
      if (err && err.status === 401) return "Username or password is incorrect.";
      if (err && err.status === 404) return "Tenant not found. Check the tenant name.";
      return (err && err.message) || String(err);
    }
    if (loginForm) {
      loginForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var tenant = tenantInput.value.trim();
        var username = $("login-username").value.trim();
        var password = $("login-password").value;
        if (!tenant || !username || !password) { showErr("login-error", "Enter tenant, username and password."); return; }
        var btn = loginForm.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Signing in…";
        showErr("login-error", "");
        try {
          var res = await api.login(username, password, tenant);
          if (res.renewPassword) {
            pending = res;
            pending.username = username;
            $("login-password").value = "";
            loginForm.hidden = true;
            renewForm.hidden = false;
            $("renew-password").focus();
            return;
          }
          location.replace("dashboard.html");
        } catch (err) {
          showErr("login-error", friendly(err));
          $("login-password").value = "";
        } finally {
          btn.disabled = false;
          btn.textContent = "Sign in";
        }
      });
    }
    if (renewForm) {
      renewForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var p1 = $("renew-password").value;
        var p2 = $("renew-repeat").value;
        if (!p1 || p1 !== p2) { showErr("renew-error", "The two passwords must match."); return; }
        var btn = renewForm.querySelector("button[type=submit]");
        btn.disabled = true;
        showErr("renew-error", "");
        try {
          await api.changePassword(pending, p1, p2);
          var res = await api.login(pending.username, p1, pending.tenantId);
          if (res.renewPassword) throw new Error("Fineract still requires a password change. Contact your administrator.");
          location.replace("dashboard.html");
        } catch (err) {
          showErr("renew-error", err.message || String(err));
          btn.disabled = false;
        } finally {
          $("renew-password").value = "";
          $("renew-repeat").value = "";
        }
      });
    }
    return;
  }

  if (!api.isLoggedIn()) return;
  var sess = api.getSession() || {};

  /* Dashboard and offices live in assets/frontoffice.js. */

  /* CLIENTS and CLIENT DETAIL pages are wired in assets/members.js. */

  /* =================================================================== LOANS */
  if (page === "loans") {
    var loanSearch = $("loans-search");
    var loanStatus = $("loans-status");
    if (loanStatus && api.qs("status")) loanStatus.value = api.qs("status");
    run(async function () {
      var res = await Promise.all([
        api.get("/loans?status=300&limit=1&offset=0"),
        api.get("/loans?status=100&limit=1&offset=0"),
        api.get("/loans?status=200&limit=1&offset=0"),
      ]);
      setText("kpi-loans-active", api.formatNumber(count(res[0])));
      setText("kpi-loans-pending", api.formatNumber(count(res[1])));
      setText("kpi-loans-approved", api.formatNumber(count(res[2])));
    });
    var loanList = pagedList({
      tbody: document.querySelector("#loans-table tbody"), pager: $("loans-pager"), cols: 8,
      empty: "No loans found",
      fetch: async function (offset, limit) {
        var q = loanSearch ? loanSearch.value.trim() : "";
        var st = loanStatus ? loanStatus.value : "";
        if (q) {
          var hits = await api.searchEntities(q, "loans");
          hits = hits.filter(function (h) {
            return h.entityType === "LOAN" && (!st || (h.entityStatus && String(h.entityStatus.id) === st));
          });
          return {
            paged: false, total: hits.length,
            items: hits.map(function (h) {
              return { id: h.entityId, accountNo: h.entityAccountNo, clientName: h.parentName, clientId: h.parentId, loanProductName: h.entityName, status: h.entityStatus };
            })
          };
        }
        var url = "/loans?offset=" + offset + "&limit=" + limit + "&orderBy=id&sortOrder=DESC" + (st ? "&status=" + encodeURIComponent(st) : "");
        var data = await api.get(url);
        return { items: data.pageItems || [], total: count(data) };
      },
      row: function (l) {
        var href = "loan-detail.html?id=" + encodeURIComponent(l.id);
        var sum = l.summary || {};
        return "<tr>" +
          "<td class=\"mono\"><a href=\"" + href + "\">" + esc(l.accountNo || l.id) + "</a></td>" +
          "<td>" + (l.clientId ? "<a href=\"client-detail.html?id=" + encodeURIComponent(l.clientId) + "\">" + esc(l.clientName || "—") + "</a>" : esc(l.clientName || "—")) + "</td>" +
          "<td>" + esc(l.loanProductName || "") + "</td>" +
          "<td class=\"mono text-right\">" + (l.principal !== undefined ? api.formatMoney(l.principal) : "—") + "</td>" +
          "<td class=\"mono text-right\">" + (sum.totalOutstanding !== undefined ? api.formatMoney(sum.totalOutstanding) : "—") + "</td>" +
          "<td>" + api.statusBadge(l.status) + "</td>" +
          "<td>" + esc(api.formatDate(l.timeline && l.timeline.actualDisbursementDate)) + "</td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">View</a></td>" +
          "</tr>";
      }
    });
    var lf = $("loans-filter");
    if (lf) lf.addEventListener("submit", function (e) { e.preventDefault(); run(loanList.reset); });
    if (loanStatus) loanStatus.addEventListener("change", function () { run(loanList.reset); });
    run(loanList.reset);
  }

  /* =================================================================== LOAN DETAIL */
  if (page === "loan-detail") {
    var loanId = api.qs("id");
    var paintLoan = async function () {
      if (!loanId) {
        setText("page-sub", "No loan selected.");
        throw new Error("Open a loan from the Loans list.");
      }
      var loan = await api.get("/loans/" + encodeURIComponent(loanId) + "?associations=all");
      document.title = "Loan " + (loan.accountNo || loanId) + " · Phaneroo SACCO";
      setText("loan-title", "Loan " + (loan.accountNo || loanId));
      setText("page-sub", (loan.clientName || "") + " · " + api.statusLabel(loan.status));
      setText("loan-product", loan.loanProductName);
      setHtml("loan-status", api.statusBadge(loan.status));
      setText("loan-account", "#" + (loan.accountNo || loanId));
      var cl = $("loan-client");
      if (cl) {
        cl.textContent = loan.clientName || "—";
        cl.href = "client-detail.html?id=" + encodeURIComponent(loan.clientId || "");
      }
      var sum = loan.summary || {};
      var status = loan.status || {};
      var principal = status.pendingApproval ? loan.proposedPrincipal : (loan.approvedPrincipal || loan.principal);
      setText("loan-principal", api.formatMoney(principal !== undefined ? principal : loan.principal));
      setText("loan-outstanding", sum.totalOutstanding !== undefined ? api.formatMoney(sum.totalOutstanding) : (status.active ? "" : "Not disbursed"));
      setText("loan-overdue", sum.totalOverdue !== undefined ? api.formatMoney(sum.totalOverdue) : "");
      var periods = ((loan.repaymentSchedule && loan.repaymentSchedule.periods) || []).filter(function (p) { return p.period; });
      var next = periods.filter(function (p) { return !p.complete; })[0];
      setText("loan-next-due", next ? api.formatDate(next.dueDate) + " · " + api.formatMoney(next.totalOutstandingForPeriod) : "");
      var freq = (loan.interestRateFrequencyType && loan.interestRateFrequencyType.value) || "";
      setText("loan-interest", loan.interestRatePerPeriod !== undefined ? loan.interestRatePerPeriod + "% " + freq.toLowerCase() : "");
      setText("loan-expected-disb", api.formatDate(loan.timeline && (loan.timeline.actualDisbursementDate || loan.timeline.expectedDisbursementDate)));
      var sb = document.querySelector("#loan-schedule tbody");
      if (sb) {
        sb.innerHTML = periods.map(function (p) {
          return "<tr><td>" + esc(p.period) + "</td><td>" + esc(api.formatDate(p.dueDate)) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.principalDue) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.interestDue) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.totalDueForPeriod) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.totalOutstandingForPeriod) + "</td></tr>";
        }).join("") || api.emptyRow(6, "No schedule");
      }
      var tb = document.querySelector("#loan-txns tbody");
      if (tb) {
        var txns = (loan.transactions || []).slice().reverse();
        tb.innerHTML = txns.map(function (t) {
          var type = (t.type && t.type.value) || "";
          if (t.manuallyReversed) type += " (reversed)";
          return "<tr><td>" + esc(api.formatDate(t.date)) + "</td><td>" + esc(type) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(t.amount) + "</td></tr>";
        }).join("") || api.emptyRow(3, "No transactions");
      }
      emit("desk:loan", loan);
    };
    onRefresh(paintLoan);
    run(paintLoan);
  }

  /* SAVINGS, SAVINGS DETAIL, SHARES and FIXED DEPOSITS pages are wired in assets/deposits.js. */

  /* GROUPS and CENTRES pages are wired in assets/members.js. */

  /* =================================================================== COLLECTIONS — see loans.js */

  /* =================================================================== ACCOUNTING — COA */
  if (page === "accounting") {
    var paintCoa = async function () {
      var tbody = document.querySelector("#coa-table tbody");
      var items = await api.get("/glaccounts");
      if (!Array.isArray(items)) items = items.pageItems || [];
      items.sort(function (a, b) { return String(a.glCode || "").localeCompare(String(b.glCode || "")); });
      tbody.innerHTML = items.map(function (a) {
        return "<tr>" +
          "<td class=\"mono\">" + esc(a.glCode || "") + "</td>" +
          "<td class=\"strong\">" + esc(a.name || "") + "</td>" +
          "<td>" + esc((a.type && a.type.value) || "") + "</td>" +
          "<td>" + esc((a.usage && a.usage.value) || "") + "</td>" +
          "<td>" + (a.disabled ? "Disabled" : "Enabled") + "</td>" +
          "<td>" + (a.manualEntriesAllowed ? "Manual allowed" : "System only") + "</td>" +
          "</tr>";
      }).join("") || api.emptyRow(6, "No GL accounts");
    };
    var coaFilter = $("coa-filter");
    if (coaFilter) {
      coaFilter.addEventListener("input", function () {
        var q = coaFilter.value.toLowerCase().trim();
        document.querySelectorAll("#coa-table tbody tr").forEach(function (tr) {
          tr.hidden = !!q && tr.textContent.toLowerCase().indexOf(q) === -1;
        });
      });
    }
    onRefresh(paintCoa);
    run(paintCoa);
  }

  /* =================================================================== JOURNALS */
  if (page === "journals") {
    var jeList = pagedList({
      tbody: document.querySelector("#je-table tbody"), pager: $("je-pager"), cols: 9,
      empty: "No journal entries for these filters",
      fetch: async function (offset, limit) {
        var p = new URLSearchParams({ offset: offset, limit: limit, orderBy: "id", sortOrder: "DESC" });
        var from = $("je-from").value, to = $("je-to").value;
        if (from) p.set("fromDate", from);
        if (to) p.set("toDate", to);
        if (from || to) { p.set("dateFormat", "yyyy-MM-dd"); p.set("locale", "en"); }
        if ($("je-office").value) p.set("officeId", $("je-office").value);
        if ($("je-manual").value) p.set("manualEntriesOnly", "true");
        if ($("je-txn").value.trim()) p.set("transactionId", $("je-txn").value.trim());
        var data = await api.get("/journalentries?" + p.toString());
        return { items: data.pageItems || [], total: count(data) };
      },
      row: function (j) {
        return "<tr>" +
          "<td class=\"mono\">" + esc(j.transactionId || j.id || "") + "</td>" +
          "<td>" + esc(api.formatDate(j.transactionDate)) + "</td>" +
          "<td>" + esc((j.glAccountCode ? j.glAccountCode + " " : "") + (j.glAccountName || "")) + "</td>" +
          "<td>" + esc(j.officeName || "") + "</td>" +
          "<td class=\"mono text-right\">" + api.formatMoney(j.amount) + "</td>" +
          "<td>" + esc(j.entryType && j.entryType.value ? j.entryType.value : "") + "</td>" +
          "<td>" + (j.manualEntry ? "Yes" : "No") + "</td>" +
          "<td>" + esc(j.comments || "") + (j.reversed ? " <span class=\"status closed\">Reversed</span>" : "") + "</td>" +
          "<td>" + esc(j.createdByUserName || "") + "</td>" +
          "</tr>";
      }
    });
    var jf = $("je-filter");
    if (jf) jf.addEventListener("submit", function (e) {
      e.preventDefault();
      var from = $("je-from").value, to = $("je-to").value;
      if (from && to && from > to) { api.toast("From date must be before To date", "error"); return; }
      run(jeList.reset);
    });
    run(async function () {
      officeOptions($("je-office"), await loadOffices(), "", "All offices");
      await jeList.reset();
    });
  }

  /* =================================================================== CLOSURES / MAPPINGS / RULES / PROVISIONING */
  if (page === "closing") {
    var paintClosures = async function () {
      var rows = await api.get("/glclosures");
      var list = Array.isArray(rows) ? rows : [];
      var canDelete = api.can("DELETE_GLCLOSURE");
      document.querySelector("#closures-table tbody").innerHTML = list.map(function (c) {
        return "<tr><td>" + esc(c.officeName || "") + "</td><td>" + esc(api.formatDate(c.closingDate)) + "</td><td>" +
          esc(c.comments || "") + "</td><td>" + esc(c.createdByUsername || "") + "</td><td>" +
          (canDelete ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-closure=\"" + esc(c.id) + "\" data-label=\"" +
            esc((c.officeName || "") + " · " + api.formatDate(c.closingDate)) + "\">Delete</button>" : "") + "</td></tr>";
      }).join("") || api.emptyRow(5, "No closures");
    };
    onRefresh(paintClosures);
    run(paintClosures);
  }
  if (page === "mappings") {
    var paintMappings = async function () {
      var rows = await api.get("/financialactivityaccounts");
      document.querySelector("#mappings-table tbody").innerHTML = (Array.isArray(rows) ? rows : []).map(function (m) {
        var act = m.financialActivityData || {}, gl = m.glAccountData || {};
        return "<tr><td>" + esc((act.name || "") + " (" + (act.id || "") + ")") + "</td><td>" + esc((gl.glCode || "") + " " + (gl.name || "")) + "</td></tr>";
      }).join("") || api.emptyRow(2, "No mappings");
    };
    onRefresh(paintMappings);
    run(paintMappings);
  }
  if (page === "rules") {
    var paintRules = async function () {
      var rules = await api.get("/accountingrules");
      rules = Array.isArray(rules) ? rules : [];
      function accts(list) {
        return (list || []).map(function (a) { return (a.glCode ? a.glCode + " " : "") + (a.name || a.glAccountName || ""); }).join(", ") || "—";
      }
      document.querySelector("#rules-table tbody").innerHTML = rules.map(function (r) {
        return "<tr><td class=\"strong\">" + esc(r.name || "") + "</td><td>" + esc(accts(r.debitAccounts)) + "</td><td>" +
          esc(accts(r.creditAccounts)) + "</td><td>" + esc(r.officeName || "All") + "</td></tr>";
      }).join("") || api.emptyRow(4, "No rules");
      var sel = $("rule-post-select");
      if (sel) {
        sel.innerHTML = '<option value="">— Select rule —</option>' + rules.map(function (r) {
          return '<option value="' + esc(r.id) + '">' + esc(r.name) + "</option>";
        }).join("");
      }
    };
    onRefresh(paintRules);
    run(paintRules);
  }
  if (page === "accruals") {
    run(async function () {
      var data = await api.get("/provisioningentries?offset=0&limit=25");
      var items = (data && data.pageItems) || (Array.isArray(data) ? data : []);
      document.querySelector("#provisioning-table tbody").innerHTML = items.map(function (p) {
        return "<tr><td>" + esc(api.formatDate(p.createdDate)) + "</td><td>" + esc(p.createdUser || p.createdByUsername || "—") +
          "</td><td>" + (p.journalEntry ? "Yes" : "No") + "</td></tr>";
      }).join("") || api.emptyRow(3, "No provisioning entries");
    });
  }

  /* =================================================================== OFFICES */
  /* =================================================================== PRODUCTS */
  if (page === "products") {
    var paintProducts = async function () {
      var res = await Promise.all([
        api.get("/loanproducts"),
        api.get("/savingsproducts").catch(function () { return []; }),
        api.get("/charges").catch(function () { return []; }),
        api.get("/floatingrates").catch(function () { return []; }),
      ]);
      var loanProducts = Array.isArray(res[0]) ? res[0] : [];
      var savingsProducts = Array.isArray(res[1]) ? res[1] : [];
      var charges = Array.isArray(res[2]) ? res[2] : [];
      var rates = Array.isArray(res[3]) ? res[3] : [];
      setHtml("loan-products", loanProducts.map(function (p) {
        var freq = (p.interestRateFrequencyType && p.interestRateFrequencyType.value) || "";
        var active = String(p.status || "").indexOf("active") >= 0;
        return "<div class=\"product-card\"><h3>" + esc(p.name) + "</h3><div class=\"rate\">" +
          esc((p.interestRatePerPeriod !== undefined ? p.interestRatePerPeriod + "%" : "—") + " " + freq.toLowerCase()) +
          "</div><div class=\"text-muted small-note\">Principal " + esc(api.formatMoney(p.minPrincipal)) + " – " + esc(api.formatMoney(p.maxPrincipal)) +
          " · " + esc(p.numberOfRepayments || "—") + " repayments</div>" +
          "<span class=\"status " + (active ? "active" : "closed") + "\">" + (active ? "Active" : "Inactive") + "</span></div>";
      }).join("") || "<p class=\"text-muted\">No loan products</p>");
      document.querySelector("#savings-products tbody").innerHTML = savingsProducts.map(function (p) {
        return "<tr><td class=\"strong\">" + esc(p.name) + "</td><td>" + esc(p.shortName || "") +
          "</td><td class=\"mono text-right\">" + (p.nominalAnnualInterestRate !== undefined ? esc(p.nominalAnnualInterestRate) + "%" : "—") + "</td></tr>";
      }).join("") || api.emptyRow(3, "No savings products");
      document.querySelector("#charges-table tbody").innerHTML = charges.map(function (c) {
        var calc = (c.chargeCalculationType && c.chargeCalculationType.value) || "";
        var flat = calc.toLowerCase().indexOf("flat") >= 0;
        return "<tr><td class=\"strong\">" + esc(c.name) + "</td><td>" + esc((c.chargeAppliesTo && c.chargeAppliesTo.value) || "") +
          "</td><td>" + esc(calc) + "</td><td class=\"mono text-right\">" + (flat ? api.formatMoney(c.amount) : esc(c.amount) + "%") +
          "</td><td>" + (c.active ? "Active" : "Inactive") + "</td></tr>";
      }).join("") || api.emptyRow(5, "No charges");
      document.querySelector("#floating-table tbody").innerHTML = rates.map(function (r) {
        return "<tr><td>" + esc(r.name) + "</td><td>" + (r.isBaseLendingRate ? "Yes" : "No") + "</td><td>" + (r.isActive ? "Active" : "Inactive") + "</td></tr>";
      }).join("") || api.emptyRow(3, "No floating rates");
    };
    onRefresh(paintProducts);
    run(paintProducts);
  }

  /* =================================================================== FINANCIAL REPORTS */
  var reportForm = $("report-form");
  if (reportForm && (page === "trial" || page === "is" || page === "bs")) {
    var reportName = reportForm.getAttribute("data-report");
    var hasStart = !!$("rpt-start");
    var output = $("report-output");
    if (hasStart) $("rpt-start").value = api.yearStartISO();
    $("rpt-end").value = api.todayISO();

    var num = function (v) { var n = Number(v); return isNaN(n) ? 0 : n; };
    var money = function (v) { return v === null || v === undefined ? "—" : api.formatNumber(v); };

    var renderReport = function (data) {
      var headers = ((data && data.columnHeaders) || []).map(function (h) { return String(h.columnName || "").toLowerCase(); });
      var rows = ((data && data.data) || []).map(function (r) {
        var o = {};
        (r.row || []).forEach(function (v, i) { o[headers[i]] = v; });
        return o;
      });
      if (page === "trial") {
        var dr = 0, cr = 0;
        var body = rows.map(function (r) {
          dr += num(r.debit); cr += num(r.credit);
          return "<tr><td class=\"mono\">" + esc(r.glcode || "") + "</td><td>" + esc(r.name || "") + "</td><td class=\"mono\">" +
            money(r.debit) + "</td><td class=\"mono\">" + money(r.credit) + "</td></tr>";
        }).join("") || api.emptyRow(4, "No balances for this period");
        return "<table class=\"data\"><thead><tr><th>GL</th><th>Account</th><th class=\"num\">Debit (UGX)</th><th class=\"num\">Credit (UGX)</th></tr></thead><tbody>" + body +
          "</tbody><tfoot><tr class=\"strong\"><td></td><td>Totals" + (dr === cr ? "" : " — not balanced") + "</td><td class=\"mono\">" +
          api.formatNumber(dr) + "</td><td class=\"mono\">" + api.formatNumber(cr) + "</td></tr></tfoot></table>";
      }
      var groupKey = page === "is" ? "incomeorexpense" : "balancetype";
      var groups = {}, order = [];
      rows.forEach(function (r) {
        var g = r[groupKey] || "Other";
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(r);
      });
      var totals = {};
      var html = "<table class=\"data\"><thead><tr><th>Account</th><th class=\"num\">Balance (UGX)</th></tr></thead><tbody>";
      order.forEach(function (g) {
        totals[g] = 0;
        html += "<tr class=\"strong group-row\"><td colspan=\"2\">" + esc(g) + "</td></tr>";
        groups[g].forEach(function (r) {
          totals[g] += num(r.balance);
          html += "<tr><td><span class=\"mono\">" + esc(r.glcode || "") + "</span> " + esc(r.name || "") + "</td><td class=\"mono\">" + money(r.balance) + "</td></tr>";
        });
        html += "<tr class=\"strong\"><td>Total " + esc(String(g).toLowerCase()) + "</td><td class=\"mono\">" + api.formatNumber(totals[g]) + "</td></tr>";
      });
      if (!order.length) html += api.emptyRow(2, "No balances for this period");
      if (page === "is" && order.length) {
        var income = 0, expense = 0;
        order.forEach(function (g) {
          if (/income/i.test(g)) income += totals[g];
          else if (/expense/i.test(g)) expense += totals[g];
        });
        html += "<tr class=\"strong total-row\"><td>Net surplus / (deficit)</td><td class=\"mono\">" + api.formatNumber(income - expense) + "</td></tr>";
      }
      return html + "</tbody></table>";
    };

    var runReport = async function () {
      var office = $("rpt-office").value;
      var end = $("rpt-end").value;
      var start = hasStart ? $("rpt-start").value : "";
      if (!office || !api.isISODate(end) || (hasStart && !api.isISODate(start))) throw new Error("Choose an office and valid dates.");
      if (hasStart && start > end) throw new Error("From date must be on or before To date.");
      var p = new URLSearchParams({ R_officeId: office, R_endDate: end, locale: "en", dateFormat: "yyyy-MM-dd", genericResultSet: "true" });
      if (hasStart) p.set("R_startDate", start);
      output.innerHTML = "<p class=\"text-muted\">Running report…</p>";
      try {
        var data = await api.get("/runreports/" + encodeURIComponent(reportName) + "?" + p.toString());
        output.innerHTML = renderReport(data);
      } catch (err) {
        api.showError(output, err);
        throw err;
      }
      var sel = $("rpt-office");
      var officeName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
      setText("report-sub", officeName + " · " + (hasStart ? start + " to " + end : "as at " + end));
    };
    reportForm.addEventListener("submit", function (e) { e.preventDefault(); run(runReport); });
    run(async function () {
      officeOptions($("rpt-office"), await loadOffices(), sess.officeId);
      await runReport();
    });
  }

  /* =================================================================== MEMBER STATEMENT */
  if (page === "statement") {
    var stInput = $("st-client");
    var chosen = null;
    $("st-from").value = api.yearStartISO();
    $("st-to").value = api.todayISO();
    api.typeahead(stInput, {
      fetch: api.searchClients,
      onInput: function () { chosen = null; },
      onSelect: function (item) { chosen = { id: item.value, name: item.label }; stInput.value = item.label; }
    });

    var inRange = function (d, from, to) {
      var s = api.formatDate(d);
      return s >= from && s <= to;
    };
    var runStatement = async function () {
      if (!chosen) throw new Error("Choose a member from the search results.");
      var from = $("st-from").value, to = $("st-to").value;
      if (!api.isISODate(from) || !api.isISODate(to)) throw new Error("Enter valid dates.");
      if (from > to) throw new Error("From date must be on or before To date.");
      var body = $("st-body");
      body.innerHTML = "<p class=\"text-muted\">Loading statement…</p>";
      var enc = encodeURIComponent(chosen.id);
      var base = await Promise.all([api.get("/clients/" + enc), api.get("/clients/" + enc + "/accounts")]);
      var client = base[0], accounts = base[1] || {};
      var savs = accounts.savingsAccounts || [];
      var loans = accounts.loanAccounts || [];
      var dq = "fromDate=" + from + "&toDate=" + to + "&dateFormat=yyyy-MM-dd&locale=en&offset=0&limit=1000";
      var results = await Promise.all([
        Promise.all(savs.map(function (s) {
          return api.get("/savingsaccounts/" + encodeURIComponent(s.id) + "/transactions/search?" + dq).then(function (r) {
            return { acct: s, txns: (r && (r.content || r.pageItems)) || [] };
          });
        })),
        Promise.all(loans.filter(function (l) { return !(l.status && (l.status.pendingApproval || l.status.waitingForDisbursal)); }).map(function (l) {
          return api.get("/loans/" + encodeURIComponent(l.id) + "?associations=transactions").then(function (full) {
            return { acct: l, txns: (full.transactions || []).filter(function (t) { return inRange(t.date, from, to); }) };
          });
        })),
      ]);
      var html = "";
      results[0].forEach(function (r) {
        var txns = r.txns.slice().sort(function (a, b) {
          var da = api.formatDate(a.date), db = api.formatDate(b.date);
          return da === db ? (a.id - b.id) : (da < db ? -1 : 1);
        });
        html += "<h3 class=\"section-title\">Savings " + esc(r.acct.accountNo || r.acct.id) + " · " + esc(r.acct.productName || "") + "</h3>" +
          "<div class=\"table-wrap mb-16\"><table class=\"data\"><thead><tr><th>Date</th><th>Description</th><th class=\"text-right\">In</th><th class=\"text-right\">Out</th><th class=\"text-right\">Balance</th></tr></thead><tbody>" +
          (txns.map(function (t) {
            var credit = t.entryType === "CREDIT" || (t.transactionType && t.transactionType.deposit);
            var label = ((t.transactionType && t.transactionType.value) || "") + (t.reversed ? " (reversed)" : "");
            return "<tr><td>" + esc(api.formatDate(t.date)) + "</td><td>" + esc(label) + "</td><td class=\"mono text-right\">" +
              (credit ? api.formatNumber(t.amount) : "—") + "</td><td class=\"mono text-right\">" + (credit ? "—" : api.formatNumber(t.amount)) +
              "</td><td class=\"mono text-right\">" + api.formatNumber(t.runningBalance) + "</td></tr>";
          }).join("") || api.emptyRow(5, "No transactions in this period")) + "</tbody></table></div>";
      });
      results[1].forEach(function (r) {
        html += "<h3 class=\"section-title\">Loan " + esc(r.acct.accountNo || r.acct.id) + " · " + esc(r.acct.productName || "") + "</h3>" +
          "<div class=\"table-wrap mb-16\"><table class=\"data\"><thead><tr><th>Date</th><th>Description</th><th class=\"text-right\">Amount</th><th class=\"text-right\">Outstanding</th></tr></thead><tbody>" +
          (r.txns.map(function (t) {
            var label = ((t.type && t.type.value) || "") + (t.manuallyReversed ? " (reversed)" : "");
            return "<tr><td>" + esc(api.formatDate(t.date)) + "</td><td>" + esc(label) + "</td><td class=\"mono text-right\">" +
              api.formatNumber(t.amount) + "</td><td class=\"mono text-right\">" + api.formatNumber(t.outstandingLoanBalance) + "</td></tr>";
          }).join("") || api.emptyRow(4, "No transactions in this period")) + "</tbody></table></div>";
      });
      setText("st-name", fullName(client) + " · #" + (client.accountNo || client.id));
      setText("st-range", from + " to " + to);
      body.innerHTML = html || "<div class=\"empty-state\">This member has no savings or disbursed loan accounts.</div>";
    };
    $("statement-form").addEventListener("submit", function (e) { e.preventDefault(); run(runStatement); });
    var preset = api.qs("clientId");
    if (preset) {
      run(async function () {
        var c = await api.get("/clients/" + encodeURIComponent(preset));
        chosen = { id: c.id, name: fullName(c) };
        stInput.value = fullName(c);
        await runStatement();
      });
    }
  }
})();
