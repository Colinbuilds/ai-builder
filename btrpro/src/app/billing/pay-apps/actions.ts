"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { BILLING_ROLES } from "@/lib/roles";
import { newPayApp, PayAppError, savePayAppLines, setPayAppStatus, updateContract } from "@/lib/billing/payapps";
import { prisma } from "@/lib/db";

export type PaResult = { problems: string[]; ok?: boolean } | null;
const n = (v: FormDataEntryValue | null) => {
  const x = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

export async function contractSettingsAction(_: PaResult, f: FormData): Promise<PaResult> {
  const u = await requireUser(BILLING_ROLES);
  const raw = String(f.get("retainagePct") ?? "").trim();
  const pct = raw === "" ? null : Number(raw);
  if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 20)) return { problems: ["Retainage should be a percent between 0 and 20."] };
  await updateContract(String(f.get("id")), { retainagePct: pct, submitVia: String(f.get("submitVia") ?? "").trim() || null, dueNote: String(f.get("dueNote") ?? "").trim() || null }, u);
  revalidatePath("/billing/pay-apps", "layout");
  return { problems: [], ok: true };
}

export async function newPayAppAction(_: PaResult, f: FormData): Promise<PaResult> {
  const u = await requireUser(BILLING_ROLES);
  const cid = String(f.get("id"));
  const m = String(f.get("periodTo") ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { problems: ["Pick the period end date."] };
  let id: string;
  try {
    id = (await newPayApp(cid, new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)), u)).id;
  } catch (e) {
    if (e instanceof PayAppError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/billing/pay-apps", "layout");
  redirect(`/billing/pay-apps/${cid}/${id}`);
}

export async function savePayAppAction(_: PaResult, f: FormData): Promise<PaResult> {
  await requireUser(BILLING_ROLES);
  const id = String(f.get("id"));
  const items = f.getAll("item").map(String);
  try {
    await savePayAppLines(
      id,
      items.map((item) => ({ item, thisPeriod: n(f.get(`this_${item}`)), stored: n(f.get(`stored_${item}`)) })),
    );
    if (f.get("submit") === "1") await setPayAppStatus(id, "SUBMITTED");
  } catch (e) {
    if (e instanceof PayAppError) return { problems: [e.message] };
    throw e;
  }
  revalidatePath("/billing/pay-apps", "layout");
  return { problems: [], ok: true };
}

export async function payAppStatusAction(f: FormData) {
  await requireUser(BILLING_ROLES);
  const id = String(f.get("id"));
  const status = String(f.get("status")) as "SUBMITTED" | "PAID" | "DRAFT";
  await setPayAppStatus(id, status);
  revalidatePath("/billing/pay-apps", "layout");
}

export async function deletePayAppAction(f: FormData) {
  await requireUser(BILLING_ROLES);
  const p = await prisma.payApp.delete({ where: { id: String(f.get("id")) } });
  revalidatePath("/billing/pay-apps", "layout");
  redirect(`/billing/pay-apps/${p.contractId}`);
}
