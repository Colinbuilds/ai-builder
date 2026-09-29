// JobReceipts app UI. Runs in the Apps Script web app (api = google.script.run wrapper)
// and in the build preview (api = sample-data stand-in). Uses the shared core functions
// (priceReceipt, buildCustomerDocument, renderDocumentHtml, qboPlan, formatMoney).
(function (root) {
  "use strict";

  var STATUS_TEXT = {
    reading: ["reading", "Reading…"],
    needs_review: ["review", "Needs review"],
    ready: ["ready", "Ready to approve"],
    approved: ["approved", "Approved"],
    error: ["error", "Problem"],
  };
  var ACTION_TEXT = { change_order: "Change order", invoice: "Invoice" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function money(n) { return n == null || n === "" ? "—" : formatMoney(n); }
  function shortDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function pill(r) {
    var s = STATUS_TEXT[r.status] || ["review", r.status];
    var text = r.status === "approved" && r.action ? "Approved · " + (ACTION_TEXT[r.action] || r.action) : s[1];
    return '<span class="jr-pill ' + s[0] + '">' + esc(text) + "</span>";
  }
  function paperHtml(x) {
    if (!x) return "";
    var h = '<div class="jr-paper"><div class="v">' + esc(String(x.vendor || "").toUpperCase()) + '</div><div class="v">' + esc(x.date || "") +
      (x.receiptNumber ? " · #" + esc(x.receiptNumber) : "") + "</div><hr>";
    (x.items || []).forEach(function (it) {
      h += '<div class="it"><span>' + esc((it.qty || 1) + " " + (it.unit || "") + " " + it.description) + "</span><span>" + Number(it.lineTotal || 0).toFixed(2) + "</span></div>";
    });
    return h + '<hr><div class="it"><span>SUBTOTAL</span><span>' + Number(x.subtotal || 0).toFixed(2) + '</span></div><div class="it"><span>TAX</span><span>' +
      Number(x.tax || 0).toFixed(2) + '</span></div><div class="it"><b>TOTAL</b><b>' + Number(x.total || 0).toFixed(2) + "</b></div></div>";
  }

  /** Resize photos to at most 1800px JPEG so uploads are fast and fit the AI's image limits. */
  function readFileForUpload(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Couldn't read that file. Try taking the photo again.")); };
      reader.onload = function () {
        var dataUrl = reader.result;
        if (file.type === "application/pdf") {
          if (file.size > 10 * 1024 * 1024) return reject(new Error("That PDF is over 10 MB. Send a smaller file."));
          return resolve({ base64: dataUrl.split(",")[1], mimeType: "application/pdf", fileName: file.name, previewUrl: "" });
        }
        var img = new Image();
        img.onerror = function () { reject(new Error("That image type can't be opened here. On iPhone, set Camera → Formats → Most Compatible.")); };
        img.onload = function () {
          var scale = Math.min(1, 1800 / Math.max(img.width, img.height));
          var c = document.createElement("canvas");
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL("image/jpeg", 0.85);
          resolve({ base64: out.split(",")[1], mimeType: "image/jpeg", fileName: (file.name || "receipt").replace(/\.\w+$/, "") + ".jpg", previewUrl: out });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function mount(el, opts) {
    var api = opts.api;
    var S = {
      boot: null,
      view: opts.view || null,
      selectedId: opts.selectedId || null,
      form: Object.assign({ jobQuery: "", jobId: "", file: null, suggestedAction: "", note: "", sending: false, message: "" }, opts.preset || {}),
      drafts: {},
      files: {},
      settings: null,
      filter: { status: "", q: "" },
      busy: false,
    };

    function toast(msg) {
      var t = el.querySelector(".jr-toast");
      if (!t) { t = document.createElement("div"); t.className = "jr-toast"; t.setAttribute("role", "status"); el.querySelector(".jr").appendChild(t); } // outside the re-rendered area
      t.textContent = msg; t.hidden = false;
      clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4500);
    }

    function appRoot() { return el.querySelector(".jr-app"); }
    function receipts() { return S.boot ? S.boot.receipts : []; }
    function byId(id) { return receipts().filter(function (r) { return r.id === id; })[0]; }
    function job(id) { return (S.boot.jobs || []).filter(function (j) { return j.id === id; })[0]; }

    function draftFor(r) {
      if (!S.drafts[r.id]) {
        S.drafts[r.id] = {
          jobId: r.jobId || "",
          markup: r.markupPercent != null ? r.markupPercent : S.boot.defaultMarkup,
          action: r.action || r.suggestedAction || "",
          description: "", reason: r.note || "", contractPrice: "", projectManager: "",
          items: JSON.parse(JSON.stringify((r.extracted && r.extracted.items) || [])),
          tax: r.extracted ? r.extracted.tax : 0,
          dirty: false,
        };
      }
      return S.drafts[r.id];
    }

    function pricedFor(r, d) {
      return priceReceipt({ vendor: r.extracted && r.extracted.vendor, items: d.items, tax: d.tax }, { markupPercent: Number(d.markup) || 0 });
    }

    // ---------------------------------------------------------------- views

    function renderShell() {
      var admin = S.boot.admin;
      var tabs = admin
        ? [["review", "Review", receipts().filter(function (r) { return r.status === "needs_review" || r.status === "ready" || r.status === "error"; }).length],
           ["all", "All receipts"], ["jobs", "Jobs"], ["new", "Add receipt"], ["settings", "Settings"]]
        : [["new", "Add receipt"], ["mine", "My receipts"]];
      if (!S.view) S.view = admin ? "review" : "new";
      var html = '<header class="jr-bar"><div class="jr-logo">Job<span>Receipts</span></div><div class="jr-spacer"></div>' +
        (admin ? '<span class="jr-role">Admin</span>' : "") + '<span class="jr-who">' + esc(S.boot.user) + "</span></header>";
      html += '<nav class="jr-tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="jr-tab" role="tab" id="tab-' + t[0] + '" data-act="tab" data-view="' + t[0] + '" aria-selected="' + (S.view === t[0]) + '">' +
          esc(t[1]) + (t[2] ? '<span class="jr-count">' + t[2] + "</span>" : "") + "</button>";
      }).join("") + "</nav>";
      html += '<main class="jr-main" id="jr-main"></main>';
      appRoot().innerHTML = html;
      renderView();
    }

    function renderView() {
      var main = el.querySelector("#jr-main");
      el.querySelectorAll(".jr-tab").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.view === S.view)); });
      if (S.view === "new") main.innerHTML = viewNew() + (S.boot.admin ? "" : viewMine(true));
      else if (S.view === "mine") main.innerHTML = viewMine(false);
      else if (S.view === "review") main.innerHTML = viewReview(true);
      else if (S.view === "all") main.innerHTML = viewReview(false);
      else if (S.view === "jobs") main.innerHTML = viewJobs();
      else if (S.view === "settings") main.innerHTML = viewSettings();
      afterRender();
    }

    function viewNew() {
      var f = S.form;
      var chosen = f.jobId && job(f.jobId);
      var h = '<section class="jr-card" aria-labelledby="new-h"><h2 id="new-h">Add a receipt</h2>';
      h += '<div class="jr-field"><span>1. Job</span>';
      if (chosen) {
        h += '<div class="jr-chip"><span>' + esc(chosen.name) + '</span><button type="button" data-act="clear-job">Change</button></div>';
      } else {
        h += '<input type="search" id="job-search" placeholder="Search by name or address" autocomplete="off" value="' + esc(f.jobQuery) + '">';
        var jobs = (S.boot.jobs || []).map(function (j) { return { job: j, score: f.jobQuery ? scoreJob(f.jobQuery, j.name) : 0 }; });
        if (f.jobQuery) jobs = jobs.filter(function (x) { return x.score > 0 || x.job.name.toLowerCase().indexOf(f.jobQuery.toLowerCase()) >= 0; })
          .sort(function (a, b) { return b.score - a.score; });
        h += '<div class="jr-joblist" role="listbox" aria-label="Jobs">' + (jobs.slice(0, 6).map(function (x) {
          return '<button type="button" class="jr-job" role="option" aria-selected="false" data-act="pick-job" data-id="' + esc(x.job.id) + '">' + esc(x.job.name) + "</button>";
        }).join("") || '<div class="jr-empty">No job matches that. Check the spelling or ask the office.</div>') + "</div>";
      }
      h += "</div>";
      h += '<div class="jr-field"><span>2. Receipt photo</span>';
      if (f.file) {
        h += (f.file.previewUrl ? '<img class="jr-thumb" alt="Receipt photo" src="' + f.file.previewUrl + '">' : '<div class="jr-chip"><span>' + esc(f.file.fileName) + "</span></div>") +
          '<button type="button" class="jr-btn secondary" data-act="clear-file">Retake</button>';
      } else {
        h += '<label class="jr-photo" for="receipt-file"><strong>Take a photo</strong>or choose a picture or PDF<input type="file" id="receipt-file" accept="image/*,application/pdf" capture="environment"></label>';
      }
      h += "</div>";
      h += '<div class="jr-field"><span>3. What is it for?</span><div class="jr-seg" role="radiogroup">' +
        [["invoice", "Regular job materials"], ["change_order", "Extra work (change order)"], ["", "Not sure"]].map(function (o, i) {
          return '<label class="jr-opt"><input type="radio" name="kind" id="kind-' + i + '" value="' + o[0] + '"' + (f.suggestedAction === o[0] ? " checked" : "") + ">" + esc(o[1]) + "</label>";
        }).join("") + "</div></div>";
      h += '<label class="jr-field" for="receipt-note"><span>Note for the office <span class="jr-hint">(optional)</span></span><textarea id="receipt-note" placeholder="e.g. rotted decking on back slope, customer approved">' + esc(f.note) + "</textarea></label>";
      if (f.message) h += '<div class="' + (f.messageKind === "ok" ? "jr-ok" : "jr-err") + '" role="status">' + esc(f.message) + "</div>";
      h += '<button type="button" class="jr-btn block" data-act="send" ' + (f.sending || !f.jobId || !f.file ? "disabled" : "") + ">" +
        (f.sending ? "Reading receipt…" : "Send receipt") + "</button>";
      h += '<p class="jr-hint">The office sees the receipt right away. Keep the paper copy until it shows Approved.</p></section>';
      return h;
    }

    function viewMine(compact) {
      var list = receipts();
      var h = '<section class="jr-card" aria-labelledby="mine-h"><h2 id="mine-h">My receipts</h2>';
      if (!list.length) return h + '<div class="jr-empty">Receipts you send will show up here.</div></section>';
      h += '<div class="jr-list">' + list.slice(0, compact ? 8 : 200).map(function (r) {
        return '<div class="jr-item"><div><div class="t">' + esc(r.vendor || "Receipt") + " · " + money(r.total) + '</div><div class="s">' + esc(r.jobName || "No job") +
          " · " + esc(shortDate(r.createdAt)) + (r.error ? '<br><span style="color:var(--bad)">' + esc(r.error) + "</span>" : "") + '</div></div><div class="r">' + pill(r) + "</div></div>";
      }).join("") + "</div></section>";
      return h;
    }

    function listRows(list) {
      return list.map(function (r) {
        var x = r.extracted || {};
        return '<button type="button" class="jr-item" data-act="select" data-id="' + esc(r.id) + '" aria-selected="' + (S.selectedId === r.id) + '"><div><div class="t">' +
          esc(x.vendor || "Receipt") + " · " + money(x.total) + '</div><div class="s">' + esc(r.jobName || "Job not confirmed") + "<br>" +
          esc(r.employee || r.uploadedBy) + " · " + esc(shortDate(r.createdAt)) + '</div></div><div class="r">' + pill(r) +
          (r.billed != null ? '<span class="s num">' + money(r.billed) + "</span>" : "") + "</div></button>";
      }).join("");
    }

    function viewReview(queueOnly) {
      var list = receipts();
      if (queueOnly) list = list.filter(function (r) { return r.status !== "approved"; });
      else {
        if (S.filter.status) list = list.filter(function (r) { return r.status === S.filter.status; });
        if (S.filter.q) {
          var q = S.filter.q.toLowerCase();
          list = list.filter(function (r) {
            return [r.jobName, r.employee, r.uploadedBy, r.extracted && r.extracted.vendor].join(" ").toLowerCase().indexOf(q) >= 0;
          });
        }
      }
      if (!S.selectedId || !list.some(function (r) { return r.id === S.selectedId; })) S.selectedId = list[0] ? list[0].id : null;
      var h = '<div class="jr-split"><section class="jr-card" aria-label="Receipts">';
      if (!queueOnly) {
        h += '<div class="jr-row"><input type="search" id="filter-q" placeholder="Job, employee or vendor" value="' + esc(S.filter.q) + '">' +
          '<select id="filter-status"><option value="">All statuses</option>' + Object.keys(STATUS_TEXT).map(function (k) {
            return '<option value="' + k + '"' + (S.filter.status === k ? " selected" : "") + ">" + STATUS_TEXT[k][1] + "</option>";
          }).join("") + "</select></div>";
      }
      h += list.length ? '<div class="jr-list">' + listRows(list) + "</div>"
        : '<div class="jr-empty">' + (queueOnly ? "Nothing waiting. New receipts appear here as employees send them." : "No receipts match.") + "</div>";
      h += "</section>";
      h += '<div id="jr-detail">' + (S.selectedId ? viewDetail(byId(S.selectedId)) : "") + "</div></div>";
      return h;
    }

    function viewDetail(r) {
      if (!r) return "";
      var x = r.extracted;
      var h = '<section class="jr-card" aria-labelledby="det-h"><div class="jr-row" style="align-items:center"><h2 id="det-h" style="flex:2 1 240px">' +
        esc((x && x.vendor) || "Receipt") + " · " + money(x && x.total) + '</h2><div style="flex:0 0 auto">' + pill(r) + "</div></div>";
      h += '<p class="jr-hint">' + esc("Uploaded by " + (r.employee || r.uploadedBy)) + " · " + esc(shortDate(r.createdAt)) +
        (r.note ? " · Note: “" + esc(r.note) + "”" : "") + "</p>";
      if (r.status === "error") {
        h += '<div class="jr-err">' + esc(r.error || "Something went wrong reading this receipt.") + '</div><div class="jr-actions"><button type="button" class="jr-btn" data-act="retry" data-id="' + esc(r.id) + '">Read it again</button></div></section>';
        return h;
      }
      if (r.status === "reading" || !x) return h + '<div class="jr-ok">Reading the receipt…</div></section>';
      var d = draftFor(r);
      var priced = pricedFor(r, d);
      var approved = r.status === "approved";

      h += '<div class="jr-detail-grid"><div id="jr-file">' + (S.files[r.id] ? fileHtml(S.files[r.id], x) : paperHtml(x)) + "</div><div style=\"display:flex;flex-direction:column;gap:12px;min-width:0\">";
      var flags = (x.flags || []).slice();
      if (r.match && !r.match.confident && !d.jobId) flags.unshift("Pick the job before approving.");
      h += flags.length ? '<div class="jr-flags">' + flags.map(esc).join("<br>") + "</div>" : '<div class="jr-ok">The numbers add up and the job is confirmed.</div>';
      h += '<label class="jr-field" for="d-job"><span>Job folder</span><select id="d-job" ' + (approved ? "disabled" : "") + '><option value="">Pick a job…</option>';
      var suggested = {};
      ((r.match && r.match.candidates) || []).forEach(function (c) { suggested[c.id] = true; });
      (S.boot.jobs || []).forEach(function (j) {
        h += '<option value="' + esc(j.id) + '"' + (d.jobId === j.id ? " selected" : "") + ">" + (suggested[j.id] && d.jobId !== j.id ? "★ " : "") + esc(j.name) + "</option>";
      });
      h += "</select></label>";
      if (r.match && r.match.aiSuggestion) h += '<p class="jr-hint">AI suggestion: ' + esc(r.match.aiSuggestion) + "</p>";
      h += '<div class="jr-row"><label class="jr-field" for="d-markup"><span>Markup %</span><input type="number" id="d-markup" min="0" max="500" step="0.5" value="' + esc(d.markup) + '" ' + (approved ? "disabled" : "") + "></label>" +
        '<div class="jr-field"><span>Bill as</span><div class="jr-seg" role="radiogroup" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
        [["change_order", "Change order"], ["invoice", "Invoice"]].map(function (o) {
          return '<label class="jr-opt"><input type="radio" name="d-action" value="' + o[0] + '"' + (d.action === o[0] ? " checked" : "") + (approved ? " disabled" : "") + ">" + o[1] + "</label>";
        }).join("") + "</div></div></div>";
      h += "</div></div>";

      // Line items (editable before approval)
      h += '<div class="jr-label">Materials · internal pricing</div><div class="jr-tbl"><table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Receipt $</th><th class="n">Cost</th><th class="n">Billed</th><th class="n">Profit</th></tr></thead><tbody>';
      priced.lines.forEach(function (l, i) {
        var it = d.items[i];
        h += "<tr><td>" + (approved ? esc(it.description) : '<input type="text" id="it-desc-' + i + '" data-item="' + i + '" data-field="description" value="' + esc(it.description) + '" aria-label="Item description">') +
          '<div class="jr-hint">' + esc(l.vendor) + '</div></td><td class="n">' + (approved ? esc(it.qty) : '<input type="number" id="it-qty-' + i + '" data-item="' + i + '" data-field="qty" value="' + esc(it.qty) + '" style="width:64px" aria-label="Quantity">') +
          '</td><td class="n">' + (approved ? money(it.lineTotal) : '<input type="number" step="0.01" id="it-amt-' + i + '" data-item="' + i + '" data-field="lineTotal" value="' + esc(it.lineTotal) + '" style="width:96px" aria-label="Receipt amount">') +
          '</td><td class="n num">' + money(l.cost) + '</td><td class="n num">' + money(l.billed) + '</td><td class="n num">' + money(l.profit) + "</td></tr>";
      });
      h += '</tbody><tfoot><tr><td>Tax (counted in cost)</td><td></td><td class="n">' + (approved ? money(d.tax) : '<input type="number" step="0.01" id="d-tax" value="' + esc(d.tax) + '" style="width:96px" aria-label="Tax">') +
        '</td><td class="n num">' + money(priced.totals.cost) + '</td><td class="n num">' + money(priced.totals.billed) + '</td><td class="n num">' + money(priced.totals.profit) + "</td></tr></tfoot></table></div>";
      h += '<div class="jr-totals"><div class="jr-total"><span>Cost</span><strong>' + money(priced.totals.cost) + '</strong></div><div class="jr-total"><span>Markup</span><strong>' + esc(d.markup) +
        '%</strong></div><div class="jr-total"><span>Total billed</span><strong>' + money(priced.totals.billed) + '</strong></div><div class="jr-total profit"><span>Profit · ' + priced.totals.marginPercent +
        '% margin</span><strong>' + money(priced.totals.profit) + "</strong></div></div>";

      if (d.action === "change_order" && !approved) {
        h += '<div class="jr-row"><label class="jr-field" for="d-desc"><span>Description of changes</span><input type="text" id="d-desc" value="' + esc(d.description) + '" placeholder="Additional materials as listed below"></label>' +
          '<label class="jr-field" for="d-pm"><span>Project manager</span><input type="text" id="d-pm" value="' + esc(d.projectManager) + '"></label></div>' +
          '<div class="jr-row"><label class="jr-field" for="d-reason"><span>Reason for change</span><input type="text" id="d-reason" value="' + esc(d.reason) + '"></label>' +
          '<label class="jr-field" for="d-contract"><span>Current contract price <span class="jr-hint">(optional)</span></span><input type="number" step="0.01" id="d-contract" value="' + esc(d.contractPrice) + '"></label></div>';
      }

      h += '<div id="jr-preview" style="display:flex;flex-direction:column;gap:12px">' + previewHtml(r, d, priced, approved) + "</div>";
      if (approved) {
        h += '<div class="jr-ok">Approved as ' + esc(ACTION_TEXT[r.action] || r.action) + (r.docName ? ": " + esc(r.docName) : "") + (r.approvedBy ? " · by " + esc(r.approvedBy) : "") + "</div>";
      } else {
        var priced0 = !(priced.totals.cost > 0);
        var ready = !!(d.jobId && d.action && d.items.length) && !priced0;
        h += '<div class="jr-actions"><button type="button" class="jr-btn" data-act="approve" data-id="' + esc(r.id) + '" ' + (ready && !S.busy ? "" : "disabled") + ">" +
          (S.busy ? "Creating…" : !d.action ? "Choose change order or invoice" : priced0 ? "Type in the costs to approve" :
            d.action === "invoice" ? "Approve & create invoice" : "Approve & create change order") + "</button></div>";
      }
      return h + "</section>";
    }

    /** Customer document preview + QuickBooks plan. Updated on its own while typing so buttons never move under a tap. */
    function previewHtml(r, d, priced, approved) {
      var x = r.extracted, h = "";
      var j = job(d.jobId);
      if (j && d.action) {
        var doc = buildCustomerDocument(d.action, j, priced, {
          number: d.action === "change_order" ? "(next)" : "", date: (x.date || ""), projectManager: d.projectManager,
          description: d.description, reason: d.reason, contractPrice: d.contractPrice === "" ? null : Number(d.contractPrice),
        });
        h += '<details' + (approved ? "" : " open") + '><summary class="jr-label" style="cursor:pointer">What the customer sees</summary><div class="jr-docprev">' +
          renderDocumentHtml(doc, { name: S.boot.company, address: S.boot.companyAddress }) + "</div></details>";
        h += '<div class="jr-label">QuickBooks Online</div>' + qboPlan(d.action, priced, j, {}).map(function (p) {
          return '<div class="jr-qline"><span>' + esc(p.label) + "<small>" + (p.vendor ? "Vendor: " + esc(p.vendor) + " · " : "") + "Customer: " + esc(p.customer) + '</small></span><span class="num">' + money(p.amount) + "</span></div>";
        }).join("");
      }
      return h;
    }

    function fileHtml(f, x) {
      if (f.dataUrl && /^data:image\//.test(f.dataUrl)) return '<img class="jr-img" alt="Receipt" src="' + f.dataUrl + '">';
      if (f.url) return '<a class="jr-btn secondary block" href="' + esc(f.url) + '" target="_blank" rel="noopener">Open the receipt file</a>' + paperHtml(x);
      return paperHtml(x);
    }

    function viewJobs() {
      var by = {};
      receipts().forEach(function (r) {
        if (!r.jobName) return;
        var j = by[r.jobName] || (by[r.jobName] = { name: r.jobName, count: 0, cost: 0, billed: 0, profit: 0, pending: 0 });
        j.count++;
        if (r.status === "approved") { j.cost += r.cost || 0; j.billed += r.billed || 0; j.profit += r.profit || 0; }
        else j.pending += r.cost || 0;
      });
      var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.billed - a.billed; });
      var t = rows.reduce(function (a, j) { a.cost += j.cost; a.billed += j.billed; a.profit += j.profit; a.pending += j.pending; return a; }, { cost: 0, billed: 0, profit: 0, pending: 0 });
      var h = '<section class="jr-card"><h2>Jobs</h2><p class="jr-hint">Approved receipts count toward cost, billed and profit. Pending shows cost still waiting for review.</p>';
      h += '<div class="jr-totals"><div class="jr-total"><span>Cost</span><strong>' + money(t.cost) + '</strong></div><div class="jr-total"><span>Billed</span><strong>' + money(t.billed) +
        '</strong></div><div class="jr-total profit"><span>Profit</span><strong>' + money(t.profit) + '</strong></div><div class="jr-total"><span>Pending cost</span><strong>' + money(t.pending) + "</strong></div></div>";
      h += '<div class="jr-tbl"><table><thead><tr><th>Job</th><th class="n">Receipts</th><th class="n">Cost</th><th class="n">Billed</th><th class="n">Profit</th><th class="n">Pending</th></tr></thead><tbody>' +
        (rows.map(function (j) {
          return "<tr><td>" + esc(j.name) + '</td><td class="n num">' + j.count + '</td><td class="n num">' + money(j.cost) + '</td><td class="n num">' + money(j.billed) +
            '</td><td class="n num">' + money(j.profit) + '</td><td class="n num">' + money(j.pending) + "</td></tr>";
        }).join("") || '<tr><td colspan="6" class="jr-empty">No receipts yet.</td></tr>') + "</tbody></table></div></section>";
      return h;
    }

    function viewSettings() {
      var s = S.settings;
      if (!s) return '<section class="jr-card"><h2>Settings</h2><div class="jr-empty">Loading…</div></section>';
      var q = s.quickbooks;
      var h = '<section class="jr-card"><h2>Connections</h2>';
      h += '<div class="jr-qline"><span>QuickBooks Online<small>' + (q.connected ? "Connected (" + esc(q.environment) + ")" : esc(q.reason || "Not connected")) + "</small></span>" +
        (q.connected ? '<span class="jr-pill approved">Connected</span>' : q.authUrl ? '<a class="jr-btn" href="' + esc(q.authUrl) + '" target="_blank" rel="noopener">Connect QuickBooks</a>' : '<span class="jr-pill review">Needs setup</span>') + "</div>";
      h += '<div class="jr-qline"><span>AI receipt reading<small>' + (s.ai ? "On" : "Add your Anthropic API key in Script properties") + "</small></span>" + (s.ai ? '<span class="jr-pill approved">On</span>' : '<span class="jr-pill review">Off</span>') + "</div>";
      h += '<div class="jr-qline"><span>Change order template<small>' + (s.changeOrderTemplate ? "Using your Google Doc template" : "Using the built-in layout") + "</small></span></div>";
      h += '<p class="jr-hint">Default markup: ' + esc(s.defaultMarkup) + "% · Admins: " + esc(s.admins.join(", ") || "only the person who installed the app") + ". Change these in Script properties.</p></section>";
      return h;
    }

    // ---------------------------------------------------------------- events

    function afterRender() {
      if (S.view === "settings" && !S.settings) {
        api.call("apiSettings").then(function (s) { S.settings = s; renderView(); }, function (e) { toast(e.message); });
      }
      if ((S.view === "review" || S.view === "all") && S.selectedId && !S.files[S.selectedId]) {
        var id = S.selectedId, r = byId(id);
        if (r && r.fileId) api.call("apiReceiptFile", id).then(function (f) { if (f) { S.files[id] = f; var box = el.querySelector("#jr-file"); if (box && S.selectedId === id) box.innerHTML = fileHtml(f, r.extracted); } }, function () {});
      }
    }

    function rerenderDetail() {
      var box = el.querySelector("#jr-detail");
      var active = document.activeElement && document.activeElement.id;
      if (box) box.innerHTML = viewDetail(byId(S.selectedId));
      if (active) { var again = el.querySelector("#" + active); if (again) { again.focus(); if (again.setSelectionRange && again.type === "text") { var n = again.value.length; again.setSelectionRange(n, n); } } }
    }

    el.addEventListener("click", function (e) {
      var t = e.target.closest("[data-act]");
      if (!t || opts.readOnly) return;
      var act = t.dataset.act;
      if (act === "tab") { S.view = t.dataset.view; renderView(); }
      else if (act === "pick-job") { S.form.jobId = t.dataset.id; S.form.message = ""; renderView(); }
      else if (act === "clear-job") { S.form.jobId = ""; renderView(); }
      else if (act === "clear-file") { S.form.file = null; renderView(); }
      else if (act === "select") { S.selectedId = t.dataset.id; renderView(); }
      else if (act === "send") send();
      else if (act === "approve") approve(t.dataset.id);
      else if (act === "retry") retry(t.dataset.id);
    });

    el.addEventListener("input", function (e) {
      if (opts.readOnly) return;
      var t = e.target;
      if (t.id === "job-search") {
        S.form.jobQuery = t.value;
        var main = el.querySelector("#jr-main");
        var pos = t.selectionStart;
        main.innerHTML = viewNew() + (S.boot.admin ? "" : viewMine(true));
        var s2 = el.querySelector("#job-search"); s2.focus(); s2.setSelectionRange(pos, pos);
        return;
      }
      if (t.id === "receipt-note") { S.form.note = t.value; return; }
      if (t.id === "filter-q") { S.filter.q = t.value; var p = t.selectionStart; renderView(); var f = el.querySelector("#filter-q"); f.focus(); f.setSelectionRange(p, p); return; }
      var r = byId(S.selectedId);
      if (!r) return;
      var d = draftFor(r);
      if (t.dataset.item != null) {
        var it = d.items[Number(t.dataset.item)];
        it[t.dataset.field] = t.dataset.field === "description" ? t.value : Number(t.value);
        d.dirty = true;
        if (t.dataset.field !== "description") rerenderDetail();
        return;
      }
      if (t.id === "d-markup") { d.markup = t.value; rerenderDetail(); }
      else if (t.id === "d-tax") { d.tax = Number(t.value); d.dirty = true; rerenderDetail(); }
      else if (/^d-(desc|reason|pm|contract)$/.test(t.id)) {
        var key = { "d-desc": "description", "d-reason": "reason", "d-pm": "projectManager", "d-contract": "contractPrice" }[t.id];
        d[key] = t.value;
        var pv = el.querySelector("#jr-preview");
        if (pv) pv.innerHTML = previewHtml(r, d, pricedFor(r, d), false);
      }
    });

    el.addEventListener("change", function (e) {
      if (opts.readOnly) return;
      var t = e.target;
      if (t.id === "receipt-file" && t.files && t.files[0]) {
        readFileForUpload(t.files[0]).then(function (f) { S.form.file = f; S.form.message = ""; renderView(); }, function (err) { S.form.message = err.message; S.form.messageKind = "err"; renderView(); });
      } else if (t.name === "kind") { S.form.suggestedAction = t.value; }
      else if (t.id === "filter-status") { S.filter.status = t.value; renderView(); }
      else if (t.id === "d-job") { draftFor(byId(S.selectedId)).jobId = t.value; rerenderDetail(); }
      else if (t.name === "d-action") { draftFor(byId(S.selectedId)).action = t.value; rerenderDetail(); }
    });

    function refresh() {
      return api.call("apiReceipts").then(function (list) { S.boot.receipts = list; renderShell(); });
    }

    function send() {
      var f = S.form;
      f.sending = true; f.message = ""; renderView();
      api.call("apiUpload", { base64: f.file.base64, mimeType: f.file.mimeType, fileName: f.file.fileName, jobId: f.jobId, note: f.note, suggestedAction: f.suggestedAction })
        .then(function (r) {
          S.form = { jobQuery: "", jobId: "", file: null, suggestedAction: "", note: "", sending: false,
            message: r.status === "error" ? "Saved, but it couldn't be read: " + (r.error || "") + " The office will check it." : "Sent. " + (r.vendor ? r.vendor + " · " + money(r.total) + ". " : "") + "The office will review it.",
            messageKind: r.status === "error" ? "err" : "ok" };
          return refresh();
        }, function (err) { f.sending = false; f.message = err.message; f.messageKind = "err"; renderView(); });
    }

    function approve(id) {
      var r = byId(id), d = draftFor(r);
      S.busy = true; rerenderDetail();
      var sub = roundCents(d.items.reduce(function (s, i) { return s + Number(i.lineTotal || 0); }, 0));
      // A ticket printed without prices has no total; the office's typed costs become it.
      var edited = Object.assign({}, r.extracted, { items: d.items, tax: d.tax, subtotal: sub, total: r.extracted.total || roundCents(sub + Number(d.tax || 0)) });
      var save = d.dirty || d.jobId !== r.jobId || Number(d.markup) !== r.markupPercent
        ? api.call("apiSaveDraft", id, { jobId: d.jobId, markupPercent: Number(d.markup), extracted: d.dirty ? edited : null })
        : Promise.resolve();
      save.then(function () {
        return api.call("apiApprove", id, { action: d.action, markupPercent: Number(d.markup), description: d.description, reason: d.reason,
          contractPrice: d.contractPrice === "" ? null : Number(d.contractPrice), projectManager: d.projectManager });
      }).then(function (res) {
        S.busy = false; delete S.drafts[id];
        toast("Created " + res.receipt.docName);
        return refresh();
      }, function (err) { S.busy = false; toast(err.message); rerenderDetail(); });
    }

    function retry(id) {
      api.call("apiRetry", id).then(function () { return refresh(); }, function (err) { toast(err.message); });
    }

    // ---------------------------------------------------------------- start
    // Stable outer .jr (theme tokens + toast); only .jr-app is re-rendered.
    el.innerHTML = '<div class="jr"><div class="jr-app"><div class="jr-main"><div class="jr-empty">Loading…</div></div></div></div>';
    var start = opts.boot ? Promise.resolve(opts.boot) : api.call("apiBootstrap");
    start.then(function (b) { S.boot = b; if (opts.settings) S.settings = opts.settings; renderShell(); if (opts.after) opts.after(S); },
      function (err) { appRoot().innerHTML = '<div class="jr-main"><div class="jr-err">' + esc(err.message) + "</div></div>"; });
    return S;
  }

  /** google.script.run as promises: api.call("apiUpload", arg) */
  function appsScriptApi() {
    return {
      call: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        return new Promise(function (resolve, reject) {
          var runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) { reject(e instanceof Error ? e : new Error(String(e && e.message || e))); });
          runner[name].apply(runner, args);
        });
      },
    };
  }

  root.JobReceiptsApp = { mount: mount, appsScriptApi: appsScriptApi, readFileForUpload: readFileForUpload };
})(this);
