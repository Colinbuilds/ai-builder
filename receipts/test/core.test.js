// Loads the plain-script core files (the same files Apps Script runs) into one context.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
// Objects made inside the vm context have their own prototypes; compare as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const C = vm.createContext({ console });
for (const f of ["pricing.js", "match.js", "documents.js", "quickbooks.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../core", f), "utf8"), C, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(__dirname, "../demo/samples.js"), "utf8"), C);

const sample = (i) => {
  const x = C.SAMPLE_RECEIPTS[i].extracted;
  return C.priceReceipt({ vendor: x.vendor, items: x.items, tax: x.tax, total: x.total });
};
const sum = (arr, f) => Math.round(arr.reduce((s, v) => s + f(v), 0) * 100) / 100;

test("rounding: half cents round up, float noise and tiny numbers handled", () => {
  assert.equal(C.roundCents(627.555), 627.56);
  assert.equal(C.roundCents(1.005), 1.01);
  assert.equal(C.roundCents(-2.345), -2.35);
  assert.equal(C.roundCents(1e-7), 0);
  assert.equal(C.roundCents("12.3"), 12.3);
  assert.equal(C.formatMoney(1299.39), "$1,299.39");
  assert.equal(C.formatMoney(-5), "-$5.00");
});

test("pricing: tax spread into cost, 15% markup, totals add up", () => {
  const p = sample(0);
  assert.equal(p.totals.cost, 1129.9); // equals the receipt total
  assert.equal(sum(p.lines, (l) => l.cost), 1129.9);
  assert.equal(p.lines[0].cost, 545.7); // 510 + 73.92 * 510 / 1055.98
  assert.equal(p.lines[0].billed, 627.56); // 545.70 * 1.15 = 627.555
  assert.equal(p.totals.billed, 1299.39);
  assert.equal(p.totals.profit, 169.49);
  assert.equal(p.totals.marginPercent, 13.04);
  assert.ok(p.lines.every((l) => l.vendor === "ABC Supply Co." && l.markupPercent === 15));
});

test("pricing: custom markup, per-line override, tax excluded", () => {
  const p = C.priceReceipt(
    { vendor: "V", tax: 10, items: [{ description: "a", lineTotal: 100 }, { description: "b", lineTotal: 100, markupPercent: 0 }] },
    { markupPercent: 20, includeTaxInCost: false },
  );
  assert.equal(p.totals.cost, 200);
  assert.equal(p.lines[0].billed, 120);
  assert.equal(p.lines[1].billed, 100);
  assert.equal(p.totals.profit, 20);
  assert.equal(p.totals.marginPercent, 9.09);
});

test("pricing: rounding remainder lands on the last line; empty receipt is zero", () => {
  const p = C.priceReceipt({ vendor: "V", tax: 1, items: [{ lineTotal: 1 }, { lineTotal: 1 }, { lineTotal: 1 }] });
  assert.equal(p.totals.cost, 4);
  assert.deepEqual(plain(p.lines.map((l) => l.cost)), [1.33, 1.33, 1.34]);
  const z = C.priceReceipt({ items: [] });
  assert.equal(z.totals.billed, 0);
  assert.equal(z.totals.marginPercent, 0);
});

test("pricing: combining receipts keeps each vendor", () => {
  const c = C.combinePriced([sample(0), sample(1)]);
  assert.equal(c.totals.cost, 1443.07);
  assert.equal(c.totals.billed, 1659.53);
  assert.deepEqual(plain([...new Set(c.lines.map((l) => l.vendor))]), ["ABC Supply Co.", "The Home Depot"]);
});

test("matching: address beats a neighbour's house number", () => {
  const m = C.matchJob(["Whitfield", "4410 Maple Ridge Dr"], C.SAMPLE_JOBS);
  assert.equal(m.job.name, "Dana Whitfield - 4410 Maple Ridge Dr Omaha NE");
  assert.ok(m.confident);
  assert.equal(C.matchJob(["4418 Maple Ridge Drive"], C.SAMPLE_JOBS).job.name, "4418 Maple Ridge Dr Lot 7, Prairie Creek");
});

test("matching: abbreviations, ordinals and names normalise", () => {
  assert.equal(C.matchJob(["8821 Harvest Lane"], C.SAMPLE_JOBS).job.name, "8821 Harvest Ln Lot 12, Prairie Creek");
  assert.equal(C.matchJob(["1506 South 52 Avenue"], C.SAMPLE_JOBS).job.name, "Rivera Family - 1506 S 52nd Ave");
  assert.equal(C.matchJob(["marcus lee"], C.SAMPLE_JOBS).job.name, "Marcus Lee- 219 W Elm St");
  assert.equal(C.matchJob([{ toString: () => "x" }].map(String).concat(["219 West Elm Street"]), C.SAMPLE_JOBS).job.name, "Marcus Lee- 219 W Elm St");
});

test("matching: ambiguous or unknown jobs are not confident", () => {
  const m = C.matchJob(["Northgate"], C.SAMPLE_JOBS);
  assert.equal(m.confident, false);
  assert.ok(m.candidates.length >= 2);
  assert.equal(C.matchJob(["999 Nowhere Rd"], C.SAMPLE_JOBS).confident, false);
  assert.equal(C.matchJob([], C.SAMPLE_JOBS).job, null);
  assert.equal(C.matchJob(["anything"], []).job, null);
});

test("documents: numbering and names use the Drive folder name", () => {
  assert.equal(C.nextChangeOrderNumber(["CO#1 Gutters", "Change Order #2 - Skylight", "Change Order#4 (EPDM)", "Notes"]), 5);
  assert.equal(C.nextChangeOrderNumber([]), 1);
  assert.equal(C.documentName("change_order", "Marcus Lee- 219 W Elm St", { number: 2 }), "Change Order #2 - Marcus Lee- 219 W Elm St");
  assert.equal(C.documentName("invoice", "8821 Harvest Ln", { number: 1047, date: "2026-09-28" }), "Invoice #1047 - 8821 Harvest Ln - 2026-09-28");
});

test("documents: customer copy shows vendor and billed price, never cost or profit", () => {
  const doc = C.buildCustomerDocument("change_order", { name: "Job A" }, sample(0), { number: 3, contractPrice: 1000 });
  assert.equal(doc.total, 1299.39);
  assert.equal(doc.newContractPrice, 2299.39);
  assert.ok(doc.lines.every((l) => l.vendor && !("cost" in l) && !("profit" in l)));
  const html = C.renderDocumentHtml(doc, { name: "Co" });
  assert.match(html, /ABC Supply Co\./);
  assert.doesNotMatch(html, /1,129\.90|169\.49|profit|markup/i);
  assert.match(C.renderDocumentHtml({ ...doc, projectName: "<b>x</b>" }), /&lt;b&gt;x/);
  const inv = C.buildCustomerDocument("invoice", { name: "Job A" }, sample(1), { number: 1047 });
  assert.equal(inv.newContractPrice, undefined);
});

test("quickbooks: invoice, estimate and expense bodies", () => {
  const p = sample(0);
  const inv = C.qboSalesBody(p, { customerId: 58, materialsItemId: 7 }, { kind: "invoice", date: "2026-09-29", jobName: "Job A" });
  assert.equal(inv.CustomerRef.value, "58");
  assert.equal(inv.Line.length, 4);
  assert.ok(inv.Line.every((l) => l.Amount === l.SalesItemLineDetail.UnitPrice && l.SalesItemLineDetail.Qty === 1));
  assert.match(inv.Line[0].Description, /^ABC Supply Co\. – 12 bdl GAF/);
  assert.equal(sum(inv.Line, (l) => l.Amount), 1299.39);
  const est = C.qboSalesBody(p, { customerId: 58, materialsItemId: 7 }, { kind: "change_order", number: 3, date: "2026-09-29", jobName: "Dana Whitfield - 4410 Maple Ridge" });
  assert.equal(est.CustomerMemo.value, "Change Order #3 - Dana Whitfield - 4410 Maple Ridge");
  assert.ok(est.DocNumber.length <= 21);
  const exp = C.qboExpenseBody(p, { vendorId: 9, customerId: 58, paymentAccountId: 41, expenseAccountId: 80 }, { date: "2026-09-29", employee: "Luis Ortega", receiptNumber: "INV-558201" });
  assert.equal(exp.EntityRef.type, "Vendor");
  assert.equal(sum(exp.Line, (l) => l.Amount), 1129.9);
  assert.ok(exp.Line.every((l) => l.AccountBasedExpenseLineDetail.BillableStatus === "NotBillable" && l.AccountBasedExpenseLineDetail.CustomerRef.value === "58"));
  assert.match(exp.PrivateNote, /Luis Ortega/);
});

test("quickbooks: plan lists one expense per vendor", () => {
  const plan = C.qboPlan("invoice", C.combinePriced([sample(0), sample(1)]), { name: "Job A" }, {});
  assert.deepEqual(plain(plan.map((p) => p.entity)), ["Invoice", "Purchase", "Purchase"]);
  assert.equal(plan[1].amount, 1129.9);
  assert.equal(plan[2].amount, 313.17);
});

test("quickbooks: names are escaped in queries and cleaned for DisplayName", () => {
  assert.equal(C.qboFindByNameQuery("Customer", "O'Brien: 12 Main St"), "select * from Customer where DisplayName = 'O\\'Brien 12 Main St'");
  assert.equal(C.qboFindByNameQuery("Item", "Materials"), "select * from Item where Name = 'Materials'");
  assert.equal(C.qboBaseUrl("123", true), "https://sandbox-quickbooks.api.intuit.com/v3/company/123");
});
