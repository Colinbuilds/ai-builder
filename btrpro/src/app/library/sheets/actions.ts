"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { applyImport, createImport, ImportError, SHEET_CODE_RE, type ReviewedImport } from "@/lib/sheets/imports";
import { saveSettings } from "@/lib/settings";
import { parseDriveLink } from "@/lib/integrations/drive";
import { driveAvailable } from "@/lib/integrations/google-sa";
import { syncPriceSheets } from "@/lib/sheets/drive-sync";

const MAX_BYTES = 50 * 1024 * 1024;

export async function uploadSheet(_prev: string | null, form: FormData): Promise<string | null> {
  const admin = await requireUser(["ADMIN"]);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose a price-sheet file.";
  if (file.size > MAX_BYTES) return "That file is over 50 MB.";

  let code = String(form.get("code") ?? "");
  let name = "";
  let scope: string | null = null;
  // a builder's own pricing: sheet codes are the builder's prefix + a suffix, e.g. LEG-SS
  const companyId = String(form.get("companyId") ?? "") || null;
  if (companyId) {
    const b = await prisma.company.findUnique({ where: { id: companyId } });
    if (!b || b.type !== "BUILDER") return "That builder wasn't found.";
    if (!b.sheetPrefix) return "Set this builder's sheet prefix (Overview tab) before uploading their pricing.";
    if (code === "__new") {
      const suffix = String(form.get("newCode") ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{1,6}$/.test(suffix)) return "Sheet code must be 1–6 letters/numbers, e.g. SS.";
      code = `${b.sheetPrefix}-${suffix}`;
      name = String(form.get("newName") ?? "").trim() || `${b.name} - ${suffix}`;
      scope = String(form.get("newScope") ?? "").trim() || null;
      if (await prisma.priceSheet.findFirst({ where: { code } })) return `${code} already exists; pick it from the list to upload a new version.`;
    } else {
      const current = await prisma.priceSheet.findFirst({ where: { code, isActive: true, companyId } });
      if (!current) return "Pick one of this builder's sheets.";
      name = current.name;
      scope = current.scope;
    }
  } else if (code === "__new") {
    code = String(form.get("newCode") ?? "").trim().toUpperCase();
    name = String(form.get("newName") ?? "").trim();
    scope = String(form.get("newScope") ?? "").trim() || null;
    if (!SHEET_CODE_RE.test(code)) return "New sheet code must be 2–4 letters, e.g. LP.";
    if (!name) return "Give the new sheet a name.";
    if (await prisma.priceSheet.findFirst({ where: { code } })) return `Sheet code ${code} already exists; pick it from the list.`;
  } else {
    const current = await prisma.priceSheet.findFirst({ where: { code, isActive: true, companyId: null } });
    if (!current) return "Pick a sheet.";
    name = current.name;
    scope = current.scope;
  }

  let id: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    ({ id } = await createImport({ bytes, fileName: file.name, code, name, scope, userId: admin.id, companyId }));
  } catch (e) {
    return `Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`;
  }
  redirect(`/library/sheets/imports/${id}`);
}

export async function applyReviewedImport(importId: string, reviewed: ReviewedImport): Promise<string[]> {
  const admin = await requireUser(["ADMIN"]);
  try {
    await applyImport(importId, reviewed, admin.id);
  } catch (e) {
    if (e instanceof ImportError) return e.problems;
    throw e;
  }
  revalidatePath("/", "layout");
  const imp = await prisma.sheetImport.findUnique({ where: { id: importId }, select: { companyId: true } });
  redirect(imp?.companyId ? `/builders/${imp.companyId}?tab=pricing&applied=1` : "/library/sheets?applied=1");
}

export async function discardImport(form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const id = String(form.get("id"));
  await prisma.sheetImport.updateMany({ where: { id, status: "DRAFT" }, data: { status: "DISCARDED" } });
  await prisma.auditLog.create({ data: { userId: admin.id, entity: "SheetImport", entityId: id, action: "discard" } });
  redirect("/library/sheets");
}

export async function saveCoverage(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(form.get("id"));
  const clear = form.get("clear") === "1";
  const qty = Number(form.get("qty"));
  const unit = String(form.get("unit") ?? "").trim().toUpperCase();
  const source = String(form.get("source"));
  if (!clear) {
    if (!Number.isFinite(qty) || qty <= 0) return "Coverage must be a number above zero.";
    if (!/^[A-Z]+\/[A-Z]+$/.test(unit)) return 'Unit must look like "SF/RL" or "BD/SQ".';
    if (source !== "USER_ENTERED" && source !== "MANUFACTURER_DOC") return "Pick where the value came from.";
  }
  const before = await prisma.priceItem.findUniqueOrThrow({
    where: { id },
    select: { coverageQty: true, coverageUnit: true, coverageSource: true },
  });
  const after = clear
    ? { coverageQty: null, coverageUnit: null, coverageSource: null }
    : { coverageQty: qty, coverageUnit: unit, coverageSource: source as "USER_ENTERED" | "MANUFACTURER_DOC" };
  await prisma.priceItem.update({ where: { id }, data: after });
  await prisma.auditLog.create({
    data: { userId: user.id, entity: "PriceItem", entityId: id, action: "set_coverage", before, after },
  });
  revalidatePath(`/library/items/${id}`);
  return null;
}

export type SyncState = { problems: string[]; ok?: boolean; note?: string } | null;

export async function saveSheetFolderAction(_: SyncState, f: FormData): Promise<SyncState> {
  const admin = await requireUser(["ADMIN"]);
  const link = String(f.get("folder") ?? "").trim();
  if (!link) {
    await saveSettings({ priceSheetFolder: null, priceSheetSyncUserId: null }, admin);
    revalidatePath("/library/sheets");
    return { problems: [], ok: true, note: "Stopped watching Drive." };
  }
  if (!parseDriveLink(link)) return { problems: ["Paste the Google Drive folder link (the \"Current\" price sheets folder)."] };
  if (!(await driveAvailable(admin.id))) return { problems: ["Set up Drive for the app first: a service account key in GOOGLE_SERVICE_ACCOUNT_JSON (recommended), or connect your Google Drive under Admin → Integrations."] };
  await saveSettings({ priceSheetFolder: link, priceSheetSyncUserId: admin.id }, admin);
  revalidatePath("/library/sheets");
  return { problems: [], ok: true, note: "Saved. BTRpro checks this folder on start and every 6 hours — or click Check now." };
}

export async function syncSheetsNowAction(_: SyncState): Promise<SyncState> {
  await requireUser(["ADMIN"]);
  try {
    const r = await syncPriceSheets();
    revalidatePath("/", "layout");
    const parts = [
      r.applied.length && `put live: ${r.applied.join(", ")}`,
      r.held.length && `held for review: ${r.held.join(", ")}`,
      r.unmatched.length && `couldn't tell which sheet: ${r.unmatched.join(", ")}`,
      r.skipped && `${r.skipped} not newer than what's live`,
      r.errors.length && `errors: ${r.errors.join("; ")}`,
    ].filter(Boolean);
    return { problems: [], ok: true, note: r.checked ? `Checked ${r.checked} new file(s) — ${parts.join(" · ")}.` : "No new or changed files in the folder. Everything is current." };
  } catch (e) {
    return { problems: [e instanceof Error ? e.message : String(e)] };
  }
}
