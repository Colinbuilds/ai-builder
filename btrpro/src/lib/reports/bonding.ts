// Bonding capacity: how much more bonded work BTR can take on before the surety says no. Sureties set a
// single-job limit and an aggregate (total bonded backlog) limit, mostly from working capital and net worth
// on the CPA-reviewed statement. Rule of thumb (docs/growth-research.md): single ≈ 10× working capital
// (8–15×) or 5× net worth, whichever is less; aggregate ≈ 15–25× working capital. The surety's letter wins.
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { getSettings } from "@/lib/settings";
import { wipSchedule } from "./wip";

export function estimateLimits(workingCapital: number | null, netWorth: number | null) {
  if (workingCapital == null || workingCapital <= 0) return null;
  const nw = netWorth != null && netWorth > 0 ? netWorth * 5 : Infinity;
  const single = Math.min(workingCapital * 10, nw);
  return { single: round(single, 0), singleRange: [round(Math.min(workingCapital * 8, nw), 0), round(Math.min(workingCapital * 15, nw), 0)] as [number, number], aggregate: round(workingCapital * 20, 0), aggregateRange: [round(workingCapital * 15, 0), round(workingCapital * 25, 0)] as [number, number] };
}

export async function bondingCapacity(user: { id: string; role: string }) {
  const [s, wip, bondedJobs] = await Promise.all([getSettings(), wipSchedule(user), prisma.project.findMany({ where: { perfBondRequired: true }, select: { id: true } })]);
  const bonded = new Set(bondedJobs.map((b) => b.id));
  const rows = wip.rows.filter((r) => bonded.has(r.id)).map((r) => ({ id: r.id, name: r.name, revenue: r.revenue, backlog: r.backlog, pctComplete: r.pctComplete }));
  const bondedBacklog = round(rows.reduce((a, r) => a + r.backlog, 0), 2);
  const est = estimateLimits(s.workingCapital, s.netWorth);
  const fromLetter = s.bondAggregateLimit != null;
  const aggregate = s.bondAggregateLimit ?? est?.aggregate ?? null;
  const single = s.bondSingleLimit ?? est?.single ?? null;
  const room = aggregate == null ? null : round(aggregate - bondedBacklog, 2);
  const usedPct = aggregate ? round((bondedBacklog / aggregate) * 100, 1) : null;
  const statementAgeDays = s.financialsAsOf ? Math.floor((Date.now() - new Date(s.financialsAsOf).getTime()) / 86_400_000) : null;
  return { rows, bondedBacklog, single, aggregate, room, usedPct, fromLetter, estimate: est, surety: s.suretyName, letterSingle: s.bondSingleLimit, letterAggregate: s.bondAggregateLimit, workingCapital: s.workingCapital, netWorth: s.netWorth, financialsAsOf: s.financialsAsOf, statementStale: statementAgeDays != null && statementAgeDays > 450 };
}
