// TEST_ONLY builder houses: start-sheet PDF → plan-book pick → a sold job with planned costs, on the schedule.
// The start sheet is synthetic text in DR Horton's "Selected Option Summary" layout (made-up lot, address, permit).
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findStartPlan, parseStartText, readStartSheet, startSelection, startView, looksLikeStartSheet } from "@/lib/builders/starts";
import { createHouseJob, houseOf } from "@/lib/builders/house";
import { importPlanBook } from "@/lib/builders/planbook";
import { parsePlanBook } from "@/lib/builders/plans";
import { actualSplit, moneySlices } from "@/lib/costing/split";
import { toXlsx, workbook } from "./fixtures/plan-book";

const NAME = "TEST_ONLY House Homes";
afterAll(async () => {
  const co = await prisma.company.findMany({ where: { name: NAME }, select: { id: true } });
  await prisma.prodLine.deleteMany({ where: { builder: NAME } });
  await prisma.builderStart.deleteMany({ where: { createdBy: "TEST_ONLY house" } });
  await prisma.project.deleteMany({ where: { clientCompanyId: { in: co.map((c) => c.id) } } });
  await prisma.company.deleteMany({ where: { name: NAME } });
  await prisma.$disconnect();
});

const sheet = (o: { plan?: string; elev?: string; basement?: string; extra?: string } = {}) => `Selected Option Summary
${NAME.toUpperCase()} - METRO Date - . . . 01/02/26
7400 W. TEST_ONLY STREET Time - . . . 10:00:00
Revision # 001
Subdivision Name: TEST_ONLY Ridge
Subdivision Number: 000000000 Plan/Elevation/Swing: ${o.plan ?? "TEST_ONLY-ASPEN"} / ${o.elev ?? "B3"} / R
Business Unit ID#: 0099 Release to Construction: First PO Release: 01/02/26
Lot Address: 99 TEST_ONLY LN Milestone 1 - Start Date: Permit Number: TEST-0001
Lot City, St Zip: TESTVILLE , NE 68000
Lot/Block/Phase: 99 / /
Post Date Option Code Option Description Qty Rev #
01/02/26 Same E9700001 EXTERIOR PACKAGE C - VINYL SIDING 1 000
Note: PRIMARY SIDING - TEST GRAY
..............................................................................................................
u 01/02/26 ADD E0000230 10' x 10' WOOD DECK ILO STD. REAR PATIO - LOOK-OUT BSMNT 1 001
..............................................................................................................
u 01/02/26 ADD E0000009 ${o.basement ?? "BASEMENT - IN-GROUND"} 1 001
Note: 8' walls.
..............................................................................................................
${o.extra ?? ""}`;

describe("reading a start sheet", () => {
  it("reads the lot, address, plan, elevation and options", () => {
    const t = sheet();
    expect(looksLikeStartSheet(t)).toBe(true);
    const d = parseStartText(t)!;
    expect(d).toMatchObject({ subdivision: "TEST_ONLY Ridge", lot: "99", address: "99 Test_only Ln", city: "Testville, NE 68000", permit: "TEST-0001", planCode: "TEST_ONLY-ASPEN", elevationCode: "B3", swing: "R", revision: "001" });
    expect(d.options.map((o) => o.code)).toEqual(["E9700001", "E0000230", "E0000009"]);
    expect(d.options[0].note).toBe("PRIMARY SIDING - TEST GRAY");
  });
  it("maps the sheet to the plan-book pick and flags what it can't be sure of", () => {
    const data = parsePlanBook(workbook());
    const plan = findStartPlan(data, "TEST_ONLY-ASPEN")!;
    expect(plan.name).toBe("TEST_ONLY Aspen");
    expect(findStartPlan({ ...data, plans: [{ ...plan, name: "X999 TEST_ONLY Maple" }] }, "X999")?.name).toBe("X999 TEST_ONLY Maple");
    const a = startSelection(parseStartText(sheet())!, plan);
    expect(a.sel).toEqual({ elevation: "B", garage: "3", basement: "STANDARD", porch: false });
    expect(a.flags.some((f) => /Deck/.test(f))).toBe(true); // the deck line mentions LOOK-OUT BSMNT but isn't the basement
    expect(a.flags.some((f) => /Look-out/.test(f))).toBe(false);
    expect(a.color).toMatch(/Pkg C - VINYL SIDING: PRIMARY SIDING - TEST GRAY/);
    expect(startSelection(parseStartText(sheet({ basement: "BASEMENT - WALK-OUT" }))!, plan).sel.basement).toBe("DLWO");
    expect(startSelection(parseStartText(sheet({ basement: "OPTIONAL UNFINISHED BASEMENT -LOOK-OUT" }))!, plan).flags.some((f) => /Look-out basement/.test(f))).toBe(true);
    const z = startSelection(parseStartText(sheet({ elev: "Z2" }))!, plan);
    expect(z.flags.some((f) => /Elevation “Z2”/.test(f))).toBe(true);
    expect(z.sel.garage).toBe("2");
  });
});

describe("money split", () => {
  it("splits sell into materials, tax, labor, other and profit; a loss isn't a slice", () => {
    const m = moneySlices({ revenue: 1000, materials: 400, tax: 40, labor: 300, other: 0 });
    expect(m.slices.map((s) => [s.key, s.value])).toEqual([["materials", 400], ["tax", 40], ["labor", 300], ["profit", 260]]);
    expect(moneySlices({ revenue: 100, materials: 150, tax: 0, labor: 0, other: 0 }).loss).toBe(50);
    expect(actualSplit([{ category: "MATERIALS", amount: 100, description: "Shingles" }, { category: "MATERIALS", amount: 7, description: "Sales tax" }, { category: "SUBCONTRACTOR", amount: 50, description: "Crew" }, { category: "DISPOSAL", amount: 5, description: "Dumpster" }])).toEqual({ materials: 100, tax: 7, labor: 50, other: 5 });
  });
});

describe("start sheet → job", () => {
  it("adds the house: a sold job with planned costs, linked schedule lines, the start marked done; never twice", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: admin.id, name: "TEST_ONLY house", role: "ADMIN" };
    const co = await prisma.company.create({ data: { name: NAME, type: "BUILDER" } });
    await importPlanBook(co.id, { bytes: await toXlsx(workbook()), label: "Metro" }, actor);
    const pdf = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), name: "TEST_ONLY start.pdf" };
    const { start, duplicate } = await readStartSheet(pdf, actor, sheet());
    expect(duplicate).toBe(false);
    expect((await readStartSheet(pdf, actor, sheet())).duplicate).toBe(true);
    const v = (await startView(start.id))!;
    expect(v.company?.id).toBe(co.id);
    expect(v.plan?.name).toBe("TEST_ONLY Aspen");

    await expect(createHouseJob(v.book!.id, v.plan!.name, v.sel, { address: "", trades: ["ROOFING"] }, actor)).rejects.toThrow(/address/);
    await expect(createHouseJob(v.book!.id, v.plan!.name, v.sel, { address: "x", trades: ["ROOFING"] }, { ...actor, role: "VIEWER" })).rejects.toThrow(/role/);
    const r = await createHouseJob(v.book!.id, v.plan!.name, v.sel, { lot: v.data.lot, subdivision: v.data.subdivision, address: v.data.address!, city: v.data.city, permit: v.data.permit, trades: ["ROOFING", "GUTTERS"], color: v.color, startId: start.id }, actor);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: r.project.id }, include: { prodLines: true } });
    expect(p.name).toBe("Lot 99 TEST_ONLY Ridge · 99 Test_only Ln — TEST_ONLY Aspen · Elev B · 3 Car");
    expect(p.status).toBe("SOLD");
    expect(p.clientCompanyId).toBe(co.id);
    const h = houseOf(p)!;
    expect(p.contractAmount).toBeCloseTo(h.trades.ROOFING!.sell + h.trades.GUTTERS!.sell, 2);
    expect(h.trades.ROOFING!.profit).toBeCloseTo(h.trades.ROOFING!.sell - h.trades.ROOFING!.payout - h.trades.ROOFING!.materials - h.trades.ROOFING!.tax, 2);
    const b = p.costBaseline as { materials: number; materialTax: number; labor: number };
    expect(b.labor).toBeCloseTo(h.trades.ROOFING!.payout + h.trades.GUTTERS!.payout, 2);
    expect(b.materialTax).toBeCloseTo(b.materials * 0.1, 2);
    expect(p.prodLines.map((l) => [l.type, l.board, l.builder])).toEqual([
      ["Roofing", "ADD", NAME],
      ["Gutters", "ADD", NAME],
    ]);
    expect((await prisma.builderStart.findUniqueOrThrow({ where: { id: start.id } })).status).toBe("SCHEDULED");
  });
});

describe("builder names on start sheets", () => {
  it("matches “D.R. HORTON - KANSAS CITY” style names to the builder account", async () => {
    const { matchStart } = await import("@/lib/builders/starts");
    const co = await prisma.company.create({ data: { name: "TEST_ONLY Q.R. Builders", type: "BUILDER" } });
    try {
      const m = await matchStart({ ...parseStartText(sheet())!, builder: "T.E.S.T._ONLY Q.R. BUILDERS - METRO" });
      expect(m.company).toBeNull(); // nothing close
      const m2 = await matchStart({ ...parseStartText(sheet())!, builder: "TEST_ONLY Q.R. BUILDERS - METRO" });
      expect(m2.company?.id).toBe(co.id);
    } finally {
      await prisma.company.delete({ where: { id: co.id } });
    }
  });
});
