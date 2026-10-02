// TEST_ONLY BTRbot contract review: high-risk clauses sorted first, quotes kept, review saved on the job.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { addDocument } from "@/lib/docs/documents";
import { reviewContract } from "@/lib/docs/contract-review";

afterAll(async () => {
  setAiClientForTests(null);
  const p = await prisma.project.findMany({ where: { name: "TEST_ONLY Contract job" }, select: { id: true } });
  await prisma.contractReview.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.document.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.project.deleteMany({ where: { name: "TEST_ONLY Contract job" } });
});

describe("contract review", () => {
  it("saves the review with HIGH findings first", async () => {
    const job = await prisma.project.create({ data: { name: "TEST_ONLY Contract job", market: "COMMERCIAL" } });
    const { doc } = await addDocument({ projectId: job.id, bytes: new TextEncoder().encode("x"), fileName: "TEST_ONLY Subcontract.pdf", contentType: "application/pdf" });
    await prisma.document.update({ where: { id: doc.id }, data: { extractedText: "TEST_ONLY Contractor shall pay Subcontractor only if paid by Owner." } });
    const seen: unknown[] = [];
    setAiClientForTests({
      beta: {
        messages: {
          parse: async (b: unknown) => (
            seen.push(b),
            {
              stop_reason: "end_turn",
              model: "fake",
              parsed_output: {
                summary: "TEST_ONLY pay-if-paid is the big one.",
                terms: { contract_sum: "$100,000", retainage: "10%", payment_terms: null, warranty: "2 years", liquidated_damages: null, insurance: null, change_order_notice: "7 days" },
                findings: [
                  { clause: "WARRANTY", risk: "LOW", quote: "two (2) years", where: "§12", plain: "Normal.", ask: null },
                  { clause: "PAY_IF_PAID", risk: "HIGH", quote: "only if paid by Owner", where: "§5.2", plain: "If the owner never pays, BTR never gets paid.", ask: "Change to pay-when-paid with a 45-day outside date." },
                ],
                missing: ["Right to stop work for non-payment"],
              },
            }
          ),
        },
      },
    } as never);
    const r = await reviewContract(doc.id, { id: null, name: "TEST_ONLY" });
    const findings = r.findings as { clause: string; risk: string }[];
    expect(findings.map((f) => f.risk)).toEqual(["HIGH", "LOW"]);
    expect(JSON.stringify(seen[0])).toMatch(/exact words/);
    expect(await prisma.contractReview.count({ where: { projectId: job.id } })).toBe(1);
  });
});
