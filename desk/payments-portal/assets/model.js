/* Payments portal — pure view model. No DOM, no secrets. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PaymentsModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  var FAILED = ["PROVIDER_DECLINED", "CORE_REJECTED", "AMBIGUOUS"];
  var PENDING = ["INITIATED", "AWAITING_PROVIDER", "POSTING_CORE"];
  var CHANNELS = [
    { id: "MTN_MOMO", label: "MTN MoMo", blurb: "Collections and disbursements. Callbacks land on the gateway, not Fineract." },
    { id: "AIRTEL_MONEY", label: "Airtel Money", blurb: "Collections and disbursements. Same orchestrator path as MoMo." },
    { id: "BANK", label: "Bank", blurb: "Generic bank settlement callback. Cash still stays on the teller desk." },
    { id: "CARD", label: "Card", blurb: "PSP reference and account metadata only. PAN, CVV, and track data are rejected." }
  ];

  function bucket(status) {
    if (status === "POSTED" || status === "REVERSED") return "posted";
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
    return "pending";
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
      if (q.from && day && day < q.from) return false;
      if (q.to && day && day > q.to) return false;
      if (!text) return true;
      var hay = [
        row.intentId, row.memberName, row.msisdn, row.externalReference,
        row.idempotencyKey, row.channel, row.providerReference, row.hmacRef
      ].join(" ").toLowerCase();
      return hay.indexOf(text) !== -1;
    });
  }

  function byNewest(a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  }

  function summarize(intents) {
    var byChannel = {};
    var byDayMap = {};
    CHANNELS.forEach(function (ch) {
      byChannel[ch.id] = { id: ch.id, label: ch.label, count: 0, volume: 0, posted: 0, failed: 0 };
    });
    var posted = 0;
    var pending = 0;
    var failed = 0;
    var volumePosted = 0;
    var volumeAll = 0;
    var collect = 0;
    var disburse = 0;
    intents.forEach(function (row) {
      var amount = Number(row.amount) || 0;
      var kind = bucket(row.status);
      volumeAll += amount;
      if (kind === "posted") {
        posted += 1;
        volumePosted += amount;
      } else if (kind === "failed") failed += 1;
      else pending += 1;
      if (row.direction === "DEBIT") disburse += amount;
      else collect += amount;
      if (!byChannel[row.channel]) {
        byChannel[row.channel] = { id: row.channel, label: channelLabel(row.channel), count: 0, volume: 0, posted: 0, failed: 0 };
      }
      var ch = byChannel[row.channel];
      ch.count += 1;
      ch.volume += amount;
      if (kind === "posted") ch.posted += 1;
      if (kind === "failed") ch.failed += 1;
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
      volumePosted: volumePosted,
      volumeAll: volumeAll,
      collect: collect,
      disburse: disburse,
      successRate: count ? (posted / count) * 100 : 0,
      byChannel: byChannel,
      byDay: byDay
    };
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

  function csvEscape(value) {
    var text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function statusTone(status) {
    if (status === "POSTED" || status === "REVERSED") return "posted";
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

  function toCsv(intents) {
    var header = [
      "createdAt", "intentId", "memberName", "msisdn", "channel", "direction",
      "product", "amount", "currency", "status", "externalReference", "idempotencyKey"
    ];
    var lines = [header.join(",")];
    intents.forEach(function (row) {
      lines.push(header.map(function (key) { return csvEscape(row[key]); }).join(","));
    });
    return lines.join("\n") + "\n";
  }

  return {
    FAILED: FAILED,
    PENDING: PENDING,
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
