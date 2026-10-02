/* Fire-and-forget member alerts after a Fineract posting has already succeeded.
 * Uses fetch directly. Do not call FineractAPI.get: a 401 there signs the teller out,
 * and a network error raises the Desk status bar. Failures here are ignored. */
(function () {
  "use strict";
  var ENDPOINT = "/alerts/api/v1/events";

  function session() {
    var api = window.FineractAPI;
    if (!api || !api.getSession) return null;
    return api.getSession() || null;
  }

  function fineractGet(path) {
    var api = window.FineractAPI;
    var sess = session();
    if (!api || !sess || !sess.base64EncodedAuthenticationKey) return Promise.resolve(null);
    return fetch((api.BASE || "/fineract-provider/api/v1") + path, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Fineract-Platform-TenantId": sess.tenantId || api.DEFAULT_TENANT || "default",
        Authorization: "Basic " + sess.base64EncodedAuthenticationKey
      },
      credentials: "same-origin"
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).catch(function () { return null; });
  }

  function alertsKey() {
    try { return sessionStorage.getItem("transactionalAlerts.apiKey") || ""; }
    catch (e) { return ""; }
  }

  function postEvent(event) {
    var headers = { Accept: "application/json", "Content-Type": "application/json" };
    var key = alertsKey();
    if (key) headers["X-Alerts-Key"] = key;
    return fetch(ENDPOINT, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(event),
      credentials: "same-origin",
      keepalive: true
    }).catch(function () { return null; });
  }

  function withPhone(event) {
    if (!event || !event.type) return Promise.resolve(null);
    if (event.phone) return Promise.resolve(event);
    var accountPath = "";
    if (!event.memberId && event.savingsAccountId) accountPath = "/savingsaccounts/" + encodeURIComponent(event.savingsAccountId);
    else if (!event.memberId && event.loanAccountId) accountPath = "/loans/" + encodeURIComponent(event.loanAccountId);
    var lookup = accountPath ? fineractGet(accountPath) : Promise.resolve(null);
    return lookup.then(function (account) {
      if (account) {
        if (!event.account && account.accountNo) event.account = String(account.accountNo);
        if (!event.memberId && account.clientId != null) event.memberId = String(account.clientId);
        event.meta = event.meta || {};
        if (!event.meta.memberName && account.clientName) event.meta.memberName = String(account.clientName);
      }
      if (!event.memberId) return null;
      return fineractGet("/clients/" + encodeURIComponent(event.memberId));
    }).then(function (client) {
      if (event.phone) return event;
      if (!client) return null;
      var phone = client.mobileNo || "";
      if (!phone) return null;
      event.phone = String(phone);
      event.meta = event.meta || {};
      if (!event.meta.memberName && client.displayName) event.meta.memberName = String(client.displayName);
      return event;
    });
  }

  function notify(event) {
    Promise.resolve().then(function () {
      return withPhone(event);
    }).then(function (ready) {
      if (!ready || !ready.phone) return null;
      var payload = {
        type: ready.type,
        memberId: ready.memberId ? String(ready.memberId) : "",
        phone: String(ready.phone),
        amount: ready.amount,
        currency: ready.currency || "UGX",
        account: ready.account ? String(ready.account) : "",
        reference: ready.reference ? String(ready.reference) : "",
        meta: ready.meta || {}
      };
      if (payload.amount == null || payload.amount === "") delete payload.amount;
      return postEvent(payload);
    }).catch(function () { return null; });
  }

  window.TransactionalAlerts = { notify: notify };
})();
