// Win/loss: decided jobs (sold or later vs lost) by rep, lead source and job type, plus why jobs were lost.
import { prisma } from "@/lib/db";
import { isSoldOrLater, WIN_BACK, type Stage } from "@/lib/projects/workflow";
import { parseWorkTypes, WORK_TYPE_LABEL } from "@/lib/projects/work-types";

export type Row = { key: string; won: number; lost: number; wonValue: number; rate: number | null };

export async function winLoss(since: Date) {
  const jobs = await prisma.project.findMany({
    where: { OR: [{ status: "LOST", statusChangedAt: { gte: since } }, { contractSignedAt: { gte: since } }, { status: { notIn: ["LEAD", "ESTIMATING", "SUBMITTED", "LOST"] }, statusChangedAt: { gte: since } }] },
    select: { id: true, name: true, status: true, leadSource: true, workTypes: true, market: true, contractAmount: true, lostCategory: true, lostReason: true, statusChangedAt: true, salesperson: { select: { name: true } } },
  });
  const decided = jobs.filter((j) => j.status === "LOST" || isSoldOrLater(j.status as Stage));
  const group = (keyOf: (j: (typeof decided)[number]) => string[]) => {
    const m = new Map<string, Row>();
    for (const j of decided)
      for (const k of keyOf(j)) {
        const r = m.get(k) ?? { key: k, won: 0, lost: 0, wonValue: 0, rate: null };
        if (j.status === "LOST") r.lost++;
        else {
          r.won++;
          r.wonValue += j.contractAmount ?? 0;
        }
        m.set(k, r);
      }
    return [...m.values()].map((r) => ({ ...r, wonValue: Math.round(r.wonValue), rate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null })).sort((a, b) => b.won + b.lost - (a.won + a.lost));
  };
  const reasons = new Map<string, number>();
  for (const j of decided) if (j.status === "LOST") reasons.set(j.lostCategory ?? "Not recorded", (reasons.get(j.lostCategory ?? "Not recorded") ?? 0) + 1);
  return {
    total: group(() => ["All jobs"])[0] ?? { key: "All jobs", won: 0, lost: 0, wonValue: 0, rate: null },
    byRep: group((j) => [j.salesperson?.name ?? "Unassigned"]),
    bySource: group((j) => [j.leadSource ?? "Not recorded"]),
    byType: group((j) => {
      const t = parseWorkTypes(j.workTypes);
      return t.length ? t.map((x) => WORK_TYPE_LABEL[x]) : ["Not recorded"];
    }),
    byMarket: group((j) => [j.market === "RESIDENTIAL" ? "Residential" : "Commercial"]),
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** Lost on price, timing or no response — worth another call (spring, or after the next storm). */
export async function winBackList() {
  return prisma.project.findMany({
    where: { status: "LOST", lostCategory: { in: WIN_BACK } },
    select: {
      id: true,
      name: true,
      address: true,
      lostCategory: true,
      lostReason: true,
      statusChangedAt: true,
      salesperson: { select: { name: true } },
      contacts: { where: { isPrimary: true }, select: { contact: { select: { firstName: true, lastName: true, phone: true } } }, take: 1 },
    },
    orderBy: { statusChangedAt: "asc" },
    take: 300,
  });
}
