// TEST_ONLY builder plan books: a synthetic master sheet in the same block layout as a builder's real one
// (made-up models and prices — no real pricing), import, model pick, takeoff edits, order PDF, schedule, audit.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auditRows, buildOut, editOption, findPlan, modelLabel, moneyFindings, parsePlanBook, type Selection } from "@/lib/builders/plans";
import { activeBooks, getBook, importPlanBook, planOrderPdf, saveTakeoffEdit, scheduleHouse } from "@/lib/builders/planbook";

import { BOOT, FUEL, LAB, LMK, MK, TAX, toXlsx, workbook } from "./fixtures/plan-book";

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
