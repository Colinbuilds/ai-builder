// Company playbook (SOPs). Growth research: every process that lives in one person's head breaks when that
// person is out, and the owner stays the bottleneck. Each procedure has an owner and a review date.
import { prisma } from "@/lib/db";

export class PlaybookError extends Error {}
export const AREAS = { OFFICE: "Office", ESTIMATING: "Estimating & sales", PRODUCTION: "Production & crews", PURCHASING: "Purchasing", SAFETY: "Safety", FINANCE: "Finance & month-end" } as const;
export type Area = keyof typeof AREAS;
const DAY = 86_400_000;

export function reviewDue(s: { reviewedAt: Date | null; reviewEveryMonths: number; createdAt: Date }, now = new Date()) {
  const base = s.reviewedAt ?? s.createdAt;
  const due = new Date(base.getTime() + s.reviewEveryMonths * 30.44 * DAY);
  return { due, overdue: !s.reviewedAt || due < now };
}

export async function saveSop(id: string | null, x: { title: string; area: string; ownerName: string | null; body: string; reviewEveryMonths: number; draft: boolean }, actor: { name: string }) {
  if (!x.title.trim()) throw new PlaybookError("Give it a title (what the procedure is for).");
  if (!(x.area in AREAS)) throw new PlaybookError("Pick the area.");
  if (x.body.trim().length < 20) throw new PlaybookError("Write the steps — numbered, one action each.");
  if (!Number.isInteger(x.reviewEveryMonths) || x.reviewEveryMonths < 1 || x.reviewEveryMonths > 36) throw new PlaybookError("Review every 1–36 months.");
  const data = { title: x.title.trim(), area: x.area, ownerName: x.ownerName?.trim() || null, body: x.body.trim(), reviewEveryMonths: x.reviewEveryMonths, draft: x.draft, updatedBy: actor.name };
  return id ? prisma.sop.update({ where: { id }, data }) : prisma.sop.create({ data });
}

/** The owner confirms the procedure still matches how the work is done. */
export async function markReviewed(id: string, actor: { name: string }) {
  return prisma.sop.update({ where: { id }, data: { reviewedAt: new Date(), reviewedBy: actor.name, draft: false } });
}

/**
 * Starter drafts for the processes BTRpro already runs, so nobody starts from a blank page. They describe the
 * app's workflow, are marked Draft, and have no owner until someone takes them and edits them to match BTR.
 */
export const STARTERS: { title: string; area: Area; body: string }[] = [
  {
    title: "Extra work in the field → change order",
    area: "PRODUCTION",
    body: `1. Before doing any work outside the contract, the crew lead tells the super/builder rep what it is.
2. Same day, the crew lead opens the job in the crew portal → **Extra work tag**: what was done, workers, man-hours, materials, photos, and the super signs on the phone.
3. The PM prices the tag from the job's **Production** tab → *Make change order* within 2 business days.
4. Send the change order for signature from **Costs**.
5. Weekly: the PM clears anything on **Reports → Extra work desk** older than 7 days.`,
  },
  {
    title: "Month-end WIP",
    area: "FINANCE",
    body: `1. By the 3rd business day, each PM opens **Reports → WIP schedule** and enters *cost to complete* for every open job they run.
2. The office checks billing is current (invoices, pay apps, builder billing) for the month.
3. Admin/Office presses **Save month-end WIP**.
4. Owners review jobs fading 2+ points and any loss jobs in the weekly meeting.
5. Download the CSV for the CPA / surety at quarter-end.`,
  },
  {
    title: "New crew or sub onboarding",
    area: "OFFICE",
    body: `1. Get the W-9, certificate of insurance (GL) and workers' comp certificate — BTR named as certificate holder.
2. Enter the crew on **Crews** with COI and workers' comp expiration dates.
3. Set the crew's scopes in **Schedule → Who does what**.
4. Create the crew portal login and walk the lead through photos, extra-work tags, safety talks and invoices.
5. The **Risk desk** warns 60/30/15 days before either policy lapses.`,
  },
  {
    title: "Tax-exempt public job setup (Form 17)",
    area: "OFFICE",
    body: `1. When a public job is sold, confirm the owner is tax-exempt.
2. Execute the Nebraska Form 17 Purchasing Agent Appointment with the owner **before** any material is bought.
3. Mark Form 17 executed on the job; only then set the job tax-exempt in BTRpro.
4. Purchasing confirms supplier orders go out tax-exempt with the appointment attached.`,
  },
  {
    title: "Weekly safety talk",
    area: "SAFETY",
    body: `1. Every crew holds a 5-minute talk at the start of the first day on a job each week.
2. The crew lead logs it in the crew portal → **Safety talk**: topic and everyone present.
3. Any injury or near miss is reported to the office the same day and logged on **Safety & prequal**.
4. The office checks *crews with no talk in 30 days* each Monday.`,
  },
  {
    title: "Prequal packet refresh",
    area: "SAFETY",
    body: `1. When a policy renews, upload the new COI / workers' comp certificate with its expiration date on **Safety & prequal**.
2. Each January, enter last year's hours worked, average employees and the EMR from the carrier's letter.
3. Upload the surety's new bonding letter when it arrives.
4. Answer a GC prequal request with **Download prequal packet** plus their own form.`,
  },
];

export async function addStarters(actor: { name: string }) {
  const have = new Set((await prisma.sop.findMany({ select: { title: true } })).map((s) => s.title));
  let n = 0;
  for (const s of STARTERS)
    if (!have.has(s.title)) {
      await prisma.sop.create({ data: { ...s, draft: true, updatedBy: actor.name } });
      n++;
    }
  return n;
}
