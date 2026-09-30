import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { compliance, crewConflicts, timeAmount, workOrderPay, atNoon } from "@/lib/production/rules";
import {
  addTimeEntry,
  approveTime,
  calendar,
  createWorkOrder,
  deleteTimeEntry,
  getWorkOrderByToken,
  saveCrew,
  scheduleEvent,
  sendWorkOrder,
  setWorkOrderStatus,
  updateEvent,
  updateWorkOrder,
  type CrewInput,
  type ProdActor,
} from "@/lib/production/service";
import { loadCosting } from "@/lib/costing/service";

process.env.UPLOAD_DIR = "prisma/test-uploads";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});
const today = new Date("2026-09-30T17:00:00Z");
const admin = async (): Promise<ProdActor> => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};
const crewBase: CrewInput = {
  name: "TEST_ONLY Crew",
  kind: "CREW",
  trade: "roofing",
  leadName: null,
  phone: null,
  email: null,
  payType: "HOURLY",
  defaultRate: 30,
  rateUnit: null,
  burdenPct: 25,
  coiExpires: null,
  workersCompExpires: null,
  licenseNumber: null,
  licenseExpires: null,
  notes: null,
  active: true,
};

describe("production rules", () => {
  it("subs need current COI and workers' comp; in-house crews don't", () => {
    expect(compliance({ kind: "CREW", coiExpires: null, workersCompExpires: null, licenseExpires: null }, today).status).toBe("OK");
    expect(compliance({ kind: "SUB", coiExpires: null, workersCompExpires: atNoon("2027-01-01"), licenseExpires: null }, today).status).toBe("MISSING");
    expect(compliance({ kind: "SUB", coiExpires: atNoon("2026-10-15"), workersCompExpires: atNoon("2027-01-01"), licenseExpires: null }, today).status).toBe("EXPIRING");
    expect(compliance({ kind: "SUB", coiExpires: atNoon("2026-09-29"), workersCompExpires: atNoon("2027-01-01"), licenseExpires: null }, today).status).toBe("EXPIRED");
  });
  it("finds the same crew in two places, ignoring cancelled and done", () => {
    const a = { id: "a", crewId: "c", startDate: atNoon("2026-10-05"), endDate: atNoon("2026-10-07"), status: "TENTATIVE", title: "A" };
    const others = [
      { id: "b", crewId: "c", startDate: atNoon("2026-10-07"), endDate: atNoon("2026-10-07"), status: "CONFIRMED", title: "B" },
      { id: "c", crewId: "c", startDate: atNoon("2026-10-06"), endDate: atNoon("2026-10-06"), status: "CANCELLED", title: "C" },
      { id: "d", crewId: "other", startDate: atNoon("2026-10-06"), endDate: atNoon("2026-10-06"), status: "TENTATIVE", title: "D" },
      { id: "e", crewId: "c", startDate: atNoon("2026-10-08"), endDate: atNoon("2026-10-09"), status: "TENTATIVE", title: "E" },
    ];
    expect(crewConflicts(a, others).map((x) => x.id)).toEqual(["b"]);
  });
  it("pay math shows its formula and refuses missing inputs", () => {
    expect(timeAmount({ basis: "HOURLY", hours: 40, rate: 30, burdenPct: 25 })).toEqual({ amount: 1500, formula: "40 h × $30/h × (1 + 25% burden) = 1500.00" });
    expect(timeAmount({ basis: "PIECE", qty: 32.4, unit: "SQ", rate: 65 })).toEqual({ amount: 2106, formula: "32.4 SQ × $65/SQ = 2106.00" });
    expect(() => timeAmount({ basis: "HOURLY", hours: 8, rate: 30, burdenPct: null })).toThrow(/burden/);
    expect(workOrderPay({ payBasis: "PIECE", payQty: null, payUnit: "SQ", payRate: 65, amount: null }).amount).toBeNull();
  });
});

async function soldJob(signed = true) {
  const a = await admin();
  const p = await createProject({ name: `TEST_ONLY Prod ${Math.random().toString(36).slice(2, 6)}`, market: "RESIDENTIAL", scopes: ["STEEP"], address: "7 Crew Ct", isPublic: false, isTaxExempt: false }, a);
  await prisma.project.update({ where: { id: p.id }, data: { status: "SOLD", contractAmount: 20000, contractSignedAt: signed ? new Date() : null } });
  return { a, p };
}

describe("schedule", () => {
  it("scheduling an install moves a sold job to Scheduled, but only with a signed contract", async () => {
    const { a, p } = await soldJob(false);
    const crew = await saveCrew(null, crewBase, a);
    const ev = { projectId: p.id, kind: "INSTALL" as const, title: "Reroof", startDate: atNoon("2026-10-05"), endDate: atNoon("2026-10-06"), crewId: crew.id };
    await expect(scheduleEvent(ev, a)).rejects.toThrow(/Can't schedule the install yet/);
    await prisma.project.update({ where: { id: p.id }, data: { contractSignedAt: new Date() } });
    await scheduleEvent(ev, a);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("SCHEDULED");
  });

  it("double-booking and uninsured subs need a stated reason, which is kept", async () => {
    const { a, p } = await soldJob();
    const crew = await saveCrew(null, { ...crewBase, name: "TEST_ONLY Double Crew" }, a);
    await scheduleEvent({ projectId: p.id, kind: "INSTALL", title: "Job 1", startDate: atNoon("2026-10-12"), endDate: atNoon("2026-10-13"), crewId: crew.id }, a);
    const second = { projectId: null, kind: "REPAIR" as const, title: "Leak call", startDate: atNoon("2026-10-13"), endDate: atNoon("2026-10-13"), crewId: crew.id };
    await expect(scheduleEvent(second, a)).rejects.toMatchObject({ needsOverride: true, message: expect.stringMatching(/already on "Job 1"/) });
    const e = await scheduleEvent({ ...second, override: "TEST_ONLY two-hour leak call after lunch" }, a);
    expect(e.override).toMatch(/two-hour leak call/);
    const sub = await saveCrew(null, { ...crewBase, name: "TEST_ONLY Gutter Sub", kind: "SUB", payType: null, defaultRate: null }, a);
    await expect(scheduleEvent({ ...second, crewId: sub.id, title: "Gutters" }, a)).rejects.toThrow(/Certificate of insurance not on file/);
    await expect(updateEvent(e.id, { startDate: atNoon("2026-10-14"), endDate: atNoon("2026-10-12") }, a)).rejects.toThrow(/before the start/);
    const cal = await calendar(atNoon("2026-10-12"), atNoon("2026-10-14"), crew.id);
    expect(cal.events.filter((x) => x.conflict).map((x) => x.conflict)).toEqual(["ACCEPTED", "ACCEPTED"]);
  });
});

describe("work orders and time", () => {
  it("a sub's work order needs scope, date, pay and current insurance; sending commits the cost; the crew link works", async () => {
    const { a, p } = await soldJob();
    const sub = await saveCrew(null, { ...crewBase, name: "TEST_ONLY Siding Sub", kind: "SUB", payType: "PIECE", defaultRate: 95, rateUnit: "SQ", coiExpires: atNoon("2026-09-01"), workersCompExpires: atNoon("2027-06-01") }, a);
    const w = await createWorkOrder(p.id, sub.id, a);
    expect(w).toMatchObject({ payBasis: "PIECE", payUnit: "SQ", payRate: 95 });
    await expect(sendWorkOrder(w.id, a)).rejects.toThrow(/scope.*start date.*pay.*insurance/);
    await updateWorkOrder(w.id, { instructions: "TEST_ONLY", startDate: atNoon("2026-10-20"), payBasis: "PIECE", payQty: 20, payUnit: "SQ", payRate: 95, amount: null, scope: ["Install siding"], exclusions: [] }, a);
    await expect(sendWorkOrder(w.id, a)).rejects.toThrow(/insurance isn't current/);
    await saveCrew(sub.id, { ...crewBase, name: "TEST_ONLY Siding Sub", kind: "SUB", payType: "PIECE", defaultRate: 95, rateUnit: "SQ", coiExpires: atNoon("2027-09-01"), workersCompExpires: atNoon("2027-06-01") }, a);
    await sendWorkOrder(w.id, a);
    expect(await getWorkOrderByToken(w.token)).not.toBeNull();
    expect((await loadCosting(p.id)).pnl.committedByCat.SUBCONTRACTOR).toBe(1900);
    // piece pay logged and approved bills the work order
    const t = await addTimeEntry(p.id, { crewId: sub.id, date: atNoon("2026-10-21"), basis: "PIECE", qty: 20, unit: "sq", rate: null }, a);
    expect(t).toMatchObject({ amount: 1900, rate: 95, unit: "SQ" });
    await approveTime(t.id, a);
    const { pnl } = await loadCosting(p.id);
    expect(pnl.actualByCat.SUBCONTRACTOR).toBe(1900);
    expect(pnl.committed).toBe(0);
    await expect(deleteTimeEntry(t.id, a)).rejects.toThrow(/job costing/);
    await setWorkOrderStatus(w.id, "COMPLETE", { id: null, name: "TEST_ONLY lead" });
  });

  it("hourly time uses the crew defaults and posts to labor on approval", async () => {
    const { a, p } = await soldJob();
    const crew = await saveCrew(null, { ...crewBase, name: "TEST_ONLY Hourly Crew" }, a);
    const t = await addTimeEntry(p.id, { crewId: crew.id, date: atNoon("2026-10-05"), basis: "HOURLY", hours: 36, rate: null }, a);
    expect(t.formula).toBe("36 h × $30/h × (1 + 25% burden) = 1350.00");
    await approveTime(t.id, a);
    await expect(approveTime(t.id, a)).rejects.toThrow(/Already/);
    expect((await loadCosting(p.id)).pnl.actualByCat.LABOR).toBe(1350);
    const noRate = await saveCrew(null, { ...crewBase, name: "TEST_ONLY No-rate", defaultRate: null }, a);
    await expect(addTimeEntry(p.id, { crewId: noRate.id, date: new Date(), basis: "HOURLY", hours: 8, rate: null }, a)).rejects.toThrow(/no default rate/);
  });
});
