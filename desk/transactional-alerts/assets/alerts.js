/* Phaneroo transactional alerts desk. Calls /alerts/api/v1 on the same host with the
 * signed-in staff member's Desk session; admin views need ALL_FUNCTIONS or the
 * permission the service names in ALERTS_ADMIN_PERMISSION. */
(function () {
  "use strict";
  var fa = window.FineractAPI;
  if (!fa || !fa.requireAuth()) return;
  fa.startSessionTimers();

  var API = "/alerts/api/v1";
  var TOKENS = {
    money: "{{amount}} {{account}} {{balance}} {{reference}} {{date}} {{memberName}} {{branch}}",
    notice: "{{memberName}} {{date}} {{branch}}"
  };
  var NOTICE_TYPES = ["pin", "activation", "mobile_blocked"];
  var root = document.getElementById("alerts-root");
  var title = document.getElementById("page-title");
  var chip = document.getElementById("health-chip");
  var state = { templates: [], deliveries: [], health: null, settings: null, editing: null, error: "", forbidden: "" };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function view() {
    var hash = (location.hash || "#templates").replace("#", "");
    if (hash !== "deliveries" && hash !== "test") return "templates";
    return hash;
  }

  function headers(json) {
    var h = { Accept: "application/json" };
    if (json) h["Content-Type"] = "application/json";
    var sess = fa.getSession();
    if (sess && sess.base64EncodedAuthenticationKey) h["X-Staff-Authorization"] = "Basic " + sess.base64EncodedAuthenticationKey;
    return h;
  }

  function forbidden(required) {
    var err = new Error("forbidden");
    err.forbidden = required || "ALL_FUNCTIONS";
    return err;
  }

  async function api(method, path, body) {
    var res;
    try {
      res = await fetch(API + path, {
        method: method,
        headers: headers(body != null),
        body: body != null ? JSON.stringify(body) : undefined,
        credentials: "same-origin"
      });
    } catch (e) {
      throw new Error("Cannot reach the alerts service at /alerts/api/v1. Is it running behind the reverse proxy?");
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) throw new Error("The alerts service did not accept your Desk session. Sign out and sign in again.");
    if (res.status === 403) throw forbidden(data && data.required);
    if (res.status === 429) throw new Error("Too many requests to the alerts service. Wait a minute and try again.");
    if (res.status === 503) throw new Error((data && data.error) || "The alerts service cannot check staff sign-in right now.");
    if (!res.ok) throw new Error((data && data.error) || ("Alerts service returned HTTP " + res.status));
    return data;
  }

  function pill(on, yes, no) {
    return '<span class="pill ' + (on ? "ok" : "") + '">' + (on ? yes : no) + "</span>";
  }

  function statusPill(status) {
    var kind = status === "sent" ? "ok" : (status === "failed" ? "bad" : "warn");
    return '<span class="pill ' + kind + '">' + esc(status || "—") + "</span>";
  }

  function markNav() {
    var current = view();
    document.querySelectorAll(".nav-link[data-view]").forEach(function (link) {
      var on = link.getAttribute("data-view") === current;
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    title.textContent = current === "deliveries" ? "Delivery log" : (current === "test" ? "Test send" : "Templates");
  }

  function paintHealth() {
    var h = state.health;
    if (!h) { chip.textContent = "● unreachable"; return; }
    chip.textContent = "● " + (h.mode === "live" ? "LIVE — members receive messages" : "Dry-run — nothing is sent");
  }

  function banner() {
    if (!state.error) return "";
    return '<div class="notice error" role="alert">' + esc(state.error) + "</div>";
  }

  function forbiddenView() {
    return '<div class="card"><div class="card-h"><h2>You do not have access to alert settings</h2></div><div class="card-b">' +
      "<p>Your Desk login is valid, but managing alerts needs the <strong>" + esc(state.forbidden) + "</strong> permission" +
      (state.forbidden === "ALL_FUNCTIONS" ? "" : " (or ALL_FUNCTIONS)") + ".</p>" +
      "<p>Ask an administrator to add it to your role in Desk → Roles. Member alerts after deposits, withdrawals, " +
      "loan postings and transfers keep working for every teller without it.</p>" +
      '<p><a class="btn btn-ghost" href="/dashboard.html">Back to Desk</a></p></div></div>';
  }

  function healthNote() {
    var h = state.health;
    if (!h) return '<div class="notice">The alerts API did not answer. Desk still posts events only after a successful Fineract posting, and a missed alert does not undo that posting.</div>';
    var s = state.settings;
    var live = h.mode === "live";
    var pills = '<span class="pill ' + (live ? "ok" : "warn") + '">' + (live ? "Live" : "Dry-run") + "</span>";
    if (s) {
      var sms = s.providers.sms;
      var wa = s.providers.whatsapp;
      pills += '<span class="pill info">SMS ' + (sms.configured ? (sms.live ? "live" : "configured, dry-run") : "not configured") + "</span>" +
        '<span class="pill info">WhatsApp ' + (wa.configured ? (wa.live ? "live" : "configured, dry-run") : "not configured") + "</span>" +
        '<span class="pill">Order: ' + esc((s.channelOrder || []).join(" → ")) + "</span>" +
        '<span class="pill">Max ' + esc(s.perPhoneHourly) + " per phone per hour</span>" +
        '<span class="pill">Daily cap ' + esc(s.dailyCap) + "</span>";
    }
    return '<div class="kpi-row">' + pills + "</div>" +
      '<p class="page-sub">' + (live ? "Messages go to members. " : "Dry-run: deliveries are recorded but no provider is called. The operator sets ALERTS_LIVE=true to go live. ") +
      "WhatsApp names must already be approved in LipeChat; leave that toggle off until they are. If WhatsApp fails and SMS is next in the order, SMS is sent instead — never both.</p>";
  }

  function templatesView() {
    var rows = state.templates.map(function (tpl) {
      return "<tr><td><strong>" + esc(tpl.label || tpl.type) + '</strong><div class="mono">' + esc(tpl.type) + "</div></td>" +
        "<td>" + pill(tpl.smsEnabled, "SMS on", "SMS off") + "</td>" +
        "<td>" + pill(tpl.whatsappEnabled, "WhatsApp on", "WhatsApp off") + '<div class="mono">' + esc(tpl.whatsappTemplateName || "—") + "</div></td>" +
        '<td><button type="button" class="btn btn-sm btn-ghost" data-edit="' + esc(tpl.type) + '">Edit</button></td></tr>';
    }).join("");
    var editor = "";
    if (state.editing) {
      var tpl = state.templates.filter(function (row) { return row.type === state.editing; })[0];
      if (tpl) {
        editor = '<form class="card" id="edit-form"><div class="card-h"><h2>Edit ' + esc(tpl.label || tpl.type) + "</h2></div><div class=\"card-b form-grid\">" +
          '<label>Label<input name="label" value="' + esc(tpl.label) + '" /></label>' +
          '<div class="checks">' +
          '<label><input type="checkbox" name="smsEnabled"' + (tpl.smsEnabled ? " checked" : "") + " /> SMS</label>" +
          '<label><input type="checkbox" name="whatsappEnabled"' + (tpl.whatsappEnabled ? " checked" : "") + " /> WhatsApp</label></div>" +
          '<label>SMS body<textarea name="smsBody">' + esc(tpl.smsBody) + "</textarea></label>" +
          '<p class="help">Tokens for this event: ' + esc(NOTICE_TYPES.indexOf(tpl.type) >= 0 ? TOKENS.notice : TOKENS.money) +
          ". Amounts read like UGX 1,500,000 and accounts like ****1234. Text inside [[ ]] is left out when a token in it is empty.</p>" +
          '<label>LipeChat template name<input name="whatsappTemplateName" value="' + esc(tpl.whatsappTemplateName) + '" /></label>' +
          '<label>Language code<input name="whatsappLanguageCode" value="' + esc(tpl.whatsappLanguageCode || "en") + '" /></label>' +
          '<label>WhatsApp placeholders, in {{1}} {{2}} order<input name="whatsappPlaceholders" value="' + esc((tpl.whatsappPlaceholders || []).join(", ")) + '" /></label>' +
          '<div class="btn-group"><button class="btn btn-amber" type="submit">Save template</button>' +
          '<button class="btn btn-ghost" type="button" id="cancel-edit">Cancel</button></div></div></form>';
      }
    }
    return banner() + healthNote() +
      '<div class="card"><div class="card-h"><h2>Event templates</h2></div><div class="card-b table-wrap"><table class="data"><thead><tr>' +
      "<th>Event</th><th>SMS</th><th>WhatsApp</th><th></th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="4">No templates yet.</td></tr>') +
      "</tbody></table></div></div>" + editor;
  }

  function deliveriesView() {
    var rows = state.deliveries.map(function (row) {
      return "<tr><td class=\"mono\">" + esc(row.at || "") + "</td><td>" + esc(row.type) + "</td><td>" + esc(row.source || "—") + "</td><td>" + esc(row.channel || "—") +
        "</td><td>" + statusPill(row.status) + (row.dryRun ? ' <span class="pill warn">dry-run</span>' : "") + "</td><td class=\"mono\">" + esc(row.providerId || "—") +
        "</td><td>" + esc(row.error || "—") + "</td><td class=\"mono\">" + esc(row.to || "—") + "</td></tr>";
    }).join("");
    return banner() + '<div class="card"><div class="card-h"><h2>Recent deliveries</h2></div><div class="card-b table-wrap">' +
      '<p class="page-sub">Phone numbers are masked and message text is never stored.</p><table class="data"><thead><tr>' +
      "<th>When</th><th>Event</th><th>From</th><th>Channel</th><th>Status</th><th>Provider id</th><th>Reason</th><th>To</th>" +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="8">No deliveries yet.</td></tr>') + "</tbody></table></div></div>";
  }

  function testView() {
    var options = state.templates.map(function (tpl) {
      return '<option value="' + esc(tpl.type) + '">' + esc(tpl.label || tpl.type) + "</option>";
    }).join("");
    return banner() + healthNote() +
      '<form class="card" id="test-form"><div class="card-h"><h2>Send a test</h2></div><div class="card-b form-grid">' +
      "<p class=\"page-sub\">Sends the template with sample values (UGX 150,000, account ****1234) to a Ugandan mobile you enter, ignoring the on/off toggles. It counts towards the per-phone and daily caps. In dry-run nothing reaches the provider.</p>" +
      '<label>Phone (Ugandan mobile)<input name="phone" required placeholder="0772 000 111" autocomplete="off" /></label>' +
      '<label>Channel<select name="channel"><option value="">Configured order</option><option value="sms">SMS only</option><option value="whatsapp">WhatsApp only</option></select></label>' +
      '<label>Event type<select name="type">' + options + "</select></label>" +
      '<div class="btn-group"><button class="btn btn-amber" type="submit">Send test</button></div>' +
      '<pre class="mono" id="test-result" hidden></pre></div></form>';
  }

  function paint() {
    markNav();
    paintHealth();
    var current = view();
    if (state.forbidden) root.innerHTML = forbiddenView();
    else if (current === "deliveries") root.innerHTML = deliveriesView();
    else if (current === "test") root.innerHTML = testView();
    else root.innerHTML = templatesView();
  }

  async function load() {
    state.error = "";
    state.forbidden = "";
    try {
      state.health = await api("GET", "/health");
    } catch (e) {
      state.health = null;
      state.error = e.message;
    }
    try {
      state.settings = await api("GET", "/settings");
      if (view() === "deliveries") {
        var book = await api("GET", "/deliveries?limit=50");
        state.deliveries = book.deliveries || [];
      } else {
        var templates = await api("GET", "/templates");
        state.templates = templates.templates || [];
      }
    } catch (e) {
      if (e.forbidden) state.forbidden = e.forbidden;
      else state.error = e.message;
    }
    paint();
  }

  root.addEventListener("click", function (event) {
    var edit = event.target.closest("[data-edit]");
    if (edit) {
      state.editing = edit.getAttribute("data-edit");
      paint();
      return;
    }
    if (event.target.id === "cancel-edit") {
      state.editing = null;
      paint();
    }
  });

  root.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.id === "edit-form") {
      event.preventDefault();
      var current = state.templates.filter(function (row) { return row.type === state.editing; })[0];
      if (!current) return;
      var data = new FormData(form);
      var next = Object.assign({}, current, {
        label: data.get("label"),
        smsEnabled: form.elements.smsEnabled.checked,
        whatsappEnabled: form.elements.whatsappEnabled.checked,
        smsBody: data.get("smsBody"),
        whatsappTemplateName: data.get("whatsappTemplateName"),
        whatsappLanguageCode: data.get("whatsappLanguageCode"),
        whatsappPlaceholders: String(data.get("whatsappPlaceholders") || "")
      });
      api("PUT", "/templates/" + encodeURIComponent(current.type), next).then(function () {
        state.editing = null;
        return load();
      }).catch(function (err) {
        if (err.forbidden) state.forbidden = err.forbidden;
        else state.error = err.message;
        paint();
      });
      return;
    }
    if (form.id === "test-form") {
      event.preventDefault();
      var fields = new FormData(form);
      var payload = {
        type: fields.get("type"),
        phone: fields.get("phone")
      };
      if (fields.get("channel")) payload.channel = fields.get("channel");
      api("POST", "/test-send", payload).then(function (result) {
        var box = document.getElementById("test-result");
        if (!box) return;
        box.hidden = false;
        box.textContent = JSON.stringify(result, null, 2);
      }).catch(function (err) {
        if (err.forbidden) state.forbidden = err.forbidden;
        else state.error = err.message;
        paint();
      });
    }
  });

  document.getElementById("refresh-btn").addEventListener("click", function () { load(); });
  window.addEventListener("hashchange", function () { load(); });
  var who = document.getElementById("signed-in-as");
  var sess = fa.getSession();
  if (who && sess && sess.username) who.textContent = "Signed in as " + sess.username;

  var toggle = document.querySelector("[data-toggle-sidebar]");
  var sidebar = document.getElementById("sidebar");
  if (toggle && sidebar) {
    toggle.addEventListener("click", function () { sidebar.classList.toggle("open"); });
  }
  if (!location.hash) location.hash = "#templates";
  load();
})();
