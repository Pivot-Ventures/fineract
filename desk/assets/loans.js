/* ===== LOANS =====
 * Pivot SACCO Desk — loan lifecycle against live Fineract.
 * Loaded only by loans.html, loan-apply.html, loan-detail.html and collections.html.
 *   loan-apply   : application wizard with product limits, purpose, charges and a schedule preview
 *   loan-detail  : approve / reject / undo, disburse (cash, mobile money, bank, to savings), repay (cash or
 *                  from savings), pay off, waive, charges, write-off, recovery, guarantors, collateral, receipts
 *   collections  : loans in arrears with days overdue, ageing and portfolio at risk
 */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;

  var page = document.body.getAttribute("data-page") || "";
  var esc = api.escapeHtml;
  var DATE = { locale: "en", dateFormat: "yyyy-MM-dd" };

  function notifyAlert(event) {
    try {
      if (window.TransactionalAlerts) window.TransactionalAlerts.notify(event);
    } catch (e) { /* Fineract already posted; alerts must not block the desk */ }
  }

  function $(id) { return document.getElementById(id); }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function refresh() { document.dispatchEvent(new CustomEvent("desk:refresh")); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function money(v) { return api.formatMoney(v); }
  function idOf(o) { return o && (o.id !== undefined ? o.id : o); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v === null || v === undefined || v === "" ? "—" : String(v); }
  function enc(v) { return encodeURIComponent(v); }

  /* ---------- readable Fineract errors ---------- */
  var ERROR_TEXT = {
    "min.self.guarantee.required": "The borrower's own savings must guarantee at least {v}. Add an own-savings guarantee on the Guarantors tab.",
    "min.external.guarantee.required": "Other members must guarantee at least {v}. Add a member guarantor on the Guarantors tab.",
    "mandated.guarantee.required": "Total guarantees must be at least {v} before this loan can be approved.",
    "insufficient.balance": "The guarantor's savings account does not have enough available balance for this guarantee.",
    "not.active": "The guarantor's savings account is not active.",
    "charge.payment.mode.not.account.transfer": "This charge is collected with the member's repayments; it cannot be paid on its own. Post a repayment instead, or waive it.",
    "not.in.submitted.and.pending.approval.stage": "This can only be changed while the loan is pending approval.",
    "transaction.amount.exceeds": "The amount is more than what is owed on this loan."
  };
  function argValue(e) {
    var out = "";
    (e.args || []).forEach(function (a) {
      var v = a && a.value;
      if (Array.isArray(v)) v = v[0];
      if (typeof v === "number") out = money(v);
    });
    return out;
  }
  function friendly(err) {
    if (!err || err.status === 401) return err;
    var errors = (err.data && err.data.errors) || [];
    var msgs = errors.map(function (e) {
      var code = String(e.userMessageGlobalisationCode || "");
      for (var key in ERROR_TEXT) {
        if (code.indexOf(key) >= 0) return ERROR_TEXT[key].replace("{v}", argValue(e) || "the required amount");
      }
      var m = e.defaultUserMessage || e.developerMessage || "";
      if (/^Failed data validation due to: /.test(m)) m = m.replace(/^Failed data validation due to: /, "Not allowed: ").replace(/\.$/, "").replace(/\./g, " ");
      if (e.parameterName && m === e.parameterName) m = "Invalid value for " + e.parameterName;
      return m;
    }).filter(Boolean);
    if (!msgs.length) return err;
    var out = new Error(msgs.filter(function (m, i) { return msgs.indexOf(m) === i; }).join(" "));
    out.status = err.status;
    out.data = err.data;
    return out;
  }
  function call(promise) { return promise.catch(function (e) { throw friendly(e); }); }
  function post(path, body) { return call(api.post(path, body)); }
  function fail(err) { if (err && err.status !== 401) api.toast(friendly(err).message || String(err), "error"); }

  /* Click handler with a busy guard so a double click cannot start two flows. */
  function on(el, fn) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.getAttribute("aria-busy") === "true") return;
      el.setAttribute("aria-busy", "true");
      Promise.resolve().then(function () { return fn(el); }).catch(fail).then(function () { el.removeAttribute("aria-busy"); });
    });
  }
  function button(label, cls, fn, title) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + cls;
    b.textContent = label;
    if (title) b.title = title;
    on(b, fn);
    return b;
  }
  function optionLabel(field, value) {
    var o = (field.options || []).filter(function (x) { return String(x.value) === String(value); })[0];
    return o ? o.label : String(value);
  }
  function dateField(label, key) {
    return { key: key || "date", label: label || "Date", type: "date", required: true, value: api.todayISO(), max: api.todayISO() };
  }
  function amountField(label, help) {
    return { key: "amount", label: label || "Amount (UGX)", amount: true, required: true, help: help || "" };
  }
  function noteField(label, required) {
    return { key: "note", label: label || "Note", type: required ? "textarea" : "text", required: !!required, placeholder: required ? "" : "optional" };
  }
  function daysBetween(fromIso, toIso) {
    var a = Date.parse(fromIso + "T00:00:00Z"), b = Date.parse(toIso + "T00:00:00Z");
    return isNaN(a) || isNaN(b) ? 0 : Math.round((b - a) / 86400000);
  }
  function ageBucket(days) {
    if (days <= 0) return "";
    if (days <= 30) return "1–30 days";
    if (days <= 60) return "31–60 days";
    if (days <= 90) return "61–90 days";
    return "Over 90 days";
  }
  var productCache = {};
  function loanProduct(id) {
    if (!productCache[id]) productCache[id] = api.get("/loanproducts/" + enc(id));
    return productCache[id];
  }
  var MIGRATED = /\(migrated\)\s*$/i;
  function chargeCollected(c) { return (c.chargeTimeType && c.chargeTimeType.value) || ""; }
  function isPercent(c) { return c.chargeCalculationType && c.chargeCalculationType.id !== 1; }

  /* Payment types for real money moves: the legacy "Migration" type is only for the cut-over load. */
  async function payField() {
    var f = await api.paymentTypeField();
    f.options = f.options.filter(function (o) { return !/^migration$/i.test(String(o.label)); });
    if (!f.options.some(function (o) { return String(o.value) === String(f.value); })) f.value = f.options[0] ? String(f.options[0].value) : "";
    return f;
  }

  /* Savings accounts of a member that are active, with their available balance. */
  async function memberSavings(clientId) {
    var acc = await api.get("/clients/" + enc(clientId) + "/accounts?fields=savingsAccounts");
    var list = (acc.savingsAccounts || []).filter(function (s) { return s.status && s.status.active; });
    return Promise.all(list.map(function (s) {
      return api.get("/savingsaccounts/" + enc(s.id)).then(function (full) {
        var sum = full.summary || {};
        return { id: s.id, accountNo: s.accountNo, productName: s.productName, balance: num(sum.accountBalance),
          available: sum.availableBalance !== undefined ? num(sum.availableBalance) : num(sum.accountBalance) };
      });
    }));
  }
  function savingsLabel(s) {
    return "#" + s.accountNo + " · " + s.productName + " · available " + money(s.available);
  }

  /* ================================================================ LOAN APPLICATION */
  if (page === "loan-apply") {
    var wiz = $("loan-wizard");
    var la = { client: null, tmpl: null, product: null, preview: null, extra: [] };
    var laErr = function (msg) { var el = $("la-error"); el.textContent = msg || ""; el.hidden = !msg; };
    var clientInput = $("la-client");
    var productSel = $("la-product");
    $("la-submitted").value = api.todayISO();
    $("la-submitted").max = api.todayISO();
    $("la-disbursement").value = api.todayISO();

    var limits = function () {
      var p = (la.tmpl && la.tmpl.product) || {};
      return {
        minP: p.minPrincipal, maxP: p.maxPrincipal,
        minN: p.minNumberOfRepayments, maxN: p.maxNumberOfRepayments,
        minR: p.minInterestRatePerPeriod, maxR: p.maxInterestRatePerPeriod
      };
    };
    var has = function (v) { return v !== undefined && v !== null; };
    /* Live validation of the terms: returns the first problem, and marks each field. */
    var checkTerms = function (mark) {
      var L = limits();
      var problems = {};
      var p = api.parseAmount($("la-principal").value);
      if (!(p > 0)) problems.principal = "Enter a whole number of UGX (e.g. 2,000,000).";
      else if (has(L.minP) && p < L.minP) problems.principal = "Minimum for this product is " + money(L.minP) + ".";
      else if (has(L.maxP) && p > L.maxP) problems.principal = "Maximum for this product is " + money(L.maxP) + ".";
      var n = Number($("la-repayments").value);
      if (!Number.isInteger(n) || n < 1) problems.repayments = "Enter a whole number of repayments.";
      else if (has(L.minN) && n < L.minN) problems.repayments = "At least " + L.minN + " repayments for this product.";
      else if (has(L.maxN) && n > L.maxN) problems.repayments = "At most " + L.maxN + " repayments for this product.";
      var rRaw = $("la-interest").value;
      var r = Number(rRaw);
      if (rRaw === "" || isNaN(r) || r < 0) problems.interest = "Enter the interest rate per period.";
      else if (has(L.minR) && r < L.minR) problems.interest = "Lowest rate for this product is " + L.minR + "%.";
      else if (has(L.maxR) && r > L.maxR) problems.interest = "Highest rate for this product is " + L.maxR + "%.";
      if (mark) {
        [["principal", "la-principal", has(L.minP) ? "Allowed: " + money(L.minP) + " – " + money(L.maxP) : ""],
          ["repayments", "la-repayments", has(L.minN) ? "Allowed: " + L.minN + " – " + L.maxN : ""],
          ["interest", "la-interest", has(L.minR) ? (L.minR === L.maxR ? "Fixed at " + L.minR + "%" : "Allowed: " + L.minR + "% – " + L.maxR + "%") : ""]
        ].forEach(function (f) {
          var input = $(f[1]), help = $(f[1] + "-help");
          var bad = problems[f[0]] && (input.value !== "" || mark === "all");
          input.setAttribute("aria-invalid", bad ? "true" : "false");
          if (help) { help.textContent = bad ? problems[f[0]] : f[2]; help.classList.toggle("is-error", !!bad); }
        });
      }
      return problems.principal || problems.repayments || problems.interest || "";
    };
    ["la-principal", "la-repayments", "la-interest"].forEach(function (id) {
      $(id).addEventListener("input", function () { la.preview = null; checkTerms(true); paintCharges(); });
    });

    var estimate = function (c) {
      var calc = c.chargeCalculationType && c.chargeCalculationType.id;
      var p = api.parseAmount($("la-principal").value);
      if (calc === 1) return num(c.amount);
      if (calc === 2 && p > 0) return Math.round(p * num(c.amount) / 100);
      return null;
    };
    var chargeRows = function () {
      var t = la.tmpl || {};
      return (t.charges || []).map(function (c) { return { c: c, def: true }; }).concat(la.extra.map(function (c) { return { c: c, def: false }; }));
    };
    var paintCharges = function () {
      var tb = document.querySelector("#la-charges tbody");
      if (!la.tmpl) { tb.innerHTML = api.emptyRow(5, "Choose a member and product first."); return; }
      var rows = chargeRows();
      var checked = {};
      tb.querySelectorAll("input[data-charge]").forEach(function (cb) { checked[cb.getAttribute("data-charge")] = cb.checked; });
      tb.innerHTML = rows.map(function (r, i) {
        var c = r.c;
        var key = (c.chargeId || c.id) + ":" + i;
        var on_ = checked[key] !== undefined ? checked[key] : true;
        var est = estimate(c);
        return '<tr><td><input type="checkbox" id="la-ch-' + i + '" data-charge="' + esc(key) + '"' + (on_ ? " checked" : "") +
          ' /><label class="sr-only" for="la-ch-' + i + '">Include ' + esc(c.name) + "</label></td><td>" + esc(c.name) +
          (r.def ? ' <span class="text-muted">(product default)</span>' : "") + "</td><td>" + esc(chargeCollected(c)) +
          '</td><td class="mono text-right">' + (isPercent(c) ? esc(c.amount) + "%" : money(c.amount)) +
          '</td><td class="mono text-right">' + (est === null ? "—" : money(est)) + "</td></tr>";
      }).join("") || api.emptyRow(5, "This product has no default charges.");
      tb.querySelectorAll("input[data-charge]").forEach(function (cb) { cb.addEventListener("change", function () { la.preview = null; }); });
    };
    var selectedCharges = function () {
      var rows = chargeRows();
      var out = [];
      document.querySelectorAll("#la-charges input[data-charge]").forEach(function (cb, i) {
        if (!cb.checked || !rows[i]) return;
        var c = rows[i].c;
        var ch = { chargeId: c.chargeId || c.id, amount: c.amount };
        if (c.chargeTimeType && c.chargeTimeType.id === 2) ch.dueDate = c.dueDate ? api.formatDate(c.dueDate) : $("la-disbursement").value;
        out.push(ch);
      });
      return out;
    };
    on($("la-add-charge-btn"), function () {
      var sel = $("la-add-charge");
      var opt = ((la.tmpl && la.tmpl.chargeOptions) || []).filter(function (c) { return String(c.id) === sel.value; })[0];
      if (!opt) { api.toast("Choose a charge to add.", "error"); return; }
      la.extra.push(opt);
      la.preview = null;
      sel.value = "";
      paintCharges();
    });

    var paintProductNote = async function () {
      var note = $("la-product-note");
      note.hidden = true;
      if (!productSel.value) return;
      var prod = await loanProduct(productSel.value);
      la.product = prod;
      var g = prod.productGuaranteeData;
      if (prod.holdGuaranteeFunds && g) {
        note.textContent = "Guarantee required before approval: " + num(g.mandatoryGuarantee) + "% of the loan (at least " +
          num(g.minimumGuaranteeFromOwnFunds) + "% from the member's own savings and " + num(g.minimumGuaranteeFromGuarantor) +
          "% from other members). Guarantors are added on the loan page after submitting.";
        note.hidden = false;
      }
    };

    var loadTemplate = async function () {
      la.tmpl = null;
      la.preview = null;
      la.extra = [];
      if (!la.client || !productSel.value) { paintCharges(); return; }
      var t = await api.get("/loans/template?templateType=individual&clientId=" + enc(la.client.id) + "&productId=" + enc(productSel.value));
      la.tmpl = t;
      $("la-repayments").value = t.numberOfRepayments || "";
      $("la-interest").value = t.interestRatePerPeriod !== undefined ? t.interestRatePerPeriod : "";
      var L = limits();
      $("la-interest").readOnly = has(L.minR) && L.minR === L.maxR;
      var unit = ((t.repaymentFrequencyType && t.repaymentFrequencyType.value) || "").toLowerCase();
      $("la-frequency").value = ((t.repaymentEvery || 1) === 1 ? "Every " + unit.replace(/s$/, "") : "Every " + t.repaymentEvery + " " + unit) +
        " · rate " + ((t.interestRateFrequencyType && t.interestRateFrequencyType.value) || "").toLowerCase();
      $("la-amortization").value = [(t.amortizationType && t.amortizationType.value), (t.interestType && t.interestType.value)].filter(Boolean).join(" · ");
      var officers = t.loanOfficerOptions || [];
      $("la-officer").innerHTML = '<option value="">— None —</option>' + officers.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (String(o.id) === String(t.loanOfficerId || "") ? " selected" : "") + ">" + esc(o.displayName) + "</option>";
      }).join("");
      $("la-purpose").innerHTML = '<option value="">— Not specified —</option>' + (t.loanPurposeOptions || []).map(function (o) {
        return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
      }).join("");
      var links = t.accountLinkingOptions || [];
      var preferred = links.length === 1 ? links[0] : links.filter(function (s) { return /voluntary/i.test(s.productName || ""); })[0];
      $("la-link-savings").innerHTML = '<option value="">— None —</option>' + links.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (s === preferred ? " selected" : "") + ">#" + esc(s.accountNo) + " · " + esc(s.productName || "") + "</option>";
      }).join("");
      $("la-add-charge").innerHTML = '<option value="">— Add another charge —</option>' + (t.chargeOptions || []).filter(function (c) {
        return !c.penalty && !/migrat/i.test(c.name || "") && c.active !== false;
      }).map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + " (" + esc(chargeCollected(c)) + ")</option>";
      }).join("");
      checkTerms(true);
      paintCharges();
    };

    var reload = function () { Promise.all([loadTemplate(), paintProductNote()]).catch(fail); };
    api.typeahead(clientInput, {
      fetch: api.searchClients,
      onInput: function () { la.client = null; $("la-client-note").textContent = "Choose a member from the search results."; },
      onSelect: function (item) {
        la.client = { id: item.value, name: item.label };
        clientInput.value = item.label;
        $("la-client-note").textContent = "Selected: " + item.label + " (" + item.sub + ")";
        reload();
      }
    });
    productSel.addEventListener("change", reload);
    ["la-disbursement", "la-first-repayment"].forEach(function (id) { $(id).addEventListener("change", function () { la.preview = null; }); });

    (async function () {
      var products = await api.get("/loanproducts");
      /* "(migrated)" products only hold loans loaded from the legacy system; never offer them for new lending. */
      var list = (Array.isArray(products) ? products : []).filter(function (p) {
        return !MIGRATED.test(p.name || "") && (!p.status || /active/i.test(p.status));
      });
      productSel.innerHTML = '<option value="">— Select product —</option>' + list.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>";
      }).join("");
      var pre = api.qs("clientId");
      if (pre) {
        var c = await api.get("/clients/" + enc(pre));
        var name = c.displayName || ((c.firstname || "") + " " + (c.lastname || "")).trim();
        la.client = { id: c.id, name: name };
        clientInput.value = name;
        $("la-client-note").textContent = "Selected: " + name + " (#" + (c.accountNo || c.id) + ")";
      }
    })().catch(fail);

    var validateStep = function (step) {
      if (step === 0) {
        if (!la.client) return "Choose a member from the search results.";
        if (!productSel.value) return "Choose a loan product.";
        if (!api.isISODate($("la-submitted").value)) return "Enter the submitted date.";
        if ($("la-submitted").value > api.todayISO()) return "Submitted date cannot be in the future.";
        if (!la.tmpl) return "Loading product terms… try again in a moment.";
      }
      if (step === 1) {
        var problem = checkTerms("all");
        if (problem) return problem;
        if (!api.isISODate($("la-disbursement").value)) return "Enter the expected disbursement date.";
        if ($("la-disbursement").value < $("la-submitted").value) return "Expected disbursement cannot be before the submitted date.";
        var first = $("la-first-repayment").value;
        if (first && first <= $("la-disbursement").value) return "First repayment must be after the expected disbursement date.";
      }
      return "";
    };
    var buildBody = function () {
      var t = la.tmpl;
      var n = Number($("la-repayments").value);
      var every = t.repaymentEvery || 1;
      var body = withDate({
        clientId: Number(la.client.id), productId: Number(productSel.value), principal: api.parseAmount($("la-principal").value),
        loanTermFrequency: n * every, loanTermFrequencyType: idOf(t.repaymentFrequencyType),
        numberOfRepayments: n, repaymentEvery: every, repaymentFrequencyType: idOf(t.repaymentFrequencyType),
        interestRatePerPeriod: Number($("la-interest").value), amortizationType: idOf(t.amortizationType), interestType: idOf(t.interestType),
        interestCalculationPeriodType: idOf(t.interestCalculationPeriodType),
        transactionProcessingStrategyCode: t.transactionProcessingStrategyCode,
        expectedDisbursementDate: $("la-disbursement").value, submittedOnDate: $("la-submitted").value, loanType: "individual"
      });
      if ($("la-officer").value) body.loanOfficerId = Number($("la-officer").value);
      if ($("la-purpose").value) body.loanPurposeId = Number($("la-purpose").value);
      if ($("la-link-savings").value) body.linkAccountId = Number($("la-link-savings").value);
      if ($("la-first-repayment").value) body.repaymentsStartingFromDate = $("la-first-repayment").value;
      var charges = selectedCharges();
      if (charges.length) body.charges = charges;
      return body;
    };
    var paintPreview = async function () {
      var tb = document.querySelector("#la-schedule tbody");
      tb.innerHTML = api.loadingRow(7, "Calculating schedule…");
      var s = await post("/loans?command=calculateLoanSchedule", buildBody());
      la.preview = s;
      tb.innerHTML = (s.periods || []).map(function (p) {
        var fees = num(p.feeChargesDue) + num(p.penaltyChargesDue);
        if (!p.period) {
          return '<tr class="total-row"><td>—</td><td>' + esc(api.formatDate(p.dueDate)) + '</td><td colspan="2">Disbursement ' + money(p.principalDisbursed) +
            '</td><td class="mono text-right">' + money(fees) + '</td><td class="mono text-right">' + money(p.totalDueForPeriod) +
            '</td><td class="mono text-right">' + money(p.principalLoanBalanceOutstanding) + "</td></tr>";
        }
        return "<tr><td>" + esc(p.period) + "</td><td>" + esc(api.formatDate(p.dueDate)) + '</td><td class="mono text-right">' + money(p.principalDue) +
          '</td><td class="mono text-right">' + money(p.interestDue) + '</td><td class="mono text-right">' + money(fees) +
          '</td><td class="mono text-right">' + money(p.totalDueForPeriod) + '</td><td class="mono text-right">' + money(p.principalLoanBalanceOutstanding) + "</td></tr>";
      }).join("") || api.emptyRow(7, "No schedule returned.");
      setText("la-review-interest", money(s.totalInterestCharged));
      setText("la-review-fees", money(num(s.totalFeeChargesCharged) + num(s.totalPenaltyChargesCharged)));
      setText("la-review-total", money(s.totalRepaymentExpected));
    };
    wiz.addEventListener("wizard:beforenext", function (ev) {
      var problem = validateStep(ev.detail.step);
      laErr(problem);
      if (problem) ev.preventDefault();
    });
    wiz.addEventListener("wizard:step", function (ev) {
      if (ev.detail.step !== 3) return;
      $("la-review-client").textContent = la.client ? la.client.name : "—";
      $("la-review-product").textContent = productSel.options[productSel.selectedIndex] ? productSel.options[productSel.selectedIndex].text : "—";
      var p = api.parseAmount($("la-principal").value);
      $("la-review-principal").textContent = money(p);
      $("la-review-term").textContent = $("la-repayments").value + " × " + $("la-frequency").value.split(" · ")[0].toLowerCase() + " at " + $("la-interest").value + "%";
      $("la-review-disb").textContent = $("la-disbursement").value;
      var g = la.product && la.product.holdGuaranteeFunds && la.product.productGuaranteeData;
      var gNote = $("la-review-guarantee");
      gNote.hidden = !g;
      if (g) {
        gNote.textContent = "Before approval, add guarantees of " + money(Math.ceil(p * num(g.mandatoryGuarantee) / 100)) + ": at least " +
          money(Math.ceil(p * num(g.minimumGuaranteeFromOwnFunds) / 100)) + " from the member's own savings and " +
          money(Math.ceil(p * num(g.minimumGuaranteeFromGuarantor) / 100)) + " from other members.";
      }
      laErr("");
      paintPreview().catch(function (err) {
        la.preview = null;
        document.querySelector("#la-schedule tbody").innerHTML = api.emptyRow(7, "Could not calculate the schedule.");
        laErr(friendly(err).message);
      });
    });
    wiz.addEventListener("wizard:complete", async function (ev) {
      var btn = ev.detail.button;
      var problem = validateStep(0) || validateStep(1);
      if (problem) { laErr(problem); return; }
      if (!la.preview) { laErr("The schedule preview is out of date or failed — go Back and Continue again to recalculate it."); return; }
      laErr("");
      btn.disabled = true;
      btn.textContent = "Submitting…";
      try {
        var created = await post("/loans", buildBody());
        var loanId = created.loanId || created.resourceId;
        api.toast("Loan application submitted", "success");
        location.href = "loan-detail.html?id=" + enc(loanId);
      } catch (err) {
        laErr(err.message || String(err));
        btn.disabled = false;
        btn.textContent = "Submit application";
      }
    });
  }

  /* ================================================================ LOAN DETAIL */
  if (page === "loan-detail") {
    var current = null;
    var guarantors = [];
    var product = null;
    var done = function (msg) { return function (r) { if (r) { api.toast(msg, "success"); refresh(); } }; };
    var principalOf = function (loan) { return loan.approvedPrincipal || loan.principal || loan.proposedPrincipal; };
    var loanPath = function (suffix) { return "/loans/" + enc(current.id) + (suffix || ""); };
    var who = function () { return [["Member", current.clientName], ["Loan", "#" + current.accountNo + " · " + current.loanProductName]]; };

    /* ---------- guarantee coverage ---------- */
    var coverage = function () {
      var g = product && product.holdGuaranteeFunds && product.productGuaranteeData;
      if (!g || !current) return null;
      var principal = num(current.status && current.status.pendingApproval ? (current.proposedPrincipal || current.principal) : current.principal);
      var self = 0, ext = 0;
      guarantors.forEach(function (gr) {
        if (gr.status === false) return;
        (gr.guarantorFundingDetails || []).forEach(function (f) {
          var st = String((f.status && f.status.code) || "");
          if (!/active|withdrawn|completed/i.test(st)) return;
          var amt = num(f.amount) - num(f.amountTransfered);
          var isSelf = gr.guarantorType && gr.guarantorType.id === 1 && String(gr.entityId) === String(current.clientId);
          if (isSelf) self += amt; else ext += amt;
        });
      });
      var needSelf = principal * num(g.minimumGuaranteeFromOwnFunds) / 100;
      var needExt = principal * num(g.minimumGuaranteeFromGuarantor) / 100;
      var needTotal = principal * num(g.mandatoryGuarantee) / 100;
      return { self: self, ext: ext, total: self + ext, needSelf: needSelf, needExt: needExt, needTotal: needTotal,
        ok: self >= needSelf && ext >= needExt && self + ext >= needTotal };
    };
    var coverageProblem = function () {
      var c = coverage();
      if (!c || c.ok) return "";
      var parts = [];
      if (c.self < c.needSelf) parts.push("own savings " + money(c.self) + " of " + money(c.needSelf));
      if (c.ext < c.needExt) parts.push("member guarantors " + money(c.ext) + " of " + money(c.needExt));
      if (c.total < c.needTotal) parts.push("total " + money(c.total) + " of " + money(c.needTotal));
      return "This loan needs guarantees before it can be approved — " + parts.join("; ") + ". Add them on the Guarantors tab.";
    };
    var paintCoverage = function () {
      var c = coverage();
      var box = $("loan-coverage");
      var banner = $("loan-guarantee-box");
      if (!c) {
        box.innerHTML = '<p class="text-muted small-note">This product does not require guarantees. You may still record guarantors.</p>';
        banner.hidden = true;
        return;
      }
      var line = function (label, have, need) {
        var pct = need > 0 ? Math.min(100, Math.round(have * 100 / need)) : 100;
        return '<div class="loan-cov-line"><div class="loan-cov-head"><span>' + esc(label) + '</span><span class="mono">' + money(have) + " of " + money(need) +
          (have >= need ? " ✓" : "") + '</span></div><div class="loan-meter" role="meter" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
          '"><span class="' + (have >= need ? "ok" : "short") + '" style="width:' + pct + '%"></span></div></div>';
      };
      box.innerHTML = '<div class="recon-box ' + (c.ok ? "ok" : "warn") + ' loan-coverage"><p class="strong">Guarantee coverage — ' +
        (c.ok ? "requirement met" : "not yet enough to approve") + "</p>" +
        line("Own savings (borrower)", c.self, c.needSelf) + line("Member guarantors", c.ext, c.needExt) + line("Total guaranteed", c.total, c.needTotal) + "</div>";
      var pending = current.status && (current.status.pendingApproval);
      banner.hidden = c.ok || !pending;
      banner.textContent = c.ok ? "" : coverageProblem();
    };

    /* ---------- painting ---------- */
    var paintHeader = function (loan) {
      var sum = loan.summary || {};
      var del = loan.delinquent || {};
      var days = num(del.pastDueDays);
      if (!days && sum.overdueSinceDate) days = daysBetween(api.formatDate(sum.overdueSinceDate), api.todayISO());
      var overdue = num(sum.totalOverdue);
      setText("loan-days-overdue", loan.status && loan.status.active ? (overdue > 0 ? days + " days (" + ageBucket(days || 1) + ")" : "Up to date") : "");
      $("loan-arrears-badge").innerHTML = loan.status && loan.status.active && overdue > 0 ? api.statusBadge("Overdue " + days + " days") : "";
      setText("loan-purpose", loan.loanPurposeName);
      setText("loan-officer", loan.loanOfficerName);
      var ls = $("loan-linked-savings");
      if (loan.linkedAccount && loan.linkedAccount.id) {
        ls.innerHTML = '<a href="savings-detail.html?id=' + enc(loan.linkedAccount.id) + '">#' + esc(loan.linkedAccount.accountNo) + "</a>";
      } else ls.textContent = "—";
    };
    var paintSchedule = function (loan) {
      var table = $("loan-schedule");
      var periods = ((loan.repaymentSchedule && loan.repaymentSchedule.periods) || []).filter(function (p) { return p.period; });
      if (!periods.length) return;
      var today = api.todayISO();
      table.querySelector("thead").innerHTML = '<tr><th>#</th><th>Due</th><th class="text-right">Principal</th><th class="text-right">Interest</th>' +
        '<th class="text-right">Fees &amp; penalties</th><th class="text-right">Total due</th><th class="text-right">Paid</th><th class="text-right">Outstanding</th><th>Status</th></tr>';
      table.querySelector("tbody").innerHTML = periods.map(function (p) {
        var due = api.formatDate(p.dueDate);
        var st = p.complete ? "Paid" : (due < today ? "Overdue" : (num(p.totalPaidForPeriod) > 0 ? "Part paid" : "Due"));
        var cls = st === "Paid" ? "active" : (st === "Overdue" ? "overdue" : "pending");
        return "<tr><td>" + esc(p.period) + "</td><td>" + esc(due) + '</td><td class="mono text-right">' + money(p.principalDue) +
          '</td><td class="mono text-right">' + money(p.interestDue) + '</td><td class="mono text-right">' + money(num(p.feeChargesDue) + num(p.penaltyChargesDue)) +
          '</td><td class="mono text-right">' + money(p.totalDueForPeriod) + '</td><td class="mono text-right">' + money(p.totalPaidForPeriod) +
          '</td><td class="mono text-right">' + money(p.totalOutstandingForPeriod) + '</td><td><span class="status ' + cls + '">' + esc(st) + "</span></td></tr>";
      }).join("");
    };
    var txnLabel = function (t) { return ((t.type && t.type.value) || "") + (t.manuallyReversed ? " (reversed)" : ""); };
    var isRepayment = function (t) { var ty = t.type || {}; return !!(ty.repayment || ty.recoveryRepayment || ty.code === "loanTransactionType.repayment" || ty.code === "loanTransactionType.recoveryRepayment"); };
    var paintTxns = function (loan) {
      var table = $("loan-txns");
      table.querySelector("thead").innerHTML = '<tr><th>Date</th><th>Type</th><th class="text-right">Amount</th><th class="text-right">Principal</th><th class="text-right">Interest</th>' +
        '<th class="text-right">Fees &amp; penalties</th><th>Paid by</th><th class="text-right">Balance after</th><th><span class="sr-only">Actions</span></th></tr>';
      var txns = (loan.transactions || []).filter(function (t) { return !(t.type && t.type.accrual); }).slice().reverse();
      var tb = table.querySelector("tbody");
      tb.innerHTML = txns.map(function (t, i) {
        var pd = t.paymentDetailData || {};
        var paidBy = (pd.paymentType && pd.paymentType.name) || (t.type && t.type.disbursement && loan.linkedAccount && /saving/i.test(txnLabel(t)) ? "Savings" : "");
        if (!paidBy && t.transfer) paidBy = "Account transfer";
        return "<tr" + (t.manuallyReversed ? ' class="text-muted"' : "") + "><td>" + esc(api.formatDate(t.date)) + "</td><td>" + esc(txnLabel(t)) +
          '</td><td class="mono text-right">' + money(t.amount) + '</td><td class="mono text-right">' + money(t.principalPortion) +
          '</td><td class="mono text-right">' + money(t.interestPortion) + '</td><td class="mono text-right">' + money(num(t.feeChargesPortion) + num(t.penaltyChargesPortion)) +
          "</td><td>" + esc(paidBy || "—") + (pd.receiptNumber ? ' <span class="text-muted">#' + esc(pd.receiptNumber) + "</span>" : "") +
          '</td><td class="mono text-right">' + money(t.outstandingLoanBalance) + '</td><td class="btn-group" data-txn="' + i + '"></td></tr>';
      }).join("") || api.emptyRow(9, "No transactions");
      tb.querySelectorAll("[data-txn]").forEach(function (cell) {
        var t = txns[Number(cell.getAttribute("data-txn"))];
        if (t.manuallyReversed) return;
        cell.appendChild(button("Receipt", "btn-sm btn-ghost", function () { printReceipt(t); }, "Print a receipt for this transaction"));
        if (isRepayment(t) && !t.transfer && api.can("ADJUST_LOAN")) cell.appendChild(button("Undo", "btn-sm btn-ghost", function () { return undoTxn(t); }, "Reverse this repayment"));
      });
    };
    var paintLoanCharges = function (loan) {
      var tb = document.querySelector("#loan-charges tbody");
      var charges = loan.charges || [];
      var st = loan.status || {};
      tb.innerHTML = charges.map(function (c, i) {
        return "<tr><td>" + esc(c.name) + (c.penalty ? ' <span class="text-muted">(penalty)</span>' : "") + "</td><td>" + esc(chargeCollected(c)) +
          "</td><td>" + esc(c.dueDate ? api.formatDate(c.dueDate) : "—") + '</td><td class="mono text-right">' + money(c.amount) +
          '</td><td class="mono text-right">' + money(c.amountPaid) + '</td><td class="mono text-right">' + money(c.amountWaived) +
          '</td><td class="mono text-right">' + money(c.amountOutstanding) + '</td><td class="btn-group" data-charge-row="' + i + '"></td></tr>';
      }).join("") || api.emptyRow(8, "No charges on this loan.");
      tb.querySelectorAll("[data-charge-row]").forEach(function (cell) {
        var c = charges[Number(cell.getAttribute("data-charge-row"))];
        var open = num(c.amountOutstanding) > 0;
        if (st.active && open && c.chargePaymentMode && c.chargePaymentMode.id === 1 && api.can("PAY_LOANCHARGE")) {
          cell.appendChild(button("Pay from savings", "btn-sm btn-ghost", function () { return payCharge(c); }));
        }
        if (st.active && open && api.can("WAIVE_LOANCHARGE")) cell.appendChild(button("Waive", "btn-sm btn-ghost", function () { return waiveCharge(c); }));
        if (st.pendingApproval && api.can("DELETE_LOANCHARGE")) cell.appendChild(button("Remove", "btn-sm btn-ghost", function () { return deleteCharge(c); }));
      });
      var bar = $("loan-charge-actions");
      bar.innerHTML = "";
      if ((st.pendingApproval || st.waitingForDisbursal || st.active) && api.can("CREATE_LOANCHARGE")) bar.appendChild(button("Add charge", "btn-sm", addCharge));
    };
    var paintGuarantors = function () {
      var tb = document.querySelector("#loan-guarantors tbody");
      var st = current.status || {};
      var editable = st.pendingApproval || st.waitingForDisbursal;
      tb.innerHTML = guarantors.map(function (g, i) {
        var fund = (g.guarantorFundingDetails || [])[0] || {};
        var isSelf = g.guarantorType && g.guarantorType.id === 1 && String(g.entityId) === String(current.clientId);
        var name = ((g.firstname || "") + " " + (g.lastname || "")).trim() || ("#" + g.entityId);
        var link = g.guarantorType && g.guarantorType.id === 1 ? '<a href="client-detail.html?id=' + enc(g.entityId) + '">' + esc(name) + "</a>" : esc(name);
        return "<tr><td>" + link + "</td><td>" + (isSelf ? "Own savings" : esc((g.guarantorType && g.guarantorType.value) === "CUSTOMER" ? "Member" : ((g.guarantorType && g.guarantorType.value) || ""))) +
          "</td><td>" + esc((g.clientRelationshipType && g.clientRelationshipType.name) || "—") + '</td><td class="mono text-right">' + money(fund.amount) +
          '</td><td class="mono text-right">' + money(fund.amountRemaining) + "</td><td>" + (g.status === false ? api.statusBadge("Removed") : api.statusBadge((fund.status && fund.status.value) || "Active")) +
          '</td><td class="btn-group" data-g="' + i + '"></td></tr>';
      }).join("") || api.emptyRow(7, "No guarantors yet.");
      tb.querySelectorAll("[data-g]").forEach(function (cell) {
        var g = guarantors[Number(cell.getAttribute("data-g"))];
        if (editable && g.status !== false && api.can("DELETE_GUARANTOR")) cell.appendChild(button("Remove", "btn-sm btn-ghost", function () { return removeGuarantor(g); }));
      });
      var bar = $("loan-guarantor-actions");
      bar.innerHTML = "";
      if (editable && api.can("CREATE_GUARANTOR")) {
        bar.appendChild(button("＋ Own savings guarantee", "btn-sm", addSelfGuarantee));
        bar.appendChild(button("＋ Member guarantor", "btn-sm", addMemberGuarantor));
      }
      paintCoverage();
    };
    var paintCollateral = function (loan) {
      var tb = document.querySelector("#loan-collateral tbody");
      var list = loan.collateral || [];
      var pending = loan.status && loan.status.pendingApproval;
      /* This Fineract build drops value/description on create, so Desk keeps them in a loan note "Collateral #id · type · value · description". */
      var noteFor = function (c) {
        var prefix = "Collateral #" + c.id + " · ";
        var n = (loan.notes || []).filter(function (x) { return String(x.note || "").indexOf(prefix) === 0; })[0];
        var parts = n ? String(n.note).slice(prefix.length).split(" · ") : [];
        return { value: c.value || (parts[1] || "").replace(/^value /, ""), description: c.description || parts.slice(2).join(" · ") };
      };
      tb.innerHTML = list.map(function (c, i) {
        var d = noteFor(c);
        return "<tr><td>" + esc((c.type && c.type.name) || "") + '</td><td class="mono text-right">' + (typeof d.value === "number" ? money(d.value) : esc(d.value || "—")) + "</td><td>" + esc(d.description || "") +
          '</td><td class="btn-group" data-col="' + i + '"></td></tr>';
      }).join("") || api.emptyRow(4, "No collateral recorded.");
      tb.querySelectorAll("[data-col]").forEach(function (cell) {
        var c = list[Number(cell.getAttribute("data-col"))];
        if (pending && api.can("DELETE_COLLATERAL")) cell.appendChild(button("Remove", "btn-sm btn-ghost", function () { return removeCollateral(c); }));
      });
      var bar = $("loan-collateral-actions");
      bar.innerHTML = "";
      if (pending && api.can("CREATE_COLLATERAL")) bar.appendChild(button("Add collateral", "btn-sm", addCollateral));
    };

    /* ---------- receipts ---------- */
    var printReceipt = function (t) {
      var w = window.open("", "_blank", "width=420,height=640");
      if (!w) { api.toast("Allow pop-ups for Desk to print receipts.", "error"); return; }
      var pd = t.paymentDetailData || {};
      var rows = [["Receipt for", txnLabel(t)], ["Transaction no.", t.id], ["Date", api.formatDate(t.date)], ["Member", current.clientName],
        ["Loan", "#" + current.accountNo + " · " + current.loanProductName], ["Amount", money(t.amount)],
        ["Principal", money(t.principalPortion)], ["Interest", money(t.interestPortion)], ["Fees & penalties", money(num(t.feeChargesPortion) + num(t.penaltyChargesPortion))],
        ["Paid by", (pd.paymentType && pd.paymentType.name) || (t.transfer ? "Transfer from savings" : "—")], ["Balance after", money(t.outstandingLoanBalance)],
        ["Printed", new Date().toLocaleString("en-UG", { timeZone: "Africa/Kampala" })]];
      var sess = api.getSession() || {};
      var brandEl = document.querySelector(".brand-text strong");
      var brand = (brandEl && brandEl.textContent.trim()) || "SACCO";
      w.document.open();
      w.document.write("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Receipt " + esc(t.id) + "</title><style>" +
        "body{font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;margin:24px;color:#1F2A14}h1{font-size:18px;margin:0 0 4px}" +
        "p{margin:0 0 16px;color:#5E6452}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px dashed #ccc}" +
        "td:last-child{text-align:right;font-family:ui-monospace,Menlo,monospace}.sig{margin-top:40px;border-top:1px solid #000;width:60%;padding-top:4px;font-size:12px}" +
        "</style></head><body><h1>" + esc(brand) + " — Loan receipt</h1><p>Served by " + esc(sess.username || "") + "</p><table>" +
        rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") +
        "</table><div class=\"sig\">Cashier signature</div></body></html>");
      w.document.close();
      w.focus();
      w.print();
    };

    /* ---------- lifecycle actions ---------- */
    var approve = function () {
      var loan = current;
      var proposed = loan.proposedPrincipal || loan.principal;
      return api.openDialog({
        title: "Approve loan #" + loan.accountNo, submitLabel: "Review",
        message: coverageProblem() || "",
        fields: [
          dateField("Approved on"),
          { key: "amount", label: "Approved amount (UGX)", amount: true, placeholder: "Leave blank to approve " + api.formatNumber(proposed), help: "Proposed: " + money(proposed) },
          { key: "expected", label: "Expected disbursement", type: "date", required: true, value: api.formatDate(loan.timeline && loan.timeline.expectedDisbursementDate) },
          noteField()
        ],
        validate: function (v) {
          if (v.expected < v.date) return "Expected disbursement cannot be before the approval date.";
          if (v.amount && v.amount > proposed) return "Approved amount cannot be more than the proposed " + money(proposed) + ".";
          return coverageProblem() ? "Not enough guarantees yet (see above). Add them on the Guarantors tab, then approve." : "";
        },
        confirm: function (v) {
          return { title: "Confirm approval", lines: who().concat([["Approved amount", money(v.amount || proposed)], ["Approved on", v.date], ["Expected disbursement", v.expected]]),
            note: coverage() ? "Guaranteed funds will be put on hold in the guarantors' savings accounts." : "", confirmLabel: "Approve loan" };
        },
        onSubmit: function (v) {
          var body = withDate({ approvedOnDate: v.date, expectedDisbursementDate: v.expected, note: v.note || "" });
          if (v.amount) body.approvedLoanAmount = v.amount;
          return post(loanPath("?command=approve"), body);
        }
      }).then(done("Loan approved"));
    };
    var reject = function () {
      var loan = current;
      return api.openDialog({
        title: "Reject loan #" + loan.accountNo, submitLabel: "Review",
        fields: [dateField("Rejected on"), noteField("Reason", true)],
        confirm: function (v) {
          return { title: "Confirm rejection", lines: who().concat([["Amount", money(loan.proposedPrincipal || loan.principal)], ["Rejected on", v.date]]), note: "This cannot be undone.", confirmLabel: "Reject loan" };
        },
        onSubmit: function (v) { return post(loanPath("?command=reject"), withDate({ rejectedOnDate: v.date, note: v.note })); }
      }).then(done("Loan rejected"));
    };
    var withdraw = function () {
      return api.openDialog({
        title: "Member withdrew application #" + current.accountNo, submitLabel: "Review",
        fields: [dateField("Withdrawn on"), noteField("Reason", true)],
        confirm: function (v) { return { title: "Confirm withdrawal", lines: who().concat([["Withdrawn on", v.date]]), note: "The application is closed.", confirmLabel: "Withdraw application" }; },
        onSubmit: function (v) { return post(loanPath("?command=withdrawnByApplicant"), withDate({ withdrawnOnDate: v.date, note: v.note })); }
      }).then(done("Application withdrawn"));
    };
    var undoApproval = function () {
      return api.openDialog({
        title: "Undo approval of loan #" + current.accountNo, submitLabel: "Review",
        fields: [noteField("Reason", true)],
        confirm: function () { return { title: "Confirm undo approval", lines: who(), note: "The loan goes back to pending approval and any guarantee holds are released.", confirmLabel: "Undo approval" }; },
        onSubmit: function (v) { return post(loanPath("?command=undoapproval"), { note: v.note }); }
      }).then(done("Approval undone"));
    };
    var disbursementFees = function () {
      return (current.charges || []).filter(function (c) { return c.chargeTimeType && c.chargeTimeType.id === 1; })
        .reduce(function (s, c) { return s + num(c.amountOutstanding !== undefined ? c.amountOutstanding : c.amount); }, 0);
    };
    var disburse = async function () {
      var loan = current;
      var pt = await payField();
      var approved = principalOf(loan);
      var fees = disbursementFees();
      return api.openDialog({
        title: "Disburse loan #" + loan.accountNo, submitLabel: "Review",
        message: "Approved amount: " + money(approved) + (fees ? " · Fees due at disbursement: " + money(fees) : ""),
        fields: [dateField("Disbursement date"), amountField("Disbursement amount (UGX)", "Usually the approved amount: " + api.formatNumber(approved)), pt,
          { key: "receipt", label: "Reference (mobile money / bank / cheque no.)", placeholder: "optional" }, noteField()],
        validate: function (v) { return v.amount > approved ? "Cannot disburse more than the approved " + money(approved) + "." : ""; },
        confirm: function (v) {
          return { title: "Confirm disbursement", lines: who().concat([["Amount", money(v.amount)], ["Paid out by", optionLabel(pt, v.paymentTypeId)],
            ["Fees collected at disbursement", money(fees)], ["Member receives (net)", money(v.amount - fees)], ["Date", v.date]]),
          note: fees ? "Fineract records the fees as paid at disbursement — hand over the net amount, or collect the fees in cash." : "",
          confirmLabel: "Disburse " + money(v.amount) };
        },
        onSubmit: function (v) {
          var body = withDate({ actualDisbursementDate: v.date, transactionAmount: String(v.amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || "" });
          if (v.receipt) body.receiptNumber = v.receipt;
          return post(loanPath("?command=disburse"), body).then(function (result) {
            /* Disburse returns the loan as resourceId and the disbursement transaction as subResourceId. */
            notifyAlert({
              type: "loan_disburse", loanId: loan.id, transactionId: result && result.subResourceId,
              pending: Boolean(result && result.rollbackTransaction)
            });
            return result;
          });
        }
      }).then(done("Loan disbursed"));
    };
    var disburseToSavings = function () {
      var loan = current;
      var approved = principalOf(loan);
      var fees = disbursementFees();
      return api.openDialog({
        title: "Disburse loan #" + loan.accountNo + " to savings", submitLabel: "Review",
        message: "Credits savings account #" + loan.linkedAccount.accountNo + ". Approved amount: " + money(approved),
        fields: [dateField("Disbursement date"), amountField("Disbursement amount (UGX)", "Usually the approved amount: " + api.formatNumber(approved)), noteField()],
        validate: function (v) { return v.amount > approved ? "Cannot disburse more than the approved " + money(approved) + "." : ""; },
        confirm: function (v) {
          return { title: "Confirm disbursement to savings", lines: who().concat([["Amount", money(v.amount)], ["To savings", "#" + loan.linkedAccount.accountNo],
            ["Fees collected at disbursement", money(fees)], ["Date", v.date]]), confirmLabel: "Disburse " + money(v.amount) + " to savings" };
        },
        onSubmit: function (v) {
          /* No alert here: Fineract does not return the disbursement transaction id for
             disburseToSavings, and the alerts service only sends for a transaction it can read. */
          return post(loanPath("?command=disburseToSavings"), withDate({ actualDisbursementDate: v.date, transactionAmount: String(v.amount), note: v.note || "" }));
        }
      }).then(done("Loan disbursed to savings"));
    };
    var undoDisbursal = function () {
      return api.openDialog({
        title: "Undo disbursement of loan #" + current.accountNo, submitLabel: "Review",
        fields: [noteField("Reason", true)],
        confirm: function () { return { title: "Confirm undo disbursement", lines: who().concat([["Disbursed", money(principalOf(current))]]), note: "All transactions on this loan are reversed and it returns to Approved. Only do this for a disbursement made in error.", confirmLabel: "Undo disbursement" }; },
        onSubmit: function (v) { return post(loanPath("?command=undodisbursal"), { note: v.note }); }
      }).then(done("Disbursement undone"));
    };
    var dueNow = function () {
      var sum = current.summary || {};
      var periods = ((current.repaymentSchedule && current.repaymentSchedule.periods) || []).filter(function (p) { return p.period && !p.complete; });
      var next = periods[0];
      var overdue = num(sum.totalOverdue);
      return "Outstanding: " + money(sum.totalOutstanding) + (overdue > 0 ? " · Overdue now: " + money(overdue) : "") +
        (next ? " · Next instalment " + api.formatDate(next.dueDate) + ": " + money(next.totalOutstandingForPeriod) : "");
    };
    var repay = async function () {
      var loan = current;
      var pt = await payField();
      var outstanding = num((loan.summary || {}).totalOutstanding);
      return api.openDialog({
        title: "Repayment · loan #" + loan.accountNo, submitLabel: "Review", message: dueNow(),
        fields: [amountField("Repayment amount (UGX)"), pt, dateField("Transaction date"), { key: "receipt", label: "Receipt / reference no.", placeholder: "optional" }, noteField()],
        validate: function (v) { return v.amount > outstanding ? "That is more than the " + money(outstanding) + " outstanding. Use Pay off to close the loan." : ""; },
        confirm: function (v) {
          return { title: "Confirm repayment", lines: who().concat([["Amount", money(v.amount)], ["Payment type", optionLabel(pt, v.paymentTypeId)], ["Date", v.date]]),
            confirmLabel: "Post repayment of " + money(v.amount) };
        },
        onSubmit: function (v) {
          var body = withDate({ transactionDate: v.date, transactionAmount: String(v.amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || "" });
          if (v.receipt) body.receiptNumber = v.receipt;
          return post(loanPath("/transactions?command=repayment"), body).then(function (result) {
            notifyAlert({
              type: "loan_repay", loanId: loan.id, transactionId: result && result.resourceId,
              pending: Boolean(result && result.rollbackTransaction)
            });
            return result;
          });
        }
      }).then(done("Repayment posted"));
    };
    var repayFromSavings = async function () {
      var loan = current;
      var accounts = await memberSavings(loan.clientId);
      if (!accounts.length) throw new Error("This member has no active savings account.");
      var field = { key: "fromId", label: "From savings account", type: "select", required: true,
        value: loan.linkedAccount ? String(loan.linkedAccount.id) : String(accounts[0].id),
        options: accounts.map(function (s) { return { value: s.id, label: savingsLabel(s) }; }) };
      var outstanding = num((loan.summary || {}).totalOutstanding);
      return api.openDialog({
        title: "Repay loan #" + loan.accountNo + " from savings", submitLabel: "Review", message: dueNow(),
        fields: [field, amountField("Amount (UGX)"), dateField("Transfer date"), noteField()],
        validate: function (v) {
          var acc = accounts.filter(function (s) { return String(s.id) === String(v.fromId); })[0];
          if (acc && v.amount > acc.available) return "Savings account #" + acc.accountNo + " has only " + money(acc.available) + " available (guarantee holds are excluded).";
          if (v.amount > outstanding) return "That is more than the " + money(outstanding) + " outstanding.";
          return "";
        },
        confirm: function (v) {
          return { title: "Confirm transfer from savings", lines: who().concat([["From savings", optionLabel(field, v.fromId)], ["Amount", money(v.amount)], ["Date", v.date]]),
            confirmLabel: "Transfer " + money(v.amount) + " to the loan" };
        },
        onSubmit: function (v) {
          return post("/accounttransfers", withDate({
            fromOfficeId: loan.clientOfficeId, fromClientId: loan.clientId, fromAccountType: 2, fromAccountId: Number(v.fromId),
            toOfficeId: loan.clientOfficeId, toClientId: loan.clientId, toAccountType: 1, toAccountId: loan.id,
            transferAmount: String(v.amount), transferDate: v.date, transferDescription: v.note || ("Repayment of loan #" + loan.accountNo + " from savings")
          })).then(function (result) {
            /* /accounttransfers returns the transfer id, not the loan transaction id, so this
               alerts as a transfer out of the member's savings account. */
            notifyAlert({
              type: "transfer", transferId: result && result.resourceId,
              pending: Boolean(result && result.rollbackTransaction)
            });
            return result;
          });
        }
      }).then(done("Repayment from savings posted"));
    };
    var payOff = async function () {
      var loan = current;
      var today = api.todayISO();
      var t = await api.get(loanPath("/transactions/template?command=prepayLoan&transactionDate=" + today + "&locale=en&dateFormat=yyyy-MM-dd"));
      var amount = Math.ceil(num(t.amount));
      if (!(amount > 0)) throw new Error("Nothing is outstanding on this loan.");
      var pt = await payField();
      return api.openDialog({
        title: "Pay off loan #" + loan.accountNo, submitLabel: "Review",
        review: { title: "Amount to close the loan today", lines: [["Principal", money(t.principalPortion)], ["Interest", money(t.interestPortion)],
          ["Fees", money(t.feeChargesPortion)], ["Penalties", money(t.penaltyChargesPortion)], ["Total to pay", money(amount)]],
          note: "Waive interest first if the SACCO grants an early-payoff discount." },
        fields: [pt, { key: "receipt", label: "Receipt / reference no.", placeholder: "optional" }, noteField()],
        confirm: function (v) {
          return { title: "Confirm pay-off", lines: who().concat([["Amount", money(amount)], ["Payment type", optionLabel(pt, v.paymentTypeId)], ["Date", today]]),
            note: "The loan closes when this posts.", confirmLabel: "Post pay-off of " + money(amount) };
        },
        onSubmit: function (v) {
          var body = withDate({ transactionDate: today, transactionAmount: String(amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || "Loan pay-off" });
          if (v.receipt) body.receiptNumber = v.receipt;
          return post(loanPath("/transactions?command=repayment"), body).then(function (result) {
            notifyAlert({
              type: "loan_repay", loanId: loan.id, transactionId: result && result.resourceId,
              pending: Boolean(result && result.rollbackTransaction)
            });
            return result;
          });
        }
      }).then(done("Loan paid off"));
    };
    var waiveInterest = function () {
      var sum = current.summary || {};
      var max = num(sum.interestOutstanding);
      if (!(max > 0)) throw new Error("There is no outstanding interest to waive.");
      return api.openDialog({
        title: "Waive interest · loan #" + current.accountNo, submitLabel: "Review", message: "Interest outstanding: " + money(max),
        fields: [amountField("Interest to waive (UGX)"), dateField("Waived on"), noteField("Reason / approval reference", true)],
        validate: function (v) { return v.amount > max ? "Only " + money(max) + " of interest is outstanding." : ""; },
        confirm: function (v) { return { title: "Confirm interest waiver", lines: who().concat([["Interest waived", money(v.amount)], ["Date", v.date], ["Reason", v.note]]), confirmLabel: "Waive " + money(v.amount) }; },
        onSubmit: function (v) { return post(loanPath("/transactions?command=waiveinterest"), withDate({ transactionDate: v.date, transactionAmount: String(v.amount), note: v.note })); }
      }).then(done("Interest waived"));
    };
    var writeOff = async function () {
      var t = await api.get(loanPath("/transactions/template?command=writeoff"));
      var reasons = (t.writeOffReasonOptions || []).map(function (o) { return { value: o.id, label: o.name }; });
      var reasonField = reasons.length ? { key: "reason", label: "Write-off reason", type: "select", required: true, placeholder: "— Select reason —", options: reasons } : null;
      return api.openDialog({
        title: "Write off loan #" + current.accountNo, submitLabel: "Review",
        message: "Amount to be written off: " + money(t.amount) + (reasons.length ? "" : " · No WriteOffReasons code values are set up."),
        fields: [dateField("Write-off date"), reasonField, noteField("Board minute / note", true)].filter(Boolean),
        confirm: function (v) {
          return { title: "Confirm write-off", lines: who().concat([["Written off", money(t.amount)], ["Reason", reasonField ? optionLabel(reasonField, v.reason) : "—"], ["Date", v.date]]),
            note: "The loan closes as written off. Later payments are posted as Recovery.", confirmLabel: "Write off " + money(t.amount) };
        },
        onSubmit: function (v) {
          var body = withDate({ transactionDate: v.date, note: v.note });
          if (v.reason) body.writeoffReasonId = Number(v.reason);
          return post(loanPath("/transactions?command=writeoff"), body);
        }
      }).then(done("Loan written off"));
    };
    var recovery = async function () {
      var pt = await payField();
      return api.openDialog({
        title: "Recovery payment · loan #" + current.accountNo, submitLabel: "Review", message: "For money received after a write-off.",
        fields: [amountField("Amount recovered (UGX)"), pt, dateField("Date"), noteField()],
        confirm: function (v) { return { title: "Confirm recovery", lines: who().concat([["Amount", money(v.amount)], ["Payment type", optionLabel(pt, v.paymentTypeId)], ["Date", v.date]]), confirmLabel: "Post recovery of " + money(v.amount) }; },
        onSubmit: function (v) { return post(loanPath("/transactions?command=recoverypayment"), withDate({ transactionDate: v.date, transactionAmount: String(v.amount), paymentTypeId: Number(v.paymentTypeId), note: v.note || "" })); }
      }).then(done("Recovery posted"));
    };
    var undoTxn = function (t) {
      return api.openDialog({
        title: "Undo " + txnLabel(t).toLowerCase() + " of " + money(t.amount), submitLabel: "Review",
        fields: [noteField("Reason", true)],
        confirm: function () { return { title: "Confirm reversal", lines: who().concat([["Transaction", txnLabel(t) + " #" + t.id], ["Date", api.formatDate(t.date)], ["Amount", money(t.amount)]]), note: "The transaction is reversed and the schedule recalculated.", confirmLabel: "Reverse transaction" }; },
        onSubmit: function (v) { return post(loanPath("/transactions/" + enc(t.id)), withDate({ transactionDate: api.formatDate(t.date), transactionAmount: 0, note: v.note })); }
      }).then(done("Transaction reversed"));
    };

    /* ---------- charges ---------- */
    var addCharge = async function () {
      var tpl = await api.get(loanPath("/charges/template"));
      var disbursed = current.status && current.status.active;
      var opts = (tpl.chargeOptions || []).filter(function (c) {
        var time = c.chargeTimeType && c.chargeTimeType.id;
        return time !== 9 && !(disbursed && time === 1) && !/migrat/i.test(c.name || "") && c.active !== false;
      });
      if (!opts.length) throw new Error(disbursed ? "No charges can be added to a disbursed loan: only specified-due-date or instalment fees can, and none are set up." : "No loan charges are set up.");
      var byId = {};
      opts.forEach(function (c) { byId[c.id] = c; });
      var field = { key: "chargeId", label: "Charge", type: "select", required: true, placeholder: "— Select charge —",
        options: opts.map(function (c) { return { value: c.id, label: c.name + " · " + chargeCollected(c) + " · " + (isPercent(c) ? c.amount + "%" : money(c.amount)) }; }) };
      return api.openDialog({
        title: "Add charge · loan #" + current.accountNo, submitLabel: "Review",
        fields: [field, { key: "amount", label: "Amount (UGX, or % for percentage charges)", type: "text", placeholder: "Leave blank for the charge's default" },
          { key: "dueDate", label: "Due date (for specified-date charges)", type: "date", value: api.todayISO() }],
        validate: function (v) {
          if (v.amount !== "" && !(Number(String(v.amount).replace(/,/g, "")) > 0)) return "Amount must be a positive number.";
          return "";
        },
        confirm: function (v) {
          var c = byId[v.chargeId] || {};
          var amt = v.amount !== "" ? Number(String(v.amount).replace(/,/g, "")) : c.amount;
          return { title: "Confirm charge", lines: who().concat([["Charge", c.name], ["Amount", isPercent(c) ? amt + "%" : money(amt)], ["Due", c.chargeTimeType && c.chargeTimeType.id === 2 ? v.dueDate : chargeCollected(c)]]), confirmLabel: "Add charge" };
        },
        onSubmit: function (v) {
          var c = byId[v.chargeId] || {};
          var body = withDate({ chargeId: Number(v.chargeId), amount: v.amount !== "" ? Number(String(v.amount).replace(/,/g, "")) : c.amount });
          if (c.chargeTimeType && c.chargeTimeType.id === 2) body.dueDate = v.dueDate;
          return post(loanPath("/charges"), body);
        }
      }).then(done("Charge added"));
    };
    var waiveCharge = function (c) {
      return api.confirmDialog({
        title: "Waive " + c.name, lines: who().concat([["Charge", c.name], ["Outstanding", money(c.amountOutstanding)]]), summary: "Waive this charge?", confirmLabel: "Waive " + money(c.amountOutstanding),
        onConfirm: function () { return post(loanPath("/charges/" + enc(c.id) + "?command=waive"), {}); }
      }).then(done("Charge waived"));
    };
    var payCharge = function (c) {
      return api.confirmDialog({
        title: "Pay " + c.name + " from savings", lines: who().concat([["Charge", c.name], ["Amount", money(c.amountOutstanding)], ["Date", api.todayISO()]]), summary: "Pay from the linked savings account?", confirmLabel: "Pay " + money(c.amountOutstanding),
        onConfirm: function () { return post(loanPath("/charges/" + enc(c.id) + "?command=pay"), withDate({ transactionDate: api.todayISO() })); }
      }).then(done("Charge paid"));
    };
    var deleteCharge = function (c) {
      return api.confirmDialog({
        title: "Remove " + c.name, lines: [["Charge", c.name], ["Amount", money(c.amount)]], summary: "Remove this charge from the application?", confirmLabel: "Remove charge",
        onConfirm: function () { return call(api.del(loanPath("/charges/" + enc(c.id)))); }
      }).then(done("Charge removed"));
    };

    /* ---------- guarantors ---------- */
    var needLine = function (kind) {
      var c = coverage();
      if (!c) return "";
      var still = kind === "self" ? Math.max(0, c.needSelf - c.self) : Math.max(0, c.needExt - c.ext);
      var total = Math.max(0, c.needTotal - c.total);
      return kind === "self" ? "Own savings must cover " + money(c.needSelf) + " — still needed " + money(still) + " (total still needed " + money(total) + ")."
        : "Members must cover " + money(c.needExt) + " — still needed " + money(still) + " (total still needed " + money(total) + ").";
    };
    var addSelfGuarantee = async function () {
      var accounts = await memberSavings(current.clientId);
      if (!accounts.length) throw new Error(current.clientName + " has no active savings account to guarantee from.");
      var field = { key: "savingsId", label: "Borrower's savings account", type: "select", required: true,
        value: current.linkedAccount ? String(current.linkedAccount.id) : String(accounts[0].id),
        options: accounts.map(function (s) { return { value: s.id, label: savingsLabel(s) }; }) };
      return api.openDialog({
        title: "Own savings guarantee · " + current.clientName, submitLabel: "Review", message: needLine("self"),
        fields: [field, amountField("Amount to hold (UGX)")],
        validate: function (v) {
          var acc = accounts.filter(function (s) { return String(s.id) === String(v.savingsId); })[0];
          return acc && v.amount > acc.available ? "Account #" + acc.accountNo + " has only " + money(acc.available) + " available." : "";
        },
        confirm: function (v) {
          return { title: "Confirm own-savings guarantee", lines: who().concat([["Savings account", optionLabel(field, v.savingsId)], ["Amount", money(v.amount)]]),
            note: "The amount is put on hold when the loan is approved and released as the loan is repaid.", confirmLabel: "Add guarantee of " + money(v.amount) };
        },
        onSubmit: function (v) {
          return post(loanPath("/guarantors"), { guarantorTypeId: 1, entityId: Number(current.clientId), savingsId: Number(v.savingsId), amount: v.amount, locale: "en" });
        }
      }).then(done("Own-savings guarantee added"));
    };
    /* Typeahead over members (by name) expanded to their active savings accounts, plus savings by account no. */
    var guarantorSearch = function (found) {
      return async function (q) {
        var res = await Promise.all([api.searchClients(q), api.searchSavings(q, true)]);
        var clients = res[0].filter(function (c) { return String(c.value) !== String(current.clientId); }).slice(0, 6);
        var items = [];
        var lists = await Promise.all(clients.map(function (c) {
          return api.get("/clients/" + enc(c.value) + "/accounts?fields=savingsAccounts").then(function (a) {
            return (a.savingsAccounts || []).filter(function (s) { return s.status && s.status.active; }).map(function (s) {
              return { value: s.id, label: "#" + s.accountNo + " · " + c.label, sub: (s.productName || "") + " · balance " + money(s.accountBalance),
                raw: { parentId: c.value, parentName: c.label, entityAccountNo: s.accountNo } };
            });
          }).catch(function () { return []; });
        }));
        lists.forEach(function (l) { items = items.concat(l); });
        res[1].forEach(function (s) {
          if (!items.some(function (i) { return String(i.value) === String(s.value); })) items.push(s);
        });
        items.forEach(function (it) { found[it.value] = it.raw; });
        return items.slice(0, 20);
      };
    };
    var addMemberGuarantor = async function () {
      var tpl = await api.get(loanPath("/guarantors/template"));
      var rel = (tpl.allowedClientRelationshipTypes || []).map(function (r) { return { value: r.id, label: r.name }; });
      var found = {};
      var relField = { key: "relationship", label: "Relationship to borrower", type: "select", placeholder: "— Select —", options: rel };
      return api.openDialog({
        title: "Add member guarantor", submitLabel: "Review", message: needLine("ext"),
        fields: [
          { key: "savingsId", label: "Guarantor's savings account", type: "search", required: true, placeholder: "Guarantor's name or savings account no",
            help: "The guaranteed amount is held in this account until the loan is repaid.",
            search: guarantorSearch(found) },
          relField, amountField("Amount guaranteed (UGX)")
        ],
        validate: function (v) {
          var raw = found[v.savingsId];
          if (raw && String(raw.parentId) === String(current.clientId)) return "That is the borrower's own account — use “Own savings guarantee” instead.";
          return "";
        },
        confirm: function (v) {
          var raw = found[v.savingsId] || {};
          return { title: "Confirm guarantor", lines: who().concat([["Guarantor", raw.parentName || ""], ["Savings account", "#" + (raw.entityAccountNo || v.savingsId)],
            ["Relationship", v.relationship ? optionLabel(relField, v.relationship) : "—"], ["Amount guaranteed", money(v.amount)]]),
          note: "The amount is put on hold in the guarantor's savings when the loan is approved.", confirmLabel: "Add guarantor" };
        },
        onSubmit: async function (v) {
          var acc = await api.get("/savingsaccounts/" + enc(v.savingsId));
          var sum = acc.summary || {};
          var avail = sum.availableBalance !== undefined ? num(sum.availableBalance) : num(sum.accountBalance);
          if (v.amount > avail) throw new Error("Savings account #" + acc.accountNo + " has only " + money(avail) + " available.");
          var body = { guarantorTypeId: 1, entityId: Number(acc.clientId), savingsId: Number(v.savingsId), amount: v.amount, locale: "en" };
          if (v.relationship) body.clientRelationshipTypeId = Number(v.relationship);
          return post(loanPath("/guarantors"), body);
        }
      }).then(done("Guarantor added"));
    };
    var removeGuarantor = function (g) {
      var fund = (g.guarantorFundingDetails || [])[0];
      var name = ((g.firstname || "") + " " + (g.lastname || "")).trim();
      return api.confirmDialog({
        title: "Remove guarantor", lines: [["Guarantor", name], ["Amount", money(fund && fund.amount)]], summary: "Remove this guarantee?", confirmLabel: "Remove guarantor",
        onConfirm: function () { return call(api.del(loanPath("/guarantors/" + enc(g.id) + (fund ? "?guarantorFundingId=" + enc(fund.id) : "")))); }
      }).then(done("Guarantor removed"));
    };

    /* ---------- collateral ---------- */
    var addCollateral = async function () {
      var tpl = await api.get(loanPath("/collaterals/template"));
      var types = (tpl.allowedCollateralTypes || []).map(function (t) { return { value: t.id, label: t.name }; });
      if (!types.length) throw new Error("No collateral types are set up — add values to the LoanCollateral code first.");
      var typeField = { key: "type", label: "Collateral type", type: "select", required: true, placeholder: "— Select —", options: types };
      return api.openDialog({
        title: "Add collateral · loan #" + current.accountNo, submitLabel: "Save",
        fields: [typeField, amountField("Estimated value (UGX)"), { key: "description", label: "Description", type: "textarea", required: true, placeholder: "e.g. Land title Kyadondo Block 12 Plot 34" }],
        onSubmit: async function (v) {
          var r = await post(loanPath("/collaterals"), { collateralTypeId: Number(v.type), value: v.amount, description: v.description, locale: "en" });
          await post(loanPath("/notes"), { note: "Collateral #" + r.resourceId + " · " + optionLabel(typeField, v.type) + " · value " + money(v.amount) + " · " + v.description });
          return r;
        }
      }).then(done("Collateral recorded"));
    };
    var removeCollateral = function (c) {
      return api.confirmDialog({
        title: "Remove collateral", lines: [["Type", (c.type && c.type.name) || ""], ["Value", money(c.value)]], summary: "Remove this collateral?", confirmLabel: "Remove",
        onConfirm: function () { return call(api.del(loanPath("/collaterals/" + enc(c.id)))); }
      }).then(done("Collateral removed"));
    };

    /* ---------- action bar ---------- */
    var paintActions = function () {
      var st = current.status || {};
      var main = [], more = [];
      if (st.pendingApproval) {
        if (api.can("APPROVE_LOAN")) main.push(["Approve", "btn-amber", approve]);
        if (api.can("REJECT_LOAN")) main.push(["Reject", "btn-ghost", reject]);
        if (api.can("WITHDRAW_LOAN")) more.push(["Member withdrew", withdraw]);
      } else if (st.waitingForDisbursal) {
        if (api.can("DISBURSE_LOAN")) main.push(["Disburse", "btn-amber", disburse]);
        if (current.linkedAccount && api.can("DISBURSETOSAVINGS_LOAN")) main.push(["Disburse to savings", "", disburseToSavings]);
        if (api.can("APPROVALUNDO_LOAN")) more.push(["Undo approval", undoApproval]);
      } else if (st.active) {
        if (api.can("REPAYMENT_LOAN")) main.push(["Repay", "btn-amber", repay]);
        if (api.can("CREATE_ACCOUNTTRANSFER")) main.push(["Repay from savings", "", repayFromSavings]);
        if (api.can("REPAYMENT_LOAN")) more.push(["Pay off (close loan)", payOff]);
        if (api.can("WAIVEINTERESTPORTION_LOAN")) more.push(["Waive interest", waiveInterest]);
        if (api.can("WRITEOFF_LOAN")) more.push(["Write off", writeOff]);
        if (api.can("DISBURSALUNDO_LOAN")) more.push(["Undo disbursement", undoDisbursal]);
      } else if (st.closedWrittenOff) {
        if (api.can("RECOVERYPAYMENT_LOAN")) main.push(["Recovery payment", "btn-amber", recovery]);
      }
      var box = $("loan-actions");
      box.innerHTML = "";
      main.forEach(function (a) { box.appendChild(button(a[0], a[1], a[2])); });
      var bar = $("loan-more-actions");
      bar.innerHTML = "";
      more.forEach(function (a) { bar.appendChild(button(a[0], "btn-sm btn-ghost", a[1])); });
      bar.hidden = !more.length;
    };

    document.addEventListener("desk:loan", function (e) {
      current = e.detail;
      paintHeader(current);
      paintSchedule(current);
      paintActions();
      paintTxns(current);
      paintLoanCharges(current);
      Promise.all([api.get(loanPath("/guarantors")), loanProduct(current.loanProductId), api.get(loanPath("/collaterals"))]).then(function (res) {
        guarantors = Array.isArray(res[0]) ? res[0] : [];
        product = res[1];
        paintGuarantors();
        current.collateral = Array.isArray(res[2]) ? res[2] : [];
        paintCollateral(current);
      }).catch(fail);
    });
  }

  /* ================================================================ COLLECTIONS */
  if (page === "collections") {
    var rows = [];
    var paintQueue = function () {
      var bucket = $("col-bucket") ? $("col-bucket").value : "";
      var officer = $("col-officer") ? $("col-officer").value : "";
      var list = rows.filter(function (r) {
        return (!bucket || r.bucket === bucket) && (!officer || String(r.loan.loanOfficerId || "") === officer);
      });
      var tbody = document.querySelector("#collections-table tbody");
      tbody.innerHTML = list.map(function (r) {
        var l = r.loan, sum = l.summary || {};
        return '<tr><td><a href="client-detail.html?id=' + enc(l.clientId || "") + '">' + esc(l.clientName || "") +
          '</a></td><td class="mono">' + esc(l.accountNo || "") + "<br><span class=\"text-muted\">" + esc(l.loanProductName || "") + "</span></td><td>" +
          api.statusBadge("Overdue " + r.days + " days") + '<br><span class="text-muted">' + esc(r.bucket) + "</span>" +
          '</td><td class="mono text-right">' + money(sum.totalOverdue) + '</td><td class="mono text-right">' + money(sum.totalOutstanding) +
          "</td><td>" + esc(l.loanOfficerName || "—") + '</td><td><a class="btn btn-sm" href="loan-detail.html?id=' + enc(l.id) + '">Open loan</a></td></tr>';
      }).join("") || api.emptyRow(7, rows.length ? "No loans match these filters." : "No active loans are in arrears.");
    };
    var parFromReport = async function () {
      var sess = api.getSession() || {};
      var q = "R_officeId=" + enc(sess.officeId || 1) + "&R_loanOfficerId=-1&R_currencyId=-1&R_fundId=-1&R_loanProductId=-1&R_loanPurposeId=-1&R_parType=1&genericResultSet=false";
      var res = await api.get("/runreports/" + enc("Portfolio at Risk") + "?" + q);
      var row = Array.isArray(res) ? res[0] : (res && res.data && res.data[0] && res.data[0].row);
      if (!row) return null;
      if (Array.isArray(row)) {
        var cols = (res.columnHeaders || []).map(function (c) { return c.columnName; });
        var obj = {};
        cols.forEach(function (c, i) { obj[c] = row[i]; });
        row = obj;
      }
      var parKey = Object.keys(row).filter(function (k) { return /par|portfolio at risk/i.test(k); })[0];
      return parKey ? { par: row[parKey], principalOutstanding: row["Principal Outstanding"], principalOverdue: row["Principal Overdue"] } : null;
    };
    var load = async function () {
      var tbody = document.querySelector("#collections-table tbody");
      tbody.innerHTML = api.loadingRow(7, "Checking active loans…");
      var CHUNK = 200, MAX = 5000;
      var all = [], total = 0, offset = 0;
      do {
        var data = await api.get("/loans?status=300&offset=" + offset + "&limit=" + CHUNK + "&orderBy=id&sortOrder=ASC");
        total = typeof data.totalFilteredRecords === "number" ? data.totalFilteredRecords : (data.pageItems || []).length;
        all = all.concat(data.pageItems || []);
        offset += CHUNK;
      } while (offset < total && offset < MAX);
      var today = api.todayISO();
      var principalOutstanding = 0, principalAtRisk = 0;
      rows = [];
      all.forEach(function (l) {
        var sum = l.summary || {};
        principalOutstanding += num(sum.principalOutstanding);
        if (!(l.inArrears || num(sum.totalOverdue) > 0)) return;
        var days = num(l.delinquent && l.delinquent.pastDueDays);
        if (!days && sum.overdueSinceDate) days = daysBetween(api.formatDate(sum.overdueSinceDate), today);
        days = Math.max(days, 1);
        principalAtRisk += num(sum.principalOutstanding);
        rows.push({ loan: l, days: days, bucket: ageBucket(days) });
      });
      rows.sort(function (a, b) { return b.days - a.days; });
      var amount = rows.reduce(function (s, r) { return s + num(r.loan.summary.totalOverdue); }, 0);
      setText("kpi-overdue-count", api.formatNumber(rows.length));
      setText("kpi-overdue-amount", money(amount));
      setText("kpi-checked", api.formatNumber(all.length));
      var parPct = principalOutstanding > 0 ? (principalAtRisk * 100 / principalOutstanding) : 0;
      setText("kpi-par", parPct.toFixed(1) + "%");
      setText("kpi-par-meta", "Principal at risk " + money(principalAtRisk) + " of " + money(principalOutstanding));
      setText("collections-note", (all.length < total ?
        "Checked the first " + api.formatNumber(all.length) + " of " + api.formatNumber(total) + " active loans." :
        "Checked all " + api.formatNumber(total) + " active loans.") + " Days overdue count from the oldest unpaid instalment.");
      var officers = {};
      rows.forEach(function (r) { if (r.loan.loanOfficerId) officers[r.loan.loanOfficerId] = r.loan.loanOfficerName; });
      var os = $("col-officer");
      if (os) {
        var keep = os.value;
        os.innerHTML = '<option value="">All officers</option>' + Object.keys(officers).map(function (id) {
          return '<option value="' + esc(id) + '"' + (id === keep ? " selected" : "") + ">" + esc(officers[id]) + "</option>";
        }).join("");
      }
      paintQueue();
      /* Fineract's own Portfolio at Risk report (all seven parameters). Shown when the report runs on this server. */
      try {
        var rep = await parFromReport();
        if (rep && rep.par !== undefined && rep.par !== null) {
          setText("kpi-par", Number(rep.par).toFixed(2) + "%");
          setText("kpi-par-meta", "Fineract PAR report (principal) · overdue " + money(rep.principalOverdue) + " of " + money(rep.principalOutstanding) + " outstanding");
        }
      } catch (e) {
        setText("kpi-par-meta", "Principal at risk " + money(principalAtRisk) + " of " + money(principalOutstanding) + " (calculated by Desk — the Fineract PAR report is not available on this server)");
      }
    };
    var runLoad = function () {
      load().then(function () { api.clearStatus(); }).catch(function (err) {
        if (err && err.status === 401) return;
        document.querySelector("#collections-table tbody").innerHTML = api.emptyRow(7, "Could not load: " + (err.message || err));
        fail(err);
      });
    };
    ["col-bucket", "col-officer"].forEach(function (id) { if ($(id)) $(id).addEventListener("change", paintQueue); });
    document.addEventListener("desk:refresh", runLoad);
    runLoad();
  }
})();
