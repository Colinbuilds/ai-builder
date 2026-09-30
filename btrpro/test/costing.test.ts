import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addLine, createEstimate } from "@/lib/estimates/service";
import { addLaborLine } from "@/lib/estimates/labor";
import { saveSettings } from "@/lib/settings";
import { computePnl, crewCost, type PnlInput } from "@/lib/costing/pnl";
import { parseInvoiceCsv } from "@/lib/costing/invoice-csv";
import {
  addChangeOrder,
  addCommitment,
  addCost,
  canSeeCosts,
  closeCosting,
  closeoutProblems,
  decideChangeOrder,
  deleteCost,
  freezeBaseline,
  importInvoices,
  loadCosting,
  previewInvoiceImport,
  reopenCosting,
  saveCommissionPlan,
  setNoneExpected,
} from "@/lib/costing/service";

process.env.UPLOAD_DIR = "prisma/test-uploads";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});

const base: PnlInput = {
  contractAmount: 20000,
  changeOrders: [],
  baseline: { estimateId: "e", estimateName: "E", revision: 1, materials: 8000, materialTax: 560, taxNote: "", generalConditions: 1000, labor: 5000, contingency: 440, frozenBy: "x" },
  costs: [],
  commitments: [],
  overheadPct: null,
  thresholdPct: null,
  commission: null,
};

describe("P&L math", () => {
  it("revenue counts only approved change orders, and credits subtract", () => {
    const p = computePnl({
      ...base,
      changeOrders: [
        { kind: "CHANGE_ORDER", status: "APPROVED", amount: 1500, costImpact: 900 },
        { kind: "SUPPLEMENT", status: "PENDING", amount: 3000, costImpact: null },
        { kind: "CREDIT", status: "APPROVED", amount: 250, costImpact: null },
      ],
    });
    expect(p.revenue).toBe(21250);
    expect(p.estimated).toBe(8560 + 1000 + 5000 + 440 + 900);
  });

  it("no contract → revenue, profit, and margin are MISSING (null), never zero", () => {
    const p = computePnl({ ...base, contractAmount: null, costs: [{ category: "MATERIALS", amount: 100 }] });
    expect(p.revenue).toBeNull();
    expect(p.grossProfit).toBeNull();
    expect(p.grossMarginPct).toBeNull();
    expect(p.actual).toBe(100);
    expect(p.missing).toContain("Contract amount");
  });

  it("rolls categories into estimate buckets, projects with open commitments, and flags over threshold", () => {
    const p = computePnl({
      ...base,
      thresholdPct: 5,
      costs: [
        { category: "MATERIALS", amount: 8700 },
        { category: "MATERIALS", amount: -200 },
        { category: "LABOR", amount: 2000 },
        { category: "SUBCONTRACTOR", amount: 1000, commitmentId: "c1" },
        { category: "DISPOSAL", amount: 450 },
      ],
      commitments: [
        { id: "c1", category: "SUBCONTRACTOR", amount: 3000, status: "OPEN" },
        { id: "c2", category: "EQUIPMENT", amount: 999, status: "CANCELLED" },
      ],
    });
    expect(p.actual).toBe(11950);
    expect(p.committed).toBe(2000); // 3000 sub proposal − 1000 already billed
    expect(p.projected).toBe(13950);
    const m = p.buckets.find((b) => b.bucket === "materials")!;
    expect(m).toMatchObject({ estimated: 8560, actual: 8500, flagged: false });
    const l = p.buckets.find((b) => b.bucket === "labor")!;
    expect(l).toMatchObject({ estimated: 5000, projected: 5000, flagged: false });
    expect(p.grossProfit).toBe(8050);
    expect(p.projectedGrossProfit).toBe(6050);
    expect(p.projectedMarginPct).toBe(30.3);
    const over = computePnl({ ...base, thresholdPct: 5, costs: [{ category: "PERMITS", amount: 1100 }] });
    expect(over.buckets.find((b) => b.bucket === "generalConditions")).toMatchObject({ variance: 100, variancePct: 10, flagged: true });
  });

  it("net profit stays MISSING until overhead and a commission plan are set", () => {
    expect(computePnl(base).netProfit).toBeNull();
    const p = computePnl({ ...base, overheadPct: 10, commission: { basis: "GROSS_PROFIT", pct: 10, person: "Sam" }, costs: [{ category: "MATERIALS", amount: 10000 }] });
    expect(p.overhead).toBe(2000);
    expect(p.commission).toBe(1000);
    expect(p.netProfit).toBe(7000);
    expect(p.commissionFormula).toMatch(/Sam/);
  });

  it("crew hours cost shows its formula", () => {
    expect(crewCost(40, 32, 28)).toEqual({ amount: 1638.4, formula: "40 h × $32/h × (1 + 28% burden) = 1638.40" });
  });
});

describe("supplier invoice CSV", () => {
  it("finds headers, carries the invoice # down, computes qty × price only when there's no amount, and reports bad rows", () => {
    const csv = [
      "TEST_ONLY ABC Supply export",
      "Invoice #,Invoice Date,PO,Item #,Description,Qty,UOM,Unit Price,Extended",
      "INV-1,09/12/2026,JOHNSON,02MLVIA3AB,Vista AR 252,33,SQ,138.00,4554.00",
      ",,JOHNSON,04MLWSSAB,Windsor Starter,2,BD,126.50,",
      "INV-2,2026-09-15,OTHER JOB,X1,Return pallet,1,EA,,(40.00)",
      "INV-2,,OTHER JOB,X2,Mystery line,,EA,,",
      ",,,,Invoice Total,,,,4717.00",
    ].join("\n");
    const r = parseInvoiceCsv(csv);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[1]).toMatchObject({ invoice: "INV-1", date: "2026-09-12", amount: 253, formula: "2 × 126.5 = 253.00" });
    expect(r.rows[2]).toMatchObject({ amount: -40, date: "2026-09-15" });
    expect(r.problems[0]).toMatch(/Mystery line.*no amount/);
    expect(r.pos).toEqual(["JOHNSON", "OTHER JOB"]);
  });

  it("no amount or price column → nothing imported, and says why", () => {
    expect(parseInvoiceCsv("a,b\n1,2").problems[0]).toMatch(/header/);
  });
});

async function actors() {
  const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const est = await prisma.user.upsert({ where: { email: "est-cost@test.local" }, update: {}, create: { email: "est-cost@test.local", name: "TEST_ONLY Estimator", passwordHash: "x", role: "ESTIMATOR" } });
  return { admin: { id: a.id, name: a.name, role: "ADMIN" as const }, est: { id: est.id, name: est.name, role: "ESTIMATOR" as const } };
}

async function soldJob() {
  const { admin, est } = await actors();
  const p = await createProject({ name: `TEST_ONLY Costing ${Math.random().toString(36).slice(2, 6)}`, market: "RESIDENTIAL", scopes: ["STEEP"], address: "1 Cost St", isPublic: false, isTaxExempt: false }, admin);
  await prisma.project.update({ where: { id: p.id }, data: { contractAmount: 15000, estimatorId: est.id, salespersonId: est.id } });
  const e = await createEstimate(p.id, "STEEP", admin);
  await addLine(e.id, { section: "MATERIAL_ROOFING", itemName: "Shingles", quantity: 33, unit: "SQ", unitCost: 138, source: "TEST_ONLY" }, admin);
  await addLine(e.id, { section: "GENERAL_CONDITIONS", itemName: "Dumpster", quantity: 1, unit: "EA", unitCost: 450, source: "TEST_ONLY quote" }, admin);
  await addLaborLine(e.id, { task: "Install", quantity: 33, quantityUnit: "SQ", quantitySource: "roof", productionRate: 1, hourlyRate: 60, burdenPct: 0, rateSource: "TEST_ONLY" }, admin);
  return { admin, est, p, e };
}

describe("job costing service", () => {
  it("baseline: frozen once from a complete estimate; only an Admin replaces it, with a reason", async () => {
    const { admin, est, p, e } = await soldJob();
    await saveSettings({ salesTaxPct: 7 }, admin);
    const b = await freezeBaseline(p.id, e.id, est);
    expect(b).toMatchObject({ materials: 4554, materialTax: 318.78, generalConditions: 450 });
    await expect(freezeBaseline(p.id, e.id, est)).rejects.toThrow(/Only an Admin/);
    await expect(freezeBaseline(p.id, e.id, admin)).rejects.toThrow(/why/);
    await freezeBaseline(p.id, e.id, admin, "TEST_ONLY re-freeze");
    expect(await prisma.auditLog.count({ where: { entity: "Project.costBaseline", entityId: p.id } })).toBe(1);
    await saveSettings({ salesTaxPct: null }, admin);
  });

  it("permissions: viewers never, estimators their own jobs, admins all", async () => {
    const { est } = await actors();
    expect(canSeeCosts({ id: "v", role: "VIEWER" }, { estimatorId: null, salespersonId: null })).toBe(false);
    expect(canSeeCosts({ id: est.id, role: "ESTIMATOR" }, { estimatorId: "someone-else", salespersonId: null })).toBe(false);
    expect(canSeeCosts({ id: est.id, role: "ESTIMATOR" }, { estimatorId: est.id, salespersonId: null })).toBe(true);
    expect(canSeeCosts({ id: "a", role: "ADMIN" }, { estimatorId: "x", salespersonId: "y" })).toBe(true);
    const { p } = await soldJob();
    await prisma.project.update({ where: { id: p.id }, data: { estimatorId: null, salespersonId: (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id } });
    await expect(addCost(p.id, { category: "OTHER", date: new Date(), vendor: "X", description: "y", amount: 5 }, est)).rejects.toThrow(/access/);
  });

  it("cost entry validates, computes crew hours, and deletes are audit-logged", async () => {
    const { est, p } = await soldJob();
    await expect(addCost(p.id, { category: "MATERIALS", date: new Date(), vendor: "", description: "x", amount: 5 }, est)).rejects.toThrow(/vendor/);
    await expect(addCost(p.id, { category: "MATERIALS", date: new Date(), vendor: "ABC", description: "x", amount: null }, est)).rejects.toThrow(/amount/);
    await expect(addCost(p.id, { category: "LABOR", date: new Date(), vendor: "Crew A", description: "Tear-off", kind: "CREW_HOURS", hours: 10, rate: 30, burdenPct: null }, est)).rejects.toThrow(/burden/);
    const c = await addCost(p.id, { category: "LABOR", date: new Date(), vendor: "Crew A", description: "Tear-off", kind: "CREW_HOURS", hours: 10, rate: 30, burdenPct: 20 }, est);
    expect(c).toMatchObject({ amount: 360, formula: "10 h × $30/h × (1 + 20% burden) = 360.00" });
    await expect(deleteCost(c.id, "", est)).rejects.toThrow(/why/);
    await deleteCost(c.id, "TEST_ONLY entered twice", est);
    expect(await prisma.auditLog.count({ where: { entity: "JobCost", entityId: c.id, action: "delete" } })).toBe(1);
  });

  it("imports ABC invoice lines once, flags prices that differ from the sheet, and filters by PO", async () => {
    const { est, p } = await soldJob();
    const csv = [
      "Invoice #,Invoice Date,PO,Item #,Description,Qty,UOM,Unit Price,Extended,Tax",
      "TEST-INV-77,09/12/2026,COSTJOB,02MLVIA3AB,Vista AR 252,33,SQ,141.00,4653.00,325.71",
      "TEST-INV-77,09/12/2026,COSTJOB,04MLWSSAB,Windsor Starter,2,BD,126.50,253.00,17.71",
      "TEST-INV-78,09/13/2026,ELSEWHERE,04MLWSSAB,Windsor Starter,1,BD,126.50,126.50,",
    ].join("\n");
    const prev = await previewInvoiceImport(p.id, csv);
    expect(prev.rows[0].priceFlag).toMatch(/billed \$141.00\/SQ vs \$138.00/);
    expect(prev.rows[1].priceFlag).toBeNull();
    const r = await importInvoices(p.id, csv, { pos: ["COSTJOB"], vendor: "ABC Supply" }, est);
    expect(r).toMatchObject({ count: 3, total: 4653 + 253 + 343.42, flagged: 1 });
    await expect(importInvoices(p.id, csv, { pos: ["COSTJOB"], vendor: "ABC Supply" }, est)).rejects.toThrow(/already imported/);
    const again = await previewInvoiceImport(p.id, csv);
    expect(again.rows.filter((x) => x.status === "DUPLICATE")).toHaveLength(2);
  });

  it("change orders only count once approved; decided ones are Admin-only to change", async () => {
    const { admin, est, p } = await soldJob();
    const co = await addChangeOrder(p.id, { kind: "SUPPLEMENT", description: "TEST_ONLY adjuster added drip edge", amount: 800, costImpact: 350, source: "TEST_ONLY" }, est);
    expect(co.number).toBe("SUP-001");
    expect((await loadCosting(p.id)).pnl.revenue).toBe(15000);
    await decideChangeOrder(co.id, "APPROVED", est);
    expect((await loadCosting(p.id)).pnl.revenue).toBe(15800);
    await expect(decideChangeOrder(co.id, "REJECTED", est)).rejects.toThrow(/Only an Admin/);
    await decideChangeOrder(co.id, "REJECTED", admin);
  });

  it("close-out needs every category billed or marked none-expected, no open commitments, then locks to Admin", async () => {
    const { admin, est, p, e } = await soldJob();
    await freezeBaseline(p.id, e.id, est);
    const sub = await addCommitment(p.id, { category: "SUBCONTRACTOR", vendor: "TEST_ONLY Gutter Co", description: "Gutters", amount: 1200 }, est);
    let problems = await closeoutProblems(p.id);
    expect(problems.join(" ")).toMatch(/materials costs/);
    expect(problems.join(" ")).toMatch(/1200.00 is still committed/);
    await addCost(p.id, { category: "SUBCONTRACTOR", date: new Date(), vendor: "TEST_ONLY Gutter Co", description: "Gutters", amount: 1200, commitmentId: sub.id }, est);
    await addCost(p.id, { category: "MATERIALS", date: new Date(), vendor: "ABC", description: "Shingles", amount: 4700 }, est);
    await addCost(p.id, { category: "LABOR", date: new Date(), vendor: "Crew", description: "Install", amount: 2000 }, est);
    for (const c of ["EQUIPMENT", "DISPOSAL", "PERMITS", "OTHER"] as const) await setNoneExpected(p.id, c, true, est);
    problems = await closeoutProblems(p.id);
    expect(problems).toEqual([]);
    await closeCosting(p.id, est);
    const closed = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(closed.finalPnl).toMatchObject({ actual: 7900, grossProfit: 7100 });
    await expect(addCost(p.id, { category: "OTHER", date: new Date(), vendor: "x", description: "y", amount: 1 }, est)).rejects.toThrow(/closed/);
    const late = await addCost(p.id, { category: "OTHER", date: new Date(), vendor: "x", description: "TEST_ONLY late bill", amount: 1 }, admin);
    expect(await prisma.auditLog.count({ where: { entity: "JobCost", entityId: late.id } })).toBe(1);
    await expect(reopenCosting(p.id, "x", est)).rejects.toThrow(/Admin/);
    await reopenCosting(p.id, "TEST_ONLY late invoice", admin);
  });

  it("commission plans are Admin-only and feed net profit", async () => {
    const { admin, est, p, e } = await soldJob();
    await freezeBaseline(p.id, e.id, admin);
    await expect(saveCommissionPlan(est.id, { basis: "REVENUE", pct: 5 }, est)).rejects.toThrow(/Admin/);
    await saveCommissionPlan(est.id, { basis: "REVENUE", pct: 5 }, admin);
    await saveSettings({ overheadPct: 12 }, admin);
    const { pnl } = await loadCosting(p.id);
    expect(pnl.commission).toBe(750);
    expect(pnl.overhead).toBe(1800);
    expect(pnl.netProfit).not.toBeNull();
    await saveSettings({ overheadPct: null }, admin);
    await saveCommissionPlan(est.id, null, admin);
  });
});

describe("no costs yet", () => {
  it("a sold job with nothing entered says so instead of reading as 100% margin", () => {
    const p = computePnl({ ...base });
    expect(p.hasCosts).toBe(false);
    expect(p.missing[0]).toMatch(/No costs entered yet/);
  });
});
