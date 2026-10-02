/* Payments portal — pure view model. No DOM, no secrets. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PaymentsModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  var FAILED = ["PROVIDER_DECLINED", "CORE_REJECTED", "AMBIGUOUS"];
  var PENDING = ["INITIATED", "AWAITING_PROVIDER", "POSTING_CORE"];
  /* A completed run reached a final answer: posted, or declined / rejected. AMBIGUOUS is not an answer. */
  var COMPLETED_FAILED = ["PROVIDER_DECLINED", "CORE_REJECTED"];
  /* Largest single initiate the portal will send, in whole shillings. */
  var MAX_INITIATE_UGX = 5000000;
  var AMOUNT_PATTERN = /^\d{1,3}(,\d{3})*$|^\d+$/;
  var CHANNELS = [
    { id: "MTN_MOMO", label: "MTN MoMo", blurb: "Collections and disbursements. Callbacks land on the gateway, not Fineract." },
    { id: "AIRTEL_MONEY", label: "Airtel Money", blurb: "Collections and disbursements. Same orchestrator path as MoMo." },
    { id: "BANK", label: "Bank", blurb: "Generic bank settlement callback. Cash still stays on the teller desk." },
    { id: "CARD", label: "Card", blurb: "PSP reference and account metadata only. PAN, CVV, and track data are rejected." }
  ];

  /* REVERSED was posted and then undone, so it is not money settled to core. */
  function bucket(status) {
    if (status === "POSTED") return "posted";
    if (status === "REVERSED") return "reversed";
    if (FAILED.indexOf(status) >= 0) return "failed";
    return "pending";
  }

  function channelLabel(id) {
    for (var i = 0; i < CHANNELS.length; i++) {
      if (CHANNELS[i].id === id) return CHANNELS[i].label;
    }
    return id || "—";
  }

  function directionLabel(direction) {
    if (direction === "CREDIT") return "Collect";
    if (direction === "DEBIT") return "Disburse";
    return direction || "—";
  }

  function productLabel(product) {
    if (product === "SAVINGS_DEPOSIT") return "Savings deposit";
    if (product === "SAVINGS_WITHDRAWAL") return "Savings withdrawal";
    if (product === "LOAN_REPAYMENT") return "Loan repayment";
    return product || "—";
  }

  function statusLabel(status) {
    var labels = {
      POSTED: "Posted",
      REVERSED: "Reversed",
      INITIATED: "Initiated",
      AWAITING_PROVIDER: "Pending channel",
      POSTING_CORE: "Posting",
      PROVIDER_DECLINED: "Failed",
      CORE_REJECTED: "Failed",
      AMBIGUOUS: "Failed"
    };
    return labels[status] || status || "—";
  }

  function statusClass(status) {
    var kind = bucket(status);
    if (kind === "posted") return "active";
    if (kind === "failed") return "rejected";
    if (kind === "reversed") return "reversed";
    return "pending";
  }

  function todayKampala(now) {
    return kampalaDate((now || new Date()).toISOString());
  }

  function kampalaDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Kampala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  }

  function formatWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Kampala",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(d);
  }

  function formatUgx(amount) {
    var n = Number(amount);
    if (!isFinite(n)) return "UGX —";
    return "UGX " + Math.round(n).toLocaleString("en-UG");
  }

  function normalizeList(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== "object") return [];
    if (Array.isArray(body.items)) return body.items;
    if (Array.isArray(body.intents)) return body.intents;
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.content)) return body.content;
    return [];
  }

  function textOrEmpty(value) {
    if (value == null) return "";
    return String(value);
  }

  function normalizeIntent(row) {
    row = row || {};
    return {
      intentId: textOrEmpty(row.intentId),
      status: textOrEmpty(row.status || "INITIATED"),
      coreStatus: textOrEmpty(row.coreStatus),
      providerStatus: textOrEmpty(row.providerStatus),
      channel: textOrEmpty(row.channel),
      direction: textOrEmpty(row.direction),
      product: textOrEmpty(row.product),
      amount: textOrEmpty(row.amount || "0"),
      currency: textOrEmpty(row.currency || "UGX"),
      savingsAccountId: row.savingsAccountId == null ? null : row.savingsAccountId,
      loanId: row.loanId == null ? null : row.loanId,
      msisdn: textOrEmpty(row.msisdn),
      memberName: textOrEmpty(row.memberName),
      externalReference: textOrEmpty(row.externalReference),
      providerReference: textOrEmpty(row.providerReference),
      providerTransactionId: textOrEmpty(row.providerTransactionId),
      fineractTransactionId: textOrEmpty(row.fineractTransactionId),
      reversalIntentId: textOrEmpty(row.reversalIntentId),
      idempotencyKey: textOrEmpty(row.idempotencyKey),
      failureCode: textOrEmpty(row.failureCode),
      createdAt: textOrEmpty(row.createdAt),
      updatedAt: textOrEmpty(row.updatedAt),
      webhookEventId: textOrEmpty(row.webhookEventId),
      hmacRef: textOrEmpty(row.hmacRef)
    };
  }

  function displayName(intent) {
    return intent.memberName || intent.msisdn || intent.externalReference || intent.intentId;
  }

  function timeline(intent) {
    var status = intent.status;
    var steps = [{
      label: "Initiated",
      detail: formatWhen(intent.createdAt),
      state: "done"
    }];
    var ackState = "upcoming";
    var ackDetail = "Waiting for the channel";
    if (status === "INITIATED") {
      ackState = "current";
    } else if (status === "AWAITING_PROVIDER") {
      ackState = "current";
      ackDetail = intent.providerStatus || "Pending";
    } else if (status === "PROVIDER_DECLINED") {
      ackState = "failed";
      ackDetail = intent.failureCode || "Provider declined";
    } else {
      ackState = "done";
      ackDetail = intent.providerReference || intent.providerStatus || "Acknowledged";
    }
    steps.push({ label: "Channel ack", detail: ackDetail, state: ackState });

    var hookSeen = ["POSTING_CORE", "POSTED", "PROVIDER_DECLINED", "CORE_REJECTED", "AMBIGUOUS", "REVERSED"].indexOf(status) >= 0;
    var hookState = "upcoming";
    var hookDetail = "Waiting for signed callback";
    if (status === "PROVIDER_DECLINED") {
      hookState = "failed";
      hookDetail = intent.webhookEventId || "Decline callback";
    } else if (hookSeen) {
      hookState = "done";
      hookDetail = intent.webhookEventId || "Callback matched";
    } else if (ackState === "done") {
      hookState = "current";
    }
    steps.push({ label: "Webhook", detail: hookDetail, state: hookState });

    var postState = "upcoming";
    var postDetail = "Not posted to Fineract";
    if (status === "POSTED" || status === "REVERSED") {
      postState = "done";
      postDetail = intent.fineractTransactionId ? "Txn " + intent.fineractTransactionId : statusLabel(status);
    } else if (status === "CORE_REJECTED" || status === "AMBIGUOUS") {
      postState = "failed";
      postDetail = intent.failureCode || status;
    } else if (status === "POSTING_CORE") {
      postState = "current";
      postDetail = "Posting to Fineract";
    }
    steps.push({ label: "Fineract posted", detail: postDetail, state: postState });
    return steps;
  }

  function canRetry(intent) {
    return FAILED.indexOf(intent.status) >= 0;
  }

  function retryPatch(intent, note) {
    var next = intent.status === "PROVIDER_DECLINED" ? "AWAITING_PROVIDER" : "POSTING_CORE";
    return {
      status: next,
      failureCode: "",
      providerStatus: next === "AWAITING_PROVIDER" ? "PENDING" : "SUCCESSFUL",
      coreStatus: next === "POSTING_CORE" ? "POSTING" : "NOT_POSTED",
      updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      retryNote: note
    };
  }

  function filterIntents(intents, query) {
    var q = query || {};
    var text = String(q.text || "").toLowerCase().trim();
    return intents.filter(function (row) {
      if (q.channel && row.channel !== q.channel) return false;
      if (q.direction && row.direction !== q.direction) return false;
      if (q.status) {
        if (q.status === "posted" || q.status === "pending" || q.status === "failed") {
          if (bucket(row.status) !== q.status) return false;
        } else if (row.status !== q.status) return false;
      }
      var day = kampalaDate(row.createdAt);
      /* A row whose date cannot be read never passes a date filter. */
      if ((q.from || q.to) && !day) return false;
      if (q.from && day < q.from) return false;
      if (q.to && day > q.to) return false;
      if (!text) return true;
      var hay = [
        row.intentId, row.memberName, row.msisdn, row.externalReference,
        row.idempotencyKey, row.channel, row.providerReference, row.hmacRef
      ].join(" ").toLowerCase();
      return hay.indexOf(text) !== -1;
    });
  }

  function stamp(row) {
    var t = Date.parse(row && row.createdAt);
    return isNaN(t) ? -Infinity : t;
  }

  /* Newest first by parsed time (offsets differ between rows). Unreadable dates sort last. */
  function byNewest(a, b) {
    var ta = stamp(a);
    var tb = stamp(b);
    if (ta !== tb) return tb > ta ? 1 : -1;
    return String(a.intentId || "").localeCompare(String(b.intentId || ""));
  }

  function summarize(intents) {
    var byChannel = {};
    var byDayMap = {};
    CHANNELS.forEach(function (ch) {
      byChannel[ch.id] = blankChannel(ch.id);
    });
    var posted = 0;
    var pending = 0;
    var failed = 0;
    var reversed = 0;
    var ambiguous = 0;
    var completed = 0;
    var volumePosted = 0;
    var volumeAll = 0;
    var collect = 0;
    var disburse = 0;
    var collectInitiated = 0;
    var disburseInitiated = 0;
    var collectCount = 0;
    var disburseCount = 0;
    intents.forEach(function (row) {
      var amount = Number(row.amount) || 0;
      var kind = bucket(row.status);
      var done = isCompleted(row.status);
      var debit = row.direction === "DEBIT";
      volumeAll += amount;
      if (kind === "posted") {
        posted += 1;
        volumePosted += amount;
      } else if (kind === "failed") failed += 1;
      else if (kind === "reversed") reversed += 1;
      else pending += 1;
      if (row.status === "AMBIGUOUS") ambiguous += 1;
      if (done) completed += 1;
      if (debit) disburseInitiated += amount;
      else collectInitiated += amount;
      /* Collections and disbursements count POSTED money only. */
      if (kind === "posted") {
        if (debit) { disburse += amount; disburseCount += 1; }
        else { collect += amount; collectCount += 1; }
      }
      if (!byChannel[row.channel]) byChannel[row.channel] = blankChannel(row.channel);
      var ch = byChannel[row.channel];
      ch.count += 1;
      ch.volume += amount;
      if (kind === "posted") ch.posted += 1;
      if (kind === "failed") ch.failed += 1;
      if (done) ch.completed += 1;
      var day = kampalaDate(row.createdAt) || "unknown";
      if (!byDayMap[day]) byDayMap[day] = { day: day, count: 0, volume: 0, posted: 0 };
      byDayMap[day].count += 1;
      byDayMap[day].volume += amount;
      if (kind === "posted") byDayMap[day].posted += 1;
    });
    var count = intents.length;
    var byDay = Object.keys(byDayMap).sort().map(function (key) { return byDayMap[key]; });
    return {
      count: count,
      posted: posted,
      pending: pending,
      failed: failed,
      reversed: reversed,
      ambiguous: ambiguous,
      completed: completed,
      volumePosted: volumePosted,
      volumeAll: volumeAll,
      collect: collect,
      disburse: disburse,
      collectCount: collectCount,
      disburseCount: disburseCount,
      collectInitiated: collectInitiated,
      disburseInitiated: disburseInitiated,
      successRate: successRate(posted, completed),
      byChannel: byChannel,
      byDay: byDay
    };
  }

  function isCompleted(status) {
    return status === "POSTED" || COMPLETED_FAILED.indexOf(status) >= 0;
  }

  /* POSTED / (POSTED + declined + rejected). Null when nothing has completed. */
  function successRate(posted, completed) {
    return completed ? (posted / completed) * 100 : null;
  }

  function formatRate(rate) {
    return rate == null || !isFinite(rate) ? "—" : rate.toFixed(1) + "%";
  }

  function bookWindow(intents) {
    var days = intents.map(function (row) { return kampalaDate(row.createdAt); }).filter(Boolean).sort();
    if (!days.length) return { from: "", to: "" };
    var to = days[days.length - 1];
    var fromDate = new Date(to + "T12:00:00Z");
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    var from = fromDate.toISOString().slice(0, 10);
    if (from < days[0]) from = days[0];
    return { from: from, to: to };
  }

  function modeFor(channel, health) {
    var mode = (health && health.mode) || {};
    var value = "";
    if (channel === "MTN_MOMO") value = mode.mtnMomo || mode.channel || "";
    else if (channel === "AIRTEL_MONEY") value = mode.airtelMoney || mode.channel || "";
    else value = mode.channel || "";
    value = String(value || "").toLowerCase();
    if (value === "mock" || value === "sandbox" || value === "live") return value;
    return "";
  }

  /* Spreadsheet-safe CSV cell: neutralise formula starters, quote separators and line breaks. */
  function csvEscape(value) {
    var text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  var DEMO_CSV_LINE = "# DEMO DATA - not real payments (fixtures/intents.json)";

  function csvLines(header, rows, opts) {
    var lines = [];
    if (opts && opts.demo) lines.push(DEMO_CSV_LINE);
    lines.push(header.map(csvEscape).join(","));
    rows.forEach(function (cells) { lines.push(cells.map(csvEscape).join(",")); });
    return lines.join("\n") + "\n";
  }

  /* Whole shillings only: 1234000 or 1,234,000. Returns { ok, value, error }. */
  function parseWholeShillings(raw, max) {
    var limit = max == null ? MAX_INITIATE_UGX : max;
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return { ok: false, value: "", error: "Enter an amount in whole shillings." };
    if (!AMOUNT_PATTERN.test(text)) {
      return { ok: false, value: "", error: "Use digits only, with optional thousands commas (for example 1,234,000). No decimals, spaces, or other characters." };
    }
    var digits = text.replace(/,/g, "").replace(/^0+(?=\d)/, "");
    if (/^0+$/.test(digits)) return { ok: false, value: "", error: "The amount must be more than zero." };
    if (digits.length > String(limit).length || Number(digits) > limit) {
      return { ok: false, value: "", error: "The most the portal can initiate is " + formatUgx(limit) + "." };
    }
    return { ok: true, value: digits, error: "" };
  }

  /* Validates the retry dialog and builds the resolve body from what the operator actually ticked. */
  function retryRequest(intent, input) {
    input = input || {};
    var note = String(input.note || "").trim();
    var ref = String(input.providerReference || "").trim();
    if (!canRetry(intent)) return { ok: false, error: "Only a failed run can be retried." };
    if (note.length < 8) return { ok: false, error: "The note needs at least 8 characters." };
    if (input.confirmNotPosted !== true) return { ok: false, error: "Tick the box to confirm the earlier attempt did not post." };
    if (intent.status === "AMBIGUOUS") {
      if (!ref) return { ok: false, error: "Type the provider reference you checked with the channel." };
      if (intent.providerReference && ref !== intent.providerReference) {
        return { ok: false, error: "That provider reference does not match this run." };
      }
    }
    var body = { action: "allow_single_retry", note: note, confirmNotPosted: input.confirmNotPosted === true };
    if (ref) body.checkedProviderReference = ref;
    return { ok: true, error: "", body: body };
  }

  function statusTone(status) {
    if (status === "POSTED") return "posted";
    if (status === "REVERSED") return "reversed";
    if (status === "POSTING_CORE") return "posting";
    if (status === "AMBIGUOUS") return "ambiguous";
    if (status === "PROVIDER_DECLINED" || status === "CORE_REJECTED") return "declined";
    if (status === "AWAITING_PROVIDER" || status === "INITIATED") return "awaiting";
    return "pending";
  }

  function channelVisual(id) {
    if (id === "MTN_MOMO") return { slug: "mtn", short: "MTN", label: "MTN MoMo" };
    if (id === "AIRTEL_MONEY") return { slug: "airtel", short: "ATL", label: "Airtel Money" };
    if (id === "BANK") return { slug: "bank", short: "BNK", label: "Bank" };
    if (id === "CARD") return { slug: "card", short: "CRD", label: "Card" };
    return { slug: "bank", short: "CH", label: channelLabel(id) };
  }

  function eatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Kampala",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
  }

  function formatDay(day) {
    if (!day) return "—";
    var d = new Date(String(day).slice(0, 10) + "T12:00:00Z");
    if (isNaN(d.getTime())) return day;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(d);
  }

  function formatAmount(amount) {
    var n = Number(amount);
    if (!isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-UG");
  }

  function compactNumber(amount) {
    var n = Number(amount) || 0;
    if (Math.abs(n) >= 1000000) {
      var millions = Math.round((n / 1000000) * 10) / 10;
      return millions.toFixed(1).replace(/\.0$/, "") + "M";
    }
    return formatAmount(n);
  }

  function latestDay(intents) {
    var days = intents.map(function (row) { return kampalaDate(row.createdAt); }).filter(Boolean).sort();
    return days.length ? days[days.length - 1] : "";
  }

  function shiftDay(day, delta) {
    var d = new Date(day + "T12:00:00Z");
    if (isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  function onDay(intents, day) {
    return intents.filter(function (row) { return kampalaDate(row.createdAt) === day; });
  }

  function coreMix(intents) {
    var mix = { POSTED: 0, POSTING: 0, NOT_POSTED: 0, REJECTED: 0 };
    intents.forEach(function (row) {
      var core = row.coreStatus || "";
      if (core === "POSTED") mix.POSTED += 1;
      else if (core === "POSTING") mix.POSTING += 1;
      else if (core === "REJECTED" || core === "AMBIGUOUS") mix.REJECTED += 1;
      else mix.NOT_POSTED += 1;
    });
    return mix;
  }

  function settlementPacks(intents) {
    var map = {};
    var slug = { MTN_MOMO: "mtn", AIRTEL_MONEY: "atl", BANK: "bnk", CARD: "crd" };
    intents.forEach(function (row) {
      var day = kampalaDate(row.createdAt) || "unknown";
      var key = day + "|" + row.channel;
      if (!map[key]) {
        map[key] = {
          id: "stl_" + day.replace(/-/g, "") + "_" + (slug[row.channel] || "ch"),
          day: day,
          channel: row.channel,
          count: 0,
          volume: 0,
          posted: 0
        };
      }
      var pack = map[key];
      var amount = Number(row.amount) || 0;
      pack.count += 1;
      pack.volume += amount;
      if (bucket(row.status) === "posted") pack.posted += amount;
    });
    return Object.keys(map).sort().reverse().map(function (key) { return map[key]; });
  }

  function toCsv(intents, opts) {
    var header = [
      "createdAt", "intentId", "memberName", "msisdn", "channel", "direction",
      "product", "amount", "currency", "status", "externalReference", "idempotencyKey"
    ];
    return csvLines(header, intents.map(function (row) {
      return header.map(function (key) { return row[key]; });
    }), opts);
  }

  function packSettled(pack) {
    return pack.count > 0 && pack.posted >= pack.volume;
  }

  function packsToCsv(packs, opts) {
    var header = ["packId", "date", "channel", "txns", "volume", "corePosted", "status"];
    return csvLines(header, packs.map(function (pack) {
      return [pack.id, pack.day, pack.channel, pack.count, pack.volume, pack.posted, packSettled(pack) ? "Settled" : "Open"];
    }), opts);
  }

  /*
   * Decide how to show one table page from a portal list response.
   * server: the gateway honoured limit/offset. client: it returned the whole set, so cut the page here
   * and say so. untrusted: it returned more than a page but less than the total, so show nothing.
   */
  function pagePlan(items, total, pageNo, pageSize) {
    var offset = (pageNo - 1) * pageSize;
    if (items.length <= pageSize) {
      return { mode: "server", rows: items, total: Math.max(total, offset + items.length), note: "" };
    }
    if (items.length >= total) {
      return {
        mode: "client",
        rows: items.slice(offset, offset + pageSize),
        total: items.length,
        note: "The gateway ignored limit/offset and returned all " + items.length + " rows. This page was cut in the browser."
      };
    }
    return {
      mode: "untrusted",
      rows: [],
      total: total,
      note: "The gateway returned " + items.length + " rows for a page of " + pageSize + " (total " + total + "). Paging cannot be trusted, so no rows are shown."
    };
  }

  var PORTAL_QUERY_KEYS = [
    "channel", "direction", "status", "product", "partnerId", "from", "to", "q", "limit", "offset"
  ];

  function portalQuery(filters) {
    var params = new URLSearchParams();
    filters = filters || {};
    PORTAL_QUERY_KEYS.forEach(function (key) {
      if (filters[key] == null || filters[key] === "") return;
      params.set(key, String(filters[key]));
    });
    return params.toString();
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function asPercent(value) {
    if (value == null || value === "") return null;
    var n = Number(value);
    if (!isFinite(n)) return null;
    if (n >= 0 && n <= 1) return n * 100;
    return n;
  }

  function timelineState(step) {
    var raw = String((step && (step.state || step.status)) || "").toLowerCase();
    if (["done", "completed", "complete", "ok", "success", "posted"].indexOf(raw) >= 0) return "done";
    if (["failed", "fail", "error", "declined", "rejected"].indexOf(raw) >= 0) return "failed";
    if (["current", "active", "pending", "in_progress", "running"].indexOf(raw) >= 0) return "current";
    return "upcoming";
  }

  function normalizeTimeline(raw) {
    var steps = raw;
    if (raw && !Array.isArray(raw)) steps = raw.steps || raw.events || raw.items || null;
    if (!Array.isArray(steps) || !steps.length) return null;
    return steps.map(function (step, index) {
      step = step || {};
      return {
        label: textOrEmpty(step.label || step.title || step.step || step.name || ("Step " + (index + 1))),
        detail: textOrEmpty(step.detail || step.message || step.meta || step.description),
        state: timelineState(step),
        at: textOrEmpty(step.at || step.occurredAt || step.timestamp),
        code: textOrEmpty(step.code || step.ref)
      };
    });
  }

  function intentFromPortal(row) {
    row = row || {};
    var source = row.intent && typeof row.intent === "object" ? row.intent : row;
    var intent = normalizeIntent(source);
    var timeline = normalizeTimeline(row.timeline || row.events || source.timeline || source.events);
    if (timeline) intent.timeline = timeline;
    return intent;
  }

  function normalizePortalList(body) {
    var items = normalizeList(body).map(intentFromPortal);
    var total = items.length;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      var raw = body.total != null ? body.total : (body.totalCount != null ? body.totalCount : body.count);
      if (raw != null && isFinite(Number(raw))) total = Number(raw);
    }
    return { items: items, total: total };
  }

  function blankChannel(id) {
    return { id: id, label: channelLabel(id), count: 0, volume: 0, posted: 0, failed: 0, completed: 0 };
  }

  function applyChannel(channels, id, row) {
    if (!id) return;
    if (!channels[id]) channels[id] = blankChannel(id);
    row = row || {};
    var target = channels[id];
    target.count = num(row.count != null ? row.count : (row.txns != null ? row.txns : row.total));
    target.volume = num(row.volume != null ? row.volume : (row.grossVolume != null ? row.grossVolume : row.amount));
    if (row.posted != null || row.postedCount != null || row.successCount != null) {
      target.posted = num(row.posted != null ? row.posted : (row.postedCount != null ? row.postedCount : row.successCount));
    } else {
      var rate = asPercent(row.successRate);
      target.posted = rate != null && target.count ? Math.round((rate / 100) * target.count) : 0;
    }
    target.failed = num(row.failed != null ? row.failed : row.failedCount);
    target.completed = target.posted + target.failed;
  }

  function normalizeSummary(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    var channels = {};
    CHANNELS.forEach(function (ch) { channels[ch.id] = blankChannel(ch.id); });
    var src = body.byChannel || body.channels || body.channelMix || [];
    if (Array.isArray(src)) {
      src.forEach(function (row) {
        applyChannel(channels, row && (row.channel || row.id || row.channelId), row);
      });
    } else if (src && typeof src === "object") {
      Object.keys(src).forEach(function (id) { applyChannel(channels, id, src[id]); });
    }
    var volumePosted = num(body.volumePosted != null ? body.volumePosted : (body.settledVolume != null ? body.settledVolume : (body.settledToCore != null ? body.settledToCore : body.settled)));
    var volumeAll = num(body.volumeAll != null ? body.volumeAll : (body.grossVolume != null ? body.grossVolume : (body.volume != null ? body.volume : body.gross)));
    var inflight = num(body.inflightVolume != null ? body.inflightVolume : body.inFlightVolume);
    if (!volumeAll && (volumePosted || inflight)) volumeAll = volumePosted + inflight;
    var count = num(body.count != null ? body.count : (body.total != null ? body.total : body.txnCount));
    var posted = num(body.posted != null ? body.posted : (body.postedCount != null ? body.postedCount : body.successCount));
    var rate = asPercent(body.successRate);
    return {
      count: count,
      posted: posted,
      pending: num(body.pending != null ? body.pending : (body.pendingCount != null ? body.pendingCount : body.inflightCount)),
      failed: num(body.failed != null ? body.failed : body.failedCount),
      volumePosted: volumePosted,
      volumeAll: volumeAll,
      collect: num(body.collect != null ? body.collect : body.collections),
      disburse: num(body.disburse != null ? body.disburse : body.disbursements),
      successRate: rate != null ? rate : successRate(posted, posted + num(body.failed != null ? body.failed : body.failedCount)),
      byChannel: channels,
      byDay: body.byDay || {}
    };
  }

  return {
    FAILED: FAILED,
    PENDING: PENDING,
    MAX_INITIATE_UGX: MAX_INITIATE_UGX,
    DEMO_CSV_LINE: DEMO_CSV_LINE,
    isCompleted: isCompleted,
    successRate: successRate,
    formatRate: formatRate,
    todayKampala: todayKampala,
    csvEscape: csvEscape,
    parseWholeShillings: parseWholeShillings,
    retryRequest: retryRequest,
    packSettled: packSettled,
    packsToCsv: packsToCsv,
    pagePlan: pagePlan,
    CHANNELS: CHANNELS,
    bucket: bucket,
    channelLabel: channelLabel,
    directionLabel: directionLabel,
    productLabel: productLabel,
    statusLabel: statusLabel,
    statusClass: statusClass,
    statusTone: statusTone,
    channelVisual: channelVisual,
    eatTime: eatTime,
    formatDay: formatDay,
    formatAmount: formatAmount,
    compactNumber: compactNumber,
    latestDay: latestDay,
    shiftDay: shiftDay,
    onDay: onDay,
    coreMix: coreMix,
    settlementPacks: settlementPacks,
    kampalaDate: kampalaDate,
    formatWhen: formatWhen,
    formatUgx: formatUgx,
    normalizeList: normalizeList,
    normalizeIntent: normalizeIntent,
    portalQuery: portalQuery,
    normalizeTimeline: normalizeTimeline,
    intentFromPortal: intentFromPortal,
    normalizePortalList: normalizePortalList,
    normalizeSummary: normalizeSummary,
    displayName: displayName,
    timeline: timeline,
    canRetry: canRetry,
    retryPatch: retryPatch,
    filterIntents: filterIntents,
    byNewest: byNewest,
    summarize: summarize,
    bookWindow: bookWindow,
    modeFor: modeFor,
    toCsv: toCsv
  };
});
