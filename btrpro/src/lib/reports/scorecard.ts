// Owner scorecard: the dozen numbers that tell an owner whether growth is healthy, each with a benchmark
// from industry research (docs/growth-research.md). Built from data already in BTRpro.
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { balanceDue } from "@/lib/billing/math";
import { payTotals, type SovLine } from "@/lib/billing/payapps";
import { wipSchedule } from "./wip";
import { cashForecast } from "./cash";
import { riskDesk } from "./risk";
import { extrasDesk } from "@/lib/production/field";
import { bondingCapacity } from "./bonding";
import { relationships } from "./relationships";
import { safetyOverview } from "@/lib/safety/service";
import { appName } from "@/lib/company-profile";

const DAY = 86_400_000;
const r2 = (n: number) => round(n, 2);

export type Tone = "good" | "watch" | "bad" | "none";
export type Metric = { key: string; label: string; value: string; tone: Tone; benchmark: string; href?: string; note?: string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Win rate and bid volume from the estimating schedule, trailing 12 months. */
export async function bidStats(now = new Date()) {
  const since = new Date(now.getTime() - 365 * DAY);
  const rows = await prisma.estimateLog.findMany({
    where: { board: { in: ["SOLD", "LOST", "SENT"] }, OR: [{ bidDate: { gte: since } }, { sentAt: { gte: since } }, { AND: [{ bidDate: null }, { sentAt: null }, { updatedAt: { gte: since } }] }] },
    select: { board: true, market: true, estimator: true, customer: true },
  });
  const decided = rows.filter((r) => r.board !== "SENT");
  const rate = (xs: typeof rows) => {
    const d = xs.filter((r) => r.board !== "SENT");
    return d.length ? round((d.filter((r) => r.board === "SOLD").length / d.length) * 100, 1) : null;
  };
  const group = (k: "market" | "estimator" | "customer", min = 3) => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const v = (r[k] ?? "").trim() || "Not recorded";
      m.set(v, [...(m.get(v) ?? []), r]);
    }
    return [...m.entries()]
      .map(([name, xs]) => ({ name, bids: xs.length, decided: xs.filter((x) => x.board !== "SENT").length, won: xs.filter((x) => x.board === "SOLD").length, rate: rate(xs) }))
      .filter((g) => g.decided >= min)
      .sort((a, b) => b.bids - a.bids);
  };
  const due = await prisma.estimateLog.groupBy({ by: ["estimator"], where: { board: "CURRENT", dueAt: { gte: new Date(now.getTime() - DAY), lte: new Date(now.getTime() + 14 * DAY) } }, _count: true });
  return {
    bids: rows.length,
    decided: decided.length,
    rate: rate(rows),
    byMarket: group("market", 1),
    byEstimator: group("estimator", 3),
    byCustomer: group("customer", 3).slice(0, 12),
    dueNext14: due.map((d) => ({ estimator: d.estimator ?? "Unassigned", count: d._count })).sort((a, b) => b.count - a.count),
  };
}

/** Revenue billed in the trailing window, by customer (invoices, builder billing, AIA pay apps). */
async function trailingRevenue(days: number, now: Date) {
  const since = new Date(now.getTime() - days * DAY);
  const [inv, lines, apps] = await Promise.all([
    prisma.invoice.findMany({ where: { status: { not: "VOID" }, createdAt: { gte: since } }, select: { subtotal: true, project: { select: { clientCompany: { select: { name: true } }, name: true } } } }),
    prisma.prodLine.findMany({ where: { billedAt: { gte: since }, sell: { not: null } }, select: { sell: true, builder: true } }),
    prisma.payApp.findMany({ where: { status: { in: ["SUBMITTED", "PAID"] }, submittedAt: { gte: since } }, select: { lines: true, retainagePct: true, contract: { select: { gc: true } } } }),
  ]);
  const by = new Map<string, number>();
  const add = (k: string | null | undefined, v: number) => by.set((k ?? "").trim() || "Other", (by.get((k ?? "").trim() || "Other") ?? 0) + v);
  for (const i of inv) add(i.project.clientCompany?.name ?? i.project.name, i.subtotal);
  for (const l of lines) add(l.builder, l.sell!);
  for (const a of apps) {
    const t = payTotals(a.lines as SovLine[], a.retainagePct);
    add(a.contract.gc, t.thisPeriod + t.stored);
  }
  const total = r2([...by.values()].reduce((a, b) => a + b, 0));
  return { total, byCustomer: [...by.entries()].map(([name, v]) => ({ name, revenue: r2(v), share: total ? round((v / total) * 100, 1) : 0 })).sort((a, b) => b.revenue - a.revenue) };
}

/** Weeks of queued work per crew: open schedule lines ÷ lines that crew finishes per week (last 8 weeks). */
export async function crewLoad(now = new Date()) {
  const [open, done] = await Promise.all([
    prisma.prodLine.groupBy({ by: ["crew"], where: { board: { in: ["ADD", "UPCOMING", "CURRENT"] }, crew: { not: null }, completed: null }, _count: true }),
    prisma.prodLine.groupBy({ by: ["crew"], where: { completedAt: { gte: new Date(now.getTime() - 56 * DAY) }, crew: { not: null } }, _count: true }),
  ]);
  return open
    .map((o) => {
      const perWeek = (done.find((d) => d.crew === o.crew)?._count ?? 0) / 8;
      return { crew: o.crew!, open: o._count, perWeek: round(perWeek, 1), weeks: perWeek ? round(o._count / perWeek, 1) : null };
    })
    .sort((a, b) => (b.weeks ?? 999) - (a.weeks ?? 999));
}

export async function scorecard(user: { id: string; role: string }, now = new Date()) {
  const [wip, cash, risk, bids, rev12, rev90, crews, ar, cos, resBacklog, extras, bond, rel, safety] = await Promise.all([
    wipSchedule(user),
    cashForecast(now),
    riskDesk(now),
    bidStats(now),
    trailingRevenue(365, now),
    trailingRevenue(90, now),
    crewLoad(now),
    prisma.invoice.findMany({ where: { status: { in: ["SENT", "PARTIAL"] } }, select: { amountDue: true, dueDate: true, payments: { select: { amount: true } } } }),
    prisma.changeOrder.findMany({ where: { status: "PENDING" }, select: { amount: true, createdAt: true, kind: true } }),
    prisma.prodLine.aggregate({ where: { board: { in: ["ADD", "UPCOMING", "CURRENT"] }, completed: null, market: "RESIDENTIAL" }, _sum: { sell: true } }),
    extrasDesk(now),
    bondingCapacity(user),
    relationships(now),
    safetyOverview(now),
  ]);
  const lastYear = safety.years[1];
  const backlog = r2(wip.totals.backlog + (resBacklog._sum.sell ?? 0));
  const monthly = rev12.total / 12;
  // until BTRpro holds real billing history (invoices, pay apps, builder billing), months and shares would mislead
  const thin = rev12.total < Math.max(250_000, backlog / 24);
  const backlogMonths = monthly && !thin ? round(backlog / monthly, 1) : null;
  const arOpen = r2(ar.reduce((a, i) => a + Math.max(0, balanceDue(i)), 0));
  const ar60 = r2(ar.filter((i) => i.dueDate.getTime() < now.getTime() - 60 * DAY).reduce((a, i) => a + Math.max(0, balanceDue(i)), 0));
  const dso = rev90.total ? Math.round(arOpen / (rev90.total / 90)) : null;
  const coPending = r2(cos.filter((c) => c.kind !== "CREDIT").reduce((a, c) => a + c.amount, 0));
  const coAge = cos.length ? Math.round(cos.reduce((a, c) => a + (now.getTime() - c.createdAt.getTime()) / DAY, 0) / cos.length) : null;
  const top = rev12.byCustomer[0];

  const m: Metric[] = [
    {
      key: "backlog",
      label: "Backlog",
      value: backlogMonths == null ? usd(backlog) : `${usd(backlog)} · ${backlogMonths} months`,
      tone: backlogMonths == null ? "none" : backlogMonths >= 8 && backlogMonths <= 15 ? "good" : backlogMonths >= 4 ? "watch" : "bad",
      note: thin ? `Months appear once ${appName()} has a year of billing (invoices, pay apps, builder billing)` : undefined,
      benchmark: "8–12 months of revenue under contract is steady; under 4 means sell now, over 15 means check crew capacity",
      href: "/reports/wip",
    },
    {
      key: "margin",
      label: "Projected gross margin (open jobs)",
      value: wip.totals.marginPct == null ? "—" : `${wip.totals.marginPct}%`,
      tone: wip.totals.losses ? "bad" : wip.totals.fading ? "watch" : wip.totals.marginPct == null ? "none" : "good",
      benchmark: "Jobs should finish at or above their bid margin; any job fading 2+ points gets a look this week",
      note: `${wip.totals.fading} fading, ${wip.totals.losses} forecast to lose money`,
      href: "/reports/wip?only=fade",
    },
    {
      key: "billing",
      label: "Net over / (under) billing",
      value: wip.totals.net >= 0 ? usd(wip.totals.net) : `(${usd(-wip.totals.net)})`,
      tone: wip.totals.underbilled < -Math.max(25_000, wip.totals.revenue * 0.02) ? "watch" : "good",
      benchmark: "Slightly overbilled is healthy; growing underbilling means unbilled work or cost overruns — sureties watch this",
      href: "/reports/wip",
    },
    {
      key: "cash",
      label: "Cash low point, next 13 weeks",
      value: cash.opening == null ? "set bank balance" : usd(cash.low.close),
      tone: cash.opening == null ? "none" : cash.low.close < 0 || cash.belowFloor.length ? "bad" : "good",
      benchmark: "Never below your floor; growth eats ~$150–250K of working capital per extra $1M of revenue",
      href: "/reports/cash",
    },
    {
      key: "dso",
      label: "Days to get paid (DSO)",
      value: dso == null ? "—" : `${dso} days`,
      tone: dso == null || !rev90.total ? "none" : dso <= 45 ? "good" : dso <= 60 ? "watch" : "bad",
      benchmark: "Under 45 days",
      note: `${usd(arOpen)} open · ${usd(ar60)} over 60 days late`,
      href: "/reports/ar",
    },
    {
      key: "winrate",
      label: "Bid win rate (12 months)",
      value: bids.rate == null ? "—" : `${bids.rate}% of ${bids.decided} decided`,
      tone: bids.rate == null ? "none" : bids.rate >= 20 ? "good" : bids.rate >= 12 ? "watch" : "bad",
      benchmark: "Hard-bid public 10–20%, competitive private 15–25%, negotiated higher. Low rates mean too many low-odds bids",
      note: bids.bids > bids.decided ? `${(bids.bids - bids.decided).toLocaleString()} sent bids have no win/loss marked — mark results on the estimating schedule for a true rate` : undefined,
      href: "/reports/scorecard#bids",
    },
    {
      key: "cos",
      label: "Change orders waiting on approval",
      value: `${usd(coPending)} · ${cos.length}`,
      tone: !cos.length ? "good" : (coAge ?? 0) > 30 ? "bad" : "watch",
      benchmark: "Price and send extras within days; specialty contractors lose 1–3% of revenue to unbilled or written-off change orders",
      note: coAge != null ? `waiting ${coAge} days on average` : undefined,
    },
    {
      key: "extras",
      label: "Field extras not priced yet",
      value: String(extras.unpriced),
      tone: !extras.unpriced ? "good" : (extras.oldestUnpriced ?? 0) > 7 ? "bad" : "watch",
      note: extras.oldestUnpriced != null ? `oldest ${extras.oldestUnpriced} days` : undefined,
      benchmark: "Price a signed tag within a week. Paper tags take ~3 weeks to become a change order; on-site digital tags ~3.5 days",
      href: "/reports/extras",
    },
    {
      key: "concentration",
      label: "Biggest customer's share (12 months)",
      value: top && !thin ? `${top.share}% · ${top.name}` : "—",
      tone: !top || thin ? "none" : top.share > 30 ? "bad" : top.share > 20 ? "watch" : "good",
      note: thin ? `Needs a year of billing in ${appName()} to be meaningful` : undefined,
      benchmark: "Keep any one GC or builder under ~20–25% of revenue",
      href: "/reports/scorecard#customers",
    },
    {
      key: "bonding",
      label: "Bonding room left",
      value: bond.room == null ? "enter surety limits" : usd(bond.room),
      tone: bond.room == null ? "none" : bond.room < 0 ? "bad" : (bond.usedPct ?? 0) > 80 ? "watch" : "good",
      note: bond.usedPct != null ? `${bond.usedPct}% of ${bond.fromLetter ? "the surety's" : "the estimated"} aggregate used` : undefined,
      benchmark: "Keep 20%+ of the aggregate free so the next big bonded bid isn't turned down",
      href: "/reports/bonding",
    },
    {
      key: "quiet",
      label: "Repeat customers gone quiet",
      value: String(rel.counts.DORMANT + rel.counts.DECLINING),
      tone: !rel.customers.length ? "none" : rel.counts.DORMANT + rel.counts.DECLINING > 0 ? "watch" : "good",
      note: rel.customers.length ? `${rel.counts.ACTIVE} of ${rel.customers.length} repeat customers active` : undefined,
      benchmark: "Call a GC or builder within 30–90 days of their bid invitations stopping",
      href: "/reports/customers",
    },
    {
      key: "safety",
      label: `Safety: ${lastYear.year} TRIR · EMR`,
      value: `${lastYear.trir ?? "—"} · ${lastYear.emr ?? "—"}`,
      tone: lastYear.emr == null && lastYear.trir == null ? "none" : (lastYear.emr ?? 0) > 1 ? "bad" : (lastYear.trir ?? 0) > 5 ? "watch" : "good",
      note: safety.missing.length ? `prequal packet missing ${safety.missing.length} item${safety.missing.length === 1 ? "" : "s"}` : "prequal packet complete",
      benchmark: "EMR at or under 1.0 keeps you on GC bid lists; roofing contractors average a TRIR near 5 (BLS), under that is a selling point",
      href: "/safety",
    },
    {
      key: "insurance",
      label: "Crews with lapsed insurance and open work",
      value: String(risk.lapsedWithWork),
      tone: risk.lapsedWithWork ? "bad" : "good",
      benchmark: "Zero. Alerts at 60/30/15 days before COI or workers' comp lapses",
      href: "/reports/risk",
    },
    {
      key: "liens",
      label: "Lien deadlines in the next 30 days",
      value: String(risk.liensDueSoon),
      tone: risk.liensDueSoon ? "watch" : "good",
      benchmark: risk.lienRule ? `${risk.lienRule.stateName}: ${risk.lienRule.summary}` : "Lien deadline MISSING for this state (Settings → Company profile)",
      href: "/reports/risk",
    },
  ];
  return { metrics: m, bids, revenue12: rev12, crews, backlog, generatedAt: now };
}
