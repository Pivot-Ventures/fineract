/* Pivot SACCO Desk — shared shell: auth guard, topbar, nav, tabs, wizard */
(function () {
  "use strict";
  var api = window.FineractAPI;
  var page = document.body.getAttribute("data-page") || "";
  var isLogin = page === "login";

  if (!api) return;

  /* Every app page requires a live session. */
  if (!isLogin) {
    if (!api.requireAuth()) {
      document.body.classList.add("auth-pending");
      return;
    }
    api.startSessionTimers();
  }

  var sess = api.getSession() || {};

  /* PR #8 — Payments middleware Overview link */
  var sidebarNav = document.querySelector(".sidebar-nav");
  if (sidebarNav && !sidebarNav.querySelector("[data-nav='payments']")) {
    var overview = sidebarNav.querySelector(".nav-group");
    if (overview) {
      var paymentsLink = document.createElement("a");
      paymentsLink.className = "nav-link";
      paymentsLink.setAttribute("data-nav", "payments");
      paymentsLink.href = "/payments/docs";
      paymentsLink.target = "_blank";
      paymentsLink.rel = "noopener";
      paymentsLink.innerHTML = "<span class=\"nav-icon\">💳</span> Payments middleware";
      overview.appendChild(paymentsLink);
    }
  }

  /* ---------- nav ---------- */
  if (page) {
    document.querySelectorAll(".nav-link[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === page) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      }
    });
  }

  var toggle = document.querySelector("[data-toggle-sidebar]");
  var sidebar = document.querySelector(".sidebar");
  if (toggle && sidebar) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", function () {
      var open = sidebar.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---------- topbar: office, user, logout, global search ---------- */
  if (!isLogin) {
    var office = document.getElementById("office-chip");
    if (office && sess.officeName) {
      office.textContent = "Office: " + sess.officeName;
      office.hidden = false;
    }
    var avatar = document.getElementById("user-avatar");
    if (avatar) avatar.textContent = api.initials(sess.username || "");
    var uname = document.getElementById("user-name");
    if (uname) uname.textContent = sess.username || "";
    var foot = document.getElementById("sidebar-tenant");
    if (foot) foot.textContent = "Tenant: " + (sess.tenantId || api.DEFAULT_TENANT) + " · " + (sess.username || "");
    var logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", function () { api.logout(); });

    var gs = document.getElementById("global-search");
    if (gs) {
      api.typeahead(gs, {
        fetch: function (q) {
          return api.searchEntities(q, "clients,loans,savings").then(function (rows) {
            return rows.slice(0, 25).map(function (r) {
              var t = String(r.entityType || "").toUpperCase();
              var href = t === "LOAN" ? "loan-detail.html?id=" : (t.indexOf("SAVING") === 0 ? "savings-detail.html?id=" : "client-detail.html?id=");
              var kind = t === "LOAN" ? "Loan" : (t.indexOf("SAVING") === 0 ? "Savings" : "Member");
              var label = t === "CLIENT" ? r.entityName : (r.entityAccountNo + " · " + (r.parentName || ""));
              return {
                value: r.entityId, label: label,
                sub: kind + " · #" + (r.entityAccountNo || r.entityId) + (t === "CLIENT" ? "" : " · " + (r.entityName || "")) + " · " + api.statusLabel(r.entityStatus),
                href: href + encodeURIComponent(r.entityId)
              };
            });
          });
        },
        onSelect: function (item) { location.href = item.href; }
      });
    }
  }

  /* ---------- permission-gated controls ---------- */
  document.querySelectorAll("[data-perm]").forEach(function (el) {
    var codes = el.getAttribute("data-perm").split(/\s+/).filter(Boolean);
    if (codes.length && !api.can(codes)) el.hidden = true;
  });

  /* ---------- features that are intentionally not available yet ---------- */
  document.querySelectorAll("[data-unavailable]").forEach(function (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.title = btn.getAttribute("data-unavailable") || "Not available yet";
  });

  /* ---------- tabs ---------- */
  document.querySelectorAll("[data-tabs]").forEach(function (root) {
    var tabs = root.querySelectorAll(".tab");
    var panels = root.querySelectorAll(".tab-panel");
    root.querySelector(".tabs") && root.querySelector(".tabs").setAttribute("role", "tablist");
    tabs.forEach(function (tab) {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", tab.classList.contains("active") ? "true" : "false");
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        tabs.forEach(function (t) {
          t.classList.toggle("active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        panels.forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-panel") === id);
        });
      });
    });
  });

  /* ---------- wizard ----------
   * Fires "wizard:beforenext" (cancelable, detail.step) before leaving a step and
   * "wizard:complete" (cancelable, detail.button) on the last step.
   */
  document.querySelectorAll("[data-wizard]").forEach(function (root) {
    var steps = root.querySelectorAll(".wizard-steps li");
    var panels = root.querySelectorAll(".wizard-panel");
    var nextBtns = root.querySelectorAll("[data-wizard-next]");
    function current() { return parseInt(root.getAttribute("data-step") || "0", 10); }
    function go(i) {
      steps.forEach(function (s, idx) {
        s.classList.toggle("active", idx === i);
        s.classList.toggle("done", idx < i);
        if (idx === i) s.setAttribute("aria-current", "step");
        else s.removeAttribute("aria-current");
      });
      panels.forEach(function (p, idx) { p.classList.toggle("active", idx === i); });
      root.setAttribute("data-step", String(i));
      nextBtns.forEach(function (b) {
        b.textContent = i === panels.length - 1 ? (b.getAttribute("data-final-label") || "Submit") : "Continue";
      });
      root.dispatchEvent(new CustomEvent("wizard:step", { detail: { step: i } }));
    }
    function canLeave(i) {
      var ev = new CustomEvent("wizard:beforenext", { cancelable: true, detail: { step: i } });
      return root.dispatchEvent(ev) && !ev.defaultPrevented;
    }
    nextBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var i = current();
        if (!canLeave(i)) return;
        if (i < panels.length - 1) go(i + 1);
        else root.dispatchEvent(new CustomEvent("wizard:complete", { cancelable: true, detail: { button: btn } }));
      });
    });
    root.querySelectorAll("[data-wizard-prev]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = current();
        if (i > 0) go(i - 1);
      });
    });
    go(0);
  });

  document.querySelectorAll("[data-print]").forEach(function (btn) {
    btn.addEventListener("click", function () { window.print(); });
  });
})();
