// Overnight builder checks.
// 1) Plan-book sync: a plan book imported from a Google Sheet is re-imported when the sheet has changed — unless
//    someone edited that plan book inside BTRpro since, then the office is asked to re-import by hand (an automatic
//    re-import would throw those edits away).
// 2) Houses over plan: a builder house whose costs so far run past the plan book's materials + tax + crew pay (by the
//    company's cost-variance threshold, default 5%) gets a task for the office, once.
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { parseDriveLink } from "@/lib/integrations/drive";
import { driveToken } from "@/lib/integrations/google-sa";
import { downloadSheet } from "@/lib/estimating/schedule";
import { officeUsers } from "@/lib/production/board";
import { actualSplit } from "@/lib/costing/split";
import { importPlanBook } from "./planbook";
import { houseOf } from "./house";
import type { PlanBookData } from "./plans";

const SYSTEM = { id: "system", name: "Sheet sync", role: "ADMIN" };

async function sheetModified(link: string): Promise<Date | null> {
  const id = parseDriveLink(link);
  if (!id) return null;
  const token = await driveToken(null);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  const j = (await res.json()) as { modifiedTime?: string };
  return j.modifiedTime ? new Date(j.modifiedTime) : null;
}

async function tellOffice(title: string, auto: string, projectId: string | null = null) {
  if (await prisma.task.findFirst({ where: { auto } })) return false;
  for (const u of await officeUsers()) await prisma.task.create({ data: { title, assigneeId: u.id, dueDate: new Date(), projectId, auto, createdBy: "BTRpro" } });
  return true;
}

export async function syncPlanBooks(deps: { modified?: (link: string) => Promise<Date | null>; download?: (link: string) => Promise<Uint8Array> } = {}) {
  const modified = deps.modified ?? sheetModified;
  const download = deps.download ?? ((link: string) => downloadSheet(link, null));
  const books = await prisma.builderPlanBook.findMany({ where: { active: true, sourceUrl: { not: null } }, include: { company: { select: { name: true } } } });
  const out = { checked: 0, updated: [] as string[], heldForEdits: [] as string[], failed: [] as string[] };
  for (const b of books) {
    out.checked++;
    const name = `${b.company.name} ${b.label}`;
    try {
      const m = await modified(b.sourceUrl!);
      if (!m) continue;
      if (!b.sourceModifiedAt) {
        // first look: remember the sheet's time; it was imported from this version (or close to it)
        if (m <= b.importedAt) await prisma.builderPlanBook.update({ where: { id: b.id }, data: { sourceModifiedAt: m } });
        else if (!(b.data as unknown as PlanBookData).edits?.length) {
          const r = await importPlanBook(b.companyId, { bytes: await download(b.sourceUrl!), link: b.sourceUrl!, label: b.label }, SYSTEM);
          await prisma.builderPlanBook.update({ where: { id: r.book.id }, data: { sourceModifiedAt: m } });
          out.updated.push(name);
        }
        continue;
      }
      if (m <= b.sourceModifiedAt) continue;
      if ((b.data as unknown as PlanBookData).edits?.length) {
        await tellOffice(`The ${name} plan book sheet changed, but it was also edited in BTRpro — re-import it by hand (Builders → ${b.company.name} → Plans & models) after copying those edits to the sheet.`, `PLANBOOK:held:${b.id}:${m.toISOString()}`);
        out.heldForEdits.push(name);
        continue;
      }
      const r = await importPlanBook(b.companyId, { bytes: await download(b.sourceUrl!), link: b.sourceUrl!, label: b.label }, SYSTEM);
      await prisma.builderPlanBook.update({ where: { id: r.book.id }, data: { sourceModifiedAt: m } });
      out.updated.push(name);
    } catch (e) {
      out.failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

export async function housesOverPlan() {
  const s = await getSettings();
  const pct = s.costVarianceThresholdPct ?? 5;
  const jobs = await prisma.project.findMany({
    where: { builderHouse: { not: null as never }, status: { notIn: ["LOST", "CLOSED"] }, costs: { some: {} } },
    select: { id: true, name: true, builderHouse: true, costs: { select: { category: true, amount: true, description: true } } },
  });
  const flagged: string[] = [];
  for (const j of jobs) {
    const h = houseOf(j);
    if (!h) continue;
    const planned = Object.values(h.trades).reduce((a, t) => a + t!.materials + t!.tax + t!.payout, 0);
    const a = actualSplit(j.costs);
    const spent = a.materials + a.tax + a.labor + a.other;
    if (planned > 0 && spent > planned * (1 + pct / 100)) {
      const over = Math.round((spent - planned) * 100) / 100;
      if (await tellOffice(`${j.name}: costs are $${over.toLocaleString("en-US", { minimumFractionDigits: 2 })} over the plan book (${Math.round(((spent - planned) / planned) * 100)}%). Check the receipts and bills on it.`, `HOUSE:over:${j.id}`, j.id)) flagged.push(j.name);
    }
  }
  return flagged;
}

const centralDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
let watching = false;
let lastDay = "";
export function startBuilderWatcher(everyMs = 60 * 60_000) {
  if (watching) return;
  watching = true;
  const run = async () => {
    const now = new Date();
    const day = centralDay(now);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(now));
    if (day === lastDay || hour < 4) return;
    lastDay = day;
    try {
      const r = await syncPlanBooks();
      if (r.updated.length || r.heldForEdits.length || r.failed.length) console.log(`[builders] plan books updated: ${r.updated.join(", ") || "none"}; held: ${r.heldForEdits.join(", ") || "none"}; failed: ${r.failed.join(" | ") || "none"}`);
      const over = await housesOverPlan();
      if (over.length) console.log(`[builders] houses over plan: ${over.join(", ")}`);
    } catch (e) {
      console.error("[builders] nightly check failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 120_000);
  setInterval(run, everyMs);
}
