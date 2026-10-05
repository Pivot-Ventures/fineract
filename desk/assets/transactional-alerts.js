/* Fire-and-forget member alerts after a Fineract posting has already succeeded.
 * Sends only Fineract ids with the teller's own Desk session (X-Staff-Authorization);
 * the alerts service reads the amount, balance and member phone from Fineract itself,
 * so nothing typed in the browser ends up in the message. No secret lives in the Desk.
 * Uses fetch directly. Do not call FineractAPI.get: a 401 there signs the teller out,
 * and a network error raises the Desk status bar. Failures here are ignored. */
(function () {
  "use strict";
  var ENDPOINT = "/alerts/api/v1/events";
  var ID = /^[1-9][0-9]{0,17}$/;

  function staffKey() {
    var api = window.FineractAPI;
    if (!api || !api.getSession) return "";
    var sess = api.getSession();
    return (sess && sess.base64EncodedAuthenticationKey) || "";
  }

  function id(value) {
    var text = value == null ? "" : String(value);
    return ID.test(text) ? text : "";
  }

  /* Only these shapes are sent. Anything else (or a missing id) sends nothing. */
  function payload(event) {
    if (!event || event.pending) return null;
    var type = event.type;
    var tx = id(event.transactionId);
    if (type === "deposit" || type === "withdrawal") {
      var savings = id(event.savingsAccountId);
      return tx && savings ? { type: type, transactionId: tx, savingsAccountId: savings } : null;
    }
    if (type === "loan_disburse" || type === "loan_repay") {
      var loan = id(event.loanId);
      return tx && loan ? { type: type, transactionId: tx, loanId: loan } : null;
    }
    if (type === "transfer") {
      var transfer = id(event.transferId);
      return transfer ? { type: "transfer", transferId: transfer } : null;
    }
    return null;
  }

  function notify(event) {
    try {
      var body = payload(event);
      var key = staffKey();
      if (!body || !key) return;
      var sent = fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Staff-Authorization": "Basic " + key
        },
        body: JSON.stringify(body),
        credentials: "same-origin",
        keepalive: true
      });
      if (sent && sent.catch) sent.catch(function () { return null; });
    } catch (e) { /* Fineract already posted; alerts must never block the Desk */ }
  }

  window.TransactionalAlerts = { notify: notify };
})();
