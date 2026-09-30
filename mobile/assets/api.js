/* Pivosacc Mobile — Fineract API client */
(function (global) {
  "use strict";

  var BASE = "/fineract-provider/api/v1";
  var STORAGE_KEY = "pivosacc_mobile_session";

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

    // Soft PIN gate for demo UX (not Fineract-backed). Accept 1234 or empty.
    if (pin && pin !== "1234" && pin !== "0000") {
      throw new Error("Incorrect PIN. Demo PIN is 1234.");
    }

    var sess = await staffLogin(username, password, tenantId);
    // Temporarily store so get() works
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

  async function loadMemberBundle() {
    var sess = loadSession();
    if (!sess || !sess.clientId) throw new Error("Not logged in");
    var clientId = sess.clientId;
    var client = await get("/clients/" + clientId);
    var accounts = {};
    try { accounts = await get("/clients/" + clientId + "/accounts"); } catch (e) { accounts = {}; }
    var savingsList = accounts.savingsAccounts || [];
    var loanList = accounts.loanAccounts || [];

    // Fallback: list savings accounts and filter by client
    if (!savingsList.length) {
      try {
        var savPage = await get("/savingsaccounts?limit=200");
        var savItems = (savPage && savPage.pageItems) || (Array.isArray(savPage) ? savPage : []);
        savingsList = savItems.filter(function (s) {
          return String(s.clientId) === String(clientId);
        });
      } catch (e) { /* ignore */ }
    }

    var primarySavings = savingsList.length ? savingsList[0] : null;
    var savingsDetail = null;
    var transactions = [];
    if (primarySavings) {
      try {
        savingsDetail = await get("/savingsaccounts/" + primarySavings.id + "?associations=transactions");
        transactions = savingsDetail.transactions || [];
      } catch (e) {
        savingsDetail = primarySavings;
      }
    }

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

    var bal = 0, avail = 0, currency = "UGX";
    if (savingsDetail && savingsDetail.summary) {
      if (savingsDetail.summary.accountBalance != null) bal = savingsDetail.summary.accountBalance;
      if (savingsDetail.summary.availableBalance != null) avail = savingsDetail.summary.availableBalance;
    } else if (primarySavings) {
      if (primarySavings.accountBalance != null) bal = primarySavings.accountBalance;
      if (primarySavings.availableBalance != null) avail = primarySavings.availableBalance;
    }
    if (savingsDetail && savingsDetail.currency && savingsDetail.currency.code) currency = savingsDetail.currency.code;
    else if (primarySavings && primarySavings.currency && primarySavings.currency.code) currency = primarySavings.currency.code;

    return {
      client: client,
      savingsAccounts: savingsList,
      primarySavings: primarySavings,
      savingsDetail: savingsDetail,
      balance: bal,
      available: avail,
      currency: currency,
      transactions: transactions,
      loans: loans,
      sess: sess,
    };
  }

  global.MobileAPI = {
    get: get, post: post, request: request,
    staffLogin: staffLogin, memberLogin: memberLogin,
    logout: logout, requireAuth: requireAuth,
    getSession: getSession, saveSession: saveSession, clearSession: clearSession,
    isLoggedIn: isLoggedIn, loadMemberBundle: loadMemberBundle,
    fmtMoney: fmtMoney, fmtAmt: fmtAmt, fmtDate: fmtDate, initials: initials,
    toast: toast, BASE: BASE,
  };
})(window);
