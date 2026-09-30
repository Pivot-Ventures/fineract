/* Pivot SACCO Desk — shared UI helpers */
(function () {
  "use strict";

  function toast(msg, kind) {
    if (window.FineractAPI && FineractAPI.toast) return FineractAPI.toast(msg, kind);
    var area = document.querySelector(".toast-area");
    if (!area) {
      area = document.createElement("div");
      area.className = "toast-area";
      document.body.appendChild(area);
    }
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(function () { el.remove(); }, 2800);
  }
  window.pivotToast = toast;

  var page = document.body.getAttribute("data-page");
  if (page) {
    document.querySelectorAll(".nav-link[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === page) a.classList.add("active");
    });
  }

  var toggle = document.querySelector("[data-toggle-sidebar]");
  var sidebar = document.querySelector(".sidebar");
  if (toggle && sidebar) {
    toggle.addEventListener("click", function () {
      sidebar.classList.toggle("open");
    });
  }

  document.querySelectorAll("[data-tabs]").forEach(function (root) {
    var tabs = root.querySelectorAll(".tab");
    var panels = root.querySelectorAll(".tab-panel");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        tabs.forEach(function (t) { t.classList.toggle("active", t === tab); });
        panels.forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-panel") === id);
        });
      });
    });
  });

  document.querySelectorAll("[data-mock]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      if (btn.getAttribute("data-wired") === "1") return;
      e.preventDefault();
      toast("Not wired yet: " + (btn.getAttribute("data-mock") || "Action"));
    });
  });

  document.querySelectorAll("[data-table-search]").forEach(function (input) {
    var table = document.querySelector(input.getAttribute("data-table-search"));
    if (!table) return;
    input.addEventListener("input", function () {
      var q = input.value.toLowerCase().trim();
      table.querySelectorAll("tbody tr").forEach(function (tr) {
        tr.style.display = !q || tr.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
      });
    });
  });

  document.querySelectorAll("[data-wizard]").forEach(function (root) {
    var steps = root.querySelectorAll(".wizard-steps li");
    var panels = root.querySelectorAll(".wizard-panel");
    function go(i) {
      steps.forEach(function (s, idx) {
        s.classList.toggle("active", idx === i);
        s.classList.toggle("done", idx < i);
      });
      panels.forEach(function (p, idx) {
        p.classList.toggle("active", idx === i);
      });
      root.setAttribute("data-step", String(i));
    }
    root.querySelectorAll("[data-wizard-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(root.getAttribute("data-step") || "0", 10);
        if (i < panels.length - 1) go(i + 1);
        else {
          var ev = new CustomEvent("wizard:complete", { cancelable: true });
          if (root.dispatchEvent(ev) !== false && !ev.defaultPrevented) {
            toast("Wizard complete");
          }
        }
      });
    });
    root.querySelectorAll("[data-wizard-prev]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = parseInt(root.getAttribute("data-step") || "0", 10);
        if (i > 0) go(i - 1);
      });
    });
    steps.forEach(function (s, idx) {
      s.style.cursor = "pointer";
      s.addEventListener("click", function () { go(idx); });
    });
    go(0);
  });

  document.querySelectorAll("[data-print]").forEach(function (btn) {
    btn.addEventListener("click", function () { window.print(); });
  });
})();
