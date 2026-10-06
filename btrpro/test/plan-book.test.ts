// TEST_ONLY builder plan books: a synthetic master sheet in the same block layout as a builder's real one
// (made-up models and prices — no real pricing), import, model pick, takeoff edits, order PDF, schedule, audit.
import { afterAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import type { Tab } from "@/lib/import/xlsx";
import { auditRows, buildOut, editOption, findPlan, modelLabel, moneyFindings, parsePlanBook, type Selection } from "@/lib/builders/plans";
import { activeBooks, getBook, importPlanBook, planOrderPdf, saveTakeoffEdit, scheduleHouse } from "@/lib/builders/planbook";

const TAX = 0.1, MK = 0.05, LAB = 40, LMK = 10, BOOT = 100, FUEL = 25;
const grid = (h: number, w = 12) => Array.from({ length: h }, () => Array<string>(w).fill(""));

// one roofing block: materials, cost/tax/profit, squares, labor cost/profit, payout, overall
function roofBlock(g: string[][], r: number, model: string, label: string, mats: [string, number, number][], sq: number) {
  const elev = /^[A-Z]$/.test(label);
  const mc = mats.reduce((a, m) => a + m[2], 0);
  const boot = elev ? BOOT : 0;
  g[r][0] = "Model Type";
  g[r + 1][0] = model;
  g[r + 1][2] = label;
  let i = r + 2;
  for (const [n, q, c] of mats) (g[i][2] = n), (g[i][3] = String(q)), (g[i++][4] = String(c));
  (g[i][1] = "Cost (per house)"), (g[i++][3] = String(mc));
  (g[i][1] = "Tax (per house)"), (g[i++][3] = String(mc * TAX));
  (g[i][1] = "Profit (per house)"), (g[i++][3] = String(mc * MK));
  (g[i][2] = "Asphalt (SQ)"), (g[i++][3] = String(sq));
  (g[i][1] = "Cost (per house)"), (g[i++][3] = String(sq * LAB + boot));
  (g[i][1] = "Profit (per house)"), (g[i++][3] = String(sq * LMK));
  (g[i][0] = "Payout"), (g[i++][3] = String(sq * LAB + boot));
  (g[i][0] = "Overall"), (g[i++][3] = String(mc * (1 + TAX + MK) + sq * (LAB + LMK) + boot));
  return i + 1;
}
function gutBlock(g: string[][], r: number, model: string, label: string, mats: [string, number, number | null][]) {
  const priced = mats.filter((m) => m[2] != null);
  const mc = priced.reduce((a, m) => a + m[2]!, 0);
  const lf = priced.reduce((a, m) => a + m[1], 0);
  g[r][0] = "Model Type";
  g[r + 1][0] = model;
  g[r + 1][2] = label;
  let i = r + 2;
  for (const [n, q, c] of mats) (g[i][2] = n), (g[i][3] = String(q)), (g[i++][4] = c == null ? "" : String(c));
  (g[i][1] = "Cost (per house)"), (g[i++][3] = String(mc));
  (g[i][0] = "Payout"), (g[i++][3] = String(mc));
  (g[i][0] = "Overall"), (g[i++][3] = String(lf * 4.5));
  return i + 1;
}

function workbook(): Tab[] {
  const roof = grid(120);
  roof[0][0] = "Material"; roof[0][1] = "Cost";
  roof[1][0] = "TEST_ONLY Shingle"; roof[1][1] = "100";
  roof[2][0] = "TEST_ONLY Starter"; roof[2][1] = "20";
  roof[0][6] = "Master Tax Rate"; roof[1][6] = String(TAX);
  roof[2][6] = "Master Mark Up"; roof[3][6] = String(MK);
  roof[4][6] = "Asphalt Shingles (SQ)"; roof[4][8] = String(LAB); roof[4][9] = String(LMK);
  roof[5][6] = "Boot Trip Charge"; roof[5][8] = String(BOOT);
  roof[6][6] = "Fuel Surcharge"; roof[7][6] = String(FUEL);
  let r = 10;
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "A", [["TEST_ONLY Shingle", 30, 3000], ["TEST_ONLY Starter", 2, 40]], 30);
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "B", [["TEST_ONLY Shingle", 32, 3200], ["TEST_ONLY Starter", 2, 40]], 32);
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "3 Car (B Only)", [["TEST_ONLY Shingle", 4, 400]], 4);
  r = roofBlock(roof, r, "TEST_ONLY Aspen", "Covered Rear Porch", [["TEST_ONLY Shingle", 2, 200]], 2);
  roofBlock(roof, r, "TEST_ONLY Birch", "A", [["TEST_ONLY Shingle", 25, 2500], ["TEST_ONLY Starter", 0, 0]], 25);
  const gut = grid(60);
  gut[0][0] = "Material"; gut[0][1] = "Cost"; gut[0][2] = "Mark";
  gut[1][0] = '5" K Style'; gut[1][1] = "4"; gut[1][2] = "0.5";
  gut[2][0] = "Downspouts"; gut[2][1] = "4"; gut[2][2] = "0.5";
  gut[0][6] = "WO/DL Options"; gut[1][7] = "20"; gut[1][8] = "90";
  let q = 6;
  q = gutBlock(gut, q, "TEST_ONLY Aspen", "A", [['5" Gutter', 100, 400], ["Elbows", 10, null], ["Downspouts", 50, 200]]);
  q = gutBlock(gut, q, "TEST_ONLY Aspen", "B", [['5" Gutter', 110, 440], ["Downspouts", 50, 200]]);
  q = gutBlock(gut, q, "TEST_ONLY Aspen", "3 Car", [['5" Gutter', 20, 80]]);
  gutBlock(gut, q, "TEST_ONLY Birch", "A", [['5" Gutter', 90, 360], ["Downspouts", 40, 160]]);
  const old = [["PLANS", "A", "B"], ["TEST_ONLY Aspen(1500)", "7000", "7200"]];
  return [{ name: "Master Sheet Asphalt", rows: roof }, { name: "Master Gutter Sheet", rows: gut }, { name: "Old Pricing", rows: [["Sell"], ...old] }];
}

async function toXlsx(tabs: Tab[]) {
  const z = new JSZip();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const col = (c: number) => (c < 26 ? "" : String.fromCharCode(64 + Math.floor(c / 26))) + String.fromCharCode(65 + (c % 26));
  z.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  z.file("xl/workbook.xml", `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<Relationships>${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  tabs.forEach((t, i) =>
    z.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet><sheetData>${t.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v === "" ? "" : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`,
    ),
  );
  return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
}

const NAME = "TEST_ONLY Plan Homes";
afterAll(async () => {
  await prisma.prodLine.deleteMany({ where: { builder: NAME } });
  await prisma.company.deleteMany({ where: { name: NAME } });
  await prisma.$disconnect();
});

describe("plan book parse + pick", () => {
  const data = parsePlanBook(workbook());
  it("reads models, options, rates and old pricing", () => {
    expect(data.plans.map((p) => p.name)).toEqual(["TEST_ONLY Aspen", "TEST_ONLY Birch"]);
    const a = findPlan(data.plans, "test_only aspen")!;
    expect(a.sqft).toBe(1500);
    expect(a.roofing.map((o) => [o.label, o.kind, o.onlyWith])).toEqual([["A", "ELEVATION", null], ["B", "ELEVATION", null], ["3 Car (B Only)", "GARAGE", "B"], ["Covered Rear Porch", "PORCH", null]]);
    expect(a.roofing[0]).toMatchObject({ materialCost: 3040, squares: 30, payout: 1300, sell: 3040 * 1.15 + 1500 + 100 });
    expect(a.oldRoofing.A.sell).toBe(7000);
    expect(data.rates.roofing).toMatchObject({ taxPct: TAX, markupPct: MK, laborPerSq: LAB, laborMarkupPerSq: LMK, bootTrip: BOOT, fuelSurcharge: FUEL });
  });
  it("builds a house: elevation + 3 car + porch + daylight basement", () => {
    const a = findPlan(data.plans, "TEST_ONLY Aspen")!;
    const sel: Selection = { elevation: "B", garage: "3", basement: "DLWO", porch: true };
    const out = buildOut(data, a, sel);
    expect(out.roofing.picked.map((o) => o.label)).toEqual(["B", "3 Car (B Only)", "Covered Rear Porch"]);
    expect(out.roofing.materials.find((m) => m.name === "TEST_ONLY Shingle")!.qty).toBe(38);
    expect(out.gutters.sell).toBe(180 * 4.5 + 90);
    expect(out.gutters.materials.find((m) => m.name === "Downspouts")!.qty).toBe(70);
    expect(out.total.sell).toBe(Math.round((out.roofing.sell + out.gutters.sell) * 100) / 100);
    expect(modelLabel(a.name, sel)).toBe("TEST_ONLY Aspen · Elev B · 3 Car · Rear Porch · DL/WO");
    // A has no 3-car option of its own → the B-only one isn't used, it's flagged
    expect(out.gutters.picked.map((o) => o.label)).toEqual(["B", "3 Car"]);
    const onA = buildOut(data, a, { ...sel, elevation: "A" }).roofing;
    expect(onA.picked.map((o) => o.label)).not.toContain("3 Car (B Only)");
    expect(onA.missing).toEqual(["3-car garage isn't priced for this model"]);
  });
  it("audits profit and finds money", () => {
    const rows = auditRows(data);
    const aspenA = rows.find((r) => r.plan === "TEST_ONLY Aspen" && r.label === "A" && r.trade === "ROOFING")!;
    expect(aspenA.profit).toBeCloseTo(3040 * MK + 30 * LMK, 2);
    expect(aspenA.oldSell).toBe(7000);
    const m = moneyFindings(data, 100);
    expect(m.findings.find((f) => /Fuel surcharge/.test(f.title))?.perYear).toBe(FUEL * 100);
    expect(m.findings.some((f) => /Boot trip/.test(f.title))).toBe(true);
    expect(m.findings.some((f) => /walkout gutter add has no margin/.test(f.title))).toBe(true);
  });
  it("re-prices only what an edit changes", () => {
    const a = findPlan(data.plans, "TEST_ONLY Aspen")!;
    const r = editOption(data, "ROOFING", a.roofing[0], [{ name: "TEST_ONLY Shingle", qty: 31 }, { name: "TEST_ONLY Starter", qty: 2 }], 31);
    expect(r.option.sell).toBeCloseTo(a.roofing[0].sell! + 100 * 1.15 + 50, 2);
    expect(r.option.payout).toBe(a.roofing[0].payout! + 40);
    expect(r.option.profit).toBeCloseTo(a.roofing[0].profit! + 5 + 10, 2);
    const g = editOption(data, "GUTTERS", a.gutters[0], [{ name: '5" Gutter', qty: 110 }, { name: "Downspouts", qty: 50 }, { name: "Elbows", qty: 12 }, { name: "TEST_ONLY Splash block", qty: 2 }], null);
    expect(g.option.sell).toBe(a.gutters[0].sell! + 45);
    expect(g.option.payout).toBe(a.gutters[0].payout! + 40);
    expect(g.option.profit).toBe(a.gutters[0].profit! + 5);
    expect(g.unpriced).toEqual(["TEST_ONLY Splash block"]);
    const rm = editOption(data, "ROOFING", a.roofing[0], [{ name: "TEST_ONLY Shingle", qty: 30 }], null);
    expect(rm.changes).toContain("TEST_ONLY Starter: removed");
    expect(rm.option.sell).toBeCloseTo(a.roofing[0].sell! - 40 * 1.15, 2);
  });
});

describe("plan book in BTRpro", () => {
  it("imports, edits the takeoff, prints an order and schedules a house", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: admin.id, name: "TEST_ONLY planner", role: "ADMIN" };
    const co = await prisma.company.create({ data: { name: NAME, type: "BUILDER" } });
    const bytes = await toXlsx(workbook());
    await expect(importPlanBook(co.id, { bytes, label: "" }, actor)).rejects.toThrow(/Name the plan book/);
    const { book } = await importPlanBook(co.id, { bytes, label: "TEST_ONLY Metro", fileName: "TEST_ONLY.xlsx" }, actor);
    expect((await activeBooks(co.id)).map((b) => b.data.plans.length)).toEqual([2]);

    const r = await saveTakeoffEdit(book.id, "TEST_ONLY Aspen", "ROOFING", "A", [{ name: "TEST_ONLY Shingle", qty: 31 }, { name: "TEST_ONLY Starter", qty: 2 }], 30, actor);
    expect(r.changes[0]).toBe("TEST_ONLY Shingle: 30 → 31");
    await expect(saveTakeoffEdit(book.id, "TEST_ONLY Aspen", "ROOFING", "A", [], null, { ...actor, role: "OFFICE" })).rejects.toThrow(/Only admins/);
    const saved = (await getBook(book.id))!;
    expect(findPlan(saved.data.plans, "TEST_ONLY Aspen")!.roofing[0].materials[0].qty).toBe(31);
    expect(saved.data.edits).toHaveLength(1);

    // re-import replaces it, keeps the old version, and says the edit was replaced
    const again = await importPlanBook(co.id, { bytes, label: "TEST_ONLY Metro" }, actor);
    expect(again.data.warnings.some((w) => /1 takeoff edit/.test(w))).toBe(true);
    expect(await prisma.builderPlanBook.count({ where: { companyId: co.id } })).toBe(2);
    expect((await activeBooks(co.id)).map((b) => b.id)).toEqual([again.book.id]);

    const pdf = await planOrderPdf({ builder: NAME, model: "TEST_ONLY Aspen · Elev A", address: "TEST_ONLY Lot 1", po: "1", deliver: "", color: "", notes: "", lines: [{ name: "TEST_ONLY Shingle", qty: "31", unit: "EA" }, { name: "", qty: "", unit: "" }] });
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");

    const sel: Selection = { elevation: "B", garage: "3", basement: "STANDARD", porch: false };
    await expect(scheduleHouse(again.book.id, "TEST_ONLY Aspen", sel, { address: "", trades: ["ROOFING"] }, actor)).rejects.toThrow(/address/);
    await expect(scheduleHouse(again.book.id, "TEST_ONLY Aspen", { ...sel, elevation: "A" }, { address: "TEST_ONLY Lot 2", trades: ["ROOFING"] }, actor)).rejects.toThrow(/3-car garage/);
    expect(await prisma.prodLine.count({ where: { builder: NAME } })).toBe(0);
    const { lines, label } = await scheduleHouse(again.book.id, "TEST_ONLY Aspen", sel, { address: "TEST_ONLY Lot 3", trades: ["ROOFING", "GUTTERS"], vpo: "TEST_ONLY-PO" }, actor);
    expect(label).toBe("TEST_ONLY Aspen · Elev B · 3 Car");
    expect(lines.map((l) => [l.type, l.board, l.builder, l.model, l.vpo])).toEqual([
      ["Roofing", "ADD", NAME, label, "TEST_ONLY-PO"],
      ["Gutters", "ADD", NAME, label, "TEST_ONLY-PO"],
    ]);
    const out = buildOut(again.data, findPlan(again.data.plans, "TEST_ONLY Aspen")!, sel);
    expect(lines[0].sell).toBe(out.roofing.sell);
    expect(lines[1].payout).toBe(out.gutters.payout);
  });
});

describe("plan book details", () => {
  it("skips zero-qty lines and ignores rounding on squares", () => {
    const tabs = workbook();
    const data = parsePlanBook(tabs);
    const a = findPlan(data.plans, "TEST_ONLY Aspen")!;
    expect(findPlan(data.plans, "TEST_ONLY Birch")!.roofing[0].materials.map((m) => m.name)).toEqual(["TEST_ONLY Shingle"]);
    const r = editOption(data, "ROOFING", a.roofing[0], a.roofing[0].materials, a.roofing[0].squares! + 0.004);
    expect(r.changes).toEqual([]);
    expect(r.option.sell).toBe(a.roofing[0].sell);
  });
});
