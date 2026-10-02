// Old proposals moved over from Drive (PDFs and Google Sheets) reprinted in BTR's current proposal layout.
// BTRbot only READS the old proposal into fields — every description, amount and total is copied exactly as
// written (nothing priced or recalculated). The original stays on the job; the new PDF is added beside it.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiParse } from "@/lib/ai/claude";
import { readUpload } from "@/lib/storage";
import { readXlsx } from "@/lib/import/xlsx";
import { addDocument } from "@/lib/docs/documents";
import { renderProposal } from "./pdf";

export class LegacyProposalError extends Error {}

/** Drive files that look like BTR's own proposals (not supplier quotes or sub bids). */
export const isOldProposal = (fileName: string) => /proposal/i.test(fileName) && !/sub|supplier|quote request|\(BTRpro format\)/i.test(fileName);

const money = z.number().nullable().describe("as printed, in dollars; null if not on the proposal");
const Read = z.object({
  title: z.string().describe("the proposal's title as written (e.g. 'Siding Proposal', 'Apartment 153 Budget Siding')"),
  date: z.string().nullable().describe("the proposal date as written, YYYY-MM-DD if it can be read"),
  customer: z.string().nullable(),
  job_name: z.string().nullable(),
  address: z.string().nullable(),
  rep_name: z.string().nullable(),
  rep_email: z.string().nullable(),
  rep_phone: z.string().nullable(),
  sections: z.array(z.object({ title: z.string(), items: z.array(z.object({ text: z.string(), sub: z.array(z.string()) })) })).describe("the work, grouped as the proposal groups it; item text copied word for word"),
  subtotal: money,
  tax: money,
  total: money,
  extra_rows: z.array(z.object({ label: z.string(), amount: z.string() })).describe("any other priced lines shown near the total (alternates, options, allowances), amounts as written"),
  we_will: z.array(z.string()),
  we_will_not: z.array(z.string()).describe("exclusions"),
  terms: z.string().describe("terms/conditions/notes text, word for word; empty if none"),
});

async function documentText(doc: { fileUrl: string; fileName: string; extractedText: string | null; contentType: string | null }) {
  if (doc.extractedText?.trim()) return doc.extractedText;
  if (/\.xlsx$/i.test(doc.fileName) || doc.contentType?.includes("spreadsheetml")) {
    const tabs = await readXlsx(new Uint8Array(await readUpload(doc.fileUrl)));
    return tabs.map((t) => `=== ${t.name}\n${t.rows.map((r) => r.map((c) => c ?? "").join("\t").replace(/\t+$/, "")).filter(Boolean).join("\n")}`).join("\n\n");
  }
  throw new LegacyProposalError("Couldn't read text from this file (scanned image?). Open it and rebuild the proposal in BTRpro.");
}

/** Reads an old proposal and adds a copy in the BTRpro layout to the same job. */
export async function convertOldProposal(documentId: string, actor: { id: string | null }) {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const existing = await prisma.document.findFirst({ where: { projectId: doc.projectId, externalId: `converted:${doc.id}` } });
  if (existing) return { documentId: existing.id, duplicate: true };
  const text = (await documentText(doc)).slice(0, 60_000);
  const { data } = await aiParse({
    task: [
      "TASK: read this old BTR Contracting proposal into fields so it can be reprinted in BTR's current proposal layout.",
      "Copy every item description, amount, subtotal, tax and total EXACTLY as written. Never calculate, round, re-price or add anything. If a value isn't on the proposal, leave it null/empty.",
      "Keep the proposal's own grouping (sections like Siding, Roofing, Gutters); a proposal with no groups is one section titled 'Scope of Work'.",
      "Spreadsheet exports may include helper columns and internal cost tabs — use only what the customer-facing proposal shows.",
    ].join("\n"),
    schema: Read,
    effort: "medium",
    maxTokens: 12000,
    messages: [{ role: "user", content: [{ type: "text", text: `File: ${doc.fileName}\n\n${text}` }] }],
  });
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const project = await prisma.project.findUnique({ where: { id: doc.projectId }, select: { name: true, address: true } });
  // a bare YYYY-MM-DD is read at noon UTC so it prints as the same day in Omaha
  const parsed = data.date ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(data.date) ? `${data.date}T12:00:00Z` : data.date) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : doc.uploadedAt;
  const bytes = await renderProposal({
    title: data.title,
    date,
    number: null,
    validUntil: null,
    rep: data.rep_name ? { name: data.rep_name, email: data.rep_email ?? "", phone: data.rep_phone } : null,
    jobName: data.job_name ?? project?.name ?? data.title,
    who: data.customer,
    address: data.address ?? project?.address ?? null,
    sections: data.sections.length ? data.sections : [{ title: "Scope of Work", items: [] }],
    subtotal: data.subtotal,
    tax: data.tax,
    extraRows: data.extra_rows.map((r) => [r.label, r.amount]),
    total: data.total,
    depositPct: null,
    options: [],
    weWill: data.we_will,
    weWillNot: data.we_will_not,
    terms: data.terms,
    signed: null,
    footerId: data.total != null ? usd(data.total) : "proposal",
  });
  const base = doc.fileName.replace(/\.(pdf|xlsx|docx?)$/i, "");
  const added = await addDocument({ projectId: doc.projectId, bytes, fileName: `${base} (BTRpro format).pdf`, contentType: "application/pdf", source: "UPLOAD", externalId: `converted:${doc.id}`, userId: actor.id });
  return { documentId: added.doc.id, duplicate: false };
}
