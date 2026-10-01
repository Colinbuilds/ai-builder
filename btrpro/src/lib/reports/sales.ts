// Sales and production dashboard (§13): pipeline value, close rate, sales by rep, production backlog.
// Values are what the app holds (proposal prices, contract amounts); a job with no price yet is counted, not guessed.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";

const PRE_SOLD = ["LEAD", "ESTIMATING", "SUBMITTED"] as const;
const BACKLOG = ["SOLD", "SCHEDULED", "IN_PRODUCTION"] as const;
export type Market = "RESIDENTIAL" | "COMMERCIAL" | null;

export async function pipeline(market: Market) {
  const base: Prisma.ProjectWhereInput = market ? { market } : {};
  const open = await prisma.project.findMany({
    where: { ...base, status: { in: [...PRE_SOLD] } },
    select: { id: true, status: true, salespersonId: true },
  });
  const props = await prisma.proposal.findMany({
    where: {
      projectId: { in: open.map((p) => p.id) },
      status: { notIn: ["VOID", "DECLINED"] },
    },
    select: { projectId: true, basePrice: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const price = new Map<string, number>();
  for (const pr of props)
    if (!price.has(pr.projectId)) price.set(pr.projectId, pr.basePrice);
  const stages = PRE_SOLD.map((s) => {
    const jobs = open.filter((p) => p.status === s);
    const priced = jobs.filter((p) => price.has(p.id));
    return {
      stage: s,
      jobs: jobs.length,
      priced: priced.length,
      value: round(
        priced.reduce((a, p) => a + price.get(p.id)!, 0),
        2,
      ),
    };
  });
  const backlogJobs = await prisma.project.findMany({
    where: { ...base, status: { in: [...BACKLOG] } },
    select: { status: true, contractAmount: true },
  });
  const backlog = BACKLOG.map((s) => {
    const jobs = backlogJobs.filter((p) => p.status === s);
    return {
      stage: s,
      jobs: jobs.length,
      noContract: jobs.filter((p) => p.contractAmount == null).length,
      value: round(
        jobs.reduce((a, p) => a + (p.contractAmount ?? 0), 0),
        2,
      ),
    };
  });
  return { stages, backlog };
}

/**
 * Close rate from stage changes made in the app during the period: a job counts as won when it moved to Sold,
 * lost when it moved to Lost. Jobs imported already sold aren't counted either way.
 */
export async function closeRate(from: Date, to: Date, market: Market) {
  const moves = await prisma.projectActivity.findMany({
    where: {
      kind: "stage",
      createdAt: { gte: from, lte: to },
      ...(market ? { project: { market } } : {}),
    },
    select: {
      projectId: true,
      data: true,
      createdAt: true,
      project: {
        select: {
          salespersonId: true,
          contractAmount: true,
          salesperson: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  // last decision per job in the period
  const decided = new Map<
    string,
    { won: boolean; rep: string | null; repName: string; amount: number | null }
  >();
  for (const m of moves) {
    const toStage = (m.data as { to?: string } | null)?.to;
    if (toStage !== "SOLD" && toStage !== "LOST") continue;
    decided.set(m.projectId, {
      won: toStage === "SOLD",
      rep: m.project.salespersonId,
      repName: m.project.salesperson?.name ?? "No salesperson",
      amount: m.project.contractAmount,
    });
  }
  const all = [...decided.values()];
  const byRep = new Map<
    string,
    { name: string; won: number; lost: number; sold: number; unpriced: number }
  >();
  for (const d of all) {
    const k = d.rep ?? "none";
    const r = byRep.get(k) ?? {
      name: d.repName,
      won: 0,
      lost: 0,
      sold: 0,
      unpriced: 0,
    };
    if (d.won) {
      r.won++;
      if (d.amount == null) r.unpriced++;
      else r.sold = round(r.sold + d.amount, 2);
    } else r.lost++;
    byRep.set(k, r);
  }
  const won = all.filter((d) => d.won).length;
  const rate = (w: number, l: number) =>
    w + l ? round((w / (w + l)) * 100, 1) : null;
  return {
    won,
    lost: all.length - won,
    rate: rate(won, all.length - won),
    sold: round(
      all.filter((d) => d.won).reduce((a, d) => a + (d.amount ?? 0), 0),
      2,
    ),
    reps: [...byRep.values()]
      .map((r) => ({ ...r, rate: rate(r.won, r.lost) }))
      .sort((a, b) => b.sold - a.sold),
  };
}
