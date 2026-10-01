import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addManualMeasurement } from "@/lib/docs/confirm";
import { runTakeoff, setWaste } from "@/lib/estimates/service";
import { applyTemplate, createEstimateFromTemplate, saveAsTemplate, updateTemplateMeta } from "@/lib/estimates/templates";
import { sidingTakeoff } from "@/lib/calc/siding";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});
const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};
const tpl = (key: string) => prisma.estimateTemplate.findUniqueOrThrow({ where: { key } });

describe("built-in templates", () => {
  it("every built-in pick is a real item on the loaded sheets, and Class 4 only where the sheet says so", async () => {
    const items = new Set(readFileSync("data/price_items.csv", "utf8").split("\n").slice(1).map((l) => l.split(",")[3]));
    const all = await prisma.estimateTemplate.findMany({ where: { builtIn: true } });
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const t of all) for (const m of JSON.stringify(t.config).match(/"itemNumber":"([^"]+)"/g) ?? []) expect(items.has(m.slice(14, -1))).toBe(true);
    for (const t of all.filter((x) => x.impactClass === "CLASS_4")) expect(t.impactSource).toMatch(/IR|Impact|CLASS 4/);
    expect(all.find((t) => t.key === "lp-smartside-lap")!.notes).toMatch(/No LP SmartSide sheet/);
  });
});

describe("using templates", () => {
  async function job() {
    const a = await admin();
    const p = await createProject({ name: `TEST_ONLY Template job ${Math.random().toString(36).slice(2, 6)}`, market: "RESIDENTIAL", scopes: ["STEEP"], address: "4 Tpl Rd", isPublic: false, isTaxExempt: false }, a, { firstName: "T", lastName: "Owner" });
    for (const [key, value] of Object.entries({ roof_total_sf: 3000, eaves_lf: 150, rakes_lf: 100, ridges_lf: 40, hips_lf: 60, drip_edge_lf: 250, siding_sf: 1850 }))
      await addManualMeasurement(p.id, { key, value, facet: null, source: "TEST_ONLY" }, a);
    return { a, p };
  }

  it("GAF HDZ template: new estimate, takeoff runs with the GAF system products", async () => {
    const { a, p } = await job();
    const { estimate } = await createEstimateFromTemplate(p.id, (await tpl("gaf-hdz")).id, a);
    await runTakeoff(estimate.id, "steep", a);
    const lines = await prisma.estimateLine.findMany({ where: { estimateId: estimate.id } });
    const nums = lines.map((l) => l.supplierItemNumber);
    expect(nums).toEqual(expect.arrayContaining(["02GASTZ3CH", "04GAPST", "04GASR2CH", "11GATP10", "17GACSCA"]));
    const shingles = lines.find((l) => l.supplierItemNumber === "02GASTZ3CH")!;
    expect(shingles.total).toBeGreaterThan(0);
    const act = await prisma.projectActivity.findFirst({ where: { projectId: p.id, text: { contains: "applied template" } } });
    expect(act?.text).toMatch(/Timberline HDZ/);
  });

  it("won't apply a siding template to a steep estimate", async () => {
    const { a, p } = await job();
    const { estimate } = await createEstimateFromTemplate(p.id, (await tpl("mal-vista")).id, a);
    await expect(applyTemplate(estimate.id, (await tpl("ndx-woodsman")).id, a)).rejects.toThrow(/siding template/);
  });

  it("vinyl is ordered by the square from siding SF and waste", async () => {
    const { a, p } = await job();
    const { estimate } = await createEstimateFromTemplate(p.id, (await tpl("ndx-woodsman")).id, a);
    await setWaste(estimate.id, "SIDING", 5, true, a);
    await runTakeoff(estimate.id, "siding", a);
    const vinyl = await prisma.estimateLine.findFirstOrThrow({ where: { estimateId: estimate.id, supplierItemNumber: "22NXWM4DWH" } });
    expect(vinyl.unit).toBe("SQ");
    expect(vinyl.formula).toMatch(/÷ 100 SF\/SQ/);
  });

  it("saving an estimate's picks as a template; impact class needs a source; built-ins are Admin-only to change", async () => {
    const { a, p } = await job();
    const { estimate } = await createEstimateFromTemplate(p.id, (await tpl("ct-landmark")).id, a);
    await expect(saveAsTemplate(estimate.id, { module: "steep", name: "TEST_ONLY CT Landmark Weathered Wood", category: "SHINGLE", group: "Class 3", brand: "CertainTeed", impactClass: "CLASS_3", impactSource: null, notes: null }, a)).rejects.toThrow(/where the impact class comes from/);
    const t = await saveAsTemplate(estimate.id, { module: "steep", name: "TEST_ONLY CT Landmark Weathered Wood", category: "SHINGLE", group: "Class 3", brand: "CertainTeed", impactClass: "CLASS_3", impactSource: "TEST_ONLY spec sheet", notes: null }, a);
    expect(t.builtIn).toBe(false);
    await expect(saveAsTemplate(estimate.id, { module: "steep", name: "x", category: "SHINGLE", group: "g", brand: null, impactClass: null, impactSource: null, notes: null, replaceId: (await tpl("ct-landmark")).id }, { ...a, role: "ESTIMATOR" })).rejects.toThrow(/Admin/);
    await expect(updateTemplateMeta(t.id, { name: "x", group: "g", impactClass: null, impactSource: null, notes: null, active: false }, { ...a, role: "ESTIMATOR" })).rejects.toThrow(/Admin/);
  });
});

describe("siding sold by the square", () => {
  it("calculates SQ with waste and no exposure math", () => {
    const [l] = sidingTakeoff({
      sidingSf: { value: 1850, source: "TEST_ONLY" },
      waste: { pct: 5, approved: true, basis: "TEST_ONLY" },
      plank: { itemNumber: "22NXWM4DWH", name: "Woodsman", exposureIn: { value: null, source: "n/a" }, lengthFt: { value: null, source: "n/a" }, soldBySquare: true },
      houseWrap: null,
      trim: [],
      counted: [],
    });
    expect(l).toMatchObject({ quantity: 20, unit: "SQ" });
  });
});

describe("piece-rate labor and BTR company data", () => {
  it("computes quantity × $/unit, and standards from the Drive price book are loaded with sources", async () => {
    const { computeLabor } = await import("@/lib/estimates/labor");
    expect(computeLabor({ quantity: 32.4, productionRate: null, hourlyRate: null, burdenPct: null, unitRate: 90, unit: "SQ" })).toMatchObject({ total: 2916, formula: "32.4 SQ × $90/SQ = $2916" });
    const std = await prisma.laborStandard.findFirstOrThrow({ where: { seedKey: "rf-tearoff-install-lam" } });
    expect(std).toMatchObject({ rateType: "UNIT", unitRate: 90, unit: "SQ" });
    expect(std.source).toMatch(/Labor pricing/);
    expect(await prisma.crew.count({ where: { name: "ONIX Construction" } })).toBe(1);
    expect(await prisma.company.findFirst({ where: { name: "Hildy Homes" } })).toMatchObject({ type: "BUILDER", pricingFallback: null });
  });

  it("a piece-rate standard on an estimate: priced from the standard, and the unit must match", async () => {
    const { addLaborLine } = await import("@/lib/estimates/labor");
    const a = await admin();
    const p = await createProject({ name: `TEST_ONLY Piece ${Math.random().toString(36).slice(2, 6)}`, market: "RESIDENTIAL", scopes: ["STEEP"], address: "1 Pc St", isPublic: false, isTaxExempt: false }, a, { firstName: "P", lastName: "R" });
    const { estimate } = await createEstimateFromTemplate(p.id, (await tpl("mal-vista")).id, a);
    const std = await prisma.laborStandard.findFirstOrThrow({ where: { seedKey: "rf-tearoff-install-lam" } });
    await expect(addLaborLine(estimate.id, { task: "Install", quantity: 3000, quantityUnit: "SF", quantitySource: "roof", standardId: std.id }, a)).rejects.toThrow(/priced per SQ/);
    const l = await addLaborLine(estimate.id, { task: "Tear-off & install", quantity: 30, quantityUnit: "SQ", quantitySource: "roof", standardId: std.id }, a);
    expect(l).toMatchObject({ total: 2700, unitRate: 90, sourceStatus: "VERIFIED" });
  });
});
