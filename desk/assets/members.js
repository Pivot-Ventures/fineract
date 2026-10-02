/* Pivot SACCO Desk — MEMBERS module
 * Clients list (search + paging + filters), onboarding wizard, member profile (KYC, family,
 * documents, accounts, lifecycle), groups and centres.
 * Loaded only by clients.html, client-onboard.html, client-detail.html, groups.html, centres.html.
 */
(function () {
  "use strict";
  var api = window.FineractAPI;
  if (!api || !api.isLoggedIn()) return;
  var page = document.body.getAttribute("data-page") || "";
  if (["clients", "onboard", "client-detail", "groups", "centres"].indexOf(page) < 0) return;

  var esc = api.escapeHtml;
  var sess = api.getSession() || {};
  var DATE = { locale: "en", dateFormat: "yyyy-MM-dd" };
  var PAGE_SIZE = 25;
  var MAX_UPLOAD = 5 * 1024 * 1024;      /* Fineract multipart limit per file */
  var MAX_PHOTO_INPUT = 15 * 1024 * 1024; /* phone photos are shrunk before upload */

  /* =============================================================== helpers */
  function $(id) { return document.getElementById(id); }
  function withDate(body) { return Object.assign({}, DATE, body); }
  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  }
  function fullName(c) {
    return c.displayName || [c.firstname, c.middlename, c.lastname].filter(Boolean).join(" ") || ("#" + c.id);
  }
  function uniq(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }
  function titleCase(s) {
    return String(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function statusId(c) { return c && c.status ? Number(c.status.id) : 0; }

  /* Turns Fineract error payloads into sentences a teller can act on. */
  function friendly(err) {
    if (!err) return "Something went wrong.";
    var d = err.data;
    var msgs = [];
    if (d && typeof d === "object") {
      var errs = d.errors && d.errors.length ? d.errors : [d];
      errs.forEach(function (e) {
        var code = e.userMessageGlobalisationCode || "";
        var args = (e.args || []).map(function (a) { return a && a.value !== undefined ? a.value : a; });
        var m;
        if (code === "error.msg.clientIdentifier.identityKey.duplicate") {
          m = "This " + (args[2] || "ID") + " number (" + (args[3] || "") + ") is already registered to " + (args[0] || "another member") + (args[1] ? " (" + args[1] + ")" : "") + ".";
        } else if (code === "error.msg.clientIdentifier.type.duplicate") {
          m = "This member already has an active " + (args[0] || "identifier of that type") + ". Delete the old one first.";
        } else if (code === "error.msg.parameter.unsupported") {
          m = "Fineract does not accept the field “" + (e.parameterName || "") + "”.";
        } else {
          m = e.defaultUserMessage || "";
          if (!m || m === e.parameterName || /^(Validation errors exist|Errors contain reason)/.test(m)) m = e.developerMessage || m;
          if (/^The parameter .* (is mandatory|cannot be blank)/.test(m) && e.parameterName) m = "“" + e.parameterName + "” is required.";
        }
        if (m) msgs.push(m);
      });
    }
    msgs = uniq(msgs);
    if (msgs.length) return msgs.join(" ");
    if (err.status >= 500) {
      return "Fineract could not complete this (server error " + err.status + "). It may not have been saved — refresh the page and check before trying again.";
    }
    if (err.status === 403) return "You do not have permission to do this.";
    return err.message || String(err);
  }
  function call(p) {
    return p.catch(function (err) {
      var e = new Error(friendly(err));
      e.status = err && err.status;
      e.data = err && err.data;
      throw e;
    });
  }
  var F = {
    get: function (p) { return call(api.get(p)); },
    post: function (p, b) { return call(api.post(p, b)); },
    put: function (p, b) { return call(api.put(p, b)); },
    del: function (p) { return call(api.del(p)); },
    form: function (p, fd) { return call(api.postForm(p, fd)); }
  };
  function fail(err) { if (err && err.status !== 401) api.toast(friendly(err), "error"); }

  /* Click handler with a busy guard so a double click cannot start two flows. */
  function on(el, fn) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (el.getAttribute("aria-busy") === "true" || el.disabled) return;
      el.setAttribute("aria-busy", "true");
      Promise.resolve().then(function () { return fn(el); }).catch(fail).then(function () {
        el.removeAttribute("aria-busy");
      });
    });
  }
  function permOk(el) {
    var codes = (el.getAttribute("data-perm") || "").split(/\s+/).filter(Boolean);
    return !codes.length || api.can(codes);
  }
  function show(id, cond) {
    var el = typeof id === "string" ? $(id) : id;
    if (el) el.hidden = !(cond && permOk(el));
  }
  function dateField(label, key, value) {
    return { key: key || "date", label: label || "Date", type: "date", required: true, value: value || api.todayISO(), max: api.todayISO() };
  }
  function optionLabel(field, value) {
    var o = (field.options || []).filter(function (x) { return String(x.value) === String(value); })[0];
    return o ? o.label : String(value || "");
  }
  function opts(list, labelKey) {
    return (list || []).map(function (o) { return { value: o.id, label: o[labelKey || "name"] }; });
  }
  function loadingRows(table, cols) {
    var tb = document.querySelector("#" + table + " tbody");
    if (tb) tb.innerHTML = api.loadingRow(cols);
    return tb;
  }

  /* Ugandan mobile → 07XXXXXXXX (the format already used in Fineract). "" when blank, null when invalid. */
  function normMobile(v) {
    var s = String(v || "").replace(/[\s().-]/g, "");
    if (!s) return "";
    var m = /^(?:\+?256|0)([37]\d{8})$/.exec(s);
    return m ? "0" + m[1] : null;
  }
  function normIdNumber(v) { return String(v || "").replace(/\s+/g, "").toUpperCase(); }
  function isNinType(label) { return /\bNIN\b|national\s*id/i.test(String(label || "")); }
  function idProblem(typeLabel, key) {
    if (!key) return "Enter the ID number.";
    if (isNinType(typeLabel) && !/^C[MF][A-Z0-9]{12}$/.test(key)) {
      return "A Ugandan National ID (NIN) has 14 letters/digits and starts with CM or CF (e.g. CM90012345ABCD).";
    }
    if (key.length > 50) return "The ID number is too long.";
    return "";
  }
  function ageOn(dobISO) {
    if (!api.isISODate(dobISO)) return null;
    var t = api.todayISO();
    var age = Number(t.slice(0, 4)) - Number(dobISO.slice(0, 4));
    if (t.slice(5) < dobISO.slice(5)) age -= 1;
    return age;
  }

  /* Exact-match lookups used to stop duplicates before anything is created.
     Resolve to the clashing search hit or null; lookup failures never block. */
  async function findExisting(query, resource, match) {
    try {
      var rows = await api.get("/search?query=" + encodeURIComponent(query) + "&resource=" + resource + "&exactMatch=true");
      return (Array.isArray(rows) ? rows : []).filter(match)[0] || null;
    } catch (e) { return null; }
  }

  /* ---- binary helpers (photos, attachments) need the raw response ---- */
  function authHeaders(accept) {
    var s = api.getSession() || {};
    var h = { "Fineract-Platform-TenantId": s.tenantId || api.DEFAULT_TENANT, Accept: accept || "*/*" };
    if (s.base64EncodedAuthenticationKey) h.Authorization = "Basic " + s.base64EncodedAuthenticationKey;
    return h;
  }
  async function rawGet(path, accept) {
    var res;
    try {
      res = await fetch(api.BASE + path, { headers: authHeaders(accept), credentials: "same-origin" });
    } catch (e) {
      throw new Error("Cannot reach Fineract. Check your connection and try again.");
    }
    if (res.status === 401) { api.logout("expired"); throw new Error("Your session has expired. Please sign in again."); }
    return res;
  }
  async function photoDataUrl(clientId) {
    var res = await rawGet("/clients/" + encodeURIComponent(clientId) + "/images?maxWidth=360&maxHeight=420", "text/plain");
    if (!res.ok) return "";
    var t = (await res.text()).trim();
    return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(t) ? t : "";
  }
  function paintPhoto(el, dataUrl, name) {
    if (!el) return;
    el.textContent = "";
    if (dataUrl) {
      var img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "";
      el.appendChild(img);
    } else {
      el.textContent = api.initials(name || "");
    }
  }
  /* Phone photos are several MB: shrink to ≤ 800 px JPEG before upload. Falls back to the original. */
  function shrinkImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { resolve(file); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      setTimeout(function () { resolve(file); }, 8000); /* never hang the upload on a decoder problem */
      img.onload = function () {
        try {
          var max = 800;
          var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          if (scale === 1 && file.size <= 1024 * 1024) { URL.revokeObjectURL(url); resolve(file); return; }
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var g = c.getContext("2d");
          g.fillStyle = "#fff";
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (blob) { URL.revokeObjectURL(url); resolve(blob || file); }, "image/jpeg", 0.85);
        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  function photoProblem(file) {
    if (!file) return "";
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return "The photo must be a JPEG, PNG or GIF image.";
    if (file.size > MAX_PHOTO_INPUT) return "The photo is too large (over 15 MB).";
    return "";
  }
  function docProblem(file) {
    if (!file) return "Choose a file.";
    if (file.size > MAX_UPLOAD) return "“" + file.name + "” is larger than 5 MB.";
    if (!/^(image\/|application\/pdf$)/.test(file.type || "")) return "“" + file.name + "” must be a PDF or an image.";
    return "";
  }
  async function uploadPhoto(clientId, file) {
    var blob = await shrinkImage(file);
    if (blob.size > MAX_UPLOAD) throw new Error("The photo is still larger than 5 MB after resizing.");
    var fd = new FormData();
    var ext = blob.type === "image/png" ? "png" : (blob.type === "image/gif" ? "gif" : "jpg");
    fd.append("file", blob, "photo." + ext);
    return F.form("/clients/" + encodeURIComponent(clientId) + "/images", fd);
  }
  function uploadDocument(clientId, file, name, description) {
    var fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("name", name);
    if (description) fd.append("description", description);
    return F.form("/clients/" + encodeURIComponent(clientId) + "/documents", fd);
  }
  function fileSize(n) {
    n = Number(n || 0);
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }

  var codesPromise = null;
  async function codeValues(name) {
    if (!codesPromise) codesPromise = F.get("/codes").catch(function (e) { codesPromise = null; throw e; });
    var codes = await codesPromise;
    var code = (Array.isArray(codes) ? codes : []).filter(function (c) { return c.name === name; })[0];
    if (!code) return [];
    var vals = await F.get("/codes/" + encodeURIComponent(code.id) + "/codevalues");
    return (Array.isArray(vals) ? vals : []).filter(function (v) { return v.active !== false; });
  }
  async function loadOffices() {
    var o = await F.get("/offices");
    return Array.isArray(o) ? o : [];
  }
  function defaultOffice(offices) {
    var has = offices.some(function (o) { return String(o.id) === String(sess.officeId); });
    return has ? String(sess.officeId) : (offices[0] ? String(offices[0].id) : "");
  }

  /* Server-side paging; opts: tbody, pager, cols, fetch(offset, limit) → { items, total, paged }, row, empty */
  function pagedList(o) {
    var offset = 0;
    var seq = 0;
    function renderPager(shown, total, paged) {
      if (!o.pager) return;
      if (!paged) {
        o.pager.innerHTML = '<span class="pager-info">' + (shown ? shown + " match" + (shown === 1 ? "" : "es") : "") + "</span>";
        return;
      }
      var to = offset + shown;
      if (!total) { o.pager.innerHTML = ""; return; }
      o.pager.innerHTML = '<span class="pager-info">Showing ' + (total ? offset + 1 : 0) + "–" + to + " of " + api.formatNumber(total) + "</span>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-page="prev"' + (offset <= 0 ? " disabled" : "") + ">‹ Prev</button>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-page="next"' + (to >= total ? " disabled" : "") + ">Next ›</button>";
      o.pager.querySelectorAll("button[data-page]").forEach(function (b) {
        b.addEventListener("click", function () {
          load(b.getAttribute("data-page") === "next" ? offset + PAGE_SIZE : Math.max(0, offset - PAGE_SIZE)).catch(fail);
        });
      });
    }
    async function load(newOffset) {
      offset = Math.max(0, newOffset || 0);
      var my = ++seq;
      o.tbody.innerHTML = api.loadingRow(o.cols);
      try {
        var res = await o.fetch(offset, PAGE_SIZE);
        if (my !== seq) return;
        var items = res.items || [];
        o.tbody.innerHTML = items.length ? items.map(o.row).join("") : api.emptyRow(o.cols, o.empty || "Nothing found");
        renderPager(items.length, res.total || 0, res.paged !== false);
        api.clearStatus();
      } catch (err) {
        if (my !== seq) return;
        o.tbody.innerHTML = api.emptyRow(o.cols, "Could not load: " + friendly(err));
        if (o.pager) o.pager.innerHTML = "";
        throw err;
      }
    }
    return { load: load, reset: function () { return load(0); }, current: function () { return load(offset); } };
  }

  var STATUS_PARAM = { active: 300, pending: 100, closed: 600 };

  /* Activate a pending member (used on the list and the profile). */
  async function activateDialog(c) {
    var submitted = c.timeline && c.timeline.submittedOnDate ? api.formatDate(c.timeline.submittedOnDate) : "";
    return api.openDialog({
      title: "Activate " + fullName(c), submitLabel: "Activate",
      message: "Activating lets the member open savings, shares and loans.",
      fields: [dateField("Activation date")],
      validate: function (v) { return submitted && v.date < submitted ? "Activation cannot be before the submission date (" + submitted + ")." : ""; },
      onSubmit: function (v) {
        return F.post("/clients/" + encodeURIComponent(c.id) + "?command=activate", withDate({ activationDate: v.date }));
      }
    });
  }

  /* ============================================================ CLIENTS LIST */
  if (page === "clients") {
    var cSearch = $("clients-search");
    var cStatus = $("clients-status");
    var cOffice = $("clients-office");
    var cClear = $("clients-clear");
    if (cSearch && api.qs("q")) cSearch.value = api.qs("q");

    /* Fineract's /search is case-sensitive (LIKE): try the text as typed plus common capitalisations. */
    var searchClientsAll = async function (q) {
      var variants = uniq([q, titleCase(q), q.toUpperCase(), q.toLowerCase()]);
      var packs = await Promise.all(variants.map(function (v) {
        return F.get("/search?query=" + encodeURIComponent(v) + "&resource=clients,clientIdentifiers");
      }));
      var byId = {};
      var order = [];
      var idHits = [];
      packs.forEach(function (rows) {
        (Array.isArray(rows) ? rows : []).forEach(function (r) {
          if (r.entityType === "CLIENT") {
            if (!byId[r.entityId]) order.push(r.entityId);
            byId[r.entityId] = {
              id: r.entityId, accountNo: r.entityAccountNo, externalId: r.entityExternalId, displayName: r.entityName,
              mobileNo: r.entityMobileNo, officeId: r.parentId, officeName: r.parentName, status: r.entityStatus
            };
          } else if (r.entityType === "CLIENTIDENTIFIER" && r.parentId) {
            idHits.push(r);
          }
        });
      });
      var missing = uniq(idHits.map(function (r) { return r.parentId; }).filter(function (id) { return !byId[id]; })).slice(0, 20);
      var extra = await Promise.all(missing.map(function (id) {
        return api.get("/clients/" + encodeURIComponent(id)).catch(function () { return null; });
      }));
      extra.forEach(function (c) {
        if (!c) return;
        c.matchedId = true;
        byId[c.id] = c;
        order.unshift(c.id);
      });
      return order.map(function (id) { return byId[id]; });
    };

    var clientList = pagedList({
      tbody: document.querySelector("#clients-table tbody"), pager: $("clients-pager"), cols: 8,
      empty: "No members found",
      fetch: async function (offset, limit) {
        var q = cSearch ? cSearch.value.trim() : "";
        var st = cStatus ? cStatus.value : "all";
        var off = cOffice ? cOffice.value : "";
        if (cClear) cClear.hidden = !q;
        if (q) {
          if (q.length < 2) throw new Error("Type at least 2 characters to search.");
          var all = await searchClientsAll(q);
          all = all.filter(function (c) {
            return (!off || String(c.officeId) === String(off)) &&
              (st === "all" || !STATUS_PARAM[st] || statusId(c) === STATUS_PARAM[st]);
          });
          return { items: all, total: all.length, paged: false };
        }
        var url = "/clients?offset=" + offset + "&limit=" + limit + "&orderBy=id&sortOrder=DESC";
        if (st && st !== "all") url += "&status=" + encodeURIComponent(st);
        if (off) url += "&officeId=" + encodeURIComponent(off);
        var data = await F.get(url);
        return { items: data.pageItems || [], total: typeof data.totalFilteredRecords === "number" ? data.totalFilteredRecords : (data.pageItems || []).length };
      },
      row: function (c) {
        var name = fullName(c);
        var href = "client-detail.html?id=" + encodeURIComponent(c.id);
        return "<tr>" +
          "<td><div class=\"client-thumb\" aria-hidden=\"true\">" + esc(api.initials(name)) + "</div></td>" +
          "<td class=\"mono\">" + esc(c.accountNo || c.id) + "</td>" +
          "<td class=\"mono\">" + esc(c.externalId || "—") + "</td>" +
          "<td class=\"strong\"><a href=\"" + href + "\">" + esc(name) + "</a>" + (c.matchedId ? " <span class=\"chip gray\">ID match</span>" : "") + "</td>" +
          "<td>" + esc(c.mobileNo || "—") + "</td>" +
          "<td>" + esc(c.officeName || "—") + "</td>" +
          "<td>" + api.statusBadge(c.status) + "</td>" +
          "<td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\" aria-label=\"Open " + esc(name) + "\">Open</a></td>" +
          "</tr>";
      }
    });
    var cf = $("clients-filter");
    if (cf) cf.addEventListener("submit", function (e) { e.preventDefault(); clientList.reset().catch(fail); });
    if (cStatus) cStatus.addEventListener("change", function () { clientList.reset().catch(fail); });
    if (cOffice) cOffice.addEventListener("change", function () { clientList.reset().catch(fail); });
    if (cClear) cClear.addEventListener("click", function () { cSearch.value = ""; clientList.reset().catch(fail); cSearch.focus(); });
    loadOffices().then(function (offices) {
      if (!cOffice) return;
      cOffice.innerHTML = '<option value="">All offices</option>' + offices.map(function (o) {
        return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>";
      }).join("");
      cOffice.hidden = offices.length < 2;
    }).catch(function () { if (cOffice) cOffice.hidden = true; });
    clientList.reset().catch(fail);

    /* Pending members awaiting activation (the maker-checker queue). */
    var pendingRows = {};
    var paintPending = async function () {
      var card = $("pending-card");
      if (!card) return;
      var data = await F.get("/clients?status=pending&limit=50&offset=0&orderBy=id&sortOrder=DESC");
      var items = data.pageItems || [];
      card.hidden = !items.length;
      setText("pending-count", data.totalFilteredRecords || items.length);
      pendingRows = {};
      document.querySelector("#pending-table tbody").innerHTML = items.map(function (c) {
        pendingRows[c.id] = c;
        var href = "client-detail.html?id=" + encodeURIComponent(c.id);
        return "<tr><td class=\"mono\">" + esc(c.accountNo || c.id) + "</td><td class=\"strong\"><a href=\"" + href + "\">" + esc(fullName(c)) +
          "</a></td><td>" + esc(c.mobileNo || "—") + "</td><td>" + esc(c.officeName || "—") + "</td><td>" +
          esc(api.formatDate(c.timeline && c.timeline.submittedOnDate)) + "</td><td><div class=\"row-actions\">" +
          (api.can("ACTIVATE_CLIENT") ? "<button type=\"button\" class=\"btn btn-sm btn-amber\" data-activate=\"" + esc(c.id) + "\">Activate</button>" : "") +
          "<a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">Open</a></div></td></tr>";
      }).join("");
    };
    var pt = $("pending-table");
    if (pt) pt.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-activate]");
      if (!b || b.disabled) return;
      var c = pendingRows[b.getAttribute("data-activate")];
      if (!c) return;
      b.disabled = true;
      activateDialog(c).then(function (r) {
        if (r) { api.toast(fullName(c) + " activated", "success"); paintPending().catch(fail); clientList.current().catch(fail); }
      }).catch(fail).then(function () { b.disabled = false; });
    });
    paintPending().catch(function () { /* the queue is optional */ });
  }

  /* ============================================================ ONBOARDING */
  if (page === "onboard") {
    var ob = $("onboard-wizard");
    var obErr = function (msg) { var el = $("ob-error"); el.textContent = msg || ""; el.hidden = !msg; if (msg) el.scrollIntoView({ block: "nearest" }); };
    var val = function (id) { var el = $(id); return el ? String(el.value || "").trim() : ""; };
    var selText = function (id) { var s = $(id); return s && s.selectedIndex >= 0 && s.value ? s.options[s.selectedIndex].text : ""; };
    var verified = {};      /* step → signature of values already checked against Fineract */
    var createdId = null;
    var nextBtn = ob.querySelector("[data-wizard-next]");
    $("ob-submitted").value = api.todayISO();
    $("ob-submitted").max = api.todayISO();
    $("ob-dob").max = api.todayISO();

    var fillStaff = async function () {
      var t = await F.get("/clients/template?officeId=" + encodeURIComponent($("ob-office").value));
      var staff = t.staffOptions || [];
      var mine = staff.some(function (s) { return String(s.id) === String(sess.staffId); }) ? String(sess.staffId) : "";
      $("ob-staff").innerHTML = '<option value="">— None —</option>' + staff.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.displayName) + "</option>";
      }).join("");
      $("ob-staff").value = mine;
    };
    (async function () {
      var t = await F.get("/clients/template");
      var offices = t.officeOptions || [];
      $("ob-office").innerHTML = offices.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + "</option>"; }).join("");
      $("ob-office").value = defaultOffice(offices);
      var genders = t.genderOptions || [];
      if (genders.length) {
        $("ob-gender").innerHTML = '<option value="">— Select —</option>' + genders.map(function (g) {
          return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>";
        }).join("");
      } else {
        $("ob-gender").innerHTML = '<option value="">— None configured —</option>';
        $("ob-gender").removeAttribute("required");
        $("ob-gender").disabled = true;
      }
      await fillStaff();
      var values = await codeValues("Customer Identifier").catch(function () { return []; });
      if (values.length) {
        var nin = values.filter(function (v) { return isNinType(v.name); })[0];
        $("ob-doctype").innerHTML = '<option value="">— Select —</option>' + values.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>"; }).join("");
        if (nin) $("ob-doctype").value = String(nin.id);
      } else {
        $("ob-doctype").innerHTML = '<option value="">— None configured —</option>';
        $("ob-doctype").disabled = true;
        $("ob-dockey").disabled = true;
        $("ob-doctype-note").textContent = "No identifier types are configured (or you cannot read them). Add values to the “Customer Identifier” code in Fineract to capture ID numbers.";
      }
    })().catch(fail);
    $("ob-office").addEventListener("change", function () { fillStaff().catch(fail); });
    $("ob-activate").addEventListener("change", function () {
      $("ob-submitted-label").textContent = $("ob-activate").value === "yes" ? "Activation date *" : "Submitted on *";
    });
    $("ob-photo").addEventListener("change", function () {
      var f = $("ob-photo").files && $("ob-photo").files[0];
      var box = $("ob-photo-preview");
      box.textContent = "";
      if (!f || photoProblem(f)) return;
      var img = document.createElement("img");
      img.alt = "Selected photo";
      img.src = URL.createObjectURL(f);
      img.onload = function () { URL.revokeObjectURL(img.src); };
      box.appendChild(img);
    });
    $("ob-docs").addEventListener("change", function () {
      var files = Array.prototype.slice.call($("ob-docs").files || []);
      $("ob-docs-list").textContent = files.length ? files.map(function (f) { return f.name + " (" + fileSize(f.size) + ")"; }).join(", ") : "PDF or image, up to 5 MB each. Saved under the member's Documents.";
    });
    var idsEnabled = function () { return !$("ob-doctype").disabled; };

    var obValidate = function (step) {
      if (step === 0) {
        if (!val("ob-firstname") || !val("ob-lastname")) return "First and last name are required.";
        if ($("ob-gender").required && !val("ob-gender")) return "Select the member's gender.";
        if (!api.isISODate(val("ob-dob"))) return "Enter the date of birth.";
        var age = ageOn(val("ob-dob"));
        if (age < 0) return "Date of birth cannot be in the future.";
        if (age > 120) return "Check the date of birth — the member would be over 120.";
        if (!val("ob-mobile")) return "Enter the member's mobile number.";
        if (normMobile(val("ob-mobile")) === null) return "Enter a Ugandan mobile number, e.g. 0772 123 456 or +256 772 123 456.";
        if (val("ob-email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("ob-email"))) return "Enter a valid email address or leave it blank.";
      }
      if (step === 1) {
        if (idsEnabled()) {
          if (!val("ob-doctype")) return "Select the ID type.";
          var p = idProblem(selText("ob-doctype"), normIdNumber(val("ob-dockey")));
          if (p) return p;
        }
        if (val("ob-external").length > 100) return "The member number is too long.";
      }
      if (step === 2) {
        var f = $("ob-photo").files && $("ob-photo").files[0];
        var pp = photoProblem(f);
        if (pp) return pp;
        var docs = Array.prototype.slice.call($("ob-docs").files || []);
        for (var i = 0; i < docs.length; i++) { var dp = docProblem(docs[i]); if (dp) return dp; }
      }
      if (step === 3) {
        if (!val("ob-office")) return "Choose an office.";
        if (!api.isISODate(val("ob-submitted"))) return "Enter the date.";
        if (val("ob-submitted") > api.todayISO()) return "The date cannot be in the future.";
        if (val("ob-dob") && val("ob-submitted") < val("ob-dob")) return "The date cannot be before the date of birth.";
      }
      return "";
    };
    /* Async duplicate checks against Fineract, run once per set of values. */
    var dupCheck = async function (step) {
      if (step === 0) {
        var mobile = normMobile(val("ob-mobile"));
        var hit = await findExisting(mobile, "clients", function (r) { return r.entityType === "CLIENT" && r.entityMobileNo === mobile; });
        if (hit) return "Mobile " + mobile + " already belongs to " + hit.entityName + " (client #" + hit.entityAccountNo + "). Open that member instead, or use a different number.";
      }
      if (step === 1) {
        var key = normIdNumber(val("ob-dockey"));
        if (idsEnabled() && key) {
          var idHit = await findExisting(key, "clientIdentifiers", function (r) { return r.entityType === "CLIENTIDENTIFIER" && String(r.entityName).toUpperCase() === key; });
          if (idHit) return "ID number " + key + " is already registered to " + idHit.parentName + " (client id " + idHit.parentId + "). A person can only be registered once.";
        }
        var ext = val("ob-external");
        if (ext) {
          var exHit = await findExisting(ext, "clients", function (r) { return r.entityType === "CLIENT" && r.entityExternalId === ext; });
          if (exHit) return "Member number " + ext + " is already used by " + exHit.entityName + ".";
        }
      }
      return "";
    };
    var signature = function (step) {
      return step === 0 ? normMobile(val("ob-mobile")) : (step === 1 ? normIdNumber(val("ob-dockey")) + "|" + val("ob-external") : "");
    };
    ob.addEventListener("wizard:beforenext", function (ev) {
      var step = ev.detail.step;
      var p = obValidate(step);
      obErr(p);
      if (p) { ev.preventDefault(); return; }
      if ((step === 0 || step === 1) && verified[step] !== signature(step)) {
        ev.preventDefault();
        nextBtn.disabled = true;
        var label = nextBtn.textContent;
        nextBtn.textContent = "Checking…";
        dupCheck(step).then(function (msg) {
          nextBtn.disabled = false;
          nextBtn.textContent = label;
          if (msg) { obErr(msg); return; }
          verified[step] = signature(step);
          nextBtn.click();
        });
      }
    });
    ob.addEventListener("wizard:step", function (ev) {
      obErr("");
      if (ev.detail.step === 1) { var dk = $("ob-dockey"); if (dk && !dk.disabled) dk.focus(); }
      if (ev.detail.step !== 4) return;
      var name = [val("ob-firstname"), val("ob-middlename"), val("ob-lastname")].filter(Boolean).join(" ");
      $("ob-review-name").textContent = name;
      var age = ageOn(val("ob-dob"));
      $("ob-review-personal").textContent = (selText("ob-gender") || "—") + " · " + val("ob-dob") + (age !== null ? " (age " + age + (age < 18 ? ", minor" : "") + ")" : "");
      $("ob-review-mobile").textContent = normMobile(val("ob-mobile")) + (val("ob-email") ? " · " + val("ob-email") : "");
      $("ob-review-id").textContent = idsEnabled() && val("ob-dockey") ? selText("ob-doctype") + " · " + normIdNumber(val("ob-dockey")) : "—";
      $("ob-review-external").textContent = val("ob-external") || "Uses the Fineract client number";
      $("ob-review-office").textContent = selText("ob-office") + " · " + (selText("ob-staff") && val("ob-staff") ? selText("ob-staff") : "no officer");
      $("ob-review-date").textContent = ($("ob-activate").value === "yes" ? "Active from " : "Pending, submitted ") + val("ob-submitted");
      var photo = $("ob-photo").files && $("ob-photo").files[0];
      var docs = ($("ob-docs").files || []).length;
      $("ob-review-files").textContent = (photo ? "Photo" : "No photo") + " · " + docs + " document" + (docs === 1 ? "" : "s");
    });
    ob.addEventListener("wizard:complete", async function (ev) {
      var btn = ev.detail.button;
      if (createdId) { location.href = "client-detail.html?id=" + encodeURIComponent(createdId); return; }
      for (var s = 0; s < 4; s++) {
        var p = obValidate(s);
        if (p) { obErr(p); return; }
      }
      obErr("");
      var activeNow = $("ob-activate").value === "yes";
      var payload = withDate({
        officeId: Number(val("ob-office")), firstname: val("ob-firstname"), lastname: val("ob-lastname"),
        legalFormId: 1, active: activeNow, submittedOnDate: val("ob-submitted"),
        mobileNo: normMobile(val("ob-mobile")), dateOfBirth: val("ob-dob")
      });
      if (activeNow) payload.activationDate = val("ob-submitted");
      if (val("ob-middlename")) payload.middlename = val("ob-middlename");
      if (val("ob-email")) payload.emailAddress = val("ob-email");
      if (val("ob-external")) payload.externalId = val("ob-external");
      if (val("ob-gender")) payload.genderId = Number(val("ob-gender"));
      if (val("ob-staff")) payload.staffId = Number(val("ob-staff"));
      btn.disabled = true;
      btn.textContent = "Creating…";
      try {
        var res = await F.post("/clients", payload);
        createdId = res.clientId || res.resourceId;
      } catch (err) {
        obErr(err.message || String(err));
        btn.disabled = false;
        btn.textContent = "Create member";
        return;
      }
      btn.textContent = "Saving ID and files…";
      var warnings = [];
      var enc = encodeURIComponent(createdId);
      if (idsEnabled() && val("ob-doctype") && val("ob-dockey")) {
        try { await F.post("/clients/" + enc + "/identifiers", { documentTypeId: Number(val("ob-doctype")), documentKey: normIdNumber(val("ob-dockey")), status: "Active" }); }
        catch (err) { warnings.push("ID number: " + err.message); }
      }
      var photo = $("ob-photo").files && $("ob-photo").files[0];
      if (photo) {
        try { await uploadPhoto(createdId, photo); }
        catch (err) { warnings.push("photo: " + err.message); }
      }
      var docs = Array.prototype.slice.call($("ob-docs").files || []);
      for (var i = 0; i < docs.length; i++) {
        try { await uploadDocument(createdId, docs[i], docs.length === 1 ? "KYC document" : "KYC document " + (i + 1), "Captured at onboarding"); }
        catch (err) { warnings.push(docs[i].name + ": " + err.message); }
      }
      btn.textContent = "Opening member…";
      api.toast(warnings.length ? "Member created, but some details were not saved — " + warnings.join("; ") + " Add them on the member page." : "Member created", warnings.length ? "error" : "success");
      setTimeout(function () { location.href = "client-detail.html?id=" + enc; }, warnings.length ? 3500 : 400);
    });
  }

  /* ============================================================ MEMBER PROFILE */
  if (page === "client-detail") {
    var cid = api.qs("id");
    var enc = encodeURIComponent(cid || "");
    var client = null;
    var tpl = null; /* /clients/template for this member's office (genders, staff) */

    var emit = function (c) { document.dispatchEvent(new CustomEvent("desk:client", { detail: c })); };
    var notice = function (msg) { var n = $("client-notice"); if (!n) return; n.textContent = msg || ""; n.hidden = !msg; };
    var need = function () { if (!client) throw new Error("Member not loaded yet."); return client; };

    var paintAccounts = function (accounts) {
      var loans = accounts.loanAccounts || [];
      var savs = accounts.savingsAccounts || [];
      var shares = accounts.shareAccounts || [];
      var savTotal = savs.reduce(function (s, a) { return s + (a.status && a.status.active ? Number(a.accountBalance || 0) : 0); }, 0);
      var loanTotal = loans.reduce(function (s, a) { return s + (a.status && a.status.active ? Number(a.loanBalance || 0) : 0); }, 0);
      setText("client-savings-total", savs.length ? api.formatMoney(savTotal) : "No savings");
      setText("client-loan-total", loans.length ? api.formatMoney(loanTotal) : "No loans");
      document.querySelector("#client-loans tbody").innerHTML = loans.map(function (l) {
        var href = "loan-detail.html?id=" + encodeURIComponent(l.id);
        return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(l.accountNo || l.id) + "</a></td><td>" + esc(l.productName || "") +
          (l.inArrears ? " <span class=\"chip red\">In arrears</span>" : "") + "</td><td>" + api.statusBadge(l.status) +
          "</td><td class=\"mono text-right\">" + api.formatMoney(l.originalLoan) + "</td><td class=\"mono text-right\">" +
          (l.loanBalance !== undefined && l.loanBalance !== null ? api.formatMoney(l.loanBalance) : "—") +
          "</td><td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">Open</a></td></tr>";
      }).join("") || api.emptyRow(6, "No loans");
      document.querySelector("#client-savings tbody").innerHTML = savs.map(function (s) {
        var href = "savings-detail.html?id=" + encodeURIComponent(s.id);
        return "<tr><td class=\"mono\"><a href=\"" + href + "\">" + esc(s.accountNo || s.id) + "</a></td><td>" + esc(s.productName || "") +
          "</td><td>" + api.statusBadge(s.status) + "</td><td class=\"mono text-right\">" + api.formatMoney(s.accountBalance || 0) +
          "</td><td><a class=\"btn btn-sm btn-ghost\" href=\"" + href + "\">Open</a></td></tr>";
      }).join("") || api.emptyRow(5, "No savings accounts");
      document.querySelector("#client-shares tbody").innerHTML = shares.map(function (s) {
        return "<tr><td class=\"mono\">" + esc(s.accountNo || s.id) + "</td><td>" + esc(s.productName || "") + "</td><td>" + api.statusBadge(s.status) +
          "</td><td class=\"mono text-right\">" + api.formatNumber(s.totalApprovedShares || 0) + "</td><td class=\"mono text-right\">" +
          api.formatNumber(s.totalPendingForApprovalShares || 0) + "</td></tr>";
      }).join("") || api.emptyRow(5, "No share accounts");
    };

    var ids = [];
    var paintIds = async function () {
      var tb = loadingRows("client-ids", 5);
      try {
        var list = await F.get("/clients/" + enc + "/identifiers");
        ids = Array.isArray(list) ? list : [];
      } catch (err) { tb.innerHTML = api.emptyRow(5, "Could not load: " + err.message); return; }
      var canDel = api.can("DELETE_CLIENTIDENTIFIER");
      tb.innerHTML = ids.map(function (i) {
        var active = /active/i.test(String(i.status || "")) && !/inactive/i.test(String(i.status || ""));
        return "<tr><td>" + esc((i.documentType && i.documentType.name) || "—") + "</td><td class=\"mono\">" + esc(i.documentKey || "") +
          "</td><td>" + esc(i.description || "—") + "</td><td>" + (active ? "<span class=\"status active\">Active</span>" : "<span class=\"status closed\">Inactive</span>") +
          "</td><td><div class=\"row-actions\">" + (canDel ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-id=\"" + esc(i.id) + "\">Delete</button>" : "") +
          "</div></td></tr>";
      }).join("") || api.emptyRow(5, "No identity documents yet — add the member's National ID (NIN).");
      var primary = ids.filter(function (i) { return isNinType(i.documentType && i.documentType.name); })[0] || ids[0];
      setText("client-identifier", primary ? ((primary.documentType && primary.documentType.name) || "ID") + " · " + (primary.documentKey || "") : "Not captured");
    };

    var family = [];
    var famTpl = null;
    var paintFamily = async function () {
      var tb = loadingRows("client-family", 7);
      try {
        var list = await F.get("/clients/" + enc + "/familymembers");
        family = Array.isArray(list) ? list : [];
      } catch (err) { tb.innerHTML = api.emptyRow(7, "Could not load: " + err.message); return; }
      var canEdit = api.can("CREATE_FAMILYMEMBERS") && api.can("DELETE_FAMILYMEMBERS");
      var canDel = api.can("DELETE_FAMILYMEMBERS");
      tb.innerHTML = family.map(function (f) {
        var name = [f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ");
        return "<tr><td class=\"strong\">" + esc(name) + "</td><td>" + esc(f.relationship || "—") + "</td><td>" + esc(f.mobileNumber || "—") +
          "</td><td>" + esc(f.gender || "—") + "</td><td>" + esc(f.dateOfBirth ? api.formatDate(f.dateOfBirth) : "—") + "</td><td>" + (f.isDependent ? "Yes" : "No") +
          "</td><td><div class=\"row-actions\">" +
          (canEdit ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-edit-fam=\"" + esc(f.id) + "\">Edit</button>" : "") +
          (canDel ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-fam=\"" + esc(f.id) + "\">Delete</button>" : "") +
          "</div></td></tr>";
      }).join("") || api.emptyRow(7, "No next of kin recorded yet.");
    };

    var docs = [];
    var paintDocs = async function () {
      var tb = loadingRows("client-docs", 5);
      try {
        var list = await F.get("/clients/" + enc + "/documents");
        docs = Array.isArray(list) ? list : [];
      } catch (err) { tb.innerHTML = api.emptyRow(5, "Could not load: " + err.message); return; }
      var canDel = api.can("DELETE_DOCUMENT");
      tb.innerHTML = docs.map(function (d) {
        return "<tr><td class=\"strong\">" + esc(d.name || "—") + "</td><td>" + esc(d.fileName || "") + "</td><td>" + esc(d.description || "—") +
          "</td><td class=\"mono text-right\">" + esc(fileSize(d.size)) + "</td><td><div class=\"row-actions\">" +
          "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-view-doc=\"" + esc(d.id) + "\">View</button>" +
          "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-get-doc=\"" + esc(d.id) + "\">Download</button>" +
          (canDel ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-del-doc=\"" + esc(d.id) + "\">Delete</button>" : "") +
          "</div></td></tr>";
      }).join("") || api.emptyRow(5, "No documents yet — upload the ID scan and the signed membership form.");
    };

    var paintCharges = async function () {
      var tb = loadingRows("client-charges", 6);
      try {
        var data = await F.get("/clients/" + enc + "/charges?pendingPayment=false&limit=100");
        var items = (data && (data.pageItems || (Array.isArray(data) ? data : []))) || [];
        tb.innerHTML = items.map(function (c) {
          var st = c.isWaived ? "Waived" : (c.isPaid || Number(c.amountOutstanding || 0) === 0 ? "Paid" : "Due");
          return "<tr><td>" + esc(c.name || "") + "</td><td>" + esc(api.formatDate(c.dueDate)) + "</td><td class=\"mono text-right\">" + api.formatMoney(c.amount) +
            "</td><td class=\"mono text-right\">" + api.formatMoney(c.amountPaid || 0) + "</td><td class=\"mono text-right\">" + api.formatMoney(c.amountOutstanding || 0) +
            "</td><td><span class=\"status " + (st === "Due" ? "pending" : (st === "Paid" ? "active" : "closed")) + "\">" + st + "</span></td></tr>";
        }).join("") || api.emptyRow(6, "No member-level charges.");
      } catch (err) { tb.innerHTML = api.emptyRow(6, "Could not load: " + err.message); }
    };

    var paintAddresses = async function (enabled) {
      var tab = $("tab-addr");
      if (tab) tab.hidden = !enabled;
      if (!enabled) return;
      var tb = loadingRows("client-addr", 4);
      try {
        var list = await F.get("/client/" + enc + "/addresses");
        list = Array.isArray(list) ? list : [];
        tb.innerHTML = list.map(function (a) {
          var line = [a.street, a.addressLine1, a.addressLine2, a.addressLine3].filter(Boolean).join(", ");
          return "<tr><td>" + esc(a.addressType || "—") + "</td><td>" + esc(line || "—") + "</td><td>" + esc([a.city, a.stateName, a.countryName].filter(Boolean).join(", ") || "—") +
            "</td><td>" + (a.isActive ? "Active" : "Inactive") + "</td></tr>";
        }).join("") || api.emptyRow(4, "No addresses recorded.");
      } catch (err) { tb.innerHTML = api.emptyRow(4, "Could not load: " + err.message); }
    };

    var paintLifecycle = function (c) {
      var st = statusId(c);
      show("btn-activate", st === 100);
      show("btn-accept-transfer", st === 303);
      show("btn-reject-transfer", st === 303);
      show("btn-withdraw-transfer", st === 303 || st === 304);
      show("btn-transfer", st === 300 || st === 304);
      show("btn-close", st === 300);
      show("btn-reactivate", st === 600);
      show("btn-remove-photo", !!c.imagePresent && st !== 600 && st !== 700 && st !== 400);
      var active = st === 300;
      show("link-new-loan", active);
      show("btn-open-savings", active);
      var editable = st !== 600 && st !== 700 && st !== 400;
      show("btn-edit", editable);
      show("btn-update-photo", editable);
      show("btn-add-id", editable);
      show("btn-add-family", editable);
      show("btn-add-doc", editable);
      var msg = "";
      if (st === 100) msg = "This member is pending activation. Check the KYC details below, then click “Activate member” to allow accounts and loans.";
      else if (st === 303) msg = "Transfer to " + (c.transferToOfficeName || "another office") + " is waiting for the destination office to accept it. Accounts cannot be used until then.";
      else if (st === 304) msg = "A transfer for this member was rejected and is on hold. Propose a new transfer or cancel it.";
      else if (st === 600) msg = "This member is closed" + (c.timeline && c.timeline.closedOnDate ? " since " + api.formatDate(c.timeline.closedOnDate) : "") + ". Reactivate to use them again.";
      notice(msg);
    };

    var paintClient = async function () {
      if (!cid) {
        setText("page-sub", "No member selected.");
        throw new Error("Open a member from the Clients list.");
      }
      var res = await Promise.all([
        F.get("/clients/" + enc),
        F.get("/clients/" + enc + "/accounts").catch(function () { return {}; })
      ]);
      var c = res[0];
      client = c;
      var name = fullName(c);
      document.title = name + " · Phaneroo SACCO";
      setText("client-title", name);
      setText("client-name", name);
      $("client-status").innerHTML = api.statusBadge(c.status);
      setText("page-sub", "Client #" + (c.accountNo || c.id) + " · " + (c.officeName || ""));
      var bits = [];
      if (c.gender && c.gender.name) bits.push(c.gender.name);
      var dob = c.dateOfBirth ? api.formatDate(c.dateOfBirth) : "";
      var age = dob ? ageOn(dob) : null;
      if (age !== null) bits.push(age + " years");
      if (c.emailAddress) bits.push(c.emailAddress);
      if (c.timeline && c.timeline.submittedOnDate) bits.push("Registered " + api.formatDate(c.timeline.submittedOnDate));
      setText("client-summary", bits.join(" · ") || "—");
      setText("client-external", c.externalId || "—");
      setText("client-mobile", c.mobileNo || "Not captured");
      setText("client-dob", dob || "Not captured");
      setText("client-office", c.officeName);
      setText("client-staff", c.staffName || "Not assigned");
      var tl = c.timeline || {};
      setText("client-activation", tl.activatedOnDate ? api.formatDate(tl.activatedOnDate) : "Not activated");
      setText("client-groups", (c.groups || []).map(function (g) { return g.name; }).join(", ") || "None");
      paintAccounts(res[1] || {});
      paintLifecycle(c);
      var st = $("link-statement");
      if (st) st.href = "member-statement.html?clientId=" + enc;
      var nl = $("link-new-loan");
      if (nl) nl.href = "loan-apply.html?clientId=" + enc;
      emit(c);
      var av = $("client-avatar");
      if (c.imagePresent) photoDataUrl(c.id).then(function (u) { paintPhoto(av, u, name); }).catch(function () { paintPhoto(av, "", name); });
      else paintPhoto(av, "", name);
    };
    var paintAll = async function () {
      await paintClient();
      var t = await F.get("/clients/template?officeId=" + encodeURIComponent(client.officeId)).catch(function () { return null; });
      tpl = t;
      await Promise.all([paintIds(), paintFamily(), paintDocs(), paintCharges(), paintAddresses(!!(t && t.isAddressEnabled))]);
    };
    var reload = function () { return paintClient().catch(fail); };
    document.addEventListener("desk:refresh", function () { paintAll().catch(fail); });
    paintAll().catch(function (err) {
      if (err && err.status === 404) {
        err = new Error("No member with id " + cid + " exists. Open the member from the Clients list.");
        setText("page-sub", "Member not found");
        setText("client-name", "Member not found");
      }
      fail(err);
      document.querySelectorAll("#main-content tr.loading-row td").forEach(function (td) { td.textContent = "Could not load: " + friendly(err); });
    });

    /* ---- profile edit ---- */
    on($("btn-edit"), async function () {
      var c = need();
      var t = tpl || await F.get("/clients/template?officeId=" + encodeURIComponent(c.officeId));
      var genders = t.genderOptions || [];
      var staff = (t.staffOptions || []).slice();
      if (c.staffId && !staff.some(function (s) { return String(s.id) === String(c.staffId); })) staff.unshift({ id: c.staffId, displayName: c.staffName });
      var fields = [
        { key: "firstname", label: "First name", required: true, value: c.firstname || "" },
        { key: "middlename", label: "Middle name", value: c.middlename || "" },
        { key: "lastname", label: "Last name", required: true, value: c.lastname || "" },
        genders.length ? { key: "genderId", label: "Gender", type: "select", required: true, placeholder: "— Select —", value: c.gender ? String(c.gender.id) : "", options: opts(genders) } : null,
        { key: "dateOfBirth", label: "Date of birth", type: "date", value: c.dateOfBirth ? api.formatDate(c.dateOfBirth) : "", max: api.todayISO() },
        { key: "mobileNo", label: "Mobile", type: "tel", required: true, value: c.mobileNo || "", help: "Ugandan number, e.g. 0772 123 456" },
        { key: "emailAddress", label: "Email", type: "email", value: c.emailAddress || "" },
        { key: "externalId", label: "Member number", value: c.externalId || "" },
        { key: "staffId", label: "Loan officer / staff", type: "select", placeholder: "— None —", value: c.staffId ? String(c.staffId) : "", options: opts(staff, "displayName") }
      ].filter(Boolean);
      var changes = null;
      var v = await api.openDialog({
        title: "Edit member profile", submitLabel: "Save changes", fields: fields,
        validate: function (val) {
          if (normMobile(val.mobileNo) === null) return "Enter a Ugandan mobile number, e.g. 0772 123 456.";
          if (val.emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.emailAddress.trim())) return "Enter a valid email address or leave it blank.";
          if (val.dateOfBirth && ageOn(val.dateOfBirth) < 0) return "Date of birth cannot be in the future.";
          if (c.externalId && !val.externalId.trim()) return "The member number cannot be removed once set. Change it instead.";
          return "";
        },
        onSubmit: async function (val) {
          var body = {};
          var put = function (k, nv, ov) { if (String(nv === null || nv === undefined ? "" : nv) !== String(ov === null || ov === undefined ? "" : ov)) body[k] = nv; };
          put("firstname", val.firstname.trim(), c.firstname);
          put("middlename", val.middlename.trim(), c.middlename);
          put("lastname", val.lastname.trim(), c.lastname);
          if (val.genderId !== undefined) put("genderId", val.genderId ? Number(val.genderId) : "", c.gender ? c.gender.id : "");
          put("mobileNo", normMobile(val.mobileNo), c.mobileNo);
          put("emailAddress", val.emailAddress.trim(), c.emailAddress);
          put("externalId", val.externalId.trim(), c.externalId);
          if (val.dateOfBirth && val.dateOfBirth !== (c.dateOfBirth ? api.formatDate(c.dateOfBirth) : "")) Object.assign(body, withDate({ dateOfBirth: val.dateOfBirth }));
          var staffChanged = String(val.staffId || "") !== String(c.staffId || "");
          if (staffChanged && val.staffId) body.staffId = Number(val.staffId);
          if (!Object.keys(body).length && !staffChanged) { changes = 0; return; }
          if (body.mobileNo) {
            var hit = await findExisting(body.mobileNo, "clients", function (r) { return r.entityType === "CLIENT" && r.entityMobileNo === body.mobileNo && String(r.entityId) !== String(c.id); });
            if (hit) throw new Error("Mobile " + body.mobileNo + " already belongs to " + hit.entityName + " (client #" + hit.entityAccountNo + ").");
          }
          if (Object.keys(body).length) {
            /* Fineract validates a person's name as a whole: always send first and last name. */
            body.firstname = val.firstname.trim();
            body.lastname = val.lastname.trim();
            await F.put("/clients/" + enc, body);
          }
          if (staffChanged && !val.staffId) await F.post("/clients/" + enc + "?command=unassignStaff", { staffId: Number(c.staffId) });
          changes = 1;
        }
      });
      if (v) { api.toast(changes ? "Profile updated" : "No changes to save", changes ? "success" : ""); if (changes) await reload(); }
    });

    /* ---- photo ---- */
    var photoBtn = $("btn-update-photo");
    if (photoBtn) {
      var photoInput = document.createElement("input");
      photoInput.type = "file";
      photoInput.accept = "image/jpeg,image/png,image/gif";
      photoInput.hidden = true;
      photoInput.setAttribute("aria-hidden", "true");
      photoInput.tabIndex = -1;
      document.body.appendChild(photoInput);
      photoBtn.addEventListener("click", function () {
        if (photoBtn.disabled) return;
        photoInput.value = "";
        photoInput.click();
      });
      photoInput.addEventListener("change", function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) return;
        var p = photoProblem(file);
        if (p) { api.toast(p, "error"); return; }
        photoBtn.disabled = true;
        photoBtn.textContent = "Uploading…";
        uploadPhoto(cid, file).then(function () {
          api.toast("Photo saved", "success");
          return reload();
        }).catch(fail).then(function () { photoBtn.disabled = false; photoBtn.textContent = "Update photo"; });
      });
    }
    on($("btn-remove-photo"), async function () {
      var c = need();
      var ok = await api.confirmDialog({
        title: "Remove photo", message: "Remove the photo of " + fullName(c) + "?", confirmLabel: "Remove photo",
        onConfirm: function () { return F.del("/clients/" + enc + "/images"); }
      });
      if (ok) { api.toast("Photo removed", "success"); await reload(); }
    });

    /* ---- lifecycle ---- */
    on($("btn-activate"), async function () {
      var c = need();
      if (await activateDialog(c)) { api.toast("Member activated", "success"); await reload(); }
    });
    on($("btn-close"), async function () {
      var c = need();
      var t = await F.get("/clients/template?commandParam=close");
      var reasons = (t.narrations || []).filter(function (r) { return r.active !== false; });
      if (!reasons.length) throw new Error("No closure reasons are configured. Ask an administrator to add values to the “ClientClosureReason” code in Fineract.");
      var reasonField = { key: "reason", label: "Reason", type: "select", required: true, placeholder: "— Select reason —", options: opts(reasons) };
      var v = await api.openDialog({
        title: "Close member", submitLabel: "Review",
        message: "All of the member's loans, savings and share accounts must be closed first.",
        fields: [dateField("Closure date"), reasonField],
        confirm: function (val) {
          return { title: "Confirm closure", lines: [["Member", fullName(c)], ["Client #", c.accountNo || c.id], ["Reason", optionLabel(reasonField, val.reason)], ["Closure date", val.date]], note: "Closed members cannot transact until reactivated.", confirmLabel: "Close member" };
        },
        onSubmit: function (val) { return F.post("/clients/" + enc + "?command=close", withDate({ closureDate: val.date, closureReasonId: Number(val.reason) })); }
      });
      if (v) { api.toast("Member closed", "success"); await reload(); }
    });
    on($("btn-reactivate"), async function () {
      var c = need();
      var v = await api.openDialog({
        title: "Reactivate " + fullName(c), submitLabel: "Reactivate",
        fields: [dateField("Reactivation date")],
        onSubmit: function (val) { return F.post("/clients/" + enc + "?command=reactivate", withDate({ reactivationDate: val.date })); }
      });
      if (v) { api.toast("Member reactivated — they are pending again; click “Activate member” to finish", "success"); await reload(); }
    });
    on($("btn-transfer"), async function () {
      var c = need();
      if ((c.groups || []).length) throw new Error("This member belongs to a group (" + c.groups.map(function (g) { return g.name; }).join(", ") + "). Remove them from the group before transferring.");
      var offices = (await loadOffices()).filter(function (o) { return String(o.id) !== String(c.officeId); });
      if (!offices.length) throw new Error("There is no other office to transfer to.");
      var canNow = api.can("PROPOSEANDACCEPTTRANSFER_CLIENT");
      var canPropose = api.can("PROPOSETRANSFER_CLIENT");
      var officeField = { key: "officeId", label: "Destination office", type: "select", required: true, placeholder: "— Select office —", options: opts(offices) };
      var modeField = { key: "mode", label: "How", type: "select", value: canNow ? "now" : "propose", options: [
        canNow ? { value: "now", label: "Transfer now (I approve for both offices)" } : null,
        canPropose ? { value: "propose", label: "Propose — destination office accepts" } : null
      ].filter(Boolean) };
      var mode = "";
      var dest = "";
      var v = await api.openDialog({
        title: "Transfer " + fullName(c), submitLabel: "Review",
        message: "The member's loans and savings move with them to the new office.",
        fields: [officeField, modeField, dateField("Transfer date"), { key: "note", label: "Note", placeholder: "Reason for transfer (optional)" }],
        confirm: function (val) {
          return { title: val.mode === "now" ? "Confirm transfer" : "Confirm transfer proposal", lines: [["Member", fullName(c)], ["From", c.officeName || ""], ["To", optionLabel(officeField, val.officeId)], ["Date", val.date]], confirmLabel: val.mode === "now" ? "Transfer now" : "Propose transfer" };
        },
        onSubmit: function (val) {
          mode = val.mode;
          dest = optionLabel(officeField, val.officeId);
          if (val.mode === "now") {
            return F.post("/clients/" + enc + "?command=proposeAndAcceptTransfer", { destinationOfficeId: Number(val.officeId), note: val.note || "" });
          }
          return F.post("/clients/" + enc + "?command=proposeTransfer", withDate({ destinationOfficeId: Number(val.officeId), transferDate: val.date, note: val.note || "" }));
        }
      });
      if (v) { api.toast(mode === "now" ? "Member transferred to " + dest : "Transfer proposed — the destination office must accept it", "success"); await paintAll(); }
    });
    var transferCmd = function (command, title, okMsg) {
      return async function () {
        var c = need();
        var v = await api.openDialog({
          title: title, submitLabel: title,
          message: fullName(c) + " · " + (c.officeName || "") + (c.transferToOfficeName ? " → " + c.transferToOfficeName : ""),
          fields: [{ key: "note", label: "Note", placeholder: "optional" }],
          onSubmit: function (val) { return F.post("/clients/" + enc + "?command=" + command, { note: val.note || "" }); }
        });
        if (v) { api.toast(okMsg, "success"); await paintAll(); }
      };
    };
    on($("btn-accept-transfer"), transferCmd("acceptTransfer", "Accept transfer", "Transfer accepted"));
    on($("btn-reject-transfer"), transferCmd("rejectTransfer", "Reject transfer", "Transfer rejected"));
    on($("btn-withdraw-transfer"), transferCmd("withdrawTransfer", "Cancel transfer", "Transfer cancelled"));

    /* ---- identifiers ---- */
    on($("btn-add-id"), async function () {
      var t = await F.get("/clients/" + enc + "/identifiers/template");
      var types = (t.allowedDocumentTypes || []).filter(function (x) { return x.active !== false; });
      if (!types.length) throw new Error("No identifier types are configured. Add values to the “Customer Identifier” code in Fineract.");
      var hasNin = ids.some(function (i) { return isNinType(i.documentType && i.documentType.name); });
      var nin = types.filter(function (x) { return isNinType(x.name); })[0];
      var typeField = { key: "documentTypeId", label: "ID type", type: "select", required: true, placeholder: "— Select —", value: nin && !hasNin ? String(nin.id) : "", options: opts(types) };
      var v = await api.openDialog({
        title: "Add identity document", submitLabel: "Save",
        fields: [typeField, { key: "documentKey", label: "ID number", required: true, autocomplete: "off" }, { key: "description", label: "Description", placeholder: "optional, e.g. expiry date" }],
        validate: function (val) { return idProblem(optionLabel(typeField, val.documentTypeId), normIdNumber(val.documentKey)); },
        onSubmit: function (val) {
          var body = { documentTypeId: Number(val.documentTypeId), documentKey: normIdNumber(val.documentKey), status: "Active" };
          if (val.description.trim()) body.description = val.description.trim();
          return F.post("/clients/" + enc + "/identifiers", body);
        }
      });
      if (v) { api.toast("Identifier saved", "success"); await paintIds(); }
    });
    var idsTable = $("client-ids");
    if (idsTable) idsTable.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-del-id]");
      if (!b || b.disabled) return;
      var item = ids.filter(function (i) { return String(i.id) === b.getAttribute("data-del-id"); })[0];
      if (!item) return;
      b.disabled = true;
      api.confirmDialog({
        title: "Delete identifier", confirmLabel: "Delete",
        lines: [["Type", (item.documentType && item.documentType.name) || ""], ["Number", item.documentKey || ""]],
        onConfirm: function () { return F.del("/clients/" + enc + "/identifiers/" + encodeURIComponent(item.id)); }
      }).then(function (ok) { if (ok) { api.toast("Identifier deleted", "success"); return paintIds(); } })
        .catch(fail).then(function () { b.disabled = false; });
    });

    /* ---- next of kin / family ---- */
    var familyDialog = async function (existing) {
      if (!famTpl) famTpl = await F.get("/clients/" + enc + "/familymembers/template");
      var rel = (famTpl.relationshipIdOptions || []).filter(function (x) { return x.active !== false; });
      if (!rel.length) throw new Error("No relationships are configured. Add values (e.g. Spouse, Parent, Child) to the “RELATIONSHIP” code in Fineract.");
      var genders = famTpl.genderIdOptions || [];
      var marital = famTpl.maritalStatusIdOptions || [];
      var e = existing || {};
      var fields = [
        { key: "firstName", label: "First name", required: true, value: e.firstName || "" },
        { key: "lastName", label: "Last name", required: true, value: e.lastName || "" },
        { key: "relationshipId", label: "Relationship", type: "select", required: true, placeholder: "— Select —", value: e.relationshipId ? String(e.relationshipId) : "", options: opts(rel) },
        { key: "mobileNumber", label: "Mobile", type: "tel", value: e.mobileNumber || "", help: "Needed to contact next of kin" },
        genders.length ? { key: "genderId", label: "Gender", type: "select", placeholder: "— Not set —", value: e.genderId ? String(e.genderId) : "", options: opts(genders) } : null,
        { key: "dateOfBirth", label: "Date of birth", type: "date", value: e.dateOfBirth ? api.formatDate(e.dateOfBirth) : "", max: api.todayISO() },
        marital.length ? { key: "maritalStatusId", label: "Marital status", type: "select", placeholder: "— Not set —", value: e.maritalStatusId ? String(e.maritalStatusId) : "", options: opts(marital) } : null,
        { key: "isDependent", label: "Dependent on the member", type: "select", value: e.isDependent ? "yes" : "no", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] }
      ].filter(Boolean);
      return api.openDialog({
        title: existing ? "Edit next of kin" : "Add next of kin / family member", submitLabel: "Save", fields: fields,
        validate: function (val) {
          if (val.mobileNumber && normMobile(val.mobileNumber) === null) return "Enter a Ugandan mobile number, e.g. 0772 123 456, or leave it blank.";
          if (val.dateOfBirth && ageOn(val.dateOfBirth) < 0) return "Date of birth cannot be in the future.";
          return "";
        },
        onSubmit: async function (val) {
          var body = {
            firstName: val.firstName.trim(), lastName: val.lastName.trim(), relationshipId: Number(val.relationshipId),
            isDependent: val.isDependent === "yes"
          };
          if (val.mobileNumber) body.mobileNumber = normMobile(val.mobileNumber);
          if (val.genderId) body.genderId = Number(val.genderId);
          if (val.maritalStatusId) body.maritalStatusId = Number(val.maritalStatusId);
          if (val.dateOfBirth) { Object.assign(body, withDate({ dateOfBirth: val.dateOfBirth })); body.age = ageOn(val.dateOfBirth); }
          /* PUT /familymembers/{id} fails with a server error on this Fineract build, so an edit
             saves the new record first and then removes the old one. */
          await F.post("/clients/" + enc + "/familymembers", body);
          if (existing) {
            try { await F.del("/clients/" + enc + "/familymembers/" + encodeURIComponent(existing.id)); }
            catch (err) { throw new Error("The updated record was saved, but the old one could not be removed: " + err.message); }
          }
        }
      });
    };
    on($("btn-add-family"), async function () {
      if (await familyDialog(null)) { api.toast("Next of kin saved", "success"); await paintFamily(); }
    });
    var famTable = $("client-family");
    if (famTable) famTable.addEventListener("click", function (e) {
      var ed = e.target.closest("button[data-edit-fam]");
      var del = e.target.closest("button[data-del-fam]");
      var b = ed || del;
      if (!b || b.disabled) return;
      var item = family.filter(function (f) { return String(f.id) === b.getAttribute(ed ? "data-edit-fam" : "data-del-fam"); })[0];
      if (!item) return;
      b.disabled = true;
      var p = ed ? familyDialog(item).then(function (r) { if (r) { api.toast("Next of kin updated", "success"); return paintFamily(); } })
        : api.confirmDialog({
          title: "Delete family member", confirmLabel: "Delete",
          lines: [["Name", [item.firstName, item.lastName].filter(Boolean).join(" ")], ["Relationship", item.relationship || ""]],
          onConfirm: function () { return F.del("/clients/" + enc + "/familymembers/" + encodeURIComponent(item.id)); }
        }).then(function (ok) { if (ok) { api.toast("Family member deleted", "success"); return paintFamily(); } });
      p.catch(fail).then(function () { b.disabled = false; });
    });

    /* ---- documents ---- */
    on($("btn-add-doc"), async function () {
      var names = await codeValues("Customer Documents").catch(function () { return []; });
      var nameField = names.length
        ? { key: "name", label: "Document", type: "select", required: true, placeholder: "— Select —", options: names.map(function (n) { return { value: n.name, label: n.name }; }) }
        : { key: "name", label: "Document name", required: true, placeholder: "e.g. National ID scan, Membership form" };
      var picked = null;
      var dlg = api.openDialog({
        title: "Upload document", submitLabel: "Upload",
        fields: [nameField, { key: "file", label: "File (PDF or image, max 5 MB)", type: "file", required: true, full: true }, { key: "description", label: "Description", placeholder: "optional" }],
        validate: function () {
          var inp = document.querySelector(".dialog input[type=file][data-k=file]");
          picked = inp && inp.files && inp.files[0];
          return docProblem(picked);
        },
        onSubmit: function (val) { return uploadDocument(cid, picked, val.name.trim(), val.description.trim()); }
      });
      var fileInput = document.querySelector(".dialog input[type=file][data-k=file]");
      if (fileInput) fileInput.accept = "application/pdf,image/*";
      if (await dlg) { api.toast("Document uploaded", "success"); await paintDocs(); }
    });
    var fetchDoc = async function (d) {
      var res = await rawGet("/clients/" + enc + "/documents/" + encodeURIComponent(d.id) + "/attachment", "*/*");
      if (!res.ok) throw new Error("Could not download “" + (d.fileName || d.name) + "” (HTTP " + res.status + ").");
      return res.blob();
    };
    var docTable = $("client-docs");
    if (docTable) docTable.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-view-doc], button[data-get-doc], button[data-del-doc]");
      if (!b || b.disabled) return;
      var idAttr = b.getAttribute("data-view-doc") || b.getAttribute("data-get-doc") || b.getAttribute("data-del-doc");
      var d = docs.filter(function (x) { return String(x.id) === idAttr; })[0];
      if (!d) return;
      b.disabled = true;
      var p;
      if (b.hasAttribute("data-del-doc")) {
        p = api.confirmDialog({
          title: "Delete document", confirmLabel: "Delete", lines: [["Document", d.name || ""], ["File", d.fileName || ""]],
          onConfirm: function () { return F.del("/clients/" + enc + "/documents/" + encodeURIComponent(d.id)); }
        }).then(function (ok) { if (ok) { api.toast("Document deleted", "success"); return paintDocs(); } });
      } else {
        var view = b.hasAttribute("data-view-doc");
        var win = view ? window.open("", "_blank") : null;
        p = fetchDoc(d).then(function (blob) {
          var url = URL.createObjectURL(blob);
          if (view && win) {
            win.location.href = url;
          } else {
            var a = document.createElement("a");
            a.href = url;
            a.download = d.fileName || d.name || "document";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        }).catch(function (err) { if (win) win.close(); throw err; });
      }
      p.catch(fail).then(function () { b.disabled = false; });
    });
  }

  /* ============================================================ GROUPS / CENTRES */
  if (page === "groups" || page === "centres") {
    var isGroup = page === "groups";
    var base = isGroup ? "/groups" : "/centers";
    var noun = isGroup ? "group" : "centre";
    var gSearch = $(page + "-search");
    var rowsById = {};
    var selected = null;

    var gList = pagedList({
      tbody: document.querySelector("#" + page + "-table tbody"), pager: $(page + "-pager"), cols: 5,
      empty: isGroup ? "No groups yet — create one to bring members together." : "No centres yet.",
      fetch: async function (offset, limit) {
        var url = base + "?paged=true&offset=" + offset + "&limit=" + limit + "&orderBy=id&sortOrder=DESC";
        var q = gSearch ? gSearch.value.trim() : "";
        if (q) url += "&name=" + encodeURIComponent(q);
        var data = await F.get(url);
        if (Array.isArray(data)) return { items: data, total: data.length, paged: false };
        return { items: data.pageItems || [], total: data.totalFilteredRecords || 0 };
      },
      row: function (g) {
        rowsById[g.id] = g;
        return "<tr" + (selected && String(selected.id) === String(g.id) ? " class=\"is-selected\"" : "") + "><td class=\"strong\">" + esc(g.name || "") +
          (g.externalId ? " <span class=\"text-muted small-note\">" + esc(g.externalId) + "</span>" : "") + "</td><td>" + esc(g.officeName || "") + "</td><td>" +
          esc((isGroup ? g.centerName : g.staffName) || "—") + "</td><td>" + api.statusBadge(g.status) +
          "</td><td><div class=\"row-actions\"><button type=\"button\" class=\"btn btn-sm btn-ghost\" data-manage=\"" + esc(g.id) + "\" aria-label=\"Manage " + esc(g.name || "") + "\">" +
          (isGroup ? "Members" : "Groups") + "</button></div></td></tr>";
      }
    });
    var gf = $(page + "-filter");
    if (gf) gf.addEventListener("submit", function (e) { e.preventDefault(); gList.reset().catch(fail); });
    gList.reset().catch(fail);

    var panel = $("gc-panel");
    var paintPanel = async function () {
      if (!selected) { panel.hidden = true; return; }
      panel.hidden = false;
      var tb = loadingRows("gc-members", 5);
      var g = await F.get(base + "/" + encodeURIComponent(selected.id) + "?associations=" + (isGroup ? "clientMembers" : "groupMembers"));
      selected = g;
      setText("gc-title", g.name + " · " + (isGroup ? "members" : "groups"));
      var st = statusId(g);
      var bits = [g.officeName, api.statusLabel(g.status)];
      if (g.activationDate) bits.push("active since " + api.formatDate(g.activationDate));
      if (isGroup && g.centerName) bits.push("centre: " + g.centerName);
      if (g.staffName) bits.push("staff: " + g.staffName);
      setText("gc-summary", bits.filter(Boolean).join(" · "));
      show("gc-activate", st === 100);
      show("gc-add", st === 300 || st === 100);
      var members = (isGroup ? g.clientMembers : g.groupMembers) || [];
      var canRemove = api.can(isGroup ? "DISASSOCIATECLIENTS_GROUP" : "DISASSOCIATEGROUPS_CENTER");
      tb.innerHTML = members.map(function (m) {
        var name = isGroup ? fullName(m) : m.name;
        var link = isGroup ? "<a href=\"client-detail.html?id=" + encodeURIComponent(m.id) + "\">" + esc(name) + "</a>" : esc(name);
        return "<tr><td class=\"mono\">" + esc(m.accountNo || m.id) + "</td><td class=\"strong\">" + link + "</td><td>" +
          esc(isGroup ? (m.mobileNo || "—") : (m.officeName || "—")) + "</td><td>" + api.statusBadge(m.status) + "</td><td><div class=\"row-actions\">" +
          (canRemove ? "<button type=\"button\" class=\"btn btn-sm btn-ghost\" data-remove=\"" + esc(m.id) + "\" data-name=\"" + esc(name) + "\">Remove</button>" : "") +
          "</div></td></tr>";
      }).join("") || api.emptyRow(5, isGroup ? "No members yet — use “Add member”." : "No groups yet — use “Add group”.");
    };
    var tableEl = $(page + "-table");
    if (tableEl) tableEl.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-manage]");
      if (!b) return;
      selected = rowsById[b.getAttribute("data-manage")] || { id: b.getAttribute("data-manage") };
      tableEl.querySelectorAll("tr.is-selected").forEach(function (tr) { tr.classList.remove("is-selected"); });
      b.closest("tr").classList.add("is-selected");
      paintPanel().then(function () { panel.scrollIntoView({ behavior: "smooth", block: "start" }); }).catch(fail);
    });
    var closePanel = $("gc-close-panel");
    if (closePanel) closePanel.addEventListener("click", function () {
      selected = null;
      panel.hidden = true;
      if (tableEl) tableEl.querySelectorAll("tr.is-selected").forEach(function (tr) { tr.classList.remove("is-selected"); });
    });
    on($("gc-activate"), async function () {
      var g = selected;
      var v = await api.openDialog({
        title: "Activate " + g.name, submitLabel: "Activate", fields: [dateField("Activation date")],
        onSubmit: function (val) { return F.post(base + "/" + encodeURIComponent(g.id) + "?command=activate", withDate({ activationDate: val.date })); }
      });
      if (v) { api.toast(isGroup ? "Group activated" : "Centre activated", "success"); await paintPanel(); gList.current().catch(fail); }
    });
    on($("gc-add"), async function () {
      var g = selected;
      if (isGroup) {
        var v = await api.openDialog({
          title: "Add member to " + g.name, submitLabel: "Add member",
          message: "Only active members of " + (g.officeName || "this office") + " can join. Search by name, account no or phone.",
          fields: [{ key: "clientId", label: "Member", type: "search", required: true, search: function (q) {
            return api.searchClients(q).then(function (rows) {
              return rows.filter(function (r) {
                return r.raw && String(r.raw.parentId) === String(g.officeId) && r.raw.entityStatus && r.raw.entityStatus.id === 300;
              });
            });
          } }],
          onSubmit: function (val) {
            return F.post("/groups/" + encodeURIComponent(g.id) + "?command=associateClients", { clientMembers: [Number(val.clientId)] });
          }
        });
        if (v) { api.toast("Member added", "success"); await paintPanel(); }
        return;
      }
      var data = await F.get("/groups?officeId=" + encodeURIComponent(g.officeId) + "&orphansOnly=true&paged=true&limit=200");
      var free = (data.pageItems || (Array.isArray(data) ? data : [])).filter(function (x) { return statusId(x) !== 600 && !x.centerId && !x.centerName; });
      if (!free.length) throw new Error("There are no groups in " + (g.officeName || "this office") + " without a centre. Create a group first.");
      var cv = await api.openDialog({
        title: "Add group to " + g.name, submitLabel: "Add group",
        fields: [{ key: "groupId", label: "Group", type: "select", required: true, placeholder: "— Select group —", options: opts(free) }],
        onSubmit: function (val) {
          return F.post("/centers/" + encodeURIComponent(g.id) + "?command=associateGroups", { groupMembers: [Number(val.groupId)] });
        }
      });
      if (cv) { api.toast("Group added to centre", "success"); await paintPanel(); }
    });
    var membersTable = $("gc-members");
    if (membersTable) membersTable.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-remove]");
      if (!b || b.disabled || !selected) return;
      var mid = b.getAttribute("data-remove");
      b.disabled = true;
      api.confirmDialog({
        title: isGroup ? "Remove member from group" : "Remove group from centre", confirmLabel: "Remove",
        lines: [[isGroup ? "Member" : "Group", b.getAttribute("data-name") || ""], [isGroup ? "Group" : "Centre", selected.name || ""]],
        note: isGroup ? "Members with active group loans cannot be removed." : "",
        onConfirm: function () {
          return isGroup
            ? F.post("/groups/" + encodeURIComponent(selected.id) + "?command=disassociateClients", { clientMembers: [Number(mid)] })
            : F.post("/centers/" + encodeURIComponent(selected.id) + "?command=disassociateGroups", { groupMembers: [Number(mid)] });
        }
      }).then(function (ok) { if (ok) { api.toast("Removed", "success"); return paintPanel(); } })
        .catch(fail).then(function () { b.disabled = false; });
    });

    /* Create group / centre */
    on(document.querySelector('[data-action="create-' + noun + '"]'), async function () {
      var offices = await loadOffices();
      if (!offices.length) throw new Error("No offices found.");
      var office0 = defaultOffice(offices);
      var staffFor = async function (officeId) {
        var t = await F.get("/groups/template?officeId=" + encodeURIComponent(officeId)).catch(function () { return {}; });
        return opts(t.staffOptions || [], "displayName");
      };
      var centresFor = async function (officeId) {
        if (!isGroup) return [];
        var d = await F.get("/centers?officeId=" + encodeURIComponent(officeId) + "&paged=true&limit=200").catch(function () { return {}; });
        return opts((d.pageItems || (Array.isArray(d) ? d : [])).filter(function (x) { return statusId(x) === 300; }));
      };
      var initial = await Promise.all([staffFor(office0), centresFor(office0)]);
      var fields = [
        { key: "name", label: isGroup ? "Group name" : "Centre name", required: true },
        { key: "officeId", label: "Office", type: "select", required: true, value: office0, options: opts(offices),
          onChange: async function (value, ctl) {
            var r = await Promise.all([staffFor(value), centresFor(value)]);
            ctl.setOptions("staffId", r[0], "");
            if (isGroup) ctl.setOptions("centerId", r[1], "");
          } },
        { key: "staffId", label: isGroup ? "Loan officer" : "Staff", type: "select", placeholder: "— None —", options: initial[0] },
        isGroup ? { key: "centerId", label: "Centre", type: "select", placeholder: "— No centre —", options: initial[1] } : null,
        { key: "externalId", label: "Reference no.", placeholder: "optional" },
        { key: "activate", label: "Status", type: "select", value: "yes", options: [{ value: "yes", label: "Active now" }, { value: "no", label: "Pending — activate later" }] },
        dateField("Date")
      ].filter(Boolean);
      var created = null;
      var v = await api.openDialog({
        title: isGroup ? "Create group" : "Create centre", submitLabel: "Create", fields: fields,
        onSubmit: async function (val) {
          var body = withDate({ officeId: Number(val.officeId), name: val.name.trim(), active: val.activate === "yes", submittedOnDate: val.date });
          if (val.activate === "yes") body.activationDate = val.date;
          if (val.staffId) body.staffId = Number(val.staffId);
          if (isGroup && val.centerId) body.centerId = Number(val.centerId);
          if (val.externalId.trim()) body.externalId = val.externalId.trim();
          if (!isGroup) body.groupMembers = [];
          created = await F.post(base, body);
        }
      });
      if (v) {
        api.toast(isGroup ? "Group created — add its members below" : "Centre created — add groups below", "success");
        await gList.reset();
        var newId = created && (created.groupId || created.resourceId);
        if (newId) { selected = { id: newId }; await paintPanel(); panel.scrollIntoView({ behavior: "smooth", block: "start" }); }
      }
    });
  }
})();
