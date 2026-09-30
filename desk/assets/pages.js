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

  /* =================================================================== DASHBOARD */
  if (page === "dashboard") {
    run(async function () {
      setText("page-sub", "Currency UGX" + (sess.officeName ? " · " + sess.officeName : ""));
      var res = await Promise.all([
        api.get("/clients?status=active&limit=1&offset=0"),
        api.get("/loans?status=300&limit=1&offset=0"),
        api.get("/loans?status=100&limit=1&offset=0"),
        api.get("/loans?status=200&limit=1&offset=0"),
        api.get("/savingsaccounts?limit=1&offset=0"),
      ]);
      setText("kpi-active-members", api.formatNumber(count(res[0])));
      setText("kpi-active-loans", api.formatNumber(count(res[1])));
      setText("kpi-pending-loans", api.formatNumber(count(res[2])));
      setText("kpi-approved-loans", api.formatNumber(count(res[3])));
      setText("kpi-savings-accounts", api.formatNumber(count(res[4])));
      var recent = await api.get("/clients?limit=8&offset=0&orderBy=id&sortOrder=DESC");
      var items = (recent && recent.pageItems) || [];
      var tbody = document.querySelector("#recent-members tbody");
      if (!tbody) return;
      tbody.innerHTML = items.map(function (c) {
        var t = c.timeline || {};
        return "<tr><td class=\"mono\">" + esc(api.formatDate(t.activatedOnDate || t.submittedOnDate)) +
          "</td><td><a href=\"client-detail.html?id=" + encodeURIComponent(c.id) + "\">" + esc(fullName(c)) +
          "</a></td><td>" + esc(c.officeName || "—") + "</td><td class=\"mono text-right\">" + esc(c.accountNo || c.id) + "</td></tr>";
      }).join("") || api.emptyRow(4, "No members yet");
    });
  }

  /* =================================================================== CLIENTS */
  if (page === "clients") {
    var clientSearch = $("clients-search");
    var clientStatus = $("clients-status");
    if (clientSearch && api.qs("q")) clientSearch.value = api.qs("q");
    var clientList = pagedList({
      tbody: document.querySelector("#clients-table tbody"), pager: $("clients-pager"), cols: 7,
      empty: "No members found",
      fetch: async function (offset, limit) {
        var q = "/clients?offset=" + offset + "&limit=" + limit + "&orderBy=id&sortOrder=DESC";
        var name = clientSearch ? clientSearch.value.trim() : "";
        if (name) q += "&displayName=" + encodeURIComponent(name);
        var st = clientStatus ? clientStatus.value : "all";
        if (st && st !== "all") q += "&status=" + encodeURIComponent(st);
        var data = await api.get(q);
        return { items: data.pageItems || [], total: count(data) };
      },
      row: function (c) {
        var name = fullName(c);
        var href = "client-detail.html?id=" + encodeURIComponent(c.id);
        return "<tr>" +
          "<td><div class=\"photo-frame sm has-photo\" aria-hidden=\"true\">" + esc(api.initials(name)) + "</div></td>" +
          "<td class=\"mono\">" + esc(c.accountNo || c.id) + "</td>" +
          "<td class=\"strong\"><a href=\"" + href + "\">" + esc(name) + "</a></td>" +
          "<td>" + esc(c.mobileNo || "—") + "</td>" +
          "<td>" + esc(c.officeName || "—") + "</td>" +
          "<td>" + api.statusBadge(c.status) + "</td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">View</a></td>" +
          "</tr>";
      }
    });
    var cf = $("clients-filter");
    if (cf) cf.addEventListener("submit", function (e) { e.preventDefault(); run(clientList.reset); });
    if (clientStatus) clientStatus.addEventListener("change", function () { run(clientList.reset); });
    run(clientList.reset);
  }

  /* =================================================================== CLIENT DETAIL */
  if (page === "client-detail") {
    var clientId = api.qs("id");
    var paintClient = async function () {
      if (!clientId) {
        setText("page-sub", "No member selected.");
        throw new Error("Open a member from the Clients list.");
      }
      var enc = encodeURIComponent(clientId);
      var res = await Promise.all([
        api.get("/clients/" + enc),
        api.get("/clients/" + enc + "/accounts").catch(function () { return {}; }),
        api.get("/clients/" + enc + "/identifiers").catch(function () { return []; }),
      ]);
      var client = res[0], accounts = res[1] || {}, ids = Array.isArray(res[2]) ? res[2] : [];
      var name = fullName(client);
      document.title = name + " · Pivot SACCO Desk";
      setText("client-title", name);
      setText("client-name", name);
      setHtml("client-status", api.statusBadge(client.status));
      setText("page-sub", "Client #" + (client.accountNo || client.id) + " · " + (client.officeName || ""));
      setText("client-avatar", api.initials(name));
      var bits = ["#" + (client.accountNo || client.id)];
      if (client.gender && client.gender.name) bits.push(client.gender.name);
      if (client.dateOfBirth) bits.push("DOB " + api.formatDate(client.dateOfBirth));
      if (client.officeName) bits.push(client.officeName);
      if (client.staffName) bits.push("Staff: " + client.staffName);
      setText("client-summary", bits.join(" · "));
      setText("client-mobile", client.mobileNo);
      setText("client-external", client.externalId);
      setText("client-office", client.officeName);
      var tl = client.timeline || {};
      setText("client-activation", tl.activatedOnDate ? api.formatDate(tl.activatedOnDate) : "Not activated");
      var firstId = ids[0];
      setText("client-identifier", firstId ? ((firstId.documentType && firstId.documentType.name) || "ID") + " · " + (firstId.documentKey || "") : "");
      var loans = accounts.loanAccounts || [];
      var savs = accounts.savingsAccounts || [];
      var total = savs.reduce(function (sum, s) {
        return sum + (s.status && s.status.active ? Number(s.accountBalance || 0) : 0);
      }, 0);
      setText("client-savings-total", savs.length ? api.formatMoney(total) : "");
      var lb = document.querySelector("#client-loans tbody");
      if (lb) {
        lb.innerHTML = loans.map(function (l) {
          var href = "loan-detail.html?id=" + encodeURIComponent(l.id);
          var bal = l.loanBalance !== undefined && l.loanBalance !== null ? api.formatMoney(l.loanBalance) : "—";
          return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(l.accountNo || l.id) + "</a></td><td>" +
            esc(l.productName || "") + "</td><td>" + api.statusBadge(l.status) + "</td><td class=\"mono text-right\">" + bal +
            "</td><td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">Open</a></td></tr>";
        }).join("") || api.emptyRow(5, "No loans");
      }
      var sb = document.querySelector("#client-savings tbody");
      if (sb) {
        sb.innerHTML = savs.map(function (s) {
          var href = "savings-detail.html?id=" + encodeURIComponent(s.id);
          return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(s.accountNo || s.id) + "</a></td><td>" +
            esc(s.productName || "") + "</td><td>" + api.statusBadge(s.status) + "</td><td class=\"mono text-right\">" +
            api.formatMoney(s.accountBalance) + "</td><td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">Open</a></td></tr>";
        }).join("") || api.emptyRow(5, "No savings accounts");
      }
      var st = $("link-statement");
      if (st) st.href = "member-statement.html?clientId=" + enc;
      var nl = $("link-new-loan");
      if (nl) nl.href = "loan-apply.html?clientId=" + enc;
      emit("desk:client", client);
    };
    onRefresh(paintClient);
    run(paintClient);
  }

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
      var loan = await api.get("/loans/" + encodeURIComponent(loanId) + "?associations=repaymentSchedule,transactions");
      document.title = "Loan " + (loan.accountNo || loanId) + " · Pivot SACCO Desk";
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

  /* =================================================================== SAVINGS */
  if (page === "savings") {
    var savSearch = $("savings-search");
    var savList = pagedList({
      tbody: document.querySelector("#savings-table tbody"), pager: $("savings-pager"), cols: 6,
      empty: "No savings accounts found",
      fetch: async function (offset, limit) {
        var q = savSearch ? savSearch.value.trim() : "";
        if (q) {
          var hits = await api.searchEntities(q, "savings");
          hits = hits.filter(function (h) { return /^SAVING/.test(String(h.entityType || "")); });
          return {
            paged: false, total: hits.length,
            items: hits.map(function (h) {
              return { id: h.entityId, accountNo: h.entityAccountNo, clientName: h.parentName, clientId: h.parentId, savingsProductName: h.entityName, status: h.entityStatus };
            })
          };
        }
        var data = await api.get("/savingsaccounts?offset=" + offset + "&limit=" + limit + "&orderBy=id&sortOrder=DESC");
        return { items: data.pageItems || [], total: count(data) };
      },
      row: function (s) {
        var href = "savings-detail.html?id=" + encodeURIComponent(s.id);
        var bal = s.summary && s.summary.accountBalance !== undefined ? s.summary.accountBalance : s.accountBalance;
        return "<tr>" +
          "<td class=\"mono\"><a href=\"" + href + "\">" + esc(s.accountNo || s.id) + "</a></td>" +
          "<td>" + (s.clientId ? "<a href=\"client-detail.html?id=" + encodeURIComponent(s.clientId) + "\">" + esc(s.clientName || "—") + "</a>" : esc(s.clientName || "—")) + "</td>" +
          "<td>" + esc(s.savingsProductName || "") + "</td>" +
          "<td class=\"mono text-right\">" + (bal !== undefined ? api.formatMoney(bal) : "—") + "</td>" +
          "<td>" + api.statusBadge(s.status) + "</td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">View</a></td>" +
          "</tr>";
      }
    });
    var sf = $("savings-filter");
    if (sf) sf.addEventListener("submit", function (e) { e.preventDefault(); run(savList.reset); });
    onRefresh(savList.current);
    run(savList.reset);
  }

  /* =================================================================== SAVINGS DETAIL */
  if (page === "savings-detail") {
    var savId = api.qs("id");
    var paintSavings = async function () {
      if (!savId) {
        setText("page-sub", "No account selected.");
        throw new Error("Open a savings account from the list.");
      }
      var sav = await api.get("/savingsaccounts/" + encodeURIComponent(savId) + "?associations=transactions");
      var sum = sav.summary || {};
      document.title = "Savings " + (sav.accountNo || savId) + " · Pivot SACCO Desk";
      setText("sav-title", "Savings " + (sav.accountNo || savId));
      setText("page-sub", (sav.clientName || "") + " · " + (sav.savingsProductName || ""));
      setText("sav-product", sav.savingsProductName);
      setHtml("sav-status", api.statusBadge(sav.status));
      setText("sav-account", "#" + (sav.accountNo || savId));
      var link = $("sav-client");
      if (link) {
        link.textContent = sav.clientName || "—";
        link.href = "client-detail.html?id=" + encodeURIComponent(sav.clientId || "");
      }
      var stl = $("sav-statement");
      if (stl) stl.href = "member-statement.html?clientId=" + encodeURIComponent(sav.clientId || "");
      setText("sav-balance", api.formatMoney(sum.accountBalance));
      setText("sav-available", sum.availableBalance !== undefined ? api.formatMoney(sum.availableBalance) : "");
      setText("sav-interest", sav.nominalAnnualInterestRate !== undefined ? sav.nominalAnnualInterestRate + "% p.a." : "");
      var tl = sav.timeline || {};
      setText("sav-opened", api.formatDate(tl.activatedOnDate || tl.submittedOnDate));
      var tb = document.querySelector("#sav-txns tbody");
      if (tb) {
        tb.innerHTML = (sav.transactions || []).map(function (t) {
          var type = (t.transactionType && t.transactionType.value) || "";
          if (t.reversed) type += " (reversed)";
          return "<tr><td>" + esc(api.formatDate(t.date)) + "</td><td>" + esc(type) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(t.amount) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(t.runningBalance) + "</td></tr>";
        }).join("") || api.emptyRow(4, "No transactions");
      }
      emit("desk:savings", sav);
    };
    onRefresh(paintSavings);
    run(paintSavings);
  }

  /* =================================================================== GROUPS / CENTRES */
  function groupLike(kind) {
    var isGroup = kind === "groups";
    var search = $(kind + "-search");
    var list = pagedList({
      tbody: document.querySelector("#" + kind + "-table tbody"), pager: $(kind + "-pager"), cols: 4,
      empty: isGroup ? "No groups" : "No centres",
      fetch: async function (offset, limit) {
        var url = (isGroup ? "/groups" : "/centers") + "?paged=true&offset=" + offset + "&limit=" + limit + "&orderBy=id&sortOrder=DESC";
        var q = search ? search.value.trim() : "";
        if (q) url += "&name=" + encodeURIComponent(q);
        var data = await api.get(url);
        if (Array.isArray(data)) return { items: data, total: data.length, paged: false };
        return { items: data.pageItems || [], total: count(data) };
      },
      row: function (g) {
        return "<tr><td class=\"strong\">" + esc(g.name || "") + "</td><td>" + esc(g.officeName || "") + "</td><td>" +
          esc((isGroup ? g.centerName : g.staffName) || "—") + "</td><td>" + api.statusBadge(g.status) + "</td></tr>";
      }
    });
    var form = $(kind + "-filter");
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); run(list.reset); });
    onRefresh(list.current);
    run(list.reset);
  }
  if (page === "groups") groupLike("groups");
  if (page === "centres") groupLike("centres");

  /* =================================================================== COLLECTIONS */
  if (page === "collections") {
    run(async function () {
      var tbody = document.querySelector("#collections-table tbody");
      var CHUNK = 200, MAX = 2000;
      var all = [], total = 0, offset = 0;
      do {
        var data = await api.get("/loans?status=300&offset=" + offset + "&limit=" + CHUNK + "&orderBy=id&sortOrder=ASC");
        total = count(data);
        all = all.concat(data.pageItems || []);
        offset += CHUNK;
      } while (offset < total && offset < MAX);
      var overdue = all.filter(function (l) {
        return l.inArrears || (l.summary && Number(l.summary.totalOverdue) > 0);
      });
      var amount = overdue.reduce(function (s, l) { return s + Number((l.summary && l.summary.totalOverdue) || 0); }, 0);
      setText("kpi-overdue-count", api.formatNumber(overdue.length));
      setText("kpi-overdue-amount", api.formatMoney(amount));
      setText("kpi-checked", api.formatNumber(all.length));
      setText("collections-note", all.length < total ?
        "Checked the first " + api.formatNumber(all.length) + " of " + api.formatNumber(total) + " active loans." :
        "Checked all " + api.formatNumber(total) + " active loans.");
      tbody.innerHTML = overdue.map(function (l) {
        var sum = l.summary || {};
        return "<tr><td><a href=\"client-detail.html?id=" + encodeURIComponent(l.clientId || "") + "\">" + esc(l.clientName || "") +
          "</a></td><td class=\"mono\">" + esc(l.accountNo || "") + "</td><td>" + api.statusBadge("In arrears") +
          "</td><td class=\"mono text-right\">" + api.formatMoney(sum.totalOverdue) +
          "</td><td class=\"mono text-right\">" + api.formatMoney(sum.totalOutstanding) +
          "</td><td>" + esc(l.loanOfficerName || "—") +
          "</td><td><a class=\"btn btn-sm\" href=\"loan-detail.html?id=" + encodeURIComponent(l.id) + "\">Open loan</a></td></tr>";
      }).join("") || api.emptyRow(7, "No active loans are in arrears.");
    });
  }

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
  if (page === "offices") {
    run(async function () {
      var res = await Promise.all([loadOffices(), api.get("/staff?status=all").catch(function () { return []; })]);
      var offices = res[0];
      var staff = Array.isArray(res[1]) ? res[1] : (res[1].pageItems || []);
      var byParent = {};
      offices.forEach(function (o) {
        var k = o.parentId || 0;
        (byParent[k] = byParent[k] || []).push(o);
      });
      function branch(pid) {
        var kids = byParent[pid] || [];
        if (!kids.length) return "";
        return "<ul" + (pid ? "" : " class=\"tree\"") + ">" + kids.map(function (o) {
          return "<li><div class=\"node\"><strong>" + esc(o.name) + "</strong><span class=\"text-muted small-note\">opened " +
            esc(api.formatDate(o.openingDate)) + "</span></div>" + branch(o.id) + "</li>";
        }).join("") + "</ul>";
      }
      setHtml("office-tree", branch(0) || "<p class=\"text-muted\">No offices</p>");
      document.querySelector("#staff-table tbody").innerHTML = staff.map(function (s) {
        var name = s.displayName || ((s.firstname || "") + " " + (s.lastname || "")).trim();
        return "<tr><td class=\"strong\">" + esc(name) + "</td><td>" + esc(s.officeName || "") +
          "</td><td>" + (s.isLoanOfficer ? "Yes" : "No") + "</td><td>" + (s.isActive ? "Active" : "Inactive") + "</td></tr>";
      }).join("") || api.emptyRow(4, "No staff");
    });
  }

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
