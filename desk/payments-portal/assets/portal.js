/* Phaneroo payments portal. Layout follows the approved remock; colour is desk green and amber. */
(function () {
  "use strict";

  var model = window.PaymentsModel;
  /* Retired: the internal key must never live in the browser. Cleared on every load. */
  var LEGACY_INTERNAL_KEY = "paymentsPortal.internalKey";
  var PARTNER = "paymentsPortal.partnerKey";
  var READ_KEY = "paymentsPortal.demoReadKey";
  var DEMO_MODE = "paymentsPortal.demoMode";
  var OVERRIDES = "paymentsPortal.overrides";
  var EXTRA = "paymentsPortal.created";
  var DEMO_PARTNER = "demo-portal";
  var PAGE_SIZE = 8;
  /* Full-book reads page through the gateway this many rows at a time, up to the hard cap. */
  var FETCH_PAGE = 200;
  var FETCH_CAP = 10000;
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

  function clearLegacyKeys() {
    try { sessionStorage.removeItem(LEGACY_INTERNAL_KEY); } catch (e) { /* storage unavailable */ }
    try { localStorage.removeItem(LEGACY_INTERNAL_KEY); } catch (e) { /* storage unavailable */ }
  }

  /* Demo book only on explicit ?demo=1. The flag lasts for this tab; ?demo=0 or the banner leaves it. */
  function syncDemoFlag() {
    var params = new URLSearchParams(location.search);
    if (!params.has("demo")) return;
    if (params.get("demo") === "1") writeStore(DEMO_MODE, "1");
    else writeStore(DEMO_MODE, "");
    params.delete("demo");
    var search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? "?" + search : "") + location.hash);
  }

  function isDemo() {
    return readStore(DEMO_MODE) === "1";
  }

  function leaveDemo() {
    writeStore(DEMO_MODE, "");
    writeStore(OVERRIDES, "");
    writeStore(EXTRA, "");
    showDemoBanner();
    boot();
  }

  function showDemoBanner() {
    var existing = document.getElementById("demo-banner");
    if (!isDemo()) {
      if (existing) existing.remove();
      document.body.classList.remove("demo-mode");
      return;
    }
    document.body.classList.add("demo-mode");
    if (existing) return;
    var banner = h("div", { id: "demo-banner", class: "demo-banner", role: "alert" }, [
      h("strong", { text: "DEMO DATA — not real payments." }),
      document.createTextNode(" Every figure on this screen comes from the bundled demo book (fixtures/intents.json). Nothing here is sent to the gateway. "),
      h("button", { class: "btn btn-sm", type: "button", text: "Leave demo mode", onclick: leaveDemo })
    ]);
    var main = document.querySelector(".main");
    if (main) main.insertBefore(banner, main.firstChild);
    else document.body.insertBefore(banner, document.body.firstChild);
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
      id: params.get("id") || "",
      product: params.get("product") || "",
      partner: params.get("partner") || ""
    };
  }

  /* Reads send one key: the read key if saved, otherwise the partner key. Never an internal key. */
  function portalHeaders() {
    var headers = { accept: "application/json" };
    if (readStore(READ_KEY)) headers["X-Demo-Read-Key"] = readStore(READ_KEY);
    else if (readStore(PARTNER)) headers["X-Api-Key"] = readStore(PARTNER);
    return headers;
  }

  function hasGatewayKey() {
    return !!(readStore(READ_KEY) || readStore(PARTNER));
  }

  function partnerId() {
    return query().partner || DEMO_PARTNER;
  }

  function reloadAfterQuery() {
    if (book && book.remote) boot();
    else paint();
  }

  function demoHref() {
    var params = new URLSearchParams(location.search);
    params.set("demo", "1");
    return location.pathname + "?" + params.toString();
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
      keyBtn.textContent = hasGatewayKey() ? "Gateway key saved" : "Operator key";
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
          reloadAfterQuery();
        } else {
          location.href = "payments.html" + (value ? "?q=" + encodeURIComponent(value) : "");
        }
      });
    }
  }

  function openKeyDialog() {
    var existing = document.getElementById("key-dialog");
    if (existing) existing.remove();
    var demo = h("input", { id: "demo-read-key-input", type: "password", autocomplete: "off", placeholder: "X-Demo-Read-Key" });
    var partner = h("input", { id: "partner-key-input", type: "password", autocomplete: "off", placeholder: "X-Api-Key" });
    var dialog = h("dialog", { id: "key-dialog", class: "pay-dialog" }, [
      h("form", {}, [
        h("h2", { text: "Payments gateway" }),
        h("p", { text: "Reads send the read key if one is saved, otherwise the partner key. Initiate sends only the partner key. Retries are not done from the browser. Keys stay in this tab's session storage." }),
        h("div", { class: "field" }, [h("label", { for: "demo-read-key-input", text: "Portal read key" }), demo]),
        h("div", { class: "field" }, [h("label", { for: "partner-key-input", text: "Partner API key" }), partner]),
        h("div", { class: "form-actions" }, [
          h("button", { class: "btn", type: "submit", text: "Save" }),
          h("button", { class: "btn btn-ghost", type: "button", text: "Clear keys", onclick: function () {
            writeStore(READ_KEY, "");
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
      if (demo.value.trim()) writeStore(READ_KEY, demo.value.trim());
      if (partner.value.trim()) writeStore(PARTNER, partner.value.trim());
      dialog.close();
      boot();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function portalFilters(extra) {
    var q = query();
    var filters = {
      channel: q.channel,
      direction: q.direction,
      status: q.status,
      product: q.product,
      partnerId: partnerId(),
      from: q.from,
      to: q.to,
      q: q.text
    };
    if (extra) Object.keys(extra).forEach(function (key) { filters[key] = extra[key]; });
    return filters;
  }

  async function readBody(response) {
    var text = "";
    try { text = await response.text(); } catch (e) { text = ""; }
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    return { text: text, body: body };
  }

  function missingRoute(response, parsed) {
    if (response.status !== 404) return false;
    var message = parsed && parsed.body ? String(parsed.body.message || "") : "";
    var text = (parsed && parsed.text) || "";
    if (/Cannot GET/i.test(text) || /Cannot GET/i.test(message)) return true;
    if (!parsed || !parsed.body) return true;
    return false;
  }

  async function fetchPortal(path) {
    var response = await fetch(path, { headers: portalHeaders() });
    var parsed = await readBody(response);
    return { response: response, parsed: parsed };
  }

  function portalFailure(response, parsed) {
    var code = "HTTP " + response.status;
    if (response.status === 401 || response.status === 403) {
      return "Payments gateway refused the read (" + code + "). Save a portal read key or partner key under Operator key. No data shown.";
    }
    if (response.status === 404 && missingRoute(response, parsed)) {
      return "Payments gateway has no portal read route (" + code + "). No data shown.";
    }
    return "Payments gateway unavailable (" + code + "). No data shown.";
  }

  async function loadFixture() {
    var fixtureResponse = await fetch("fixtures/intents.json");
    if (!fixtureResponse.ok) throw new Error("Demo book failed to load");
    var fixture = await fixtureResponse.json();
    var local = overrides();
    var intents = model.normalizeList(fixture).map(function (row) {
      return model.normalizeIntent(Object.assign({}, row, local[row.intentId] || {}));
    });
    extras().forEach(function (row) {
      intents.push(model.normalizeIntent(Object.assign({}, row, local[row.intentId] || {})));
    });
    intents.sort(model.byNewest);
    return intents;
  }

  /*
   * Page through /portal/intents until the gateway runs out, the reported total is reached, or FETCH_CAP.
   * Returns { ok, items, total, truncated } or { ok: false, error }.
   */
  async function fetchAllIntents(filters) {
    var items = [];
    var seen = {};
    var total = 0;
    var offset = 0;
    while (items.length < FETCH_CAP) {
      var limit = Math.min(FETCH_PAGE, FETCH_CAP - items.length);
      var extra = Object.assign({}, filters, { limit: limit, offset: offset });
      var call = await fetchPortal("/payments/v1/portal/intents?" + model.portalQuery(extra));
      if (!call.response.ok) return { ok: false, error: portalFailure(call.response, call.parsed) };
      var parsed = model.normalizePortalList(call.parsed.body);
      total = Math.max(total, parsed.total);
      var added = 0;
      parsed.items.forEach(function (row) {
        if (!row.intentId || seen[row.intentId] || items.length >= FETCH_CAP) return;
        seen[row.intentId] = true;
        items.push(row);
        added += 1;
      });
      /* Stop when the page is short, nothing new came back (offset ignored), or limit was ignored. */
      if (parsed.items.length < limit || added === 0 || parsed.items.length > limit) break;
      if (total && items.length >= total) break;
      offset += parsed.items.length;
    }
    total = Math.max(total, items.length);
    items.sort(model.byNewest);
    return { ok: true, items: items, total: total, truncated: items.length < total };
  }

  async function loadHealth() {
    try {
      var healthResponse = await fetch("/payments/health", { headers: { accept: "application/json" } });
      if (healthResponse.ok) return await healthResponse.json();
    } catch (e) { /* unreachable */ }
    return null;
  }

  function baseBook(health) {
    return {
      health: health,
      intents: [],
      source: "portal",
      gatewayError: "",
      notice: "",
      total: 0,
      remote: true,
      demo: false,
      truncated: false,
      plan: null,
      partnerId: partnerId()
    };
  }

  async function loadBook() {
    var health = await loadHealth();
    var result = baseBook(health);
    var q = query();

    if (isDemo()) {
      result.intents = await loadFixture();
      result.total = result.intents.length;
      result.source = "fixture";
      result.remote = false;
      result.demo = true;
      return result;
    }

    try {
      if (page === "payment") {
        if (!q.id) return result;
        var detail = await fetchPortal("/payments/v1/portal/intents/" + encodeURIComponent(q.id));
        if (detail.response.ok && detail.parsed.body) {
          result.intents = [model.intentFromPortal(detail.parsed.body)];
          result.total = 1;
        } else if (detail.response.status === 404 && !missingRoute(detail.response, detail.parsed)) {
          result.notice = "This intent is not in the portal book.";
        } else {
          result.gatewayError = portalFailure(detail.response, detail.parsed);
        }
      } else if (page === "payments") {
        var pageNo = Math.max(parseInt(q.page || "1", 10) || 1, 1);
        var list = await fetchPortal("/payments/v1/portal/intents?" + model.portalQuery(portalFilters({
          limit: PAGE_SIZE,
          offset: (pageNo - 1) * PAGE_SIZE
        })));
        if (list.response.ok) {
          var parsedList = model.normalizePortalList(list.parsed.body);
          result.plan = model.pagePlan(parsedList.items, parsedList.total, pageNo, PAGE_SIZE);
          result.intents = result.plan.rows;
          result.total = result.plan.total;
          if (result.plan.mode === "untrusted") result.gatewayError = result.plan.note + " No data shown.";
          else if (result.plan.note) result.notice = result.plan.note;
        } else {
          result.gatewayError = portalFailure(list.response, list.parsed);
        }
      } else {
        var all = await fetchAllIntents(portalFilters());
        if (all.ok) {
          result.intents = all.items;
          result.total = all.total;
          result.truncated = all.truncated;
          if (all.truncated) {
            result.notice = "Showing the first " + all.items.length.toLocaleString("en-UG") + " of " + all.total.toLocaleString("en-UG") + " intents. Totals, CSV and settlement packs cover only these rows. Narrow the filters.";
          }
        } else {
          result.gatewayError = all.error;
        }
      }
    } catch (e) {
      result.gatewayError = "Payments gateway unreachable (network error). No data shown.";
    }
    if (result.gatewayError) {
      result.intents = [];
      result.total = 0;
    }
    return result;
  }

  function fillChrome() {
    var chip = document.getElementById("mw-chip");
    var mode = book.health && book.health.mode ? (book.health.mode.channel || "unconfirmed") : "unconfirmed";
    if (chip) chip.textContent = book.demo ? "● DEMO book · not the gateway" : "● " + mode + " · gateway v1";
    var host = document.getElementById("top-chips");
    if (!host) return;
    host.querySelectorAll(".chip").forEach(function (node) { node.remove(); });
    var avatar = host.querySelector(".avatar");
    var chips = [];
    if (book.demo) chips.push(h("span", { class: "chip red", text: "DEMO DATA" }));
    if (book.gatewayError) {
      chips.push(h("span", { class: "chip red", text: "No data" }));
    } else if (page === "overview") {
      var fineract = book.health && book.health.mode ? book.health.mode.fineract : "";
      chips.push(h("span", { class: "chip green", text: fineract ? "Fineract " + fineract : "Fineract unread" }));
      var day = todayInfo();
      chips.push(h("span", { class: "chip amber", text: day.label }));
    } else if (page === "payments") {
      chips.push(h("span", { class: "chip", text: (book.remote ? book.total : book.intents.length) + " intents" }));
    } else if (page === "reports") {
      chips.push(h("span", { class: "chip amber", text: "Settlements · " + (book.remote ? "gateway" : "demo") }));
    } else if (page === "channels") {
      chips.push(h("span", { class: "chip green", text: "4 channels registered" }));
    } else if (page === "payment") {
      chips.push(h("span", { class: "chip green", text: "Idempotent" }));
    }
    chips.forEach(function (node) { host.insertBefore(node, avatar); });
    var keyBtn = document.getElementById("gateway-key-btn");
    if (keyBtn) keyBtn.textContent = hasGatewayKey() ? "Gateway key saved" : "Operator key";
  }

  /* Real Kampala date on the live book. The demo book is frozen, so it uses its own anchor day and says so. */
  function todayInfo() {
    if (book.demo) {
      var anchor = model.latestDay(book.intents);
      return { day: anchor, label: "Book day · " + model.formatDay(anchor) + " (demo anchor, not today)" };
    }
    var day = model.todayKampala();
    return { day: day, label: "Today · " + model.formatDay(day) + " (Kampala)" };
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
    var info = todayInfo();
    var today = info.day;
    var dayWord = book.demo ? "book day" : "today";
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
      collectDelta = (delta >= 0 ? "↑ " : "↓ ") + Math.abs(delta).toFixed(0) + "% vs day before · " + todaySum.collectCount + " posted";
      collectTone = delta >= 0 ? "up" : "down";
    } else {
      collectDelta = todaySum.collectCount + " posted · UGX " + model.compactNumber(todaySum.collectInitiated) + " initiated";
    }
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
    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Payments overview" }),
          h("p", { class: "page-sub", text: book.demo
            ? "DEMO book — collections & disbursements from fixtures/intents.json, not the gateway."
            : "Collections & disbursements across MTN MoMo, Airtel Money, bank & card from the payments gateway." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", text: "Refresh", onclick: function () { boot(); } }),
          h("a", { class: "btn btn-amber", href: "payments.html", text: "View all payments" })
        ])
      ]),
      h("div", { class: "kpi-grid" }, [
        kpi("Collections posted " + dayWord, "UGX " + model.compactNumber(todaySum.collect), collectDelta, "green", collectTone),
        kpi("Disbursements posted " + dayWord, "UGX " + model.compactNumber(todaySum.disburse), todaySum.disburseCount + " posted payouts · savings / loan"),
        kpi("Success rate " + dayWord + " (completed runs)", model.formatRate(todaySum.successRate),
          todaySum.completed ? "POSTED ÷ (POSTED + declined/rejected) · " + todaySum.completed + " completed; pending & ambiguous excluded" : "No completed runs " + dayWord, "amber"),
        kpi("Pending · all loaded dates", String(all.pending), "INITIATED · AWAITING_PROVIDER · POSTING_CORE", "warn"),
        kpi("Failed · all loaded dates", String(all.failed), "Declined / core rejected / ambiguous" + (all.reversed ? " · " + all.reversed + " reversed" : ""), "red", "down")
      ]),
      h("div", { class: "grid-2" }, [
        h("section", { class: "card" }, [
          h("div", { class: "card-h" }, [h("h2", { text: "Channel mix · volume initiated (UGX)" }), h("span", { class: "chip", text: book.demo ? "Book day (demo)" : "Today" })]),
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
    if (!book.remote) {
      var window = model.bookWindow(book.intents);
      if (!q.from && !q.to && !new URLSearchParams(location.search).has("from")) {
        q.from = window.from;
        q.to = window.to;
      }
    }
    /* Live: book.intents is already the page chosen by model.pagePlan. Demo: filter and page the local book. */
    var filtered = book.remote ? book.intents : model.filterIntents(book.intents, q);
    var pageNo = Math.max(parseInt(q.page || "1", 10) || 1, 1);
    var total = book.remote ? book.total : filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (!book.remote && pageNo > pages) pageNo = pages;
    var slice = book.remote ? filtered : filtered.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
    var from = total ? (pageNo - 1) * PAGE_SIZE + 1 : 0;
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
        to: toInput.value,
        product: q.product,
        partner: q.partner,
        page: ""
      });
      reloadAfterQuery();
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
      reloadAfterQuery();
    }

    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [
          h("h1", { class: "page-title", text: "Payments" }),
          h("p", { class: "page-sub", text: book.demo ? "DEMO book — filterable intents from fixtures/intents.json." : "Filterable payment intents from the aggregator gateway (collect / disburse)." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", text: book.demo ? "Export DEMO CSV" : "Export CSV", onclick: function () { exportPayments(filtered); } }),
          h("button", { class: "btn", type: "button", text: book.demo ? "+ Initiate (demo, not sent)" : "+ Initiate", onclick: openInitiate })
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
          h("span", { text: "Showing " + from + "–" + to + " of " + total }),
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
    var apiSteps = intent.timeline && intent.timeline.length ? intent.timeline : null;
    var steps = apiSteps || model.timeline(intent);
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
      var title = apiSteps ? step.label : (titles[index] || step.label);
      var meta = apiSteps ? (step.detail || (step.at ? model.formatWhen(step.at) : "")) : step.detail;
      var code = apiSteps ? (step.code || (step.at && step.detail ? model.formatWhen(step.at) : "")) : codes[index];
      list.appendChild(h("div", { class: "tl-item " + tlClass(step.state) }, [
        h("div", { class: "tl-dot", text: tlMark(step.state) }),
        h("div", { class: "tl-title", text: title }),
        h("div", { class: "tl-meta", text: meta }),
        code ? h("div", { class: "tl-code", text: code }) : null
      ]));
    });
    function meta(label, value) {
      return h("div", { class: "meta-row" }, [h("dt", { text: label }), h("dd", {}, [value])]);
    }
    var failed = model.canRetry(intent);
    /* Live retries need a Desk-session-backed proxy that does not exist yet; the gateway operator retries server-side. */
    var retryable = failed && book.demo;
    var retryTitle = !failed ? "Only a failed run can be retried"
      : book.demo ? "Retry on the demo book (nothing is sent)"
        : "Retries are done by the gateway operator on the server until the Desk has a retry proxy";
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
            text: book.demo ? "↻ Retry (demo, not sent)" : "↻ Retry",
            disabled: !retryable,
            title: retryTitle,
            onclick: function () { if (retryable) openRetry(intent); }
          })
        ])
      ]),
      failed && !book.demo ? h("div", { class: "notice notice-warn", text: "Retry is not available from the browser. Ask the gateway operator to resolve this run on the server (allow_single_retry) after confirming with the channel that the earlier attempt did not post." }) : null,
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
    var ambiguous = intent.status === "AMBIGUOUS";
    var note = h("textarea", { id: "retry-note", rows: "3", placeholder: "Why this run should be retried (8+ characters)" });
    var confirm = h("input", { id: "retry-confirm", type: "checkbox" });
    var ref = ambiguous ? h("input", { id: "retry-provider-ref", autocomplete: "off", placeholder: "Provider reference you checked" }) : null;
    var error = h("p", { class: "field-error", role: "alert" });
    var submit = h("button", { class: "btn btn-amber", type: "submit", text: book.demo ? "Retry on demo book" : "Retry", disabled: true });
    function input() {
      return { note: note.value, confirmNotPosted: confirm.checked === true, providerReference: ref ? ref.value : "" };
    }
    function refresh() {
      submit.disabled = !model.retryRequest(intent, input()).ok;
    }
    var dialog = h("dialog", { class: "pay-dialog" }, [
      h("form", {}, [
        h("h2", { text: book.demo ? "Retry failed run · DEMO" : "Retry failed run" }),
        h("p", { text: book.demo
          ? "Demo book only: the timeline changes in this browser tab. Nothing is sent to the gateway or the channel."
          : "Retries are done by the gateway operator on the server." }),
        h("div", { class: "field" }, [h("label", { for: "retry-note", text: "Operator note" }), note]),
        ambiguous ? h("div", { class: "field" }, [
          h("label", { for: "retry-provider-ref", text: "Provider reference checked (AMBIGUOUS run)" }),
          ref
        ]) : null,
        h("label", { for: "retry-confirm" }, [confirm, document.createTextNode(" I confirmed with the channel that the earlier attempt did not post")]),
        error,
        h("div", { class: "form-actions" }, [
          submit,
          h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: function () { dialog.close(); } })
        ])
      ])
    ]);
    [note, confirm, ref].forEach(function (node) {
      if (!node) return;
      node.addEventListener("input", refresh);
      node.addEventListener("change", refresh);
    });
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      submitRetry(intent, input(), dialog, error);
    });
    dialog.addEventListener("close", function () { dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  function submitRetry(intent, input, dialog, errorNode) {
    var request = model.retryRequest(intent, input);
    if (!request.ok) {
      errorNode.textContent = request.error;
      return;
    }
    if (!book.demo) {
      /* No browser path to /payments/internal/*: Caddy blocks it and the internal key stays server-side. */
      errorNode.textContent = "Retry is not available from the browser. Ask the gateway operator to resolve this run on the server.";
      return;
    }
    var local = overrides();
    local[intent.intentId] = Object.assign({}, local[intent.intentId] || {}, model.retryPatch(intent, request.body.note));
    writeStore(OVERRIDES, JSON.stringify(local));
    toast("DEMO: retry recorded in this browser tab only. Nothing was sent to the gateway.", "success");
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
    var amount = h("input", { id: "init-amount", inputmode: "numeric", autocomplete: "off", value: "", placeholder: "e.g. 50,000" });
    var amountError = h("p", { class: "field-error", id: "init-amount-error", role: "alert" });
    var partner = book.demo ? null : h("input", { id: "init-partner", type: "password", autocomplete: "off", placeholder: readStore(PARTNER) ? "Saved key will be used" : "X-Api-Key" });
    var entry = h("div", { class: "stack" }, [
      h("div", { class: "field" }, [h("label", { for: "init-channel", text: "Channel" }), channel]),
      h("div", { class: "field" }, [h("label", { for: "init-direction", text: "Direction" }), direction]),
      h("div", { class: "field" }, [h("label", { for: "init-product", text: "Product" }), product]),
      h("div", { class: "field" }, [
        h("label", { for: "init-amount", text: "Amount (whole UGX, max " + model.formatUgx(model.MAX_INITIATE_UGX) + ")" }),
        amount,
        amountError
      ]),
      partner ? h("div", { class: "field" }, [h("label", { for: "init-partner", text: "Partner key" }), partner]) : null
    ]);
    var review = h("div", { class: "stack", hidden: true });
    var next = h("button", { class: "btn", type: "submit", text: "Review" });
    var back = h("button", { class: "btn btn-ghost", type: "button", text: "Back", hidden: true });
    var pending = null;
    var dialog = h("dialog", { class: "pay-dialog" }, [
      h("form", { novalidate: true }, [
        h("h2", { text: book.demo ? "Initiate payment · DEMO" : "Initiate payment" }),
        h("p", { text: book.demo
          ? "Demo book only: the row is added in this browser tab. Nothing is sent to the gateway or the channel."
          : "Posts /payments/v1/payments/initiate on this host with the partner key. Currency is UGX. You confirm before anything is sent." }),
        entry,
        review,
        h("div", { class: "form-actions" }, [
          next,
          back,
          h("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: function () { dialog.close(); } })
        ])
      ])
    ]);
    function showEntry() {
      pending = null;
      entry.hidden = false;
      review.hidden = true;
      back.hidden = true;
      next.textContent = "Review";
    }
    back.addEventListener("click", showEntry);
    amount.addEventListener("input", function () { amountError.textContent = ""; });
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      if (pending) {
        var send = pending;
        dialog.close();
        if (book.demo) initiateDemo(send.fields);
        else initiateGateway(send.fields, send.key);
        return;
      }
      var parsed = model.parseWholeShillings(amount.value, model.MAX_INITIATE_UGX);
      if (!parsed.ok) {
        amountError.textContent = parsed.error;
        amount.focus();
        return;
      }
      var fields = { channel: channel.value, direction: direction.value, product: product.value, amount: parsed.value };
      if (direction.value === "DEBIT") fields.product = "SAVINGS_WITHDRAWAL";
      if (direction.value === "CREDIT" && fields.product === "SAVINGS_WITHDRAWAL") fields.product = "SAVINGS_DEPOSIT";
      var key = "";
      if (!book.demo) {
        key = (partner && partner.value.trim()) || readStore(PARTNER);
        if (!key) {
          amountError.textContent = "Initiate on the gateway needs a partner key.";
          return;
        }
        if (partner && partner.value.trim()) writeStore(PARTNER, partner.value.trim());
      }
      pending = { fields: fields, key: key };
      review.textContent = "";
      review.appendChild(h("p", { class: "confirm-amount", text: model.formatUgx(fields.amount) }));
      review.appendChild(h("dl", { class: "meta-list" }, [
        h("div", { class: "meta-row" }, [h("dt", { text: "Direction" }), h("dd", { text: model.directionLabel(fields.direction) + " (" + fields.direction + ")" })]),
        h("div", { class: "meta-row" }, [h("dt", { text: "Channel" }), h("dd", { text: model.channelLabel(fields.channel) })]),
        h("div", { class: "meta-row" }, [h("dt", { text: "Product" }), h("dd", { text: model.productLabel(fields.product) })]),
        h("div", { class: "meta-row" }, [h("dt", { text: "Destination" }), h("dd", { text: book.demo
          ? "Demo book in this browser tab — nothing is sent"
          : "Payments gateway on " + location.host + " · POST /payments/v1/payments/initiate · partner key" })])
      ]));
      entry.hidden = true;
      review.hidden = false;
      back.hidden = false;
      next.textContent = book.demo ? "Add to demo book" : "Confirm and send " + model.formatUgx(fields.amount);
    });
    dialog.addEventListener("close", function () { dialog.remove(); });
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
    toast("DEMO: added " + id + " to the demo book in this tab. Nothing was sent to the gateway.", "success");
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
    if (!book.remote) {
      var window = model.bookWindow(book.intents);
      if (!q.from && !q.to && !new URLSearchParams(location.search).has("from")) {
        q.from = window.from;
        q.to = window.to;
      }
    }
    var rows = book.remote ? book.intents : model.filterIntents(book.intents, q);
    /* KPIs are computed here from the full row set so their definitions match the overview. */
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
      writeQuery({
        text: q.text,
        status: q.status,
        from: from.value,
        to: to.value,
        channel: channel.value,
        direction: direction.value,
        product: q.product,
        partner: q.partner
      });
      reloadAfterQuery();
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
      var rate = model.successRate(row.posted, row.completed);
      rates.appendChild(mixRow(visual.label, rate == null ? 0 : Math.round(rate), model.formatRate(rate), visual.slug));
    });
    var allPacks = model.settlementPacks(rows);
    var packs = allPacks.slice(0, 8);
    var body = h("tbody");
    if (!packs.length) body.appendChild(h("tr", {}, [h("td", { colspan: "7", class: "empty-hint", text: "No settlement packs in this range." })]));
    packs.forEach(function (pack) {
      var settled = model.packSettled(pack);
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
          h("p", { class: "page-sub", text: book.demo ? "DEMO book — volume, success rate and settlement packs from fixtures/intents.json." : "Volume by channel, success rate, and settlement packs from the full gateway book for these filters." })
        ]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-amber", type: "button", text: book.demo ? "↓ Export DEMO CSV" : "↓ Export CSV", onclick: function () { exportCsv(rows); } })
        ])
      ]),
      form,
      h("div", { class: "kpi-grid", style: "grid-template-columns:repeat(4,1fr)" }, [
        kpi("Gross volume", "UGX " + model.compactNumber(summary.volumeAll), range),
        kpi("Success rate (completed runs)", model.formatRate(summary.successRate), summary.posted + " posted of " + summary.completed + " completed · pending & ambiguous excluded", "green"),
        kpi("Settled to core", "UGX " + model.compactNumber(summary.volumePosted), "POSTED only · reversed excluded", "amber"),
        kpi("Not settled", "UGX " + model.compactNumber(inflight), "Pending, failed, ambiguous and reversed", "warn")
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
          h("h2", { text: "Settlement packs" + (allPacks.length > packs.length ? " · latest " + packs.length + " of " + allPacks.length : "") }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: book.demo ? "↓ Export DEMO CSV (all packs)" : "↓ Export CSV (all packs)", onclick: function () { exportPacks(allPacks); } })
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

  async function exportPayments(rows) {
    if (!book.remote) {
      exportCsv(rows);
      return;
    }
    /* The table holds one page; the export pages through the whole filtered book. */
    try {
      var all = await fetchAllIntents(portalFilters());
      if (!all.ok) {
        toast(all.error.replace("No data shown.", "Nothing exported."), "error");
        return;
      }
      exportCsv(all.items);
      if (all.truncated) toast("Export holds the first " + all.items.length + " of " + all.total + " rows. Narrow the filters.", "error");
    } catch (e) {
      toast("Payments gateway unreachable. Nothing exported.", "error");
    }
  }

  function fileName(base) {
    return (book.demo ? "DEMO-" : "") + base;
  }

  function exportCsv(rows) {
    download(fileName("phaneroo-payments.csv"), model.toCsv(rows, { demo: book.demo }));
    toast((book.demo ? "DEMO: exported " : "Exported ") + rows.length + " rows.", "success");
  }

  function exportPacks(packs) {
    download(fileName("phaneroo-settlement-packs.csv"), model.packsToCsv(packs, { demo: book.demo }));
    toast((book.demo ? "DEMO: exported " : "Exported ") + packs.length + " packs.", "success");
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
    var todaySum = model.summarize(model.onDay(book.intents, todayInfo().day));
    var cards = model.CHANNELS.map(function (ch) {
      var visual = model.channelVisual(ch.id);
      var row = summary.byChannel[ch.id];
      var todayRow = todaySum.byChannel[ch.id];
      var rate = model.formatRate(model.successRate(row.posted, row.completed));
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
          h("div", { class: "stat-box" }, [h("div", { class: "v", text: rate }), h("div", { class: "l", text: "Success · completed" })]),
          h("div", { class: "stat-box" }, [h("div", { class: "v", text: String(todayRow.count) }), h("div", { class: "l", text: book.demo ? "Book day" : "Today" })]),
          h("div", { class: "stat-box" }, [h("div", { class: "v", text: model.compactNumber(row.volume) }), h("div", { class: "l", text: "UGX vol" })])
        ]),
        cfg
      ]);
    });
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
      healthCard()
    ];
  }

  function healthCard() {
    var health = book.health;
    var healthRows = h("div", {});
    if (health) {
      var mode = health.mode || {};
      [
        ["Status", health.status || "—"],
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
      healthRows.appendChild(h("p", { class: "page-sub", text: "This host did not return /payments/health. Badges stay unconfirmed." }));
    }
    /* No API docs link: gateway docs are not public and Caddy blocks /payments/docs. */
    return h("section", { class: "card", id: "health" }, [
      h("div", { class: "card-h" }, [h("h2", { text: "Gateway health" })]),
      h("div", { class: "card-b" }, [healthRows])
    ]);
  }

  var TITLES = { overview: "Payments overview", payments: "Payments", payment: "Payment run", reports: "Reports", channels: "Channels" };

  /* Read failed and demo mode is off: say why, show no figures. */
  function renderError() {
    return [
      h("div", { class: "page-head" }, [
        h("div", {}, [h("h1", { class: "page-title", text: TITLES[page] || "Payments" })]),
        h("div", { class: "page-actions" }, [
          h("button", { class: "btn btn-ghost", type: "button", text: "Retry read", onclick: function () { boot(); } })
        ])
      ]),
      h("div", { class: "error-state", role: "alert" }, [
        h("strong", { text: book.gatewayError }),
        h("p", { text: "The portal does not substitute sample figures for a failed read. To look at the screens with sample data, open the clearly marked " }, [
          h("a", { href: demoHref(), text: "demo book" }),
          document.createTextNode(".")
        ])
      ]),
      page === "channels" ? healthCard() : null
    ];
  }

  function paint() {
    if (!book) return;
    fillChrome();
    var root = document.getElementById("portal-root");
    root.textContent = "";
    showDemoBanner();
    var nodes = [];
    if (!book.gatewayError && book.notice) root.appendChild(h("div", { class: "notice notice-warn", role: "status", text: book.notice }));
    if (book.gatewayError) nodes = renderError();
    else if (page === "overview") nodes = renderOverview();
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
      paint();
    } catch (e) {
      if (root) {
        root.textContent = "";
        root.appendChild(h("div", { class: "error-state", role: "alert", text: (isDemo() ? "The demo book could not be loaded." : "The payments book could not be loaded.") + " No data shown." }));
      }
    }
  }

  /* Desk login guard: requireAuth() sends the operator to /login.html without a live session. */
  function authGate() {
    var api = window.FineractAPI;
    if (!api || typeof api.requireAuth !== "function") {
      var root = document.getElementById("portal-root");
      if (root) root.textContent = "Desk sign-in could not be checked (/assets/api.js did not load). No data shown.";
      return false;
    }
    if (!api.requireAuth()) {
      document.body.classList.add("auth-pending");
      return false;
    }
    if (typeof api.startSessionTimers === "function") api.startSessionTimers();
    return true;
  }

  clearLegacyKeys();
  if (authGate()) {
    syncDemoFlag();
    showDemoBanner();
    markNav();
    boot();
  }
})();
