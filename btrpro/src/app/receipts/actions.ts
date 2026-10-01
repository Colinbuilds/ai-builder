"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { ReceiptError, approveReceipt, recropAndReread, scanReceipt, setLinePrices, type Outcome } from "@/lib/receipts/service";
import { BillingError } from "@/lib/billing/service";
import { CostError } from "@/lib/costing/service";
import { aiErrorMessage } from "@/lib/ai/claude";

export type RResult = { problems: string[]; ok?: boolean; note?: string } | null;
const msg = (e: unknown) => (e instanceof ReceiptError || e instanceof CostError || e instanceof BillingError ? e.message : aiErrorMessage(e));

export async function scanReceiptAction(_: RResult, f: FormData): Promise<RResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  let id: string;
  try {
    const files = await Promise.all(
      f
        .getAll("photos")
        .filter((x): x is File => x instanceof File && x.size > 0)
        .map(async (x) => ({ bytes: new Uint8Array(await x.arrayBuffer()), name: x.name || "receipt" })),
    );
    id = await scanReceipt(files, u, String(f.get("note") ?? "").trim() || null);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  redirect(`/receipts/${id}`);
}

export async function approveReceiptAction(_: RResult, f: FormData): Promise<RResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id") ?? "");
  const projectId = String(f.get("projectId") ?? "");
  const outcome = String(f.get("outcome") ?? "") as Outcome;
  if (!projectId) return { problems: ["Pick the job this receipt is for."] };
  if (!["COST_ONLY", "CHANGE_ORDER", "INVOICE"].includes(outcome)) return { problems: ["Pick what to make: job cost only, a change order, or an invoice."] };
  const num = (v: FormDataEntryValue | null) => {
    const t = String(v ?? "").replace(/[%\s]/g, "");
    return t === "" ? null : Number(t);
  };
  const markupPct = num(f.get("markupPct"));
  let lineMarkup: Record<string, number> = {};
  try {
    lineMarkup = JSON.parse(String(f.get("lineMarkup") ?? "{}"));
  } catch {
    return { problems: ["Couldn't read the line markups."] };
  }
  try {
    const r = await approveReceipt(id, { projectId, outcome, markupPct, lineMarkup, reason: String(f.get("reason") ?? "").trim() || null }, u);
    revalidatePath(`/receipts/${id}`);
    revalidatePath(`/projects/${projectId}`, "layout");
    const what = outcome === "CHANGE_ORDER" ? "Change order drafted (send it for signature from the job's Billing tab)" : outcome === "INVOICE" ? "Invoice drafted (send it from the job's Billing tab)" : "Filed to job costs";
    return { problems: [], ok: true, note: `${what}. ${r.count} cost line${r.count === 1 ? "" : "s"} ($${r.total.toFixed(2)}).${r.qboStatus ? ` ${r.qboStatus}` : ""}` };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function recropAction(_: RResult, f: FormData): Promise<RResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id") ?? "");
  const mode = String(f.get("mode") ?? "box");
  let crop: { x: number; y: number; w: number; h: number } | "auto" | "none" = mode === "auto" ? "auto" : "none";
  if (mode === "box") {
    try {
      crop = JSON.parse(String(f.get("crop") ?? ""));
    } catch {
      return { problems: ["Draw a box around the receipt."] };
    }
  }
  try {
    await recropAndReread(id, Number(f.get("page") ?? 0), { crop, rotate: Number(f.get("rotate") ?? 0) as 0 }, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/receipts/${id}`);
  return { problems: [], ok: true, note: "Read again with the new crop." };
}

export async function linePricesAction(_: RResult, f: FormData): Promise<RResult> {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(f.get("id") ?? "");
  const prices: Record<string, number | null> = {};
  for (const [k, v] of f.entries())
    if (k.startsWith("price_")) {
      const t = String(v).replace(/[$,\s]/g, "");
      prices[k.slice(6)] = t === "" ? null : Number(t);
    }
  try {
    await setLinePrices(id, prices, u);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/receipts/${id}`);
  return { problems: [], ok: true, note: "Prices saved." };
}
