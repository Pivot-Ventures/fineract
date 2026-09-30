/* Pivosacc Mobile — views + navigation */
(function () {
  "use strict";
  if (!MobileAPI.requireAuth()) return;

  var state = {
    bundle: null,
    rail: "mtn",
    wdRail: "mtn",
    view: "home",
    xferMode: "internal",
    billMode: "mock",
    billBiller: { id: "nwsc", label: "NWSC Water" },
    repayMode: "ledger",
    repayLoanId: null,
    xferTarget: null,
  };

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
    var tabMap = { home: "home", transfer: "transfer", bills: "bills", more: "more" };
    var tabName = tabMap[name] || (
      /^(deposit|withdraw|statement|loans|repay|notifications|help|profile)$/.test(name) ? "more" : name
    );
    $all(".tab").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-nav") === tabName);
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

  function isTxnIn(t) {
    var type = (t.transactionType && t.transactionType.value) || "";
    if (t.transactionType && t.transactionType.deposit) return true;
    if (t.transactionType && t.transactionType.interestPosting) return true;
    if (t.transactionType && t.transactionType.withdrawal) return false;
    return /deposit|credit|interest/i.test(type);
  }

  function fillSavingsSelect(sel, details, opts) {
    opts = opts || {};
    if (!sel) return;
    var list = details || [];
    if (!list.length) {
      sel.innerHTML = '<option value="">No active savings</option>';
      return;
    }
    sel.innerHTML = list.map(function (s) {
      return '<option value="' + s.id + '">' +
        (s.productName || "Savings") + " · " + (s.accountNo || s.id) +
        " · " + MobileAPI.fmtMoney(s.available, s.currency) +
        "</option>";
    }).join("");
    if (opts.preferId) sel.value = String(opts.preferId);
  }

  function renderHome(b) {
    var first = (b.client.firstname || b.client.displayName || "Member").split(" ")[0];
    $("#greet").innerHTML = greeting() + ", <strong>" + first + "</strong>";
    $("#homeBal").textContent = MobileAPI.fmtMoney(b.available != null ? b.available : b.balance, b.currency);
    var n = (b.savingsDetails || []).length;
    $("#homeSavCount").textContent = n + " account" + (n === 1 ? "" : "s");
    $("#homeOffice").textContent = b.client.officeName || b.sess.clientOffice || "—";
    $("#avatarBtn").textContent = MobileAPI.initials(b.client.displayName);

    var accBox = $("#homeAccounts");
    var details = b.savingsDetails || [];
    if (!details.length) {
      accBox.innerHTML = '<div class="empty">No savings accounts yet.</div>';
    } else {
      accBox.innerHTML = details.map(function (s) {
        return (
          '<div class="acct-card">' +
          '<div class="acct-top"><strong>' + (s.productName || "Savings") + "</strong>" +
          '<span class="acct-status">' + (s.status || "") + "</span></div>" +
          '<div class="acct-no">' + (s.accountNo || "—") + "</div>" +
          '<div class="acct-bal">' + MobileAPI.fmtMoney(s.available, s.currency) + "</div>" +
          '<div class="acct-meta">Available · ledger balance ' +
          MobileAPI.fmtMoney(s.balance, s.currency) + "</div></div>"
        );
      }).join("") +
        '<div class="acct-total"><span>Total available</span><strong>' +
        MobileAPI.fmtMoney(b.available, b.currency) + "</strong></div>";
    }

    var txns = (b.allTransactions || b.transactions || []).slice(0, 5);
    var box = $("#homeTxns");
    if (!txns.length) {
      box.innerHTML = '<div class="empty">No recent transactions yet.</div>';
      return;
    }
    box.innerHTML = txns.map(function (t) {
      var type = (t.transactionType && t.transactionType.value) || "Transaction";
      var isIn = isTxnIn(t);
      var amt = Number(t.amount) || 0;
      var signed = isIn ? amt : -amt;
      var meta = MobileAPI.fmtDate(t.date) + (t._accountNo ? " · " + t._accountNo : "");
      return (
        '<div class="txn"><div class="txn-left">' + txnIcon(isIn) +
        '<div><div class="name">' + type + '</div><div class="meta">' + meta +
        '</div></div></div>' +
        '<div class="amt ' + (isIn ? "in" : "out") + '">' + MobileAPI.fmtAmt(signed) + "</div></div>"
      );
    }).join("");
  }

  function renderStatement(b) {
    var details = b.savingsDetails || [];
    var filter = $("#stmtFilter");
    var cur = filter.value || "all";
    filter.innerHTML = '<option value="all">All accounts</option>' + details.map(function (s) {
      return '<option value="' + s.id + '">' + (s.productName || "Savings") + " · " + s.accountNo + "</option>";
    }).join("");
    if (cur && (cur === "all" || details.some(function (s) { return String(s.id) === cur; }))) {
      filter.value = cur;
    }

    var sav = details[0] || {};
    $("#stmtCard").innerHTML =
      '<div class="row"><span>Member</span><strong>' + (b.client.displayName || "—") + "</strong></div>" +
      '<div class="row"><span>Accounts</span><strong>' + details.length + "</strong></div>" +
      '<div class="row"><span>Total available</span><strong>' + MobileAPI.fmtMoney(b.available, b.currency) + "</strong></div>" +
      (sav.accountNo ? '<div class="row"><span>Primary</span><strong>' + sav.accountNo + "</strong></div>" : "") +
      '<span class="badge">Active · Fineract</span>';

    var sid = filter.value;
    var txns = (b.allTransactions || []).slice();
    if (sid && sid !== "all") {
      txns = txns.filter(function (t) { return String(t._savingsId) === String(sid); });
    }
    var box = $("#stmtLines");
    if (!txns.length) {
      box.innerHTML = '<div class="empty">No ledger movements on this selection.</div>';
      return;
    }
    box.innerHTML = txns.map(function (t) {
      var type = (t.transactionType && t.transactionType.value) || "Transaction";
      var isIn = isTxnIn(t);
      var amt = Number(t.amount) || 0;
      var signed = isIn ? amt : -amt;
      var d = MobileAPI.fmtDate(t.date) + (t._accountNo ? " · " + t._accountNo : "");
      return (
        '<div class="stmt-line"><div><div>' + type + '</div><div class="d">' + d +
        '</div></div><div class="a ' + (isIn ? "in" : "") + '">' +
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
              '<div class="amt-mono">' + MobileAPI.fmtMoney(total, b.currency) + "</div></div>"
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
        '<button type="button" class="cta" style="margin-top:12px" data-open-repay="' + loan.id +
        '">Repay from app</button>' +
        '<span class="phase-badge">MoMo rail optional · Phase 1</span>'
      );
    }).join("");

    $all("[data-open-repay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openRepay(btn.getAttribute("data-open-repay"));
      });
    });
  }

  function openRepay(loanId) {
    state.repayLoanId = loanId;
    var b = state.bundle;
    var loan = (b.loans || []).filter(function (l) { return String(l.id) === String(loanId); })[0];
    if (!loan) {
      MobileAPI.toast("Loan not found.", "err");
      return;
    }
    var status = (loan.status && loan.status.value) || "—";
    var summary = loan.summary || {};
    var outstanding = summary.totalOutstanding != null ? summary.totalOutstanding
      : (loan.principal != null ? loan.principal : 0);
    $("#repayCard").innerHTML =
      '<div class="row"><span>Product</span><strong>' + (loan.loanProductName || "Loan") + "</strong></div>" +
      '<div class="row"><span>Account</span><strong>' + (loan.accountNo || loan.id) + "</strong></div>" +
      '<div class="row"><span>Status</span><strong>' + status + "</strong></div>" +
      '<div class="row"><span>Outstanding</span><strong>' + MobileAPI.fmtMoney(outstanding, b.currency) + "</strong></div>";
    var suggest = outstanding > 0 ? Math.min(Number(outstanding), 50000) : 50000;
    $("#repayAmount").value = String(Math.round(suggest));
    location.hash = "repay";
    showView("repay");
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

  function populateSelectors() {
    var b = state.bundle;
    if (!b) return;
    var details = b.savingsDetails || [];
    fillSavingsSelect($("#xferFrom"), details);
    fillSavingsSelect($("#xferToOwn"), details);
    fillSavingsSelect($("#billFrom"), details);
    fillSavingsSelect($("#wdFrom"), details);
    // Prefer different to-own when possible
    if (details.length > 1 && $("#xferToOwn")) {
      $("#xferToOwn").value = String(details[1].id);
    }
    var phone = b.client.mobileNo || "";
    if (phone) {
      if ($("#depPhone") && !$("#depPhone").value) $("#depPhone").value = phone;
      if ($("#wdPhone") && !$("#wdPhone").value) $("#wdPhone").value = phone;
    }
  }

  function renderAll() {
    var b = state.bundle;
    if (!b) return;
    renderHome(b);
    renderStatement(b);
    renderLoans(b);
    renderProfile(b);
    populateSelectors();
  }

  async function refreshBundle() {
    state.bundle = await MobileAPI.loadMemberBundle();
    renderAll();
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
    } catch (ex) {
      $("#boot").textContent = "Could not load member data: " + (ex.message || ex);
      $("#liveChip").textContent = "OFFLINE";
      $("#liveChip").className = "live-chip demo-chip";
      MobileAPI.toast(ex.message || String(ex), "err");
    }
  }

  // Nav
  function bindNav(el) {
    el.addEventListener("click", function () {
      var name = el.getAttribute("data-nav");
      if (!name) return;
      location.hash = name;
      showView(name);
    });
  }
  $all("[data-nav]").forEach(bindNav);
  $("#avatarBtn").addEventListener("click", function () {
    location.hash = "profile";
    showView("profile");
  });
  window.addEventListener("hashchange", function () {
    var name = (location.hash || "#home").replace("#", "") || "home";
    if (document.getElementById("view-" + name)) showView(name);
  });

  // Chip helpers
  function bindChips(rootSel, inputSel) {
    $all(rootSel + " .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        $all(rootSel + " .chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        $(inputSel).value = chip.getAttribute("data-amt");
      });
    });
  }
  bindChips("#depChips", "#depAmount");
  bindChips("#xferChips", "#xferAmount");
  bindChips("#billChips", "#billAmount");
  bindChips("#wdChips", "#wdAmount");

  // Deposit rails
  function selectRail(rail) {
    state.rail = rail;
    $all("#view-deposit .rail").forEach(function (el) {
      var on = el.getAttribute("data-rail") === rail;
      el.classList.toggle("selected", on);
      var chk = el.querySelector(".check");
      if (chk) {
        chk.className = on ? "check" : "check empty";
        chk.textContent = on ? "✓" : "";
      }
    });
  }
  $all("#view-deposit .rail").forEach(function (el) {
    el.addEventListener("click", function () { selectRail(el.getAttribute("data-rail")); });
  });
  $("#depConfirm").addEventListener("click", function () {
    var amt = String($("#depAmount").value || "").replace(/[^\d]/g, "");
    var phone = $("#depPhone").value || "";
    if (!amt || Number(amt) <= 0) { MobileAPI.toast("Enter a valid amount.", "err"); return; }
    if (!phone) { MobileAPI.toast("Enter the MoMo / Airtel phone number.", "err"); return; }
    var railName = state.rail === "airtel" ? "Airtel Money" : "MTN MoMo";
    MobileAPI.toast(
      railName + " deposit of UGX " + Number(amt).toLocaleString() +
      " is UI-ready. Live collection = Phase 1.",
      "warn"
    );
  });

  // Withdraw rails
  function selectWdRail(rail) {
    state.wdRail = rail;
    $all("#view-withdraw .rail").forEach(function (el) {
      var on = el.getAttribute("data-wd-rail") === rail;
      el.classList.toggle("selected", on);
      var chk = el.querySelector(".check");
      if (chk) {
        chk.className = on ? "check" : "check empty";
        chk.textContent = on ? "✓" : "";
      }
    });
  }
  $all("#view-withdraw .rail").forEach(function (el) {
    el.addEventListener("click", function () { selectWdRail(el.getAttribute("data-wd-rail")); });
  });
  $("#wdConfirm").addEventListener("click", function () {
    var amt = String($("#wdAmount").value || "").replace(/[^\d]/g, "");
    var phone = $("#wdPhone").value || "";
    if (!amt || Number(amt) <= 0) { MobileAPI.toast("Enter a valid amount.", "err"); return; }
    if (!phone) { MobileAPI.toast("Enter the destination phone.", "err"); return; }
    if (!$("#wdFrom").value) { MobileAPI.toast("Select a savings account.", "err"); return; }
    var railName = state.wdRail === "airtel" ? "Airtel Money" : "MTN MoMo";
    MobileAPI.toast(
      railName + " withdrawal of UGX " + Number(amt).toLocaleString() +
      " is UI-ready. Live payout = Phase 1.",
      "warn"
    );
  });

  // Transfer modes
  $all("#xferModes .mode-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      state.xferMode = tab.getAttribute("data-xfer-mode");
      $all("#xferModes .mode-tab").forEach(function (t) {
        t.classList.toggle("active", t === tab);
      });
      $("#xferInternalBlock").style.display = state.xferMode === "internal" ? "" : "none";
      $("#xferMemberBlock").style.display = state.xferMode === "member" ? "" : "none";
    });
  });

  $("#xferSearchBtn").addEventListener("click", async function () {
    var q = $("#xferLookup").value;
    var hitsBox = $("#xferHits");
    hitsBox.innerHTML = '<div class="empty">Searching…</div>';
    $("#xferToSavWrap").style.display = "none";
    state.xferTarget = null;
    try {
      var hits = await MobileAPI.searchClients(q);
      if (!hits.length) {
        hitsBox.innerHTML = '<div class="empty">No members matched. Try 000000002 (Okello James).</div>';
        return;
      }
      hitsBox.innerHTML = hits.map(function (c) {
        return '<button type="button" class="hit" data-cid="' + c.id + '" data-office="' +
          (c.officeId || 1) + '"><strong>' + c.displayName + "</strong><span>#" +
          c.accountNo + (c.mobileNo ? " · " + c.mobileNo : "") + "</span></button>";
      }).join("");
      $all("#xferHits .hit").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          $all("#xferHits .hit").forEach(function (h) { h.classList.remove("selected"); });
          btn.classList.add("selected");
          var cid = btn.getAttribute("data-cid");
          var office = btn.getAttribute("data-office") || "1";
          try {
            var savs = await MobileAPI.getClientSavings(cid);
            if (!savs.length) {
              MobileAPI.toast("That member has no active savings.", "err");
              return;
            }
            state.xferTarget = { clientId: cid, officeId: office };
            $("#xferToMember").innerHTML = savs.map(function (s) {
              return '<option value="' + s.id + '">' +
                (s.productName || s.savingsProductName || "Savings") + " · " +
                (s.accountNo || s.id) + "</option>";
            }).join("");
            $("#xferToSavWrap").style.display = "";
          } catch (ex) {
            MobileAPI.toast(ex.message || String(ex), "err");
          }
        });
      });
    } catch (ex) {
      hitsBox.innerHTML = '<div class="empty">' + (ex.message || ex) + "</div>";
    }
  });

  $("#xferConfirm").addEventListener("click", async function () {
    var amt = String($("#xferAmount").value || "").replace(/[^\d.]/g, "");
    var fromId = $("#xferFrom").value;
    var note = $("#xferNote").value || "Pivosacc mobile transfer";
    var toId, toClientId, toOfficeId;
    var sess = MobileAPI.getSession();
    if (state.xferMode === "internal") {
      toId = $("#xferToOwn").value;
      toClientId = sess.clientId;
      toOfficeId = sess.officeId || 1;
    } else {
      if (!state.xferTarget) { MobileAPI.toast("Find and select a member first.", "err"); return; }
      toId = $("#xferToMember").value;
      toClientId = state.xferTarget.clientId;
      toOfficeId = state.xferTarget.officeId;
    }
    if (!fromId || !toId) { MobileAPI.toast("Select from and to accounts.", "err"); return; }
    if (!amt || Number(amt) <= 0) { MobileAPI.toast("Enter a valid amount.", "err"); return; }
    var btn = $("#xferConfirm");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await MobileAPI.accountTransfer({
        fromAccountId: fromId,
        toAccountId: toId,
        toClientId: toClientId,
        toOfficeId: toOfficeId,
        fromClientId: sess.clientId,
        fromOfficeId: sess.officeId || 1,
        amount: amt,
        description: note,
      });
      MobileAPI.toast("Transfer posted to Fineract · UGX " + Number(amt).toLocaleString(), "ok");
      await refreshBundle();
    } catch (ex) {
      MobileAPI.toast(ex.message || String(ex), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Send transfer";
    }
  });

  // Bills
  $all("#billerGrid .biller").forEach(function (el) {
    el.addEventListener("click", function () {
      $all("#billerGrid .biller").forEach(function (b) { b.classList.remove("selected"); });
      el.classList.add("selected");
      state.billBiller = { id: el.getAttribute("data-biller"), label: el.getAttribute("data-label") };
      var labels = {
        nwsc: "Meter / NWSC account",
        umeme: "Yaka / meter number",
        dstv: "Smartcard / decoder",
        school: "Student / admission ID",
      };
      $("#billRefLabel").textContent = labels[state.billBiller.id] || "Reference";
    });
  });
  $all("#billPayModes .mode-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      state.billMode = tab.getAttribute("data-bill-mode");
      $all("#billPayModes .mode-tab").forEach(function (t) {
        t.classList.toggle("active", t === tab);
      });
    });
  });
  $("#billConfirm").addEventListener("click", async function () {
    var amt = String($("#billAmount").value || "").replace(/[^\d]/g, "");
    var ref = ($("#billRef").value || "").trim();
    var fromId = $("#billFrom").value;
    var label = (state.billBiller && state.billBiller.label) || "Utility";
    if (!amt || Number(amt) <= 0) { MobileAPI.toast("Enter a valid amount.", "err"); return; }
    if (!ref) { MobileAPI.toast("Enter the biller reference.", "err"); return; }
    if (state.billMode === "mock") {
      MobileAPI.toast(
        "Paid " + label + " · ref " + ref + " · UGX " + Number(amt).toLocaleString() +
        " (Phase 1 UI — MoMo later)",
        "ok"
      );
      return;
    }
    if (!fromId) { MobileAPI.toast("Select a savings account.", "err"); return; }
    var btn = $("#billConfirm");
    btn.disabled = true;
    btn.textContent = "Posting…";
    try {
      var note = "Utility · " + label + " · " + ref;
      await MobileAPI.savingsWithdrawal({
        savingsId: fromId,
        amount: amt,
        note: note,
        receiptNumber: "UTIL-" + (state.billBiller.id || "BILL").toUpperCase() + "-" + ref.slice(0, 12),
        paymentTypeId: 1,
      });
      MobileAPI.toast("Ledger withdrawal tagged: " + note, "ok");
      await refreshBundle();
    } catch (ex) {
      MobileAPI.toast(ex.message || String(ex), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Pay bill";
    }
  });

  // Loan repay
  $all("#repayModes .mode-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      state.repayMode = tab.getAttribute("data-repay-mode");
      $all("#repayModes .mode-tab").forEach(function (t) {
        t.classList.toggle("active", t === tab);
      });
    });
  });
  $("#repayConfirm").addEventListener("click", async function () {
    var amt = String($("#repayAmount").value || "").replace(/[^\d.]/g, "");
    if (!state.repayLoanId) { MobileAPI.toast("No loan selected.", "err"); return; }
    if (!amt || Number(amt) <= 0) { MobileAPI.toast("Enter a valid amount.", "err"); return; }
    if (state.repayMode === "momo") {
      MobileAPI.toast("Loan repay via MoMo/Airtel is Phase 1 — UI ready.", "warn");
      return;
    }
    var btn = $("#repayConfirm");
    btn.disabled = true;
    btn.textContent = "Posting…";
    try {
      await MobileAPI.loanRepayment({
        loanId: state.repayLoanId,
        amount: amt,
        note: "Pivosacc mobile repayment",
      });
      MobileAPI.toast("Repayment posted · UGX " + Number(amt).toLocaleString(), "ok");
      await refreshBundle();
      location.hash = "loans";
      showView("loans");
    } catch (ex) {
      MobileAPI.toast(ex.message || String(ex), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit repayment";
    }
  });

  $("#stmtFilter").addEventListener("change", function () {
    if (state.bundle) renderStatement(state.bundle);
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
  $("#helpCall").addEventListener("click", function () {
    MobileAPI.toast("Demo support line — not a live dialler.", "warn");
  });

  boot();
})();
