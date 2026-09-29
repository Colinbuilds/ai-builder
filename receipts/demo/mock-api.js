// Stand-in for the Apps Script back end, used by the build preview and browser tests.
// Mirrors Code.gs behaviour (roles, statuses, pricing) using the shared core functions.

function createMockApi(opts) {
  opts = opts || {};
  var user = opts.user || "office@samplecontracting.com";
  var admin = opts.admin !== false;
  var delay = opts.delay == null ? 150 : opts.delay;
  var jobs = SAMPLE_JOBS.map(function (name, i) { return { id: "job" + i, name: name }; });
  var emails = { "Luis Ortega": "luis@samplecontracting.com", "Jake Brenner": "jake@samplecontracting.com", "Sam Patel": "sam@samplecontracting.com" };
  var clock = Date.parse("2026-09-29T13:30:00Z");

  function build(sample, i) {
    var x = normalizeExtraction(Object.assign({ isReceipt: true, jobGuess: "", notes: "" }, sample.extracted));
    var m = resolveJob(x, sample.source, jobs);
    var priced = priceReceipt(x, { markupPercent: DEFAULT_MARKUP_PERCENT });
    return {
      id: sample.id, createdAt: new Date(clock - (3 - i) * 36e5).toISOString(), uploadedBy: emails[x.employee] || user, employee: x.employee,
      source: sample.source.via === "Email" ? "upload" : "upload", status: m.confident && !x.flags.length ? "ready" : "needs_review",
      jobId: m.confident && m.job ? m.job.id : "", jobName: m.confident && m.job ? m.job.name : "",
      note: sample.source.body || "", suggestedAction: sample.action === "needs_review" ? "" : sample.action,
      extracted: x, match: { confident: m.confident, score: m.score, aiSuggestion: m.aiSuggestion || "",
        candidates: (m.candidates || []).map(function (c) { return { id: c.job.id, name: c.job.name, score: c.score }; }) },
      markupPercent: DEFAULT_MARKUP_PERCENT, cost: priced.totals.cost, billed: priced.totals.billed, profit: priced.totals.profit, fileId: "",
    };
  }

  var receipts = SAMPLE_RECEIPTS.map(build);
  // An already-approved receipt so job totals and history have something in them.
  var old = build(SAMPLE_RECEIPTS[1], -20);
  old.id = "r0"; old.createdAt = "2026-09-24T15:10:00.000Z"; old.status = "approved"; old.action = "invoice";
  old.docName = documentName("invoice", old.jobName, { number: 1039, date: "2026-09-24" }); old.approvedBy = user;
  receipts.push(old);

  function employeeView(r) {
    return { id: r.id, createdAt: r.createdAt, status: r.status, jobName: r.jobName, note: r.note, vendor: r.extracted && r.extracted.vendor,
      total: r.extracted && r.extracted.total, items: r.extracted ? r.extracted.items.length : 0, error: r.error, action: r.status === "approved" ? r.action : "" };
  }
  function visible() {
    var list = receipts.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return admin ? list : list.filter(function (r) { return r.uploadedBy === user; }).map(employeeView);
  }
  function find(id) { return receipts.filter(function (r) { return r.id === id; })[0]; }

  var handlers = {
    apiBootstrap: function () {
      return { user: user, admin: admin, company: SAMPLE_COMPANY.name, companyAddress: SAMPLE_COMPANY.address, defaultMarkup: DEFAULT_MARKUP_PERCENT, jobs: jobs, receipts: visible() };
    },
    apiReceipts: visible,
    apiReceiptFile: function () { return null; },
    apiUpload: function (input) {
      // The test drive gives every photo the same sample reading; the job comes from its PO line.
      var x = normalizeExtraction({ isReceipt: true, employee: user.split("@")[0], jobName: "Harvest Ln", address: "8821 Harvest Ln", jobGuess: "", vendor: "Menards", date: "2026-09-29", receiptNumber: "118-3399",
        items: [{ description: "2x4x8 SPF Stud", qty: 20, unit: "ea", lineTotal: 79.8 }, { description: "GRK R4 Screws 3\" 100ct", qty: 2, unit: "box", lineTotal: 49.96 }],
        subtotal: 129.76, tax: 9.08, total: 138.84, notes: "" });
      var m = resolveJob(x, {}, jobs), j = m.confident && m.job ? m.job : { id: "", name: "" };
      var priced = priceReceipt(x, { markupPercent: DEFAULT_MARKUP_PERCENT });
      var r = { id: "u" + receipts.length, createdAt: new Date(clock + receipts.length * 6e4).toISOString(), uploadedBy: user, employee: user.split("@")[0], source: "upload",
        status: j.id ? "ready" : "needs_review", jobId: j.id, jobName: j.name, note: input.note || "", suggestedAction: input.suggestedAction || "", extracted: x,
        match: { confident: !!j.id, score: m.score, candidates: [] }, markupPercent: DEFAULT_MARKUP_PERCENT, cost: priced.totals.cost, billed: priced.totals.billed, profit: priced.totals.profit };
      receipts.push(r);
      return admin ? r : employeeView(r);
    },
    apiSaveDraft: function (id, patch) {
      var r = find(id);
      if (patch.jobId) { var j = jobs.filter(function (x) { return x.id === patch.jobId; })[0]; r.jobId = j.id; r.jobName = j.name; }
      if (patch.extracted) r.extracted = normalizeExtraction(patch.extracted);
      if (patch.markupPercent != null) r.markupPercent = patch.markupPercent;
      var p = priceReceipt(r.extracted, { markupPercent: r.markupPercent });
      r.cost = p.totals.cost; r.billed = p.totals.billed; r.profit = p.totals.profit;
      return r;
    },
    apiApprove: function (id, o) {
      var r = find(id);
      if (!r.jobId) throw new Error("Pick the job first.");
      var p = priceReceipt(r.extracted, { markupPercent: o.markupPercent });
      if (!(p.totals.cost > 0)) throw new Error("This receipt has no prices yet. Type in what each line cost, then approve.");
      var number = o.action === "change_order" ? nextChangeOrderNumber(["CO#1 Gutter upgrade", "Change Order #2 - Skylight"]) : 1048;
      r.status = "approved"; r.action = o.action; r.markupPercent = o.markupPercent;
      r.cost = p.totals.cost; r.billed = p.totals.billed; r.profit = p.totals.profit;
      r.docName = documentName(o.action, r.jobName, { number: number, date: "2026-09-29" }); r.approvedBy = user;
      return { receipt: r, docUrl: "#" };
    },
    apiRetry: function (id) { return find(id); },
    apiSettings: function () {
      return { quickbooks: { connected: false, authUrl: "#connect" }, ai: true,
        admins: ["office@samplecontracting.com"], defaultMarkup: DEFAULT_MARKUP_PERCENT, changeOrderTemplate: true };
    },
  };

  return {
    receipts: receipts,
    call: function (name) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try { resolve(JSON.parse(JSON.stringify(handlers[name].apply(null, args)))); } catch (e) { reject(e); }
        }, delay);
      });
    },
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createMockApi: createMockApi };
