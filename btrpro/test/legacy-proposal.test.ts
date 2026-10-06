// TEST_ONLY old Drive proposal → reprinted in the BTRpro layout, amounts copied as written, once per original.
import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { setAiClientForTests } from "@/lib/ai/claude";
import { addDocument } from "@/lib/docs/documents";
import { convertOldProposal, isOldProposal } from "@/lib/proposals/legacy";
import { readUpload } from "@/lib/storage";

afterAll(async () => {
  setAiClientForTests(null);
  const p = await prisma.project.findMany({ where: { name: "TEST_ONLY Legacy job" }, select: { id: true } });
  await prisma.document.deleteMany({ where: { projectId: { in: p.map((x) => x.id) } } });
  await prisma.project.deleteMany({ where: { name: "TEST_ONLY Legacy job" } });
});

describe("old proposal reprint", () => {
  it("knows our proposals from sub quotes", () => {
    expect(isOldProposal("Estimating › Proposals › Apt Budget Siding Proposal 9.16.26.pdf")).toBe(true);
    expect(isOldProposal("Estimating › Material Quotes › ABC quote.pdf")).toBe(false);
    expect(isOldProposal("X Proposal (BTRpro format).pdf")).toBe(false);
  });

  it("reads the old proposal and adds a BTRpro-layout PDF beside it", async () => {
    const job = await prisma.project.create({ data: { name: "TEST_ONLY Legacy job", market: "COMMERCIAL" } });
    const { doc } = await addDocument({ projectId: job.id, bytes: new TextEncoder().encode("x"), fileName: "Estimating › Proposals › TEST_ONLY Proposal.pdf", source: "DRIVE", externalId: "drive:TEST_ONLY" });
    await prisma.document.update({ where: { id: doc.id }, data: { extractedText: "TEST_ONLY Siding Proposal ... Total $76,857.15" } });
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
                title: "TEST_ONLY Budget Siding Proposal",
                date: "2026-09-16",
                customer: "TEST_ONLY GC",
                job_name: null,
                address: "1 Test St, Omaha, NE",
                rep_name: "TEST_ONLY Rep",
                rep_email: "rep@example.com",
                rep_phone: null,
                sections: [{ title: "Siding Section", items: [{ text: "Install 7-1/4\" Hardie lap, primed", sub: ["Housewrap", "Trim at corners"] }] }],
                subtotal: 76857.15,
                tax: null,
                total: 76857.15,
                extra_rows: [{ label: "Alternate: prefinished", amount: "+ $4,200.00" }],
                we_will: ["Install siding per plans"],
                we_will_not: ["Paint"],
                terms: "TEST_ONLY terms",
              },
            }
          ),
        },
      },
    } as never);
    const r = await convertOldProposal(doc.id, { id: null });
    expect(r.duplicate).toBe(false);
    const out = await prisma.document.findUniqueOrThrow({ where: { id: r.documentId } });
    expect(out.fileName).toBe("Estimating › Proposals › TEST_ONLY Proposal (BTRpro format).pdf");
    const pdf = await readUpload(out.fileUrl);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    if (process.env.TEST_ONLY_SAVE_PDF) writeFileSync(process.env.TEST_ONLY_SAVE_PDF, pdf);
    // the instructions forbid re-pricing
    expect(JSON.stringify(seen[0])).toMatch(/EXACTLY as written/);
    // second click doesn't make another copy
    expect((await convertOldProposal(doc.id, { id: null })).duplicate).toBe(true);
  });
});
