// Work-in-progress schedule (cost-to-cost percentage of completion) — what banks and sureties read first.
// Per open job: contract (with approved COs), cost to date, estimated total cost (cost to date + the PM's
// cost-to-complete, or the frozen budget), % complete, earned revenue, billed to date, over/(under) billing,
// projected gross profit and the fade against the bid margin. Month-end snapshots show the trend.
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { getSettings } from "@/lib/settings";
import { computePnl, type Baseline } from "@/lib/costing/pnl";
import { canSeeCosts } from "@/lib/costing/service";
import { payTotals, type SovLine } from "@/lib/billing/payapps";

const OPEN = ["SOLD", "SCHEDULED", "IN_PRODUCTION", "COMPLETE", "INVOICED"] as const;
const r2 = (n: number) => round(n, 2);

export type WipInput = {
  revenue: number;
  costToDate: number;
  committed: number;
  budget: number | null; // frozen estimate cost + CO cost
  etc: number | null; // PM's cost to complete
  billed: number;
  bidMarginPct: number | null;
};

/** Pure WIP math for one job. */
export function wipLine(i: WipInput) {
  // estimated total cost: the PM's forecast when there is one; else the budget, never less than cost already in
  const fromPm = i.etc != null ? i.costToDate + i.etc : null;
  const estTotalCost = r2(fromPm ?? Math.max(i.budget ?? 0, i.costToDate + i.committed));
  const basis = fromPm != null ? "PM forecast" : i.budget != null ? "budget" : "costs so far";
  const pctComplete = estTotalCost > 0 ? Math.min(1, i.costToDate / estTotalCost) : 0;
  const earned = r2(i.revenue * pctComplete);
  const overUnder = r2(i.billed - earned); // + overbilled (liability), − underbilled (asset)
  const projectedGp = r2(i.revenue - estTotalCost);
  const projectedMarginPct = i.revenue ? round((projectedGp / i.revenue) * 100, 1) : null;
  const fade = projectedMarginPct != null && i.bidMarginPct != null ? round(projectedMarginPct - i.bidMarginPct, 1) : null;
  // a loss job: the whole expected loss is recognized now, not as the work goes
  const loss = projectedGp < 0;
  return { estTotalCost, basis, pctComplete: round(pctComplete * 100, 1), earned, overUnder, projectedGp, projectedMarginPct, fade, loss, backlog: r2(i.revenue - earned) };
}

export async function wipSchedule(user: { id: string; role: string }) {
  const s = await getSettings();
  const jobs = await prisma.project.findMany({
    where: { status: { in: [...OPEN] }, contractAmount: { not: null } },
    include: {
      costs: { select: { category: true, amount: true, commitmentId: true } },
      commitments: { select: { id: true, category: true, amount: true, status: true } },
      changeOrders: { select: { kind: true, status: true, amount: true, costImpact: true } },
      invoices: { where: { status: { not: "VOID" } }, select: { subtotal: true } },
      payContracts: { select: { apps: { where: { status: { in: ["SUBMITTED", "PAID"] } }, select: { lines: true, retainagePct: true }, orderBy: { number: "desc" }, take: 1 } } },
      salesperson: { select: { name: true } },
      estimator: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const lastMonth = await prisma.wipSnapshot.findMany({ where: { month: prevMonth() }, select: { projectId: true, projectedGp: true, revenue: true, overUnder: true } });
  const prev = new Map(lastMonth.map((x) => [x.projectId, x]));

  const rows = jobs
    .filter((p) => canSeeCosts(user, p))
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
      // billed: BTRpro invoices; commercial jobs billed by AIA pay app use the latest submitted app's completed-to-date
      const invoiced = p.invoices.reduce((a, x) => a + x.subtotal, 0);
      const payApp = p.payContracts.reduce((a, c) => a + (c.apps[0] ? payTotals(c.apps[0].lines as SovLine[], c.apps[0].retainagePct).completed : 0), 0);
      const billed = r2(invoiced || payApp);
      const line = wipLine({
        revenue: pnl.revenue ?? 0,
        costToDate: pnl.actual,
        committed: pnl.committed,
        budget: pnl.estimated,
        etc: p.wipEtc,
        billed,
        bidMarginPct: pnl.estimatedMarginPct,
      });
      const before = prev.get(p.id);
      const lastMarginPct = before && before.revenue ? round((before.projectedGp / before.revenue) * 100, 1) : null;
      return {
        id: p.id,
        name: p.name,
        market: p.market,
        status: p.status,
        pm: p.salesperson?.name ?? p.estimator?.name ?? null,
        revenue: pnl.revenue ?? 0,
        costToDate: pnl.actual,
        billed,
        bidMarginPct: pnl.estimatedMarginPct,
        etc: p.wipEtc,
        etcAt: p.wipEtcAt,
        etcBy: p.wipEtcBy,
        stale: !p.wipEtcAt || Date.now() - p.wipEtcAt.getTime() > 35 * 86_400_000,
        hasCosts: pnl.hasCosts,
        noBudget: pnl.estimated == null,
        lastMarginPct,
        monthChange: lastMarginPct != null && line.projectedMarginPct != null ? round(line.projectedMarginPct - lastMarginPct, 1) : null,
        ...line,
      };
    });

  const sum = (k: "revenue" | "costToDate" | "earned" | "billed" | "projectedGp" | "backlog") => r2(rows.reduce((a, r) => a + r[k], 0));
  const over = r2(rows.filter((r) => r.overUnder > 0).reduce((a, r) => a + r.overUnder, 0));
  const under = r2(rows.filter((r) => r.overUnder < 0).reduce((a, r) => a + r.overUnder, 0));
  const revenue = sum("revenue");
  return {
    rows,
    totals: {
      jobs: rows.length,
      revenue,
      costToDate: sum("costToDate"),
      earned: sum("earned"),
      billed: sum("billed"),
      overbilled: over,
      underbilled: under,
      net: r2(over + under),
      projectedGp: sum("projectedGp"),
      marginPct: revenue ? round((sum("projectedGp") / revenue) * 100, 1) : null,
      backlog: sum("backlog"),
      fading: rows.filter((r) => r.fade != null && r.fade <= -2).length,
      losses: rows.filter((r) => r.loss).length,
      stale: rows.filter((r) => r.stale && r.hasCosts).length,
      snapshotSaved: (await prisma.wipSnapshot.count({ where: { month: thisMonth() } })) > 0,
    },
  };
}

export const thisMonth = (d = new Date()) => d.toISOString().slice(0, 7);
export const prevMonth = (d = new Date()) => thisMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)));

/** The PM's cost-to-complete forecast for a job. */
export async function setEtc(projectId: string, etc: number | null, actor: { id: string; name: string }) {
  if (etc != null && (!Number.isFinite(etc) || etc < 0)) throw new Error("Cost to complete must be zero or more.");
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { wipEtc: true } });
  await prisma.project.update({ where: { id: projectId }, data: { wipEtc: etc, wipEtcAt: etc == null ? null : new Date(), wipEtcBy: etc == null ? null : actor.name } });
  await prisma.auditLog.create({ data: { userId: actor.id || null, entity: "Project", entityId: projectId, action: "wip_etc", before: { etc: before.wipEtc }, after: { etc } } });
}

/** Keeps this month's WIP lines (replacing any saved earlier this month). */
export async function saveSnapshot(user: { id: string; name: string; role: string }) {
  const { rows } = await wipSchedule(user);
  const month = thisMonth();
  for (const r of rows) {
    const data = { revenue: r.revenue, costToDate: r.costToDate, estTotalCost: r.estTotalCost, pctComplete: r.pctComplete, earned: r.earned, billed: r.billed, overUnder: r.overUnder, projectedGp: r.projectedGp, bidMarginPct: r.bidMarginPct, createdBy: user.name };
    await prisma.wipSnapshot.upsert({ where: { month_projectId: { month, projectId: r.id } }, create: { month, projectId: r.id, ...data }, update: data });
  }
  return { month, jobs: rows.length };
}

/** WIP as CSV for the CPA / surety. */
export function wipCsv(w: Awaited<ReturnType<typeof wipSchedule>>) {
  const head = ["Job", "Status", "Contract (with COs)", "Cost to date", "Est. total cost", "Basis", "% complete", "Earned revenue", "Billed to date", "Over (under) billed", "Projected GP", "Projected margin %", "Bid margin %", "Fade (pts)", "Backlog"];
  const esc = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = w.rows.map((r) => [r.name, r.status, r.revenue, r.costToDate, r.estTotalCost, r.basis, r.pctComplete, r.earned, r.billed, r.overUnder, r.projectedGp, r.projectedMarginPct, r.bidMarginPct, r.fade, r.backlog].map(esc).join(","));
  const t = w.totals;
  lines.push(["TOTAL", "", t.revenue, t.costToDate, "", "", "", t.earned, t.billed, t.net, t.projectedGp, t.marginPct, "", "", t.backlog].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}
