// TEST_ONLY growth reports: WIP math, cash roll-forward, lien deadline, and the scorecard running end to end.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { wipLine, wipSchedule, setEtc } from "@/lib/reports/wip";
import { mondayOf, rollForward } from "@/lib/reports/cash";
import { lienDeadline } from "@/lib/reports/risk";
import { scorecard } from "@/lib/reports/scorecard";

const ADMIN = { id: "", role: "ADMIN", name: "TEST_ONLY" };
afterAll(async () => {
  const p = await prisma.project.findMany({ where: { name: { startsWith: "TEST_ONLY WIP" } }, select: { id: true } });
  await prisma.jobCost.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.invoice.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.project.deleteMany({ where: { id: { in: p.map((x) => x.id) } } });
});

describe("WIP math", () => {
  it("cost-to-cost percent complete, earned, over/under billing and fade", () => {
    const w = wipLine({ revenue: 100_000, costToDate: 40_000, committed: 0, budget: 80_000, etc: null, billed: 55_000, bidMarginPct: 20 });
    expect(w.estTotalCost).toBe(80_000);
    expect(w.pctComplete).toBe(50);
    expect(w.earned).toBe(50_000);
    expect(w.overUnder).toBe(5_000); // overbilled
    expect(w.projectedMarginPct).toBe(20);
    expect(w.fade).toBe(0);
  });

  it("the PM's cost to complete wins and shows fade; a losing job is flagged", () => {
    const fade = wipLine({ revenue: 100_000, costToDate: 60_000, committed: 0, budget: 80_000, etc: 30_000, billed: 50_000, bidMarginPct: 20 });
    expect(fade.estTotalCost).toBe(90_000);
    expect(fade.basis).toBe("PM forecast");
    expect(fade.fade).toBe(-10);
    expect(fade.overUnder).toBeLessThan(0); // underbilled
    const loss = wipLine({ revenue: 100_000, costToDate: 90_000, committed: 0, budget: 80_000, etc: 20_000, billed: 90_000, bidMarginPct: 20 });
    expect(loss.loss).toBe(true);
  });

  it("without a budget, cost so far plus open commitments is the floor", () => {
    expect(wipLine({ revenue: 50_000, costToDate: 10_000, committed: 5_000, budget: null, etc: null, billed: 0, bidMarginPct: null }).estTotalCost).toBe(15_000);
  });
});

describe("cash roll-forward", () => {
  it("puts past-due items in week 1 and rolls the balance", () => {
    const now = new Date("2026-10-07T12:00:00Z"); // a Wednesday
    expect(mondayOf(now).toISOString().slice(0, 10)).toBe("2026-10-05");
    const weeks = rollForward(now, 10_000, [
      { date: new Date("2026-09-01"), label: "past-due bill", amount: -3_000, kind: "BILLS" },
      { date: new Date("2026-10-15"), label: "check", amount: 8_000, kind: "AR" },
      { date: new Date("2027-06-01"), label: "beyond 13 weeks", amount: 1_000_000, kind: "AR" },
    ]);
    expect(weeks).toHaveLength(13);
    expect(weeks[0].close).toBe(7_000);
    expect(weeks[1].in).toBe(8_000);
    expect(weeks[12].close).toBe(15_000);
  });
});

describe("Nebraska lien deadline", () => {
  it("is 120 days after the last day of work", () => {
    expect(lienDeadline(new Date("2026-06-01T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-29");
  });
});

describe("reports on real data", () => {
  it("a sold job shows on WIP with its PM forecast, and the scorecard builds", async () => {
    const job = await prisma.project.create({ data: { name: "TEST_ONLY WIP job", market: "COMMERCIAL", status: "IN_PRODUCTION", contractAmount: 200_000 } });
    await prisma.jobCost.create({ data: { projectId: job.id, category: "MATERIALS", amount: 50_000, description: "TEST_ONLY", vendor: "TEST_ONLY", date: new Date() } });
    await setEtc(job.id, 100_000, { id: "", name: "TEST_ONLY PM" });
    const w = await wipSchedule(ADMIN);
    const row = w.rows.find((r) => r.id === job.id)!;
    expect(row).toMatchObject({ costToDate: 50_000, estTotalCost: 150_000, basis: "PM forecast", projectedGp: 50_000 });
    expect(row.pctComplete).toBeCloseTo(33.3, 1);
    const s = await scorecard(ADMIN);
    expect(s.metrics.map((m) => m.key)).toEqual(["backlog", "margin", "billing", "cash", "dso", "winrate", "cos", "concentration", "insurance", "liens"]);
  });
});
