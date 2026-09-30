/* Pivosacc Mobile — views + navigation */
(function () {
  "use strict";
  if (!MobileAPI.requireAuth()) return;

  var state = { bundle: null, rail: "mtn", view: "home" };

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function tickClock() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    $("#clock").textContent = h + ":" + (m < 10 ? "0" : "") + m;
  }
  tickClock();
  setInterval(tickClock, 30000);

  function greeting() {
    var h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  function showView(name) {
    state.view = name;
    $all(".view").forEach(function (el) {
      el.classList.toggle("active", el.id === "view-" + name);
    });
    $all(".tab").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-nav") === name);
    });
    var boot = $("#boot");
    if (boot) boot.style.display = "none";
    window.scrollTo(0, 0);
    var content = $("#content");
    if (content) content.scrollTop = 0;
  }

  function txnIcon(isIn) {
    if (isIn) {
      return '<div class="txn-ico in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>';
    }
    return '<div class="txn-ico out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></div>';
  }

  function renderHome(b) {
    var first = (b.client.firstname || b.client.displayName || "Member").split(" ")[0];
    $("#greet").innerHTML = greeting() + ", <strong>" + first + "</strong>";
    $("#homeBal").textContent = MobileAPI.fmtMoney(b.available != null ? b.available : b.balance, b.currency);
    var savNo = (b.primarySavings && b.primarySavings.accountNo) || "—";
    $("#homeSav").textContent = "Savings · " + savNo;
    $("#homeOffice").textContent = b.client.officeName || b.sess.clientOffice || "—";
    $("#avatarBtn").textContent = MobileAPI.initials(b.client.displayName);

    var txns = (b.transactions || []).slice().reverse().slice(0, 5);
    var box = $("#homeTxns");
    if (!txns.length) {
      box.innerHTML = '<div class="empty">No recent transactions yet.</div>';
      return;
    }
    box.innerHTML = txns.map(function (t) {
      var type = (t.transactionType && t.transactionType.value) || "Transaction";
      var isDeposit = !!(t.transactionType && (t.transactionType.deposit || /deposit/i.test(type)));
      var isWithdrawal = !!(t.transactionType && (t.transactionType.withdrawal || /withdraw/i.test(type)));
      var isIn = isDeposit || (!isWithdrawal && Number(t.amount) > 0 && /deposit|credit|interest/i.test(type));
      if (!isDeposit && !isWithdrawal) {
        // Fineract: deposits have running balance increase; use entry type
        isIn = !!(t.transactionType && (t.transactionType.deposit || t.transactionType.interestPosting));
        if (t.transactionType && t.transactionType.withdrawal) isIn = false;
      }
      var amt = Number(t.amount) || 0;
      var signed = isIn ? amt : -amt;
      return (
        '<div class="txn"><div class="txn-left">' + txnIcon(isIn) +
        '<div><div class="name">' + type + '</div><div class="meta">' +
        MobileAPI.fmtDate(t.date) + '</div></div></div>' +
        '<div class="amt ' + (isIn ? "in" : "out") + '">' + MobileAPI.fmtAmt(signed) + "</div></div>"
      );
    }).join("");
  }

  function renderStatement(b) {
    var sav = b.primarySavings || {};
    var bal = b.available != null ? b.available : b.balance;
    $("#stmtCard").innerHTML =
      '<div class="row"><span>Member</span><strong>' + (b.client.displayName || "—") + "</strong></div>" +
      '<div class="row"><span>Account</span><strong>' + (sav.accountNo || "—") + "</strong></div>" +
      '<div class="row"><span>Product</span><strong>' + (sav.productName || sav.savingsProductName || "Savings") + "</strong></div>" +
      '<div class="row"><span>Balance</span><strong>' + MobileAPI.fmtMoney(bal, b.currency) + "</strong></div>" +
      '<span class="badge">Active · Fineract</span>';

    var txns = (b.transactions || []).slice().reverse();
    var box = $("#stmtLines");
    if (!txns.length) {
      box.innerHTML = '<div class="empty">No ledger movements on this account.</div>';
      return;
    }
    box.innerHTML = txns.map(function (t) {
      var type = (t.transactionType && t.transactionType.value) || "Transaction";
      var isIn = !!(t.transactionType && (t.transactionType.deposit || t.transactionType.interestPosting));
      if (t.transactionType && t.transactionType.withdrawal) isIn = false;
      var amt = Number(t.amount) || 0;
      var signed = isIn ? amt : -amt;
      return (
        '<div class="stmt-line"><div><div>' + type + '</div><div class="d">' +
        MobileAPI.fmtDate(t.date) + '</div></div><div class="a ' + (isIn ? "in" : "") + '">' +
        MobileAPI.fmtAmt(signed) + "</div></div>"
      );
    }).join("");
  }

  function renderLoans(b) {
    var box = $("#loansList");
    var loans = b.loans || [];
    if (!loans.length) {
      box.innerHTML = '<div class="empty">No loans on this member yet.</div>';
      return;
    }
    box.innerHTML = loans.map(function (loan) {
      var status = (loan.status && loan.status.value) || "—";
      var statusClass = /active/i.test(status) ? "" : "warn";
      var product = loan.loanProductName || "Loan";
      var accountNo = loan.accountNo || ("#" + loan.id);
      var summary = loan.summary || {};
      var outstanding = summary.totalOutstanding != null ? summary.totalOutstanding
        : (loan.principal != null ? loan.principal : 0);
      var principal = loan.principal || summary.principalDisbursed || outstanding;
      var paid = Math.max(0, Number(principal) - Number(outstanding));
      var pct = principal > 0 ? Math.min(100, Math.round((paid / principal) * 100)) : 0;
      var periods = (loan.repaymentSchedule && loan.repaymentSchedule.periods) || [];
      var upcoming = periods.filter(function (p) {
        return p.complete === false && p.period;
      }).slice(0, 3);
      var schedHtml = upcoming.length
        ? upcoming.map(function (p, idx) {
            var due = MobileAPI.fmtDate(p.dueDate);
            var total = Number(p.totalDueForPeriod != null ? p.totalDueForPeriod : p.totalOriginalDueForPeriod) || 0;
            return (
              '<div class="sched' + (idx === 0 ? " next" : "") + '"><div><strong>' +
              (idx === 0 ? "Next instalment" : "Instalment " + p.period) +
              '</strong><div class="due">Due ' + due + '</div></div>' +
              '<div class="amt-mono">' + MobileAPI.fmtMoney(total, b.currency).replace(/^UGX /, "UGX ") + "</div></div>"
            );
          }).join("")
        : '<div class="empty" style="margin-top:8px">No repayment schedule available.</div>';

      return (
        '<div class="loan-hero">' +
        '<div class="status-pill ' + statusClass + '">' + status + "</div>" +
        "<h3>" + product + "</h3>" +
        '<div class="page-sub" style="margin:0 0 4px">Account ' + accountNo + "</div>" +
        '<div class="lbl" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-family:IBM Plex Mono,monospace">Outstanding</div>' +
        '<div class="big">' + MobileAPI.fmtMoney(outstanding, b.currency) + "</div>" +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        '<div class="page-sub" style="margin:0">' + pct + "% of principal cleared · Principal " +
        MobileAPI.fmtMoney(principal, b.currency) + "</div></div>" +
        '<div class="section-title">Schedule</div>' + schedHtml +
        '<button type="button" class="cta" style="margin-top:12px" data-repay="' + loan.id + '">Repay with MoMo / Airtel</button>' +
        '<span class="phase-badge">Phase 1 · payment rails</span>'
      );
    }).join("");

    $all("[data-repay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        MobileAPI.toast("Loan repayment via MoMo/Airtel is Phase 1 — UI ready.", "warn");
      });
    });
  }

  function renderProfile(b) {
    $("#profileHead").innerHTML =
      '<div class="profile-av">' + MobileAPI.initials(b.client.displayName) + "</div>" +
      "<div><h3>" + (b.client.displayName || "—") + "</h3>" +
      '<div class="meta">Member #' + (b.client.accountNo || b.client.id) + " · " +
      (b.client.officeName || "") + "</div>" +
      '<div class="meta">' + (b.client.mobileNo || b.sess.clientMobile || "No mobile on file") + "</div></div>";
    $("#authModeTxt").textContent =
      "Staff + client demo · " + (b.sess.username || "mifos") + " → client #" + b.sess.clientId;
  }

  function renderAll() {
    var b = state.bundle;
    if (!b) return;
    renderHome(b);
    renderStatement(b);
    renderLoans(b);
    renderProfile(b);
  }

  async function boot() {
    try {
      state.bundle = await MobileAPI.loadMemberBundle();
      $("#liveChip").textContent = "LIVE";
      $("#liveChip").className = "live-chip";
      renderAll();
      var hash = (location.hash || "#home").replace("#", "") || "home";
      if (!document.getElementById("view-" + hash)) hash = "home";
      showView(hash);

      // Prefill phone from client
      var phone = state.bundle.client.mobileNo || "";
      if (phone) $("#depPhone").value = phone;
    } catch (ex) {
      $("#boot").textContent = "Could not load member data: " + (ex.message || ex);
      $("#liveChip").textContent = "OFFLINE";
      $("#liveChip").className = "live-chip demo-chip";
      MobileAPI.toast(ex.message || String(ex), "err");
    }
  }

  // Nav
  $all("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () {
      var name = el.getAttribute("data-nav");
      location.hash = name;
      showView(name);
    });
  });
  $("#avatarBtn").addEventListener("click", function () {
    location.hash = "profile";
    showView("profile");
  });
  window.addEventListener("hashchange", function () {
    var name = (location.hash || "#home").replace("#", "") || "home";
    if (document.getElementById("view-" + name)) showView(name);
  });

  // Deposit rails
  function selectRail(rail) {
    state.rail = rail;
    $all(".rail").forEach(function (el) {
      var on = el.getAttribute("data-rail") === rail;
      el.classList.toggle("selected", on);
      var chk = el.querySelector(".check");
      if (chk) {
        chk.className = on ? "check" : "check empty";
        chk.textContent = on ? "✓" : "";
      }
    });
  }
  $all(".rail").forEach(function (el) {
    el.addEventListener("click", function () { selectRail(el.getAttribute("data-rail")); });
  });
  $all("#depChips .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      $all("#depChips .chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      $("#depAmount").value = chip.getAttribute("data-amt");
    });
  });
  $("#depConfirm").addEventListener("click", function () {
    var amt = String($("#depAmount").value || "").replace(/[^\d]/g, "");
    var phone = $("#depPhone").value || "";
    if (!amt || Number(amt) <= 0) {
      MobileAPI.toast("Enter a valid amount.", "err");
      return;
    }
    if (!phone) {
      MobileAPI.toast("Enter the MoMo / Airtel phone number.", "err");
      return;
    }
    var railName = state.rail === "airtel" ? "Airtel Money" : "MTN MoMo";
    MobileAPI.toast(
      railName + " deposit of UGX " + Number(amt).toLocaleString() +
      " is UI-ready. Live collection = Phase 1.",
      "warn"
    );
  });

  $("#stmtShare").addEventListener("click", function () {
    MobileAPI.toast("Share statement — coming with member channel hardening.", "warn");
  });
  $("#stmtPdf").addEventListener("click", function () {
    MobileAPI.toast("PDF download — coming with member channel hardening.", "warn");
  });
  $("#chgPin").addEventListener("click", function () {
    MobileAPI.toast("Demo PIN is 1234. Member PIN store is Phase 1.", "warn");
  });
  $("#logoutBtn").addEventListener("click", function () { MobileAPI.logout(); });

  boot();
})();
