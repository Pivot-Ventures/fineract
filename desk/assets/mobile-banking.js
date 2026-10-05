/* Pivot SACCO Desk — member mobile banking card on client-detail.html.
 * Talks to the member gateway (/mobile/api), which re-checks the signed-in staff member's
 * credentials and permission against Fineract on every call. */
(function () {
  "use strict";
  var api = window.FineractAPI;
  var card = document.getElementById("mobile-banking");
  var clientId = api && api.qs("id");
  if (!card || !clientId || !api.can("UPDATE_CLIENT")) return;
  card.hidden = false;

  var GATEWAY = "/mobile/api/v1/admin/members/" + encodeURIComponent(clientId);
  var el = function (id) { return document.getElementById(id); };

  async function call(method, suffix) {
    var sess = api.getSession() || {};
    var res;
    try {
      res = await fetch(GATEWAY + (suffix || ""), {
        method: method,
        headers: { Accept: "application/json", "X-Staff-Authorization": "Basic " + sess.base64EncodedAuthenticationKey },
        credentials: "same-origin"
      });
    } catch (e) {
      throw new Error("Cannot reach the mobile banking service.");
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && data.message) || ("Mobile banking service returned HTTP " + res.status));
    return data;
  }

  function when(ts) {
    return ts ? new Date(ts * 1000).toLocaleString("en-UG", { timeZone: "Africa/Kampala", dateStyle: "medium", timeStyle: "short" }) : "never";
  }

  var LABELS = {
    none: ["Not set up", "gray"],
    pending: ["Waiting for activation", "amber"],
    active: ["Active", "green"],
    locked: ["PIN locked", "amber"],
    blocked: ["Blocked", "red"]
  };

  function render(st) {
    var label = LABELS[st.status] || [st.status, "gray"];
    var chip = el("mb-status");
    chip.textContent = label[0];
    chip.className = "chip " + label[1];
    var lines = [];
    if (st.status === "none") lines.push("This member has not set up the Pivosacc app.");
    if (st.device) lines.push("Registered phone: " + st.device + ". Last sign-in: " + when(st.lastLoginAt) + ".");
    if (st.status === "locked") lines.push("Locked after " + st.failedAttempts + " wrong PIN attempts.");
    if (st.status === "blocked") lines.push("Blocked — the member needs a new activation code to use the app again.");
    if (st.codeExpiresAt) lines.push("An activation code is outstanding until " + when(st.codeExpiresAt) + ".");
    el("mb-detail").textContent = lines.join(" ") || "—";
    el("mb-issue").hidden = false;
    el("mb-issue").textContent = st.status === "active" || st.status === "locked" ? "Reset PIN / new phone" : "Issue activation code";
    el("mb-unlock").hidden = st.status !== "locked";
    el("mb-block").hidden = !(st.status === "active" || st.status === "locked" || st.status === "pending");
  }

  async function refresh() {
    try { render(await call("GET")); }
    catch (e) { el("mb-detail").textContent = e.message; }
  }

  async function act(btn, method, suffix, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    btn.disabled = true;
    try {
      var res = await call(method, suffix);
      if (res && res.code) {
        var box = el("mb-code");
        box.hidden = false;
        box.textContent = "";
        var strong = document.createElement("strong");
        strong.textContent = res.code;
        strong.style.fontSize = "1.4em";
        strong.style.letterSpacing = "0.08em";
        box.append("Give this code to the member in person, after checking their ID: ", strong,
          " — member no. " + res.memberNo + ", valid until " + when(res.expiresAt) +
          ". It is shown only once. Never send it by SMS or WhatsApp to a number you have not verified.");
        render(res.state);
      } else {
        render(res);
        api.toast("Mobile banking updated", "success");
      }
      /* No Desk alert here. A browser must not choose the phone or the text, and
         activation codes stay on this screen. PIN and block alerts are sent by a
         server that holds ALERTS_SERVICE_KEY, not by this page. */
    } catch (e) {
      api.toast(e.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  el("mb-issue").addEventListener("click", function () {
    act(this, "POST", "/activation",
      "Issue a new activation code? Any phone already registered stops working once the member activates the new code.");
  });
  el("mb-unlock").addEventListener("click", function () { act(this, "POST", "/unlock"); });
  el("mb-block").addEventListener("click", function () {
    act(this, "POST", "/block", "Block mobile banking for this member? They will be signed out immediately.");
  });
  refresh();
})();
