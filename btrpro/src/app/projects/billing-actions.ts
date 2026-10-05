"use server";

import { BILLING_ROLES } from "@/lib/roles";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts } from "@/lib/costing/service";
import {
  BillingError,
  createInvoice,
  deletePayment,
  recordPayment,
  sendInvoice,
  stripeCheckout,
  suggest,
  voidInvoice,
  type BillActor,
} from "@/lib/billing/service";
import {
  createChangeOrderFromEstimate,
  declineChangeOrder,
  importChangeOrders,
  sendChangeOrder,
  signChangeOrder,
} from "@/lib/billing/change-orders";
import { INVOICE_KIND_LABEL, type InvLine } from "@/lib/billing/math";

export type BResult = {
  problems: string[];
  ok?: boolean;
  note?: string;
  needsOverride?: boolean;
  url?: string;
} | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string) => {
  const s = v.replace(/[$,%\s]/g, "");
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[()-]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
};
const day = (v: string) => (v ? new Date(`${v}T12:00:00Z`) : null);

async function actor(): Promise<BillActor> {
  const u = await requireUser(BILLING_ROLES);
  return { id: u.id, name: u.name, role: u.role };
}
/** Billing is limited to Admins and the job's own estimator/salesperson, same as job costing. */
async function mayBill(a: BillActor, projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { estimatorId: true, salespersonId: true },
  });
  if (!p || !canSeeCosts({ id: a.id!, role: a.role }, p))
    throw new Error(
      "Only an Admin or this job's estimator/salesperson can do billing on it.",
    );
}
const paths = (projectId: string) => {
  revalidatePath(`/projects/${projectId}/billing`);
  revalidatePath(`/projects/${projectId}/costs`);
  revalidatePath("/reports/ar");
};

export async function suggestAction(projectId: string, kind: string) {
  await mayBill(await actor(), projectId);
  return suggest(projectId, kind);
}

export async function createInvoiceAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const projectId = str(f, "projectId");
  try {
    await mayBill(a, projectId);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  const kind = str(f, "kind");
  if (!(kind in INVOICE_KIND_LABEL))
    return { problems: ["Pick the kind of invoice."] };
  const descs = f.getAll("lineDesc").map(String);
  const amts = f.getAll("lineAmount").map(String);
  const lines: InvLine[] = [];
  for (let i = 0; i < descs.length; i++) {
    if (!descs[i].trim() && !amts[i]?.trim()) continue;
    const amount = num(amts[i] ?? "");
    if (amount == null || Number.isNaN(amount))
      return { problems: [`Line ${i + 1}: enter the amount as a number.`] };
    lines.push({ description: descs[i].trim(), amount });
  }
  const ret = str(f, "retainagePct");
  const retainagePct = ret === "" ? undefined : num(ret);
  if (Number.isNaN(retainagePct))
    return { problems: ["Retainage % must be a number."] };
  try {
    const inv = await createInvoice(
      projectId,
      {
        kind: kind as never,
        lines,
        dueDate: day(str(f, "dueDate")),
        notes: str(f, "notes") || null,
        retainagePct: retainagePct as number | null | undefined,
        override: str(f, "override") || null,
      },
      a,
    );
    paths(projectId);
    return {
      problems: [],
      ok: true,
      note: `Drafted ${inv.number}. Check it, then send it.`,
    };
  } catch (e) {
    return {
      problems: [msg(e)],
      needsOverride: e instanceof BillingError && e.needsOverride,
    };
  }
}

export async function sendInvoiceAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const id = str(f, "id");
  try {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    await mayBill(a, inv.projectId);
    const r = await sendInvoice(
      id,
      { name: str(f, "name") || null, email: str(f, "email") || null },
      a,
    );
    paths(inv.projectId);
    return {
      problems: [],
      ok: true,
      url: r.url,
      note: r.emailed
        ? "Sent by email."
        : "Marked sent. Email isn't set up (or no address), so copy the link to the customer.",
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function voidInvoiceAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const id = str(f, "id");
  try {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    await mayBill(a, inv.projectId);
    await voidInvoice(id, str(f, "reason"), a);
    paths(inv.projectId);
    return { problems: [], ok: true };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function recordPaymentAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const id = str(f, "invoiceId");
  const amount = num(str(f, "amount"));
  const date = day(str(f, "date"));
  try {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    await mayBill(a, inv.projectId);
    await recordPayment(
      id,
      {
        date: date ?? new Date(NaN),
        amount: amount ?? NaN,
        method: str(f, "method"),
        reference: str(f, "reference") || null,
        applySurcharge: f.get("surcharge") === "on",
      },
      a,
    );
    paths(inv.projectId);
    return { problems: [], ok: true, note: "Payment recorded." };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function deletePaymentAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const id = str(f, "id");
  try {
    const p = await prisma.payment.findUniqueOrThrow({
      where: { id },
      include: { invoice: true },
    });
    await deletePayment(id, str(f, "reason"), a);
    paths(p.invoice.projectId);
    return { problems: [], ok: true };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function coFromEstimateAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const projectId = str(f, "projectId");
  try {
    await mayBill(a, projectId);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  const markup = str(f, "markupPct");
  const markupPct = markup ? num(markup) : null;
  if (Number.isNaN(markupPct))
    return { problems: ["Markup % must be a number."] };
  if (!str(f, "description")) return { problems: ["Describe the change."] };
  try {
    const co = await createChangeOrderFromEstimate(
      projectId,
      {
        estimateId: str(f, "estimateId"),
        markupPct,
        description: str(f, "description"),
        kind: str(f, "kind") === "SUPPLEMENT" ? "SUPPLEMENT" : "CHANGE_ORDER",
      },
      a,
    );
    paths(projectId);
    return {
      problems: [],
      ok: true,
      note: `${co.number}: $${co.amount.toFixed(2)} (${co.priceFormula}). Send it for signature below.`,
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function sendCoAction(_: BResult, f: FormData): Promise<BResult> {
  const a = await actor();
  const id = str(f, "id");
  try {
    const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id } });
    await mayBill(a, co.projectId);
    const r = await sendChangeOrder(
      id,
      { name: str(f, "name") || null, email: str(f, "email") || null },
      a,
    );
    paths(co.projectId);
    return {
      problems: [],
      ok: true,
      url: r.url,
      note: r.emailed
        ? "Sent by email."
        : "Link ready. Email isn't set up (or no address), so copy the link to the customer.",
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

export async function importCoAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const a = await actor();
  const projectId = str(f, "projectId");
  try {
    await mayBill(a, projectId);
  } catch (e) {
    return { problems: [msg(e)] };
  }
  const file = f.get("file");
  if (!(file instanceof File) || !file.size)
    return { problems: ["Choose the CSV export."] };
  try {
    const r = await importChangeOrders(
      projectId,
      await file.text(),
      str(f, "source") === "Procore" ? "Procore" : "Buildertrend",
      a,
    );
    paths(projectId);
    return {
      problems: r.problems ?? [],
      ok: true,
      note: `${r.created} change orders added${r.skipped ? `, ${r.skipped} already here` : ""}.`,
    };
  } catch (e) {
    return { problems: [msg(e)] };
  }
}

// ---------- customer-facing (secret link, no sign-in) ----------

export async function payOnlineAction(f: FormData) {
  const token = str(f, "token");
  let url: string;
  try {
    url = await stripeCheckout(token);
  } catch (e) {
    redirect(`/i/${token}?error=${encodeURIComponent(msg(e))}`);
  }
  redirect(url);
}

export async function signCoAction(_: BResult, f: FormData): Promise<BResult> {
  const h = await headers();
  const token = str(f, "token");
  try {
    await signChangeOrder(token, {
      name: str(f, "name"),
      email: str(f, "email"),
      consent: f.get("consent") === "on",
      signatureImage: str(f, "signatureImage") || null,
      ip: h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip"),
    });
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/co/${token}`);
  return { problems: [], ok: true };
}

export async function declineCoAction(
  _: BResult,
  f: FormData,
): Promise<BResult> {
  const token = str(f, "token");
  try {
    await declineChangeOrder(token, str(f, "reason"));
  } catch (e) {
    return { problems: [msg(e)] };
  }
  revalidatePath(`/co/${token}`);
  return { problems: [], ok: true };
}

// ---------- progress billing schedule ----------
export async function scheduleAction(_: BResult, f: FormData): Promise<BResult> {
  const a = await actor();
  const projectId = str(f, "projectId");
  const { addSteps, applyPreset, billToPercent, invoiceStep, markStepReady, ScheduleError } = await import("@/lib/billing/schedule");
  try {
    await mayBill(a, projectId);
    const op = str(f, "op");
    let note = "";
    if (op === "preset") {
      await applyPreset(projectId, str(f, "preset"), a);
      note = "Billing schedule set. Each draw comes due on its own.";
    } else if (op === "add") {
      const basis = str(f, "basis") as "PERCENT" | "AMOUNT" | "REMAINDER";
      const v = num(str(f, "value"));
      await addSteps(projectId, [{ label: str(f, "label"), basis, pct: basis === "PERCENT" ? v : null, amount: basis === "AMOUNT" ? v : null, trigger: str(f, "trigger") as never, triggerDate: day(str(f, "triggerDate")) }], a);
      note = "Draw added.";
    } else if (op === "invoice") {
      const inv = await invoiceStep(str(f, "id"), a);
      note = `Drafted ${inv.number} for $${inv.subtotal.toFixed(2)}. Check it, then send it.`;
    } else if (op === "ready") {
      await markStepReady(str(f, "id"));
      note = "Marked ready to bill.";
    } else if (op === "skip" || op === "delete") {
      const step = await prisma.billingStep.findFirst({ where: { id: str(f, "id"), projectId } });
      if (!step) throw new ScheduleError("That draw is gone.");
      if (step.status === "INVOICED") throw new ScheduleError("That draw is invoiced. Void the invoice first.");
      if (op === "delete") await prisma.billingStep.delete({ where: { id: step.id } });
      else await prisma.billingStep.update({ where: { id: step.id }, data: { status: "SKIPPED" } });
      await prisma.task.updateMany({ where: { auto: `BILLSTEP:${step.id}`, doneAt: null }, data: { doneAt: new Date(), doneBy: a.name } });
      note = op === "delete" ? "Draw removed." : "Draw skipped.";
    } else if (op === "percent") {
      const inv = await billToPercent(projectId, num(str(f, "pct")) ?? NaN, a);
      note = `Drafted ${inv.number} for $${inv.subtotal.toFixed(2)}. Check it, then send it.`;
    } else return { problems: ["Unknown action."] };
    paths(projectId);
    return { problems: [], ok: true, note };
  } catch (e) {
    return { problems: [msg(e)], needsOverride: e instanceof BillingError && e.needsOverride };
  }
}
