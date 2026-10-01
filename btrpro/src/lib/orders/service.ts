import type { Role } from "@/lib/session";
import { prisma } from "@/lib/db";
import { nextInSequence } from "@/lib/numbering";
import { round } from "@/lib/calc/core";
import { BTR, SUPPLIER } from "@/lib/company";
import { getSettings } from "@/lib/settings";
import { showForm17Banner } from "@/lib/projects/workflow";
import { addDocument } from "@/lib/docs/documents";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { PdfWriter } from "@/lib/pdf/writer";
import { liveItems } from "@/lib/estimates/service";
import { priceScopeFor } from "@/lib/pricing-scope";
import { deliveryStatus, orderLinePrice, toOrderUnit } from "./price";

export type OrderActor = {
  id: string;
  name: string;
  role: Role;
};
export class OrderError extends Error {}

const MATERIAL = (s: string) => s.startsWith("MATERIAL");
export const DROP_LOCATIONS = [
  "Driveway",
  "Roof load (boom)",
  "Street / curb",
  "Garage",
  "Jobsite laydown area",
  "Will call (we pick up)",
] as const;
export const WINDOWS: Record<string, string> = {
  AM: "Morning",
  PM: "Afternoon",
  ANYTIME: "Anytime",
  WILL_CALL: "Will call",
};

function guard(actor: OrderActor) {
  if (actor.role === "VIEWER")
    throw new OrderError("Viewers can't change material orders.");
}
async function activity(
  projectId: string,
  actor: { id: string | null; name: string },
  text: string,
) {
  await prisma.projectActivity.create({
    data: { projectId, userId: actor.id, kind: "order", text },
  });
}
async function nextNumber() {
  const year = new Date().getFullYear();
  const prefix = `MO-${year}-`;
  const used = await prisma.materialOrder.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  return nextInSequence(
    prefix,
    used.map((x) => x.number),
  );
}
async function draftOrThrow(orderId: string) {
  const o = await prisma.materialOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  if (o.status !== "DRAFT")
    throw new OrderError(
      `${o.number} was already sent. Lines can't change now — send a new order for anything extra, or record a return.`,
    );
  return o;
}

export async function createOrder(
  projectId: string,
  estimateId: string | null,
  actor: OrderActor,
) {
  guard(actor);
  const lines: {
    itemNumber: string | null;
    description: string;
    quantity: number | null;
    unit: string | null;
    priceItemId: string | null;
    extended: number | null;
    priceFormula: string | null;
    estimateLineId: string | null;
    note: string | null;
    sortOrder: number;
  }[] = [];
  if (estimateId) {
    const e = await prisma.estimate.findUniqueOrThrow({
      where: { id: estimateId },
      include: {
        lines: {
          orderBy: [{ section: "asc" }, { sortOrder: "asc" }],
          include: { priceItem: true },
        },
      },
    });
    if (e.projectId !== projectId)
      throw new OrderError("That estimate belongs to a different job.");
    const mats = e.lines.filter(
      (l) => MATERIAL(l.section) && l.sourceStatus !== "PENDING_AI",
    );
    if (!mats.length)
      throw new OrderError("That estimate has no material lines.");
    mats.forEach((l, i) => {
      const ou = toOrderUnit(l.quantity, l.unit, l.priceItem);
      const price = orderLinePrice(ou.quantity, ou.unit, l.priceItem);
      lines.push({
        itemNumber: l.supplierItemNumber,
        description: l.itemName,
        quantity: ou.quantity,
        unit: ou.unit,
        priceItemId: l.priceItemId,
        extended: price.extended,
        priceFormula: price.formula,
        estimateLineId: l.id,
        note:
          [
            ou.note,
            l.substitution ? "SUBSTITUTION (approved on estimate)" : null,
            l.quantity == null ? "Quantity MISSING on the estimate" : null,
          ]
            .filter(Boolean)
            .join("; ") || null,
        sortOrder: i,
      });
    });
  }
  const o = await prisma.materialOrder.create({
    data: {
      projectId,
      number: await nextNumber(),
      estimateId,
      supplier: SUPPLIER.name,
      createdBy: actor.name,
      lines: { create: lines },
    },
  });
  await activity(
    projectId,
    actor,
    `${actor.name} started material order ${o.number}${estimateId ? " from the estimate" : ""}`,
  );
  return o;
}

export async function updateOrderDetails(
  orderId: string,
  d: {
    requestedDate: Date | null;
    deliveryWindow: string | null;
    dropLocation: string | null;
    siteContact: string | null;
    notes: string | null;
  },
  actor: OrderActor,
) {
  guard(actor);
  const o = await prisma.materialOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  if (o.status === "CANCELLED" || o.status === "DELIVERED")
    throw new OrderError(`${o.number} is ${o.status.toLowerCase()}.`);
  await prisma.materialOrder.update({ where: { id: orderId }, data: d });
  if (
    o.status !== "DRAFT" &&
    o.requestedDate?.getTime() !== d.requestedDate?.getTime()
  )
    await activity(
      o.projectId,
      actor,
      `${actor.name} changed ${o.number} delivery to ${d.requestedDate?.toLocaleDateString("en-US") ?? "no date"} — tell the branch`,
    );
}

export async function setLineQuantity(
  lineId: string,
  quantity: number | null,
  actor: OrderActor,
) {
  guard(actor);
  const l = await prisma.materialOrderLine.findUniqueOrThrow({
    where: { id: lineId },
  });
  await draftOrThrow(l.orderId);
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0))
    throw new OrderError(
      "Quantity must be more than zero (remove the line instead).",
    );
  const item = l.priceItemId
    ? await prisma.priceItem.findUnique({ where: { id: l.priceItemId } })
    : null;
  const price = orderLinePrice(quantity, l.unit, item);
  await prisma.materialOrderLine.update({
    where: { id: lineId },
    data: { quantity, extended: price.extended, priceFormula: price.formula },
  });
}

export async function addOrderLine(
  orderId: string,
  input: {
    itemNumber: string | null;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  },
  actor: OrderActor,
) {
  guard(actor);
  const order = await draftOrThrow(orderId);
  if (
    input.quantity == null ||
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0
  )
    throw new OrderError("Enter a quantity.");
  let item = null;
  if (input.itemNumber) {
    const scope = await priceScopeFor(order.projectId);
    const live = (await liveItems([input.itemNumber.trim()], scope)).get(
      input.itemNumber.trim(),
    );
    item = live
      ? await prisma.priceItem.findUnique({ where: { id: live.id } })
      : null;
    if (!item)
      throw new OrderError(
        `${input.itemNumber} isn't on ${scope.builderId ? `${scope.builderName}'s pricing` : "a loaded price sheet"}. Leave the item # blank and describe it to order it anyway (priced by the supplier).`,
      );
  } else if (!input.description?.trim() || !input.unit?.trim())
    throw new OrderError("Pick an item, or type a description and unit.");
  const unit = item ? item.uom : input.unit!.trim().toUpperCase();
  const price = orderLinePrice(input.quantity, unit, item);
  const n = await prisma.materialOrderLine.count({ where: { orderId } });
  return prisma.materialOrderLine.create({
    data: {
      orderId,
      itemNumber: item?.itemNumber ?? null,
      description: item?.description ?? input.description!.trim(),
      quantity: input.quantity,
      unit,
      priceItemId: item?.id ?? null,
      extended: price.extended,
      priceFormula: price.formula,
      sortOrder: n,
    },
  });
}

export async function removeOrderLine(lineId: string, actor: OrderActor) {
  guard(actor);
  const l = await prisma.materialOrderLine.findUniqueOrThrow({
    where: { id: lineId },
  });
  await draftOrThrow(l.orderId);
  await prisma.materialOrderLine.delete({ where: { id: lineId } });
}

export async function loadOrder(orderId: string) {
  return prisma.materialOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          address: true,
          isPublic: true,
          isTaxExempt: true,
          form17Status: true,
          acculynxJobNumber: true,
        },
      },
      lines: { orderBy: { sortOrder: "asc" } },
      tickets: { orderBy: { date: "desc" } },
      commitment: { include: { bills: { select: { amount: true } } } },
    },
  });
}

/** Problems that stop an order from going to the supplier. */
export function sendProblems(o: Awaited<ReturnType<typeof loadOrder>>) {
  const problems: string[] = [];
  if (showForm17Banner(o.project))
    problems.push(
      "PUB-01: this is a public, tax-exempt job and the Form 17 isn't executed. Materials can't be ordered until it is (it can't be overridden).",
    );
  if (!o.lines.length) problems.push("The order has no lines.");
  const noQty = o.lines.filter((l) => l.quantity == null);
  if (noQty.length)
    problems.push(
      `Quantity MISSING on: ${noQty.map((l) => l.description).join(", ")}.`,
    );
  if (!o.requestedDate) problems.push("Pick the delivery date.");
  if (!o.dropLocation) problems.push("Say where to drop it.");
  if (!o.siteContact)
    problems.push("Add the on-site contact the driver calls.");
  return problems;
}

export async function orderPdf(orderId: string) {
  const o = await loadOrder(orderId);
  const w = await PdfWriter.create({
    title: `Material order ${o.number}`,
    footer: `${BTR.name} · PO ${o.number} · ${o.project.name}`,
  });
  w.text(`${BTR.name.toUpperCase()}  ·  ${BTR.address}  ·  ${BTR.phone}`, {
    size: 8,
    gap: 0,
  });
  w.text(`ABC account ${BTR.abcAccount}`, { size: 8, gap: 8 });
  w.heading(`Material order ${o.number}`);
  w.text(`To: ${o.supplier} · ${SUPPLIER.address} · ${SUPPLIER.phone}`, {
    size: 10,
    gap: 2,
  });
  w.text(
    `Job: ${o.project.name}${o.project.acculynxJobNumber ? ` (job #${o.project.acculynxJobNumber})` : ""}`,
    { size: 10, gap: 2 },
  );
  w.text(`Deliver to: ${o.project.address ?? "ADDRESS MISSING"}`, {
    size: 10,
    bold: true,
    gap: 2,
  });
  w.text(
    `Date: ${o.requestedDate?.toLocaleDateString("en-US", { timeZone: "UTC" }) ?? "MISSING"} · ${o.deliveryWindow ? WINDOWS[o.deliveryWindow] : "any time"} · Drop: ${o.dropLocation ?? "MISSING"} · Site contact: ${o.siteContact ?? "MISSING"}`,
    { size: 10, gap: 2 },
  );
  w.text(
    `Please put PO ${o.number} on the invoice.${o.project.isTaxExempt ? " Tax-exempt job — Form 17 on file." : ""}`,
    { size: 10, gap: 8 },
  );
  w.table(
    [
      { header: "Item #", width: 95 },
      { header: "Description", width: 300 },
      { header: "Qty", width: 60, align: "right" },
      { header: "Unit", width: 60 },
    ],
    o.lines.map((l) => [
      l.itemNumber ?? "(no item #)",
      l.description,
      l.quantity == null ? "MISSING" : String(l.quantity),
      l.unit ?? "",
    ]),
  );
  if (o.notes) w.text(`Notes: ${o.notes}`, { size: 10, gap: 4 });
  return w.save();
}

export async function sendOrder(
  orderId: string,
  opts: { method: "EMAIL" | "MANUAL"; to?: string | null },
  actor: OrderActor,
) {
  guard(actor);
  const o = await loadOrder(orderId);
  if (o.status !== "DRAFT")
    throw new OrderError(`${o.number} was already sent.`);
  const closed = await prisma.project.findUnique({ where: { id: o.projectId }, select: { costClosedAt: true } });
  if (closed?.costClosedAt && actor.role !== "ADMIN")
    throw new OrderError("Job costing is closed on this job. An Admin has to reopen it before new materials are committed.");
  const problems = sendProblems(o);
  if (problems.length) throw new OrderError(problems.join(" "));
  const pdf = await orderPdf(orderId);
  const { doc } = await addDocument({
    projectId: o.projectId,
    bytes: pdf,
    fileName: `${o.number} material order.pdf`,
    contentType: "application/pdf",
    userId: actor.id,
  });
  let sentTo: string | null = null;
  if (opts.method === "EMAIL") {
    const s = await getSettings();
    sentTo = opts.to?.trim() || s.supplierOrderEmail;
    if (!sentTo)
      throw new OrderError(
        'No order email for the branch. Add it under Settings → Company, or send it yourself and use "Mark as sent".',
      );
    if (!emailConfigured())
      throw new OrderError(
        'Outbound email isn\'t set up on this server. Download the PDF, send it yourself, and use "Mark as sent".',
      );
    await sendEmail({
      to: sentTo,
      subject: `PO ${o.number} — ${o.project.name} — deliver ${o.requestedDate!.toLocaleDateString("en-US", { timeZone: "UTC" })}`,
      text: `Please confirm this order and delivery date by reply.\n\nJob: ${o.project.name}\nDeliver to: ${o.project.address}\nDrop: ${o.dropLocation}\nSite contact: ${o.siteContact}\nAccount: ${BTR.abcAccount}\n\n${o.lines.map((l) => `${l.itemNumber ?? "-"}  ${l.description}  ${l.quantity} ${l.unit ?? ""}`).join("\n")}\n\n${BTR.name} · ${BTR.phone}`,
      attachments: [
        { name: `${o.number}.pdf`, contentType: "application/pdf", bytes: pdf },
      ],
    });
  }
  const expected = round(
    o.lines.reduce((a, l) => a + (l.extended ?? 0), 0),
    2,
  );
  const unpriced = o.lines.filter((l) => l.extended == null).length;
  await prisma.$transaction([
    prisma.materialOrder.update({
      where: { id: orderId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        sentBy: actor.name,
        sentTo,
        sentMethod: opts.method,
      },
    }),
    ...(expected > 0
      ? [
          prisma.costCommitment.create({
            data: {
              projectId: o.projectId,
              category: "MATERIALS",
              vendor: o.supplier,
              description: `Material order ${o.number}${unpriced ? ` (${unpriced} line(s) unpriced — not included)` : ""}`,
              amount: expected,
              reference: o.number,
              documentId: doc.id,
              enteredBy: actor.name,
              orderId,
            },
          }),
        ]
      : []),
  ]);
  await activity(
    o.projectId,
    actor,
    `${actor.name} ${opts.method === "EMAIL" ? `emailed ${o.number} to ${sentTo}` : `marked ${o.number} sent`} for delivery ${o.requestedDate!.toLocaleDateString("en-US", { timeZone: "UTC" })}. Expected cost $${expected.toFixed(2)}${unpriced ? ` + ${unpriced} unpriced line(s)` : ""}`,
  );
  return { expected, unpriced, documentId: doc.id };
}

export async function confirmOrder(
  orderId: string,
  d: { supplierOrderNumber: string | null; confirmedDate: Date | null },
  actor: OrderActor,
) {
  guard(actor);
  const o = await prisma.materialOrder.findUniqueOrThrow({
    where: { id: orderId },
  });
  if (o.status === "DRAFT" || o.status === "CANCELLED")
    throw new OrderError("Send the order first.");
  if (!d.confirmedDate)
    throw new OrderError("Enter the delivery date the branch confirmed.");
  await prisma.materialOrder.update({
    where: { id: orderId },
    data: { ...d, status: o.status === "SENT" ? "CONFIRMED" : o.status },
  });
  await activity(
    o.projectId,
    actor,
    `${actor.name}: ABC confirmed ${o.number}${d.supplierOrderNumber ? ` (ABC #${d.supplierOrderNumber})` : ""} for ${d.confirmedDate.toLocaleDateString("en-US", { timeZone: "UTC" })}`,
  );
}

export async function receiveOrder(
  orderId: string,
  input: {
    date: Date;
    ticketNumber: string | null;
    note: string | null;
    lines: {
      id: string;
      received: number;
      backordered: number;
      backorderDate: Date | null;
    }[];
    file?: { bytes: Uint8Array; name: string; type: string | null } | null;
  },
  actor: OrderActor,
) {
  guard(actor);
  const o = await loadOrder(orderId);
  if (o.status === "DRAFT" || o.status === "CANCELLED")
    throw new OrderError("Only sent orders can be received.");
  const byId = new Map(o.lines.map((l) => [l.id, l]));
  for (const l of input.lines) {
    const line = byId.get(l.id);
    if (!line) throw new OrderError("That line isn't on this order.");
    if (![l.received, l.backordered].every((n) => Number.isFinite(n) && n >= 0))
      throw new OrderError(
        `${line.description}: quantities can't be negative.`,
      );
    if (l.backordered > 0 && !l.backorderDate)
      throw new OrderError(
        `${line.description}: when is the backorder expected?`,
      );
  }
  let documentId: string | null = null;
  if (input.file?.bytes.length)
    documentId = (
      await addDocument({
        projectId: o.projectId,
        bytes: input.file.bytes,
        fileName: input.file.name,
        contentType: input.file.type,
        userId: actor.id,
      })
    ).doc.id;
  const updated = o.lines.map((line) => {
    const u = input.lines.find((x) => x.id === line.id);
    return u
      ? {
          ...line,
          received: u.received,
          backordered: u.backordered,
          backorderDate: u.backordered ? u.backorderDate : null,
        }
      : line;
  });
  const status = deliveryStatus(updated) ?? o.status;
  await prisma.$transaction([
    ...input.lines.map((u) =>
      prisma.materialOrderLine.update({
        where: { id: u.id },
        data: {
          received: u.received,
          backordered: u.backordered,
          backorderDate: u.backordered ? u.backorderDate : null,
        },
      }),
    ),
    prisma.deliveryTicket.create({
      data: {
        orderId,
        date: input.date,
        ticketNumber: input.ticketNumber,
        documentId,
        note: input.note,
        receivedBy: actor.name,
      },
    }),
    prisma.materialOrder.update({ where: { id: orderId }, data: { status } }),
  ]);
  const short = updated.filter(
    (l) => l.quantity != null && l.received < l.quantity,
  );
  await activity(
    o.projectId,
    actor,
    `${actor.name} received ${o.number}${input.ticketNumber ? ` (ticket ${input.ticketNumber})` : ""}: ${status === "DELIVERED" ? "complete" : `short on ${short.map((l) => `${l.description} (${l.received}/${l.quantity})`).join(", ")}`}`,
  );
  return { status, short: short.length };
}

export async function recordReturn(
  lineId: string,
  qty: number,
  reason: string,
  actor: OrderActor,
) {
  guard(actor);
  const l = await prisma.materialOrderLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { order: { include: { commitment: true } } },
  });
  if (!Number.isFinite(qty) || qty <= 0)
    throw new OrderError("Enter how many are going back.");
  if (l.returned + qty > l.received)
    throw new OrderError(
      `Only ${l.received - l.returned} ${l.unit ?? ""} of ${l.description} were received and not already returned.`,
    );
  if (!reason.trim())
    throw new OrderError(
      "Say why it's going back (extra, damaged, wrong color…).",
    );
  await prisma.materialOrderLine.update({
    where: { id: lineId },
    data: {
      returned: l.returned + qty,
      note: [l.note, `Returned ${qty}: ${reason.trim()}`]
        .filter(Boolean)
        .join("; "),
    },
  });
  const c = l.order.commitment;
  let credit: number | null = null;
  if (c && l.extended != null && l.quantity) {
    credit = round((l.extended * qty) / l.quantity, 2);
    await prisma.costCommitment.update({
      where: { id: c.id },
      data: { amount: round(Math.max(0, c.amount - credit), 2) },
    });
  }
  await activity(
    l.order.projectId,
    actor,
    `${actor.name} is returning ${qty} ${l.unit ?? ""} ${l.description} on ${l.order.number}: ${reason.trim()}${credit != null ? ` (about $${credit.toFixed(2)} expected credit)` : ""}`,
  );
  return { credit };
}

export async function cancelOrder(
  orderId: string,
  reason: string,
  actor: OrderActor,
) {
  guard(actor);
  const o = await prisma.materialOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, commitment: true },
  });
  if (o.status === "DELIVERED" || o.status === "PARTIAL")
    throw new OrderError(
      "Material has already arrived. Record returns instead of cancelling.",
    );
  if (o.status !== "DRAFT" && !reason.trim())
    throw new OrderError(
      "Say why the order is cancelled (and call the branch).",
    );
  await prisma.materialOrder.update({
    where: { id: orderId },
    data: { status: "CANCELLED", cancelReason: reason.trim() || null },
  });
  if (o.commitment)
    await prisma.costCommitment.update({
      where: { id: o.commitment.id },
      data: { status: "CANCELLED" },
    });
  await activity(
    o.projectId,
    actor,
    `${actor.name} cancelled ${o.number}${reason.trim() ? `: ${reason.trim()}` : ""}`,
  );
}

/** Everything headed to jobs: upcoming and overdue deliveries and open backorders, across the company. */
export async function deliveryBoard() {
  const orders = await prisma.materialOrder.findMany({
    where: { status: { in: ["SENT", "CONFIRMED", "PARTIAL"] } },
    include: {
      project: {
        select: { id: true, name: true, address: true, market: true },
      },
      lines: true,
    },
    orderBy: [{ confirmedDate: "asc" }, { requestedDate: "asc" }],
  });
  return orders.map((o) => ({
    ...o,
    when: o.confirmedDate ?? o.requestedDate,
    backorders: o.lines.filter((l) => l.backordered > 0),
  }));
}
