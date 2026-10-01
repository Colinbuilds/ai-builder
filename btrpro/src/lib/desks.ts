// The Office and Purchasing home screens: each a to-do list, most urgent first, every row linking to where
// the work is done. Read-only queries.
import { prisma } from "@/lib/db";
import { billSummary } from "@/lib/bills/service";
import type { BillMatch } from "@/lib/bills/match";

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function officeDesk(now = new Date()) {
  const today = startOfDay(now);
  const week = new Date(today.getTime() + 7 * DAY);
  const open = await prisma.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIAL"] } },
    include: {
      payments: { select: { amount: true } },
      calls: { orderBy: { createdAt: "desc" }, take: 1 },
      project: {
        select: {
          id: true,
          name: true,
          clientCompany: { select: { name: true, phone: true } },
          contacts: { where: { isPrimary: true }, select: { contact: { select: { firstName: true, lastName: true, phone: true } } }, take: 1 },
        },
      },
    },
    orderBy: { dueDate: "asc" },
  });
  const rows = open.map((i) => {
    const balance = r2(i.amountDue - i.payments.reduce((a, p) => a + p.amount, 0));
    const c = i.project.contacts[0]?.contact;
    return {
      id: i.id,
      number: i.number,
      projectId: i.project.id,
      job: i.project.name,
      who: i.billTo ?? i.project.clientCompany?.name ?? (c ? `${c.firstName} ${c.lastName}` : null),
      phone: c?.phone ?? i.project.clientCompany?.phone ?? null,
      dueDate: i.dueDate,
      daysLate: Math.floor((today.getTime() - startOfDay(i.dueDate).getTime()) / DAY),
      balance,
      lastCall: i.calls[0] ?? null,
    };
  });
  const overdue = rows.filter((r) => r.daysLate > 0 && r.balance > 0.005);
  // a promise or follow-up date in the future parks it until then
  const callList = overdue.filter((r) => !r.lastCall?.followUpOn || r.lastCall.followUpOn <= now).sort((a, b) => b.daysLate - a.daysLate);
  const parked = overdue.length - callList.length;
  const [drafts, completeNoFinal, crewWaiting, qboInvoices, qboBills, bills] = await Promise.all([
    prisma.invoice.findMany({ where: { status: "DRAFT" }, select: { id: true, number: true, amountDue: true, kind: true, project: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({
      where: { status: "COMPLETE", invoices: { none: { kind: "FINAL", status: { not: "VOID" } } } },
      select: { id: true, name: true, statusChangedAt: true },
      orderBy: { statusChangedAt: "asc" },
    }),
    prisma.crewInvoice.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED"] } }, select: { id: true, status: true, amount: true, invoiceNumber: true, crew: { select: { name: true } }, project: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.invoice.findMany({ where: { qboError: { not: null }, status: { not: "VOID" } }, select: { id: true, number: true, qboError: true, project: { select: { id: true, name: true } } } }),
    prisma.supplierBill.findMany({ where: { qboStatus: { startsWith: "QuickBooks:" }, status: { in: ["APPROVED", "PAID"] } }, select: { id: true, vendor: true, invoiceNumber: true, qboStatus: true } }),
    billSummary(now),
  ]);
  const comingIn = r2(rows.filter((r) => r.dueDate <= week).reduce((a, r) => a + r.balance, 0));
  return {
    awaitingPayment: rows.filter((r) => r.balance > 0.005),
    callList,
    parked,
    drafts,
    completeNoFinal,
    crewToApprove: crewWaiting.filter((c) => c.status === "SUBMITTED"),
    crewToPay: crewWaiting.filter((c) => c.status === "APPROVED"),
    qboProblems: [
      ...qboInvoices.map((i) => ({ href: `/projects/${i.project.id}/billing`, label: `Invoice ${i.number} · ${i.project.name}`, error: i.qboError! })),
      ...qboBills.map((b) => ({ href: `/bills/${b.id}`, label: `${b.vendor} bill ${b.invoiceNumber ?? ""}`, error: b.qboStatus!.replace(/^QuickBooks:\s*/, "") })),
    ],
    bills,
    comingIn,
    goingOut: r2(bills.dueThisWeek + bills.pastDue),
  };
}

export async function purchasingDesk(now = new Date()) {
  const today = startOfDay(now);
  const dayAfter = new Date(today.getTime() + 2 * DAY);
  const soon = new Date(today.getTime() + 30 * DAY);
  const [needOrders, drafts, deliveries, backorders, returns, priceBills, sheets] = await Promise.all([
    prisma.project.findMany({
      where: { status: { in: ["SOLD", "SCHEDULED", "IN_PRODUCTION"] }, materialOrders: { none: { status: { not: "CANCELLED" } } } },
      select: { id: true, name: true, status: true, statusChangedAt: true },
      orderBy: { statusChangedAt: "asc" },
    }),
    prisma.materialOrder.findMany({ where: { status: "DRAFT" }, select: { id: true, number: true, project: { select: { id: true, name: true } }, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.materialOrder.findMany({
      where: {
        status: { in: ["SENT", "CONFIRMED", "PARTIAL"] },
        OR: [{ confirmedDate: { gte: today, lt: dayAfter } }, { confirmedDate: null, requestedDate: { gte: today, lt: dayAfter } }],
      },
      select: { id: true, number: true, confirmedDate: true, requestedDate: true, deliveryWindow: true, dropLocation: true, siteContact: true, project: { select: { id: true, name: true, address: true } } },
      orderBy: [{ confirmedDate: "asc" }, { requestedDate: "asc" }],
    }),
    prisma.materialOrderLine.findMany({
      where: { backordered: { gt: 0 }, order: { status: { not: "CANCELLED" } } },
      select: { id: true, description: true, backordered: true, unit: true, backorderDate: true, order: { select: { id: true, number: true, project: { select: { id: true, name: true } } } } },
      orderBy: { backorderDate: "asc" },
    }),
    prisma.materialOrderLine.findMany({
      where: { returned: { gt: 0 } },
      select: { id: true, description: true, returned: true, unit: true, order: { select: { id: true, number: true, project: { select: { id: true, name: true } } } } },
    }),
    prisma.supplierBill.findMany({ where: { status: "NEEDS_LOOK" }, select: { id: true, vendor: true, invoiceNumber: true, match: true, total: true } }),
    prisma.priceSheet.findMany({ where: { isActive: true, expirationDate: { lte: soon } }, select: { id: true, code: true, name: true, expirationDate: true }, orderBy: { expirationDate: "asc" } }),
  ]);
  // a return is settled once a credit (negative) bill is on file for that order
  const credited = new Set(
    (await prisma.supplierBill.findMany({ where: { orderId: { in: returns.map((r) => r.order.id) }, total: { lt: 0 }, status: { not: "VOID" } }, select: { orderId: true } })).map((b) => b.orderId),
  );
  return {
    needOrders,
    drafts,
    deliveries,
    backorders: backorders.map((b) => ({ ...b, overdue: !!b.backorderDate && b.backorderDate < today })),
    creditsMissing: returns.filter((r) => !credited.has(r.order.id)),
    priceProblems: priceBills.filter((b) => (b.match as BillMatch | null)?.lines.some((l) => l.flags.includes("OVER_SHEET"))),
    sheets: sheets.map((s) => ({ ...s, expired: !!s.expirationDate && s.expirationDate < today })),
  };
}
