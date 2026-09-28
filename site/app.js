(function () {
  "use strict";

  var S = window.STORE || {};
  var PREVIEW = !S.apiBase || !S.googleClientId;
  var SCOPES = "openid email profile https://www.googleapis.com/auth/drive.file";
  var FOLDER_NAME = S.name || "AI Business Toolkit";
  // Columns that hold paragraphs of text: shown wide and wrapped.
  var LONG_COLUMNS = ["Caption", "Email draft", "Body", "Notes", "Hook", "Next action"];
  var MONEY_COLUMNS = ["Amount"];

  var $ = function (id) { return document.getElementById(id); };
  var state = { tools: [], samples: {}, tool: null, token: null, me: null, result: null, tokenClient: null,
                prompts: null, sample: null };

  // ------------------------------------------------------------ helpers

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem(key) || "null");
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 5000);
  }

  function show(view) {
    ["viewSignIn", "viewSubscribe", "viewApp"].forEach(function (v) { $(v).hidden = v !== view; });
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  var ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    handshake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
  };

  // ------------------------------------------------------------ API

  function api(path, opts) {
    opts = opts || {};
    return fetch(S.apiBase.replace(/\/$/, "") + path, {
      method: opts.method || "GET",
      headers: { authorization: "Bearer " + state.token.access_token, "content-type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { signOut(); throw new Error(data.error || "Please sign in again."); }
        if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        return data;
      });
    });
  }

  // ------------------------------------------------------------ auth

  function initGoogle() {
    if (state.tokenClient || !window.google || !google.accounts) return !!state.tokenClient;
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: S.googleClientId,
      scope: SCOPES,
      callback: function (resp) {
        if (resp.error) { toast("Google sign-in was cancelled."); return; }
        state.token = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in - 60) * 1000 };
        store("gtoken", state.token);
        if (state.pending) { var p = state.pending; state.pending = null; p(); } else loadAccount();
      },
    });
    return true;
  }

  function signIn(then) {
    if (!initGoogle()) { toast("Google sign-in is still loading. Try again in a second."); return; }
    state.pending = then || null;
    state.tokenClient.requestAccessToken({ prompt: state.token ? "" : "select_account" });
  }

  function tokenValid() { return state.token && state.token.expires_at > Date.now(); }

  // Run fn with a valid token, refreshing it first if it has expired.
  function withToken(fn) { if (tokenValid()) fn(); else signIn(fn); }

  function signOut() {
    if (state.token && window.google && google.accounts) google.accounts.oauth2.revoke(state.token.access_token, function () {});
    state.token = null; state.me = null; store("gtoken", null);
    $("menu").hidden = true; $("usage").hidden = true; $("dropdown").hidden = true;
    show("viewSignIn");
  }

  function loadAccount() {
    api("/api/me").then(function (me) {
      state.me = me;
      renderAccount();
      show(me.subscribed ? "viewApp" : "viewSubscribe");
    }).catch(function (e) { toast(e.message); });
  }

  function renderAccount() {
    var me = state.me;
    $("menu").hidden = false;
    $("avatar").textContent = me.email.charAt(0).toUpperCase();
    $("who").textContent = me.email;
    $("subEmail").textContent = me.email;
    var url = S.subscribeUrl || "#";
    if (S.subscribeUrl) url += (url.indexOf("?") < 0 ? "?" : "&") + "prefilled_email=" + encodeURIComponent(me.email);
    $("subscribeBtn").href = url;
    renderUsage();
  }

  function renderUsage() {
    var me = state.me;
    if (!me || !me.subscribed) { $("usage").hidden = true; return; }
    $("usage").hidden = false;
    $("usageText").textContent = me.used + " / " + me.limit + " runs this month";
    $("meterBar").style.width = Math.min(100, (100 * me.used) / me.limit) + "%";
  }

  // ------------------------------------------------------------ tools UI

  function renderToolList() {
    var list = $("toolList");
    list.innerHTML = "";
    state.tools.forEach(function (t) {
      var b = el("button", { class: "tool", type: "button", role: "tab", "aria-selected": "false", "data-id": t.id }, [
        el("span", { class: "ic", html: ICONS[t.icon] || "" }),
        el("div", {}, [el("b", { text: t.name }), el("span", { text: t.tagline })]),
      ]);
      b.addEventListener("click", function () { selectTool(t.id); });
      list.appendChild(b);
    });
  }

  function selectTool(id) {
    var t = state.tools.filter(function (x) { return x.id === id; })[0] || state.tools[0];
    state.tool = t;
    try { localStorage.setItem("lastTool", t.id); } catch (e) {}
    document.querySelectorAll(".tool").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.id === t.id)); });
    $("toolName").textContent = t.name;
    $("toolTagline").textContent = t.tagline;
    renderForm(t);
    $("result").hidden = true;
  }

  function renderForm(t) {
    var form = $("toolForm");
    form.innerHTML = "";
    var draft = store("draft:" + t.id) || {};
    t.fields.forEach(function (f) {
      var id = "f_" + f.id, input;
      var label = el("label", { for: id, text: f.label });
      if (!f.required) label.appendChild(el("em", { text: " (optional)" }));
      var value = draft[f.id] != null ? draft[f.id] : f.default;
      if (f.type === "textarea") {
        input = el("textarea", { id: id, name: f.id, rows: String(f.rows || 3), placeholder: f.placeholder || "" });
        if (value) input.value = value;
      } else if (f.type === "select") {
        input = el("select", { id: id, name: f.id });
        f.options.forEach(function (o) { var op = el("option", { value: o, text: o }); if (o === value) op.selected = true; input.appendChild(op); });
      } else if (f.type === "multi") {
        input = el("div", { class: "chips", role: "group", "aria-label": f.label });
        var chosen = Array.isArray(value) ? value : [];
        f.options.forEach(function (o) {
          var cb = el("input", { type: "checkbox", name: f.id, value: o });
          if (chosen.indexOf(o) >= 0) cb.checked = true;
          input.appendChild(el("label", {}, [cb, el("span", { text: o })]));
        });
        label = el("label", { text: f.label });
      } else {
        input = el("input", { id: id, name: f.id, type: f.type === "number" ? "number" : f.type === "date" ? "date" : "text", placeholder: f.placeholder || "" });
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        if (f.type === "date" && !value) value = new Date().toISOString().slice(0, 10);
        if (value != null) input.value = value;
      }
      var wide = f.type === "textarea" || f.type === "multi";
      form.appendChild(el("div", { class: "field" + (wide ? " full" : "") }, [label, input]));
    });
    var submit = el("button", { class: "btn", type: "submit", id: "runBtn", text: "Generate with AI" });
    form.appendChild(el("div", { class: "actions" }, [submit, el("span", { class: "hint", text: "Uses 1 AI run" })]));
    form.appendChild(el("div", { class: "field full" }, [el("div", { class: "error", id: "formError", hidden: "" })]));
  }

  function readForm(t) {
    var form = $("toolForm"), out = {};
    t.fields.forEach(function (f) {
      if (f.type === "multi") {
        out[f.id] = Array.prototype.map.call(form.querySelectorAll('input[name="' + f.id + '"]:checked'), function (c) { return c.value; });
      } else {
        out[f.id] = form.elements[f.id].value.trim();
      }
    });
    return out;
  }

  function validate(t, inputs) {
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i], v = inputs[f.id];
      var empty = Array.isArray(v) ? v.length === 0 : !v;
      if (f.required && empty) return 'Please fill in "' + f.label + '".';
      if (f.type === "number" && v !== "") {
        var n = Number(v);
        if (!Number.isInteger(n) || n < f.min || n > f.max) return '"' + f.label + '" must be from ' + f.min + " to " + f.max + ".";
      }
    }
    return null;
  }

  function run(e) {
    e.preventDefault();
    var t = state.tool, inputs = readForm(t), err = validate(t, inputs);
    var box = $("formError");
    box.hidden = !err; box.textContent = err || "";
    if (err) return;
    store("draft:" + t.id, inputs);

    $("runBtn").disabled = true;
    $("result").hidden = true;
    $("working").hidden = false;
    $("workingTitle").textContent = "Working on your " + t.name.toLowerCase() + "…";
    $("working").scrollIntoView({ behavior: "smooth", block: "nearest" });

    var done = function () { $("runBtn").disabled = false; $("working").hidden = true; };
    $("workingText").textContent = PREVIEW && state.sample ? "Claude is thinking. This usually takes 20–90 seconds." : "This usually takes 20–60 seconds.";
    var job = PREVIEW && state.sample && state.prompts
      ? runLive(t, inputs)
      : PREVIEW
      ? new Promise(function (r) { setTimeout(function () { r(state.samples[t.id]); }, 1200); })
      : new Promise(function (resolve, reject) {
          withToken(function () {
            api("/api/run", { method: "POST", body: { toolId: t.id, inputs: inputs } }).then(resolve, reject);
          });
        });
    job.then(function (res) {
      done();
      if (res.used != null) { state.me.used = res.used; state.me.limit = res.limit; renderUsage(); }
      showResult(res);
    }).catch(function (ex) {
      done();
      box.hidden = false; box.textContent = ex.message;
    });
  }

  function showResult(res) {
    state.result = res;
    $("resultTitle").textContent = res.title;
    $("resultCount").textContent = res.rows.length + " rows · " + state.tool.name;
    $("saved").hidden = true;
    $("driveBtn").disabled = false;
    $("driveLabel").textContent = "Save to Google Drive";
    var table = $("resultTable");
    table.innerHTML = "";
    var long = res.columns.map(function (c) { return LONG_COLUMNS.indexOf(c) >= 0; });
    table.appendChild(el("thead", {}, [el("tr", {}, res.columns.map(function (c) { return el("th", { text: c }); }))]));
    table.appendChild(el("tbody", {}, res.rows.map(function (r) {
      return el("tr", {}, r.map(function (v, i) { return el("td", { class: long[i] ? "long" : "", text: v }); }));
    })));
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ live preview (claude.ai artifact only)
  // In a private claude.ai preview the page can ask Claude directly on the viewer's
  // own account, so the tools produce real results before the API server exists.

  var LIVE_OFF = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];

  function liveBrief(t, inputs) {
    return t.fields.map(function (f) {
      var v = inputs[f.id];
      v = Array.isArray(v) ? v.join(", ") : v;
      return v ? f.label + "\n" + v : "";
    }).filter(Boolean).join("\n\n");
  }

  function runLive(t, inputs) {
    var p = state.prompts[t.id];
    var shape = "{\"title\": string (under 60 characters), \"rows\": [ {" +
      p.columns.map(function (c) { return JSON.stringify(c) + ": string"; }).join(", ") + "} ]}";
    var prompt = p.system + "\n\nToday is " + new Date().toISOString().slice(0, 10) + ".\n\n" +
      "Here is the brief:\n\n" + liveBrief(t, inputs) + "\n\n" +
      "Reply with only a JSON object of this shape, with every value a string:\n" + shape;
    var marker = JSON.stringify(p.columns[0]) + ":";
    return state.sample.json(prompt, {
      cache: false,
      onText: function (u) {
        var n = u.text.split(marker).length - 1;
        $("workingText").textContent = n ? "Writing row " + n + "…" : "Writing…";
      },
    }).then(function (data) {
      var rows = (data && data.rows) || [];
      return {
        title: String((data && data.title) || t.name),
        columns: p.columns,
        rows: rows.map(function (r) { return p.columns.map(function (c) { return String(r[c] == null ? "" : r[c]); }); }),
      };
    }, function (e) {
      if (LIVE_OFF.indexOf(e.code) >= 0) {
        state.sample = null;
        setPreviewBanner();
        toast("Live AI isn't available here, so this shows a sample result.");
        return state.samples[t.id];
      }
      var msg = {
        rate_limited: "You've hit your Claude usage limit for now. Try again later.",
        invalid_json: "The AI's answer didn't come back complete. Try again, or ask for fewer rows.",
        refused: "The AI couldn't help with that request. Try rephrasing it.",
        prompt_too_large: "That's too much text for one run. Try pasting less.",
        session_expired: "Your claude.ai session expired. Refresh the page and sign in.",
      }[e.code] || "Something went wrong. Please try again.";
      throw new Error(msg);
    });
  }

  function setPreviewBanner() {
    var b = $("previewBanner").firstElementChild;
    b.innerHTML = state.sample && state.prompts
      ? "<strong>Preview mode, live AI.</strong> Results are generated by Claude on your claude.ai account. Saving to Google Drive and billing aren't connected yet."
      : "<strong>Preview mode.</strong> Sign-in, billing and AI aren't connected yet, so the tools show sample results. See the README's go-live setup.";
  }

  // ------------------------------------------------------------ exports

  function downloadCsv() {
    var r = state.result;
    var esc = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [r.columns].concat(r.rows).map(function (row) { return row.map(esc).join(","); }).join("\r\n");
    var a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: r.title.replace(/[^\w\- ]+/g, "") + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
  }

  function google_(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { authorization: "Bearer " + state.token.access_token, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data.error && data.error.message) || "Google Drive request failed.");
        return data;
      });
    });
  }

  function ensureFolder() {
    var q = "name='" + FOLDER_NAME.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    return google_("GET", "https://www.googleapis.com/drive/v3/files?fields=files(id)&q=" + encodeURIComponent(q)).then(function (d) {
      if (d.files && d.files.length) return d.files[0].id;
      return google_("POST", "https://www.googleapis.com/drive/v3/files?fields=id", { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
        .then(function (f) { return f.id; });
    });
  }

  // Sheets API requests that write the table and format it.
  function sheetRequests(r) {
    var hex = function (h) { return { red: parseInt(h.substr(1, 2), 16) / 255, green: parseInt(h.substr(3, 2), 16) / 255, blue: parseInt(h.substr(5, 2), 16) / 255 }; };
    var nCols = r.columns.length, nRows = r.rows.length + 1;
    var header = { values: r.columns.map(function (c) {
      return { userEnteredValue: { stringValue: c }, userEnteredFormat: {
        textFormat: { bold: true, foregroundColor: hex("#ffffff"), fontSize: 10 }, verticalAlignment: "MIDDLE", padding: { top: 6, bottom: 6, left: 6, right: 6 } } };
    }) };
    var body = r.rows.map(function (row) {
      return { values: row.map(function (v, i) {
        var money = MONEY_COLUMNS.indexOf(r.columns[i]) >= 0 && v !== "" && !isNaN(Number(String(v).replace(/,/g, "")));
        return {
          userEnteredValue: money ? { numberValue: Number(String(v).replace(/,/g, "")) } : { stringValue: v },
          userEnteredFormat: {
            wrapStrategy: "WRAP", verticalAlignment: "TOP", padding: { top: 4, bottom: 4, left: 6, right: 6 },
            numberFormat: money ? { type: "NUMBER", pattern: "#,##0.00;[Red]-#,##0.00" } : undefined,
          },
        };
      }) };
    });
    var reqs = [
      { updateSheetProperties: { properties: { sheetId: 0, title: "Results", gridProperties: { frozenRowCount: 1 } }, fields: "title,gridProperties.frozenRowCount" } },
      { updateCells: { start: { sheetId: 0, rowIndex: 0, columnIndex: 0 }, rows: [header].concat(body), fields: "userEnteredValue,userEnteredFormat" } },
      { updateDimensionProperties: { range: { sheetId: 0, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
      { addBanding: { bandedRange: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: nRows, startColumnIndex: 0, endColumnIndex: nCols },
          rowProperties: { headerColor: hex("#4f46e5"), firstBandColor: hex("#ffffff"), secondBandColor: hex("#f5f6ff") } } } },
      { setBasicFilter: { filter: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: nRows, startColumnIndex: 0, endColumnIndex: nCols } } } },
    ];
    r.columns.forEach(function (c, i) {
      var width = LONG_COLUMNS.indexOf(c) >= 0 ? 380 : c.length <= 6 || /date|day|priority|type|email$/i.test(c) ? 115 : 170;
      reqs.push({ updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: width }, fields: "pixelSize" } });
    });
    return reqs;
  }

  function saveToDrive() {
    if (PREVIEW) { toast("Preview mode: saving to Google Drive works once Google sign-in is connected."); return; }
    var r = state.result, btn = $("driveBtn");
    btn.disabled = true;
    $("driveLabel").textContent = "Saving…";
    withToken(function () {
      ensureFolder().then(function (folderId) {
        return google_("POST", "https://www.googleapis.com/drive/v3/files?fields=id", {
          name: r.title, mimeType: "application/vnd.google-apps.spreadsheet", parents: [folderId],
        });
      }).then(function (file) {
        return google_("POST", "https://sheets.googleapis.com/v4/spreadsheets/" + file.id + ":batchUpdate", { requests: sheetRequests(r) })
          .then(function () { return file.id; });
      }).then(function (id) {
        $("sheetLink").href = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
        $("saved").hidden = false;
        $("driveLabel").textContent = "Saved";
      }).catch(function (e) {
        btn.disabled = false;
        $("driveLabel").textContent = "Save to Google Drive";
        toast("Couldn't save to Drive: " + e.message);
      });
    });
  }

  // ------------------------------------------------------------ boot

  function boot() {
    document.querySelectorAll("[data-store-name]").forEach(function (n) { if (S.name) n.textContent = S.name; });
    document.querySelectorAll("[data-price]").forEach(function (n) { n.textContent = S.price; });
    document.querySelectorAll("[data-runs]").forEach(function (n) { n.textContent = S.runsPerMonth; });

    $("toolForm").addEventListener("submit", run);
    $("csvBtn").addEventListener("click", downloadCsv);
    $("driveBtn").addEventListener("click", saveToDrive);
    $("signInBtn").addEventListener("click", function () { signIn(); });
    $("signOutBtn").addEventListener("click", signOut);
    $("recheckBtn").addEventListener("click", function (e) { e.preventDefault(); withToken(loadAccount); });
    $("subscribeBtn").addEventListener("click", function (e) {
      if (!S.subscribeUrl) { e.preventDefault(); toast("Subscriptions aren't connected yet."); }
    });
    $("avatar").addEventListener("click", function () {
      var d = $("dropdown"); d.hidden = !d.hidden; $("avatar").setAttribute("aria-expanded", String(!d.hidden));
    });
    document.addEventListener("click", function (e) { if (!$("menu").contains(e.target)) $("dropdown").hidden = true; });
    $("manageBtn").addEventListener("click", function () {
      if (PREVIEW) { toast("Preview mode: billing isn't connected yet."); return; }
      withToken(function () {
        api("/api/portal", { method: "POST" }).then(function (d) { location.href = d.url; }).catch(function (e) { toast(e.message); });
      });
    });

    Promise.all([
      fetch("tools.json").then(function (r) { return r.json(); }),
      PREVIEW ? fetch("samples.json").then(function (r) { return r.json(); }) : Promise.resolve({}),
      // prompts.json is only published with the claude.ai preview, never to the public site.
      PREVIEW ? fetch("prompts.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : null,
    ]).then(function (res) {
      state.tools = res[0].tools;
      state.samples = res[1];
      state.prompts = res[2];
      if (PREVIEW && state.prompts && window.claude && window.claude.use) {
        window.claude.use("sample").then(function (fn) { state.sample = fn; setPreviewBanner(); });
      }
      renderToolList();
      var last = null;
      try { last = localStorage.getItem("lastTool"); } catch (e) {}
      selectTool(last);

      if (PREVIEW) {
        $("previewBanner").hidden = false;
        state.me = { email: "preview@example.com", subscribed: true, used: 12, limit: S.runsPerMonth };
        renderAccount();
        show("viewApp");
        return;
      }
      state.token = store("gtoken");
      if (tokenValid()) loadAccount();
      else { state.token = null; show("viewSignIn"); }
    }).catch(function () { toast("Couldn't load the app. Please refresh."); });
  }

  boot();
})();
