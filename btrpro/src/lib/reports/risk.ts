// Risk desk: things that cost real money when nobody is watching the calendar.
// - Crew / sub insurance: certificate of insurance (GL) and workers' comp expiring or lapsed while the crew has
//   open work. A sub without WC on your job puts their payroll on your WC audit.
// - Lien deadline: a construction lien must be recorded within the state's deadline after the company last furnished
//   labor or materials (Nebraska: 120 days, Neb. Rev. Stat. § 52-137 — see region.ts). Jobs with money still owed are
//   listed with the days left; with no deadline for the state, the deadline is MISSING (null).
import { prisma } from "@/lib/db";
import { balanceDue } from "@/lib/billing/math";
import { getCompany } from "@/lib/company-profile";

const DAY = 86_400_000;
export const LIEN_DAYS = 120; // Nebraska (BTR); other states come from the company region

export type Expiry = { what: "COI" | "Workers comp"; date: Date | null; days: number | null };
const daysUntil = (d: Date | null, now: Date) => (d ? Math.floor((d.getTime() - now.getTime()) / DAY) : null);

export function lienDeadline(lastWork: Date, days: number = LIEN_DAYS) {
  return new Date(lastWork.getTime() + days * DAY);
}

export async function riskDesk(now = new Date()) {
  const { region } = await getCompany();
  // ---- crews: active, with open schedule lines or upcoming events
  const crews = await prisma.crew.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, coiExpires: true, workersCompExpires: true } });
  const openLines = await prisma.prodLine.groupBy({ by: ["crew"], where: { board: { in: ["ADD", "UPCOMING", "CURRENT"] }, crew: { not: null } }, _count: true });
  const events = await prisma.scheduleEvent.groupBy({ by: ["crewId"], where: { endDate: { gte: now }, crewId: { not: null } }, _count: true });
  const work = (c: { id: string; name: string }) =>
    (openLines.find((l) => l.crew?.trim().toLowerCase() === c.name.trim().toLowerCase())?._count ?? 0) + (events.find((e) => e.crewId === c.id)?._count ?? 0);
  const crewRows = crews
    .map((c) => {
      const items: Expiry[] = [
        { what: "COI", date: c.coiExpires, days: daysUntil(c.coiExpires, now) },
        { what: "Workers comp", date: c.workersCompExpires, days: daysUntil(c.workersCompExpires, now) },
      ];
      const worst = Math.min(...items.map((i) => (i.days == null ? Infinity : i.days)));
      const missing = items.filter((i) => !i.date).map((i) => i.what);
      return { id: c.id, name: c.name, kind: c.kind, items, worst, missing, openWork: work(c) };
    })
    .filter((c) => c.worst <= 60 || (c.missing.length && c.openWork > 0))
    .sort((a, b) => a.worst - b.worst);

  // ---- liens: jobs with an unpaid balance, by days left from the last day of work
  const owed = await prisma.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIAL"] } },
    select: { amountDue: true, payments: { select: { amount: true } }, project: { select: { id: true, name: true, market: true, status: true, statusChangedAt: true } } },
  });
  const byJob = new Map<string, { id: string; name: string; market: string; status: string; statusChangedAt: Date; owed: number }>();
  for (const i of owed) {
    const bal = balanceDue(i);
    if (bal <= 0.005) continue;
    const cur = byJob.get(i.project.id) ?? { ...i.project, owed: 0 };
    cur.owed += bal;
    byJob.set(i.project.id, cur);
  }
  const ids = [...byJob.keys()];
  const lastEvents = ids.length ? await prisma.scheduleEvent.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { endDate: true } }) : [];
  const liens = [...byJob.values()]
    .map((j) => {
      const ev = lastEvents.find((e) => e.projectId === j.id)?._max.endDate ?? null;
      // last furnishing: the last scheduled work day; else when the job was marked complete
      const done = ["COMPLETE", "INVOICED", "PAID", "CLOSED"].includes(j.status) ? j.statusChangedAt : null;
      const lastWork = ev && (!done || ev > done) ? ev : done;
      const deadline = lastWork && region.lien ? lienDeadline(lastWork, region.lien.days) : null;
      return { ...j, owed: Math.round(j.owed * 100) / 100, lastWork, lastWorkSource: lastWork === ev ? "last scheduled day" : "marked complete", deadline, daysLeft: daysUntil(deadline, now) };
    })
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  return {
    crews: crewRows,
    lapsedWithWork: crewRows.filter((c) => c.worst < 0 && c.openWork > 0).length,
    liens,
    lienRule: region.lien ? { ...region.lien, state: region.state, stateName: region.name } : null,
    liensDueSoon: liens.filter((l) => l.daysLeft != null && l.daysLeft >= 0 && l.daysLeft <= 30).length,
  };
}
