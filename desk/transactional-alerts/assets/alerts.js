/* Phaneroo transactional alerts desk. Calls /alerts/api/v1 on the same host. */
(function () {
  "use strict";
  var API = "/alerts/api/v1";
  var KEY = "transactionalAlerts.apiKey";
  var root = document.getElementById("alerts-root");
  var title = document.getElementById("page-title");
  var chip = document.getElementById("health-chip");
  var keyInput = document.getElementById("api-key");
  var state = { templates: [], deliveries: [], health: null, editing: null, error: "" };

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
    var key = "";
    try { key = sessionStorage.getItem(KEY) || ""; } catch (e) { key = ""; }
    if (key) h["X-Alerts-Key"] = key;
    return h;
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
    if (res.status === 401) throw new Error("The alerts service rejected the operator key.");
    if (!res.ok) throw new Error((data && data.error) || ("Alerts service returned HTTP " + res.status));
    return data;
  }

  function pill(on, yes, no) {
    return '<span class="pill ' + (on ? "ok" : "") + '">' + (on ? yes : no) + "</span>";
  }

  function statusPill(status) {
    var kind = status === "sent" || status === "dry_run" ? "ok" : (status === "failed" ? "bad" : "warn");
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
    var sms = h.providers && h.providers.sms;
    var wa = h.providers && h.providers.whatsapp;
    var bits = [];
    bits.push("SMS " + (sms && sms.dryRun ? "dry-run" : "live"));
    bits.push("WhatsApp " + (wa && wa.dryRun ? "dry-run" : "live"));
    chip.textContent = "● " + bits.join(" · ");
  }

  function banner() {
    if (!state.error) return "";
    return '<div class="notice error" role="alert">' + esc(state.error) + "</div>";
  }

  function healthNote() {
    var h = state.health;
    if (!h) return '<div class="notice">The alerts API did not answer. Desk still posts events only after a successful Fineract posting, and a missed alert does not undo that posting.</div>';
    var sms = h.providers.sms;
    var wa = h.providers.whatsapp;
    return '<div class="kpi-row">' +
      '<span class="pill info">SMS ' + (sms.configured ? "configured" : "not configured") + "</span>" +
      '<span class="pill ' + (sms.dryRun ? "warn" : "ok") + '">' + (sms.dryRun ? "SMS dry-run" : "SMS live") + "</span>" +
      '<span class="pill info">WhatsApp ' + (wa.configured ? "configured" : "not configured") + "</span>" +
      '<span class="pill ' + (wa.dryRun ? "warn" : "ok") + '">' + (wa.dryRun ? "WhatsApp dry-run" : "WhatsApp live") + "</span>" +
      '<span class="pill">Email stub</span></div>' +
      '<p class="page-sub">WhatsApp names must already be approved in LipeChat. Leave that toggle off until they are. SMS uses Africa’s Talking.</p>';
  }

  function templatesView() {
    var rows = state.templates.map(function (tpl) {
      return "<tr><td><strong>" + esc(tpl.label || tpl.type) + '</strong><div class="mono">' + esc(tpl.type) + "</div></td>" +
        "<td>" + pill(tpl.smsEnabled, "SMS on", "SMS off") + "</td>" +
        "<td>" + pill(tpl.whatsappEnabled, "WhatsApp on", "WhatsApp off") + '<div class="mono">' + esc(tpl.whatsappTemplateName || "—") + "</div></td>" +
        "<td>" + pill(tpl.emailEnabled, "Email on", "Email stub") + "</td>" +
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
          '<label><input type="checkbox" name="whatsappEnabled"' + (tpl.whatsappEnabled ? " checked" : "") + " /> WhatsApp</label>" +
          '<label><input type="checkbox" name="emailEnabled"' + (tpl.emailEnabled ? " checked" : "") + " /> Email slot</label></div>" +
          '<label>SMS body<textarea name="smsBody">' + esc(tpl.smsBody) + "</textarea></label>" +
          '<p class="help">Tokens: {{amount}} {{currency}} {{account}} {{reference}} {{memberId}} {{phone}} plus meta keys.</p>' +
          '<label>LipeChat template name<input name="whatsappTemplateName" value="' + esc(tpl.whatsappTemplateName) + '" /></label>' +
          '<label>Language code<input name="whatsappLanguageCode" value="' + esc(tpl.whatsappLanguageCode || "en") + '" /></label>' +
          '<label>WhatsApp placeholders, in {{1}} {{2}} order<input name="whatsappPlaceholders" value="' + esc((tpl.whatsappPlaceholders || []).join(", ")) + '" /></label>' +
          '<label>Email subject (unused until a provider is configured)<input name="emailSubject" value="' + esc(tpl.emailSubject || "") + '" /></label>' +
          '<label>Email body<textarea name="emailBody">' + esc(tpl.emailBody || "") + "</textarea></label>" +
          '<div class="btn-group"><button class="btn btn-amber" type="submit">Save template</button>' +
          '<button class="btn btn-ghost" type="button" id="cancel-edit">Cancel</button></div></div></form>';
      }
    }
    return banner() + healthNote() +
      '<div class="card"><div class="card-h"><h2>Event templates</h2></div><div class="card-b table-wrap"><table class="data"><thead><tr>' +
      "<th>Event</th><th>SMS</th><th>WhatsApp</th><th>Email</th><th></th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="5">No templates yet.</td></tr>') +
      "</tbody></table></div></div>" + editor;
  }

  function deliveriesView() {
    var rows = state.deliveries.map(function (row) {
      return "<tr><td class=\"mono\">" + esc(row.at || "") + "</td><td>" + esc(row.type) + "</td><td>" + esc(row.channel) +
        "</td><td>" + esc(row.provider) + "</td><td>" + statusPill(row.status) + "</td><td class=\"mono\">" + esc(row.providerId || "—") +
        "</td><td>" + esc(row.error || "—") + "</td><td class=\"mono\">" + esc(row.to || "—") + "</td><td>" + esc(row.preview || "") + "</td></tr>";
    }).join("");
    return banner() + '<div class="card"><div class="card-h"><h2>Recent deliveries</h2></div><div class="card-b table-wrap"><table class="data"><thead><tr>' +
      "<th>When</th><th>Event</th><th>Channel</th><th>Provider</th><th>Status</th><th>Provider id</th><th>Error</th><th>To</th><th>Preview</th>" +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="9">No deliveries yet.</td></tr>') + "</tbody></table></div></div>";
  }

  function testView() {
    var options = state.templates.map(function (tpl) {
      return '<option value="' + esc(tpl.type) + '">' + esc(tpl.label || tpl.type) + "</option>";
    }).join("");
    return banner() + healthNote() +
      '<form class="card" id="test-form"><div class="card-h"><h2>Send a test</h2></div><div class="card-b form-grid">' +
      "<p class=\"page-sub\">Uses the template text and ignores the on/off toggles, so you can prove a channel before members receive it. Dry-run logs the payload and does not call the provider.</p>" +
      '<label>Phone<input name="phone" required placeholder="0772 000 111" autocomplete="tel" /></label>' +
      '<label>Channel<select name="channel"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="both">SMS and WhatsApp</option></select></label>' +
      '<label>Event type<select name="type">' + options + "</select></label>" +
      '<label>Amount<input name="amount" inputmode="decimal" placeholder="10000" /></label>' +
      '<label>Account<input name="account" placeholder="000000123" /></label>' +
      '<label>Reference<input name="reference" placeholder="TEST" /></label>' +
      '<div class="btn-group"><button class="btn btn-amber" type="submit">Send test</button></div>' +
      '<pre class="mono" id="test-result" hidden></pre></div></form>';
  }

  function paint() {
    markNav();
    paintHealth();
    var current = view();
    if (current === "deliveries") root.innerHTML = deliveriesView();
    else if (current === "test") root.innerHTML = testView();
    else root.innerHTML = templatesView();
  }

  async function load() {
    state.error = "";
    try {
      state.health = await api("GET", "/health");
    } catch (e) {
      state.health = null;
      state.error = e.message;
    }
    try {
      if (view() === "deliveries") {
        var book = await api("GET", "/deliveries?limit=50");
        state.deliveries = book.deliveries || [];
      } else {
        var templates = await api("GET", "/templates");
        state.templates = templates.templates || [];
      }
    } catch (e) {
      state.error = e.message;
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
        emailEnabled: form.elements.emailEnabled.checked,
        smsBody: data.get("smsBody"),
        whatsappTemplateName: data.get("whatsappTemplateName"),
        whatsappLanguageCode: data.get("whatsappLanguageCode"),
        whatsappPlaceholders: String(data.get("whatsappPlaceholders") || ""),
        emailSubject: data.get("emailSubject"),
        emailBody: data.get("emailBody")
      });
      api("PUT", "/templates/" + encodeURIComponent(current.type), next).then(function () {
        state.editing = null;
        return load();
      }).catch(function (err) {
        state.error = err.message;
        paint();
      });
      return;
    }
    if (form.id === "test-form") {
      event.preventDefault();
      var fields = new FormData(form);
      var payload = {
        channel: fields.get("channel"),
        type: fields.get("type"),
        phone: fields.get("phone"),
        account: fields.get("account") || "",
        reference: fields.get("reference") || "TEST",
        currency: "UGX"
      };
      if (String(fields.get("amount") || "").trim()) payload.amount = Number(fields.get("amount"));
      api("POST", "/test-send", payload).then(function (result) {
        var box = document.getElementById("test-result");
        if (!box) return;
        box.hidden = false;
        box.textContent = JSON.stringify(result, null, 2);
      }).catch(function (err) {
        state.error = err.message;
        paint();
      });
    }
  });

  document.getElementById("refresh-btn").addEventListener("click", function () { load(); });
  window.addEventListener("hashchange", function () { load(); });
  keyInput.addEventListener("change", function () {
    try { sessionStorage.setItem(KEY, keyInput.value.trim()); } catch (e) { /* private mode */ }
    load();
  });
  try { keyInput.value = sessionStorage.getItem(KEY) || ""; } catch (e) { keyInput.value = ""; }

  var toggle = document.querySelector("[data-toggle-sidebar]");
  var sidebar = document.getElementById("sidebar");
  if (toggle && sidebar) {
    toggle.addEventListener("click", function () { sidebar.classList.toggle("open"); });
  }
  if (!location.hash) location.hash = "#templates";
  load();
})();
