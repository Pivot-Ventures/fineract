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

  function openDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(8,24,28,.45);z-index:80;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto";
      var box = document.createElement("form");
      box.className = "card";
      box.style.cssText = "width:min(520px,100%);margin:0;background:#fff";
      var fields = opts.fields || [];
      var html = '<div class="card-h"><h2>' + escapeHtml(opts.title || "Action") + '</h2></div><div class="card-b"><div class="form-grid">';
      fields.forEach(function (f, i) {
        html += '<div class="form-row' + (f.full ? " full" : "") + '"><label>' + escapeHtml(f.label) + '</label>';
        if (f.type === "select") {
          html += '<select data-k="' + f.key + '">';
          (f.options || []).forEach(function (o) {
            var val = o.value !== undefined ? o.value : o.id;
            var lab = o.label !== undefined ? o.label : (o.name || val);
            var sel = String(val) === String(f.value) ? " selected" : "";
            html += '<option value="' + escapeHtml(val) + '"' + sel + '>' + escapeHtml(lab) + '</option>';
          });
          html += "</select>";
        } else if (f.type === "textarea") {
          html += '<textarea data-k="' + f.key + '" rows="2">' + escapeHtml(f.value || "") + "</textarea>";
        } else {
          html += '<input data-k="' + f.key + '" type="' + (f.type || "text") + '" value="' + escapeHtml(f.value || "") + '" />';
        }
        html += "</div>";
      });
      html += '</div><div class="form-actions"><button type="submit" class="btn btn-amber">' + escapeHtml(opts.submitLabel || "Save") + '</button><button type="button" class="btn btn-ghost" data-cancel>Cancel</button></div></div>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      function close(val) {
        overlay.remove();
        resolve(val);
      }
      box.querySelector("[data-cancel]").addEventListener("click", function () { close(null); });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) close(null); });
      box.addEventListener("submit", function (e) {
        e.preventDefault();
        var out = {};
        box.querySelectorAll("[data-k]").forEach(function (el) {
          out[el.getAttribute("data-k")] = el.value;
        });
        close(out);
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
    formatMoney: formatMoney,
    formatDate: formatDate,
    statusClass: statusClass,
    statusLabel: statusLabel,
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
