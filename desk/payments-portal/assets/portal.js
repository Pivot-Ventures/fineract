/* Phaneroo payments portal. Layout follows the approved remock; colour is desk green and amber. */
(function () {
  "use strict";

  var model = window.PaymentsModel;
  var KEY = "paymentsPortal.internalKey";
  var PARTNER = "paymentsPortal.partnerKey";
  var OVERRIDES = "paymentsPortal.overrides";
  var EXTRA = "paymentsPortal.created";
  var PAGE_SIZE = 8;
  var page = document.body.getAttribute("data-page") || "overview";
  var book = null;

  var HOOKS = {
    MTN_MOMO: "/payments/v1/webhooks/mtn-momo",
    AIRTEL_MONEY: "/payments/v1/webhooks/airtel-money",
    BANK: "/payments/v1/webhooks/bank",
    CARD: "/payments/v1/webhooks/card"
  };

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.slice(0, 2) === "on" && typeof value === "function") node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach(function (child) {
      if (child == null || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function toast(msg, kind) {
    var area = document.querySelector(".toast-area");
    if (!area) {
      area = h("div", { class: "toast-area", role: "status", "aria-live": "polite" });
      document.body.appendChild(area);
    }
    var el = h("div", { class: "toast" + (kind ? " toast-" + kind : ""), text: msg });
    area.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === "error" ? 7000 : 4000);
  }

  function readStore(name) {
    try { return sessionStorage.getItem(name) || ""; } catch (e) { return ""; }
  }
  function writeStore(name, value) {
    try {
      if (value) sessionStorage.setItem(name, value);
      else sessionStorage.removeItem(name);
    } catch (e) { /* private mode */ }
  }
  function overrides() {
    try { return JSON.parse(readStore(OVERRIDES) || "{}"); } catch (e) { return {}; }
  }
  function extras() {
    try { return JSON.parse(readStore(EXTRA) || "[]"); } catch (e) { return []; }
  }

  function query() {
    var params = new URLSearchParams(location.search);
    return {
      text: params.get("q") || "",
      channel: params.get("channel") || "",
      direction: params.get("direction") || "",
      status: params.get("status") || "",
      from: params.get("from") || "",
      to: params.get("to") || "",
      page: params.get("page") || "",
      id: params.get("id") || ""
    };
  }

  function writeQuery(next) {
    var params = new URLSearchParams();
    Object.keys(next).forEach(function (key) {
      if (!next[key]) return;
      var name = key === "text" ? "q" : key;
      params.set(name, next[key]);
    });
    var search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? "?" + search : "") + location.hash);
  }

  function markNav() {
    var nav = page === "payment" ? "payments" : page;
    if (page === "channels" && location.hash === "#health") nav = "health";
    document.querySelectorAll(".nav-link[data-nav]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-nav") === nav);
    });
    var toggle = document.querySelector("[data-toggle-sidebar]");
    var sidebar = document.querySelector(".sidebar");
    if (toggle && sidebar) {
      toggle.addEventListener("click", function () { sidebar.classList.toggle("open"); });
    }
    var keyBtn = document.getElementById("gateway-key-btn");
    if (keyBtn) {
      keyBtn.textContent = readStore(KEY) ? "Gateway key saved" : "Operator key";
      keyBtn.addEventListener("click", openKeyDialog);
    }
    var search = document.getElementById("top-search");
    if (search) {
      var q = query();
      if (q.text) search.value = q.text;
      search.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        var value = search.value.trim();
        if (page === "payments") {
          var current = query();
          current.text = value;
          current.page = "";
          writeQuery(current);
          paint();
        } else {
          location.href = "payments.html" + (value ? "?q=" + encodeURIComponent(value) : "");
        }
      });
    }
  }

  function openKeyDialog() {
    var existing = document.getElementById("key-dialog");
    if (existing) existing.remove();
    var internal = h("input", { id: "gateway-key-input", type: "password", autocomplete: "off", placeholder: "X-Internal-Api-Key" });
    var partner = h("input", { id: "partner-key-input", type: "password", autocomplete: "off", placeholder: "X-Api-Key for initiate" });
    var dialog = h("dialog", { id: "key-dialog", class: "pay-dialog" }, [
      h("form", {}, [
        h("h2", { text: "Payments gateway" }),
        h("p", { text: "The internal key reads /payments/internal/intents. The partner key is only used to initiate a payment. Both stay in this browser session." }),
        h("div", { class: "field" }, [h("label", { for: "gateway-key-input", text: "Internal API key" }), internal]),
        h("div", { class: "field" }, [h("label", { for: "partner-key-input", text: "Partner API key" }), partner]),
        h("div", { class: "form-actions" }, [
          h("button", { class: "btn", type: "submit", text: "Save" }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Use demo book", onclick: function () {
            writeStore(KEY, "");
            writeStore(PARTNER, "");
            dialog.close();
            boot();
          } }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Close", onclick: function () { dialog.close(); } })
        ])
      ])
    ]);
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      if (internal.value.trim()) writeStore(KEY, internal.value.trim());
      if (partner.value.trim()) writeStore(PARTNER, partner.value.trim());
      dialog.close();
      boot();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  async function loadBook() {
    var health = null;
    try {
      var healthResponse = await fetch("/payments/health", { headers: { accept: "application/json" } });
      if (healthResponse.ok) health = await healthResponse.json();
    } catch (e) { health = null; }

    var key = readStore(KEY);
    var gatewayError = "";
    var source = "fixture";
    var intents = null;
    if (key) {
      try {
        var response = await fetch("/payments/internal/intents?limit=200", {
          headers: { accept: "application/json", "X-Internal-Api-Key": key }
        });
        if (response.status === 401) gatewayError = "The internal key was rejected. Showing the demo book.";
        else if (!response.ok) gatewayError = "Gateway list returned " + response.status + ". Showing the demo book.";
        else {
          var list = model.normalizeList(await response.json()).map(model.normalizeIntent);
          if (list.length) {
            intents = list.sort(model.byNewest);
            source = "gateway";
          } else gatewayError = "The gateway book is empty. Showing the demo book.";
        }
      } catch (e) {
        gatewayError = "The payments gateway could not be reached. Showing the demo book.";
      }
    }
    if (!intents) {
      var fixtureResponse = await fetch("fixtures/intents.json");
      if (!fixtureResponse.ok) throw new Error("Demo book failed to load");
      var fixture = await fixtureResponse.json();
      var local = overrides();
      intents = model.normalizeList(fixture).map(function (row) {
        return model.normalizeIntent(Object.assign({}, row, local[row.intentId] || {}));
      });
      extras().forEach(function (row) {
        intents.push(model.normalizeIntent(Object.assign({}, row, local[row.intentId] || {})));
      });
      intents.sort(model.byNewest);
      source = "fixture";
    }
    return { health: health, intents: intents, source: source, gatewayError: gatewayError };
  }

  function fillChrome() {
    var chip = document.getElementById("mw-chip");
    var mode = book.health && book.health.mode ? (book.health.mode.channel || "mock") : "mock";
    if (chip) chip.textContent = "● " + mode + " · gateway v1";
    var host = document.getElementById("top-chips");
    if (!host) return;
    host.querySelectorAll(".chip").forEach(function (node) { node.remove(); });
    var avatar = host.querySelector(".avatar");
    var chips = [];
    if (page === "overview") {
      var fineract = book.health && book.health.mode ? book.health.mode.fineract : "";
      chips.push(h("span", { class: "chip green", text: fineract ? "Fineract " + fineract : "Fineract unread" }));
      var day = model.latestDay(book.intents);
      chips.push(h("span", { class: "chip amber", text: day ? "Today · " + model.formatDay(day) : "Today" }));
    } else if (page === "payments") {
      chips.push(h("span", { class: "chip", text: book.intents.length + " intents" }));
    } else if (page === "reports") {
      chips.push(h("span", { class: "chip amber", text: "Settlements · " + (book.source === "gateway" ? "gateway" : "demo") }));
    } else if (page === "channels") {
      chips.push(h("span", { class: "chip green", text: "4 channels registered" }));
    } else if (page === "payment") {
      chips.push(h("span", { class: "chip green", text: "Idempotent" }));
    }
    chips.forEach(function (node) { host.insertBefore(node, avatar); });
    var keyBtn = document.getElementById("gateway-key-btn");
    if (keyBtn) keyBtn.textContent = readStore(KEY) ? "Gateway key saved" : "Operator key";
  }

  function kpi(label, value, meta, tone, metaTone) {
    return h("div", { class: "kpi-card" + (tone ? " " + tone : "") }, [
      h("div", { class: "kpi-label", text: label }),
      h("div", { class: "kpi-value", text: value }),
      meta ? h("div", { class: "kpi-meta" + (metaTone ? " " + metaTone : ""), text: meta }) : null
    ]);
  }

  function statusPill(status) {
    return h("span", { class: "status " + model.statusTone(status), text: status || "—" });
  }

  function typePill(direction) {
    var collect = direction !== "DEBIT";
    return h("span", { class: "type-pill " + (collect ? "collect" : "disburse"), text: collect ? "Collect" : "Disburse" });
  }

  function channelTag(id) {
    var visual = model.channelVisual(id);
    return h("span", { class: "channel-tag" }, [
      h("span", { class: "dot " + visual.slug }),
      document.createTextNode(" " + visual.label)
    ]);
  }

  function modeBadge(mode) {
    var label = mode || "unconfirmed";
    var text = mode ? mode : "Unconfirmed";
    return h("span", { class: "badge " + label, text: text });
  }

  function mixRow(label, width, value, slug) {
    return h("div", { class: "mix-row" }, [
      h("span", { text: label }),
      h("div", { class: "mix-bar" }, [h("div", { class: "mix-fill" + (slug ? " " + slug : ""), style: "width:" + width + "%" })]),
      h("span", { class: "mix-val", text: value })
    ]);
  }

  function selectOptions(options, current) {
    return options.map(function (opt) {
      return h("option", { value: opt[0], selected: opt[0] === current ? "selected" : null, text: opt[1] });
    });
  }

  function renderOverview() {
    var today = model.latestDay(book.intents);
    var yesterday = model.shiftDay(today, -1);
    var todayRows = model.onDay(book.intents, today);
    var yRows = model.onDay(book.intents, yesterday);
    var todaySum = model.summarize(todayRows);
    var ySum = model.summarize(yRows);
    var all = model.summarize(book.intents);
    var collectDelta = "";
    var collectTone = "";
    if (ySum.collect > 0) {
      var delta = ((todaySum.collect - ySum.collect) / ySum.collect) * 100;
      collectDelta = (delta >= 0 ? "↑ " : "↓ ") + Math.abs(delta).toFixed(0) + "% vs yesterday · " + todaySum.count + " txns";
      collectTone = delta >= 0 ? "up" : "down";
    } else {
      collectDelta = todaySum.count + " txns";
    }
    var success = todayRows.length ? (todaySum.posted / todayRows.length) * 100 : all.successRate;
    var core = model.coreMix(book.intents);
    var coreMax = Math.max(core.POSTED, core.POSTING, core.NOT_POSTED, core.REJECTED, 1);
    var channelMax = 1;
    model.CHANNELS.forEach(function (ch) { channelMax = Math.max(channelMax, todaySum.byChannel[ch.id].volume); });
    var mix = h("div", {});
    model.CHANNELS.forEach(function (ch) {
      var row = todaySum.byChannel[ch.id];
      var visual = model.channelVisual(ch.id);
      mix.appendChild(mixRow(visual.label, Math.round((row.volume / channelMax) * 100), model.compactNumber(row.volume), visual.slug));
    });
    var coreBox = h("div", {}, [
      mixRow("POSTED", Math.round((core.POSTED / coreMax) * 100), String(core.POSTED)),
      mixRow("POSTING", Math.round((core.POSTING / coreMax) * 100), String(core.POSTING)),
      mixRow("NOT_POSTED", Math.round((core.NOT_POSTED / coreMax) * 100), String(core.NOT_POSTED)),
      mixRow("REJECTED / AMBIGUOUS", Math.round((core.REJECTED / coreMax) * 100), String(core.REJECTED))
    ]);
    coreBox.querySelectorAll(".mix-fill").forEach(function (bar, index) {
      var colors = ["var(--success)", "var(--info)", "var(--warn)", "var(--danger)"];
      bar.style.background = colors[index];
    });
    var feed = h("div", {});
    book.intents.slice(0, 5).forEach(function (row) {
      var visual = model.channelVisual(row.channel);
      var credit = row.direction !== "DEBIT";
      var href = "payment.html?id=" + encodeURIComponent(row.intentId);
      feed.appendChild(h("div", { class: "feed-item" }, [
        h("div", { class: "feed-icon " + visual.slug, text: visual.short }),
        h("div", {}, [
          h("a", { class: "feed-title", href: href }, [
            document.createTextNode((credit ? "Collection" : "Disbursement") + " · " + model.productLabel(row.product).toLowerCase() + " "),
            statusPill(row.status)
          ]),
          h("div", { class: "feed-meta", text: model.displayName(row) + " · " + (row.msisdn || row.externalReference || "—") + " · intent " + row.intentId + (row.hmacRef ? " · HMAC ok" : "") })
        ]),
        h("div", {}, [
          h("div", { class: "feed-amt " + (credit ? "credit" : "debit"), text: (credit ? "+ " : "− ") + model.formatUgx(row.amount) }),
          h("div", { class: "feed-time", text: model.eatTime(row.createdAt) + " EAT" })
        ])
      ]));
    });
    var note = book.gatewayError ? h("div", { class: "notice", text: book.gatewayError }) : null;
    return [
      note,
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Payments overview" }),
          h("p", { class: "page-sub", text: "Collections & disbursements across MTN MoMo, Airtel Money, bank & card — fused with the payments gateway." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", text: "Refresh", onclick: function () { boot(); } }),
          h("a", { class: "btn btn-amber", href: "payments.html", text: "View all payments" })
        ])
      ]),
      h("div", { class: "kpi-grid" }, [
        kpi("Collections today", "UGX " + model.compactNumber(todaySum.collect), collectDelta, "green", collectTone),
        kpi("Disbursements today", "UGX " + model.compactNumber(todaySum.disburse), todayRows.filter(function (row) { return row.direction === "DEBIT"; }).length + " payouts · savings / loan"),
        kpi("Success rate", success.toFixed(1) + "%", "POSTED / settled intents", "amber", "up"),
        kpi("Pending", String(all.pending), "AWAITING_PROVIDER · POSTING_CORE", "warn"),
        kpi("Failed", String(all.failed), "Declined / core rejected", "red", "down")
      ]),
      h("div", { class: "grid-2" }, [
        h("section", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Channel mix · volume (UGX)" }), h("span", { class: "chip", text: "Today" })]),
          h("div", { class: "card-b" }, [mix])
        ]),
        h("section", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Fineract posting" }), h("span", { class: "chip", text: "Core status" })]),
          h("div", { class: "card-b" }, [coreBox])
        ])
      ]),
      h("section", { class: "card" }, [
        h("div", { class: "card-h" }, [
          h("h2", { text: "Recent payment runs" }),
          h("a", { href: "payments.html", text: "See all →" })
        ]),
        h("div", { class: "card-b" }, [feed])
      ])
    ];
  }

  function renderPayments() {
    var q = query();
    var window = model.bookWindow(book.intents);
    if (!q.from && !q.to && !new URLSearchParams(location.search).has("from")) {
      q.from = window.from;
      q.to = window.to;
    }
    var rows = model.filterIntents(book.intents, q);
    var pageNo = Math.max(parseInt(q.page || "1", 10) || 1, 1);
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (pageNo > pages) pageNo = pages;
    var slice = rows.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
    var from = (pageNo - 1) * PAGE_SIZE + (rows.length ? 1 : 0);
    var to = (pageNo - 1) * PAGE_SIZE + slice.length;

    var channel = h("select", { name: "channel", "aria-label": "Channel" }, selectOptions([
      ["", "All channels"], ["MTN_MOMO", "MTN MoMo"], ["AIRTEL_MONEY", "Airtel Money"], ["BANK", "Bank"], ["CARD", "Card"]
    ], q.channel));
    var direction = h("select", { name: "direction", "aria-label": "Type" }, selectOptions([
      ["", "Collect + Disburse"], ["CREDIT", "Collect (CREDIT)"], ["DEBIT", "Disburse (DEBIT)"]
    ], q.direction));
    var status = h("select", { name: "status", "aria-label": "Status" }, selectOptions([
      ["", "All statuses"],
      ["POSTED", "POSTED"],
      ["AWAITING_PROVIDER", "AWAITING_PROVIDER"],
      ["INITIATED", "INITIATED"],
      ["POSTING_CORE", "POSTING_CORE"],
      ["PROVIDER_DECLINED", "PROVIDER_DECLINED"],
      ["CORE_REJECTED", "CORE_REJECTED"],
      ["AMBIGUOUS", "AMBIGUOUS"]
    ], q.status));
    var fromInput = h("input", { type: "date", name: "from", value: q.from, "aria-label": "From" });
    var toInput = h("input", { type: "date", name: "to", value: q.to, "aria-label": "To" });
    var form = h("form", { class: "filters", id: "pay-filters" }, [
      h("div", { class: "field" }, [h("label", { text: "Channel" }), channel]),
      h("div", { class: "field" }, [h("label", { text: "Type" }), direction]),
      h("div", { class: "field" }, [h("label", { text: "Status" }), status]),
      h("div", { class: "field" }, [h("label", { text: "From" }), fromInput]),
      h("div", { class: "field" }, [h("label", { text: "To" }), toInput]),
      h("div", { class: "field", style: "min-width:auto" }, [
        h("label", { text: "\u00a0" }),
        h("button", { class: "btn btn-sm", type: "submit", text: "Apply" })
      ])
    ]);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var search = document.getElementById("top-search");
      writeQuery({
        text: search ? search.value.trim() : q.text,
        channel: channel.value,
        direction: direction.value,
        status: status.value,
        from: fromInput.value,
        to: toInput.value
      });
      paint();
    });

    var body = h("tbody");
    if (!slice.length) {
      body.appendChild(h("tr", {}, [h("td", { colspan: "8", class: "empty-hint", text: "No payments match these filters." })]));
    }
    slice.forEach(function (row) {
      var href = "payment.html?id=" + encodeURIComponent(row.intentId);
      body.appendChild(h("tr", {}, [
        h("td", { text: model.eatTime(row.createdAt) }),
        h("td", {}, [channelTag(row.channel)]),
        h("td", {}, [typePill(row.direction)]),
        h("td", { class: "amt", text: model.formatAmount(row.amount) }),
        h("td", {}, [statusPill(row.status)]),
        h("td", { text: model.displayName(row) + (row.externalReference ? " · " + row.externalReference : "") }),
        h("td", { class: "mono", text: row.intentId }),
        h("td", {}, [h("a", { class: "btn btn-ghost btn-sm", href: href, text: "View" })])
      ]));
    });

    function go(nextPage) {
      var current = query();
      current.page = String(nextPage);
      if (!current.from) current.from = fromInput.value;
      if (!current.to) current.to = toInput.value;
      writeQuery(current);
      paint();
    }

    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Payments" }),
          h("p", { class: "page-sub", text: "Filterable payment intents from the aggregator gateway (collect / disburse)." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", text: "Export CSV", onclick: function () { exportCsv(rows); } }),
          h("button", { class: "btn", type: "button", text: "+ Initiate (mock)", onclick: openInitiate })
        ])
      ]),
      form,
      h("section", { class: "card" }, [
        h("div", { class: "table-wrap" }, [
          h("table", { class: "data" }, [
            h("thead", {}, [h("tr", {}, ["Time (EAT)", "Channel", "Type", "Amount (UGX)", "Status", "Member / ref", "Intent", ""].map(function (label) {
              return h("th", { scope: "col", text: label });
            }))]),
            body
          ])
        ]),
        h("div", { class: "table-foot" }, [
          h("span", { text: "Showing " + from + "–" + to + " of " + rows.length }),
          h("span", { class: "pager" }, [
            h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "← Prev", disabled: pageNo <= 1, onclick: function () { go(pageNo - 1); } }),
            h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Next →", disabled: pageNo >= pages, onclick: function () { go(pageNo + 1); } })
          ])
        ])
      ])
    ];
  }

  function findIntent(id) {
    for (var i = 0; i < book.intents.length; i++) {
      if (book.intents[i].intentId === id) return book.intents[i];
    }
    return null;
  }

  function tlClass(state) {
    if (state === "done") return "done";
    if (state === "failed") return "fail";
    if (state === "current") return "active";
    return "";
  }
  function tlMark(state) {
    if (state === "done") return "✓";
    if (state === "failed") return "!";
    if (state === "current") return "●";
    return "";
  }

  function renderDetail() {
    var intent = findIntent(query().id);
    if (!intent) {
      return [
        h("div", { class: "page-head" }, [
          h("div", {}, [
            h("h1", { class: "page-title", text: "Payment run" }),
            h("p", { class: "page-sub", text: query().id ? "No run matches " + query().id : "Open a payment from the table." })
          ])
        ])
      ];
    }
    var steps = model.timeline(intent);
    var codes = [
      "idempotency-key: " + (intent.idempotencyKey || "—") + " · clientRef: " + (intent.externalReference || "—"),
      "providerStatus: " + (intent.providerStatus || "—") + (intent.msisdn ? " · MSISDN " + intent.msisdn : ""),
      (intent.hmacRef ? "HMAC " + intent.hmacRef : "Waiting for signed callback") + (intent.webhookEventId ? " · eventId " + intent.webhookEventId : ""),
      "product: " + (intent.product || "—") + (intent.fineractTransactionId ? " · txn " + intent.fineractTransactionId : "") + (intent.failureCode ? " · " + intent.failureCode : "")
    ];
    var titles = [
      "Initiated",
      "Channel ack · " + model.channelLabel(intent.channel),
      "Webhook received",
      "Fineract posted"
    ];
    var list = h("div", { class: "timeline" });
    steps.forEach(function (step, index) {
      list.appendChild(h("div", { class: "tl-item " + tlClass(step.state) }, [
        h("div", { class: "tl-dot", text: tlMark(step.state) }),
        h("div", { class: "tl-title", text: titles[index] || step.label }),
        h("div", { class: "tl-meta", text: step.detail }),
        h("div", { class: "tl-code", text: codes[index] })
      ]));
    });
    function meta(label, value) {
      return h("div", { class: "meta-row" }, [h("dt", { text: label }), h("dd", {}, [value])]);
    }
    var failed = model.canRetry(intent);
    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Payment run · " + intent.intentId }),
          h("p", { class: "page-sub", text: model.channelLabel(intent.channel) + " " + model.directionLabel(intent.direction).toLowerCase() + " · " + model.productLabel(intent.product).toLowerCase() + " · timeline from gateway orchestrator" })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", text: "Copy refs", onclick: function () { copyRefs(intent); } }),
          h("button", {
            class: "btn btn-amber",
            type: "button",
            text: "↻ Retry (mock)",
            disabled: !failed,
            title: failed ? "Retry this failed run" : "Only a failed run can be retried",
            onclick: function () { if (failed) openRetry(intent); }
          })
        ])
      ]),
      h("div", { class: "notice", text: "Statuses match gateway enums: INITIATED → AWAITING_PROVIDER → POSTING_CORE → POSTED. HMAC-SHA256 over timestamp.eventId.rawBody." }),
      h("div", { class: "detail-grid" }, [
        h("section", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Run timeline" }), statusPill(intent.status)]),
          h("div", { class: "card-b" }, [list])
        ]),
        h("div", { class: "stack" }, [
          h("section", { class: "card" }, [
            h("div", { class: "card-h" }, [h("h2", { text: "Intent summary" })]),
            h("div", { class: "card-b" }, [
              h("dl", { class: "meta-list" }, [
                meta("Direction", h("span", {}, [typePill(intent.direction), document.createTextNode(intent.direction === "DEBIT" ? "" : "")])),
                meta("Channel", channelTag(intent.channel)),
                meta("Amount", h("span", { class: "amt", text: model.formatUgx(intent.amount) })),
                meta("Member", h("span", { text: model.displayName(intent) + (intent.externalReference ? " · " + intent.externalReference : "") })),
                meta("Product", h("span", { text: intent.product || "—" })),
                meta("Intent status", statusPill(intent.status)),
                meta("Provider", h("span", { text: intent.providerStatus || "—" })),
                meta("Core", h("span", { text: intent.coreStatus || "—" }))
              ])
            ])
          ]),
          h("section", { class: "card" }, [
            h("div", { class: "card-h" }, [h("h2", { text: "Security refs" })]),
            h("div", { class: "card-b" }, [
              h("dl", { class: "meta-list" }, [
                meta("Idempotency", h("span", { class: "mono", text: intent.idempotencyKey || "—" })),
                meta("Intent ID", h("span", { class: "mono", text: intent.intentId })),
                meta("Event ID", h("span", { class: "mono", text: intent.webhookEventId || "—" })),
                meta("HMAC", h("span", { class: "mono", text: intent.hmacRef || "—" })),
                meta("Provider ref", h("span", { class: "mono", text: intent.providerReference || "—" }))
              ])
            ])
          ])
        ])
      ])
    ];
  }

  function copyRefs(intent) {
    var text = [
      "Idempotency-Key: " + (intent.idempotencyKey || ""),
      "Intent: " + intent.intentId,
      "Event: " + (intent.webhookEventId || ""),
      "HMAC: " + (intent.hmacRef || ""),
      "Provider: " + (intent.providerReference || "")
    ].join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Refs copied.", "success");
      }).catch(function () { toast(text); });
    } else toast("Refs ready in the security card.");
  }

  function openRetry(intent) {
    var note = h("textarea", { id: "retry-note", rows: "3", placeholder: "Why this run should be retried" });
    var confirm = h("input", { id: "retry-confirm", type: "checkbox", checked: "checked" });
    var dialog = h("dialog", { class: "pay-dialog" }, [
      h("form", {}, [
        h("h2", { text: "Retry failed run" }),
        h("p", { text: "On the gateway this calls resolve with allow_single_retry. On the demo book the timeline moves forward in this session only." }),
        h("div", { class: "field" }, [h("label", { for: "retry-note", text: "Operator note" }), note]),
        h("label", {}, [confirm, document.createTextNode(" Confirm the earlier attempt did not post")]),
        h("div", { class: "form-actions" }, [
          h("button", { class: "btn btn-amber", type: "submit", text: "Retry" }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: function () { dialog.close(); } })
        ])
      ])
    ]);
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      submitRetry(intent, note.value.trim(), confirm.checked, dialog);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  async function submitRetry(intent, note, confirmed, dialog) {
    if (note.length < 8) {
      toast("The note needs at least 8 characters.", "error");
      return;
    }
    if (!confirmed) {
      toast("Confirm the earlier attempt did not post.", "error");
      return;
    }
    if (book.source === "gateway") {
      try {
        var response = await fetch("/payments/internal/intents/" + encodeURIComponent(intent.intentId) + "/resolve", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "X-Internal-Api-Key": readStore(KEY)
          },
          body: JSON.stringify({ action: "allow_single_retry", note: note, confirmNotPosted: true })
        });
        var body = null;
        try { body = await response.json(); } catch (e) { body = null; }
        if (!response.ok) {
          toast(String((body && (body.message || body.code)) || ("Retry failed (" + response.status + ")")), "error");
          return;
        }
        toast("Retry accepted by the gateway.", "success");
        dialog.close();
        boot();
      } catch (e) {
        toast("The gateway could not accept the retry.", "error");
      }
      return;
    }
    var local = overrides();
    local[intent.intentId] = Object.assign({}, local[intent.intentId] || {}, model.retryPatch(intent, note));
    writeStore(OVERRIDES, JSON.stringify(local));
    toast("Retry recorded on the demo book.", "success");
    dialog.close();
    boot();
  }

  function openInitiate() {
    var channel = h("select", { id: "init-channel" }, selectOptions([
      ["MTN_MOMO", "MTN MoMo"], ["AIRTEL_MONEY", "Airtel Money"], ["BANK", "Bank"], ["CARD", "Card"]
    ], "MTN_MOMO"));
    var direction = h("select", { id: "init-direction" }, selectOptions([
      ["CREDIT", "Collect (CREDIT)"], ["DEBIT", "Disburse (DEBIT)"]
    ], "CREDIT"));
    var product = h("select", { id: "init-product" }, selectOptions([
      ["SAVINGS_DEPOSIT", "Savings deposit"],
      ["SAVINGS_WITHDRAWAL", "Savings withdrawal"],
      ["LOAN_REPAYMENT", "Loan repayment"]
    ], "SAVINGS_DEPOSIT"));
    var amount = h("input", { id: "init-amount", inputmode: "numeric", value: "50000" });
    var partner = h("input", { id: "init-partner", type: "password", autocomplete: "off", placeholder: "Optional X-Api-Key" });
    var dialog = h("dialog", { class: "pay-dialog" }, [
      h("form", {}, [
        h("h2", { text: "Initiate payment" }),
        h("p", { text: "With a partner key this posts /payments/v1/payments/initiate. Without one, the row is added to the demo book in this session. Currency is UGX. No MoMo or Airtel secrets." }),
        h("div", { class: "field" }, [h("label", { text: "Channel" }), channel]),
        h("div", { class: "field" }, [h("label", { text: "Direction" }), direction]),
        h("div", { class: "field" }, [h("label", { text: "Product" }), product]),
        h("div", { class: "field" }, [h("label", { text: "Amount (UGX)" }), amount]),
        h("div", { class: "field" }, [h("label", { text: "Partner key" }), partner]),
        h("div", { class: "form-actions" }, [
          h("button", { class: "btn", type: "submit", text: "Initiate" }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: function () { dialog.close(); } })
        ])
      ])
    ]);
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      var whole = String(amount.value || "").replace(/\D/g, "");
      if (!whole || whole === "0") {
        toast("Enter a whole shilling amount.", "error");
        return;
      }
      var fields = { channel: channel.value, direction: direction.value, product: product.value, amount: whole };
      if (direction.value === "DEBIT") fields.product = "SAVINGS_WITHDRAWAL";
      if (direction.value === "CREDIT" && fields.product === "SAVINGS_WITHDRAWAL") fields.product = "SAVINGS_DEPOSIT";
      var key = partner.value.trim() || readStore(PARTNER);
      if (partner.value.trim()) writeStore(PARTNER, partner.value.trim());
      dialog.close();
      if (key) initiateGateway(fields, key);
      else initiateDemo(fields);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function initiateDemo(fields) {
    var stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    var id = "pi_" + Math.random().toString(16).slice(2, 8);
    var row = {
      intentId: id,
      status: "INITIATED",
      coreStatus: "NOT_POSTED",
      providerStatus: "NONE",
      channel: fields.channel,
      direction: fields.direction,
      product: fields.product,
      amount: fields.amount,
      currency: "UGX",
      memberName: "Demo member",
      externalReference: "KLA-DEMO",
      idempotencyKey: "idem-demo-" + id,
      createdAt: stamp,
      updatedAt: stamp
    };
    var list = extras();
    list.unshift(row);
    writeStore(EXTRA, JSON.stringify(list));
    toast("Added " + id + " to the demo book.", "success");
    boot();
  }

  async function initiateGateway(fields, key) {
    var idem = "idem-portal-" + Date.now().toString(36);
    try {
      var response = await fetch("/payments/v1/payments/initiate", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "X-Api-Key": key,
          "Idempotency-Key": idem
        },
        body: JSON.stringify({
          channel: fields.channel,
          direction: fields.direction,
          product: fields.product,
          amount: fields.amount,
          currency: "UGX",
          externalReference: idem,
          narration: "Phaneroo portal initiate"
        })
      });
      var body = null;
      try { body = await response.json(); } catch (e) { body = null; }
      if (!response.ok) {
        toast(String((body && (body.message || body.code)) || ("Initiate failed (" + response.status + ")")), "error");
        return;
      }
      toast("Gateway accepted " + (body && body.intentId ? body.intentId : "the intent") + ".", "success");
      boot();
    } catch (e) {
      toast("The gateway could not be reached.", "error");
    }
  }

  function renderReports() {
    var q = query();
    var window = model.bookWindow(book.intents);
    if (!q.from && !q.to && !new URLSearchParams(location.search).has("from")) {
      q.from = window.from;
      q.to = window.to;
    }
    var rows = model.filterIntents(book.intents, q);
    var summary = model.summarize(rows);
    var from = h("input", { type: "date", value: q.from, "aria-label": "Date from" });
    var to = h("input", { type: "date", value: q.to, "aria-label": "Date to" });
    var channel = h("select", { "aria-label": "Channel" }, selectOptions([
      ["", "All channels"], ["MTN_MOMO", "MTN MoMo"], ["AIRTEL_MONEY", "Airtel Money"], ["BANK", "Bank"], ["CARD", "Card"]
    ], q.channel));
    var direction = h("select", { "aria-label": "Direction" }, selectOptions([
      ["", "All"], ["CREDIT", "Collections"], ["DEBIT", "Disbursements"]
    ], q.direction));
    var form = h("form", { class: "filters", id: "report-filters" }, [
      h("div", { class: "field" }, [h("label", { text: "Date from" }), from]),
      h("div", { class: "field" }, [h("label", { text: "Date to" }), to]),
      h("div", { class: "field" }, [h("label", { text: "Channel" }), channel]),
      h("div", { class: "field" }, [h("label", { text: "Direction" }), direction]),
      h("div", { class: "field", style: "min-width:auto" }, [
        h("label", { text: "\u00a0" }),
        h("button", { class: "btn btn-sm", type: "submit", text: "Run report" })
      ])
    ]);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      writeQuery({ from: from.value, to: to.value, channel: channel.value, direction: direction.value });
      paint();
    });
    var maxVol = 1;
    model.CHANNELS.forEach(function (ch) { maxVol = Math.max(maxVol, summary.byChannel[ch.id].volume); });
    var chart = h("div", { class: "chart-placeholder" });
    model.CHANNELS.forEach(function (ch) {
      var row = summary.byChannel[ch.id];
      var visual = model.channelVisual(ch.id);
      var height = Math.max(8, Math.round((row.volume / maxVol) * 160));
      chart.appendChild(h("div", { class: "bar-col" }, [
        h("div", { class: "bar " + visual.slug, style: "height:" + height + "px" }),
        h("span", { class: "bar-label", text: visual.short === "ATL" ? "Airtel" : visual.label.split(" ")[0] })
      ]));
    });
    var rates = h("div", {});
    model.CHANNELS.forEach(function (ch) {
      var row = summary.byChannel[ch.id];
      var visual = model.channelVisual(ch.id);
      var rate = row.count ? ((row.posted / row.count) * 100) : 0;
      rates.appendChild(mixRow(visual.label, Math.round(rate), row.count ? rate.toFixed(1) + "%" : "—", visual.slug));
    });
    var packs = model.settlementPacks(rows).slice(0, 8);
    var body = h("tbody");
    if (!packs.length) body.appendChild(h("tr", {}, [h("td", { colspan: "7", class: "empty-hint", text: "No settlement packs in this range." })]));
    packs.forEach(function (pack) {
      var settled = pack.posted >= pack.volume && pack.count > 0;
      body.appendChild(h("tr", {}, [
        h("td", { class: "mono", text: pack.id }),
        h("td", { text: model.formatDay(pack.day) }),
        h("td", { text: model.channelLabel(pack.channel) }),
        h("td", { text: String(pack.count) }),
        h("td", { class: "amt", text: model.formatAmount(pack.volume) }),
        h("td", { class: "amt", text: model.formatAmount(pack.posted) }),
        h("td", {}, [h("span", { class: "status " + (settled ? "posted" : "awaiting"), text: settled ? "Settled" : "Open" })])
      ]));
    });
    var range = (q.from && q.to) ? model.formatDay(q.from) + " – " + model.formatDay(q.to) : "All dates";
    var inflight = Math.max(summary.volumeAll - summary.volumePosted, 0);
    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Reports" }),
          h("p", { class: "page-sub", text: "Volume by channel, success rate, and settlement packs — export from the book on screen." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-amber", type: "button", text: "↓ Export CSV", onclick: function () { exportCsv(rows); } })
        ])
      ]),
      form,
      h("div", { class: "kpi-grid", style: "grid-template-columns:repeat(4,1fr)" }, [
        kpi("Gross volume", "UGX " + model.compactNumber(summary.volumeAll), range),
        kpi("Success rate", summary.successRate.toFixed(1) + "%", summary.posted + " posted", "green", "up"),
        kpi("Settled to core", "UGX " + model.compactNumber(summary.volumePosted), "Fineract POSTED", "amber"),
        kpi("In flight / failed", "UGX " + model.compactNumber(inflight), "Pending + declined", "warn")
      ]),
      h("div", { class: "grid-2" }, [
        h("section", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Volume by channel (UGX M)" }), h("span", { class: "chip", text: range })]),
          h("div", { class: "card-b" }, [chart])
        ]),
        h("section", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Success rate by channel" })]),
          h("div", { class: "card-b" }, [rates])
        ])
      ]),
      h("section", { class: "card" }, [
        h("div", { class: "card-h" }, [
          h("h2", { text: "Settlement packs" }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "↓ Export CSV", onclick: function () { exportPacks(packs); } })
        ]),
        h("div", { class: "table-wrap" }, [
          h("table", { class: "data" }, [
            h("thead", {}, [h("tr", {}, ["Pack ID", "Date", "Channel", "Txns", "Volume (UGX)", "Core posted", "Status"].map(function (label) {
              return h("th", { scope: "col", text: label });
            }))]),
            body
          ])
        ])
      ])
    ];
  }

  function exportCsv(rows) {
    download("phaneroo-payments.csv", model.toCsv(rows));
    toast("Exported " + rows.length + " rows.", "success");
  }

  function exportPacks(packs) {
    var lines = ["packId,date,channel,txns,volume,corePosted,status"];
    packs.forEach(function (pack) {
      var settled = pack.posted >= pack.volume && pack.count > 0;
      lines.push([pack.id, pack.day, pack.channel, pack.count, pack.volume, pack.posted, settled ? "Settled" : "Open"].join(","));
    });
    download("phaneroo-settlement-packs.csv", lines.join("\n") + "\n");
    toast("Exported " + packs.length + " packs.", "success");
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = h("a", { href: url, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderChannels() {
    var summary = model.summarize(book.intents);
    var today = model.latestDay(book.intents);
    var todaySum = model.summarize(model.onDay(book.intents, today));
    var cards = model.CHANNELS.map(function (ch) {
      var visual = model.channelVisual(ch.id);
      var row = summary.byChannel[ch.id];
      var todayRow = todaySum.byChannel[ch.id];
      var rate = row.count ? ((row.posted / row.count) * 100).toFixed(1) + "%" : "—";
      var mode = model.modeFor(ch.id, book.health);
      var extra = ch.id === "BANK"
        ? [["Account ref", "PHS-UG-****4421"], ["Settlement", mode === "live" ? "T+1" : "T+1 " + (mode || "mock")]]
        : ch.id === "CARD"
          ? [["PSP", "reference only"], ["PAN / CVV", "rejected"]]
          : [["HMAC", "X-Channel-Signature · SHA-256"], ["Callback base", "/payments"]];
      var cfg = h("div", {}, [
        h("div", { class: "cfg-row" }, [h("span", { text: "Webhook" }), h("span", { text: HOOKS[ch.id] })]),
        h("div", { class: "cfg-row" }, [h("span", { text: extra[0][0] }), h("span", { text: extra[0][1] })]),
        h("div", { class: "cfg-row" }, [h("span", { text: extra[1][0] }), h("span", { text: extra[1][1] })]),
        h("div", { class: "cfg-row" }, [h("span", { text: "Currency" }), h("span", { text: "UGX" })])
      ]);
      return h("article", { class: "channel-tile" }, [
        h("div", { class: "channel-head" }, [
          h("div", { class: "channel-brand" }, [
            h("div", { class: "channel-logo " + visual.slug, text: visual.short }),
            h("div", {}, [
              h("h2", { class: "channel-name", text: visual.label }),
              h("p", { class: "channel-sub", text: ch.id + " · " + ch.blurb })
            ])
          ]),
          modeBadge(mode)
        ]),
        h("div", { class: "channel-stats" }, [
          h("div", { class: "stat-box" }, [h("div", { class: "v", text: rate }), h("div", { class: "l", text: "Success" })]),
          h("div", { class: "stat-box" }, [h("div", { class: "v", text: String(todayRow.count) }), h("div", { class: "l", text: "Today" })]),
          h("div", { class: "stat-box" }, [h("div", { class: "v", text: model.compactNumber(row.volume) }), h("div", { class: "l", text: "UGX vol" })])
        ]),
        cfg
      ]);
    });
    var health = book.health;
    var healthRows = h("div", {});
    if (health) {
      var mode = health.mode || {};
      [
        ["Status", health.status || "ok"],
        ["Service", health.service || "payments"],
        ["Channel", mode.channel || "—"],
        ["MTN MoMo", mode.mtnMomo || mode.channel || "—"],
        ["Airtel Money", mode.airtelMoney || mode.channel || "—"],
        ["Fineract", mode.fineract || "—"],
        ["Database", health.checks && health.checks.database ? health.checks.database : "—"]
      ].forEach(function (pair) {
        healthRows.appendChild(h("div", { class: "cfg-row" }, [h("span", { text: pair[0] }), h("span", { text: String(pair[1]) })]));
      });
    } else {
      healthRows.appendChild(h("p", { class: "page-sub", text: "This host did not return /payments/health. Badges stay unconfirmed until the portal is opened beside the gateway." }));
    }
    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Channels" }),
          h("p", { class: "page-sub", text: "MoMo / Airtel / bank / card adapters fronting the payments gateway. Mode badges come from /payments/health." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", disabled: "disabled", title: "Channel config is read from the gateway", text: "Edit config" })
        ])
      ]),
      h("div", { class: "notice", text: "Read-only. Cash stays on the teller desk. Webhook paths are the live gateway routes. No channel secrets are shown." }),
      h("div", { class: "channel-grid" }, cards),
      h("section", { class: "card", id: "health" }, [
        h("div", { class: "card-h" }, [
          h("h2", { text: "Gateway health" }),
          h("a", { href: "/payments/docs", target: "_blank", rel: "noopener", text: "API docs" })
        ]),
        h("div", { class: "card-b" }, [healthRows])
      ])
    ];
  }

  function paint() {
    if (!book) return;
    fillChrome();
    var root = document.getElementById("portal-root");
    root.textContent = "";
    var nodes = [];
    if (page === "overview") nodes = renderOverview();
    else if (page === "payments") nodes = renderPayments();
    else if (page === "payment") nodes = renderDetail();
    else if (page === "reports") nodes = renderReports();
    else if (page === "channels") nodes = renderChannels();
    nodes.forEach(function (node) { if (node) root.appendChild(node); });
    if (location.hash === "#health") {
      var health = document.getElementById("health");
      if (health) health.scrollIntoView();
    }
  }

  async function boot() {
    var root = document.getElementById("portal-root");
    if (root) root.textContent = "Loading payments…";
    try {
      book = await loadBook();
      if (page === "payment" && book.source === "gateway" && query().id && readStore(KEY)) {
        var response = await fetch("/payments/internal/intents/" + encodeURIComponent(query().id), {
          headers: { accept: "application/json", "X-Internal-Api-Key": readStore(KEY) }
        });
        if (response.ok) {
          var fresh = model.normalizeIntent(await response.json());
          var found = false;
          book.intents = book.intents.map(function (row) {
            if (row.intentId === fresh.intentId) { found = true; return fresh; }
            return row;
          });
          if (!found) book.intents.unshift(fresh);
        }
      }
      paint();
    } catch (e) {
      if (root) {
        root.textContent = "";
        root.appendChild(h("div", { class: "empty-hint", text: "The payments book could not be loaded." }));
      }
    }
  }

  markNav();
  boot();
})();
