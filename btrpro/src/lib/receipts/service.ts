// ABC (or any supplier) receipt photos: the AI transcribes what's printed, then the app matches the job,
// checks the math, compares every line with the price sheets (the builder's own pricing on builder jobs),
// and files the lines to the job's material costs.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { readUpload, saveUpload } from "@/lib/storage";
import { aiParse } from "@/lib/ai/claude";
import { sniff } from "@/lib/portal/crew";
import { MAX_PHOTO_BYTES, resized } from "@/lib/photos/images";
import { priceScopeFor, STANDARD_SCOPE } from "@/lib/pricing-scope";
import { addDocument } from "@/lib/docs/documents";
import { guardCostEdit, importInvoiceRows, type CostActor } from "@/lib/costing/service";
import type { InvoiceRow } from "@/lib/costing/invoice-csv";
import { lineAmount, matchReceiptJob, priceCheckLine, totalsCheck, type Receipt, type SheetPrice } from "./check";

export class ReceiptError extends Error {}
export const MAX_RECEIPT_FILES = 6;

const num = z.number().nullable();
const str = z.string().nullable();
export const ReceiptSchema = z.object({
  vendor: str.describe("Supplier name as printed, e.g. ABC Supply Co."),
  branch: str.describe("Branch name/number as printed"),
  invoiceNumber: str.describe("Invoice or receipt number as printed"),
  orderNumber: str.describe("Supplier's order/sales order number as printed"),
  poNumber: str.describe("Customer PO / PO # / Job PO field exactly as printed (often our job name or PO number)"),
  jobName: str.describe("Job name / job reference field as printed, if separate from the PO"),
  shipToName: str.describe("Ship-to / deliver-to name as printed"),
  shipToAddress: str.describe("Ship-to / delivery / job-site street address as printed (not the branch or bill-to address)"),
  date: str.describe("Invoice/receipt date as YYYY-MM-DD, only if printed"),
  lines: z.array(
    z.object({
      itemNumber: str.describe("Supplier item/product number exactly as printed, keeping leading zeros; null if none"),
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

const TASK = `Transcribe a photographed supplier receipt/invoice (usually ABC Supply) into the schema.
Copy only what is printed. Never calculate, total, infer, or fill in a value that isn't printed — use null when a field isn't printed or isn't legible, and add a note.
Item numbers, units of measure and prices must be exactly as printed (keep leading zeros, no unit conversions). Money as plain numbers without $ or commas.
If several photos are pages of the same receipt, combine them in order without repeating lines. List every line item, including returns, freight, delivery and fees.`;

type Saved = { url: string; type: string };

/** Saves the photos/PDF and asks the AI to transcribe them. */
export async function scanReceipt(files: { bytes: Uint8Array; name: string }[], actor: { id: string; name: string }) {
  const real = files.filter((f) => f.bytes.length);
  if (!real.length) throw new ReceiptError("Take or choose a photo of the receipt.");
  if (real.length > MAX_RECEIPT_FILES) throw new ReceiptError(`Up to ${MAX_RECEIPT_FILES} photos per receipt.`);
  const saved: Saved[] = [];
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of real) {
    if (f.bytes.length > MAX_PHOTO_BYTES) throw new ReceiptError(`${f.name} is over 20 MB.`);
    const kind = sniff(f.bytes);
    if (!kind) throw new ReceiptError(`${f.name} isn't a photo or PDF.`);
    if (kind === "pdf") {
      saved.push({ url: await saveUpload(f.bytes, "receipt.pdf", "receipts"), type: "application/pdf" });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(f.bytes).toString("base64") } });
    } else {
      // a sharp, upright JPEG the AI can read (phone photos are too big and often sideways)
      const jpg = await resized(f.bytes, 2400, 88);
      if (!jpg) throw new ReceiptError(`Couldn't open ${f.name}. On iPhone, set Camera → Formats → Most Compatible, or take a screenshot of the photo.`);
      saved.push({ url: await saveUpload(jpg, "receipt.jpg", "receipts"), type: "image/jpeg" });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpg.toString("base64") } });
    }
  }
  content.push({ type: "text", text: `${real.length} photo${real.length === 1 ? "" : "s"} of one receipt. Transcribe it.` });
  const scan = await prisma.receiptScan.create({ data: { files: saved, status: "READ", createdById: actor.id } });
  try {
    const { data } = await aiParse({ task: TASK, schema: ReceiptSchema, effort: "medium", messages: [{ role: "user", content }] });
    await prisma.receiptScan.update({ where: { id: scan.id }, data: { extracted: data, invoiceNo: data.invoiceNumber, vendor: data.vendor } });
  } catch (e) {
    await prisma.receiptScan.update({ where: { id: scan.id }, data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) } });
  }
  return scan.id;
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
  const scan = await prisma.receiptScan.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, address: true } } } });
  if (!scan) return null;
  const r = scan.extracted as Receipt | null;
  if (!r) return { scan, receipt: null, match: null, candidates: [], projectId: null, scope: STANDARD_SCOPE, lines: [], totals: null, overbilled: 0 };
  const [jobs, orders] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true, address: true, status: true, acculynxJobNumber: true, clientCompany: { select: { name: true } } } }),
    prisma.materialOrder.findMany({ select: { projectId: true, number: true, supplierOrderNumber: true } }),
  ]);
  const { match, candidates } = matchReceiptJob(
    r,
    jobs.map((j) => ({ ...j, clientName: j.clientCompany?.name ?? null })),
    orders,
  );
  const projectId = chosenProjectId ?? scan.projectId ?? match?.projectId ?? null;
  const scope = projectId ? await priceScopeFor(projectId) : STANDARD_SCOPE;
  const sheets = await sheetRowsFor(
    r.lines.map((l) => l.itemNumber ?? ""),
    scope.builderId,
  );
  const lines = r.lines.map((l) => ({ ...l, ...lineAmount(l), check: priceCheckLine(l, l.itemNumber ? (sheets.get(l.itemNumber.trim()) ?? []) : [], scope) }));
  const overbilled = Math.round(lines.reduce((a, l) => a + (l.check.status === "OVER" && l.check.diffTotal ? l.check.diffTotal : 0), 0) * 100) / 100;
  const jobName = (id: string) => jobs.find((j) => j.id === id);
  return {
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
  let documentId: string | null = null;
  const files = data.scan.files as Saved[];
  for (const [i, f] of files.entries()) {
    const { doc } = await addDocument({
      projectId,
      bytes: new Uint8Array(await readUpload(f.url)),
      fileName: `${r.vendor ?? "Supplier"} receipt ${r.invoiceNumber ?? r.date ?? ""}${files.length > 1 ? ` p${i + 1}` : ""}.${f.type === "application/pdf" ? "pdf" : "jpg"}`.replace(/\s+/g, " "),
      contentType: f.type,
      userId: actor.id,
    });
    documentId ??= doc.id;
  }
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
