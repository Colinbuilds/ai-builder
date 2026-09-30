// Numbers for the dashboard: pipeline by milestone, action items, activity feed, leaderboard, schedule, AR, 30-day counts.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MILESTONES, prettyStages, stageMoveTitle } from "@/lib/projects/milestones";
import { AGING_BUCKETS, agingBucket, balanceDue } from "@/lib/billing/math";
import type { MarketView } from "@/lib/market";

const DAY = 86_400_000;
const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const round = (n: number) => Math.round(n * 100) / 100;

export async function dashboardData(view: MarketView, userId: string) {
  const m: Prisma.ProjectWhereInput = view !== "ALL" ? { market: view } : {};
  const today = startOfDay();
  const now = new Date();
  const week = new Date(today.getTime() + 7 * DAY);
  const since30 = new Date(today.getTime() - 30 * DAY);

  const [byStage, unassigned, bidsDue, watch, invoices, cosOut, ordersDraft, measuresPending, proposalsOut, overdueTasks] = await Promise.all([
    prisma.project.groupBy({ by: ["status"], where: m, _count: true, _sum: { contractAmount: true } }),
    prisma.project.count({ where: { ...m, status: "LEAD", salespersonId: null } }),
    prisma.project.count({ where: { ...m, status: { in: ["LEAD", "ESTIMATING"] }, bidDueDate: { gte: today, lt: week } } }),
    prisma.jobWatch.count({ where: { userId, project: m } }),
    prisma.invoice.findMany({ where: { status: { in: ["SENT", "PARTIAL"] }, project: m }, include: { payments: { select: { amount: true } }, project: { select: { status: true } } } }),
    prisma.changeOrder.count({ where: { status: "PENDING", sentAt: { not: null }, project: m } }),
    prisma.materialOrder.count({ where: { status: "DRAFT", project: m } }),
    prisma.project.count({ where: { ...m, eagleViewOrderedAt: { not: null }, measurements: { none: {} } } }),
    prisma.proposal
      .findMany({ where: { status: { in: ["SENT", "VIEWED"] } }, select: { projectId: true } })
      .then(async (ps) => {
        if (view === "ALL") return ps.length;
        const ok = new Set((await prisma.project.findMany({ where: { ...m, id: { in: ps.map((x) => x.projectId) } }, select: { id: true } })).map((x) => x.id));
        return ps.filter((x) => ok.has(x.projectId)).length;
      }),
    prisma.task.count({ where: { doneAt: null, dueDate: { lt: today }, OR: [{ projectId: null }, { project: m }] } }),
  ]);
  const stageCount = (s: string) => byStage.find((b) => b.status === s)?._count ?? 0;

  const pipeline = MILESTONES.filter((x) => x.key !== "CLOSED").map((x) => {
    const rows = byStage.filter((b) => (x.stages as string[]).includes(b.status));
    return { key: x.key, letter: x.letter, label: x.label, color: x.color, stage: x.stages[0], count: rows.reduce((a, r) => a + r._count, 0), value: round(rows.reduce((a, r) => a + (r._sum.contractAmount ?? 0), 0)) };
  });

  const open = invoices.map((i) => ({ ...i, balance: balanceDue(i) })).filter((i) => i.balance > 0.005);
  const overdueInvoices = open.filter((i) => i.dueDate < today).length;
  const deadWithBalance = new Set(open.filter((i) => i.project.status === "LOST" || i.project.status === "CLOSED").map((i) => i.projectId)).size;
  const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<(typeof AGING_BUCKETS)[number], number>;
  for (const i of open) aging[agingBucket(i.dueDate, now)] = round(aging[agingBucket(i.dueDate, now)] + i.balance);

  const actions = {
    progress: [
      { key: "U", label: "Unassigned leads", n: unassigned, href: "/jobs?stage=LEAD&unassigned=1", stage: "LEAD" },
      { key: "P", label: "Bids due this week", n: bidsDue, href: "/jobs?due=week", stage: "ESTIMATING" },
      { key: "A", label: "Submitted, awaiting decision", n: stageCount("SUBMITTED"), href: "/jobs?stage=SUBMITTED", stage: "SUBMITTED" },
      { key: "C", label: "Sold, not scheduled", n: stageCount("SOLD"), href: "/jobs?stage=SOLD", stage: "SOLD" },
      { key: "I", label: "Complete, not invoiced", n: stageCount("COMPLETE"), href: "/jobs?stage=COMPLETE", stage: "COMPLETE" },
      { key: "X", label: "Paid, ready to close", n: stageCount("PAID"), href: "/jobs?stage=PAID", stage: "CLOSED" },
      { key: "W", label: "Watch list", n: watch, href: "/jobs?watch=1", stage: null },
    ],
    financial: [
      { key: "OI", label: "Overdue invoices", n: overdueInvoices, href: "/reports/ar" },
      { key: "LB", label: "Lost/closed jobs with balance due", n: deadWithBalance, href: "/reports/ar" },
      { key: "CO", label: "Change orders out for signature", n: cosOut, href: "/jobs?stage=all" },
    ],
    management: [
      { key: "OR", label: "Material orders not sent", n: ordersDraft, href: "/deliveries" },
      { key: "MR", label: "Measurement orders waiting", n: measuresPending, href: "/jobs?stage=all" },
      { key: "PS", label: "Proposals awaiting signature", n: proposalsOut, href: "/jobs?stage=SUBMITTED" },
      { key: "TK", label: "Overdue tasks", n: overdueTasks, href: "/today" },
    ],
  };

  return { pipeline, active: pipeline.reduce((a, p) => a + p.count, 0), actions, aging, arTotal: round(open.reduce((a, i) => a + i.balance, 0)) };
}

/** Company-wide activity feed: new leads, stage moves, and chat comments. */
export async function activityFeed(view: MarketView, take = 30) {
  const m: Prisma.ProjectWhereInput = view !== "ALL" ? { market: view } : {};
  const [acts, msgs] = await Promise.all([
    prisma.projectActivity.findMany({
      where: { project: m, kind: { in: ["created", "stage", "proposal", "payment", "invoice"] } },
      include: { user: { select: { name: true } }, project: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.jobMessage.findMany({
      where: { project: m },
      include: { author: { select: { name: true } }, project: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  return [
    ...acts.map((a) => ({ id: a.id, at: a.createdAt, kind: a.kind, title: a.kind === "created" ? "New lead" : a.kind === "stage" ? (stageMoveTitle(a.data) ?? "Job moved") : a.kind.charAt(0).toUpperCase() + a.kind.slice(1), by: a.user?.name ?? null, text: a.kind === "created" ? null : a.kind === "stage" ? stageReason(a.text) : prettyStages(a.text), job: a.project, href: `/projects/${a.project.id}`, sold: a.kind === "stage" && /→ SOLD/.test(a.text) })),
    ...msgs.map((x) => ({ id: x.id, at: x.createdAt, kind: "comment", title: "Comment", by: x.author.name, text: x.body.length > 120 ? `${x.body.slice(0, 120)}…` : x.body, job: x.project, href: `/projects/${x.project.id}/chat`, sold: false })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, take);
}

/** A stage move's text minus the "X moved the job A → B" part, leaving only the reason if one was given. */
const stageReason = (text: string) => {
  const r = text.replace(/^.*?→\s*[A-Z_]+\s*/, "").replace(/^[(:,.\-–—\s]+|[)\s]+$/g, "");
  return r ? prettyStages(r) : null;
};

export type Period = "week" | "month" | "ytd";
export function periodStart(p: Period, now = new Date()) {
  if (p === "week") {
    const d = startOfDay(now);
    return new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY); // Monday
  }
  if (p === "ytd") return new Date(now.getFullYear(), 0, 1);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Sold dollars by salesperson (contract signed in the period). */
export async function leaderboard(view: MarketView, p: Period) {
  const from = periodStart(p);
  const sold = await prisma.project.findMany({
    where: { ...(view !== "ALL" ? { market: view } : {}), contractSignedAt: { gte: from }, contractAmount: { not: null }, status: { not: "LOST" } },
    select: { contractAmount: true, salesperson: { select: { id: true, name: true } } },
  });
  const by = new Map<string, { name: string; amount: number; jobs: number }>();
  for (const s of sold) {
    const k = s.salesperson?.id ?? "house";
    const e = by.get(k) ?? { name: s.salesperson?.name ?? "House (no salesperson)", amount: 0, jobs: 0 };
    e.amount = round(e.amount + (s.contractAmount ?? 0));
    e.jobs++;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
}

/** Crew days: finished yesterday, on a roof today, and booked in the next 30 days. */
export async function workSchedule(view: MarketView) {
  const m = view !== "ALL" ? { OR: [{ projectId: null }, { project: { market: view } }] } : {};
  const today = startOfDay();
  const noonToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12));
  const yesterday = new Date(noonToday.getTime() - DAY);
  const in30 = new Date(noonToday.getTime() + 30 * DAY);
  const live = { status: { not: "CANCELLED" } };
  const [done, working, outlook] = await Promise.all([
    prisma.scheduleEvent.count({ where: { ...m, ...live, endDate: yesterday } }),
    prisma.scheduleEvent.count({ where: { ...m, ...live, startDate: { lte: noonToday }, endDate: { gte: noonToday } } }),
    prisma.scheduleEvent.count({ where: { ...m, ...live, startDate: { gt: noonToday, lte: in30 } } }),
  ]);
  return { done, working, outlook };
}

/** Last 30 days: new leads, jobs sold, completed, money collected, invoiced, closed. */
export async function activityCounts(view: MarketView) {
  const m: Prisma.ProjectWhereInput = view !== "ALL" ? { market: view } : {};
  const since = new Date(startOfDay().getTime() - 30 * DAY);
  const stageMoves = (to: string) => prisma.projectActivity.count({ where: { project: m, kind: "stage", createdAt: { gte: since }, text: { contains: `→ ${to}` } } });
  const [leads, sold, completed, paid, invoiced, closed] = await Promise.all([
    prisma.project.count({ where: { ...m, createdAt: { gte: since } } }),
    prisma.project.count({ where: { ...m, contractSignedAt: { gte: since } } }),
    stageMoves("COMPLETE"),
    prisma.payment.aggregate({ where: { date: { gte: since }, invoice: { project: m } }, _sum: { amount: true } }),
    prisma.invoice.count({ where: { sentAt: { gte: since }, status: { not: "VOID" }, project: m } }),
    stageMoves("CLOSED"),
  ]);
  return { leads, sold, completed, collected: round(paid._sum.amount ?? 0), invoiced, closed };
}
