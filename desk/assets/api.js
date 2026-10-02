/* Pivot SACCO Desk — Fineract API client */
(function (global) {
  "use strict";

  var BASE = "/fineract-provider/api/v1";
  var DEFAULT_TENANT = "default";
  var TIME_ZONE = "Africa/Kampala";
  var STORAGE_KEY = "pivot_fineract_session";
  var ACTIVITY_KEY = "pivot_last_activity";
  var PAYTYPE_KEY = "pivot_payment_types";
  var IDLE_MS = 30 * 60 * 1000;
  var IDLE_WARN_MS = 28 * 60 * 1000;
  var ABSOLUTE_MS = 12 * 60 * 60 * 1000;
  var uid = 0;

  function nextId(prefix) {
    uid += 1;
    return (prefix || "fld") + "-" + uid;
  }

  function toast(msg, kind) {
    var area = document.querySelector(".toast-area");
    if (!area) {
      area = document.createElement("div");
      area.className = "toast-area";
      area.setAttribute("role", "status");
      area.setAttribute("aria-live", "polite");
      document.body.appendChild(area);
    }
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " toast-" + kind : "");
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === "error" ? 7000 : 4000);
  }

  /* ---------- session ---------- */
  function loadSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(sess) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
    touch();
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(ACTIVITY_KEY);
      sessionStorage.removeItem(PAYTYPE_KEY);
      sessionStorage.removeItem("pivot_teller_ctx");
    } catch (e) { /* storage unavailable */ }
  }

  function touch() {
    try { sessionStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  function lastActivity() {
    var n = Number(sessionStorage.getItem(ACTIVITY_KEY) || 0);
    return n || Date.now();
  }

  /* Returns "", "idle" or "expired" */
  function sessionExpiry(sess) {
    if (!sess) return "";
    var now = Date.now();
    if (sess.loggedInAtMs && now - sess.loggedInAtMs > ABSOLUTE_MS) return "expired";
    if (now - lastActivity() > IDLE_MS) return "idle";
    return "";
  }

  function getSession() {
    return loadSession();
  }

  function isLoggedIn() {
    var s = loadSession();
    if (!(s && s.base64EncodedAuthenticationKey)) return false;
    return !sessionExpiry(s);
  }

  function goLogin(reason) {
    clearSession();
    var here = location.pathname.split("/").pop() || "index.html";
    if (here === "login.html") return;
    location.href = "login.html" + (reason ? "?" + reason + "=1" : "");
  }

  function requireAuth() {
    var s = loadSession();
    if (s && s.base64EncodedAuthenticationKey) {
      var why = sessionExpiry(s);
      if (!why) return true;
      goLogin(why);
      return false;
    }
    goLogin("");
    return false;
  }

  function can(code) {
    var s = loadSession();
    var perms = (s && s.permissions) || [];
    if (!perms.length) return true; /* unknown — let the server decide */
    if (perms.indexOf("ALL_FUNCTIONS") >= 0) return true;
    var list = Array.isArray(code) ? code : [code];
    for (var i = 0; i < list.length; i++) {
      if (perms.indexOf(list[i]) >= 0) return true;
    }
    return false;
  }

  /* ---------- status bar (only shown on problems) ---------- */
  function setStatus(msg) {
    var bar = document.getElementById("status-bar");
    if (!bar) return;
    bar.textContent = msg;
    bar.hidden = false;
  }

  function clearStatus() {
    var bar = document.getElementById("status-bar");
    if (!bar) return;
    bar.textContent = "";
    bar.hidden = true;
  }

  /* ---------- HTTP ---------- */
  function errorMessage(data, status) {
    var msg = "HTTP " + status;
    if (data && data.errors && data.errors.length) {
      msg = data.errors.map(function (e) {
        return e.defaultUserMessage || e.developerMessage || e.message || "";
      }).filter(Boolean).join("; ") || msg;
    } else if (data && data.defaultUserMessage) msg = data.defaultUserMessage;
    else if (data && data.message) msg = data.message;
    else if (data && data.developerMessage) msg = data.developerMessage;
    else if (typeof data === "string" && data) msg = data.slice(0, 200);
    return msg;
  }

  async function send(method, path, init, opts) {
    opts = opts || {};
    var sess = loadSession() || {};
    var headers = init.headers || {};
    headers["Fineract-Platform-TenantId"] = opts.tenant || sess.tenantId || DEFAULT_TENANT;
    if (!headers.Accept) headers.Accept = "application/json";
    var key = opts.authKey || (opts.anonymous ? "" : sess.base64EncodedAuthenticationKey);
    if (key) headers.Authorization = "Basic " + key;
    var url = BASE + path;
    var res;
    try {
      res = await fetch(url, { method: method, headers: headers, body: init.body, credentials: "same-origin" });
    } catch (netErr) {
      setStatus("Cannot reach Fineract — data may be stale. Check your connection and retry.");
      var err = new Error("Cannot reach Fineract. Check your connection and try again.");
      err.cause = netErr;
      throw err;
    }
    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      setStatus("Cannot reach Fineract — data may be stale.");
    }
    if (res.status === 401 && !opts.anonymous && !opts.authKey) {
      goLogin("expired");
      var authErr = new Error("Your session has expired. Please sign in again.");
      authErr.status = 401;
      throw authErr;
    }
    if (!res.ok) {
      var apiErr = new Error(errorMessage(data, res.status));
      apiErr.status = res.status;
      apiErr.data = data;
      throw apiErr;
    }
    if (!opts.anonymous) touch();
    return data;
  }

  function request(method, path, body, opts) {
    var init = { headers: {} };
    if (body !== undefined && body !== null) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return send(method, path, init, opts);
  }

  function get(path, opts) { return request("GET", path, null, opts); }
  function post(path, body, opts) { return request("POST", path, body, opts); }
  function put(path, body, opts) { return request("PUT", path, body, opts); }
  function del(path, opts) { return request("DELETE", path, null, opts); }
  function postForm(path, formData, opts) { return send("POST", path, { headers: {}, body: formData }, opts); }

  /* ---------- auth ---------- */
  /*
   * Resolves to { session } on success, or { renewPassword: true, userId, authKey }
   * when Fineract demands a password change first. Throws on failure.
   */
  async function login(username, password, tenantId) {
    tenantId = String(tenantId || DEFAULT_TENANT).trim() || DEFAULT_TENANT;
    var data;
    try {
      data = await request("POST", "/authentication", { username: username, password: password }, {
        tenant: tenantId, anonymous: true
      });
    } catch (err) {
      /* Fineract answers 403 (with a valid key) when the password must be changed first, e.g. a new user. */
      if (err.status === 403 && err.data && err.data.shouldRenewPassword && err.data.base64EncodedAuthenticationKey) data = err.data;
      else throw err;
    }
    if (!data || !data.authenticated || !data.base64EncodedAuthenticationKey) {
      throw new Error("Sign-in was not accepted by Fineract.");
    }
    if (data.isTwoFactorAuthenticationRequired) {
      throw new Error("Two-factor authentication is not supported in Desk yet — contact your administrator.");
    }
    var key = String(data.base64EncodedAuthenticationKey).replace(/\\u003d/g, "=").trim();
    if (data.shouldRenewPassword) {
      return { renewPassword: true, userId: data.userId, authKey: key, tenantId: tenantId };
    }
    clearSession();
    var sess = {
      username: data.username || username,
      userId: data.userId,
      officeId: data.officeId,
      officeName: data.officeName,
      staffId: data.staffId,
      staffDisplayName: data.staffDisplayName,
      tenantId: tenantId,
      base64EncodedAuthenticationKey: key,
      permissions: data.permissions || [],
      loggedInAtMs: Date.now(),
    };
    saveSession(sess);
    return { session: sess };
  }

  async function changePassword(pending, newPassword, repeatPassword) {
    /* POST /users/{id}/pwd is the only call Fineract exempts from its "password must be reset" check. */
    await request("POST", "/users/" + encodeURIComponent(pending.userId) + "/pwd", {
      password: newPassword, repeatPassword: repeatPassword
    }, { tenant: pending.tenantId, authKey: pending.authKey });
  }

  function logout(reason) {
    goLogin(reason || "");
    if ((location.pathname.split("/").pop() || "") === "login.html") location.reload();
  }

  /* Idle + absolute timeouts. Call once per page after auth. */
  function startSessionTimers() {
    var warned = false;
    var lastTouch = 0;
    function activity() {
      var now = Date.now();
      if (now - lastTouch < 15000) return;
      lastTouch = now;
      if (isLoggedIn()) touch();
      if (warned) { warned = false; clearStatus(); }
    }
    ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach(function (ev) {
      document.addEventListener(ev, activity, { passive: true });
    });
    setInterval(function () {
      var s = loadSession();
      if (!s) { goLogin("expired"); return; }
      var why = sessionExpiry(s);
      if (why) { goLogin(why); return; }
      if (!warned && Date.now() - lastActivity() > IDLE_WARN_MS) {
        warned = true;
        setStatus("You will be signed out in 2 minutes because of inactivity. Move the mouse or press a key to stay signed in.");
      }
    }, 20000);
  }

  /* ---------- formatting ---------- */
  function formatMoney(n, ccy) {
    if (n === null || n === undefined || n === "") return "—";
    var num = Number(n);
    if (isNaN(num)) return "—";
    return (ccy || "UGX") + " " + num.toLocaleString("en-UG", { maximumFractionDigits: 0 });
  }

  function formatNumber(n) {
    if (n === null || n === undefined || n === "") return "—";
    var num = Number(n);
    if (isNaN(num)) return "—";
    return num.toLocaleString("en-UG", { maximumFractionDigits: 0 });
  }

  function formatDate(arrOrStr) {
    if (!arrOrStr) return "—";
    if (Array.isArray(arrOrStr)) {
      var y = arrOrStr[0], m = arrOrStr[1], d = arrOrStr[2];
      return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    }
    return String(arrOrStr).slice(0, 10);
  }

  function statusClass(code) {
    var c = String(code || "").toLowerCase();
    if (c.indexOf("overdue") >= 0 || c.indexOf("arrears") >= 0) return "overdue";
    if (c.indexOf("reject") >= 0) return "rejected";
    if (c.indexOf("approved") >= 0) return "approved";
    if (c.indexOf("active") >= 0 || c === "300") return "active";
    if (c.indexOf("pending") >= 0 || c.indexOf("submitted") >= 0 || c === "100" || c === "200") return "pending";
    if (c.indexOf("closed") >= 0 || c.indexOf("withdraw") >= 0) return "closed";
    if (c.indexOf("overpaid") >= 0) return "pending";
    return "";
  }

  function statusLabel(obj) {
    if (!obj) return "—";
    if (typeof obj === "string") return obj;
    return obj.value || obj.code || String(obj.id || "—");
  }

  function statusBadge(obj) {
    var st = statusLabel(obj);
    return '<span class="status ' + statusClass(st) + '">' + escapeHtml(st) + "</span>";
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function showError(container, err) {
    var el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) {
      toast(err.message || String(err), "error");
      return;
    }
    el.innerHTML = '<div class="empty-state error"><strong>Could not load</strong><p>' +
      escapeHtml(err.message || String(err)) + "</p></div>";
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    if (!name) return "?";
    var parts = String(name).trim().split(/[\s,._-]+/).filter(Boolean);
    var out = ((parts[0] && parts[0][0]) || "") + ((parts[1] && parts[1][0]) || "");
    return (out || "?").toUpperCase();
  }

  function emptyRow(cols, text) {
    return '<tr class="empty-row"><td colspan="' + cols + '">' + escapeHtml(text) + "</td></tr>";
  }

  function loadingRow(cols, text) {
    return '<tr class="loading-row"><td colspan="' + cols + '">' + escapeHtml(text || "Loading…") + "</td></tr>";
  }

  /* Today's date in Kampala (UTC+3, no DST) as yyyy-MM-dd */
  function todayISO() {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date());
      var map = {};
      parts.forEach(function (p) { map[p.type] = p.value; });
      if (map.year && map.month && map.day) return map.year + "-" + map.month + "-" + map.day;
    } catch (e) { /* fall through */ }
    return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function yearStartISO() {
    return todayISO().slice(0, 4) + "-01-01";
  }

  /*
   * UGX has no minor units: accept only a positive whole number, optionally
   * grouped with commas ("5000" or "5,000"). Anything else → NaN.
   */
  function parseAmount(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim();
    if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(s)) return NaN;
    var n = Number(s.replace(/,/g, ""));
    if (!Number.isSafeInteger(n) || n <= 0) return NaN;
    return n;
  }

  function isISODate(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  }

  /* ---------- payment types (cached per session) ---------- */
  async function paymentTypes() {
    try {
      var cached = sessionStorage.getItem(PAYTYPE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (e) { /* ignore */ }
    var list = await get("/paymenttypes");
    list = (Array.isArray(list) ? list : []).filter(function (p) { return !p.isSystemDefined; });
    try { sessionStorage.setItem(PAYTYPE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    return list;
  }

  function defaultPaymentType(list) {
    var cash = list.filter(function (p) { return p.isCashPayment; })[0] ||
      list.filter(function (p) { return String(p.name || "").toLowerCase() === "cash"; })[0];
    return cash || list[0] || null;
  }

  async function paymentTypeField() {
    var list = await paymentTypes();
    if (!list.length) throw new Error("No payment types are configured in Fineract. Add one (e.g. Cash) under system codes first.");
    var def = defaultPaymentType(list);
    return {
      key: "paymentTypeId", label: "Payment type", type: "select", required: true,
      value: def ? String(def.id) : "",
      options: list.map(function (p) { return { value: p.id, label: p.name }; })
    };
  }

  /* ---------- typeahead ---------- */
  /*
   * Attach a server-backed typeahead to an <input>.
   * opts.fetch(q) → Promise<[{ value, label, sub, href }]>
   * opts.onSelect(item) — called when a result is chosen
   * opts.minChars (default 2)
   */
  function typeahead(input, opts) {
    opts = opts || {};
    var minChars = opts.minChars || 2;
    var wrap = document.createElement("div");
    wrap.className = "ta-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var list = document.createElement("ul");
    var listId = nextId("ta-list");
    list.id = listId;
    list.className = "ta-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listId);
    input.setAttribute("autocomplete", "off");
    var items = [];
    var active = -1;
    var timer = null;
    var seq = 0;

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }
    function highlight(i) {
      var lis = list.querySelectorAll("li[role=option]");
      lis.forEach(function (li, idx) { li.setAttribute("aria-selected", idx === i ? "true" : "false"); });
      active = i;
      if (lis[i]) input.setAttribute("aria-activedescendant", lis[i].id);
    }
    function choose(i) {
      var item = items[i];
      if (!item) return;
      close();
      if (opts.onSelect) opts.onSelect(item);
    }
    function render(note) {
      if (!items.length) {
        list.innerHTML = '<li class="ta-note">' + escapeHtml(note || "No matches") + "</li>";
      } else {
        list.innerHTML = items.map(function (it, i) {
          return '<li role="option" id="' + listId + "-" + i + '" data-i="' + i + '" aria-selected="false"><span class="ta-label">' +
            escapeHtml(it.label) + "</span>" + (it.sub ? '<span class="ta-sub">' + escapeHtml(it.sub) + "</span>" : "") + "</li>";
        }).join("");
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
    async function run() {
      var q = input.value.trim();
      if (q.length < minChars) { items = []; close(); return; }
      var my = ++seq;
      items = [];
      render("Searching…");
      try {
        var res = await opts.fetch(q);
        if (my !== seq) return;
        items = res || [];
        render("No matches (search is case-sensitive)");
      } catch (err) {
        if (my !== seq) return;
        items = [];
        render(err.message || "Search failed");
      }
    }
    input.addEventListener("input", function () {
      if (opts.onInput) opts.onInput();
      clearTimeout(timer);
      timer = setTimeout(run, 250);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); highlight(Math.min(items.length - 1, active + 1)); }
      else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); highlight(Math.max(0, active - 1)); }
      else if (e.key === "Enter" && !list.hidden && items.length) { e.preventDefault(); choose(active >= 0 ? active : 0); }
      else if (e.key === "Escape") { close(); }
    });
    list.addEventListener("mousedown", function (e) {
      var li = e.target.closest("li[data-i]");
      if (!li) return;
      e.preventDefault();
      choose(Number(li.getAttribute("data-i")));
    });
    input.addEventListener("blur", function () { setTimeout(close, 150); });
    return { close: close, refresh: run };
  }

  /* /search helpers used by pickers */
  async function searchEntities(q, resource) {
    var res = await get("/search?query=" + encodeURIComponent(q) + "&resource=" + encodeURIComponent(resource));
    return Array.isArray(res) ? res : [];
  }

  function searchClients(q) {
    return searchEntities(q, "clients").then(function (rows) {
      return rows.filter(function (r) { return r.entityType === "CLIENT"; }).slice(0, 20).map(function (r) {
        return {
          value: r.entityId, label: r.entityName,
          sub: "#" + (r.entityAccountNo || r.entityId) + (r.parentName ? " · " + r.parentName : "") + (r.entityMobileNo ? " · " + r.entityMobileNo : ""),
          href: "client-detail.html?id=" + encodeURIComponent(r.entityId), raw: r
        };
      });
    });
  }

  function searchLoans(q, onlyActive) {
    return searchEntities(q, "loans").then(function (rows) {
      return rows.filter(function (r) {
        return r.entityType === "LOAN" && (!onlyActive || (r.entityStatus && r.entityStatus.id === 300));
      }).slice(0, 20).map(function (r) {
        return {
          value: r.entityId, label: (r.entityAccountNo || r.entityId) + " · " + (r.parentName || ""),
          sub: (r.entityName || "") + " · " + statusLabel(r.entityStatus),
          href: "loan-detail.html?id=" + encodeURIComponent(r.entityId), raw: r
        };
      });
    });
  }

  function searchSavings(q, onlyActive) {
    return searchEntities(q, "savings").then(function (rows) {
      return rows.filter(function (r) {
        return r.entityType === "SAVING" || r.entityType === "SAVINGS" || /saving/i.test(r.entityType || "");
      }).filter(function (r) {
        return !onlyActive || (r.entityStatus && r.entityStatus.id === 300);
      }).slice(0, 20).map(function (r) {
        return {
          value: r.entityId, label: (r.entityAccountNo || r.entityId) + " · " + (r.parentName || ""),
          sub: (r.entityName || "") + " · " + statusLabel(r.entityStatus),
          href: "savings-detail.html?id=" + encodeURIComponent(r.entityId), raw: r
        };
      });
    });
  }

  /* ---------- dialogs ---------- */
  /*
   * openDialog({
   *   title, submitLabel, fields: [{ key, label, type, value, options, required, amount,
   *     placeholder, help, full, search, min, max, autocomplete, onChange(value, ctl) }],
   *     type "checkboxes": options [{ value, label }], value = array of checked values → collected as an array;
   *     onChange(value, ctl): ctl.setOptions(key, options, value) refills a select field.
   *   validate(values) → error string | "",
   *   confirm(values) → { title, lines: [[label, value], ...], note, confirmLabel } — adds a review step,
   *   onSubmit(values) → Promise — dialog stays open (button disabled) until it settles;
   *                      rejection shows the error inside the dialog.
   * }) → Promise<result | values | null>
   */
  function openDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var lastFocus = document.activeElement;
      var overlay = document.createElement("div");
      overlay.className = "dialog-overlay";
      var box = document.createElement("form");
      box.className = "card dialog";
      box.noValidate = true;
      var titleId = nextId("dlg-title");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", titleId);
      var fields = opts.fields || [];
      var html = '<div class="card-h"><h2 id="' + titleId + '">' + escapeHtml(opts.title || "Action") + '</h2></div><div class="card-b">';
      if (opts.message) html += '<p class="dialog-msg">' + escapeHtml(opts.message) + "</p>";
      if (opts.review) html += reviewHtml(opts.review);
      html += '<div class="dialog-step" data-step="edit"><div class="form-grid">';
      var ids = {};
      fields.forEach(function (f) {
        var id = nextId("dlg-" + f.key);
        ids[f.key] = id;
        var req = f.required ? " required" : "";
        var help = f.help ? '<span class="field-help" id="' + id + '-help">' + escapeHtml(f.help) + "</span>" : "";
        var desc = f.help ? ' aria-describedby="' + id + '-help"' : "";
        if (f.type === "checkboxes") {
          var checked = (f.value || []).map(String);
          html += '<fieldset class="form-row full check-group" id="' + id + '"' + desc + "><legend>" + escapeHtml(f.label) +
            (f.required ? ' <span aria-hidden="true">*</span>' : "") + "</legend>";
          (f.options || []).forEach(function (o, i) {
            var cid = id + "-" + i;
            html += '<label class="check" for="' + cid + '"><input type="checkbox" id="' + cid + '" data-group="' + escapeHtml(f.key) +
              '" value="' + escapeHtml(o.value) + '"' + (checked.indexOf(String(o.value)) >= 0 ? " checked" : "") + " /> " + escapeHtml(o.label) + "</label>";
          });
          html += help + "</fieldset>";
          return;
        }
        html += '<div class="form-row' + (f.full || f.type === "textarea" || f.type === "search" ? " full" : "") + '"><label for="' + id + '">' +
          escapeHtml(f.label) + (f.required ? ' <span aria-hidden="true">*</span>' : "") + "</label>";
        if (f.type === "select") {
          html += '<select id="' + id + '" data-k="' + escapeHtml(f.key) + '"' + req + desc + ">";
          if (f.placeholder) html += '<option value="">' + escapeHtml(f.placeholder) + "</option>";
          (f.options || []).forEach(function (o) {
            var val = o.value !== undefined ? o.value : o.id;
            var lab = o.label !== undefined ? o.label : (o.name || val);
            var sel = String(val) === String(f.value) ? " selected" : "";
            html += '<option value="' + escapeHtml(val) + '"' + sel + ">" + escapeHtml(lab) + "</option>";
          });
          html += "</select>";
        } else if (f.type === "textarea") {
          html += '<textarea id="' + id + '" data-k="' + escapeHtml(f.key) + '" rows="2"' + req + desc + ">" + escapeHtml(f.value || "") + "</textarea>";
        } else if (f.type === "search") {
          html += '<input id="' + id + '" type="text" data-search="' + escapeHtml(f.key) + '"' + desc +
            ' placeholder="' + escapeHtml(f.placeholder || "Type to search…") + '" value="' + escapeHtml(f.valueLabel || "") + '" />' +
            '<input type="hidden" data-k="' + escapeHtml(f.key) + '" value="' + escapeHtml(f.value || "") + '" />';
        } else if (f.amount) {
          html += '<input id="' + id + '" data-k="' + escapeHtml(f.key) + '" type="text" inputmode="numeric" class="mono" autocomplete="off"' + req + desc +
            ' placeholder="' + escapeHtml(f.placeholder || "e.g. 50,000") + '" value="" />';
        } else {
          html += '<input id="' + id + '" data-k="' + escapeHtml(f.key) + '" type="' + escapeHtml(f.type || "text") + '"' + req + desc +
            (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : "") +
            (f.max ? ' max="' + escapeHtml(f.max) + '"' : "") +
            (f.autocomplete ? ' autocomplete="' + escapeHtml(f.autocomplete) + '"' : "") +
            ' value="' + escapeHtml(f.value || "") + '" />';
        }
        html += help + "</div>";
      });
      html += '</div></div><div class="dialog-step" data-step="confirm" hidden></div>' +
        '<p class="dialog-error" role="alert" hidden></p>' +
        '<div class="form-actions"><button type="submit" class="btn btn-amber" data-submit>' + escapeHtml(opts.submitLabel || "Save") +
        '</button><button type="button" class="btn btn-ghost" data-back hidden>Back</button>' +
        '<button type="button" class="btn btn-ghost" data-cancel>Cancel</button></div></div>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      var errEl = box.querySelector(".dialog-error");
      var editStep = box.querySelector('[data-step="edit"]');
      var confirmStep = box.querySelector('[data-step="confirm"]');
      var submitBtn = box.querySelector("[data-submit]");
      var backBtn = box.querySelector("[data-back]");
      var stage = "edit";
      var busy = false;
      var values = null;

      fields.forEach(function (f) {
        if (f.type !== "search") return;
        var vis = box.querySelector('[data-search="' + f.key + '"]');
        var hidden = box.querySelector('input[type=hidden][data-k="' + f.key + '"]');
        typeahead(vis, {
          fetch: f.search,
          onInput: function () { hidden.value = ""; },
          onSelect: function (item) {
            hidden.value = item.value;
            vis.value = item.label;
            hidden.setAttribute("data-label", item.label + (item.sub ? " (" + item.sub + ")" : ""));
          }
        });
      });

      function showError(msg) {
        errEl.textContent = msg || "";
        errEl.hidden = !msg;
      }
      var ctl = {
        setOptions: function (key, options, value) {
          var f = fields.filter(function (x) { return x.key === key; })[0] || {};
          var sel = box.querySelector('select[data-k="' + key + '"]');
          if (!sel) return;
          sel.innerHTML = (f.placeholder ? '<option value="">' + escapeHtml(f.placeholder) + "</option>" : "") +
            (options || []).map(function (o) {
              return '<option value="' + escapeHtml(o.value) + '"' + (String(o.value) === String(value) ? " selected" : "") + ">" + escapeHtml(o.label) + "</option>";
            }).join("");
        }
      };
      fields.forEach(function (f) {
        if (!f.onChange) return;
        var el = box.querySelector('[data-k="' + f.key + '"]');
        if (!el) return;
        el.addEventListener("change", function () {
          Promise.resolve().then(function () { return f.onChange(el.value, ctl); })
            .catch(function (err) { showError(err.message || String(err)); });
        });
      });
      function close(val) {
        if (busy) return;
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
        resolve(val);
      }
      function onKey(e) { if (e.key === "Escape") close(null); }
      document.addEventListener("keydown", onKey);
      box.querySelector("[data-cancel]").addEventListener("click", function () { close(null); });
      overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(null); });
      backBtn.addEventListener("click", function () {
        if (busy) return;
        stage = "edit";
        editStep.hidden = false;
        confirmStep.hidden = true;
        backBtn.hidden = true;
        submitBtn.textContent = opts.submitLabel || "Save";
        showError("");
      });

      function collect() {
        var out = {};
        box.querySelectorAll("[data-k]").forEach(function (el) {
          out[el.getAttribute("data-k")] = el.type === "checkbox" ? el.checked : el.value;
          if (el.getAttribute("data-label")) out[el.getAttribute("data-k") + "Label"] = el.getAttribute("data-label");
        });
        fields.forEach(function (f) { if (f.type === "checkboxes") out[f.key] = []; });
        box.querySelectorAll("[data-group]").forEach(function (el) {
          if (el.checked) out[el.getAttribute("data-group")].push(el.value);
        });
        return out;
      }
      function check(v) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          var raw = v[f.key];
          var empty = raw === undefined || raw === null || String(raw).trim() === "";
          if (f.required && f.type === "checkboxes" && !raw.length) return "Select at least one option under " + f.label + ".";
          if (f.required && empty) {
            return f.type === "search" ? "Choose " + f.label.toLowerCase() + " from the search results." : f.label + " is required.";
          }
          if (f.amount && !empty) {
            var n = parseAmount(raw);
            if (!(n > 0)) return f.label + " must be a whole number of UGX greater than zero (no decimals).";
            v[f.key] = n;
          } else if (f.amount && empty) {
            v[f.key] = null;
          }
          if (f.type === "date" && !empty && !isISODate(raw)) return f.label + " must be a valid date.";
        }
        return opts.validate ? (opts.validate(v) || "") : "";
      }
      async function finish() {
        if (!opts.onSubmit) { close(values); return; }
        busy = true;
        submitBtn.disabled = true;
        backBtn.disabled = true;
        var label = submitBtn.textContent;
        submitBtn.textContent = "Working…";
        showError("");
        try {
          var result = await opts.onSubmit(values);
          busy = false;
          close(result === undefined ? values : result);
        } catch (err) {
          busy = false;
          submitBtn.disabled = false;
          backBtn.disabled = false;
          submitBtn.textContent = label;
          showError(err.message || String(err));
        }
      }
      box.addEventListener("submit", function (e) {
        e.preventDefault();
        if (busy) return;
        if (stage === "edit") {
          values = collect();
          var problem = check(values);
          if (problem) { showError(problem); return; }
          showError("");
          if (opts.confirm) {
            var c = opts.confirm(values) || {};
            confirmStep.innerHTML = reviewHtml(c);
            editStep.hidden = true;
            confirmStep.hidden = false;
            backBtn.hidden = false;
            submitBtn.textContent = c.confirmLabel || "Confirm";
            stage = "confirm";
            submitBtn.focus();
            return;
          }
        }
        finish();
      });
      var first = box.querySelector("input:not([type=hidden]), select, textarea") || submitBtn;
      first.focus();
    });
  }

  function reviewHtml(c) {
    return '<div class="recon-box warn"><p class="strong confirm-title">' + escapeHtml(c.title || "Please confirm") + "</p>" +
      (c.lines || []).map(function (l) {
        return '<div class="recon-line"><span>' + escapeHtml(l[0]) + '</span><span class="mono">' + escapeHtml(l[1]) + "</span></div>";
      }).join("") + (c.note ? '<p class="text-muted confirm-note">' + escapeHtml(c.note) + "</p>" : "") + "</div>";
  }

  /*
   * One-step confirmation showing a summary. opts.onConfirm (optional) runs while the
   * dialog stays open with the button disabled. Resolves true when confirmed.
   */
  function confirmDialog(opts) {
    opts = opts || {};
    return openDialog({
      title: opts.title || "Please confirm",
      message: opts.message || "",
      review: opts.lines ? { title: opts.summary || "Review", lines: opts.lines, note: opts.note } : null,
      fields: [],
      submitLabel: opts.confirmLabel || "Confirm",
      onSubmit: opts.onConfirm || null,
    }).then(function (v) { return v !== null; });
  }

  global.FineractAPI = {
    BASE: BASE,
    DEFAULT_TENANT: DEFAULT_TENANT,
    toast: toast,
    login: login,
    changePassword: changePassword,
    logout: logout,
    startSessionTimers: startSessionTimers,
    get: get,
    post: post,
    put: put,
    del: del,
    postForm: postForm,
    request: request,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    requireAuth: requireAuth,
    can: can,
    setStatus: setStatus,
    clearStatus: clearStatus,
    formatMoney: formatMoney,
    formatNumber: formatNumber,
    formatDate: formatDate,
    statusClass: statusClass,
    statusLabel: statusLabel,
    statusBadge: statusBadge,
    qs: qs,
    showError: showError,
    escapeHtml: escapeHtml,
    initials: initials,
    emptyRow: emptyRow,
    loadingRow: loadingRow,
    todayISO: todayISO,
    yearStartISO: yearStartISO,
    parseAmount: parseAmount,
    isISODate: isISODate,
    paymentTypes: paymentTypes,
    paymentTypeField: paymentTypeField,
    typeahead: typeahead,
    searchEntities: searchEntities,
    searchClients: searchClients,
    searchLoans: searchLoans,
    searchSavings: searchSavings,
    openDialog: openDialog,
    confirmDialog: confirmDialog,
  };
})(window);
