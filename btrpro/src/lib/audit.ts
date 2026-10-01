// Owner audit: approved money items, riskiest first, each with the reason it's on the list. An owner marks
// each "looks good" or flags it back to whoever approved it (as a task). Every review is logged.
import { prisma } from "@/lib/db";
import type { BillMatch } from "@/lib/bills/match";

export type AuditEntity = "SUPPLIER_BILL" | "CREW_INVOICE" | "INVOICE_VOID" | "CHANGE_ORDER";
export type AuditItem = {
  entity: AuditEntity;
  id: string;
  title: string;
  sub: string;
  amount: number | null;
  date: Date;
  risk: number;
  reasons: string[];
  href: string;
  projectId: string | null;
  approvedBy: string | null;
};
export const ENTITY_LABEL: Record<AuditEntity, string> = {
  SUPPLIER_BILL: "Supplier bill",
  CREW_INVOICE: "Crew invoice",
  INVOICE_VOID: "Voided customer invoice",
  CHANGE_ORDER: "Change order",
};
export const LARGE = 5000;

/** Everything approved in the period that no owner has reviewed yet, riskiest first. */
export async function auditQueue(opts: { since?: Date | null; sample?: number | null } = {}) {
  const since = opts.since ?? null;
  const when = since ? { gte: since } : undefined;
  const [bills, crew, voids, cos, reviewed] = await Promise.all([
    prisma.supplierBill.findMany({ where: { status: { in: ["APPROVED", "PAID"] }, ...(when ? { approvedAt: when } : {}) }, orderBy: { approvedAt: "asc" } }),
    prisma.crewInvoice.findMany({ where: { status: { in: ["APPROVED", "PAID"] }, ...(when ? { reviewedAt: when } : {}) }, include: { crew: { select: { name: true } }, project: { select: { name: true } } } }),
    prisma.invoice.findMany({ where: { status: "VOID", ...(when ? { updatedAt: when } : {}) }, include: { project: { select: { name: true } } } }),
    prisma.changeOrder.findMany({ where: { status: "APPROVED", ...(when ? { updatedAt: when } : {}) }, include: { project: { select: { name: true } } } }),
    prisma.auditReview.findMany({ select: { entity: true, entityId: true } }),
  ]);
  const done = new Set(reviewed.map((r) => `${r.entity}:${r.entityId}`));
  const jobNames = new Map(
    (await prisma.project.findMany({ where: { id: { in: bills.map((b) => b.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  );
  // first bill from a vendor, by vendor name
  const firstByVendor = new Map<string, string>();
  for (const b of await prisma.supplierBill.findMany({ where: { status: { not: "VOID" } }, select: { id: true, vendor: true }, orderBy: { createdAt: "asc" } }))
    if (!firstByVendor.has(b.vendor.toLowerCase())) firstByVendor.set(b.vendor.toLowerCase(), b.id);
  const items: AuditItem[] = [];
  for (const b of bills) {
    if (done.has(`SUPPLIER_BILL:${b.id}`)) continue;
    const m = b.match as BillMatch | null;
    const reasons: string[] = [];
    let risk = 10;
    if (m?.flags.includes("DUPLICATE")) (risk = Math.max(risk, 95)), reasons.push("Possible duplicate invoice");
    if (b.approveNote) (risk = Math.max(risk, 90)), reasons.push(`Approved over flags: “${b.approveNote}”`);
    const over = m?.lines.filter((l) => l.flags.includes("OVER_SHEET")).length ?? 0;
    if (over) (risk = Math.max(risk, 85)), reasons.push(`${over} line${over === 1 ? "" : "s"} over sheet price`);
    if ((b.total ?? 0) >= LARGE) (risk = Math.max(risk, 70)), reasons.push(`Large: over $${LARGE.toLocaleString()}`);
    if (firstByVendor.get(b.vendor.toLowerCase()) === b.id) (risk = Math.max(risk, 60)), reasons.push("First bill from this vendor");
    items.push({
      entity: "SUPPLIER_BILL",
      id: b.id,
      title: `${b.vendor}${b.invoiceNumber ? ` · ${b.invoiceNumber}` : ""}`,
      sub: b.projectId ? (jobNames.get(b.projectId) ?? "") : "no job",
      amount: b.total,
      date: b.approvedAt ?? b.createdAt,
      risk,
      reasons,
      href: `/bills/${b.id}`,
      projectId: b.projectId,
      approvedBy: b.approvedBy,
    });
  }
  // agreed pay from the crew's work order on the job, when there is one
  const wos = await prisma.workOrder.findMany({ where: { projectId: { in: crew.map((c) => c.projectId) }, status: { not: "CANCELLED" } }, select: { projectId: true, crewId: true, amount: true } });
  for (const c of crew) {
    if (done.has(`CREW_INVOICE:${c.id}`)) continue;
    const agreed = wos.filter((w) => w.projectId === c.projectId && w.crewId === c.crewId).reduce((a, w) => a + (w.amount ?? 0), 0);
    const reasons: string[] = [];
    let risk = 20;
    if (agreed > 0 && c.amount > agreed + 0.005) (risk = 92), reasons.push(`Billed $${c.amount.toFixed(2)} vs $${agreed.toFixed(2)} agreed on the work order`);
    if (!agreed) (risk = Math.max(risk, 55)), reasons.push("No work order with an agreed amount");
    if (c.amount >= LARGE) (risk = Math.max(risk, 70)), reasons.push(`Large: over $${LARGE.toLocaleString()}`);
    items.push({
      entity: "CREW_INVOICE",
      id: c.id,
      title: `${c.crew.name}${c.invoiceNumber ? ` · ${c.invoiceNumber}` : ""}`,
      sub: c.project.name,
      amount: c.amount,
      date: c.reviewedAt ?? c.createdAt,
      risk,
      reasons,
      href: `/crews/invoices`,
      projectId: c.projectId,
      approvedBy: c.reviewedBy,
    });
  }
  for (const v of voids) {
    if (done.has(`INVOICE_VOID:${v.id}`)) continue;
    items.push({
      entity: "INVOICE_VOID",
      id: v.id,
      title: `Invoice ${v.number} voided`,
      sub: v.project.name,
      amount: v.amountDue,
      date: v.updatedAt,
      risk: 65,
      reasons: [`Voided: ${v.voidReason ?? "no reason given"}`],
      href: `/projects/${v.projectId}/billing`,
      projectId: v.projectId,
      approvedBy: null,
    });
  }
  for (const co of cos) {
    if (done.has(`CHANGE_ORDER:${co.id}`)) continue;
    const reasons = [`${co.kind === "CREDIT" ? "Credit" : "Change order"} approved`];
    items.push({
      entity: "CHANGE_ORDER",
      id: co.id,
      title: `${co.number}${co.kind === "CREDIT" ? " (credit)" : ""}`,
      sub: co.project.name,
      amount: co.amount,
      date: co.updatedAt,
      risk: co.kind === "CREDIT" ? 60 : 30,
      reasons,
      href: `/projects/${co.projectId}/billing`,
      projectId: co.projectId,
      approvedBy: null,
    });
  }
  items.sort((a, b) => b.risk - a.risk || a.date.getTime() - b.date.getTime());
  if (opts.sample && items.length > opts.sample) {
    // random spot check: the riskiest always stay in, the rest are a random draw
    const must = items.filter((i) => i.risk >= 85);
    const rest = items.filter((i) => i.risk < 85).sort(() => Math.random() - 0.5);
    return [...must, ...rest].slice(0, Math.max(opts.sample, must.length));
  }
  return items;
}

export async function auditStats(since: Date) {
  const [reviews, approved] = await Promise.all([
    prisma.auditReview.count({ where: { createdAt: { gte: since } } }),
    Promise.all([
      prisma.supplierBill.count({ where: { status: { in: ["APPROVED", "PAID"] }, approvedAt: { gte: since } } }),
      prisma.crewInvoice.count({ where: { status: { in: ["APPROVED", "PAID"] }, reviewedAt: { gte: since } } }),
    ]).then(([a, b]) => a + b),
  ]);
  return { reviews, approved };
}

/** Records the owner's call; a flag goes back to whoever approved it as a task. */
export async function reviewItem(entity: AuditEntity, id: string, result: "OK" | "FLAG", note: string | null, owner: { id: string; name: string }, ctx: { title: string; projectId: string | null; approvedBy: string | null }) {
  if (result === "FLAG" && !note?.trim()) throw new Error("Say what needs a second look.");
  await prisma.auditReview.create({ data: { entity, entityId: id, result, note: note?.trim() || null, by: owner.name, byId: owner.id } });
  if (result === "FLAG") {
    const approver = ctx.approvedBy ? await prisma.user.findFirst({ where: { name: ctx.approvedBy }, select: { id: true } }) : null;
    await prisma.task.create({
      data: { projectId: ctx.projectId, title: `Owner question on ${ENTITY_LABEL[entity].toLowerCase()} ${ctx.title}: ${note!.trim()}`.slice(0, 300), assigneeId: approver?.id ?? null, dueDate: new Date(Date.now() + 2 * 86_400_000), createdBy: owner.name, auto: `AUDIT:${entity}:${id}` },
    });
  }
}
