/* Pivot SACCO Desk — Fineract API client (live) */
(function (global) {
  "use strict";

  var BASE = "/fineract-provider/api/v1";
  var STORAGE_KEY = "pivot_fineract_session";

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
    setTimeout(function () { el.remove(); }, 4000);
  }

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
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function getSession() {
    return loadSession();
  }

  function isLoggedIn() {
    var s = loadSession();
    return !!(s && s.base64EncodedAuthenticationKey);
  }

  function requireAuth() {
    if (!isLoggedIn()) {
      var here = location.pathname.split("/").pop() || "index.html";
      if (here !== "login.html" && here !== "index.html") {
        location.href = "login.html";
        return false;
      }
    }
    return true;
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
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
    }
    var url = path.indexOf("http") === 0 ? path : BASE + path;
    var res;
    try {
      res = await fetch(url, {
        method: method,
        headers: headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      });
    } catch (netErr) {
      var err = new Error("Network error talking to Fineract: " + netErr.message);
      err.cause = netErr;
      throw err;
    }
    var text = await res.text();
    var data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
    }
    if (!res.ok) {
      var msg = "HTTP " + res.status;
      if (data && data.errors && data.errors.length) {
        msg = data.errors.map(function (e) {
          return e.defaultUserMessage || e.developerMessage || e.message || "";
        }).filter(Boolean).join("; ") || msg;
      } else if (data && data.defaultUserMessage) msg = data.defaultUserMessage;
      else if (data && data.message) msg = data.message;
      else if (data && data.developerMessage) msg = data.developerMessage;
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
  function put(path, body, opts) { return request("PUT", path, body, opts); }
  function del(path, opts) { return request("DELETE", path, null, opts); }

  async function login(username, password, tenantId) {
    tenantId = tenantId || "default";
    // Prefer authentication endpoint; fall back to Basic against /clients if needed
    var authBody = { username: username, password: password };
    var data;
    try {
      data = await request("POST", "/authentication", authBody, {
        tenant: tenantId,
        authKey: btoa(username + ":" + password),
      });
    } catch (e) {
      // Some builds accept Basic only — probe /clients
      var key = btoa(username + ":" + password);
      await request("GET", "/clients?limit=1", null, { tenant: tenantId, authKey: key });
      data = {
        username: username,
        base64EncodedAuthenticationKey: key,
        authenticated: true,
      };
    }
    var key = data.base64EncodedAuthenticationKey || btoa(username + ":" + password);
    if (typeof key === "string") key = key.replace(/\\u003d/g, "=").trim();
    var sess = {
      username: data.username || username,
      userId: data.userId,
      officeId: data.officeId,
      officeName: data.officeName,
      staffId: data.staffId,
      tenantId: tenantId,
      base64EncodedAuthenticationKey: key,
      permissions: data.permissions || [],
      loggedInAt: new Date().toISOString(),
    };
    saveSession(sess);
    return sess;
  }

  function logout() {
    clearSession();
    location.href = "login.html";
  }

  function formatMoney(n, ccy) {
    if (n === null || n === undefined || n === "") return "—";
    var num = Number(n);
    if (isNaN(num)) return String(n);
    return (ccy || "UGX") + " " + num.toLocaleString("en-UG", { maximumFractionDigits: 0 });
  }

  function formatDate(arrOrStr) {
    if (!arrOrStr) return "—";
    if (Array.isArray(arrOrStr)) {
      var y = arrOrStr[0], m = arrOrStr[1], d = arrOrStr[2];
      return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    }
    return String(arrOrStr).slice(0, 10);
  }

  function formatNumber(n) {
    var num = Number(n);
    if (n === null || n === undefined || n === "" || isNaN(num)) return "0";
    return num.toLocaleString("en-UG", { maximumFractionDigits: 2 });
  }

  function isISODate(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(Date.parse(v + "T00:00:00"));
  }

  function yearStartISO() {
    return new Date().getFullYear() + "-01-01";
  }

  function statusBadge(obj) {
    var label = statusLabel(obj);
    var cls = statusClass(typeof obj === "object" && obj ? (obj.value || obj.code || label) : label);
    return '<span class="status ' + cls + '">' + escapeHtml(label) + "</span>";
  }

  function emptyRow(cols, msg) {
    return '<tr class="empty-row"><td colspan="' + Number(cols || 1) + '">' + escapeHtml(msg || "Nothing to show") + "</td></tr>";
  }

  function loadingRow(cols, msg) {
    return '<tr class="loading-row"><td colspan="' + Number(cols || 1) + '">' + escapeHtml(msg || "Loading…") + "</td></tr>";
  }

  function setStatus(msg) {
    var bar = document.getElementById("status-bar");
    if (!bar) return;
    bar.hidden = !msg;
    bar.textContent = msg || "";
  }

  function clearStatus() { setStatus(""); }

  function permissionCodes() {
    var sess = loadSession() || {};
    return (sess.permissions || []).map(function (p) {
      return typeof p === "string" ? p : (p && (p.code || p.name)) || "";
    }).filter(Boolean);
  }

  function can(code) {
    var perms = permissionCodes();
    if (!perms.length || perms.indexOf("ALL_FUNCTIONS") >= 0) return true;
    var list = Array.isArray(code) ? code : [code];
    return list.some(function (c) { return perms.indexOf(c) >= 0; });
  }

  var paymentTypeCache = null;
  function paymentTypes() {
    if (paymentTypeCache) return Promise.resolve(paymentTypeCache);
    return get("/paymenttypes").then(function (rows) {
      paymentTypeCache = Array.isArray(rows) ? rows : [];
      return paymentTypeCache;
    });
  }

  function searchRows(resource, q) {
    var query = String(q || "").trim();
    if (query.length < 2) return Promise.resolve([]);
    return get("/search?exactMatch=false&resource=" + encodeURIComponent(resource) + "&query=" + encodeURIComponent(query)).then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      return rows.map(function (r) {
        var name = r.entityName || r.parentName || "";
        var acct = r.entityAccountNo || r.entityExternalId || "";
        return {
          value: r.entityId,
          label: name + (acct ? " (" + acct + ")" : ""),
          sub: r.entityType || r.parentName || ""
        };
      });
    });
  }

  function searchClients(q) { return searchRows("clients", q); }
  function searchLoans(q) { return searchRows("loans", q); }
  function searchSavings(q) { return searchRows("savings", q); }

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(8,24,28,.45);z-index:90;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto";
      var box = document.createElement("div");
      box.className = "card";
      box.style.cssText = "width:min(520px,100%);margin:0;background:#fff";
      var lines = opts.lines || [];
      var html = '<div class="card-h"><h2>' + escapeHtml(opts.title || "Confirm") + "</h2></div><div class=\"card-b\">";
      if (opts.summary) html += '<p style="margin:0 0 10px">' + escapeHtml(opts.summary) + "</p>";
      if (lines.length) {
        html += '<div class="meta-list">';
        lines.forEach(function (pair) {
          html += '<div class="meta-item"><div class="k">' + escapeHtml(pair[0]) + '</div><div class="v">' + escapeHtml(pair[1]) + "</div></div>";
        });
        html += "</div>";
      }
      if (opts.note) html += '<p class="text-muted" style="margin:12px 0 0;font-size:13px">' + escapeHtml(opts.note) + "</p>";
      html += '<div class="form-actions"><button type="button" class="btn btn-amber" data-ok>' + escapeHtml(opts.confirmLabel || "Confirm") + '</button><button type="button" class="btn btn-ghost" data-cancel>Cancel</button></div></div>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      function finish(val) { overlay.remove(); resolve(val); }
      box.querySelector("[data-cancel]").addEventListener("click", function () { finish(false); });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) finish(false); });
      box.querySelector("[data-ok]").addEventListener("click", function () {
        var btn = box.querySelector("[data-ok]");
        if (typeof opts.onConfirm !== "function") { finish(true); return; }
        btn.disabled = true;
        Promise.resolve().then(function () { return opts.onConfirm(); }).then(function () {
          finish(true);
        }).catch(function (err) {
          btn.disabled = false;
          toast((err && err.message) || String(err), "error");
        });
      });
    });
  }

  function typeahead(input, opts) {
    if (!input) return;
    opts = opts || {};
    var box = document.createElement("div");
    box.className = "search-results";
    box.hidden = true;
    input.insertAdjacentElement("afterend", box);
    var timer;
    input.addEventListener("input", function () {
      if (typeof opts.onInput === "function") opts.onInput();
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2 || typeof opts.fetch !== "function") { box.hidden = true; return; }
      timer = setTimeout(function () {
        Promise.resolve(opts.fetch(q)).then(function (rows) {
          rows = rows || [];
          box._rows = rows;
          box.hidden = !rows.length;
          box.innerHTML = rows.map(function (r, i) {
            return '<button type="button" class="btn btn-sm btn-ghost" data-i="' + i + '">' + escapeHtml(r.label || r.value) + "</button>";
          }).join("");
        }).catch(function () { box.hidden = true; });
      }, 250);
    });
    box.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b) return;
      var row = (box._rows || [])[Number(b.getAttribute("data-i"))];
      box.hidden = true;
      if (row && typeof opts.onSelect === "function") opts.onSelect(row);
    });
  }

  async function getBlob(path) {
    var sess = loadSession() || {};
    var headers = {
      "Fineract-Platform-TenantId": sess.tenantId || "default",
      Accept: "*/*"
    };
    if (sess.base64EncodedAuthenticationKey) headers.Authorization = "Basic " + sess.base64EncodedAuthenticationKey;
    var res = await fetch(BASE + path, { headers: headers });
    if (!res.ok) {
      var err = new Error("HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    var disp = res.headers.get("Content-Disposition") || "";
    var name = "download";
    var match = /filename="?([^";]+)"?/.exec(disp);
    if (match) name = match[1];
    return { blob: await res.blob(), name: name };
  }

  function statusClass(code) {
    var c = (code || "").toLowerCase();
    if (c.indexOf("active") >= 0 || c === "300") return "active";
    if (c.indexOf("pending") >= 0 || c === "100" || c === "200") return "pending";
    if (c.indexOf("closed") >= 0 || c.indexOf("withdraw") >= 0) return "closed";
    if (c.indexOf("overpaid") >= 0) return "warn";
    return "";
  }

  function statusLabel(obj) {
    if (!obj) return "—";
    if (typeof obj === "string") return obj;
    return obj.value || obj.code || String(obj.id || "—");
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function setLiveBanner(isLive, detail) {
    var banner = document.querySelector(".banner-mock");
    if (!banner) return;
    if (isLive) {
      banner.classList.remove("banner-mock");
      banner.classList.add("banner-live");
      banner.textContent = detail || "LIVE — connected to Apache Fineract (tenant default)";
    } else {
      banner.classList.add("banner-mock");
      banner.classList.remove("banner-live");
      banner.textContent = detail || "MOCK / offline — not connected to Fineract";
    }
  }

  function markLiveChips() {
    document.querySelectorAll(".chip.amber, .topbar-right .chip.amber").forEach(function (c) {
      if (c.textContent.trim() === "MOCK") {
        c.classList.remove("amber");
        c.classList.add("green");
        c.textContent = "LIVE";
      }
    });
    document.querySelectorAll(".mock-badge").forEach(function (b) {
      b.textContent = "LIVE UI";
      b.classList.add("live-badge");
    });
    var foot = document.querySelector(".sidebar-foot div");
    var sess = loadSession();
    if (foot && sess) {
      foot.textContent = "Tenant: " + (sess.tenantId || "default") + " · " + (sess.username || "");
    }
  }

  function showError(container, err) {
    var el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) {
      toast(err.message || String(err), "error");
      return;
    }
    el.innerHTML = '<div class="empty-state error"><strong>API error</strong><p>' +
      escapeHtml(err.message || String(err)) + "</p></div>";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    if (!name) return "?";
    var parts = String(name).trim().split(/\s+/);
    return ((parts[0] && parts[0][0]) || "") + ((parts[1] && parts[1][0]) || "");
  }


  function todayISO() {
    var d = new Date();
    var z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  function parseAmount(v) {
    if (v === null || v === undefined) return NaN;
    var n = Number(String(v).replace(/[^0-9.\-]/g, ""));
    return n;
  }

  function markWired(el) {
    if (!el) return;
    if (el.length !== undefined && el.forEach) {
      el.forEach(markWired);
      return;
    }
    el.setAttribute("data-wired", "1");
  }

  function claimMocks(names) {
    document.querySelectorAll("[data-mock]").forEach(function (btn) {
      if (names.indexOf(btn.getAttribute("data-mock")) >= 0) markWired(btn);
    });
  }

  async function postForm(path, formData, opts) {
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
    var url = path.indexOf("http") === 0 ? path : BASE + path;
    var res = await fetch(url, { method: "POST", headers: headers, body: formData });
    var textBody = await res.text();
    var data = null;
    if (textBody) {
      try { data = JSON.parse(textBody); } catch (e) { data = textBody; }
    }
    if (!res.ok) {
      var msg = "HTTP " + res.status;
      if (data && data.errors && data.errors.length) {
        msg = data.errors.map(function (e) { return e.defaultUserMessage || e.developerMessage || ""; }).filter(Boolean).join("; ");
      } else if (data && data.defaultUserMessage) msg = data.defaultUserMessage;
      else if (typeof data === "string") msg = data.slice(0, 200);
      var apiErr = new Error(msg || ("HTTP " + res.status));
      apiErr.status = res.status;
      apiErr.data = data;
      throw apiErr;
    }
    return data;
  }

  function optionValue(o) {
    return o.value !== undefined ? o.value : o.id;
  }

  function optionLabel(o) {
    var val = optionValue(o);
    return o.label !== undefined ? o.label : (o.name || val);
  }

  function writeOptions(sel, options, preferred) {
    var html = "";
    var match = false;
    (options || []).forEach(function (o) {
      var val = optionValue(o);
      var chosen = String(val) === String(preferred);
      if (chosen) match = true;
      html += '<option value="' + escapeHtml(val) + '"' + (chosen ? " selected" : "") + ">" + escapeHtml(optionLabel(o)) + "</option>";
    });
    sel.innerHTML = html;
    if (!match && sel.options.length) sel.selectedIndex = 0;
  }

  function openDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(8,24,28,.45);z-index:80;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto";
      var box = document.createElement("form");
      box.className = "card";
      var width = opts.width;
      if (width == null || width === "") width = "min(520px,100%)";
      else if (typeof width === "number") width = "min(" + width + "px,100%)";
      box.style.cssText = "width:" + width + ";margin:0;background:#fff";
      var fields = opts.fields || [];
      var depends = {};
      var html = '<div class="card-h"><h2>' + escapeHtml(opts.title || "Action") + "</h2></div><div class=\"card-b\">";
      if (opts.message) html += '<p class="text-muted" style="margin:0 0 12px;font-size:13px">' + escapeHtml(opts.message) + "</p>";
      html += '<div class="form-grid">';
      fields.forEach(function (f) {
        if (f.type === "note") {
          html += '<div class="form-row full"><p class="text-muted" style="margin:0;font-size:12px">' + escapeHtml(f.label) + "</p></div>";
          return;
        }
        var show = "";
        if (f.showWhen) {
          show = ' data-show-key="' + escapeHtml(f.showWhen.key) + '" data-show-values="' + escapeHtml((f.showWhen.values || []).join(",")) + '"';
        }
        html += '<div class="form-row' + (f.full ? " full" : "") + '"' + show + "><label>" + escapeHtml(f.label) + "</label>";
        if (f.type === "select") {
          if (f.dependsOn && f.optionsBy) depends[f.key] = f;
          html += '<select data-k="' + escapeHtml(f.key) + '"' + (f.dependsOn ? ' data-depends="' + escapeHtml(f.dependsOn) + '"' : "") + ">";
          if (!f.dependsOn) {
            (f.options || []).forEach(function (o) {
              var val = optionValue(o);
              var sel = String(val) === String(f.value) ? " selected" : "";
              html += '<option value="' + escapeHtml(val) + '"' + sel + ">" + escapeHtml(optionLabel(o)) + "</option>";
            });
          }
          html += "</select>";
        } else if (f.type === "textarea") {
          html += '<textarea data-k="' + escapeHtml(f.key) + '" rows="2">' + escapeHtml(f.value || "") + "</textarea>";
        } else if (f.type === "search") {
          html += '<input data-search-for="' + escapeHtml(f.key) + '" type="search" placeholder="' + escapeHtml(f.placeholder || "Search") + '" autocomplete="off" />';
          html += '<div class="search-results" data-results="' + escapeHtml(f.key) + '" hidden></div>';
          html += '<input type="hidden" data-k="' + escapeHtml(f.key) + '" value="' + escapeHtml(f.value || "") + '" />';
        } else if (f.type === "checkbox") {
          html += '<label class="check"><input data-k="' + escapeHtml(f.key) + '" type="checkbox"' + (f.value === true || f.value === "true" ? " checked" : "") + " /> " + escapeHtml(f.hint || "") + "</label>";
        } else {
          var extra = "";
          if (f.maxLength) extra += ' maxlength="' + Number(f.maxLength) + '"';
          if (f.placeholder) extra += ' placeholder="' + escapeHtml(f.placeholder) + '"';
          if (f.step) extra += ' step="' + escapeHtml(f.step) + '"';
          if (f.max) extra += ' max="' + escapeHtml(f.max) + '"';
          if (f.required) extra += " required";
          if (f.amount) extra += ' data-amount="1" inputmode="decimal"';
          html += '<input data-k="' + escapeHtml(f.key) + '" type="' + escapeHtml(f.type || "text") + '" value="' + escapeHtml(f.value || "") + '"' + extra + " />";
        }
        if (f.hint) html += '<div class="text-muted" style="font-size:12px;margin-top:4px">' + escapeHtml(f.hint) + "</div>";
        html += "</div>";
      });
      html += '</div><div class="form-actions"><button type="submit" class="btn btn-amber">' + escapeHtml(opts.submitLabel || "Save") + '</button><button type="button" class="btn btn-ghost" data-cancel>Cancel</button></div></div>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      function readValues() {
        var out = {};
        box.querySelectorAll("[data-k]").forEach(function (el) {
          var row = el.closest(".form-row");
          if (row && row.style.display === "none") return;
          var key = el.getAttribute("data-k");
          if (el.getAttribute("data-amount") === "1") {
            out[key] = Number(String(el.value).replace(/,/g, ""));
          } else if (el.type === "checkbox") {
            out[key] = el.checked ? "true" : "false";
          } else {
            out[key] = el.value;
          }
        });
        box.querySelectorAll("[data-search-for]").forEach(function (input) {
          out[input.getAttribute("data-search-for") + "Label"] = input.getAttribute("data-label") || input.value;
        });
        return out;
      }
      var searchTimers = {};
      box.querySelectorAll("[data-search-for]").forEach(function (input) {
        var key = input.getAttribute("data-search-for");
        var field = fields.filter(function (f) { return f.key === key; })[0] || {};
        input.addEventListener("input", function () {
          var hidden = box.querySelector('input[type="hidden"][data-k="' + key + '"]');
          if (hidden) hidden.value = "";
          input.removeAttribute("data-label");
          clearTimeout(searchTimers[key]);
          var q = input.value.trim();
          var results = box.querySelector('[data-results="' + key + '"]');
          if (q.length < 2 || typeof field.search !== "function") {
            if (results) results.hidden = true;
            return;
          }
          searchTimers[key] = setTimeout(function () {
            Promise.resolve(field.search(q)).then(function (rows) {
              if (!results) return;
              rows = rows || [];
              results.hidden = !rows.length;
              results.innerHTML = rows.map(function (r) {
                return '<button type="button" class="btn btn-sm btn-ghost" data-pick="' + escapeHtml(r.value) + '" data-label="' + escapeHtml(r.label || r.value) + '">' + escapeHtml(r.label || r.value) + "</button>";
              }).join("");
            }).catch(function () { if (results) results.hidden = true; });
          }, 250);
        });
      });
      box.addEventListener("click", function (e) {
        var pick = e.target.closest && e.target.closest("[data-pick]");
        if (!pick || !box.contains(pick)) return;
        var results = pick.closest("[data-results]");
        if (!results) return;
        var key = results.getAttribute("data-results");
        var hidden = box.querySelector('input[type="hidden"][data-k="' + key + '"]');
        var input = box.querySelector('[data-search-for="' + key + '"]');
        if (hidden) hidden.value = pick.getAttribute("data-pick");
        if (input) {
          input.value = pick.getAttribute("data-label") || "";
          input.setAttribute("data-label", input.value);
        }
        results.hidden = true;
      });
      function syncShown() {
        var current = {};
        box.querySelectorAll("[data-k]").forEach(function (el) {
          current[el.getAttribute("data-k")] = el.value;
        });
        box.querySelectorAll("[data-show-key]").forEach(function (row) {
          var key = row.getAttribute("data-show-key");
          var allowed = (row.getAttribute("data-show-values") || "").split(",");
          var on = allowed.some(function (v) { return v === String(current[key]); });
          row.style.display = on ? "" : "none";
        });
      }
      function syncDepends() {
        Object.keys(depends).forEach(function (key) {
          var f = depends[key];
          var sel = box.querySelector('select[data-k="' + key + '"]');
          var parent = box.querySelector('[data-k="' + f.dependsOn + '"]');
          if (!sel || !parent) return;
          var preferred = sel.value || f.value;
          writeOptions(sel, f.optionsBy[parent.value] || [], preferred);
        });
      }
      syncDepends();
      syncShown();
      box.addEventListener("change", function (e) {
        var key = e.target && e.target.getAttribute && e.target.getAttribute("data-k");
        if (key) {
          var drives = Object.keys(depends).some(function (child) { return depends[child].dependsOn === key; });
          if (drives) syncDepends();
        }
        syncShown();
      });
      function close(val) {
        overlay.remove();
        resolve(val);
      }
      box.querySelector("[data-cancel]").addEventListener("click", function () { close(null); });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) close(null); });
      function runSubmit(out) {
        if (typeof opts.onSubmit !== "function") { close(out); return; }
        var btn = box.querySelector("button[type=submit]");
        if (btn) btn.disabled = true;
        Promise.resolve().then(function () { return opts.onSubmit(out); }).then(function (res) {
          close(res === undefined ? out : res);
        }).catch(function (err) {
          if (btn) btn.disabled = false;
          toast((err && err.message) || String(err), "error");
        });
      }
      box.addEventListener("submit", function (e) {
        e.preventDefault();
        var out = readValues();
        if (typeof opts.validate === "function") {
          var msg = opts.validate(out);
          if (msg) { toast(msg, "error"); return; }
        }
        if (typeof opts.confirm === "function") {
          var spec = opts.confirm(out);
          if (spec) {
            confirmDialog(spec).then(function (ok) { if (ok) runSubmit(out); });
            return;
          }
        }
        runSubmit(out);
      });
      var first = box.querySelector("input, select, textarea");
      if (first) first.focus();
    });
  }

  global.FineractAPI = {
    BASE: BASE,
    toast: toast,
    login: login,
    logout: logout,
    get: get,
    post: post,
    put: put,
    del: del,
    request: request,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    requireAuth: requireAuth,
    DEFAULT_TENANT: "default",
    formatMoney: formatMoney,
    formatDate: formatDate,
    formatNumber: formatNumber,
    isISODate: isISODate,
    yearStartISO: yearStartISO,
    statusClass: statusClass,
    statusLabel: statusLabel,
    statusBadge: statusBadge,
    emptyRow: emptyRow,
    loadingRow: loadingRow,
    setStatus: setStatus,
    clearStatus: clearStatus,
    can: can,
    paymentTypes: paymentTypes,
    searchClients: searchClients,
    searchLoans: searchLoans,
    searchSavings: searchSavings,
    confirmDialog: confirmDialog,
    typeahead: typeahead,
    getBlob: getBlob,
    qs: qs,
    setLiveBanner: setLiveBanner,
    markLiveChips: markLiveChips,
    showError: showError,
    escapeHtml: escapeHtml,
    initials: initials,
    todayISO: todayISO,
    parseAmount: parseAmount,
    markWired: markWired,
    claimMocks: claimMocks,
    postForm: postForm,
    openDialog: openDialog,
  };
})(window);
