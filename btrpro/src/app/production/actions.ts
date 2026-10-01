"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { BILLING_ROLES, STAFF_ROLES } from "@/lib/roles";
import { parseDate } from "@/lib/import/schedule";
import { addProdLine, deleteProdLine, ProdError, stepProdLine, syncProductionSheets, updateProdLine, type ProdInput } from "@/lib/production/board";
import { saveSettings } from "@/lib/settings";

export type PResult = { problems: string[]; ok?: boolean; message?: string } | null;
const s = (f: FormData, k: string) => (f.has(k) ? String(f.get(k) ?? "") : undefined);
const num = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};
const day = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : v.trim() ? parseDate(v) : null;
};

function input(f: FormData): ProdInput & { startDate?: Date | null; endDate?: Date | null } {
  const o: Record<string, unknown> = {};
  for (const k of ["market", "board", "grp", "section", "project", "estimateNo", "vpo", "builder", "location", "model", "type", "crew", "superName", "salesRep", "notes", "completed", "approved", "billed", "btrPaid", "billingNotes"]) {
    const v = s(f, k);
    if (v !== undefined) o[k] = v;
  }
  for (const k of ["payout", "paidToDate", "sell"]) {
    const v = num(s(f, k));
    if (v !== undefined) o[k] = v;
  }
  for (const k of ["dateAdded", "startDate", "endDate"]) {
    const v = day(s(f, k));
    if (v !== undefined) o[k] = v;
  }
  return o as ProdInput;
}

export async function saveProdAction(_: PResult, f: FormData): Promise<PResult> {
  const u = await requireUser(STAFF_ROLES);
  const id = String(f.get("id") ?? "");
  const back = String(f.get("back") ?? "/production");
  try {
    if (id) await updateProdLine(id, input(f), u);
    else await addProdLine(input(f), u);
  } catch (e) {
    if (e instanceof ProdError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/production", "layout");
  redirect(back);
}

export async function stepAction(f: FormData) {
  const step = String(f.get("step")) as "complete" | "approve" | "bill" | "paid";
  const u = await requireUser(step === "complete" ? STAFF_ROLES : BILLING_ROLES);
  await stepProdLine(String(f.get("id")), step, u);
  revalidatePath("/production", "layout");
}

export async function deleteProdAction(f: FormData) {
  await requireUser(STAFF_ROLES);
  await deleteProdLine(String(f.get("id")));
  revalidatePath("/production", "layout");
  redirect("/production");
}

export async function syncProdAction(_: PResult): Promise<PResult> {
  const u = await requireUser(STAFF_ROLES);
  try {
    const r = await syncProductionSheets(u);
    revalidatePath("/production", "layout");
    return { problems: [], ok: true, message: Object.entries(r).map(([m, x]) => `${m.toLowerCase()}: ${x.added} new, ${x.updated} updated, ${x.removed} removed${x.keptEdited ? `, ${x.keptEdited} kept as edited` : ""}`).join(" · ") };
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : "Sync failed."] };
  }
}

export async function prodSheetSettingsAction(_: PResult, f: FormData): Promise<PResult> {
  const u = await requireUser(["ADMIN"]);
  await saveSettings({ prodResSheet: String(f.get("res") ?? "").trim() || null, prodCommSheet: String(f.get("comm") ?? "").trim() || null, prodSheetOff: f.get("off") === "on" ? true : null }, u);
  revalidatePath("/production", "layout");
  return { problems: [], ok: true, message: "Saved." };
}
