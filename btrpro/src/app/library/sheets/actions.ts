"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { applyImport, createImport, ImportError, SHEET_CODE_RE, type ReviewedImport } from "@/lib/sheets/imports";

const MAX_BYTES = 50 * 1024 * 1024;

export async function uploadSheet(_prev: string | null, form: FormData): Promise<string | null> {
  const admin = await requireUser(["ADMIN"]);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose a price-sheet file.";
  if (file.size > MAX_BYTES) return "That file is over 50 MB.";

  let code = String(form.get("code") ?? "");
  let name = "";
  let scope: string | null = null;
  if (code === "__new") {
    code = String(form.get("newCode") ?? "").trim().toUpperCase();
    name = String(form.get("newName") ?? "").trim();
    scope = String(form.get("newScope") ?? "").trim() || null;
    if (!SHEET_CODE_RE.test(code)) return "New sheet code must be 2–4 letters, e.g. LP.";
    if (!name) return "Give the new sheet a name.";
    if (await prisma.priceSheet.findFirst({ where: { code } })) return `Sheet code ${code} already exists; pick it from the list.`;
  } else {
    const current = await prisma.priceSheet.findFirst({ where: { code, isActive: true } });
    if (!current) return "Pick a sheet.";
    name = current.name;
    scope = current.scope;
  }

  let id: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    ({ id } = await createImport({ bytes, fileName: file.name, code, name, scope, userId: admin.id }));
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
  redirect("/library/sheets?applied=1");
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
