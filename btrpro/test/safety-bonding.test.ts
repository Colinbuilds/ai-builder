// TEST_ONLY safety log, prequal packet, bonding capacity, customer relationship health.
import { afterAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { addCompanyFile, addIncident, addToolboxTalk, oshaRate, prequalPacket, safetyOverview, saveSafetyYear, yearSummary } from "@/lib/safety/service";
import { estimateLimits } from "@/lib/reports/bonding";
import { health, relationships } from "@/lib/reports/relationships";

const YEAR = 2005; // far from real data
const who = { name: "TEST_ONLY safety" };

afterAll(async () => {
  await prisma.safetyIncident.deleteMany({ where: { createdBy: who.name } });
  await prisma.toolboxTalk.deleteMany({ where: { createdBy: who.name } });
  await prisma.safetyYear.deleteMany({ where: { year: { in: [YEAR, YEAR - 1, YEAR - 2, YEAR - 3] } } });
  await prisma.companyFile.deleteMany({ where: { uploadedBy: who.name } });
  await prisma.estimateLog.deleteMany({ where: { customer: { startsWith: "TEST_ONLY rel" } } });
  await prisma.$disconnect();
});

describe("safety", () => {
  it("computes the 300A summary and OSHA rates", async () => {
    expect(oshaRate(2, 100_000)).toBe(4);
    expect(oshaRate(1, null)).toBeNull();
    const d = (m: number) => new Date(Date.UTC(YEAR, m, 10));
    await expect(addIncident({ date: d(1), kind: "BOGUS", personName: null, crewId: null, projectId: null, description: "x", daysAway: null, daysRestricted: null, correctiveAction: null }, who)).rejects.toThrow(/kind/);
    await expect(addIncident({ date: d(1), kind: "LOST_TIME", personName: null, crewId: null, projectId: null, description: "x", daysAway: 200, daysRestricted: null, correctiveAction: null }, who)).rejects.toThrow(/180/);
    for (const [kind, away] of [["LOST_TIME", 5], ["RECORDABLE", null], ["FIRST_AID", null], ["RESTRICTED", null]] as const)
      await addIncident({ date: d(2), kind, personName: null, crewId: null, projectId: null, description: "TEST_ONLY", daysAway: away, daysRestricted: kind === "RESTRICTED" ? 3 : null, correctiveAction: null }, who);
    await expect(saveSafetyYear(YEAR, { hoursWorked: 150_000, avgEmployees: 75, emr: 9 }, who)).rejects.toThrow(/EMR/);
    await saveSafetyYear(YEAR, { hoursWorked: 150_000, avgEmployees: 75, emr: 0.88 }, who);
    const s = await yearSummary(YEAR);
    expect(s.recordable).toBe(3);
    expect(s.daysAwayCases).toBe(1);
    expect(s.daysAway).toBe(5);
    expect(s.daysRestricted).toBe(3);
    expect(s.trir).toBe(4); // 3 × 200,000 / 150,000
    expect(s.dartRate).toBeCloseTo(2.67, 2);
    expect(s.nearMisses).toBe(1);
  });

  it("logs toolbox talks and builds a packet listing what's missing", async () => {
    await expect(addToolboxTalk({ date: new Date(), topic: "Fall protection", presenter: "Lead", crewId: null, projectId: null, attendees: " \n ", notes: null }, who)).rejects.toThrow(/attended/);
    const t = await addToolboxTalk({ date: new Date(), topic: "TEST_ONLY fall protection", presenter: "Lead", crewId: null, projectId: null, attendees: "A, B\nC", notes: null }, who);
    expect(t.attendees.split("\n")).toEqual(["A", "B", "C"]);
    const now = new Date(Date.UTC(YEAR + 1, 2, 1));
    const o = await safetyOverview(now);
    expect(o.years[1].year).toBe(YEAR);
    expect(o.missing.some((m) => /EMR letter/.test(m))).toBe(true);

    const src = await PDFDocument.create();
    src.addPage();
    src.addPage();
    const before = (await PDFDocument.load(await prequalPacket(now))).getPageCount();
    await addCompanyFile({ kind: "EMR_LETTER", title: "TEST_ONLY EMR", bytes: await src.save(), fileName: "emr.pdf", contentType: "application/pdf", expiresAt: null }, who);
    await addCompanyFile({ kind: "COI", title: "TEST_ONLY expired COI", bytes: await src.save(), fileName: "coi.pdf", contentType: "application/pdf", expiresAt: new Date(Date.UTC(YEAR, 0, 1)) }, who);
    const o2 = await safetyOverview(now);
    expect(o2.missing.some((m) => /EMR letter/.test(m))).toBe(false);
    expect(o2.missing.some((m) => /insurance.*expired/.test(m))).toBe(true);
    // the EMR letter's 2 pages are merged in; the expired COI is not
    expect((await PDFDocument.load(await prequalPacket(now))).getPageCount()).toBe(before + 2);
  });
});

describe("bonding", () => {
  it("estimates limits from working capital, capped by 5× net worth", () => {
    expect(estimateLimits(null, null)).toBeNull();
    const e = estimateLimits(1_000_000, 4_000_000)!;
    expect(e.single).toBe(10_000_000);
    expect(e.aggregate).toBe(20_000_000);
    expect(estimateLimits(1_000_000, 1_000_000)!.single).toBe(5_000_000);
  });
});

describe("customer relationships", () => {
  it("flags quiet and declining customers", async () => {
    expect(health(150, 0, 10)).toBe("DORMANT");
    expect(health(90, 2, 5)).toBe("COOLING");
    expect(health(10, 2, 8)).toBe("DECLINING");
    expect(health(10, 6, 8)).toBe("ACTIVE");
    const now = new Date();
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const mk = (customer: string, d: number, board = "SENT") => prisma.estimateLog.create({ data: { project: `TEST_ONLY rel ${Math.random()}`, board, market: "COMMERCIAL", customer, receivedAt: ago(d), source: "APP" } });
    for (const d of [200, 300, 400]) await mk("TEST_ONLY rel Quiet GC", d);
    for (const d of [5, 20, 40]) await mk("TEST_ONLY rel Busy GC", d, d === 5 ? "SOLD" : "LOST");
    const r = await relationships(now);
    expect(r.customers.find((c) => c.name === "TEST_ONLY rel Quiet GC")?.health).toBe("DORMANT");
    const busy = r.customers.find((c) => c.name === "TEST_ONLY rel Busy GC")!;
    expect(busy.health).toBe("ACTIVE");
    expect(busy.rate).toBe(33.3);
  });
});
