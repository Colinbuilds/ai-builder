// Supplier bills (accounts payable): an on-account invoice is read like a receipt, matched against our PO,
// delivery tickets and price sheets, approved by the office into job costs, and sent to QuickBooks as a Bill.
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fileReceipt, loadReceipt, readReceipt, saveReceiptFiles, ReceiptError, type Saved } from "@/lib/receipts/service";
import { pushSupplierBill, qboBillBalance, qboConnected } from "@/lib/integrations/quickbooks";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import type { Role } from "@/lib/session";
import { matchBill, type BillMatch } from "./match";

export class BillError extends Error {}
type Actor = { id: string; name: string; role: Role; isOwner?: boolean };

const ymd = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : null);
const DAY = 86_400_000;

/** Upload or email: save the pages, read them, and open a bill. */
export async function scanBill(files: { bytes: Uint8Array; name: string }[], actor: { id: string; name: string }) {
  if (!files.length) throw new BillError("Add the invoice (PDF or photos).");
  const id = await saveReceiptFiles(files, { source: "UPLOAD", employeeId: actor.id, employee: actor.name, subject: "Supplier bill", message: null, emailId: null }, actor.id);
  await readReceipt(id);
  return openBill(id);
}

/** Turns a read scan into a bill (or refreshes it). */
export async function openBill(scanId: string) {
  const scan = await prisma.receiptScan.findUniqueOrThrow({ where: { id: scanId }, include: { bill: true } });
  if (scan.status === "FAILED") throw new BillError(scan.error ?? "Couldn't read that invoice.");
  const r = scan.extracted as { vendor?: string | null; invoiceNumber?: string | null; date?: string | null; dueDate?: string | null; terms?: string | null; total?: number | null } | null;
  const s = await getSettings();
  const inv = ymd(r?.date);
  const due = ymd(r?.dueDate) ?? (inv && s.billNetDays != null ? new Date(inv.getTime() + s.billNetDays * DAY) : null);
  const data = { vendor: r?.vendor?.trim() || "Supplier", invoiceNumber: r?.invoiceNumber?.trim() || null, invoiceDate: inv, dueDate: due, terms: r?.terms ?? null, total: r?.total ?? null };
  const bill = scan.bill
    ? await prisma.supplierBill.update({ where: { id: scan.bill.id }, data })
    : await prisma.supplierBill.create({ data: { ...data, scanId } });
  await refreshBill(bill.id);
  return bill.id;
}

/** Re-runs the job/PO match and the three-way check. */
export async function refreshBill(id: string, projectId?: string | null) {
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id } });
  if (["APPROVED", "PAID", "VOID"].includes(bill.status)) return bill;
  const data = await loadReceipt(bill.scanId, projectId ?? bill.projectId);
  if (!data) throw new BillError("This invoice couldn't be read.");
  const r = data.receipt;
  const pid = data.projectId;
  const keys = [r.poNumber, r.orderNumber, r.jobName].filter((x): x is string => !!x?.trim()).map((x) => x.trim());
  const orders = pid
    ? await prisma.materialOrder.findMany({ where: { projectId: pid, status: { not: "CANCELLED" } }, include: { lines: true, tickets: { select: { id: true } } } })
    : [];
  const order =
    orders.find((o) => keys.some((k) => k.toUpperCase().includes(o.number.toUpperCase()) || (o.supplierOrderNumber && k.toUpperCase() === o.supplierOrderNumber.toUpperCase()))) ??
    (orders.length === 1 ? orders[0] : null);
  const earlier = order
    ? await prisma.supplierBill.findMany({ where: { orderId: order.id, id: { not: id }, status: { in: ["APPROVED", "PAID"] } }, select: { match: true } })
    : [];
  const billedBefore: Record<string, number> = {};
  for (const e of earlier)
    for (const l of (e.match as BillMatch | null)?.lines ?? []) if (l.orderLineId && l.billed != null) billedBefore[l.orderLineId] = (billedBefore[l.orderLineId] ?? 0) + l.billed;
  const dup = bill.invoiceNumber
    ? await prisma.supplierBill.findFirst({ where: { id: { not: id }, vendor: bill.vendor, invoiceNumber: bill.invoiceNumber, status: { not: "VOID" } }, select: { id: true, createdAt: true } })
    : null;
  const match = matchBill({
    lines: data.lines.map((l) => ({
      itemNumber: l.itemNumber,
      description: l.description,
      quantity: l.quantity,
      uom: l.uom,
      amount: l.amount,
      priceStatus: l.check.status,
      priceNote: l.check.note,
      overBy: l.check.status === "OVER" ? l.check.diffTotal : null,
    })),
    order: order ? { number: order.number, tickets: order.tickets.length, lines: order.lines.map((l) => ({ id: l.id, itemNumber: l.itemNumber, description: l.description, quantity: l.quantity, unit: l.unit, received: l.received, returned: l.returned })) } : null,
    hasJob: !!pid,
    duplicateOf: dup ? `a bill entered ${dup.createdAt.toLocaleDateString("en-US")}` : null,
    mathFlags: data.totals.flags,
    billedBefore,
  });
  const status = bill.status === "DISPUTED" ? "DISPUTED" : match.ready ? "READY" : "NEEDS_LOOK";
  return prisma.supplierBill.update({ where: { id }, data: { projectId: pid, orderId: order?.id ?? null, match: match as object, status } });
}

export async function loadBill(id: string) {
  const bill = await prisma.supplierBill.findUnique({ where: { id }, include: { scan: true } });
  if (!bill) return null;
  const data = await loadReceipt(bill.scanId, bill.projectId);
  const order = bill.orderId ? await prisma.materialOrder.findUnique({ where: { id: bill.orderId }, select: { id: true, number: true, projectId: true, sentTo: true, supplier: true } }) : null;
  const s = await getSettings();
  return { bill, data, order, match: bill.match as BillMatch | null, ownerOver: s.billOwnerOver };
}

/**
 * Approve: files the lines to the job's material costs and sends a QuickBooks Bill. A bill with flags can be
 * approved only with a note; over the owner limit, or approved over flags, it needs an owner.
 */
export async function approveBill(id: string, note: string | null, actor: Actor) {
  if (!["ADMIN", "OFFICE", "PURCHASING", "ESTIMATOR"].includes(actor.role)) throw new BillError("You can't approve supplier bills.");
  const bill = await refreshBill(id);
  if (bill.status === "APPROVED" || bill.status === "PAID") throw new BillError("This bill is already approved.");
  if (bill.status === "VOID") throw new BillError("This bill was voided.");
  if (!bill.projectId) throw new BillError("Pick the job this bill is for.");
  const m = bill.match as BillMatch | null;
  const flagged = !m?.ready;
  if (flagged && !note?.trim()) throw new BillError("This bill has flags. Say why it's OK to pay (e.g. 'extra drip edge approved by Colin').");
  const s = await getSettings();
  const overLimit = s.billOwnerOver != null && (bill.total ?? 0) > s.billOwnerOver;
  if ((overLimit || flagged) && !actor.isOwner && s.billOwnerOver != null)
    throw new BillError(overLimit ? `Bills over $${s.billOwnerOver.toLocaleString()} need an owner's approval.` : "Bills approved over flags need an owner's approval.");
  try {
    await fileReceipt(bill.scanId, bill.projectId, { id: actor.id, name: actor.name, role: actor.role });
  } catch (e) {
    if (!(e instanceof ReceiptError && /already filed/.test(e.message))) throw e;
  }
  const now = new Date();
  let qboBillId: string | null = null;
  let qboStatus: string | null = null;
  if (await qboConnected()) {
    try {
      const data = await loadReceipt(bill.scanId, bill.projectId);
      qboBillId = await pushSupplierBill({
        projectId: bill.projectId,
        vendor: bill.vendor,
        invoiceNumber: bill.invoiceNumber,
        date: bill.invoiceDate?.toISOString().slice(0, 10) ?? null,
        dueDate: bill.dueDate?.toISOString().slice(0, 10) ?? null,
        lines: [
          ...(data?.lines ?? []).filter((l) => l.amount != null).map((l) => ({ description: `${l.itemNumber ? `${l.itemNumber} ` : ""}${l.description}${l.quantity != null ? ` × ${l.quantity} ${l.uom ?? ""}` : ""}`, amount: l.amount! })),
          ...(data?.receipt.tax ? [{ description: "Sales tax", amount: data.receipt.tax }] : []),
        ],
      });
      qboStatus = "Sent to QuickBooks as a bill.";
    } catch (e) {
      qboStatus = `QuickBooks: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else qboStatus = "QuickBooks isn't connected — enter this bill there by hand.";
  const updated = await prisma.supplierBill.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedBy: actor.name,
      approvedAt: now,
      approveNote: note?.trim() || null,
      needsOwner: false,
      ...(actor.isOwner && (overLimit || flagged) ? { ownerApprovedBy: actor.name, ownerApprovedAt: now } : {}),
      qboBillId,
      qboStatus,
    },
  });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "SupplierBill", entityId: id, action: "approve", after: { total: bill.total, flagged, note: note?.trim() || null, qboBillId } } });
  await prisma.projectActivity.create({
    data: { projectId: bill.projectId, userId: actor.id, kind: "cost", text: `${actor.name} approved ${bill.vendor} bill${bill.invoiceNumber ? ` ${bill.invoiceNumber}` : ""}${bill.total != null ? ` ($${bill.total.toFixed(2)})` : ""}${flagged ? ` over flags: ${note!.trim()}` : ""}` },
  });
  return updated;
}

/** Hold a bill and tell the supplier exactly which lines are wrong. Returns the message (sent if email is set up). */
export async function disputeBill(id: string, note: string, to: string | null, actor: Actor) {
  if (!note.trim()) throw new BillError("Say what's wrong with the bill.");
  const { bill, data, order, match } = (await loadBill(id)) ?? {};
  if (!bill || !data) throw new BillError("Bill not found.");
  if (["APPROVED", "PAID"].includes(bill.status)) throw new BillError("This bill is already approved. Ask the supplier for a credit instead.");
  const bad = (match?.lines ?? [])
    .filter((l) => l.flags.length)
    .map((l) => `- ${data.lines[l.index]?.itemNumber ?? ""} ${data.lines[l.index]?.description ?? ""}: ${l.notes.join(" ")}`.trim());
  const text = [
    `Hi,`,
    ``,
    `We're holding ${bill.vendor} invoice ${bill.invoiceNumber ?? "(no number)"}${bill.invoiceDate ? ` dated ${bill.invoiceDate.toLocaleDateString("en-US")}` : ""}${order ? ` for our PO ${order.number}` : ""} until these are fixed:`,
    ...bad,
    ``,
    note.trim(),
    ``,
    `Please send a corrected invoice or a credit memo.`,
    ``,
    `Thanks,`,
    `${actor.name}, BTR Contracting · 402-739-9811`,
  ].join("\n");
  let sent = false;
  if (to?.trim() && emailConfigured()) {
    await sendEmail({ to: to.trim(), subject: `Invoice ${bill.invoiceNumber ?? ""} — please correct`.trim(), text });
    sent = true;
  }
  await prisma.supplierBill.update({ where: { id }, data: { status: "DISPUTED", disputeNote: note.trim(), disputedAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "SupplierBill", entityId: id, action: "dispute", after: { note: note.trim(), sentTo: sent ? to : null } } });
  return { text, sent };
}

export async function reopenBill(id: string) {
  await prisma.supplierBill.update({ where: { id }, data: { status: "NEEDS_LOOK", disputeNote: null, disputedAt: null } });
  return refreshBill(id);
}

export async function voidBill(id: string, reason: string, actor: Actor) {
  if (!reason.trim()) throw new BillError("Say why (e.g. duplicate, replaced by a corrected invoice).");
  const b = await prisma.supplierBill.findUniqueOrThrow({ where: { id } });
  if (["APPROVED", "PAID"].includes(b.status)) throw new BillError("Approved bills can't be voided here — fix it in job costs and QuickBooks.");
  await prisma.supplierBill.update({ where: { id }, data: { status: "VOID", disputeNote: reason.trim() } });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "SupplierBill", entityId: id, action: "void", after: { reason: reason.trim() } } });
}

export async function markBillPaid(id: string, ref: string | null, actor: Actor) {
  if (!["ADMIN", "OFFICE"].includes(actor.role)) throw new BillError("The office marks bills paid.");
  const b = await prisma.supplierBill.findUniqueOrThrow({ where: { id } });
  if (b.status !== "APPROVED") throw new BillError("Approve the bill before marking it paid.");
  await prisma.supplierBill.update({ where: { id }, data: { status: "PAID", paidAt: new Date(), paidRef: ref?.trim() || null } });
}

/** Bills paid in QuickBooks come back as paid here (balance 0). Quietly skips when QuickBooks isn't connected. */
export async function syncPaidFromQuickBooks(limit = 50) {
  if (!(await qboConnected())) return 0;
  const open = await prisma.supplierBill.findMany({ where: { status: "APPROVED", qboBillId: { not: null } }, take: limit, orderBy: { approvedAt: "asc" } });
  let paid = 0;
  for (const b of open) {
    try {
      if ((await qboBillBalance(b.qboBillId!)) <= 0.005) {
        await prisma.supplierBill.update({ where: { id: b.id }, data: { status: "PAID", paidAt: new Date(), paidRef: "Paid in QuickBooks" } });
        paid++;
      }
    } catch {
      /* try again next time */
    }
  }
  return paid;
}

export async function billSummary(now = new Date()) {
  const open = await prisma.supplierBill.findMany({ where: { status: { in: ["NEEDS_LOOK", "READY", "APPROVED", "DISPUTED"] } }, select: { status: true, total: true, dueDate: true } });
  const week = new Date(now.getTime() + 7 * DAY);
  const sum = (xs: typeof open) => Math.round(xs.reduce((a, b) => a + (b.total ?? 0), 0) * 100) / 100;
  const unpaid = open.filter((b) => b.status !== "DISPUTED");
  return {
    needsLook: open.filter((b) => b.status === "NEEDS_LOOK").length,
    ready: open.filter((b) => b.status === "READY").length,
    approved: open.filter((b) => b.status === "APPROVED").length,
    disputed: open.filter((b) => b.status === "DISPUTED").length,
    dueThisWeek: sum(unpaid.filter((b) => b.dueDate && b.dueDate >= now && b.dueDate <= week)),
    pastDue: sum(unpaid.filter((b) => b.dueDate && b.dueDate < now)),
    noDueDate: unpaid.filter((b) => !b.dueDate).length,
  };
}

export type { Saved };
