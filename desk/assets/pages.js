/* Pivot SACCO Desk — page wiring to live Fineract */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api) {
    console.error("FineractAPI missing — load assets/api.js first");
    return;
  }

  var page = document.body.getAttribute("data-page") || "";
  var isLogin = /login\.html$/i.test(location.pathname) || document.getElementById("login-form");

  if (!isLogin && page) {
    if (!api.requireAuth()) return;
    api.markLiveChips();
  }

  function pageGuard(fn) {
    return async function () {
      try {
        await fn();
        api.setLiveBanner(true);
      } catch (err) {
        console.error(err);
        api.setLiveBanner(false, "LIVE attempt failed — " + (err.message || err));
        api.toast(err.message || String(err), "error");
      }
    };
  }

  /* ---------- LOGIN ---------- */
  var loginForm = document.getElementById("login-form");
  if (loginForm) {
    // Give inputs names/ids
    var selects = loginForm.querySelectorAll("select");
    var inputs = loginForm.querySelectorAll("input");
    if (selects[0] && !selects[0].name) selects[0].name = "tenant";
    if (inputs[0] && !inputs[0].name) inputs[0].name = "username";
    if (inputs[1] && !inputs[1].name) inputs[1].name = "password";

    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var tenant = (loginForm.querySelector("[name=tenant]") || loginForm.querySelector("select")).value;
      var username = (loginForm.querySelector("[name=username]") || loginForm.querySelector("input[type=text]")).value.trim();
      var password = (loginForm.querySelector("[name=password]") || loginForm.querySelector("input[type=password]")).value;
      var btn = loginForm.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
      try {
        await api.login(username, password, tenant);
        api.toast("Signed in as " + username, "success");
        api.setLiveBanner(true, "LIVE — authenticated against Fineract");
        setTimeout(function () { location.href = "dashboard.html"; }, 400);
      } catch (err) {
        api.toast("Login failed: " + (err.message || err), "error");
        api.setLiveBanner(false, "Login failed — " + (err.message || err));
        if (btn) { btn.disabled = false; btn.textContent = "Continue to desk"; }
      }
    });
    // Update banner copy
    var b = document.querySelector(".banner-mock");
    if (b) b.textContent = "LIVE auth ready — uses Fineract /authentication (mifos / password)";
    var hint = loginForm.parentElement && loginForm.parentElement.querySelector(".hint");
    if (hint) hint.textContent = "Tenant + Fineract credentials. Default: mifos / password.";
    var mockNote = loginForm.parentElement && loginForm.parentElement.querySelector(".text-muted");
    if (mockNote) mockNote.textContent = "POST /fineract-provider/api/v1/authentication";
  }

  /* ---------- DASHBOARD ---------- */
  if (page === "dashboard") {
    pageGuard(async function () {
      var kpis = document.querySelectorAll(".kpi-card .kpi-value");
      var labels = document.querySelectorAll(".kpi-card .kpi-label");
      function setKpi(labelMatch, value) {
        labels.forEach(function (lab, i) {
          if (lab.textContent.toLowerCase().indexOf(labelMatch) >= 0 && kpis[i]) {
            kpis[i].textContent = value;
          }
        });
      }
      var [clients, loans, savings] = await Promise.all([
        api.get("/clients?limit=1&offset=0"),
        api.get("/loans?limit=1&offset=0"),
        api.get("/savingsaccounts?limit=1&offset=0").catch(function () { return { totalFilteredRecords: 0 }; }),
      ]);
      setKpi("active members", (clients.totalFilteredRecords ?? (clients.pageItems || []).length).toLocaleString());
      setKpi("active loans", (loans.totalFilteredRecords ?? (loans.pageItems || []).length).toLocaleString());
      setKpi("savings", String(savings.totalFilteredRecords ?? (savings.pageItems || []).length) + " accts");
      setKpi("par", "—");
      setKpi("teller cash", "—");
      setKpi("collection", "—");

      // Recent clients into teller activity table if present
      var tbody = document.querySelector(".card-b tbody");
      if (tbody) {
        var recent = await api.get("/clients?limit=8&orderBy=id&sortOrder=DESC");
        var items = recent.pageItems || recent || [];
        if (!Array.isArray(items)) items = [];
        tbody.innerHTML = items.map(function (c) {
          var name = c.displayName || ((c.firstname || "") + " " + (c.lastname || "")).trim();
          return "<tr><td class=\"mono\">" + api.escapeHtml(api.formatDate(c.timeline && c.timeline.submittedOnDate)) +
            "</td><td><a href=\"client-detail.html?id=" + c.id + "\">" + api.escapeHtml(name) +
            "</a></td><td>Client</td><td class=\"mono text-right\">#" + c.id + "</td></tr>";
        }).join("") || "<tr><td colspan=\"4\">No clients yet</td></tr>";
      }
    })();
  }

  /* ---------- CLIENTS LIST ---------- */
  if (page === "clients") {
    pageGuard(async function () {
      var tbody = document.querySelector("#clients-table tbody");
      if (!tbody) return;
      tbody.innerHTML = "<tr class=\"loading-row\"><td colspan=\"7\">Loading clients…</td></tr>";
      var data = await api.get("/clients?limit=200&offset=0");
      var items = data.pageItems || [];
      if (!items.length) {
        tbody.innerHTML = "<tr><td colspan=\"7\">No clients found. <a href=\"client-onboard.html\">Onboard one</a></td></tr>";
        return;
      }
      tbody.innerHTML = items.map(function (c) {
        var name = c.displayName || ((c.firstname || "") + " " + (c.lastname || "")).trim();
        var st = api.statusLabel(c.status);
        var mobile = c.mobileNo || "—";
        var office = c.officeName || "—";
        var acct = c.accountNo || c.id;
        return "<tr>" +
          "<td><div class=\"photo-frame sm has-photo\">" + api.escapeHtml(api.initials(name)) + "</div></td>" +
          "<td class=\"mono\">" + api.escapeHtml(String(acct)) + "</td>" +
          "<td class=\"strong\"><a href=\"client-detail.html?id=" + c.id + "\">" + api.escapeHtml(name) + "</a></td>" +
          "<td>" + api.escapeHtml(mobile) + "</td>" +
          "<td>" + api.escapeHtml(office) + "</td>" +
          "<td><span class=\"status " + api.statusClass(st) + "\">" + api.escapeHtml(st) + "</span></td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"client-detail.html?id=" + c.id + "\">View</a></td>" +
          "</tr>";
      }).join("");
    })();
  }

  /* ---------- CLIENT DETAIL ---------- */
  if (page === "clients" && false) { /* placeholder */ }
  if (/client-detail/.test(location.pathname) || document.body.getAttribute("data-page") === "client-detail") {
    // ensure data-page
  }
  if (location.pathname.match(/client-detail\.html/) || page === "client-detail") {
    pageGuard(async function () {
      var id = api.qs("id");
      if (!id) {
        api.toast("Missing ?id= — pick a client from the list", "error");
        return;
      }
      var client = await api.get("/clients/" + id);
      var name = client.displayName || ((client.firstname || "") + " " + (client.lastname || "")).trim();
      var h1 = document.querySelector(".page-header h1, .content h1");
      if (h1) h1.textContent = name;
      var sub = document.querySelector(".page-sub");
      if (sub) {
        sub.textContent = "Client #" + (client.accountNo || client.id) + " · " +
          api.statusLabel(client.status) + " · " + (client.officeName || "");
      }
      // Fill labeled fields heuristically
      document.querySelectorAll(".kv, .detail-grid, .info-grid, dl, .card-b").forEach(function () {});
      // Replace common mock name links/text
      document.querySelectorAll(".photo-frame").forEach(function (el) {
        if (!el.classList.contains("sm")) el.textContent = api.initials(name);
      });
      // Accounts
      var accounts = await api.get("/clients/" + id + "/accounts").catch(function () { return {}; });
      var loanAccts = (accounts.loanAccounts || []);
      var savAccts = (accounts.savingsAccounts || []);
      var tables = document.querySelectorAll("table.data tbody");
      if (tables[0]) {
        tables[0].innerHTML = loanAccts.map(function (l) {
          return "<tr><td class=\"mono\"><a href=\"loan-detail.html?id=" + l.id + "\">" + l.accountNo +
            "</a></td><td>" + api.escapeHtml(l.productName || "") + "</td><td>" +
            api.escapeHtml(api.statusLabel(l.status)) + "</td><td class=\"mono text-right\">" +
            api.formatMoney(l.loanBalance != null ? l.loanBalance : l.originalLoan) + "</td></tr>";
        }).join("") || "<tr><td colspan=\"4\">No loans</td></tr>";
      }
      if (tables[1]) {
        tables[1].innerHTML = savAccts.map(function (s) {
          return "<tr><td class=\"mono\"><a href=\"savings-detail.html?id=" + s.id + "\">" + s.accountNo +
            "</a></td><td>" + api.escapeHtml(s.productName || "") + "</td><td>" +
            api.escapeHtml(api.statusLabel(s.status)) + "</td><td class=\"mono text-right\">" +
            api.formatMoney(s.accountBalance) + "</td></tr>";
        }).join("") || "<tr><td colspan=\"4\">No savings</td></tr>";
      }
      // Inject summary card if present
      var cards = document.querySelectorAll(".card-b");
      var addrBox = document.getElementById("client-addresses");
      if (addrBox) {
        try {
          var cfg = await api.get("/configurations/name/enable-address");
          if (cfg && cfg.enabled) {
            var addrs = await api.get("/client/" + id + "/addresses");
            var list = Array.isArray(addrs) ? addrs : [];
            addrBox.innerHTML = list.length ? list.map(function (a) {
              var line = [a.addressLine1, a.city, a.countryName].filter(Boolean).join(", ");
              return "<div class=\"meta-item\" style=\"margin-bottom:8px\"><div class=\"k\">" +
                api.escapeHtml(a.addressType || "Address") + "</div><div class=\"v\">" + api.escapeHtml(line || "—") + "</div></div>";
            }).join("") : "No addresses yet.";
          } else {
            addrBox.textContent = "Address module is off. Add address turns it on.";
          }
        } catch (e) {
          addrBox.textContent = "Addresses are not available until enable-address is on.";
        }
      }
      cards.forEach(function (card) {
        if (card.querySelector("table")) return;
        if (card.closest("[data-panel]") || card.querySelector(".profile-head")) return;
        if (card.textContent.length < 800) {
          card.innerHTML =
            "<p><strong>Mobile:</strong> " + api.escapeHtml(client.mobileNo || "—") + "</p>" +
            "<p><strong>External ID:</strong> " + api.escapeHtml(client.externalId || "—") + "</p>" +
            "<p><strong>Office:</strong> " + api.escapeHtml(client.officeName || "—") + "</p>" +
            "<p><strong>Activation:</strong> " + api.escapeHtml(api.formatDate(client.timeline && client.timeline.activatedOnDate)) + "</p>" +
            "<p><strong>Status:</strong> " + api.escapeHtml(api.statusLabel(client.status)) + "</p>";
        }
      });
    })();
  }

  /* ---------- CLIENT ONBOARD ---------- */
  if (page === "onboard" || location.pathname.match(/client-onboard/)) {
    pageGuard(async function () {
      var template = await api.get("/clients/template");
      var offices = template.officeOptions || [];
      var staff = template.staffOptions || [];
      var genders = template.genderOptions || [];
      var legal = template.clientLegalFormOptions || template.clientTypeOptions || [];

      function fillSelect(labelText, options, valueKey, labelKey) {
        valueKey = valueKey || "id";
        labelKey = labelKey || "name";
        var labels = document.querySelectorAll("label");
        labels.forEach(function (lab) {
          if (lab.textContent.trim().toLowerCase() !== labelText.toLowerCase()) return;
          var sel = lab.parentElement.querySelector("select");
          if (!sel) return;
          sel.innerHTML = options.map(function (o) {
            return "<option value=\"" + o[valueKey] + "\">" + api.escapeHtml(o[labelKey] || o.name || o.value || o.id) + "</option>";
          }).join("");
        });
      }
      fillSelect("Office", offices);
      fillSelect("Staff", staff.length ? staff : [{ id: "", name: "(none)" }]);
      if (genders.length) fillSelect("Gender", genders, "id", "name");

      var wizard = document.querySelector("[data-wizard]");
      if (wizard) {
        wizard.addEventListener("wizard:complete", async function (ev) {
          ev.preventDefault();
          try {
            var inputs = wizard.querySelectorAll("input, select, textarea");
            var map = {};
            inputs.forEach(function (el) {
              var lab = el.closest(".form-row") && el.closest(".form-row").querySelector("label");
              var key = (lab && lab.textContent.trim()) || el.name || "";
              map[key.toLowerCase()] = el.value;
            });
            function val(keys) {
              for (var i = 0; i < keys.length; i++) {
                if (map[keys[i]] !== undefined && map[keys[i]] !== "") return map[keys[i]];
              }
              return "";
            }
            var officeId = Number(val(["office"])) || (offices[0] && offices[0].id);
            var payload = {
              officeId: officeId,
              firstname: val(["first name", "firstname"]),
              lastname: val(["last name", "lastname"]),
              mobileNo: val(["mobile"]),
              externalId: val(["external id"]) || undefined,
              active: true,
              locale: "en",
              dateFormat: "yyyy-MM-dd",
              activationDate: val(["submitted on"]) || new Date().toISOString().slice(0, 10),
              submittedOnDate: val(["submitted on"]) || new Date().toISOString().slice(0, 10),
            };
            if (val(["date of birth"])) payload.dateOfBirth = val(["date of birth"]);
            if (val(["email"])) payload.emailAddress = val(["email"]);
            if (val(["gender"])) payload.genderId = Number(val(["gender"]));
            if (val(["staff"])) payload.staffId = Number(val(["staff"]));
            // legalFormId: 1 = person typically
            payload.legalFormId = 1;
            var res = await api.post("/clients", payload);
            api.toast("Client created #" + (res.clientId || res.resourceId), "success");
            setTimeout(function () {
              location.href = "client-detail.html?id=" + (res.clientId || res.resourceId);
            }, 600);
          } catch (err) {
            api.toast("Create failed: " + (err.message || err), "error");
          }
        });
      }
    })();
  }

  /* ---------- LOANS ---------- */
  if (page === "loans") {
    pageGuard(async function () {
      var tbody = document.querySelector("#loans-table tbody");
      if (!tbody) return;
      tbody.innerHTML = "<tr class=\"loading-row\"><td colspan=\"8\">Loading loans…</td></tr>";
      var data = await api.get("/loans?limit=200&associations=all");
      var items = data.pageItems || [];
      var kpis = document.querySelectorAll(".kpi-value");
      if (kpis[0]) kpis[0].textContent = (data.totalFilteredRecords || items.length).toLocaleString();
      tbody.innerHTML = items.map(function (l) {
        var client = l.clientName || "—";
        var st = api.statusLabel(l.status);
        return "<tr>" +
          "<td class=\"mono\"><a href=\"loan-detail.html?id=" + l.id + "\">" + api.escapeHtml(l.accountNo || String(l.id)) + "</a></td>" +
          "<td><a href=\"client-detail.html?id=" + (l.clientId || "") + "\">" + api.escapeHtml(client) + "</a></td>" +
          "<td>" + api.escapeHtml(l.loanProductName || "") + "</td>" +
          "<td class=\"mono text-right\">" + api.formatMoney(l.principal) + "</td>" +
          "<td class=\"mono text-right\">" + api.formatMoney(l.totalOutstanding) + "</td>" +
          "<td><span class=\"status " + api.statusClass(st) + "\">" + api.escapeHtml(st) + "</span></td>" +
          "<td>" + api.escapeHtml(api.formatDate(l.timeline && l.timeline.disbursementDate)) + "</td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"loan-detail.html?id=" + l.id + "\">View</a></td>" +
          "</tr>";
      }).join("") || "<tr><td colspan=\"8\">No loans</td></tr>";
    })();
  }

  /* ---------- LOAN DETAIL ---------- */
  if (page === "loan-detail" || location.pathname.match(/loan-detail\.html/)) {
    pageGuard(async function () {
      var id = api.qs("id");
      if (!id) { api.toast("Missing ?id=", "error"); return; }
      var loan = await api.get("/loans/" + id + "?associations=all");
      var h1 = document.querySelector(".page-header h1, .content h1");
      if (h1) h1.textContent = "Loan " + (loan.accountNo || id);
      var sub = document.querySelector(".page-sub");
      if (sub) {
        sub.textContent = (loan.clientName || "") + " · " + (loan.loanProductName || "") +
          " · " + api.statusLabel(loan.status);
      }
      var schedule = (loan.repaymentSchedule && loan.repaymentSchedule.periods) || [];
      var txns = loan.transactions || [];
      var tables = document.querySelectorAll("table.data tbody");
      if (tables[0]) {
        tables[0].innerHTML = schedule.filter(function (p) { return p.period; }).map(function (p) {
          return "<tr><td>" + p.period + "</td><td>" + api.formatDate(p.dueDate) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.principalDue) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.interestDue) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.totalDueForPeriod) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(p.totalOutstandingForPeriod) + "</td></tr>";
        }).join("") || "<tr><td colspan=\"6\">No schedule</td></tr>";
      }
      if (tables[1]) {
        tables[1].innerHTML = txns.map(function (t) {
          return "<tr><td>" + api.formatDate(t.date) + "</td><td>" + api.escapeHtml((t.type && t.type.value) || "") +
            "</td><td class=\"mono text-right\">" + api.formatMoney(t.amount) + "</td></tr>";
        }).join("") || "<tr><td colspan=\"3\">No transactions</td></tr>";
      }
    })();
  }

  /* ---------- SAVINGS ---------- */
  if (page === "savings") {
    pageGuard(async function () {
      var tbody = document.querySelector("table.data tbody, #sav tbody, #savings-table tbody");
      if (!tbody) {
        var t = document.querySelector("table.data");
        if (t) tbody = t.querySelector("tbody");
      }
      if (!tbody) return;
      tbody.innerHTML = "<tr class=\"loading-row\"><td colspan=\"7\">Loading savings…</td></tr>";
      var data = await api.get("/savingsaccounts?limit=200");
      var items = data.pageItems || [];
      tbody.innerHTML = items.map(function (s) {
        var st = api.statusLabel(s.status);
        return "<tr>" +
          "<td class=\"mono\"><a href=\"savings-detail.html?id=" + s.id + "\">" + api.escapeHtml(s.accountNo || String(s.id)) + "</a></td>" +
          "<td><a href=\"client-detail.html?id=" + (s.clientId || "") + "\">" + api.escapeHtml(s.clientName || "—") + "</a></td>" +
          "<td>" + api.escapeHtml(s.savingsProductName || "") + "</td>" +
          "<td class=\"mono text-right\">" + api.formatMoney(s.accountBalance) + "</td>" +
          "<td><span class=\"status " + api.statusClass(st) + "\">" + api.escapeHtml(st) + "</span></td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"savings-detail.html?id=" + s.id + "\">View</a></td>" +
          "</tr>";
      }).join("") || "<tr><td colspan=\"6\">No savings accounts</td></tr>";
    })();
  }

  if (page === "savings-detail" || location.pathname.match(/savings-detail\.html/)) {
    pageGuard(async function () {
      var id = api.qs("id");
      if (!id) { api.toast("Missing ?id=", "error"); return; }
      var sav = await api.get("/savingsaccounts/" + id + "?associations=transactions");
      var h1 = document.querySelector(".page-header h1, .content h1");
      if (h1) h1.textContent = "Savings " + (sav.accountNo || id);
      var sub = document.querySelector(".page-sub");
      if (sub) sub.textContent = (sav.clientName || "") + " · " + (sav.savingsProductName || "") + " · " + api.formatMoney(sav.summary && sav.summary.accountBalance);
      var txns = sav.transactions || [];
      var tbody = document.querySelector("table.data tbody");
      if (tbody) {
        tbody.innerHTML = txns.map(function (t) {
          return "<tr><td>" + api.formatDate(t.date) + "</td><td>" + api.escapeHtml((t.transactionType && t.transactionType.value) || "") +
            "</td><td class=\"mono text-right\">" + api.formatMoney(t.amount) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(t.runningBalance) + "</td></tr>";
        }).join("") || "<tr><td colspan=\"4\">No transactions</td></tr>";
      }
    })();
  }

  /* Tellers / cashier cash moved to assets/actions.js */

  /* ---------- ACCOUNTING ---------- */
  if (page === "accounting") {
    pageGuard(async function () {
      var tbody = document.querySelector("#coa-table tbody") || document.querySelector("table.data tbody");
      if (!tbody) return;
      tbody.innerHTML = "<tr class=\"loading-row\"><td colspan=\"6\">Loading GL accounts…</td></tr>";
      var items = await api.get("/glaccounts");
      if (!Array.isArray(items)) items = items.pageItems || [];
      tbody.innerHTML = items.map(function (a) {
        return "<tr>" +
          "<td class=\"mono\">" + api.escapeHtml(a.glCode || "") + "</td>" +
          "<td class=\"strong\">" + api.escapeHtml(a.name || "") + "</td>" +
          "<td>" + api.escapeHtml((a.type && a.type.value) || a.type || "") + "</td>" +
          "<td>" + api.escapeHtml((a.usage && a.usage.value) || a.usage || "") + "</td>" +
          "<td>" + (a.disabled ? "Disabled" : "Enabled") + "</td>" +
          "<td class=\"mono text-right\">" + (a.manualEntriesAllowed ? "Manual" : "System") + "</td>" +
          "</tr>";
      }).join("") || "<tr><td colspan=\"6\">No GL accounts</td></tr>";
    })();
  }

  /* ---------- JOURNALS ---------- */
  if (page === "journals") {
    pageGuard(async function () {
      var tbody = document.querySelector("#je-table tbody") || document.querySelector("table.data tbody");
      if (!tbody) return;
      tbody.innerHTML = "<tr class=\"loading-row\"><td colspan=\"7\">Loading journal entries…</td></tr>";
      var data = await api.get("/journalentries?limit=100&orderBy=id&sortOrder=DESC");
      var items = data.pageItems || (Array.isArray(data) ? data : []);
      tbody.innerHTML = items.map(function (j) {
        return "<tr>" +
          "<td class=\"mono\">" + api.escapeHtml(String(j.transactionId || j.id || "")) + "</td>" +
          "<td>" + api.formatDate(j.transactionDate) + "</td>" +
          "<td>" + api.escapeHtml(j.glAccountName || (j.glAccountId && String(j.glAccountId)) || "") + "</td>" +
          "<td>" + api.escapeHtml(j.officeName || "") + "</td>" +
          "<td class=\"mono text-right\">" + api.formatMoney(j.amount) + "</td>" +
          "<td>" + api.escapeHtml(j.entryType && j.entryType.value ? j.entryType.value : (j.entryType || "")) + "</td>" +
          "<td>" + api.escapeHtml(j.createdByUserName || "") + "</td>" +
          "</tr>";
      }).join("") || "<tr><td colspan=\"7\">No journal entries</td></tr>";
    })();
  }

  /* ---------- OFFICES / STAFF ---------- */
  if (page === "offices") {
    pageGuard(async function () {
      var [offices, staff] = await Promise.all([
        api.get("/offices"),
        api.get("/staff").catch(function () { return []; }),
      ]);
      if (!Array.isArray(offices)) offices = [];
      if (!Array.isArray(staff)) staff = staff.pageItems || [];
      var tables = document.querySelectorAll("table.data tbody");
      if (tables[0]) {
        tables[0].innerHTML = offices.map(function (o) {
          return "<tr><td class=\"mono\">" + o.id + "</td><td class=\"strong\">" + api.escapeHtml(o.name) +
            "</td><td>" + api.escapeHtml(o.nameDecorated || o.parentName || "—") +
            "</td><td>" + api.formatDate(o.openingDate) + "</td></tr>";
        }).join("") || "<tr><td colspan=\"4\">No offices</td></tr>";
      }
      if (tables[1]) {
        tables[1].innerHTML = staff.map(function (s) {
          var name = s.displayName || ((s.firstname || "") + " " + (s.lastname || "")).trim();
          return "<tr><td class=\"mono\">" + s.id + "</td><td class=\"strong\">" + api.escapeHtml(name) +
            "</td><td>" + api.escapeHtml(s.officeName || "") +
            "</td><td>" + (s.isActive ? "Active" : "Inactive") + "</td></tr>";
        }).join("") || "<tr><td colspan=\"4\">No staff</td></tr>";
      }
      if (!tables.length) {
        var content = document.querySelector(".content");
        if (content) {
          var box = document.createElement("div");
          box.className = "card";
          box.innerHTML = "<div class=\"card-h\"><h2>Offices (live)</h2></div><div class=\"card-b table-wrap\"><table class=\"data\"><thead><tr><th>ID</th><th>Name</th><th>Parent</th><th>Opened</th></tr></thead><tbody>" +
            offices.map(function (o) {
              return "<tr><td class=\"mono\">" + o.id + "</td><td>" + api.escapeHtml(o.name) + "</td><td>" +
                api.escapeHtml(o.parentName || "—") + "</td><td>" + api.formatDate(o.openingDate) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
          content.appendChild(box);
        }
      }
    })();
  }

  /* ---------- PRODUCTS ---------- */
  if (page === "products" || location.pathname.match(/products-loans/)) {
    var chargeById = {};
    function asList(data) {
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.pageItems)) return data.pageItems;
      return [];
    }
    function enumText(obj) {
      if (!obj) return "—";
      if (typeof obj === "string" || typeof obj === "number") return String(obj);
      return obj.value || obj.code || "—";
    }
    function currencyCode(obj) {
      if (!obj) return "";
      if (obj.currency && obj.currency.code) return obj.currency.code;
      return obj.currencyCode || "";
    }
    function chargeAmount(c) {
      var calcId = c.chargeCalculationType && c.chargeCalculationType.id;
      var code = currencyCode(c);
      if (String(calcId) === "1") {
        var n = Number(c.amount);
        var shown = isFinite(n) ? n.toLocaleString("en-UG", { maximumFractionDigits: 2 }) : String(c.amount);
        return (code ? code + " " : "") + shown;
      }
      return String(c.amount) + "%";
    }
    function renderLoanProducts(loans) {
      var grid = document.getElementById("loan-products");
      if (!grid) return;
      if (!loans.length) {
        grid.innerHTML = '<p class="empty-hint">No loan products yet. Use ＋ Loan product.</p>';
        return;
      }
      grid.innerHTML = loans.map(function (p) {
        var code = currencyCode(p);
        var rate = p.interestRatePerPeriod != null ? (p.interestRatePerPeriod + "% / period") : "—";
        return '<div class="product-card"><h3>' + api.escapeHtml(p.name) + "</h3>" +
          '<div class="text-muted" style="font-size:12px">' + api.escapeHtml(p.shortName || "—") +
          (code ? " · " + api.escapeHtml(code) : "") + "</div>" +
          '<div class="rate">' + api.escapeHtml(String(rate)) + "</div>" +
          "<div>Principal " + api.formatMoney(p.principal, code || "UGX") + "</div>" +
          '<div class="text-muted" style="margin-top:6px;font-size:12px">' +
          api.escapeHtml(String(p.numberOfRepayments || "—")) + " repayments</div>" +
          '<div style="margin-top:10px"><button class="btn btn-sm btn-ghost" type="button" data-edit-loan="' +
          api.escapeHtml(p.id) + '">Edit</button></div></div>';
      }).join("");
    }
    function renderSavingsProducts(savings) {
      var tbody = document.querySelector("#savings-products tbody");
      if (!tbody) return;
      tbody.innerHTML = savings.map(function (p) {
        return "<tr><td class=\"strong\">" + api.escapeHtml(p.name) + "</td><td class=\"mono\">" +
          api.escapeHtml(p.shortName || "—") + "</td><td>" + api.escapeHtml(currencyCode(p) || "—") +
          '</td><td class="mono text-right">' + api.escapeHtml(String(p.nominalAnnualInterestRate != null ? p.nominalAnnualInterestRate : "—")) +
          '%</td><td><button class="btn btn-sm btn-ghost" type="button" data-edit-savings="' + api.escapeHtml(p.id) +
          '">Edit</button></td></tr>';
      }).join("") || '<tr><td colspan="5">No savings products yet. Use ＋ Savings product.</td></tr>';
    }
    function renderCharges(charges) {
      var tbody = document.querySelector("#charges-table tbody");
      if (!tbody) return;
      chargeById = {};
      charges.forEach(function (c) { chargeById[String(c.id)] = c; });
      tbody.innerHTML = charges.map(function (c) {
        var appliesId = c.chargeAppliesTo && c.chargeAppliesTo.id;
        var canEdit = String(appliesId) === "1" || String(appliesId) === "2";
        return "<tr><td class=\"strong\">" + api.escapeHtml(c.name) + "</td><td>" + api.escapeHtml(enumText(c.chargeAppliesTo)) +
          "</td><td>" + api.escapeHtml(enumText(c.chargeTimeType)) + "</td><td>" + api.escapeHtml(enumText(c.chargeCalculationType)) +
          '</td><td class="mono text-right">' + api.escapeHtml(chargeAmount(c)) + "</td><td>" +
          (c.active === false ? '<span class="status closed">Inactive</span>' : '<span class="status active">Active</span>') +
          "</td><td>" + (canEdit ? '<button type="button" class="btn btn-sm btn-ghost" data-edit-charge="' + api.escapeHtml(c.id) + '">Edit</button>' : "—") +
          "</td></tr>";
      }).join("") || '<tr><td colspan="7">No charges yet. Use ＋ Charge.</td></tr>';
    }
    function renderFloating(rates) {
      var tbody = document.querySelector("#floating-table tbody");
      if (!tbody) return;
      if (rates === null) {
        tbody.innerHTML = '<tr><td colspan="4">Floating rates could not be loaded.</td></tr>';
        return;
      }
      tbody.innerHTML = rates.map(function (r) {
        return "<tr><td class=\"strong\">" + api.escapeHtml(r.name || "") + "</td><td>" +
          (r.isBaseLendingRate ? "Base" : "—") + "</td><td>" + (r.isActive === false ? "Inactive" : "Active") +
          '</td><td><button class="btn btn-sm btn-ghost" type="button" data-edit-rate="' + api.escapeHtml(r.id) +
          '">Edit</button></td></tr>';
      }).join("") || '<tr><td colspan="4">No floating rates</td></tr>';
    }
    function putRows(id, html, cols) {
      var tb = document.getElementById(id);
      if (tb) tb.innerHTML = html || '<tr><td colspan="' + cols + '">None yet</td></tr>';
    }
    function depositRow(p) {
      return "<tr><td class=\"mono\">" + api.escapeHtml(p.id) + "</td><td class=\"strong\">" + api.escapeHtml(p.name) +
        "</td><td>" + api.escapeHtml(p.shortName || "") +
        "</td><td class=\"mono text-right\">" + api.formatMoney(p.depositAmount || p.minDepositAmount) + "</td></tr>";
    }
    async function loadProductScreen() {
      var results = await Promise.all([
        api.get("/loanproducts"),
        api.get("/savingsproducts").catch(function () { return []; }),
        api.get("/charges").catch(function () { return []; }),
        api.get("/floatingrates").catch(function () { return null; }),
        api.get("/products/share").catch(function () { return []; }),
        api.get("/fixeddepositproducts").catch(function () { return []; }),
        api.get("/recurringdepositproducts").catch(function () { return []; })
      ]);
      renderLoanProducts(asList(results[0]));
      renderSavingsProducts(asList(results[1]));
      renderCharges(asList(results[2]));
      renderFloating(results[3] === null ? null : asList(results[3]));
      var shares = asList(results[4]);
      putRows("share-products", shares.map(function (p) {
        return "<tr><td class=\"mono\">" + api.escapeHtml(p.id) + "</td><td class=\"strong\">" + api.escapeHtml(p.name) +
          "</td><td>" + api.escapeHtml(p.shortName || "") +
          "</td><td class=\"mono text-right\">" + api.formatMoney(p.unitPrice) + "</td></tr>";
      }).join(""), 4);
      putRows("fd-products", asList(results[5]).map(depositRow).join(""), 4);
      putRows("rd-products", asList(results[6]).map(depositRow).join(""), 4);
    }
    window.PivotProducts = {
      reload: loadProductScreen,
      getCharge: function (id) { return chargeById[String(id)] || null; }
    };
    pageGuard(loadProductScreen)();
  }

  /* journal POST moved to assets/actions.js */
})();
