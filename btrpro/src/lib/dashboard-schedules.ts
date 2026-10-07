// The dashboard's estimating-schedule and production-schedule squares, with their tabs.
// A PM with assignments (Schedule → Who does what) lands on "Mine" and gets tabs for their own crews.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MarketView } from "@/lib/market";
import { mineEstimateWhere, mineWhere, pmScope } from "@/lib/production/assign";

const PROD_OPEN: Prisma.ProdLineWhereInput = { board: { in: ["ADD", "UPCOMING", "CURRENT"] } };

export async function dashboardSchedules(opts: { userId: string; userName: string; view: MarketView; es?: string; pc?: string }) {
  const scope = await pmScope(opts.userId);
  const market = opts.view === "ALL" ? null : opts.view;

  // ---- estimating: Bidding now, soonest due first
  const esTabs: [string, string][] = [
    ...(scope ? ([["mine", "Mine"]] as [string, string][]) : []),
    ...(market !== "RESIDENTIAL" ? ([["comm", "Commercial"]] as [string, string][]) : []),
    ...(market !== "COMMERCIAL" ? ([["res", "Residential"]] as [string, string][]) : []),
  ];
  const es = esTabs.some(([k]) => k === opts.es) ? opts.es! : esTabs[0][0];
  const esWhere: Prisma.EstimateLogWhereInput = {
    board: "CURRENT",
    ...(es === "comm" ? { market: "COMMERCIAL" } : es === "res" ? { market: "RESIDENTIAL" } : market ? { market } : {}),
    ...(es === "mine" && scope ? mineEstimateWhere(scope, opts.userName) : {}),
  };

  // ---- production: crew tabs (the PM's crews, else the busiest crews)
  const base: Prisma.ProdLineWhereInput = { ...PROD_OPEN, ...(market ? { market } : {}) };
  const mine = scope ? mineWhere(scope) : null;
  const crewCounts = await prisma.prodLine.groupBy({ by: ["crew"], where: { AND: [base, { crew: { not: null } }, ...(mine ? [mine] : [])] }, _count: true });
  const byCount = crewCounts.sort((a, b) => b._count - a._count).map((c) => c.crew!);
  const crewTabs = scope?.crews.length ? [...new Set([...scope.crews, ...byCount])] : byCount;
  const allCrews = scope
    ? (await prisma.prodLine.groupBy({ by: ["crew"], where: { AND: [base, { crew: { not: null } }] }, _count: true })).sort((a, b) => b._count - a._count).map((c) => c.crew!)
    : byCount;
  const pc = opts.pc === "all" || (opts.pc && allCrews.includes(opts.pc)) ? opts.pc : scope ? "mine" : "all";
  const prodWhere: Prisma.ProdLineWhereInput = { AND: [base, ...(pc === "mine" && mine ? [mine] : pc !== "all" && pc !== "mine" ? [{ crew: pc }] : [])] };

  const [estimates, esCount, lines, prodCount] = await Promise.all([
    prisma.estimateLog.findMany({ where: esWhere, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { receivedAt: "desc" }], take: 60, select: { id: true, project: true, customer: true, scope: true, estimator: true, dueAt: true, priority: true, market: true } }),
    prisma.estimateLog.count({ where: esWhere }),
    prisma.prodLine.findMany({
      where: prodWhere,
      orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { board: "asc" }, { sourceTab: "asc" }, { sourceRow: "asc" }],
      take: 80,
      select: { id: true, board: true, market: true, builder: true, project: true, location: true, model: true, type: true, crew: true, superName: true, startDate: true, completed: true },
    }),
    prisma.prodLine.count({ where: prodWhere }),
  ]);

  return { pm: !!scope, es, esTabs, estimates, esCount, pc, crewTabs: crewTabs.slice(0, 8), moreCrews: allCrews.filter((c) => !crewTabs.slice(0, 8).includes(c)), lines, prodCount };
}
