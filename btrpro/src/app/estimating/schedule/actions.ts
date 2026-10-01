"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { EDIT_ROLES } from "@/lib/roles";
import { saveSettings } from "@/lib/settings";
import { parseDate } from "@/lib/import/schedule";
import { addEntry, BOARDS, deleteEntry, PRIORITIES, ScheduleError, startJob, syncEstimatingSheet, updateEntry, type EntryInput, type Priority } from "@/lib/estimating/schedule";
import type { Board } from "@/lib/estimating/sheet";

export type SResult = { problems: string[]; ok?: boolean; message?: string } | null;

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
// date inputs send yyyy-mm-dd
const d = (f: FormData, k: string) => {
  const v = s(f, k).trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : parseDate(v);
};

function input(f: FormData): EntryInput {
  const board = s(f, "board") as Board;
  const priority = s(f, "priority") as Priority;
  return {
    board: BOARDS.includes(board) ? board : "CURRENT",
    market: s(f, "market") === "RESIDENTIAL" ? "RESIDENTIAL" : "COMMERCIAL",
    kind: s(f, "kind"),
    priority: priority in PRIORITIES ? priority : "STANDARD",
    customer: s(f, "customer"),
    project: s(f, "project"),
    scope: s(f, "scope"),
    estimator: s(f, "estimator").toUpperCase(),
    receivedAt: d(f, "receivedAt"),
    dueAt: d(f, "dueAt"),
    sentAt: d(f, "sentAt"),
    bidDate: d(f, "bidDate"),
    status: s(f, "status"),
    waitingOn: s(f, "waitingOn"),
    sentTo: s(f, "sentTo"),
    results: s(f, "results"),
    notes: s(f, "notes"),
    folderLink: s(f, "folderLink"),
  };
}

const back = (market: string) => `/estimating/schedule?m=${market === "RESIDENTIAL" ? "residential" : "commercial"}`;

export async function saveEntryAction(_: SResult, f: FormData): Promise<SResult> {
  const u = await requireUser(EDIT_ROLES);
  const id = s(f, "id");
  const data = input(f);
  try {
    if (id) await updateEntry(id, data, u);
    else await addEntry(data, u);
  } catch (e) {
    if (e instanceof ScheduleError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/estimating/schedule", "layout");
  redirect(back(data.market));
}

export async function deleteEntryAction(f: FormData) {
  await requireUser(EDIT_ROLES);
  await deleteEntry(s(f, "id"));
  revalidatePath("/estimating/schedule", "layout");
  redirect(back(s(f, "market")));
}

export async function startJobAction(f: FormData) {
  const u = await requireUser(EDIT_ROLES);
  const projectId = await startJob(s(f, "id"), u);
  revalidatePath("/estimating/schedule", "layout");
  redirect(`/projects/${projectId}`);
}

export async function syncSheetAction(_: SResult): Promise<SResult> {
  const u = await requireUser(EDIT_ROLES);
  try {
    const r = await syncEstimatingSheet(u);
    revalidatePath("/estimating/schedule", "layout");
    return {
      problems: [],
      ok: true,
      message: `Synced: ${r.added} new, ${r.updated} updated, ${r.removed} removed${r.keptEdited ? `, ${r.keptEdited} kept as edited in BTRpro` : ""}.`,
    };
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : "Sync failed."] };
  }
}

export async function sheetSettingsAction(_: SResult, f: FormData): Promise<SResult> {
  const u = await requireUser(["ADMIN"]);
  await saveSettings({ estimatingSheet: s(f, "estimatingSheet").trim() || null, estimatingSheetOff: f.get("off") === "on" ? true : null }, u);
  revalidatePath("/estimating/schedule", "layout");
  return { problems: [], ok: true, message: "Saved." };
}
