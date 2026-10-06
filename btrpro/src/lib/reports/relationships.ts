// Customer (GC / builder) relationship health from the estimating schedule: who's still sending bids, who's
// cooling off, and who went quiet. Repeat GCs are most of a specialty contractor's work; most firms notice a
// GC stopped inviting them months late. Win-back outreach works best 30–90 days after an account goes quiet.
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";

const DAY = 86_400_000;
export type Health = "ACTIVE" | "COOLING" | "DORMANT" | "DECLINING";

export function health(daysSinceLast: number, bids12: number, bidsPrior12: number): Health {
  if (daysSinceLast > 120) return "DORMANT";
  if (daysSinceLast > 60) return "COOLING";
  if (bidsPrior12 >= 4 && bids12 < bidsPrior12 * 0.5) return "DECLINING";
  return "ACTIVE";
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.,]+$/, "").toLowerCase();

export async function relationships(now = new Date()) {
  const since = new Date(now.getTime() - 730 * DAY);
  const rows = await prisma.estimateLog.findMany({
    where: { customer: { not: null }, OR: [{ receivedAt: { gte: since } }, { bidDate: { gte: since } }, { sentAt: { gte: since } }, { createdAt: { gte: since } }] },
    select: { customer: true, market: true, board: true, receivedAt: true, bidDate: true, sentAt: true, createdAt: true },
  });
  const by = new Map<string, { name: string; markets: Set<string>; dates: Date[]; won: number; lost: number }>();
  for (const r of rows) {
    const k = norm(r.customer!);
    if (!k) continue;
    const g = by.get(k) ?? { name: r.customer!.trim(), markets: new Set(), dates: [], won: 0, lost: 0 };
    g.markets.add(r.market);
    g.dates.push(r.receivedAt ?? r.bidDate ?? r.sentAt ?? r.createdAt);
    if (r.board === "SOLD") g.won++;
    if (r.board === "LOST") g.lost++;
    by.set(k, g);
  }
  const y1 = now.getTime() - 365 * DAY;
  const out = [...by.values()]
    .map((g) => {
      const last = new Date(Math.max(...g.dates.map((d) => d.getTime())));
      const bids12 = g.dates.filter((d) => d.getTime() >= y1).length;
      const bidsPrior12 = g.dates.length - bids12;
      const days = Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY));
      return {
        name: g.name,
        market: [...g.markets].join(" / "),
        last,
        days,
        bids12,
        bidsPrior12,
        won: g.won,
        rate: g.won + g.lost ? round((g.won / (g.won + g.lost)) * 100, 1) : null,
        health: health(days, bids12, bidsPrior12),
      };
    })
    // one-off bidders aren't relationships
    .filter((c) => c.bids12 + c.bidsPrior12 >= 3);
  const order: Record<Health, number> = { DORMANT: 0, DECLINING: 1, COOLING: 2, ACTIVE: 3 };
  out.sort((a, b) => order[a.health] - order[b.health] || b.bids12 + b.bidsPrior12 - (a.bids12 + a.bidsPrior12));
  return { customers: out, counts: { ACTIVE: out.filter((c) => c.health === "ACTIVE").length, COOLING: out.filter((c) => c.health === "COOLING").length, DORMANT: out.filter((c) => c.health === "DORMANT").length, DECLINING: out.filter((c) => c.health === "DECLINING").length } };
}
