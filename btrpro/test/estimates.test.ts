import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject, refreshReadiness, updateIntakeField } from "@/lib/projects/service";
import { addManualMeasurement } from "@/lib/docs/confirm";
import {
  addLine,
  cheapestWrapOnSheet,
  createEstimate,
  createRevision,
  diffEstimates,
  overrideQuantity,
  runTakeoff,
  saveTakeoff,
  setWaste,
  substituteLine,
  totalsFor,
} from "@/lib/estimates/service";
import { addLaborLine, computeLabor, saveLaborStandard } from "@/lib/estimates/labor";
import { rulesForEstimate } from "@/lib/estimates/rules";
import type { SteepConfig } from "@/lib/estimates/takeoff";

// Sheet-date statuses depend on "today"; pin it so results don't drift.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});

const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};

async function residentialShingleJob() {
  const a = await admin();
  const p = await createProject(
    { name: "TEST_ONLY Res shingle", market: "RESIDENTIAL", scopes: ["STEEP"], constructionType: "REROOF", address: "1 Test St", buildingUse: "Single-family", isPublic: false, isTaxExempt: false },
    a,
  );
  for (const [key, value] of Object.entries({ roof_total_sf: 3240, eaves_lf: 180, rakes_lf: 120, ridges_lf: 40, hips_lf: 95 }))
    await addManualMeasurement(p.id, { key, value, facet: null, source: "TEST_ONLY EagleView p.1" }, a);
  return { p, a };
}

const steepConfig = (over: Partial<SteepConfig> = {}): SteepConfig => ({
  shingle: { itemNumber: "02MLVIA3AB" },
  starter: { itemNumber: "04MLWSSAB" },
  hipRidge: { itemNumber: "04MLHR12AB" },
  ridgeVent: { itemNumber: null },
  underlayment: { itemNumber: null },
  iceWater: { itemNumber: null, rows: [] },
  dripEdge: { itemNumber: null },
  stepFlashing: { itemNumber: null, unit: "BX" },
  pipeBoot: { itemNumber: null },
  ...over,
});

describe("estimate builder", () => {
  it("residential steep: 5% waste is pre-approved and the takeoff prices from the sheets", async () => {
    const { p, a } = await residentialShingleJob();
    const e = await createEstimate(p.id, "STEEP", a);
    expect(e.wasteApproved).toBe(true);
    await saveTakeoff(e.id, "steep", steepConfig());
    await runTakeoff(e.id, "steep", a);
    const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    const by = (k: string) => lines.find((l) => l.calcKey === `steep:${k}`)!;
    // The takeoff counts 103 bundles; the sheet sells Vista AR by the SQ at 3 BD/SQ (printed on the item).
    expect(by("shingles")).toMatchObject({ quantity: 34.3333, unit: "SQ", unitCost: 138, total: 4738, sourceStatus: "SHEET_STALE", note: "Order 103 BD." });
    expect(by("shingles").formula).toBe("ceil(32.4 SQ × 1.05 × 3 BD/SQ) = 103 BD → 103 BD ÷ 3 BD/SQ = 34.333 SQ (sheet sells by SQ)");
    expect(by("coil_nails")).toMatchObject({ quantity: 3, unitCost: 40, total: 120, sourceStatus: "SHEET_STALE", ruleId: "ROOF-02" });
    expect(by("cap_nails")).toMatchObject({ quantity: 3, unitCost: 19.99, total: 59.97 });
    expect(by("hip_ridge")).toMatchObject({ quantity: 6, unitCost: 68.75 });
    expect(by("ridge_vent")).toMatchObject({ quantity: null, sourceStatus: "MISSING" });
    expect((await totalsFor(e.id)).incomplete).toBe(true);

    const rules = await rulesForEstimate(e.id, null);
    const r = (id: string) => rules.find((x) => x.id === id)!;
    expect(r("ROOF-03")).toMatchObject({ status: "pass", message: "Cap nails present — 3 BX" });
    expect(r("ROOF-07").status).toBe("pass");
    expect(r("ROOF-01").status).toBe("pass");
    expect(r("ROOF-06").message).toMatch(/company 30-yr default/);
  });

  it("waste gate: residential waste other than 5% needs an Admin", async () => {
    const { p, a } = await residentialShingleJob();
    const e = await createEstimate(p.id, "STEEP", a);
    const est = { id: a.id, name: "TEST_ONLY Estimator", role: "ESTIMATOR" };
    await expect(setWaste(e.id, "ROOFING", 10, true, est)).rejects.toThrow(/Admin/);
    await setWaste(e.id, "ROOFING", 10, false, est); // entered but not approved
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: e.id } })).wasteApproved).toBe(false);
    await setWaste(e.id, "ROOFING", 10, true, a);
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: e.id } })).wasteApproved).toBe(true);
  });

  it("commercial waste starts unset and unapproved", async () => {
    const a = await admin();
    const p = await createProject({ name: "TEST_ONLY Com", market: "COMMERCIAL", scopes: ["LOW_SLOPE"], isPublic: false, isTaxExempt: false }, a);
    const e = await createEstimate(p.id, "LOW_SLOPE", a);
    expect(e.wasteApproved).toBe(false);
    await expect(runTakeoff(e.id, "lowSlope", a)).rejects.toThrow(/Pick the roof system/);
  });

  it("manual lines: unknown item numbers are MISSING_ITEM; user-priced lines need a source; substitutions are logged", async () => {
    const { p, a } = await residentialShingleJob();
    const e = await createEstimate(p.id, "STEEP", a);
    const missing = await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "NOT-ON-SHEET-1", itemName: "Spec'd vent", quantity: 4, unit: "EA" }, a);
    expect(missing.sourceStatus).toBe("MISSING_ITEM");
    await expect(addLine(e.id, { section: "GENERAL_CONDITIONS", itemName: "Dumpster", quantity: 1, unit: "EA", unitCost: 450 }, a)).rejects.toThrow(/where the price came from/);
    const dump = await addLine(e.id, { section: "GENERAL_CONDITIONS", itemName: "Dumpster 30 yd", quantity: 1, unit: "EA", unitCost: 450, source: "TEST_ONLY vendor quote 9/28" }, a);
    expect(dump).toMatchObject({ sourceStatus: "VERIFIED", total: 450 });
    await expect(substituteLine(missing.id, "4292804534", "", a)).rejects.toThrow(/reason/);
    await substituteLine(missing.id, "4292804534", "TEST_ONLY approved by PM", a);
    const sub = await prisma.estimateLine.findUniqueOrThrow({ where: { id: missing.id } });
    expect(sub).toMatchObject({ substitution: true, supplierItemNumber: "4292804534", total: 79.96 });
    expect(await prisma.auditLog.count({ where: { entityId: missing.id, action: "substitute" } })).toBe(1);
    await expect(overrideQuantity(dump.id, 2, "", a)).rejects.toThrow(/why/);
  });

  it("revisions lock the old one and diff quantity/price changes", async () => {
    const { p, a } = await residentialShingleJob();
    const r1 = await createEstimate(p.id, "STEEP", a);
    await saveTakeoff(r1.id, "steep", steepConfig());
    await runTakeoff(r1.id, "steep", a);
    const r2 = await createRevision(r1.id, a);
    expect(r2.name).toBe("Rev 2");
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: r1.id } })).locked).toBe(true);
    await expect(runTakeoff(r1.id, "steep", a)).rejects.toThrow(/locked/);
    const coil = await prisma.estimateLine.findFirstOrThrow({ where: { estimateId: r2.id, calcKey: "steep:coil_nails" } });
    await overrideQuantity(coil.id, 4, "TEST_ONLY extra for detached garage", a);
    const d = await diffEstimates(r1.id, r2.id);
    expect(d.lines).toEqual([expect.objectContaining({ key: "steep:coil_nails", change: "changed", before: expect.objectContaining({ qty: 3 }), after: expect.objectContaining({ qty: 4, total: 160 }) })]);
  });
});

describe("labor", () => {
  it("computes hours and cost: hours = qty ÷ rate; total = hours × rate × (1 + burden)", () => {
    expect(computeLabor({ quantity: 32.4, productionRate: 1.5, hourlyRate: 30, burdenPct: 25 })).toMatchObject({ laborHours: 21.6, total: 810 });
    expect(computeLabor({ quantity: 32.4, productionRate: null, hourlyRate: 30, burdenPct: 25 }).missing).toEqual(["production rate"]);
  });

  it("status comes from where the rate came from", async () => {
    const { p, a } = await residentialShingleJob();
    const e = await createEstimate(p.id, "STEEP", a);
    const noSource = await addLaborLine(e.id, { task: "Tear-off & install", quantity: 32.4, quantityUnit: "SQ", quantitySource: "roof SQ", productionRate: 1.5, hourlyRate: 30, burdenPct: 25 }, a);
    expect(noSource.sourceStatus).toBe("MISSING");
    const ph = await addLaborLine(e.id, { task: "Tear-off & install", quantity: 32.4, quantityUnit: "SQ", quantitySource: "roof SQ", productionRate: 1.5, hourlyRate: 30, burdenPct: 25, placeholder: true }, a);
    expect(ph).toMatchObject({ sourceStatus: "PLACEHOLDER", total: 810 });
    const std = await saveLaborStandard({ task: "TEST_ONLY shingle install", productionRate: 1.5, unit: "SQ", crewSize: 4, hourlyRate: 30, burdenPct: 25, source: "TEST_ONLY BTR 2025 average" }, a);
    const v = await addLaborLine(e.id, { task: "Install", quantity: 32.4, quantityUnit: "SQ", quantitySource: "roof SQ", standardId: std.id }, a);
    expect(v).toMatchObject({ sourceStatus: "VERIFIED", laborHours: 21.6, total: 810 });
  });
});

describe("readiness end to end", () => {
  it("goes NOT_READY → BUDGET → BID_READY as blockers clear", async () => {
    const a = await admin();
    const p = await createProject(
      { name: "TEST_ONLY Ready", market: "RESIDENTIAL", scopes: ["STEEP"], constructionType: "NEW", address: "2 Test St", buildingUse: "Single-family", isPublic: false, isTaxExempt: false },
      a,
    );
    for (const f of await prisma.intakeField.findMany({ where: { projectId: p.id, status: "MISSING" } }))
      await updateIntakeField(p.id, f.key, { value: "TEST_ONLY", unit: null, status: "VERIFIED", note: "TEST_ONLY" }, a);
    const e = await createEstimate(p.id, "STEEP", a);
    const line = await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "4292804534", itemName: "", quantity: 3, unit: "BX" }, a);
    expect((await refreshReadiness(p.id)).readiness).toBe("NOT_READY"); // no labor
    await addLaborLine(e.id, { task: "Install", quantity: 1, quantityUnit: "EA", quantitySource: "TEST", productionRate: 1, hourlyRate: 10, burdenPct: 0, placeholder: true }, a);
    expect((await refreshReadiness(p.id)).readiness).toBe("BUDGET"); // placeholder labor
    await prisma.laborLine.updateMany({ where: { estimateId: e.id }, data: { sourceStatus: "VERIFIED" } });
    // sheets are STALE on 9/29, not expired, so the priced line doesn't block
    expect(line.sourceStatus).toBe("SHEET_STALE");
    expect((await refreshReadiness(p.id)).readiness).toBe("BID_READY");
  });
});

describe("SID-04", () => {
  it("finds the cheapest wrap on the Norandex sheet", async () => {
    const w = await cheapestWrapOnSheet("NX");
    expect(w).not.toBeNull();
    expect(await cheapestWrapOnSheet("SS")).toBeNull();
  });
});
