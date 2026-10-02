// BTRbot contract review: reads a GC subcontract / owner contract on the job and flags the clauses that move
// risk onto BTR — pay-if-paid, liquidated damages, broad indemnity, no-damage-for-delay, short notice windows,
// retainage, warranty, insurance — quoting the contract word for word. It's a checklist for whoever signs,
// not legal advice; anything marked HIGH goes to the owner (and the attorney) before signing.
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiParse } from "@/lib/ai/claude";
import { readUpload } from "@/lib/storage";

export class ContractReviewError extends Error {}

export const CLAUSES = {
  PAY_IF_PAID: "Pay-if-paid / pay-when-paid",
  LIQUIDATED_DAMAGES: "Liquidated damages",
  INDEMNITY: "Indemnification",
  NO_DAMAGE_FOR_DELAY: "No damage for delay",
  NOTICE_DEADLINES: "Claim / change-order notice deadlines",
  RETAINAGE: "Retainage",
  WARRANTY: "Warranty",
  INSURANCE: "Insurance requirements",
  BACKCHARGES: "Backcharges / set-off",
  TERMINATION: "Termination",
  LIEN_WAIVERS: "Lien waivers / lien rights",
  SCHEDULE: "Schedule / acceleration",
  DISPUTES: "Disputes / venue / attorney fees",
  SCOPE: "Scope gaps (work by others, 'complete system' language)",
  OTHER: "Other",
} as const;

const Finding = z.object({
  clause: z.enum(Object.keys(CLAUSES) as [keyof typeof CLAUSES, ...(keyof typeof CLAUSES)[]]),
  risk: z.enum(["HIGH", "MEDIUM", "LOW"]),
  quote: z.string().describe("the contract's exact words, copied verbatim (shorten with … only)"),
  where: z.string().nullable().describe("section number or page, as printed"),
  plain: z.string().describe("what it means for BTR in one or two plain sentences"),
  ask: z.string().nullable().describe("the change to request before signing, if any"),
});
const Review = z.object({
  summary: z.string().describe("two or three sentences: overall risk and the one or two things to fix first"),
  terms: z.object({
    contract_sum: z.string().nullable(),
    retainage: z.string().nullable(),
    payment_terms: z.string().nullable(),
    warranty: z.string().nullable(),
    liquidated_damages: z.string().nullable(),
    insurance: z.string().nullable(),
    change_order_notice: z.string().nullable(),
  }),
  findings: z.array(Finding),
  missing: z.array(z.string()).describe("protections a subcontractor would normally expect that this contract does not contain (e.g. no right to stop work for non-payment)"),
});
export type ContractFindings = z.infer<typeof Review>;

export async function reviewContract(documentId: string, actor: { id: string | null; name: string }) {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const text = doc.extractedText?.trim();
  const isPdf = doc.contentType === "application/pdf" || /\.pdf$/i.test(doc.fileName);
  if (!text && !isPdf) throw new ContractReviewError("BTRbot can read PDF contracts. Upload the contract as a PDF.");
  const content: Parameters<typeof aiParse>[0]["messages"][number]["content"] = text
    ? [{ type: "text", text: `Contract file: ${doc.fileName}\n\n${text.slice(0, 180_000)}` }]
    : [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: (await readUpload(doc.fileUrl)).toString("base64") } },
        { type: "text", text: `Contract file: ${doc.fileName}` },
      ];
  const { data } = await aiParse({
    task: [
      "TASK: review this construction contract or subcontract for BTR Contracting (the roofing/siding subcontractor or contractor signing it).",
      "Find every clause that shifts risk or money onto BTR. Quote the contract's exact words — never paraphrase inside `quote`, never invent a clause. If a topic isn't in the contract, don't make a finding for it; list important missing protections in `missing` instead.",
      "Risk: HIGH = could cost BTR payment, uninsured liability, or open-ended damages (pay-if-paid, broad-form indemnity incl. GC's own negligence, uncapped LDs, no-damage-for-delay, very short claim notice, waiver of lien rights before payment). MEDIUM = costly but bounded. LOW = normal but worth knowing.",
      "`ask` is the practical change to request (e.g. 'change pay-if-paid to pay-when-paid with a 45-day outside date', 'cap LDs at the amount assessed against the GC for BTR-caused delay').",
      "This is a checklist for whoever signs, not legal advice.",
    ].join("\n"),
    schema: Review,
    effort: "high",
    maxTokens: 16000,
    messages: [{ role: "user", content }],
  });
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  data.findings.sort((a, b) => order[a.risk] - order[b.risk]);
  const row = await prisma.contractReview.create({
    data: { projectId: doc.projectId, documentId: doc.id, summary: data.summary, terms: data.terms, findings: data.findings, missing: data.missing, createdBy: actor.name },
  });
  await prisma.projectActivity.create({
    data: { projectId: doc.projectId, userId: actor.id, kind: "document", text: `${actor.name} ran a BTRbot contract review on "${doc.fileName}" — ${data.findings.filter((f) => f.risk === "HIGH").length} high-risk clause(s)` },
  });
  return row;
}
