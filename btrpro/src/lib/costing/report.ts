import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { getSettings } from "@/lib/settings";
import { BUCKETS, computePnl, type Baseline, type Bucket } from "./pnl";
import { canSeeCosts } from "./service";

export type ReportFilters = {
  from?: Date | null;
  to?: Date | null;
  market?: "RESIDENTIAL" | "COMMERCIAL" | null;
  scope?: string | null;
  isPublic?: boolean | null;
  salespersonId?: string | null;
  estimatorId?: string | null;
  clientCompanyId?: string | null;
  closedOnly?: boolean;
};

const SOLD_STAGES = ["SOLD", "SCHEDULED", "IN_PRODUCTION", "COMPLETE", "INVOICED", "PAID", "CLOSED"] as const;

/** Profit across jobs (§12). Only sold jobs; only the jobs this user may see costs for. */
export async function profitReport(f: ReportFilters, user: { id: string; role: string }) {
  const where: Prisma.ProjectWhereInput = {
    status: { in: [...SOLD_STAGES] },
    ...(f.market ? { market: f.market } : {}),
    ...(f.isPublic != null ? { isPublic: f.isPublic } : {}),
    ...(f.salespersonId ? { salespersonId: f.salespersonId } : {}),
    ...(f.estimatorId ? { estimatorId: f.estimatorId } : {}),
    ...(f.clientCompanyId ? { clientCompanyId: f.clientCompanyId } : {}),
    ...(f.closedOnly ? { costClosedAt: { not: null } } : {}),
  };
  const [projects, s] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        salesperson: { select: { id: true, name: true } },
        estimator: { select: { name: true } },
        clientCompany: { select: { name: true } },
        costs: { select: { category: true, amount: true, commitmentId: true } },
        commitments: { select: { id: true, category: true, amount: true, status: true } },
        changeOrders: { select: { kind: true, status: true, amount: true, costImpact: true } },
        measurements: { where: { status: { in: ["CONFIRMED", "USER_ENTERED"] }, key: { in: ["roof_sq", "roof_total_sf", "siding_sf"] }, value: { not: null } }, select: { key: true, value: true } },
      },
      orderBy: { contractSignedAt: "desc" },
    }),
    getSettings(),
  ]);
  const rows = projects
    .filter((p) => canSeeCosts(user, p))
    .filter((p) => {
      const d = p.contractSignedAt ?? p.statusChangedAt;
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      if (f.scope && !((p.scopes as string[] | null) ?? []).includes(f.scope)) return false;
      return true;
    })
    .map((p) => {
      const pnl = computePnl({
        contractAmount: p.contractAmount,
        changeOrders: p.changeOrders,
        baseline: p.costBaseline as unknown as Baseline | null,
        costs: p.costs,
        commitments: p.commitments,
        overheadPct: s.overheadPct,
        thresholdPct: s.costVarianceThresholdPct,
      });
      const sum = (k: string) => p.measurements.filter((m) => m.key === k).reduce((a, m) => a + (m.value ?? 0), 0);
      // 1 SQ = 100 SF by definition; roof_sq wins when it was measured directly
      const squares = sum("roof_sq") || (sum("roof_total_sf") ? round(sum("roof_total_sf") / 100, 2) : 0);
      const sidingSf = sum("siding_sf");
      const per = (v: number | null, q: number) => (v == null || !q ? null : round(v / q, 2));
      return {
        id: p.id,
        name: p.name,
        market: p.market,
        isPublic: p.isPublic,
        soldAt: p.contractSignedAt ?? p.statusChangedAt,
        closed: !!p.costClosedAt,
        salesperson: p.salesperson?.name ?? null,
        estimator: p.estimator?.name ?? null,
        client: p.clientCompany?.name ?? null,
        pnl,
        squares: squares || null,
        sidingSf: sidingSf || null,
        revenuePerSq: per(pnl.revenue, squares),
        costPerSq: per(pnl.projected, squares),
        revenuePerSf: per(pnl.revenue, sidingSf),
        costPerSf: per(pnl.projected, sidingSf),
        flagged: pnl.buckets.filter((b) => b.flagged).map((b) => b.bucket),
      };
    });

  const known = rows.filter((r) => r.pnl.revenue != null);
  const revenue = round(known.reduce((a, r) => a + r.pnl.revenue!, 0), 2);
  // profit totals only count jobs that have costs; a sold job with nothing entered would read as 100% margin
  const withCosts = known.filter((r) => r.pnl.hasCosts);
  const costedRevenue = round(withCosts.reduce((a, r) => a + r.pnl.revenue!, 0), 2);
  const projectedGp = round(withCosts.reduce((a, r) => a + r.pnl.projectedGrossProfit!, 0), 2);
  // Estimate accuracy uses closed jobs only: open jobs are still missing bills.
  const closedWithBaseline = rows.filter((r) => r.closed && r.pnl.estimated != null);
  const accuracy = Object.fromEntries(
    BUCKETS.map((b) => {
      const est = closedWithBaseline.reduce((a, r) => a + (r.pnl.buckets.find((x) => x.bucket === b)!.estimated ?? 0), 0);
      const act = closedWithBaseline.reduce((a, r) => a + r.pnl.buckets.find((x) => x.bucket === b)!.actual, 0);
      return [b, est ? round(act / est, 3) : null];
    }),
  ) as Record<Bucket, number | null>;
  return {
    rows,
    totals: {
      jobs: rows.length,
      missingRevenue: rows.length - known.length,
      noCosts: known.length - withCosts.length,
      revenue,
      costedRevenue,
      projectedGp,
      marginPct: costedRevenue ? round((projectedGp / costedRevenue) * 100, 1) : null,
      closedJobs: closedWithBaseline.length,
      accuracy,
    },
  };
}

/** Public bid tabs: where we landed against the field. */
export async function bidTabReport(user: { id: string; role: string }) {
  const results = await prisma.bidResult.findMany({
    include: { project: { select: { id: true, name: true, bidDueDate: true, estimatorId: true, salespersonId: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
  return results
    .filter((r) => canSeeCosts(user, r.project))
    .map((r) => {
      const tabs = ((r.bidTabs as { bidder: string; amount: number }[] | null) ?? []).filter((t) => Number.isFinite(t.amount));
      const all = [...tabs.map((t) => t.amount), ...(r.ourBid != null ? [r.ourBid] : [])].sort((a, b) => a - b);
      const low = all[0] ?? null;
      const rank = r.ourBid != null ? all.indexOf(r.ourBid) + 1 : null;
      return {
        project: r.project,
        ourBid: r.ourBid,
        won: r.won,
        bidders: all.length,
        low,
        rank,
        overLowPct: r.ourBid != null && low ? round(((r.ourBid - low) / low) * 100, 1) : null,
        nextAbovePct: r.ourBid != null && rank === 1 && all[1] ? round(((all[1] - r.ourBid) / r.ourBid) * 100, 1) : null,
      };
    });
}
