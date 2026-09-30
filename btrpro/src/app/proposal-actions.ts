"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { createProposal, declineProposal, sendProposal, signProposal, voidProposal } from "@/lib/proposals/service";
import type { Alternate } from "@/lib/proposals/price";

export type PResult = { problems: string[]; ok?: boolean; note?: string } | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const num = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim().replace(/[$,%\s]/g, "") : "";
  return s === "" ? null : Number(s);
};

export async function saveCompanySettingsAction(_: PResult, f: FormData): Promise<PResult> {
  const u = await requireUser(["ADMIN"]);
  const n = (k: string) => num(f.get(k));
  const vals = { markupPct: n("markupPct"), salesTaxPct: n("salesTaxPct"), depositPct: n("depositPct"), proposalValidDays: n("proposalValidDays"), overheadPct: n("overheadPct"), costVarianceThresholdPct: n("costVarianceThresholdPct") };
  if (Object.values(vals).some((v) => v != null && (!Number.isFinite(v) || v < 0))) return { problems: ["Numbers only, zero or more."] };
  await saveSettings({ ...vals, proposalTerms: String(f.get("proposalTerms") ?? "").trim() || null, warrantyText: String(f.get("warrantyText") ?? "").trim() || null }, u);
  revalidatePath("/settings/company");
  return { problems: [], ok: true };
}

export async function createProposalAction(_: PResult, f: FormData): Promise<PResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const estimateId = String(f.get("estimateId"));
  const names = f.getAll("altName").map(String);
  const descs = f.getAll("altDesc").map(String);
  const prices = f.getAll("altPrice").map((v) => num(v));
  const alternates: Alternate[] = names
    .map((name, i) => ({ name: name.trim(), description: (descs[i] ?? "").trim(), price: prices[i] as number }))
    .filter((a) => a.name || a.price != null);
  let pid: string;
  let projectId: string;
  try {
    const p = await createProposal(
      estimateId,
      {
        markupPct: num(f.get("markupPct")),
        priceOverride: num(f.get("priceOverride")),
        priceNote: String(f.get("priceNote") ?? ""),
        alternates,
        acknowledgeNotReady: f.get("acknowledgeNotReady") === "on",
      },
      u,
    );
    pid = p.id;
    projectId = p.projectId;
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(`/projects/${projectId}/proposals/${pid}`);
}

export async function sendProposalAction(_: PResult, f: FormData): Promise<PResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id"));
  try {
    const r = await sendProposal(id, { name: String(f.get("name") ?? "").trim() || null, email: String(f.get("email") ?? "").trim() || null }, u);
    revalidatePath(`/projects`, "layout");
    return { problems: [], ok: true, note: r.emailed ? "Emailed." : "Marked sent. Copy the link below and send it to the customer." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function voidProposalAction(f: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  await voidProposal(String(f.get("id")), u);
  revalidatePath(`/projects`, "layout");
}

// Public (customer) actions — authorized by the proposal's secret token only.
export async function signAction(_: PResult, f: FormData): Promise<PResult> {
  const h = await headers();
  const token = String(f.get("token"));
  try {
    await signProposal(token, {
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      consent: f.get("consent") === "on",
      selected: f.getAll("alternate").map(String),
      signatureImage: String(f.get("signatureImage") ?? "") || null,
      ip: h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip"),
      agent: h.get("user-agent"),
    });
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/p/${token}`);
  return { problems: [], ok: true };
}

export async function declineAction(_: PResult, f: FormData): Promise<PResult> {
  const token = String(f.get("token"));
  try {
    await declineProposal(token, String(f.get("reason") ?? ""));
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/p/${token}`);
  return { problems: [], ok: true };
}
