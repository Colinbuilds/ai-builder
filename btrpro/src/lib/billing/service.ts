import type { Role } from "@/lib/session";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { nextInSequence } from "@/lib/numbering";
import { round } from "@/lib/calc/core";
import { BTR } from "@/lib/company";
import { getSettings } from "@/lib/settings";
import { loadCosting } from "@/lib/costing/service";
import { changeStage } from "@/lib/projects/service";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import {
  qboConnected,
  syncInvoice,
  syncPayment,
} from "@/lib/integrations/quickbooks";
import { PdfWriter } from "@/lib/pdf/writer";
import {
  agingBucket,
  balanceDue,
  billingSummary,
  cardSurcharge,
  invoiceTotals,
  INVOICE_KIND_LABEL,
  PAYMENT_METHODS,
  paymentStatus,
  type InvLine,
} from "./math";

export type BillActor = {
  id: string | null;
  name: string;
  role: Role | "SYSTEM";
};
export class BillingError extends Error {
  constructor(
    message: string,
    public needsOverride = false,
  ) {
    super(message);
  }
}
const guard = (a: BillActor) => {
  if (a.role === "VIEWER")
    throw new BillingError("Viewers can't bill or record payments.");
};
const act = (
  projectId: string,
  a: { id: string | null; name: string },
  text: string,
) =>
  prisma.projectActivity.create({
    data: { projectId, userId: a.id, kind: "billing", text },
  });
export const invoiceUrl = (token: string) =>
  `${process.env.APP_URL ?? ""}/i/${token}`;

async function nextNumber() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const used = await prisma.invoice.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  return nextInSequence(
    prefix,
    used.map((x) => x.number),
  );
}

/** Billing position for a job, from the same revenue the P&L uses (contract + approved COs − credits). */
export async function loadBilling(projectId: string) {
  const [{ pnl, project }, invoices] = await Promise.all([
    loadCosting(projectId),
    prisma.invoice.findMany({
      where: { projectId },
      include: { payments: { orderBy: { date: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { project, invoices, summary: billingSummary(pnl.revenue, invoices) };
}

/** Suggested amount for the next invoice of a kind. Suggestions only; the person confirms. */
export async function suggest(projectId: string, kind: string) {
  const [{ summary, project }, s] = await Promise.all([
    loadBilling(projectId),
    getSettings(),
  ]);
  if (summary.revenue == null)
    return { amount: null, why: "Contract amount MISSING" };
  if (kind === "DEPOSIT") {
    if (s.depositPct == null)
      return { amount: null, why: "No deposit % set (Settings → Company)" };
    const amount = round((project.contractAmount! * s.depositPct) / 100, 2);
    return {
      amount,
      why: `${project.contractAmount!.toFixed(2)} contract × ${s.depositPct}% deposit`,
    };
  }
  if (kind === "FINAL")
    return {
      amount: summary.unbilled,
      why: `${summary.revenue.toFixed(2)} revenue − ${summary.billedWork.toFixed(2)} already billed`,
    };
  if (kind === "RETAINAGE_RELEASE")
    return {
      amount: summary.retainageHeld || null,
      why: "retainage held to date",
    };
  return { amount: null, why: null };
}

export async function createInvoice(
  projectId: string,
  input: {
    kind: keyof typeof INVOICE_KIND_LABEL;
    lines: InvLine[];
    issueDate?: Date;
    dueDate?: Date | null;
    notes?: string | null;
    retainagePct?: number | null;
    override?: string | null;
  },
  actor: BillActor,
) {
  guard(actor);
  const [{ summary, project }, s] = await Promise.all([
    loadBilling(projectId),
    getSettings(),
  ]);
  if (
    project.status === "LEAD" ||
    project.status === "ESTIMATING" ||
    project.status === "SUBMITTED" ||
    project.status === "LOST"
  )
    throw new BillingError("The job isn't sold. Invoices go on sold jobs.");
  if (summary.revenue == null)
    throw new BillingError(
      "Contract amount is MISSING on this job. Set it (or have the customer sign the proposal) before billing.",
    );
  let totals;
  let overContract = false;
  try {
    const pct =
      input.retainagePct !== undefined
        ? input.retainagePct
        : project.market === "COMMERCIAL"
          ? project.retainagePct
          : null;
    totals = invoiceTotals(input.lines, pct, input.kind);
  } catch (e) {
    throw new BillingError(e instanceof Error ? e.message : String(e));
  }
  if (input.kind === "RETAINAGE_RELEASE") {
    // draft releases count too, so two drafts can't release the same retainage twice
    const { invoices } = await loadBilling(projectId);
    const drafted = round(
      invoices
        .filter((i) => i.status === "DRAFT" && i.kind === "RETAINAGE_RELEASE")
        .reduce((a, i) => a + i.subtotal, 0),
      2,
    );
    const available = round(summary.retainageHeld - drafted, 2);
    if (totals.subtotal > available + 0.005)
      throw new BillingError(
        drafted
          ? `Only $${available.toFixed(2)} of retainage is left to release ($${summary.retainageHeld.toFixed(2)} held, $${drafted.toFixed(2)} already on draft releases).`
          : `Only $${summary.retainageHeld.toFixed(2)} of retainage is held on this job.`,
      );
  } else {
    // drafts count toward the cap too, so two drafts can't together bill past the contract
    const { invoices } = await loadBilling(projectId);
    const onInvoices = round(
      invoices
        .filter((i) => i.status !== "VOID" && i.kind !== "RETAINAGE_RELEASE")
        .reduce((a, i) => a + i.subtotal, 0),
      2,
    );
    if (onInvoices + totals.subtotal > summary.revenue + 0.005) {
      const over = round(onInvoices + totals.subtotal - summary.revenue, 2);
      overContract = true;
      if (!input.override?.trim())
        throw new BillingError(
          `This bills $${over.toFixed(2)} past the contract ($${summary.revenue.toFixed(2)} incl. approved change orders; $${onInvoices.toFixed(2)} already on invoices). Add the change order first, or say why.`,
          true,
        );
    }
  }
  const issueDate = input.issueDate ?? new Date();
  const dueDate =
    input.dueDate ??
    (s.invoiceNetDays != null
      ? new Date(issueDate.getTime() + s.invoiceNetDays * 86_400_000)
      : issueDate);
  const contact = (
    await prisma.projectContact.findFirst({
      where: { projectId, isPrimary: true },
      include: { contact: true },
    })
  )?.contact;
  const client = project.clientCompanyId
    ? await prisma.company.findUnique({
        where: { id: project.clientCompanyId },
      })
    : null;
  const inv = await prisma.invoice.create({
    data: {
      projectId,
      number: await nextNumber(),
      kind: input.kind as never,
      lines: input.lines,
      ...totals,
      issueDate,
      dueDate,
      notes: input.notes?.trim() || null,
      override: overContract ? input.override?.trim() || null : null,
      token: randomBytes(18).toString("base64url"),
      billTo:
        client?.name ??
        (contact ? `${contact.firstName} ${contact.lastName}` : null),
      billToEmail: client?.email ?? contact?.email ?? null,
      createdBy: actor.name,
    },
  });
  await act(
    projectId,
    actor,
    `${actor.name} drafted ${INVOICE_KIND_LABEL[inv.kind].toLowerCase()} invoice ${inv.number} for $${inv.subtotal.toFixed(2)}${inv.retainage ? ` (retainage $${inv.retainage.toFixed(2)} held)` : ""}${inv.override ? ` — over contract: ${inv.override}` : ""}`,
  );
  return inv;
}

export async function sendInvoice(
  id: string,
  to: { name: string | null; email: string | null },
  actor: BillActor,
) {
  guard(actor);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: { project: true },
  });
  if (inv.status !== "DRAFT")
    throw new BillingError(`${inv.number} was already sent.`);
  await prisma.invoice.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      billTo: to.name ?? inv.billTo,
      billToEmail: to.email ?? inv.billToEmail,
    },
  });
  let emailed = false;
  const email = to.email ?? inv.billToEmail;
  if (email && emailConfigured()) {
    await sendEmail({
      to: email,
      subject: `${BTR.name} invoice ${inv.number} — ${inv.project.name}`,
      text: `${to.name ?? inv.billTo ?? ""}\n\nInvoice ${inv.number} for ${inv.project.name}: $${inv.amountDue.toFixed(2)} due ${inv.dueDate.toLocaleDateString("en-US", { timeZone: "UTC" })}.\n\nView and pay: ${invoiceUrl(inv.token)}\n\n${BTR.name} · ${BTR.phone}`,
    }).then(
      () => (emailed = true),
      (e) => console.error("invoice email failed", e),
    );
  }
  // the final invoice moves a completed job to Invoiced
  if (inv.kind === "FINAL" && inv.project.status === "COMPLETE")
    await changeStage(
      inv.projectId,
      "INVOICED",
      {},
      { id: actor.id, name: actor.name },
    ).catch(() => null);
  await act(
    inv.projectId,
    actor,
    `${actor.name} sent ${inv.number} ($${inv.amountDue.toFixed(2)} due)${emailed ? ` to ${email}` : ""}`,
  );
  if (await qboConnected()) await syncInvoice(id).catch(() => null);
  return { url: invoiceUrl(inv.token), emailed };
}

export async function voidInvoice(
  id: string,
  reason: string,
  actor: BillActor,
) {
  guard(actor);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: { payments: true },
  });
  if (inv.payments.length)
    throw new BillingError(
      "Payments are recorded on this invoice. Remove or move them before voiding.",
    );
  if (inv.status !== "DRAFT" && !reason.trim())
    throw new BillingError("Say why it's void.");
  await prisma.invoice.update({
    where: { id },
    data: { status: "VOID", voidReason: reason.trim() || null },
  });
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      entity: "Invoice",
      entityId: id,
      action: "void",
      before: { status: inv.status },
      after: { reason },
    },
  });
  await act(
    inv.projectId,
    actor,
    `${actor.name} voided ${inv.number}${reason ? `: ${reason}` : ""}${inv.qboId ? " — void it in QuickBooks too" : ""}`,
  );
}

export async function recordPayment(
  invoiceId: string,
  input: {
    date: Date;
    amount: number;
    method: string;
    reference: string | null;
    applySurcharge?: boolean;
    source?: "MANUAL" | "STRIPE";
    externalId?: string | null;
    surcharge?: number;
  },
  actor: BillActor,
) {
  guard(actor);
  if (
    input.externalId &&
    (await prisma.payment.findUnique({
      where: { externalId: input.externalId },
    }))
  )
    return null; // Stripe retried the webhook
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: true, project: true },
  });
  if (inv.status === "DRAFT" || inv.status === "VOID")
    throw new BillingError("Send the invoice before recording payments on it.");
  if (!(input.method in PAYMENT_METHODS))
    throw new BillingError("Pick how it was paid.");
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new BillingError("Enter the amount received.");
  if (Number.isNaN(input.date.getTime()))
    throw new BillingError("Enter the date received.");
  const due = balanceDue(inv);
  if (input.amount > due + 0.005)
    throw new BillingError(
      `That's more than the $${due.toFixed(2)} still due on ${inv.number}.`,
    );
  if (
    (input.method === "CHECK" || input.method === "INSURANCE_CHECK") &&
    !input.reference?.trim()
  )
    throw new BillingError("Enter the check number.");
  const s = await getSettings();
  const surcharge =
    input.surcharge ??
    (input.method === "CARD" && input.applySurcharge
      ? cardSurcharge(input.amount, s.cardSurchargePct).surcharge
      : 0);
  const pay = await prisma.payment.create({
    data: {
      invoiceId,
      date: input.date,
      amount: round(input.amount, 2),
      method: input.method,
      reference: input.reference?.trim() || null,
      surcharge,
      source: input.source ?? "MANUAL",
      externalId: input.externalId ?? null,
      recordedBy: actor.name,
    },
  });
  const paid = round(
    inv.payments.reduce((a, p) => a + p.amount, 0) + pay.amount,
    2,
  );
  const status = paymentStatus(inv.amountDue, paid);
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
  await act(
    inv.projectId,
    actor,
    `${actor.name} recorded $${pay.amount.toFixed(2)} ${PAYMENT_METHODS[pay.method].toLowerCase()}${pay.reference ? ` #${pay.reference}` : ""} on ${inv.number}${surcharge ? ` (+ $${surcharge.toFixed(2)} card surcharge)` : ""} — ${status === "PAID" ? "paid in full" : `$${round(inv.amountDue - paid, 2).toFixed(2)} still due`}`,
  );
  // paid in full with nothing left to bill → the job is Paid
  if (status === "PAID" && inv.project.status === "INVOICED") {
    const { summary } = await loadBilling(inv.projectId);
    if (
      summary.unbilled != null &&
      summary.unbilled <= 0.005 &&
      summary.openAR <= 0.005 &&
      summary.retainageHeld <= 0.005
    )
      await changeStage(
        inv.projectId,
        "PAID",
        {},
        { id: actor.id, name: actor.name },
      ).catch(() => null);
  }
  if (await qboConnected()) await syncPayment(pay.id).catch(() => null);
  return pay;
}

export async function deletePayment(
  id: string,
  reason: string,
  actor: BillActor,
) {
  if (actor.role !== "ADMIN")
    throw new BillingError("Only an Admin can remove a recorded payment.");
  if (!reason.trim())
    throw new BillingError("Say why the payment is being removed.");
  const p = await prisma.payment.findUniqueOrThrow({
    where: { id },
    include: { invoice: { include: { payments: true } } },
  });
  await prisma.payment.delete({ where: { id } });
  const paid = round(
    p.invoice.payments
      .filter((x) => x.id !== id)
      .reduce((a, x) => a + x.amount, 0),
    2,
  );
  await prisma.invoice.update({
    where: { id: p.invoiceId },
    data: { status: paymentStatus(p.invoice.amountDue, paid) },
  });
  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      entity: "Payment",
      entityId: id,
      action: "delete",
      before: JSON.parse(JSON.stringify(p)),
      after: { reason },
    },
  });
  await act(
    p.invoice.projectId,
    actor,
    `${actor.name} removed a $${p.amount.toFixed(2)} payment from ${p.invoice.number}: ${reason}${p.qboId ? " — remove it in QuickBooks too" : ""}`,
  );
}

/** Open invoices across the company by how late they are. */
export async function arAging(asOf = new Date()) {
  const open = await prisma.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIAL"] } },
    include: {
      payments: true,
      project: { select: { id: true, name: true, market: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  const rows = open
    .map((i) => ({
      ...i,
      balance: balanceDue(i),
      bucket: agingBucket(i.dueDate, asOf),
    }))
    .filter((r) => r.balance > 0.005);
  const totals: Record<string, number> = {};
  for (const r of rows)
    totals[r.bucket] = round((totals[r.bucket] ?? 0) + r.balance, 2);
  return {
    rows,
    totals,
    total: round(
      rows.reduce((a, r) => a + r.balance, 0),
      2,
    ),
  };
}

export async function getInvoiceByToken(token: string) {
  const inv = await prisma.invoice.findUnique({
    where: { token },
    include: {
      payments: { orderBy: { date: "asc" } },
      project: { select: { name: true, address: true } },
    },
  });
  if (!inv || inv.status === "DRAFT") return null;
  return inv;
}

export async function invoicePdf(id: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: { payments: true, project: true },
  });
  const s = await getSettings();
  const w = await PdfWriter.create({
    title: `Invoice ${inv.number}`,
    footer: `${BTR.name} · ${BTR.phone} · ${BTR.email}`,
  });
  w.text(`${BTR.name.toUpperCase()}  ·  ${BTR.address}  ·  ${BTR.phone}`, {
    size: 8,
    gap: 8,
  });
  w.heading(`${inv.status === "VOID" ? "VOID — " : ""}Invoice ${inv.number}`);
  w.text(`Bill to: ${inv.billTo ?? "—"}`, { size: 10, gap: 2 });
  w.text(
    `Job: ${inv.project.name}${inv.project.address ? ` · ${inv.project.address}` : ""}`,
    { size: 10, gap: 2 },
  );
  w.text(
    `Issued ${inv.issueDate.toLocaleDateString("en-US", { timeZone: "UTC" })} · Due ${inv.dueDate.toLocaleDateString("en-US", { timeZone: "UTC" })} · ${INVOICE_KIND_LABEL[inv.kind]}`,
    { size: 10, gap: 8 },
  );
  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const rows = (inv.lines as InvLine[]).map((l) => [
    l.description,
    money(l.amount),
  ]);
  rows.push(["Subtotal", money(inv.subtotal)]);
  if (inv.retainage)
    rows.push([
      `Retainage withheld (${inv.retainagePct}%)`,
      `-${money(inv.retainage)}`,
    ]);
  const paid = inv.payments.reduce((a, p) => a + p.amount, 0);
  if (paid) rows.push(["Payments received", `-${money(paid)}`]);
  rows.push(["Balance due", money(balanceDue(inv))]);
  w.table(
    [
      { header: "Description", width: 400 },
      { header: "Amount", width: 110, align: "right" },
    ],
    rows,
  );
  if (inv.notes) w.text(inv.notes, { size: 9, gap: 4 });
  if (s.remitTo) w.text(`Pay to: ${s.remitTo}`, { size: 9, gap: 2 });
  w.text(`Pay online: ${invoiceUrl(inv.token)}`, { size: 9, gap: 2 });
  return w.save();
}

// ---------- Stripe (optional) ----------

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

/** Card checkout for an invoice's balance (plus the surcharge line, if the company set one). */
export async function stripeCheckout(token: string) {
  if (!stripeConfigured())
    throw new BillingError("Online card payment isn't set up.");
  const inv = await getInvoiceByToken(token);
  if (!inv || inv.status === "VOID")
    throw new BillingError("This invoice isn't payable.");
  const due = balanceDue(inv);
  if (due <= 0) throw new BillingError("Nothing is due on this invoice.");
  const s = await getSettings();
  const sur = cardSurcharge(due, s.cardSurchargePct);
  const body = new URLSearchParams({
    mode: "payment",
    success_url: `${invoiceUrl(token)}?paid=1`,
    cancel_url: invoiceUrl(token),
    "metadata[invoiceId]": inv.id,
    "metadata[amount]": due.toFixed(2),
    "metadata[surcharge]": sur.surcharge.toFixed(2),
    "payment_intent_data[description]": `${BTR.name} ${inv.number}`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(due * 100)),
    "line_items[0][price_data][product_data][name]": `Invoice ${inv.number} — ${inv.project.name}`,
  });
  if (sur.surcharge > 0) {
    body.set("line_items[1][quantity]", "1");
    body.set("line_items[1][price_data][currency]", "usd");
    body.set(
      "line_items[1][price_data][unit_amount]",
      String(Math.round(sur.surcharge * 100)),
    );
    body.set(
      "line_items[1][price_data][product_data][name]",
      `Card surcharge (${s.cardSurchargePct}%)`,
    );
  }
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as {
    url?: string;
    error?: { message: string };
  };
  if (!res.ok || !json.url)
    throw new BillingError(`Stripe: ${json.error?.message ?? res.status}`);
  return json.url;
}

/** Verifies a Stripe webhook signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(
  raw: string,
  header: string | null,
  secret: string,
  toleranceSec = 300,
  now = Date.now(),
) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret)
    .update(`${t}.${raw}`)
    .digest("hex");
  const sigs = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  return sigs.some(
    (s) =>
      s.length === expected.length &&
      timingSafeEqual(Buffer.from(s), Buffer.from(expected)),
  );
}

/**
 * Stripe → the card payment is always accounted for. The invoice may have changed after checkout opened
 * (a check recorded, voided, paid twice from two tabs): what's still due is applied, and anything else is
 * put in front of the office as a task (refund or apply it) instead of failing and being retried forever.
 */
export async function handleStripeEvent(event: {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      payment_status?: string;
      metadata?: Record<string, string>;
    };
  };
}) {
  if (event.type !== "checkout.session.completed") return;
  const o = event.data.object;
  if (o.payment_status !== "paid" || !o.metadata?.invoiceId) return;
  if (await prisma.payment.findUnique({ where: { externalId: o.id } })) return; // retried webhook, already applied
  const paid = round(Number(o.metadata.amount), 2);
  const surcharge = Number(o.metadata.surcharge || 0);
  const system = {
    id: null,
    name: "Stripe (online card payment)",
    role: "SYSTEM" as const,
  };
  const inv = await prisma.invoice.findUnique({
    where: { id: o.metadata.invoiceId },
    include: { payments: true },
  });
  if (!inv) return;
  const flag = async (amount: number, why: string) => {
    const auto = `STRIPE:${o.id}`;
    if (await prisma.task.findFirst({ where: { auto } })) return;
    const text = `Card payment of $${amount.toFixed(2)} came in through Stripe (${o.id}) for ${inv.number}, but ${why}. Refund it in Stripe or apply it to another invoice.`;
    await prisma.task.create({
      data: {
        projectId: inv.projectId,
        title: text,
        dueDate: new Date(),
        auto,
        createdBy: system.name,
      },
    });
    await act(inv.projectId, system, text);
    await prisma.auditLog.create({
      data: {
        entity: "Invoice",
        entityId: inv.id,
        action: "stripe_unapplied",
        after: { session: o.id, amount, why },
      },
    });
  };
  if (inv.status === "VOID" || inv.status === "DRAFT")
    return flag(
      paid,
      `that invoice is ${inv.status === "VOID" ? "void" : "not sent"}`,
    );
  const due = balanceDue(inv);
  if (due <= 0.005) return flag(paid, "nothing was left due on it");
  const apply = Math.min(paid, due);
  await recordPayment(
    inv.id,
    {
      date: new Date(),
      amount: apply,
      method: "CARD",
      reference: o.id,
      source: "STRIPE",
      externalId: o.id,
      surcharge,
    },
    system,
  );
  if (paid - apply > 0.005)
    await flag(
      round(paid - apply, 2),
      `only $${apply.toFixed(2)} was still due, so $${apply.toFixed(2)} was applied`,
    );
}
