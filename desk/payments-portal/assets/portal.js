/* Phaneroo payments portal. Reads the gateway when an internal key is stored, otherwise the demo book. */
(function () {
  "use strict";

  var model = window.PaymentsModel;
  var KEY = "paymentsPortal.internalKey";
  var OVERRIDES = "paymentsPortal.overrides";
  var page = document.body.getAttribute("data-page") || "overview";

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

  function query() {
    var params = new URLSearchParams(location.search);
    return {
      text: params.get("q") || "",
      channel: params.get("channel") || "",
      direction: params.get("direction") || "",
      status: params.get("status") || "",
      from: params.get("from") || "",
      to: params.get("to") || "",
      id: params.get("id") || ""
    };
  }

  function writeQuery(next) {
    var params = new URLSearchParams();
    Object.keys(next).forEach(function (key) {
      if (next[key]) params.set(key === "text" ? "q" : key, next[key]);
    });
    var search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? "?" + search : ""));
  }

  function statusPill(status) {
    return h("span", { class: "status " + model.statusClass(status), text: model.statusLabel(status) });
  }

  function modeBadge(mode) {
    var label = mode || "unconfirmed";
    var text = mode ? mode : "Unconfirmed";
    return h("span", { class: "mode-badge " + label, text: text });
  }

  function markNav() {
    var nav = page === "payment" ? "payments" : page;
    document.querySelectorAll(".nav-link[data-nav]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-nav") === nav);
    });
    var toggle = document.querySelector("[data-toggle-sidebar]");
    var sidebar = document.querySelector(".sidebar");
    if (toggle && sidebar) {
      toggle.addEventListener("click", function () { sidebar.classList.toggle("open"); });
    }
  }

  function keyButton() {
    var button = document.getElementById("gateway-key-btn");
    if (!button) return;
    button.textContent = readStore(KEY) ? "Gateway key" : "Demo book";
    button.addEventListener("click", openKeyDialog);
  }

  function openKeyDialog() {
    var existing = document.getElementById("key-dialog");
    if (existing) existing.remove();
    var input = h("input", {
      id: "gateway-key-input",
      type: "password",
      autocomplete: "off",
      placeholder: "X-Internal-Api-Key",
      value: ""
    });
    var dialog = h("dialog", { id: "key-dialog", class: "pay-dialog" }, [
      h("form", { method: "dialog" }, [
        h("h2", { text: "Payments gateway" }),
        h("p", { text: "Paste the internal operator key to read /payments/internal/intents. It stays in this browser session and is never written into the page." }),
        h("div", { class: "form-row" }, [
          h("label", { for: "gateway-key-input", text: "Internal API key" }),
          input
        ]),
        h("div", { class: "form-actions" }, [
          h("button", { class: "btn", type: "submit", text: "Use gateway" }),
          h("button", {
            class: "btn btn-ghost",
            type: "button",
            text: "Use demo book",
            onclick: function () {
              writeStore(KEY, "");
              dialog.close();
              boot();
            }
          }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Close", onclick: function () { dialog.close(); } })
        ])
      ])
    ]);
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!value) {
        toast("Enter the internal key, or choose the demo book.", "error");
        return;
      }
      writeStore(KEY, value);
      dialog.close();
      boot();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
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
      }).sort(model.byNewest);
      source = "fixture";
    }
    return { health: health, intents: intents, source: source, gatewayError: gatewayError };
  }

  function banner(book) {
    var mode = model.modeFor("MTN_MOMO", book.health) || (book.health ? "" : "");
    var healthText = book.health
      ? "Gateway health is " + (book.health.status || "ok") + (mode ? ", MoMo " + mode : "") + "."
      : "Gateway health was not read from this host.";
    if (book.source === "gateway") {
      return h("div", { class: "pay-banner gateway", text: "Showing " + book.intents.length + " intents from the payments gateway. " + healthText });
    }
    var text = "Showing the demo book (" + book.intents.length + " UGX intents across MoMo, Airtel, bank, and card). " + healthText;
    if (book.gatewayError) text = book.gatewayError + " " + text;
    var node = h("div", { class: "pay-banner" });
    node.appendChild(document.createTextNode(text + " "));
    node.appendChild(h("a", { href: "/payments/docs", target: "_blank", rel: "noopener", text: "API docs" }));
    return node;
  }

  function pageHeader(title, sub, actions) {
    return h("div", { class: "page-header" }, [
      h("div", {}, [h("h1", { text: title }), h("p", { class: "page-sub", text: sub })]),
      actions ? h("div", { class: "btn-group" }, actions) : null
    ]);
  }

  function kpi(label, value, meta, accent) {
    return h("div", { class: "kpi-card" + (accent ? " " + accent : "") }, [
      h("div", { class: "kpi-label", text: label }),
      h("div", { class: "kpi-value", text: value }),
      meta ? h("div", { class: "kpi-meta", text: meta }) : null
    ]);
  }

  function renderOverview(book) {
    var summary = model.summarize(book.intents);
    var latestDay = summary.byDay.length ? summary.byDay[summary.byDay.length - 1] : null;
    var maxCount = 1;
    model.CHANNELS.forEach(function (ch) {
      maxCount = Math.max(maxCount, summary.byChannel[ch.id].count);
    });
    var mix = h("div", {});
    model.CHANNELS.forEach(function (ch, index) {
      var row = summary.byChannel[ch.id];
      var width = Math.round((row.count / maxCount) * 100);
      mix.appendChild(h("div", { class: "mix-row" }, [
        h("span", { text: ch.label }),
        h("div", { class: "mix-bar" + (index % 2 ? " amber" : ""), title: row.count + " intents" }, [
          h("span", { style: "width:" + width + "%" })
        ]),
        h("span", { class: "mono", text: String(row.count) })
      ]));
    });
    var feed = h("ul", { class: "feed-list" });
    book.intents.slice(0, 8).forEach(function (row) {
      feed.appendChild(h("li", {}, [
        h("span", { class: "text-muted", text: model.formatWhen(row.createdAt) }),
        h("span", {}, [
          h("a", { href: "payment.html?id=" + encodeURIComponent(row.intentId), text: model.displayName(row) }),
          document.createTextNode(" · " + model.channelLabel(row.channel) + " · " + model.directionLabel(row.direction))
        ]),
        h("span", {}, [
          h("span", { class: "mono", text: model.formatUgx(row.amount) }),
          document.createTextNode(" "),
          statusPill(row.status)
        ])
      ]));
    });
    return [
      banner(book),
      pageHeader("Overview", "Payments middleware · Uganda shillings", [
        h("a", { class: "btn btn-ghost", href: "payments.html", text: "All payments" })
      ]),
      h("div", { class: "kpi-grid" }, [
        kpi("Intents", String(summary.count), "Demo or gateway book", "teal"),
        kpi("Posted volume", model.formatUgx(summary.volumePosted), summary.posted + " posted", "teal"),
        kpi("Success", summary.successRate.toFixed(1) + "%", "Posted ÷ all intents", "accent"),
        kpi("Pending", String(summary.pending), "Initiated, channel, or posting"),
        kpi("Failed", String(summary.failed), "Declined, rejected, or ambiguous", "accent"),
        kpi("Latest day", latestDay ? String(latestDay.count) : "—", latestDay ? latestDay.day + " · " + model.formatUgx(latestDay.volume) : "", "teal")
      ]),
      h("div", { class: "grid-2" }, [
        h("div", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Channel mix" })]),
          h("div", { class: "card-b" }, [mix])
        ]),
        h("div", { class: "card" }, [
          h("div", { class: "card-h" }, [
            h("h2", { text: "Recent runs" }),
            h("a", { class: "btn btn-sm btn-ghost", href: "payments.html", text: "Table" })
          ]),
          h("div", { class: "card-b" }, [feed])
        ])
      ])
    ];
  }

  function selectOptions(options, current) {
    return options.map(function (opt) {
      return h("option", { value: opt[0], selected: opt[0] === current ? "selected" : null, text: opt[1] });
    });
  }

  function renderPayments(book) {
    var q = query();
    var rows = model.filterIntents(book.intents, q);
    var text = h("input", { type: "search", name: "q", value: q.text, placeholder: "Member, intent, MSISDN, idempotency", "aria-label": "Search payments" });
    var channel = h("select", { name: "channel" }, selectOptions([
      ["", "All channels"],
      ["MTN_MOMO", "MTN MoMo"],
      ["AIRTEL_MONEY", "Airtel Money"],
      ["BANK", "Bank"],
      ["CARD", "Card"]
    ], q.channel));
    var direction = h("select", { name: "direction" }, selectOptions([
      ["", "Collect and disburse"],
      ["CREDIT", "Collect"],
      ["DEBIT", "Disburse"]
    ], q.direction));
    var status = h("select", { name: "status" }, selectOptions([
      ["", "Any status"],
      ["posted", "Posted"],
      ["pending", "Pending"],
      ["failed", "Failed"]
    ], q.status));
    var form = h("form", { class: "filters", id: "pay-filters" }, [
      text, channel, direction, status,
      h("button", { class: "btn btn-sm", type: "submit", text: "Filter" }),
      h("a", { class: "btn btn-sm btn-ghost", href: "payments.html", text: "Reset" })
    ]);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      writeQuery({
        text: text.value.trim(),
        channel: channel.value,
        direction: direction.value,
        status: status.value
      });
      paint(book);
    });
    var body = h("tbody");
    if (!rows.length) {
      body.appendChild(h("tr", {}, [h("td", { colspan: "8", class: "empty-row", text: "No payments match these filters." })]));
    }
    rows.forEach(function (row) {
      var tr = h("tr", {
        "data-href": "payment.html?id=" + encodeURIComponent(row.intentId),
        onclick: function () { location.href = tr.getAttribute("data-href"); }
      }, [
        h("td", { class: "mono", text: model.formatWhen(row.createdAt) }),
        h("td", {}, [h("a", { href: "payment.html?id=" + encodeURIComponent(row.intentId), text: row.intentId })]),
        h("td", {}, [
          h("div", { text: model.displayName(row) }),
          h("div", { class: "text-muted small-note", text: row.msisdn || row.externalReference || "" })
        ]),
        h("td", { text: model.channelLabel(row.channel) }),
        h("td", { text: model.directionLabel(row.direction) }),
        h("td", { text: model.productLabel(row.product) }),
        h("td", { class: "mono text-right", text: model.formatUgx(row.amount) }),
        h("td", {}, [statusPill(row.status)])
      ]);
      body.appendChild(tr);
    });
    return [
      banner(book),
      pageHeader("Payments", rows.length + " of " + book.intents.length + " · UGX"),
      form,
      h("div", { class: "card" }, [
        h("div", { class: "table-wrap" }, [
          h("table", { class: "data" }, [
            h("thead", {}, [h("tr", {}, ["When", "Intent", "Member", "Channel", "Flow", "Product", "Amount", "Status"].map(function (label) {
              return h("th", { scope: "col", class: label === "Amount" ? "text-right" : "", text: label });
            }))]),
            body
          ])
        ])
      ])
    ];
  }

  function findIntent(book, id) {
    for (var i = 0; i < book.intents.length; i++) {
      if (book.intents[i].intentId === id) return book.intents[i];
    }
    return null;
  }

  async function refreshOne(book, id) {
    var key = readStore(KEY);
    if (book.source !== "gateway" || !key) return findIntent(book, id);
    var response = await fetch("/payments/internal/intents/" + encodeURIComponent(id), {
      headers: { accept: "application/json", "X-Internal-Api-Key": key }
    });
    if (!response.ok) return findIntent(book, id);
    return model.normalizeIntent(await response.json());
  }

  function renderDetail(book, intent) {
    var steps = h("ol", { class: "pay-timeline" });
    model.timeline(intent).forEach(function (step) {
      steps.appendChild(h("li", { class: step.state }, [
        h("div", { class: "step-label", text: step.label }),
        h("div", { class: "step-detail", text: step.detail })
      ]));
    });
    var refs = h("div", { class: "ref-list" });
    [
      ["Idempotency-Key", intent.idempotencyKey],
      ["Webhook event", intent.webhookEventId],
      ["HMAC ref", intent.hmacRef],
      ["Provider ref", intent.providerReference],
      ["Provider txn", intent.providerTransactionId],
      ["Fineract txn", intent.fineractTransactionId],
      ["External ref", intent.externalReference],
      ["Failure", intent.failureCode]
    ].forEach(function (pair) {
      if (!pair[1]) return;
      refs.appendChild(h("div", {}, [
        h("span", { class: "k", text: pair[0] }),
        h("span", { class: "v", text: pair[1] })
      ]));
    });
    var retryBox = null;
    if (model.canRetry(intent)) {
      var note = h("textarea", { id: "retry-note", rows: "3", required: "required", minlength: "8", placeholder: "Why this run should be retried" });
      var confirm = h("input", { id: "retry-confirm", type: "checkbox", checked: "checked" });
      var form = h("form", { class: "form-grid" }, [
        h("div", { class: "form-row full" }, [
          h("label", { for: "retry-note", text: "Operator note" }),
          note
        ]),
        h("label", { class: "form-row full", for: "retry-confirm" }, [
          confirm,
          document.createTextNode(" Confirm the earlier attempt did not post")
        ]),
        h("div", { class: "form-actions full" }, [
          h("button", { class: "btn btn-amber", type: "submit", text: "Retry failed run" })
        ])
      ]);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitRetry(book, intent, note.value.trim(), confirm.checked);
      });
      retryBox = h("div", { class: "card" }, [
        h("div", { class: "card-h" }, [h("h2", { text: "Retry" })]),
        h("div", { class: "card-b" }, [
          h("p", { class: "page-sub", text: "Failed runs can be retried. On the gateway this calls resolve with allow_single_retry. On the demo book the timeline moves forward in this session only." }),
          form
        ])
      ]);
    }
    return [
      banner(book),
      pageHeader(intent.intentId, model.displayName(intent) + " · " + model.channelLabel(intent.channel), [
        h("a", { class: "btn btn-ghost", href: "payments.html", text: "Back to payments" })
      ]),
      h("div", { class: "kpi-grid" }, [
        kpi("Amount", model.formatUgx(intent.amount), intent.currency, "teal"),
        kpi("Flow", model.directionLabel(intent.direction), model.productLabel(intent.product), "accent"),
        kpi("Status", model.statusLabel(intent.status), intent.coreStatus || intent.providerStatus || ""),
        kpi("Updated", model.formatWhen(intent.updatedAt), "Africa/Kampala")
      ]),
      h("div", { class: "grid-2" }, [
        h("div", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Run timeline" })]),
          h("div", { class: "card-b" }, [steps])
        ]),
        h("div", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Idempotency and HMAC" })]),
          h("div", { class: "card-b" }, [
            h("p", { class: "page-sub", text: "Signed callbacks use HMAC-SHA256 over timestamp.eventId.rawBody. The header is X-Channel-Signature: v1=. Demo refs are not channel secrets." }),
            refs
          ])
        ])
      ]),
      retryBox
    ];
  }

  async function submitRetry(book, intent, note, confirmed) {
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
          body: JSON.stringify({
            action: "allow_single_retry",
            note: note,
            confirmNotPosted: true
          })
        });
        var body = null;
        try { body = await response.json(); } catch (e) { body = null; }
        if (!response.ok) {
          var message = body && (body.message || body.code) ? (body.message || body.code) : ("Retry failed (" + response.status + ")");
          toast(String(message), "error");
          return;
        }
        toast("Retry accepted by the gateway.", "success");
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
    boot();
  }

  function renderReports(book) {
    var q = query();
    var window = model.bookWindow(book.intents);
    if (!q.from && !q.to && !new URLSearchParams(location.search).has("from")) {
      q.from = window.from;
      q.to = window.to;
    }
    var rows = model.filterIntents(book.intents, q);
    var summary = model.summarize(rows);
    var from = h("input", { type: "date", name: "from", value: q.from });
    var to = h("input", { type: "date", name: "to", value: q.to });
    var channel = h("select", { name: "channel" }, selectOptions([
      ["", "All channels"],
      ["MTN_MOMO", "MTN MoMo"],
      ["AIRTEL_MONEY", "Airtel Money"],
      ["BANK", "Bank"],
      ["CARD", "Card"]
    ], q.channel));
    var form = h("form", { class: "filters" }, [
      h("label", {}, ["From ", from]),
      h("label", {}, ["To ", to]),
      channel,
      h("button", { class: "btn btn-sm", type: "submit", text: "Apply" }),
      h("button", {
        class: "btn btn-sm btn-amber",
        type: "button",
        text: "Export CSV",
        onclick: function () { exportCsv(rows); }
      })
    ]);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      writeQuery({ from: from.value, to: to.value, channel: channel.value });
      paint(book);
    });
    var maxVol = 1;
    summary.byDay.forEach(function (day) { maxVol = Math.max(maxVol, day.volume); });
    var days = h("div", {});
    summary.byDay.forEach(function (day, index) {
      var width = Math.max(2, Math.round((day.volume / maxVol) * 100));
      days.appendChild(h("div", { class: "mix-row" }, [
        h("span", { class: "mono", text: day.day.slice(5) }),
        h("div", { class: "mix-bar" + (index % 2 ? " amber" : "") }, [h("span", { style: "width:" + width + "%" })]),
        h("span", { class: "mono", text: model.formatUgx(day.volume) })
      ]));
    });
    if (!summary.byDay.length) days.appendChild(h("p", { class: "empty-hint", text: "No volume in this range." }));
    var body = h("tbody");
    model.CHANNELS.forEach(function (ch) {
      var row = summary.byChannel[ch.id];
      var rate = row.count ? ((row.posted / row.count) * 100).toFixed(1) + "%" : "—";
      body.appendChild(h("tr", {}, [
        h("td", { text: ch.label }),
        h("td", { class: "mono text-right", text: String(row.count) }),
        h("td", { class: "mono text-right", text: String(row.posted) }),
        h("td", { class: "mono text-right", text: String(row.failed) }),
        h("td", { class: "mono text-right", text: rate }),
        h("td", { class: "mono text-right", text: model.formatUgx(row.volume) })
      ]));
    });
    return [
      banner(book),
      pageHeader("Reports", "Volume and success · client-side CSV", [
        h("span", { class: "chip amber", text: "UGX" })
      ]),
      form,
      h("div", { class: "kpi-grid" }, [
        kpi("Intents", String(summary.count), q.from && q.to ? q.from + " → " + q.to : "All dates", "teal"),
        kpi("Volume", model.formatUgx(summary.volumeAll), "Collect " + model.formatUgx(summary.collect), "teal"),
        kpi("Posted", model.formatUgx(summary.volumePosted), summary.posted + " successful", "accent"),
        kpi("Success", summary.successRate.toFixed(1) + "%", summary.failed + " failed")
      ]),
      h("div", { class: "grid-2" }, [
        h("div", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Daily volume" })]),
          h("div", { class: "card-b" }, [days])
        ]),
        h("div", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "By channel" })]),
          h("div", { class: "table-wrap" }, [
            h("table", { class: "data" }, [
              h("thead", {}, [h("tr", {}, ["Channel", "Count", "Posted", "Failed", "Success", "Volume"].map(function (label, index) {
                return h("th", { scope: "col", class: index ? "text-right" : "", text: label });
              }))]),
              body
            ])
          ])
        ])
      ])
    ];
  }

  function exportCsv(rows) {
    var csv = model.toCsv(rows);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = h("a", { href: url, download: "phaneroo-payments.csv" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Exported " + rows.length + " rows.", "success");
  }

  function renderChannels(book) {
    var summary = model.summarize(book.intents);
    var cards = model.CHANNELS.map(function (ch) {
      var row = summary.byChannel[ch.id];
      var mode = model.modeFor(ch.id, book.health);
      var rate = row.count ? ((row.posted / row.count) * 100).toFixed(1) + "% posted" : "No intents";
      return h("article", { class: "card channel-card" }, [
        h("div", { class: "card-b" }, [
          h("div", { class: "page-header" }, [
            h("h3", { text: ch.label }),
            modeBadge(mode)
          ]),
          h("div", { class: "kpi-value", text: model.formatUgx(row.volume) }),
          h("div", { class: "kpi-meta", text: row.count + " intents · " + rate }),
          h("p", { text: ch.blurb })
        ])
      ]);
    });
    var fineractMode = book.health && book.health.mode ? book.health.mode.fineract : "";
    return [
      banner(book),
      pageHeader("Channels", "Mock, sandbox, or live comes from /payments/health"),
      h("div", { class: "channel-grid" }, cards),
      h("div", { class: "card" }, [
        h("div", { class: "card-h" }, [h("h2", { text: "Gateway" })]),
        h("div", { class: "card-b" }, [
          h("p", { class: "page-sub", text: book.health
            ? "Service " + (book.health.service || "payments") + ". Fineract mode " + (fineractMode || "unconfirmed") + ". Cash stays on the teller desk."
            : "This host did not return /payments/health. Badges stay unconfirmed until the portal is opened beside the gateway." })
        ])
      ])
    ];
  }

  function paint(book) {
    var root = document.getElementById("portal-root");
    root.textContent = "";
    var nodes = [];
    if (page === "overview") nodes = renderOverview(book);
    else if (page === "payments") nodes = renderPayments(book);
    else if (page === "reports") nodes = renderReports(book);
    else if (page === "channels") nodes = renderChannels(book);
    else if (page === "payment") {
      var id = query().id;
      var intent = findIntent(book, id);
      if (!intent) {
        nodes = [
          banner(book),
          pageHeader("Payment", "No run matches this id"),
          h("div", { class: "card" }, [h("div", { class: "card-b empty-hint", text: id ? "Unknown intent " + id : "Open a payment from the table." })])
        ];
      } else nodes = renderDetail(book, intent);
    }
    nodes.forEach(function (node) { if (node) root.appendChild(node); });
  }

  function boot() {
    var root = document.getElementById("portal-root");
    if (root) root.textContent = "Loading payments…";
    loadBook().then(function (book) {
      if (page === "payment" && book.source === "gateway") {
        var id = query().id;
        return refreshOne(book, id).then(function (fresh) {
          if (fresh) {
            book.intents = book.intents.map(function (row) {
              return row.intentId === fresh.intentId ? fresh : row;
            });
            if (!findIntent(book, fresh.intentId)) book.intents.unshift(fresh);
          }
          paint(book);
        });
      }
      paint(book);
    }).catch(function () {
      if (root) {
        root.textContent = "";
        root.appendChild(h("div", { class: "empty-state error" }, [
          h("strong", { text: "The payments book could not be loaded." })
        ]));
      }
    });
  }

  markNav();
  keyButton();
  boot();
})();
