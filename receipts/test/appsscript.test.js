// Runs the real Apps Script server files against fake Google services, end to end:
// employee upload -> AI read (fake Claude) -> admin approve -> QuickBooks (fake) + Docs + Drive.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createGoogle } = require("./fake-google");

const plain = (v) => JSON.parse(JSON.stringify(v));
const DIR = path.join(__dirname, "..");
const GS = ["Config.gs", "Store.gs", "Jobs.gs", "Ai.gs", "Docs.gs", "QuickBooks.gs", "Code.gs"];
const CORE = ["pricing", "match", "documents", "quickbooks", "extract"];

const RECEIPT = {
  isReceipt: true, employee: "Jake Brenner", jobName: "", address: "8821 Harvest Ln", jobGuess: "8821 Harvest Ln Lot 12, Prairie Creek",
  vendor: "The Home Depot", date: "2026-09-28", receiptNumber: "4410-58833",
  items: [
    { description: "Hardie 5/4x4 Trim 12ft", qty: 6, unit: "pc", lineTotal: 167.94 },
    { description: "OSI Quad Max Sealant", qty: 8, unit: "tube", lineTotal: 79.84 },
  ],
  subtotal: 247.78, tax: 17.34, total: 265.12, notes: "",
};

function setup(opts = {}) {
  const g = createGoogle({ owner: "office@acme.test", user: "office@acme.test", qboConnected: opts.qboConnected, props: {
    ADMIN_EMAILS: "office@acme.test", ANTHROPIC_API_KEY: "sk-test", QBO_CLIENT_ID: "cid", QBO_CLIENT_SECRET: "sec",
    QBO_REALM_ID: "9130", QBO_PAYMENT_ACCOUNT: "Company Visa", COMPANY_NAME: "Acme Contracting", ...(opts.props || {}),
  } });
  const jobsRoot = g._.folder("Jobs");
  const harvest = g._.folder("8821 Harvest Ln Lot 12, Prairie Creek", jobsRoot);
  const whitfield = g._.folder("Dana Whitfield - 4410 Maple Ridge Dr Omaha NE", jobsRoot);
  const pm = g._.folder("Project Management", whitfield);
  const cos = g._.folder("Change Orders", pm);
  g._.folder("CO#1 Gutter upgrade", cos);
  g._.doc("Change Order #2 - Skylight", [], cos);
  g._.props.set("JOBS_FOLDER_ID", jobsRoot.getId());

  // Fake web: Claude reads receipts, QuickBooks keeps a tiny ledger.
  const qbo = { Customer: [], Vendor: [], Item: [{ Id: "7", Name: "Materials" }], Account: [{ Id: "41", Name: "Company Visa" }, { Id: "80", Name: "Job Materials" }], posted: [] };
  let claudeReply = opts.claudeReply || RECEIPT;
  g._.routes.push(
    { match: (r) => r.url === "https://api.anthropic.com/v1/messages", reply: (r) => ({ body: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(claudeReply) }] } }) },
    { match: (r) => r.url.includes("/query?query="), reply: (r) => {
      const q = decodeURIComponent(r.url.split("query=")[1].split("&")[0]);
      const m = q.match(/from (\w+) where (\w+) = '((?:[^'\\]|\\.)*)'/);
      const rows = (qbo[m[1]] || []).filter((x) => (x.DisplayName || x.Name) === m[3].replace(/\\'/g, "'"));
      return { body: { QueryResponse: rows.length ? { [m[1]]: rows } : {} } };
    } },
    { match: (r) => r.method === "post" && /quickbooks\.api\.intuit\.com\/v3\/company\/9130\/(customer|vendor|invoice|estimate|purchase)/.test(r.url), reply: (r) => {
      const entity = r.url.match(/\/(customer|vendor|invoice|estimate|purchase)\?/)[1];
      const E = entity[0].toUpperCase() + entity.slice(1);
      const rec = { Id: String(100 + qbo.posted.length), ...r.body };
      if (E === "Invoice") rec.DocNumber = "1049";
      if (qbo[E]) qbo[E].push(rec);
      qbo.posted.push({ entity: E, body: r.body });
      return { body: { [E]: rec } };
    } },
  );
  const ctx = vm.createContext({ console, ...g, JSON, Date, Math });
  for (const f of CORE) vm.runInContext(fs.readFileSync(path.join(DIR, "core", f + ".js"), "utf8"), ctx, { filename: f });
  for (const f of GS) vm.runInContext(fs.readFileSync(path.join(DIR, "apps-script", f), "utf8"), ctx, { filename: f });
  ctx.setup();
  return { g, ctx, qbo, jobs: { harvest, whitfield, cos }, setClaude: (x) => { claudeReply = x; } };
}

const upload = (ctx, jobId, extra = {}) => ctx.apiUpload({ base64: Buffer.from("fake-jpeg").toString("base64"), mimeType: "image/jpeg", fileName: "IMG_1.jpg", jobId, note: "trim for garage", ...extra });

test("employee upload: read by AI, filed to inbox, employee sees no money fields", () => {
  const { g, ctx, jobs } = setup();
  g._.setUser("jake@acme.test");
  const boot = ctx.apiBootstrap();
  assert.equal(boot.admin, false);
  assert.deepEqual(plain(boot.jobs.map((j) => j.name)), ["8821 Harvest Ln Lot 12, Prairie Creek", "Dana Whitfield - 4410 Maple Ridge Dr Omaha NE"]);
  const r = upload(ctx, jobs.harvest.getId());
  assert.equal(r.status, "ready");
  assert.equal(r.vendor, "The Home Depot");
  assert.equal(r.total, 265.12);
  for (const k of ["cost", "billed", "profit", "markupPercent", "extracted"]) assert.ok(!(k in r), "employee view leaks " + k);
  const claudeCall = g._.fetches.find((f) => f.url.includes("anthropic"));
  assert.equal(claudeCall.headers["x-api-key"], "sk-test");
  assert.equal(claudeCall.body.messages[0].content[0].source.media_type, "image/jpeg");
  const inboxFile = [...g._.files.values()].find((f) => f.getName() === "IMG_1.jpg");
  assert.equal(inboxFile.parent.getName(), "JobReceipts inbox");
});

test("employees only see their own receipts; admin-only actions are refused", () => {
  const { g, ctx, jobs } = setup();
  g._.setUser("jake@acme.test"); upload(ctx, jobs.harvest.getId());
  g._.setUser("sam@acme.test");
  assert.equal(ctx.apiReceipts().length, 0);
  assert.throws(() => ctx.apiApprove("x", { action: "invoice" }), /Only admins/);
  assert.throws(() => ctx.apiSettings(), /Only admins/);
  g._.setUser("office@acme.test");
  const all = ctx.apiReceipts();
  assert.equal(all.length, 1);
  assert.equal(all[0].cost, 265.12);
  g._.setUser("");
  assert.throws(() => ctx.apiBootstrap(), /sign in/);
});

test("admin approves an invoice: QuickBooks customer, invoice and expense; doc in Invoices; receipt filed", () => {
  const { g, ctx, qbo, jobs } = setup();
  g._.setUser("jake@acme.test");
  const up = upload(ctx, jobs.harvest.getId());
  g._.setUser("office@acme.test");
  const res = ctx.apiApprove(up.id, { action: "invoice", markupPercent: 15, date: "2026-09-29" });
  assert.equal(res.receipt.status, "approved");
  assert.deepEqual(plain(qbo.posted.map((p) => p.entity)), ["Customer", "Invoice", "Vendor", "Purchase"]);
  assert.equal(qbo.posted[0].body.DisplayName, "8821 Harvest Ln Lot 12, Prairie Creek");
  const inv = qbo.posted[1].body;
  assert.equal(inv.Line.length, 2);
  assert.match(inv.Line[0].Description, /^The Home Depot – 6 pc Hardie/);
  assert.equal(Math.round(inv.Line.reduce((s, l) => s + l.Amount, 0) * 100) / 100, res.receipt.billed);
  const purchase = qbo.posted[3].body;
  assert.equal(purchase.AccountRef.value, "41");
  assert.equal(purchase.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, "80");
  assert.equal(Math.round(purchase.Line.reduce((s, l) => s + l.Amount, 0) * 100) / 100, 265.12);
  assert.equal(res.receipt.docName, "Invoice #1049 - 8821 Harvest Ln Lot 12, Prairie Creek - 2026-09-29");
  const doc = [...g._.files.values()].find((f) => f.getName() === res.receipt.docName);
  assert.equal(doc.parent.getName(), "Invoices");
  assert.equal(doc.parent.parent, jobs.harvest);
  assert.ok([...g._.files.values()].some((f) => f.getName() === res.receipt.docName + ".pdf"));
  const text = g._.docs.get(doc.getId()).getBody().text();
  assert.match(text, /The Home Depot \| Hardie 5\/4x4 Trim 12ft \| 6 pc/);
  assert.doesNotMatch(text, /profit|265\.12/i);
  const receiptFile = [...g._.files.values()].find((f) => f.getName() === "IMG_1.jpg");
  assert.equal(receiptFile.parent.getName(), "Receipts");
  assert.throws(() => ctx.apiApprove(up.id, { action: "invoice" }), /already approved/);
  // Customer is reused, not duplicated, on the next approval.
  g._.setUser("jake@acme.test"); const up2 = upload(ctx, jobs.harvest.getId());
  g._.setUser("office@acme.test"); ctx.apiApprove(up2.id, { action: "invoice", markupPercent: 15 });
  assert.equal(qbo.Customer.length, 1);
  assert.equal(qbo.Vendor.length, 1);
});

test("change order from the template: next number, labels filled, materials above signatures, Estimate in QuickBooks", () => {
  const { g, ctx, qbo, jobs, setClaude } = setup();
  const D = g._;
  const tpl = D.doc("Change Order template (MAKE COPY)", [
    new D.Para("CONSTRUCTION CHANGE ORDER"),
    new D.Table([["PROJECT NAME", ""], ["LOCATION OF WORK", ""], ["PROJECT MANAGER", "", "Date of Request", ""]]),
    new D.Table([["DESCRIPTION OF CHANGES NEEDED", ""], ["REASON FOR CHANGE", ""]]),
    new D.Table([["NET INCREASE / DECREASE", ""], ["TOTAL CONTRACT PRICE WITH APPROVED CHANGES", ""]]),
    new D.Para("Signature                    Approved  Signature"),
    new D.Table([["NAME & TITLE", "", "", "NAME & TITLE", ""], ["DATE", "", "", "DATE", ""]]),
  ]);
  D.props.set("CHANGE_ORDER_TEMPLATE_ID", tpl.getId());
  setClaude({ ...RECEIPT, vendor: "ABC Supply Co.", address: "4410 Maple Ridge", jobGuess: "" });
  D.setUser("luis@acme.test");
  const up = upload(ctx, jobs.whitfield.getId(), { suggestedAction: "change_order" });
  D.setUser("office@acme.test");
  const res = ctx.apiApprove(up.id, { action: "change_order", markupPercent: 20, date: "2026-09-29", reason: "Rotted decking", description: "Replace decking",
    projectManager: "Luis Ortega", contractPrice: 18450 });
  assert.equal(res.receipt.docName, "Change Order #3 - Dana Whitfield - 4410 Maple Ridge Dr Omaha NE");
  const file = [...D.files.values()].find((f) => f.getName() === res.receipt.docName);
  assert.equal(file.parent, jobs.cos);
  const body = D.docs.get(file.getId()).getBody();
  const t = body.getTables().map((x) => x.toArray());
  assert.deepEqual(t[0][0], ["PROJECT NAME", "Dana Whitfield - 4410 Maple Ridge Dr Omaha NE"]);
  assert.deepEqual(t[0][2], ["PROJECT MANAGER", "Luis Ortega", "Date of Request", "2026-09-29"]);
  assert.deepEqual(t[1][1], ["REASON FOR CHANGE", "Rotted decking"]);
  const billed = res.receipt.billed;
  assert.equal(t[2][0][1], ctx.formatMoney(billed));
  assert.equal(t[2][1][1], ctx.formatMoney(18450 + billed));
  const idxMaterials = body.children.findIndex((c) => c.text === "MATERIALS");
  const idxSignature = body.children.findIndex((c) => /^Signature/.test(c.text || ""));
  assert.ok(idxMaterials > 0 && idxMaterials < idxSignature, "materials inserted above signatures");
  assert.equal(body.children[idxMaterials + 1].toArray()[1][0], "ABC Supply Co.");
  assert.deepEqual(t[t.length - 1][1], ["DATE", "", "", "DATE", ""], "signature dates left blank");
  const est = qbo.posted.find((p) => p.entity === "Estimate").body;
  assert.equal(est.CustomerMemo.value, "Change Order #3 - Dana Whitfield - 4410 Maple Ridge Dr Omaha NE");
  assert.equal(res.receipt.markupPercent, 20);
  assert.equal(res.receipt.profit, Math.round((billed - 265.12) * 100) / 100);
});

test("wrong job picked: AI disagreement goes to review; admin fixes the job before approving", () => {
  const { g, ctx, jobs } = setup();
  g._.setUser("jake@acme.test");
  const up = upload(ctx, jobs.whitfield.getId()); // receipt says Harvest Ln
  g._.setUser("office@acme.test");
  const r = ctx.apiReceipts().find((x) => x.id === up.id);
  assert.equal(r.status, "needs_review");
  assert.ok(r.extracted.flags.some((f) => /employee picked/.test(f)));
  const fixed = ctx.apiSaveDraft(up.id, { jobId: jobs.harvest.getId(), markupPercent: 10 });
  assert.equal(fixed.jobName, "8821 Harvest Ln Lot 12, Prairie Creek");
  assert.equal(fixed.billed, ctx.priceReceipt(RECEIPT, { markupPercent: 10 }).totals.billed);
  assert.equal(fixed.status, "ready");
});

test("delivery ticket with no prices: goes to review and can't be approved until the office types in costs", () => {
  const ticket = { ...RECEIPT, items: RECEIPT.items.map((i) => ({ ...i, lineTotal: 0 })), subtotal: 0, tax: 0, total: 0 };
  const { ctx, jobs } = setup({ claudeReply: ticket });
  const up = upload(ctx, jobs.harvest.getId());
  assert.equal(up.status, "needs_review");
  assert.ok(up.extracted.flags.some((f) => /^No prices on this receipt/.test(f)));
  assert.throws(() => ctx.apiApprove(up.id, { action: "change_order", markupPercent: 15 }), /no prices yet/);
  const priced = { ...ticket, items: RECEIPT.items, subtotal: 247.78, total: 247.78 };
  const saved = ctx.apiSaveDraft(up.id, { extracted: priced });
  assert.equal(saved.status, "ready");
  assert.equal(saved.cost, 247.78);
  const res = ctx.apiApprove(up.id, { action: "invoice", markupPercent: 15, date: "2026-09-29" });
  assert.equal(res.receipt.billed, 284.95);
});

test("phone upload without a buyer name on the receipt: the uploader is the employee, no review needed", () => {
  const { g, ctx, jobs } = setup({ claudeReply: { ...RECEIPT, employee: "" } });
  g._.setUser("jake@acme.test");
  upload(ctx, jobs.harvest.getId());
  g._.setUser("office@acme.test");
  const r = ctx.apiReceipts()[0];
  assert.equal(r.employee, "jake@acme.test");
  assert.equal(r.status, "ready");
});

test("upload with just a photo: the job is read from the receipt", () => {
  const { ctx } = setup();
  const up = ctx.apiUpload({ base64: Buffer.from("fake-jpeg").toString("base64"), mimeType: "image/jpeg", fileName: "IMG_2.jpg" });
  assert.equal(up.jobName, "8821 Harvest Ln Lot 12, Prairie Creek");
  assert.equal(up.status, "ready");
});

test("QuickBooks not connected yet: documents are still created and the receipt is marked", () => {
  const { g, ctx, qbo, jobs } = setup({ qboConnected: false });
  g._.setUser("jake@acme.test"); const up = upload(ctx, jobs.harvest.getId());
  g._.setUser("office@acme.test");
  const res = ctx.apiApprove(up.id, { action: "invoice", markupPercent: 15, date: "2026-09-29" });
  assert.equal(qbo.posted.length, 0);
  assert.equal(res.receipt.qbo.skipped, "QuickBooks not connected");
  assert.equal(res.receipt.docName, "Invoice - 8821 Harvest Ln Lot 12, Prairie Creek - 2026-09-29");
});

test("AI failure leaves a visible receipt with the error, and retry recovers it", () => {
  const { g, ctx, jobs } = setup();
  g._.routes.unshift({ match: (r) => r.url.includes("anthropic") && !g.__ok, reply: () => ({ status: 529, body: { error: { message: "overloaded" } } }) });
  g._.setUser("jake@acme.test");
  const up = upload(ctx, jobs.harvest.getId());
  assert.equal(up.status, "error");
  assert.match(up.error, /busy/);
  g.__ok = true;
  g._.setUser("office@acme.test");
  const again = ctx.apiRetry(up.id);
  assert.equal(again.status, "ready");
  assert.equal(again.extracted.vendor, "The Home Depot");
});


test("security: only the page API, the OAuth callback and setup can be called from a browser", () => {
  // Apps Script lets the page call any top-level function whose name doesn't end in "_".
  const PUBLIC = new Set(["doGet", "setup", "qboAuthCallback", "apiBootstrap", "apiUpload", "apiReceipts",
    "apiReceiptFile", "apiSaveDraft", "apiApprove", "apiRetry", "apiSettings"]);
  for (const f of GS) {
    const src = fs.readFileSync(path.join(DIR, "apps-script", f), "utf8");
    for (const m of src.matchAll(/^function (\w+)\s*\(/gm)) {
      assert.ok(PUBLIC.has(m[1]) || m[1].endsWith("_"), `${f}: ${m[1]} is callable from the browser; rename it to ${m[1]}_`);
    }
  }
});

test("security: setup refuses employees", () => {
  const { g, ctx } = setup();
  g._.setUser("jake@acme.test");
  assert.throws(() => ctx.setup(), /Only admins/);
});
