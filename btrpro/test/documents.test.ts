import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addDocument } from "@/lib/docs/documents";
import { guessDocType } from "@/lib/docs/classify";
import { extractEagleView, extractPlansSpecs } from "@/lib/docs/extraction";
import { addManualMeasurement, confirmMeasurement, decideFact, rejectMeasurement } from "@/lib/docs/confirm";
import { parseDriveLink } from "@/lib/integrations/drive";
import { setAiClientForTests } from "@/lib/ai/claude";

process.env.UPLOAD_DIR = "prisma/test-uploads";
afterAll(() => {
  setAiClientForTests(null);
  return prisma.$disconnect();
});

const pdf = readFileSync(new URL("fixtures/TEST_ONLY_steep_slope.pdf", import.meta.url)); // 1-page real PDF
const actor = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name };
};
const fakeParse = (parsed: unknown) => {
  const seen: Record<string, unknown>[] = [];
  setAiClientForTests({
    beta: { messages: { parse: async (b: Record<string, unknown>) => (seen.push(b), { stop_reason: "end_turn", model: "fake", parsed_output: parsed }) } },
  } as never);
  return seen;
};

describe("document intake", () => {
  it("guesses document types", () => {
    expect(guessDocType("Smith EagleView Premium.pdf", "")).toBe("EAGLEVIEW");
    expect(guessDocType("x.pdf", "SECTION 07 54 23 THERMOPLASTIC POLYOLEFIN ROOFING PART 1 - GENERAL")).toBe("SPECS");
    expect(guessDocType("A-501 Roof Plan.pdf", "")).toBe("PLANS");
    expect(guessDocType("IMG_2231.HEIC", "", null)).toBe("PHOTO");
    expect(guessDocType("PCO 14 - added crickets.pdf", "")).toBe("CHANGE_ORDER");
  });

  it("parses Google Drive links", () => {
    expect(parseDriveLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_qrs/view?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp_qrs");
    expect(parseDriveLink("https://drive.google.com/drive/folders/0B1234567890abcdefXYZ")).toBe("0B1234567890abcdefXYZ");
    expect(parseDriveLink("https://docs.google.com/document/d/1xYz-ABCDEFGHIJKLMNOP/edit")).toBe("1xYz-ABCDEFGHIJKLMNOP");
    expect(parseDriveLink("not a link")).toBeNull();
  });

  it("stores a PDF with its page count and text, and skips duplicates by external id", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Docs job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
    const { doc } = await addDocument({ projectId: p.id, bytes: pdf, fileName: "report.pdf", externalId: "drive:x1", userId: a.id });
    expect(doc.pages).toBe(1);
    expect(doc.extractedText).toContain("0150080011");
    const again = await addDocument({ projectId: p.id, bytes: pdf, fileName: "report.pdf", externalId: "drive:x1", userId: a.id });
    expect(again.duplicate).toBe(true);
  });
});

describe("EagleView extraction and confirmation", () => {
  it("keeps only values with a valid page and quote, then confirmed values fill intake", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY EV job", scopes: ["STEEP"], constructionType: "REROOF", isPublic: false, isTaxExempt: false }, a);
    const { doc } = await addDocument({ projectId: p.id, bytes: pdf, fileName: "TEST_ONLY EagleView.pdf", userId: a.id });
    const seen = fakeParse({
      measurements: [
        { key: "roof_total_sf", value: 3240, unit: "SF", facet: null, page: 1, quote: "Total Roof Area = 3,240 sq ft" },
        { key: "hips_lf", value: 95, unit: "LF", facet: null, page: 1, quote: "Hips = 95 ft" },
        { key: "ridges_lf", value: 40, unit: "LF", facet: null, page: 99, quote: "Ridges = 40 ft" }, // page doesn't exist
        { key: "eaves_lf", value: 180, unit: "LF", facet: null, page: 1, quote: "" }, // no quote
      ],
      notes: [],
    });
    const r = await extractEagleView(doc.id);
    expect(r.kept).toBe(2);
    expect(r.dropped).toHaveLength(2);
    // the PDF itself was sent as a document block, with CLAUDE.md as the system prompt
    const msg = (seen[0] as { messages: { content: { type: string }[] }[]; system: { text: string }[] }).messages[0].content;
    expect(msg[0].type).toBe("document");
    expect((seen[0] as { system: { text: string }[] }).system[0].text).toContain("Never guess, invent, or fabricate");

    const pending = await prisma.measurement.findMany({ where: { projectId: p.id, status: "EXTRACTED_PENDING" } });
    const area = pending.find((m) => m.key === "roof_total_sf")!;
    // Nothing counts until confirmed.
    let intake = await prisma.intakeField.findUniqueOrThrow({ where: { projectId_key: { projectId: p.id, key: "roof_area" } } });
    expect(intake.status).toBe("MISSING");

    await confirmMeasurement(area.id, a, 3245);
    const confirmed = await prisma.measurement.findUniqueOrThrow({ where: { id: area.id } });
    expect(confirmed).toMatchObject({ status: "CONFIRMED", value: 3245, extractedValue: 3240 });
    intake = await prisma.intakeField.findUniqueOrThrow({ where: { projectId_key: { projectId: p.id, key: "roof_area" } } });
    expect(intake).toMatchObject({ status: "VERIFIED", value: "3245", note: "TEST_ONLY EagleView.pdf p.1" });

    const hips = pending.find((m) => m.key === "hips_lf")!;
    await rejectMeasurement(hips.id, a, "Includes garage");
    expect((await prisma.measurement.findUniqueOrThrow({ where: { id: hips.id } })).status).toBe("REJECTED");
    await expect(confirmMeasurement(hips.id, a)).rejects.toThrow(/Only pending/);
  });

  it("manual measurements need a source", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Manual", scopes: ["SIDING"], isPublic: false, isTaxExempt: false }, a);
    await expect(addManualMeasurement(p.id, { key: "siding_sf", value: 2400, facet: null, source: " " }, a)).rejects.toThrow(/where the number came from/);
    await addManualMeasurement(p.id, { key: "wall_heights", value: 18, facet: "North", source: "A-201" }, a);
    const f = await prisma.intakeField.findUniqueOrThrow({ where: { projectId_key: { projectId: p.id, key: "wall_heights" } } });
    expect(f).toMatchObject({ status: "VERIFIED", value: "North: 18 FT" });
  });
});

describe("plans/specs extraction", () => {
  it("ROOF-01: rejects a roof area taken from a floor-plan schedule", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Plans job", scopes: ["LOW_SLOPE"], isPublic: false, isTaxExempt: false }, a);
    const { doc } = await addDocument({ projectId: p.id, bytes: pdf, fileName: "TEST_ONLY A-001.pdf", userId: a.id });
    fakeParse({
      facts: [{ key: "roof_system_type", value: "60 mil TPO, mechanically attached", page: 1, quote: "60 MIL TPO MECH. ATTACHED" }],
      roofArea: { valueSf: 48600, page: 1, quote: "TOTAL GROSS AREA 48,600 SF", source: "FLOOR_PLAN_SCHEDULE", sheet: "A-001" },
    });
    const r = await extractPlansSpecs(doc.id);
    expect(r.notes.join(" ")).toMatch(/ROOF-01/);
    const ms = await prisma.measurement.findMany({ where: { projectId: p.id, key: "roof_total_sf" } });
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ status: "REJECTED", confirmedBy: "ROOF-01" });

    const fact = await prisma.extractedFact.findFirstOrThrow({ where: { projectId: p.id } });
    await decideFact(fact.id, a, true);
    const f = await prisma.intakeField.findUniqueOrThrow({ where: { projectId_key: { projectId: p.id, key: "roof_system_type" } } });
    expect(f).toMatchObject({ status: "VERIFIED", value: "60 mil TPO, mechanically attached", note: "TEST_ONLY A-001.pdf p.1" });
  });

  it("queues a roof-plan area for confirmation", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Plans job 2", scopes: ["LOW_SLOPE"], isPublic: false, isTaxExempt: false }, a);
    const { doc } = await addDocument({ projectId: p.id, bytes: pdf, fileName: "TEST_ONLY A-501.pdf", userId: a.id });
    fakeParse({ facts: [], roofArea: { valueSf: 22400, page: 1, quote: "ROOF AREA: 22,400 SF", source: "ROOF_PLAN", sheet: "A-501" } });
    await extractPlansSpecs(doc.id);
    const m = await prisma.measurement.findFirstOrThrow({ where: { projectId: p.id, key: "roof_total_sf" } });
    expect(m).toMatchObject({ status: "EXTRACTED_PENDING", value: 22400, note: "Roof plan sheet A-501" });
  });
});
