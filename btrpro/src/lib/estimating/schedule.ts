// Estimating schedule: the bid board for commercial and residential, synced from the team's Google Sheet
// until they work in BTRpro directly. A row edited in BTRpro becomes BTRpro's (source APP) and later syncs
// leave it alone; untouched sheet rows follow the sheet, and rows removed from the sheet go away.
import { prisma } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { driveNotFound, driveToken } from "@/lib/integrations/google-sa";
import { parseDriveLink } from "@/lib/integrations/drive";
import { readXlsx } from "@/lib/import/xlsx";
import { scopesFor } from "@/lib/import/schedule";
import { createProject } from "@/lib/projects/service";
import { parseEstimatingWorkbook, type Board, type SheetRow, type TabSummary } from "./sheet";
import type { Role } from "@/lib/session";
import { appName } from "@/lib/company-profile";

export const DEFAULT_ESTIMATING_SHEET = "https://docs.google.com/spreadsheets/d/1Lt10jy0tcMCLMd8fQ8_MQ2p1NRXcK8KgLsGx2GzWefA/edit";

export const BOARD_LABEL: Record<Board, string> = {
  CURRENT: "Bidding now",
  MISC: "Other estimating tasks",
  PASSING: "Passing on",
  SENT: "Bids sent / completed",
  REDRAW: "Redrawings",
  LOST: "Lost",
  SOLD: "Sold — PM handoff",
  ARCHIVE: "Archive",
  TRACT: "Tract builder scopes",
};
export const BOARDS = Object.keys(BOARD_LABEL) as Board[];
export const PRIORITIES = { STANDARD: "Standard", ASAP: "ASAP", SOLD_RFQ: "Sold with RFQ", REVIEW: "Review needed" } as const;
export type Priority = keyof typeof PRIORITIES;

export class ScheduleError extends Error {}
type Actor = { id: string; name: string; role?: Role };

const API = "https://www.googleapis.com/drive/v3/files";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function downloadSheet(link: string, userId: string | null): Promise<Uint8Array> {
  const id = parseDriveLink(link);
  if (!id) throw new ScheduleError("That doesn't look like a Google Sheets link.");
  const token = await driveToken(userId);
  const res = await fetch(`${API}/${id}/export?mimeType=${encodeURIComponent(XLSX)}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404 || res.status === 403) throw new ScheduleError(driveNotFound());
  if (!res.ok) throw new ScheduleError(`Google Drive error (${res.status}) reading the estimating sheet.`);
  return new Uint8Array(await res.arrayBuffer());
}

export type SyncResult = { added: number; updated: number; removed: number; keptEdited: number; tabs: TabSummary[] };

/** Applies parsed sheet rows: upsert untouched sheet rows, keep rows edited in BTRpro, drop rows no longer in the sheet. */
export async function applySheetRows(rows: SheetRow[], tabs: TabSummary[]): Promise<SyncResult> {
  const existing = await prisma.estimateLog.findMany({ where: { sourceKey: { not: null } }, select: { id: true, sourceKey: true, source: true } });
  const byKey = new Map(existing.map((e) => [e.sourceKey!, e]));
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  let keptEdited = 0;
  const ops = [];
  for (const r of rows) {
    seen.add(r.sourceKey);
    const cur = byKey.get(r.sourceKey);
    const data = { ...r, extra: r.extra ?? undefined, source: "SHEET" };
    if (!cur) {
      ops.push(prisma.estimateLog.create({ data }));
      added++;
    } else if (cur.source === "APP") keptEdited++;
    else {
      ops.push(prisma.estimateLog.update({ where: { id: cur.id }, data: { ...data, extra: r.extra ?? undefined } }));
      updated++;
    }
  }
  const gone = existing.filter((e) => e.source === "SHEET" && !seen.has(e.sourceKey!)).map((e) => e.id);
  for (let i = 0; i < ops.length; i += 200) await prisma.$transaction(ops.slice(i, i + 200));
  if (gone.length) await prisma.estimateLog.deleteMany({ where: { id: { in: gone } } });
  return { added, updated, removed: gone.length, keptEdited, tabs };
}

export async function syncEstimatingSheet(actor: Actor | null): Promise<SyncResult> {
  const s = await getSettings();
  const link = s.estimatingSheet ?? DEFAULT_ESTIMATING_SHEET;
  const bytes = await downloadSheet(link, actor?.id ?? null);
  const { rows, tabs } = parseEstimatingWorkbook(await readXlsx(bytes));
  if (!rows.length) throw new ScheduleError("The sheet came back empty — nothing was changed.");
  const result = await applySheetRows(rows, tabs);
  await saveSettings({ estimatingSyncedAt: new Date().toISOString() }, actor ?? { id: "", name: "Estimating sheet sync" });
  return result;
}

let watching = false;
/** While the sheet is still in use: sync shortly after start, then every 30 minutes. Off when the setting says BTRpro is the source. */
export function startEstimatingWatcher(everyMs = 30 * 60_000) {
  if (watching) return;
  watching = true;
  const run = async () => {
    try {
      const s = await getSettings();
      if (s.estimatingSheetOff) return;
      const r = await syncEstimatingSheet(null);
      console.log(`[estimating sheet] +${r.added} ~${r.updated} -${r.removed} (kept ${r.keptEdited} edited in ${appName()})`);
    } catch (e) {
      console.error("[estimating sheet] sync failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 90_000);
  setInterval(run, everyMs);
}

// ---------- editing ----------

export type EntryInput = {
  board: Board;
  market: "COMMERCIAL" | "RESIDENTIAL";
  kind?: string | null;
  priority?: Priority;
  customer?: string | null;
  project: string;
  scope?: string | null;
  estimator?: string | null;
  receivedAt?: Date | null;
  dueAt?: Date | null;
  sentAt?: Date | null;
  bidDate?: Date | null;
  status?: string | null;
  waitingOn?: string | null;
  sentTo?: string | null;
  results?: string | null;
  notes?: string | null;
  folderLink?: string | null;
};

const clean = (i: Partial<EntryInput>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i)) out[k] = typeof v === "string" ? v.trim() || null : v;
  return out as Partial<EntryInput>;
};

export async function addEntry(input: EntryInput, actor: Actor) {
  if (!input.project.trim()) throw new ScheduleError("Project name is required.");
  return prisma.estimateLog.create({ data: { ...clean(input), project: input.project.trim(), board: input.board, market: input.market, source: "APP", updatedBy: actor.name } });
}

/** Any edit makes the row BTRpro's: the sheet sync won't overwrite it again. */
export async function updateEntry(id: string, patch: Partial<EntryInput>, actor: Actor) {
  if (patch.project !== undefined && !patch.project?.trim()) throw new ScheduleError("Project name is required.");
  return prisma.estimateLog.update({ where: { id }, data: { ...clean(patch), source: "APP", updatedBy: actor.name } });
}

export async function deleteEntry(id: string) {
  await prisma.estimateLog.delete({ where: { id } });
}

/** Starts a BTRpro job (lead) from a schedule row and links them. */
export async function startJob(id: string, actor: Actor & { role: Role }) {
  const e = await prisma.estimateLog.findUniqueOrThrow({ where: { id } });
  if (e.projectId) return e.projectId;
  const scopes = scopesFor(e.scope);
  const job = await createProject(
    {
      name: e.project,
      market: e.market === "RESIDENTIAL" ? "RESIDENTIAL" : "COMMERCIAL",
      scopes: scopes.length ? scopes : ["SIDING"],
      isPublic: false,
      isTaxExempt: false,
      bidDueDate: e.dueAt,
      leadSource: e.customer ? `Estimating schedule — ${e.customer}` : "Estimating schedule",
    },
    actor,
  );
  await prisma.estimateLog.update({ where: { id }, data: { projectId: job.id, source: "APP", updatedBy: actor.name } });
  return job.id;
}
