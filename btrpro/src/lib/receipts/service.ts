// ABC (or any supplier) receipt photos: the AI transcribes what's printed, then the app matches the job,
// checks the math, compares every line with the price sheets (the builder's own pricing on builder jobs),
// and files the lines to the job's material costs.
import type { Role } from "@/lib/session";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { readUpload, saveUpload } from "@/lib/storage";
import { aiErrorMessage, aiParse } from "@/lib/ai/claude";
import { sniff } from "@/lib/portal/crew";
import { MAX_PHOTO_BYTES, resized } from "@/lib/photos/images";
import sharp from "sharp";
import { cleanPage, detectPaper, zoomSections, type Crop, type Rotate } from "@/lib/photos/document";
import { priceScopeFor, STANDARD_SCOPE } from "@/lib/pricing-scope";
import { addDocument } from "@/lib/docs/documents";
import { guardCostEdit, importInvoiceRows, type CostActor } from "@/lib/costing/service";
import type { InvoiceRow } from "@/lib/costing/invoice-csv";
import { DEFAULT_RECEIPT_MARKUP, lineAmount, matchReceiptJob, priceCheckLine, receiptPricing, totalsCheck, type Receipt, type SheetPrice } from "./check";
import { getSettings } from "@/lib/settings";
import { getCompany, shortName } from "@/lib/company-profile";

export class ReceiptError extends Error {}
export const MAX_RECEIPT_FILES = 6;

const num = z.number().nullable();
const str = z.string().nullable();
export const ReceiptSchema = z.object({
  documentType: z.enum(["RECEIPT", "INVOICE", "DELIVERY_TICKET", "OTHER"]).describe("RECEIPT = store/cash receipt; INVOICE = supplier invoice; DELIVERY_TICKET = pick/delivery ticket (usually no prices)"),
  vendor: str.describe("Supplier name as printed, e.g. ABC Supply Co."),
  branch: str.describe("Branch name/number as printed"),
  invoiceNumber: str.describe("Invoice or receipt number as printed"),
  orderNumber: str.describe("Supplier's order/sales order number as printed"),
  poNumber: str.describe("Customer PO / PO # / Job PO field exactly as printed (often our job name or PO number)"),
  jobName: str.describe("Job name / job reference field as printed, if separate from the PO"),
  shipToName: str.describe("Ship-to / deliver-to name as printed"),
  shipToAddress: str.describe("Ship-to / delivery / job-site street address as printed (not the branch or bill-to address)"),
  date: str.describe("Invoice/receipt date as YYYY-MM-DD, only if printed"),
  dueDate: str.describe("Payment due date as YYYY-MM-DD, only if printed on an invoice").optional(),
  terms: str.describe("Payment terms exactly as printed, e.g. 'NET 10TH PROX' or 'Net 30'").optional(),
  lines: z.array(
    z.object({
      itemNumber: str.describe("Supplier item/product number / SKU exactly as printed, keeping leading zeros; null if none"),
      orderedQuantity: num.describe("Ordered quantity when the document has separate ordered and shipped columns; else null"),
      handwritten: z.boolean().describe("true when the line was written in by hand"),
      description: z.string().describe("Item description as printed"),
      quantity: num.describe("Shipped/delivered quantity as printed (use the shipped column when ordered and shipped both appear)"),
      uom: str.describe("Unit of measure exactly as printed (EA, BD, SQ, RL, BX, PC…)"),
      unitPrice: num.describe("Unit price as printed, number only"),
      extendedPrice: num.describe("Line total/extended price as printed, number only; negative for returns/credits"),
    }),
  ),
  subtotal: num.describe("Subtotal as printed"),
  tax: num.describe("Sales tax as printed"),
  total: num.describe("Invoice/receipt total as printed"),
  notes: z.array(z.string()).describe("Anything unreadable, cut off, handwritten, or ambiguous — one short note each"),
});

const TASK = `Transcribe a photographed supplier receipt, invoice or delivery ticket (ABC Supply, Menards, Home Depot, Lowe's…) into the schema.
Copy only what is printed or handwritten. Never calculate, total, infer, or fill in a value that isn't there — use null when a field isn't printed or isn't legible, and add a note.
Item numbers, units of measure and prices exactly as printed (keep leading zeros, no unit conversions). Money as plain numbers without $ or commas.
You get the whole page first (cropped and contrast-enhanced), then zoomed sections of it from top to bottom that overlap a little — use the zoomed sections to read small print, and list each line once.

Layouts you will see:
- Store receipts (Menards, Home Depot): each item is a description line, then a line with the SKU/item number, sometimes "2 @62.99" (quantity 2, unit price 62.99) and the line total. A line with only one price means quantity 1 at that price.
  "TOTAL" printed before the tax line is the subtotal; "TOTAL SALE" / "BALANCE" after tax is the total. Card/payment lines (VISA, CAPITAL ONE ####, auth codes, ARQC, rebate numbers, "total number of items") are NOT line items.
  The "PO #" line is usually the job name (e.g. a customer name) — put it in poNumber.
- ABC Supply delivery tickets: ORDERED / SHIPPED / UNIT columns, then item number and description, usually NO prices (prices null). Use the SHIPPED quantity as quantity and ORDERED as orderedQuantity.
  Handwritten additions are real line items: transcribe them with handwritten true (e.g. "1  #1179 Trim Nail" → quantity 1, description "#1179 Trim Nail", itemNumber null unless a supplier item number is written).
  "Ship To" ${shortName()}'s shop or office is not the job site — still put it in shipToAddress; the PO is how the job is known.
- ABC invoices: same columns plus unit price and extension.
If several photos are pages of the same document, combine them in order without repeating lines.`;

// crop: the office's crop ("none" = whole photo), else the auto-detected paper; rotate: quarter turns the office applied
export type Saved = { url: string; type: string; auto?: Crop | null; crop?: Crop | "none" | null; rotate?: Rotate };
export const cropOf = (f: Saved): Crop | null => (f.crop === "none" ? null : (f.crop ?? f.auto ?? null));

/** The page as the AI sees it: rotated, cropped to the paper, cleaned up — plus zoomed sections for tall pages. */
export async function pageImages(f: Saved) {
  const original = new Uint8Array(await readUpload(f.url));
  const page = await cleanPage(original, { crop: cropOf(f), rotate: f.rotate ?? 0 });
  const whole = await sharp(page.data).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return { whole, sections: await zoomSections(page.data, page.info.width, page.info.height) };
}

/** Saves the photos/PDF and asks the AI to transcribe them. */
export type ScanFrom = {
  source: "UPLOAD" | "EMAIL";
  employeeId: string | null; // staff user who sent it
  employee: string; // their name (or the email sender's)
  subject?: string | null;
  message?: string | null;
  emailId?: string | null;
};

/** Saves the photos/PDF pages (as AI-readable JPEGs) and records who sent them. Nothing is read yet. */
export async function saveReceiptFiles(files: { bytes: Uint8Array; name: string }[], from: ScanFrom, createdById: string) {
  const real = files.filter((f) => f.bytes.length);
  if (!real.length) throw new ReceiptError("Take or choose a photo of the receipt.");
  if (real.length > MAX_RECEIPT_FILES) throw new ReceiptError(`Up to ${MAX_RECEIPT_FILES} photos per receipt.`);
  const saved: Saved[] = [];
  for (const f of real) {
    if (f.bytes.length > MAX_PHOTO_BYTES) throw new ReceiptError(`${f.name} is over 20 MB.`);
    const kind = sniff(f.bytes);
    if (!kind) throw new ReceiptError(`${f.name} isn't a photo or PDF.`);
    if (kind === "pdf") saved.push({ url: await saveUpload(f.bytes, "receipt.pdf", "receipts"), type: "application/pdf" });
    else {
      // keep a good upright copy as the original; find the paper in it for the auto-crop
      const jpg = await resized(f.bytes, 3000, 92);
      if (!jpg) throw new ReceiptError(`Couldn't open ${f.name}. On iPhone, set Camera → Formats → Most Compatible, or take a screenshot of the photo.`);
      const auto = await detectPaper(jpg).catch(() => null);
      saved.push({ url: await saveUpload(jpg, "receipt.jpg", "receipts"), type: "image/jpeg", auto, crop: null, rotate: 0 });
    }
  }
  const scan = await prisma.receiptScan.create({
    data: {
      files: saved,
      status: "READING",
      createdById,
      source: from.source,
      employeeId: from.employeeId,
      employee: from.employee.slice(0, 120),
      subject: from.subject?.slice(0, 300) || null,
      message: from.message?.slice(0, 4000) || null,
      emailId: from.emailId ?? null,
    },
  });
  return scan.id;
}

/** Sends the saved pages to the AI to transcribe. Email text goes along only as a hint for the job. */
export async function readReceipt(id: string) {
  const scan = await prisma.receiptScan.findUniqueOrThrow({ where: { id } });
  const files = scan.files as Saved[];
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [i, f] of files.entries()) {
    if (f.type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: (await readUpload(f.url)).toString("base64") } });
      continue;
    }
    const { whole, sections } = await pageImages(f);
    content.push({ type: "text", text: `Page ${i + 1} — whole page:` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: whole.toString("base64") } });
    sections.forEach((sct, k) =>
      content.push({ type: "text", text: `Page ${i + 1} — zoomed section ${k + 1} of ${sections.length} (top to bottom):` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: sct.toString("base64") } }),
    );
  }
  const ctx =
    scan.subject || scan.message
      ? `\n\nIt was sent by ${scan.employee ?? "an employee"} with this note (use it only to fill jobName/shipToAddress when the receipt itself doesn't show them, and say so in notes):\nSubject: ${scan.subject ?? ""}\nMessage: ${scan.message ?? ""}`
      : "";
  content.push({ type: "text", text: `${files.length} page${files.length === 1 ? "" : "s"} of one receipt. Transcribe it.${ctx}` });
  try {
    const { data } = await aiParse({ task: TASK, schema: ReceiptSchema, effort: "medium", messages: [{ role: "user", content }] });
    await prisma.receiptScan.update({ where: { id }, data: { status: "READ", extracted: data, invoiceNo: data.invoiceNumber, vendor: data.vendor, docType: data.documentType, error: null } });
  } catch (e) {
    await prisma.receiptScan.update({ where: { id }, data: { status: "FAILED", error: aiErrorMessage(e) } });
  }
}

/** Upload from the office or a phone: save, then read right away. */
export async function scanReceipt(files: { bytes: Uint8Array; name: string }[], actor: { id: string; name: string }, note?: string | null) {
  const id = await saveReceiptFiles(files, { source: "UPLOAD", employeeId: actor.id, employee: actor.name, message: note ?? null }, actor.id);
  await readReceipt(id);
  return id;
}

async function sheetRowsFor(itemNumbers: string[], builderId: string | null) {
  const clean = [...new Set(itemNumbers.map((n) => n.trim()).filter(Boolean))];
  if (!clean.length) return new Map<string, SheetPrice[]>();
  const rows = await prisma.priceItem.findMany({
    where: { itemNumber: { in: clean }, sheet: { isActive: true, OR: [{ companyId: null }, ...(builderId ? [{ companyId: builderId }] : [])] } },
    include: { sheet: { select: { code: true, name: true, companyId: true } } },
  });
  const m = new Map<string, SheetPrice[]>();
  for (const r of rows)
    m.set(r.itemNumber, [...(m.get(r.itemNumber) ?? []), { code: r.sheet.code, name: r.sheet.name, unitPrice: r.unitPrice, uom: r.uom, builder: !!r.sheet.companyId, description: r.description }]);
  return m;
}

/** A scan with its job match, math checks and price check against the job's pricing (or BTR standard when no job is chosen). */
export async function loadReceipt(id: string, chosenProjectId?: string | null) {
  const co = await getCompany();
  const scan = await prisma.receiptScan.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, address: true } } } });
  if (!scan) return null;
  const r = scan.extracted as Receipt | null;
  if (!r) return null;
  const [jobs, orders] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true, address: true, status: true, acculynxJobNumber: true, clientCompany: { select: { name: true } } } }),
    prisma.materialOrder.findMany({ select: { projectId: true, number: true, supplierOrderNumber: true } }),
  ]);
  const { match, candidates } = matchReceiptJob(
    r,
    jobs.map((j) => ({ ...j, clientName: j.clientCompany?.name ?? null })),
    orders,
    { subject: scan.subject, message: scan.message, ownAddresses: co.ownAddresses },
  );
  const projectId = chosenProjectId ?? scan.projectId ?? match?.projectId ?? null;
  const scope = projectId ? await priceScopeFor(projectId) : STANDARD_SCOPE;
  const sheets = await sheetRowsFor(
    r.lines.map((l) => l.itemNumber ?? ""),
    scope.builderId,
  );
  // no printed price (delivery tickets): a price the office typed in, else our sheet price when the unit matches
  const typed = (scan.linePrice as Record<string, number> | null) ?? {};
  const lines = r.lines.map((l, i) => {
    const check = priceCheckLine(l, l.itemNumber ? (sheets.get(l.itemNumber.trim()) ?? []) : [], scope);
    const printed = lineAmount(l);
    let amt = { ...printed, priced: (printed.amount != null ? "PRINTED" : null) as "PRINTED" | "SHEET" | "ENTERED" | null };
    if (printed.amount == null && l.quantity != null) {
      const t = typed[String(i)];
      const sheet = check.compared;
      if (t != null) amt = { amount: Math.round(l.quantity * t * 100) / 100, formula: `${l.quantity} × $${t.toFixed(2)} (entered in the office)`, mathFlag: null, priced: "ENTERED" };
      else if (sheet?.unitPrice != null && l.uom && l.uom.trim().toUpperCase() === sheet.uom.trim().toUpperCase())
        amt = { amount: Math.round(l.quantity * sheet.unitPrice * 100) / 100, formula: `${l.quantity} × $${sheet.unitPrice.toFixed(2)} (${sheet.builder ? "builder " : ""}sheet ${sheet.code})`, mathFlag: null, priced: "SHEET" };
    }
    return { ...l, ...amt, check };
  });
  const overbilled = Math.round(lines.reduce((a, l) => a + (l.check.status === "OVER" && l.check.diffTotal ? l.check.diffTotal : 0), 0) * 100) / 100;
  const jobName = (id: string) => jobs.find((j) => j.id === id);
  // customer pricing: tax spread over the lines, then the markup (receipt-wide, or per line)
  const settings = await getSettings();
  const defaultMarkup = scan.markupPct ?? settings.receiptMarkupPct ?? DEFAULT_RECEIPT_MARKUP;
  const overrides = (scan.lineMarkup as Record<string, number> | null) ?? {};
  const pricing = receiptPricing(
    lines.map((l) => l.amount ?? 0),
    r.tax,
    lines.map((_, i) => overrides[String(i)] ?? defaultMarkup),
  );
  const project = projectId
    ? await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, address: true, status: true, contractAmount: true, changeOrders: { where: { status: "APPROVED" }, select: { kind: true, amount: true } } },
      })
    : null;
  const contractNow =
    project?.contractAmount == null ? null : Math.round((project.contractAmount + project.changeOrders.reduce((a, c) => a + (c.kind === "CREDIT" ? -c.amount : c.amount), 0)) * 100) / 100;
  return {
    pricing,
    defaultMarkup,
    project,
    contractNow,
    scan,
    receipt: r,
    match,
    candidates: candidates.map((c) => ({ ...c, name: jobName(c.projectId)?.name ?? "?", address: jobName(c.projectId)?.address ?? null })),
    projectId,
    scope,
    lines,
    totals: totalsCheck(r),
    overbilled,
  };
}

/** Files the receipt's lines to the job's material costs (with the photos on the job's documents). */
export async function fileReceipt(id: string, projectId: string, actor: CostActor & { id: string }) {
  await guardCostEdit(projectId, actor);
  const data = await loadReceipt(id, projectId);
  if (!data?.receipt) throw new ReceiptError("This receipt couldn't be read. Enter it by hand on the job's costs.");
  if (data.scan.status === "FILED") throw new ReceiptError("This receipt is already filed.");
  const r = data.receipt;
  const missing = data.lines.map((l, i) => (l.amount == null ? i + 1 : null)).filter(Boolean);
  if (missing.length) throw new ReceiptError(`Line${missing.length > 1 ? "s" : ""} ${missing.join(", ")} have no amount printed. Enter this receipt by hand on the job's costs.`);
  if (r.invoiceNumber) {
    const dup = await prisma.receiptScan.findFirst({ where: { id: { not: id }, status: "FILED", invoiceNo: r.invoiceNumber, vendor: r.vendor } });
    if (dup) throw new ReceiptError(`Invoice ${r.invoiceNumber} was already filed from another scan.`);
  }
  const documentId = await attachReceiptDocs(data.scan.files as Saved[], r, projectId, actor.id);
  const rows: InvoiceRow[] = data.lines.map((l, i) => ({
    line: i + 1,
    invoice: r.invoiceNumber,
    date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    po: r.poNumber,
    itemNumber: l.itemNumber?.trim() || null,
    description: l.description,
    quantity: l.quantity,
    uom: l.uom?.trim().toUpperCase() || null,
    unitPrice: l.unitPrice,
    amount: l.amount!,
    formula: l.formula,
    tax: i === 0 ? r.tax : null,
  }));
  const res = await importInvoiceRows(projectId, rows, { vendor: r.vendor ?? "Supplier", documentId, source: "filed a scanned receipt:" }, actor);
  await prisma.receiptScan.update({ where: { id }, data: { status: "FILED", projectId, filedAt: new Date(), matchedBy: projectId === data.match?.projectId ? data.match.by : "picked by hand" } });
  return res;
}

// ---------- review & approve ----------

export type Outcome = "COST_ONLY" | "CHANGE_ORDER" | "INVOICE";
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Saves the markup choices (receipt-wide % and per-line overrides) so the review screen and approval agree. */
export async function setReceiptMarkup(id: string, markupPct: number | null, lineMarkup: Record<string, number>) {
  const bad = [markupPct, ...Object.values(lineMarkup)].some((m) => m != null && (!Number.isFinite(m) || m < 0 || m > 500));
  if (bad) throw new ReceiptError("Markup must be 0–500%.");
  await prisma.receiptScan.update({ where: { id }, data: { markupPct, lineMarkup } });
}

/**
 * Approve a receipt: file the real cost to the job, and (optionally) bill the customer for it as a change order
 * or an invoice at the marked-up price; then send both to QuickBooks when it's connected.
 */
export async function approveReceipt(
  id: string,
  input: { projectId: string; outcome: Outcome; markupPct: number | null; lineMarkup: Record<string, number>; reason: string | null },
  actor: { id: string; name: string; role: Role },
) {
  await guardCostEdit(input.projectId, actor);
  await setReceiptMarkup(id, input.markupPct, input.lineMarkup);
  const d = await loadReceipt(id, input.projectId);
  if (!d) throw new ReceiptError("This receipt hasn't been read yet.");
  if (d.scan.status === "FILED") throw new ReceiptError("This receipt is already approved.");
  const r = d.receipt;
  const vendor = r.vendor ?? "Supplier";
  const items = d.lines.map((l, i) => ({
    vendor,
    item: l.description,
    qty: l.quantity != null ? `${l.quantity} ${l.uom ?? ""}`.trim() : "",
    amount: d.pricing.lines[i].billed,
    cost: d.pricing.lines[i].cost,
  }));
  const names = items.map((x) => x.item);
  const summary = `Additional materials: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and more" : ""}`;
  const reason = input.reason?.trim() || d.scan.message?.trim() || null;

  const unpriced = d.lines.map((l, i) => (l.amount == null ? i + 1 : null)).filter(Boolean);
  if (unpriced.length && (input.outcome !== "COST_ONLY" || r.documentType !== "DELIVERY_TICKET"))
    throw new ReceiptError(`Line${unpriced.length > 1 ? "s" : ""} ${unpriced.join(", ")} ha${unpriced.length > 1 ? "ve" : "s"} no price (not printed, not on our sheets). Enter the unit price first.`);
  let coId: string | null = null;
  let invoiceId: string | null = null;
  if (input.outcome === "CHANGE_ORDER") {
    const { addChangeOrder } = await import("@/lib/costing/service");
    const co = await addChangeOrder(
      input.projectId,
      { kind: "CHANGE_ORDER", description: `${summary}${reason ? `\nReason: ${reason}` : ""}`, amount: d.pricing.billed, costImpact: d.pricing.cost, source: `Receipt ${r.invoiceNumber ?? ""} (${vendor}) from ${d.scan.employee ?? "staff"}`.replace("  ", " ") },
      actor,
    );
    await prisma.changeOrder.update({
      where: { id: co.id },
      data: { lines: items.map(({ vendor, item, qty, amount }) => ({ vendor, item, qty, amount })), priceFormula: `${usd(d.pricing.cost)} cost incl. tax, marked up = ${usd(d.pricing.billed)}` },
    });
    coId = co.id;
  } else if (input.outcome === "INVOICE") {
    const { createInvoice } = await import("@/lib/billing/service");
    const inv = await createInvoice(
      input.projectId,
      { kind: "OTHER", lines: items.map((x) => ({ description: `${x.vendor} — ${x.item}${x.qty ? ` (${x.qty})` : ""}`, amount: x.amount })), notes: reason, override: reason ?? `Materials from receipt ${r.invoiceNumber ?? ""}` },
      actor,
    );
    invoiceId = inv.id;
  }
  let filed: { count: number; total: number; flagged: number; skipped: number };
  try {
    if (r.documentType === "DELIVERY_TICKET") {
      // a delivery ticket isn't a bill: ABC's invoice brings the cost later, so nothing is filed to costs here
      const documentId = await attachReceiptDocs(d.scan.files as Saved[], r, input.projectId, actor.id);
      const refs = [r.poNumber, r.orderNumber, r.invoiceNumber].filter(Boolean).map((x) => x!.toUpperCase().replace(/[\s-]+/g, ""));
      const orders = await prisma.materialOrder.findMany({ where: { projectId: input.projectId }, select: { id: true, number: true, supplierOrderNumber: true } });
      const order = orders.find((o) => refs.includes(o.number.toUpperCase().replace(/[\s-]+/g, "")) || (o.supplierOrderNumber && refs.includes(o.supplierOrderNumber.toUpperCase().replace(/[\s-]+/g, ""))));
      if (order)
        await prisma.deliveryTicket.create({ data: { orderId: order.id, date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? new Date(`${r.date}T12:00:00Z`) : new Date(), ticketNumber: r.invoiceNumber ?? r.orderNumber, documentId, note: `From a scanned ticket (${d.lines.length} lines)`, receivedBy: d.scan.employee ?? actor.name } });
      await prisma.projectActivity.create({ data: { projectId: input.projectId, userId: actor.id, kind: "order", text: `${actor.name} recorded ${vendor} delivery ticket${r.poNumber ? ` (PO ${r.poNumber})` : ""}${order ? ` against ${order.number}` : ""} — ${d.lines.length} line(s); cost comes with ABC's invoice` } });
      await prisma.receiptScan.update({ where: { id }, data: { status: "FILED", projectId: input.projectId, filedAt: new Date(), matchedBy: input.projectId === d.match?.projectId ? d.match.by : "picked by hand" } });
      filed = { count: 0, total: 0, flagged: 0, skipped: 0 };
    } else filed = await fileReceipt(id, input.projectId, actor);
  } catch (e) {
    // don't leave a customer document behind for costs that didn't file
    if (coId) await prisma.changeOrder.delete({ where: { id: coId } });
    if (invoiceId) await prisma.invoice.delete({ where: { id: invoiceId } });
    throw e;
  }
  await prisma.receiptScan.update({ where: { id }, data: { outcome: input.outcome, changeOrderId: coId, invoiceId } });

  // QuickBooks (best effort; the result is shown on the receipt)
  let qboStatus: string | null = null;
  const { qboConnected, pushChangeOrderEstimate, pushReceiptExpense, syncInvoice } = await import("@/lib/integrations/quickbooks");
  if (await qboConnected()) {
    const done: string[] = [];
    try {
      if (coId) done.push(`Estimate ${await pushChangeOrderEstimate(coId, items.map((x) => ({ description: `${x.vendor} — ${x.item}`, amount: x.amount })))}`);
      if (invoiceId) done.push(`Invoice ${await syncInvoice(invoiceId)}`);
      if (r.documentType !== "DELIVERY_TICKET") done.push(
        `Expense ${await pushReceiptExpense({
          projectId: input.projectId,
          vendor,
          date: r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
          reference: r.invoiceNumber,
          lines: [...d.lines.map((l) => ({ description: l.description, amount: l.amount ?? 0 })), ...(r.tax ? [{ description: "Sales tax", amount: r.tax }] : [])],
        })}`,
      );
      qboStatus = `Sent to QuickBooks: ${done.join(" · ")}`;
    } catch (e) {
      qboStatus = `${done.length ? `Sent: ${done.join(" · ")}. ` : ""}QuickBooks error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else qboStatus = "QuickBooks isn't connected — nothing was sent.";
  await prisma.receiptScan.update({ where: { id }, data: { qboStatus } });
  return { ...filed, changeOrderId: coId, invoiceId, qboStatus };
}

/** Puts the receipt/ticket photos on the job's Documents; returns the first document's id. */
async function attachReceiptDocs(files: Saved[], r: Receipt, projectId: string, userId: string) {
  let documentId: string | null = null;
  const label = r.documentType === "DELIVERY_TICKET" ? "Delivery ticket" : `${r.vendor ?? "Supplier"} receipt`;
  for (const [i, f] of files.entries()) {
    const { doc } = await addDocument({
      projectId,
      bytes: new Uint8Array(await readUpload(f.url)),
      fileName: `${label} ${r.invoiceNumber ?? r.poNumber ?? ""} ${r.date ?? ""}${files.length > 1 ? ` p${i + 1}` : ""}.${f.type === "application/pdf" ? "pdf" : "jpg"}`.replace(/\s+/g, " ").trim(),
      contentType: f.type,
      userId,
    });
    documentId ??= doc.id;
  }
  return documentId;
}

/** Office-entered unit prices for lines with no printed price and none on our sheets. */
export async function setLinePrices(id: string, prices: Record<string, number | null>, actor: { name: string; role: string }) {
  if (actor.role === "VIEWER") throw new ReceiptError("Viewers can't enter prices.");
  const scan = await prisma.receiptScan.findUniqueOrThrow({ where: { id } });
  if (scan.status === "FILED") throw new ReceiptError("This receipt is already approved.");
  const cur = { ...((scan.linePrice as Record<string, number> | null) ?? {}) };
  for (const [k, v] of Object.entries(prices)) {
    if (v == null) delete cur[k];
    else if (!Number.isFinite(v) || v < 0) throw new ReceiptError("Prices must be numbers, zero or more.");
    else cur[k] = Math.round(v * 100) / 100;
  }
  await prisma.receiptScan.update({ where: { id }, data: { linePrice: cur } });
}

/** The office's crop/rotation for one page ("auto" = find the paper again, "none" = whole photo), then read again. */
export async function recropAndReread(id: string, page: number, input: { crop: Crop | "auto" | "none"; rotate: Rotate }, actor: { role: string }) {
  if (actor.role === "VIEWER") throw new ReceiptError("Viewers can't change receipts.");
  const scan = await prisma.receiptScan.findUniqueOrThrow({ where: { id } });
  if (scan.status === "FILED") throw new ReceiptError("This receipt is already approved.");
  const files = [...(scan.files as Saved[])];
  const f = files[page];
  if (!f || f.type === "application/pdf") throw new ReceiptError("That page can't be cropped.");
  const ok = (c: Crop) => [c.x, c.y, c.w, c.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && c.w > 0.05 && c.h > 0.05 && c.x + c.w <= 1.001 && c.y + c.h <= 1.001;
  if (typeof input.crop === "object" && !ok(input.crop)) throw new ReceiptError("Draw a bigger box around the receipt.");
  const rotate = ([0, 90, 180, 270].includes(input.rotate) ? input.rotate : 0) as Rotate;
  const auto = input.crop === "auto" || rotate !== (f.rotate ?? 0) ? await detectPaper(new Uint8Array(await readUpload(f.url)), rotate).catch(() => null) : f.auto;
  files[page] = { ...f, rotate, auto, crop: input.crop === "auto" ? null : input.crop };
  // lines may come back different, so typed prices and per-line markups start over
  await prisma.receiptScan.update({ where: { id }, data: { files, status: "READING", linePrice: {}, lineMarkup: {} } });
  await readReceipt(id);
}
