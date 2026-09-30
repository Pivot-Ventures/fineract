/* Pivosacc Mobile — Fineract API client */
(function (global) {
  "use strict";

  var BASE = "/fineract-provider/api/v1";
  var STORAGE_KEY = "pivosacc_mobile_session";
  // Account type 2 = savings in Fineract accounttransfers
  var ACCOUNT_TYPE_SAVINGS = 2;

  function toast(msg, kind) {
    var area = document.querySelector(".toast-area");
    if (!area) {
      area = document.createElement("div");
      area.className = "toast-area";
      document.body.appendChild(area);
    }
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " toast-" + kind : "");
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
  }

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveSession(sess) { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sess)); }
  function clearSession() { sessionStorage.removeItem(STORAGE_KEY); }
  function getSession() { return loadSession(); }
  function isLoggedIn() {
    var s = loadSession();
    return !!(s && s.base64EncodedAuthenticationKey && s.clientId);
  }

  function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    var sess = loadSession() || {};
    var tenant = opts.tenant || sess.tenantId || "default";
    var headers = {
      "Fineract-Platform-TenantId": tenant,
      Accept: "application/json",
    };
    if (opts.authKey || sess.base64EncodedAuthenticationKey) {
      headers.Authorization = "Basic " + (opts.authKey || sess.base64EncodedAuthenticationKey);
    }
    if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
    var url = path.indexOf("http") === 0 ? path : BASE + path;
    var res;
    try {
      res = await fetch(url, {
        method: method,
        headers: headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) {
      var err = new Error("Network error: " + netErr.message);
      err.cause = netErr;
      throw err;
    }
    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }
    if (!res.ok) {
      var msg = "HTTP " + res.status;
      if (data && data.errors && data.errors.length) {
        msg = data.errors.map(function (e) {
          return e.defaultUserMessage || e.developerMessage || e.message || "";
        }).filter(Boolean).join("; ") || msg;
      } else if (data && data.defaultUserMessage) msg = data.defaultUserMessage;
      else if (data && data.message) msg = data.message;
      else if (typeof data === "string") msg = data.slice(0, 200);
      var apiErr = new Error(msg);
      apiErr.status = res.status;
      apiErr.data = data;
      throw apiErr;
    }
    return data;
  }

  function get(path, opts) { return request("GET", path, null, opts); }
  function post(path, body, opts) { return request("POST", path, body, opts); }

  async function staffLogin(username, password, tenantId) {
    tenantId = tenantId || "default";
    var authBody = { username: username, password: password };
    var data;
    try {
      data = await request("POST", "/authentication", authBody, {
        tenant: tenantId,
        authKey: btoa(username + ":" + password),
      });
    } catch (e) {
      var key = btoa(username + ":" + password);
      await request("GET", "/clients?limit=1", null, { tenant: tenantId, authKey: key });
      data = { username: username, base64EncodedAuthenticationKey: key, authenticated: true };
    }
    var key = data.base64EncodedAuthenticationKey || btoa(username + ":" + password);
    if (typeof key === "string") key = key.replace(/\\u003d/g, "=").trim();
    return {
      username: data.username || username,
      userId: data.userId,
      officeId: data.officeId,
      officeName: data.officeName,
      staffId: data.staffId,
      tenantId: tenantId,
      base64EncodedAuthenticationKey: key,
      permissions: data.permissions || [],
      loggedInAt: new Date().toISOString(),
      authMode: "staff+client",
    };
  }

  /** Demo member login: staff auth + bind to client by accountNo / id / display name. */
  async function memberLogin(opts) {
    opts = opts || {};
    var username = opts.staffUser || "mifos";
    var password = opts.staffPass || "password";
    var tenantId = opts.tenantId || "default";
    var memberRef = String(opts.memberRef || "1").trim();
    var pin = String(opts.pin || "").trim();

    if (pin && pin !== "1234" && pin !== "0000") {
      throw new Error("Incorrect PIN. Demo PIN is 1234.");
    }

    var sess = await staffLogin(username, password, tenantId);
    saveSession(sess);

    var clients = await get("/clients?limit=200&offset=0");
    var items = (clients && clients.pageItems) || [];
    var client = null;
    var refLower = memberRef.toLowerCase();
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var acc = String(c.accountNo || "");
      var id = String(c.id || "");
      var name = String(c.displayName || "").toLowerCase();
      if (id === memberRef || acc === memberRef || acc.replace(/^0+/, "") === memberRef.replace(/^0+/, "") ||
          name.indexOf(refLower) >= 0) {
        client = c;
        break;
      }
    }
    if (!client && items.length) client = items[0];
    if (!client) throw new Error("No members found in Fineract. Create a client first.");

    sess.clientId = client.id;
    sess.clientName = client.displayName;
    sess.clientAccountNo = client.accountNo;
    sess.clientOffice = client.officeName;
    sess.clientMobile = client.mobileNo || "";
    sess.officeId = client.officeId || sess.officeId || 1;
    sess.memberRef = memberRef;
    saveSession(sess);
    return sess;
  }

  function logout() {
    clearSession();
    location.href = "login.html";
  }

  function requireAuth() {
    if (!isLoggedIn()) {
      location.href = "login.html";
      return false;
    }
    return true;
  }

  function fmtMoney(n, currency) {
    currency = currency || "UGX";
    var num = Number(n);
    if (!isFinite(num)) return currency + " —";
    var abs = Math.abs(Math.round(num));
    var s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return currency + " " + (num < 0 ? "−" : "") + s;
  }

  function fmtAmt(n) {
    var num = Number(n);
    if (!isFinite(num)) return "—";
    var sign = num > 0 ? "+" : (num < 0 ? "−" : "");
    var abs = Math.abs(Math.round(num));
    return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fmtDate(arrOrStr) {
    if (!arrOrStr) return "—";
    if (Array.isArray(arrOrStr) && arrOrStr.length >= 3) {
      var y = arrOrStr[0], m = arrOrStr[1], d = arrOrStr[2];
      var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return d + " " + months[m - 1] + " " + y;
    }
    return String(arrOrStr);
  }

  function initials(name) {
    if (!name) return "?";
    var parts = name.trim().split(/\s+/);
    return ((parts[0] && parts[0][0]) || "") + ((parts[1] && parts[1][0]) || "").toUpperCase();
  }

  function pickBalance(detail, listItem) {
    var bal = 0, avail = 0;
    if (detail && detail.summary) {
      if (detail.summary.accountBalance != null) bal = detail.summary.accountBalance;
      if (detail.summary.availableBalance != null) avail = detail.summary.availableBalance;
      else avail = bal;
    } else if (listItem) {
      if (listItem.accountBalance != null) bal = listItem.accountBalance;
      if (listItem.availableBalance != null) avail = listItem.availableBalance;
      else avail = bal;
    }
    return { balance: Number(bal) || 0, available: Number(avail) || 0 };
  }

  async function loadMemberBundle() {
    var sess = loadSession();
    if (!sess || !sess.clientId) throw new Error("Not logged in");
    var clientId = sess.clientId;
    var client = await get("/clients/" + clientId);
    if (client.officeId) {
      sess.officeId = client.officeId;
      saveSession(sess);
    }
    var accounts = {};
    try { accounts = await get("/clients/" + clientId + "/accounts"); } catch (e) { accounts = {}; }
    var savingsList = accounts.savingsAccounts || [];
    var loanList = accounts.loanAccounts || [];

    if (!savingsList.length) {
      try {
        var savPage = await get("/savingsaccounts?limit=200");
        var savItems = (savPage && savPage.pageItems) || (Array.isArray(savPage) ? savPage : []);
        savingsList = savItems.filter(function (s) {
          return String(s.clientId) === String(clientId);
        });
      } catch (e) { /* ignore */ }
    }

    // Enrich every savings account with detail + balances
    var savingsDetails = [];
    var totalBalance = 0, totalAvailable = 0, currency = "UGX";
    var allTransactions = [];
    for (var si = 0; si < savingsList.length; si++) {
      var item = savingsList[si];
      var detail = null;
      try {
        detail = await get("/savingsaccounts/" + item.id + "?associations=transactions");
      } catch (e) {
        detail = item;
      }
      var bals = pickBalance(detail, item);
      var cur = (detail && detail.currency && detail.currency.code) ||
        (item.currency && item.currency.code) || currency;
      currency = cur;
      var statusVal = (detail && detail.status && detail.status.value) ||
        (item.status && item.status.value) || "—";
      var active = !!(detail && detail.status && detail.status.active) ||
        !!(item.status && item.status.active);
      savingsDetails.push({
        id: item.id,
        accountNo: (detail && detail.accountNo) || item.accountNo,
        productName: (detail && (detail.savingsProductName || detail.productName)) ||
          item.productName || item.savingsProductName || "Savings",
        balance: bals.balance,
        available: bals.available,
        currency: cur,
        status: statusVal,
        active: active,
        detail: detail,
        transactions: (detail && detail.transactions) || [],
      });
      if (active || statusVal === "Active") {
        totalBalance += bals.balance;
        totalAvailable += bals.available;
      }
      var txns = (detail && detail.transactions) || [];
      for (var ti = 0; ti < txns.length; ti++) {
        var t = Object.assign({}, txns[ti]);
        t._accountNo = (detail && detail.accountNo) || item.accountNo;
        t._savingsId = item.id;
        allTransactions.push(t);
      }
    }

    // Sort txns newest first by date array then id
    allTransactions.sort(function (a, b) {
      var da = a.date || [], db = b.date || [];
      for (var k = 0; k < 3; k++) {
        var av = da[k] || 0, bv = db[k] || 0;
        if (av !== bv) return bv - av;
      }
      return (b.id || 0) - (a.id || 0);
    });

    var primarySavings = savingsDetails.length ? savingsDetails[0] : null;
    var transactions = primarySavings ? primarySavings.transactions : [];

    function sameClient(obj) {
      return obj && String(obj.clientId) === String(clientId);
    }

    var loans = [];
    for (var i = 0; i < loanList.length; i++) {
      var la = loanList[i];
      try { loans.push(await get("/loans/" + la.id + "?associations=all")); }
      catch (e) { loans.push(la); }
    }
    if (!loans.length) {
      try {
        var page = await get("/loans?limit=200");
        var items = (page && page.pageItems) || [];
        for (var j = 0; j < items.length; j++) {
          if (!sameClient(items[j])) continue;
          try { loans.push(await get("/loans/" + items[j].id + "?associations=all")); }
          catch (e2) { loans.push(items[j]); }
        }
      } catch (e3) { /* ignore */ }
    }

    return {
      client: client,
      savingsAccounts: savingsList,
      savingsDetails: savingsDetails,
      primarySavings: primarySavings,
      savingsDetail: primarySavings && primarySavings.detail,
      balance: totalBalance,
      available: totalAvailable,
      currency: currency,
      transactions: transactions,
      allTransactions: allTransactions,
      loans: loans,
      sess: sess,
    };
  }

  /** Search clients by accountNo / name / id for member-to-member transfer. */
  async function searchClients(query) {
    query = String(query || "").trim();
    if (!query) return [];
    var clients = await get("/clients?limit=200&offset=0");
    var items = (clients && clients.pageItems) || [];
    var q = query.toLowerCase();
    var qDigits = query.replace(/^0+/, "");
    var sess = loadSession();
    return items.filter(function (c) {
      if (sess && String(c.id) === String(sess.clientId)) return false;
      var acc = String(c.accountNo || "");
      var name = String(c.displayName || "").toLowerCase();
      var id = String(c.id || "");
      return id === query || acc === query || acc.replace(/^0+/, "") === qDigits ||
        name.indexOf(q) >= 0;
    }).slice(0, 12);
  }

  async function getClientSavings(clientId) {
    var accounts = {};
    try { accounts = await get("/clients/" + clientId + "/accounts"); } catch (e) { accounts = {}; }
    var list = accounts.savingsAccounts || [];
    if (!list.length) {
      try {
        var savPage = await get("/savingsaccounts?limit=200");
        var savItems = (savPage && savPage.pageItems) || [];
        list = savItems.filter(function (s) { return String(s.clientId) === String(clientId); });
      } catch (e2) { /* ignore */ }
    }
    return list.filter(function (s) {
      return !s.status || s.status.active || (s.status.value === "Active");
    });
  }

  /**
   * Fineract account transfer (savings → savings).
   * Supports own-account internal move and member-to-member.
   */
  async function accountTransfer(opts) {
    opts = opts || {};
    var sess = loadSession();
    var fromOfficeId = opts.fromOfficeId || sess.officeId || 1;
    var toOfficeId = opts.toOfficeId || opts.fromOfficeId || sess.officeId || 1;
    var body = {
      fromOfficeId: Number(fromOfficeId),
      fromClientId: Number(opts.fromClientId || sess.clientId),
      fromAccountType: ACCOUNT_TYPE_SAVINGS,
      fromAccountId: Number(opts.fromAccountId),
      toOfficeId: Number(toOfficeId),
      toClientId: Number(opts.toClientId),
      toAccountType: ACCOUNT_TYPE_SAVINGS,
      toAccountId: Number(opts.toAccountId),
      transferDate: opts.transferDate || todayStr(),
      transferAmount: Number(opts.amount),
      transferDescription: opts.description || "Pivosacc mobile transfer",
      dateFormat: "yyyy-MM-dd",
      locale: "en",
    };
    if (!body.fromAccountId || !body.toAccountId) throw new Error("Select from and to savings accounts.");
    if (!(body.transferAmount > 0)) throw new Error("Enter a valid transfer amount.");
    if (body.fromAccountId === body.toAccountId) throw new Error("From and to accounts must differ.");
    return post("/accounttransfers", body);
  }

  /**
   * Savings withdrawal — used for utility-tagged ledger posts and cash-out attempts.
   * MoMo rails remain Phase 1; this posts a Fineract withdrawal when possible.
   */
  async function savingsWithdrawal(opts) {
    opts = opts || {};
    var savingsId = opts.savingsId;
    if (!savingsId) throw new Error("No savings account selected.");
    var amount = Number(opts.amount);
    if (!(amount > 0)) throw new Error("Enter a valid amount.");
    var body = {
      transactionDate: opts.transactionDate || todayStr(),
      transactionAmount: amount,
      dateFormat: "yyyy-MM-dd",
      locale: "en",
      paymentTypeId: opts.paymentTypeId || 1, // Money Transfer
    };
    if (opts.note) body.note = opts.note;
    if (opts.receiptNumber) body.receiptNumber = opts.receiptNumber;
    if (opts.routingCode) body.routingCode = opts.routingCode;
    return post("/savingsaccounts/" + savingsId + "/transactions?command=withdrawal", body);
  }

  /** Loan repayment via Fineract (works when loan status is Active). */
  async function loanRepayment(opts) {
    opts = opts || {};
    var loanId = opts.loanId;
    if (!loanId) throw new Error("No loan selected.");
    var amount = Number(opts.amount);
    if (!(amount > 0)) throw new Error("Enter a valid repayment amount.");
    var body = {
      transactionDate: opts.transactionDate || todayStr(),
      transactionAmount: amount,
      dateFormat: "yyyy-MM-dd",
      locale: "en",
      paymentTypeId: opts.paymentTypeId || 4, // Cash / ledger
    };
    if (opts.note) body.note = opts.note;
    return post("/loans/" + loanId + "/transactions?command=repayment", body);
  }

  async function loanRepayTemplate(loanId) {
    return get("/loans/" + loanId + "/transactions/template?command=repayment");
  }

  global.MobileAPI = {
    get: get, post: post, request: request,
    staffLogin: staffLogin, memberLogin: memberLogin,
    logout: logout, requireAuth: requireAuth,
    getSession: getSession, saveSession: saveSession, clearSession: clearSession,
    isLoggedIn: isLoggedIn, loadMemberBundle: loadMemberBundle,
    searchClients: searchClients, getClientSavings: getClientSavings,
    accountTransfer: accountTransfer, savingsWithdrawal: savingsWithdrawal,
    loanRepayment: loanRepayment, loanRepayTemplate: loanRepayTemplate,
    todayStr: todayStr, ACCOUNT_TYPE_SAVINGS: ACCOUNT_TYPE_SAVINGS,
    fmtMoney: fmtMoney, fmtAmt: fmtAmt, fmtDate: fmtDate, initials: initials,
    toast: toast, BASE: BASE,
  };
})(window);
