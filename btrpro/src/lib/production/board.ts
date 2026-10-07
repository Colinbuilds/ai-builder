// Production board: residential and commercial work lines with payout and sell, synced from the live
// schedule sheets until BTRpro is the schedule. Same rules as the estimating schedule: a row edited in
// BTRpro stays as edited; untouched rows follow the sheet; rows removed from the sheet go away.
import { prisma } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { readXlsx } from "@/lib/import/xlsx";
import { downloadSheet } from "@/lib/estimating/schedule";
import { parseProductionWorkbook, type ProdBoard, type ProdRow } from "./sheet";

export const DEFAULT_RES_SHEET = "https://docs.google.com/spreadsheets/d/1oDgUhFsbYhzh4TVv8LMg8oMq3tMSLThCmcE0yOYJrq4/edit";
export const DEFAULT_COMM_SHEET = "https://docs.google.com/spreadsheets/d/10-mta4u8yLmIsD0Y_xcqLxIjbAQjPIPeiDO_MctBwqM/edit";
export const PROD_BOARDS: Record<ProdBoard, string> = { ADD: "New — to be placed", UPCOMING: "Upcoming", CURRENT: "Current", WARRANTY: "Warranty & service", COMPLETED: "Completed" };

export class ProdError extends Error {}
type Actor = { id: string; name: string };

export async function applyProdRows(market: "RESIDENTIAL" | "COMMERCIAL", rows: ProdRow[]) {
  const existing = await prisma.prodLine.findMany({ where: { market, sourceKey: { not: null } }, select: { id: true, sourceKey: true, source: true } });
  const byKey = new Map(existing.map((e) => [e.sourceKey!, e]));
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  let keptEdited = 0;
  const ops = [];
  for (const r of rows) {
    seen.add(r.sourceKey);
    const cur = byKey.get(r.sourceKey);
    if (!cur) {
      ops.push(prisma.prodLine.create({ data: { ...r, source: "SHEET" } }));
      added++;
    } else if (cur.source === "APP") keptEdited++;
    else {
      ops.push(prisma.prodLine.update({ where: { id: cur.id }, data: { ...r, source: "SHEET" } }));
      updated++;
    }
  }
  const gone = existing.filter((e) => e.source === "SHEET" && !seen.has(e.sourceKey!)).map((e) => e.id);
  for (let i = 0; i < ops.length; i += 200) await prisma.$transaction(ops.slice(i, i + 200));
  if (gone.length) await prisma.prodLine.deleteMany({ where: { id: { in: gone } } });
  return { added, updated, removed: gone.length, keptEdited };
}

export async function syncProductionSheets(actor: Actor | null) {
  const s = await getSettings();
  const out: Record<string, Awaited<ReturnType<typeof applyProdRows>>> = {};
  for (const [market, link] of [
    ["RESIDENTIAL", s.prodResSheet ?? DEFAULT_RES_SHEET],
    ["COMMERCIAL", s.prodCommSheet ?? DEFAULT_COMM_SHEET],
  ] as const) {
    const tabs = await readXlsx(await downloadSheet(link, actor?.id ?? null));
    const { rows } = parseProductionWorkbook(tabs, market);
    const crewTab = tabs.find((x) => /^crew/i.test(x.name.trim()));
    if (crewTab) await syncCrewList(crewTab.rows.map((r) => r[0] ?? ""));
    if (!rows.length) throw new ProdError(`The ${market.toLowerCase()} schedule came back empty — nothing was changed.`);
    out[market] = await applyProdRows(market, rows);
    if (market === "COMMERCIAL") {
      const { syncPayAppsFromTabs } = await import("@/lib/billing/payapps");
      await syncPayAppsFromTabs(tabs);
    }
  }
  await saveSettings({ prodSyncedAt: new Date().toISOString() }, actor ?? { id: "", name: "Schedule sync" });
  return out;
}

let watching = false;
export function startProductionWatcher(everyMs = 30 * 60_000) {
  if (watching) return;
  watching = true;
  const run = async () => {
    try {
      if ((await getSettings()).prodSheetOff) return;
      const r = await syncProductionSheets(null);
      console.log("[production sheets]", JSON.stringify(r));
    } catch (e) {
      console.error("[production sheets] sync failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 120_000);
  setInterval(run, everyMs);
}

// ---------- editing ----------
const NUM = ["payout", "paidToDate", "payoutWeek", "sell"] as const;
const TXT = ["grp", "section", "project", "estimateNo", "vpo", "builder", "location", "model", "type", "crew", "superName", "salesRep", "notes", "completed", "approved", "billed", "btrPaid", "billingNotes"] as const;
export type ProdInput = Partial<Record<(typeof TXT)[number], string | null> & Record<(typeof NUM)[number], number | null>> & { market?: string; board?: string; dateAdded?: Date | null };

function clean(i: ProdInput) {
  const o: Record<string, unknown> = {};
  for (const k of TXT) if (k in i) o[k] = (i[k] as string | null)?.trim() || null;
  for (const k of NUM) if (k in i) o[k] = i[k] ?? null;
  if (i.board && i.board in PROD_BOARDS) o.board = i.board;
  if (i.market === "RESIDENTIAL" || i.market === "COMMERCIAL") o.market = i.market;
  if ("dateAdded" in i) o.dateAdded = i.dateAdded;
  return o;
}

export async function addProdLine(i: ProdInput, a: Actor) {
  if (!i.builder?.trim() && !i.location?.trim()) throw new ProdError("Enter the builder and the address.");
  return prisma.prodLine.create({ data: { market: "RESIDENTIAL", board: "ADD", dateAdded: new Date(), ...clean(i), source: "APP", updatedBy: a.name } as never });
}

export async function updateProdLine(id: string, i: ProdInput, a: Actor) {
  return prisma.prodLine.update({ where: { id }, data: { ...clean(i), source: "APP", updatedBy: a.name } });
}

const today = () => new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit", timeZone: "America/Chicago" });

/** Office people who get the "crew can be paid" note (Office role; admins if there are none). */
export async function officeUsers() {
  const office = await prisma.user.findMany({ where: { role: "OFFICE" }, select: { id: true } });
  return office.length ? office : prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
}

/** Crew names from the schedule's crew list, added to Crews & subs if missing. */
export async function syncCrewList(names: string[]) {
  const have = new Set((await prisma.crew.findMany({ select: { name: true } })).map((c) => c.name.trim().toLowerCase()));
  let added = 0;
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name || have.has(name.toLowerCase())) continue;
    const [firm, lead] = name.split(/\s+-\s+/, 2);
    await prisma.crew.create({ data: { name, kind: /llc|construction|exteriors|inc|siding|roofing|contractors|brothers|gc\b/i.test(firm) ? "SUB" : "CREW", leadName: lead ?? null, notes: "Added from the production schedule's crew list" } });
    have.add(name.toLowerCase());
    added++;
  }
  return added;
}

/** One-click steps from the board: done, OK to pay the crew, billed, BTR paid. */
export async function stepProdLine(id: string, step: "complete" | "approve" | "bill" | "paid", a: Actor) {
  const now = new Date();
  const who = `${today()} ${a.name.split(" ")[0]}`;
  const data =
    step === "complete"
      ? { completed: `Done ${who}`, completedAt: now }
      : step === "approve"
        ? { approved: `OK to pay ${who}` }
        : step === "bill"
          ? { billed: `Billed ${who}`, billedAt: now }
          : { btrPaid: `Paid ${who}`, paidAt: now, board: "COMPLETED" };
  const line = await prisma.prodLine.update({ where: { id }, data: { ...data, source: "APP", updatedBy: a.name } });
  if (step === "complete") {
    // the office gets a task: the crew can be paid, and the builder can be billed
    const what = [line.builder, line.location, line.type].filter(Boolean).join(" · ");
    const pay = line.payout != null ? ` — payout $${line.payout.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
    for (const u of await officeUsers())
      await prisma.task.create({
        data: { title: `Crew can be paid: ${line.crew ?? "crew"} finished ${what}${pay}. Then bill it.`, assigneeId: u.id, dueDate: now, projectId: line.projectId, auto: `PROD:pay:${line.id}`, createdBy: a.name },
      });
  }
  if (step === "approve") await prisma.task.updateMany({ where: { auto: `PROD:pay:${line.id}`, doneAt: null }, data: { doneAt: now, doneBy: a.name } });
  return line;
}

export async function deleteProdLine(id: string) {
  await prisma.prodLine.delete({ where: { id } });
}

/** Crew and super names for the pickers: Crews & subs plus everyone named on the schedule. */
export async function pickers() {
  const [c, s, crews] = await Promise.all([
    prisma.prodLine.groupBy({ by: ["crew"], where: { crew: { not: null } } }),
    prisma.prodLine.groupBy({ by: ["superName"], where: { superName: { not: null } } }),
    prisma.crew.findMany({ where: { active: true }, select: { name: true } }),
  ]);
  return { crews: [...new Set([...crews.map((x) => x.name), ...c.map((x) => x.crew!)])].sort(), supers: s.map((x) => x.superName!).sort() };
}
