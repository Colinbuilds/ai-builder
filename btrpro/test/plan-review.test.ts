import { afterAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addDocument } from "@/lib/docs/documents";
import {
  choosePages,
  parsePageRanges,
  scorePages,
  subsetPdf,
} from "@/lib/docs/plan-pages";
import {
  originalPage,
  runPlanReview,
  briefSuggestions,
  type PlanBrief,
} from "@/lib/docs/plan-review";
import { suggestTemplates } from "@/lib/estimates/template-match";
import { listTemplates } from "@/lib/estimates/templates";
import { setAiClientForTests } from "@/lib/ai/claude";

process.env.UPLOAD_DIR = "prisma/test-uploads";
afterAll(() => {
  setAiClientForTests(null);
  return prisma.$disconnect();
});

const actor = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name };
};

// TEST_ONLY plan set: 120 pages, only a few matter to a roofing/exterior bid.
async function planSet(pages: number, special: Record<number, string>) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(
      special[i] ?? `SHEET E-${i} ELECTRICAL LIGHTING PLAN PANEL SCHEDULE`,
      { x: 40, y: 700, size: 10, font },
    );
  }
  return pdf.save();
}

const emptyBrief = (): PlanBrief => ({
  summary: "TEST_ONLY",
  projectDescription: null,
  sheetIndex: [],
  roofSystems: [],
  pitches: [],
  scopeItems: [],
  requirements: [],
  facts: [],
  roofArea: null,
  byOthers: [],
  alternates: [],
  conflicts: [],
  rfis: [],
});

describe("plan page finder", () => {
  it("scores roofing/exterior pages above other trades", () => {
    const s = scorePages([
      "A-201 EXTERIOR ELEVATIONS  FIBER CEMENT LAP SIDING  6:12",
      "E-101 ELECTRICAL LIGHTING PLAN",
      "SECTION 07 31 13 ASPHALT SHINGLES",
    ]);
    expect(s[0].score).toBeGreaterThan(0);
    expect(s[1].score).toBeLessThan(0);
    expect(s[2].score).toBeGreaterThan(0);
  });

  it("parses page ranges and rejects bad ones", () => {
    expect(parsePageRanges("1-3, 12 40-41", 50)).toEqual([1, 2, 3, 12, 40, 41]);
    expect(() => parsePageRanges("5-2", 50)).toThrow();
    expect(() => parsePageRanges("60", 50)).toThrow(/outside/);
    expect(() => parsePageRanges("roof", 50)).toThrow();
  });

  it("sends everything when it fits, picks pages when it doesn't, and asks for pages on scanned sets", () => {
    expect(
      choosePages({ texts: ["a", "b"], totalPages: 2, bytes: 1000 }).pages,
    ).toBeNull();
    const texts = Array.from({ length: 150 }, (_, i) =>
      i === 49
        ? "A-501 ROOF PLAN"
        : i === 99
          ? "A-201 EXTERIOR ELEVATIONS VINYL SIDING"
          : "E-1 ELECTRICAL",
    );
    expect(choosePages({ texts, totalPages: 150, bytes: 1000 }).pages).toEqual([
      1, 2, 50, 100,
    ]);
    expect(() =>
      choosePages({ texts: [], totalPages: 150, bytes: 1000 }),
    ).toThrow(/page numbers/);
    expect(
      choosePages({ texts: [], totalPages: 150, bytes: 1000, manual: "10-12" })
        .pages,
    ).toEqual([10, 11, 12]);
  });

  it("subsets a PDF and maps pages back to the original", async () => {
    const bytes = await planSet(10, { 7: "ROOF PLAN" });
    const sub = await subsetPdf(bytes, [1, 7]);
    expect((await PDFDocument.load(sub.bytes)).getPageCount()).toBe(2);
    expect(originalPage(2, sub.pages, 10)).toBe(7);
    expect(originalPage(3, sub.pages, 10)).toBeNull();
    expect(originalPage(11, null, 10)).toBeNull();
  });
});

describe("template suggestions from specified products", () => {
  const T = [
    {
      id: "hdz",
      name: "GAF Timberline HDZ",
      brand: "GAF",
      category: "SHINGLE",
      group: "Standard",
      impactClass: null,
    },
    {
      id: "uhdz",
      name: "GAF Timberline UHDZ",
      brand: "GAF",
      category: "SHINGLE",
      group: "Standard",
      impactClass: null,
    },
    {
      id: "legacy",
      name: "Malarkey Legacy IR",
      brand: "Malarkey",
      category: "SHINGLE",
      group: "Class 4",
      impactClass: "CLASS_4",
    },
    {
      id: "tpo",
      name: "Mulehide TPO .060 mechanically attached",
      brand: "Mulehide",
      category: "FLAT",
      group: "TPO",
      impactClass: null,
    },
    {
      id: "cm",
      name: 'Hardie Primed Cedarmill 8.25"',
      brand: "James Hardie",
      category: "SIDING",
      group: "Hardie (Primed)",
      impactClass: null,
    },
  ];
  const item = (
    category: string,
    product: string | null,
    description = "",
    orEqual = false,
  ) => ({
    category,
    product,
    description,
    orEqual,
    page: 3,
    quote: product ?? description,
  });

  it("matches the exact product line, not its siblings", () => {
    const s = suggestTemplates(
      [item("ROOF_COVERING", "GAF Timberline HDZ")],
      T,
    );
    expect(s[0]).toMatchObject({ templateId: "hdz", strength: "EXACT" });
    expect(s.find((x) => x.templateId === "uhdz")).toBeUndefined();
  });

  it("falls back to material type for generic or-equal specs", () => {
    const s = suggestTemplates(
      [
        item(
          "ROOF_COVERING",
          null,
          "60 mil TPO membrane, mechanically attached",
          true,
        ),
        item("WALL_CLADDING", null, "Fiber cement lap siding"),
      ],
      T,
    );
    expect(s.map((x) => x.templateId).sort()).toEqual(["cm", "tpo"]);
    expect(s.every((x) => x.strength === "TYPE")).toBe(true);
  });

  it("warns when the spec requires Class 4 and the template isn't", () => {
    const s = suggestTemplates(
      [item("ROOF_COVERING", "GAF Timberline HDZ")],
      T,
      { impactRequirement: "Shingles shall be UL 2218 Class 4" },
    );
    expect(s[0].warning).toMatch(/Class 4/);
  });

  it("works against the seeded templates", async () => {
    const all = await listTemplates({});
    const b = {
      ...emptyBrief(),
      scopeItems: [
        item(
          "ROOF_COVERING",
          "Owens Corning TruDefinition Duration",
        ) as PlanBrief["scopeItems"][number],
      ],
    };
    expect(briefSuggestions(b, all)[0]?.name).toMatch(/Duration/);
  });
});

describe("plan review run", () => {
  it("trims a big set, maps pages back, queues pitches and facts, rejects floor-plan area, and files RFIs", async () => {
    const a = await actor();
    const p = await createProject(
      {
        name: "TEST_ONLY Plan review job",
        scopes: ["STEEP", "SIDING"],
        isPublic: false,
        isTaxExempt: false,
      },
      a,
    );
    const bytes = await planSet(120, {
      1: "COVER SHEET INDEX OF DRAWINGS",
      40: "A-301 ROOF PLAN 6/12 ASPHALT SHINGLES",
      80: "A-201 EXTERIOR ELEVATIONS FIBER CEMENT LAP SIDING SOFFIT",
    });
    const { doc } = await addDocument({
      projectId: p.id,
      bytes,
      fileName: "TEST_ONLY plans.pdf",
      userId: a.id,
    });
    expect(doc.pages).toBe(120);
    const seen: Record<string, unknown>[] = [];
    const brief: PlanBrief = {
      ...emptyBrief(),
      pitches: [
        { rise: 6, label: "Main roof", page: 3, quote: "6/12" }, // sent page 3 = original 40
        { rise: 8, label: "bogus", page: 9, quote: "8/12" }, // not a page we sent
      ],
      scopeItems: [
        {
          category: "WALL_CLADDING",
          description: "Fiber cement lap siding",
          product: null,
          orEqual: false,
          location: "All elevations",
          page: 4,
          quote: "FIBER CEMENT LAP SIDING",
        },
      ],
      facts: [
        {
          key: "siding_type",
          value: "Fiber cement lap",
          page: 4,
          quote: "FIBER CEMENT LAP SIDING",
        },
      ],
      roofArea: {
        valueSf: 5200,
        page: 3,
        quote: "LEVEL 1 5,200 SF",
        source: "FLOOR_PLAN_SCHEDULE",
        sheet: "A-101",
      },
      rfis: [
        {
          question: "What siding exposure/profile is specified?",
          reason: "Elevations say lap only",
          page: 4,
        },
      ],
    };
    setAiClientForTests({
      beta: {
        messages: {
          parse: async (b: Record<string, unknown>) => (
            seen.push(b),
            { stop_reason: "end_turn", model: "fake", parsed_output: brief }
          ),
        },
      },
    } as never);

    const r = await runPlanReview(doc.id, { userId: a.id });
    expect(r.review.pagesSent).toEqual([1, 2, 40, 80]);
    const sent = (
      seen[0].messages as {
        content: { type: string; source?: { data: string } }[];
      }[]
    )[0].content[0];
    expect(sent.type).toBe("document");
    expect(
      (
        await PDFDocument.load(Buffer.from(sent.source!.data, "base64"))
      ).getPageCount(),
    ).toBe(4);

    const pitches = await prisma.measurement.findMany({
      where: { sourceDocId: doc.id, key: "pitch_by_facet" },
    });
    expect(pitches.map((m) => [m.value, m.sourcePage, m.status])).toEqual([
      [6, 40, "EXTRACTED_PENDING"],
    ]);
    const fact = await prisma.extractedFact.findFirstOrThrow({
      where: { documentId: doc.id },
    });
    expect(fact.page).toBe(80);
    const area = await prisma.measurement.findFirstOrThrow({
      where: { sourceDocId: doc.id, key: "roof_total_sf" },
    });
    expect(area.status).toBe("REJECTED"); // ROOF-01
    const rfis = await prisma.openItem.findMany({
      where: { projectId: p.id, text: { startsWith: "RFI (" } },
    });
    expect(rfis).toHaveLength(1);
    expect(rfis[0].text).toContain("p.80");

    // Re-running replaces unresolved RFIs instead of piling them up.
    await runPlanReview(doc.id, { userId: a.id });
    expect(
      await prisma.openItem.count({
        where: { projectId: p.id, text: { startsWith: "RFI (" } },
      }),
    ).toBe(1);

    // Manual pages override the finder.
    await runPlanReview(doc.id, { userId: a.id, pages: "40" });
    const last = await prisma.planReview.findFirstOrThrow({
      where: { documentId: doc.id },
      orderBy: { createdAt: "desc" },
    });
    expect(last.pagesSent).toEqual([40]);
  });
});

describe("Class 4 or-equal", () => {
  it("offers confirmed Class 4 shingles when the spec allows an equal, and never flags siding", () => {
    const T = [
      {
        id: "hdz",
        name: "GAF Timberline HDZ",
        brand: "GAF",
        category: "SHINGLE",
        group: "Standard",
        impactClass: null,
      },
      {
        id: "legacy",
        name: "Malarkey Legacy IR",
        brand: "Malarkey",
        category: "SHINGLE",
        group: "Class 4",
        impactClass: "CLASS_4",
      },
      {
        id: "cm",
        name: 'Hardie Primed Cedarmill 8.25"',
        brand: "James Hardie",
        category: "SIDING",
        group: "Hardie (Primed)",
        impactClass: null,
      },
    ];
    const s = suggestTemplates(
      [
        {
          category: "ROOF_COVERING",
          product: "GAF Timberline HDZ",
          description: "",
          orEqual: true,
          page: 3,
          quote: "x",
        },
        {
          category: "WALL_CLADDING",
          product: "HardiePlank Cedarmill",
          description: "",
          orEqual: false,
          page: 2,
          quote: "y",
        },
      ],
      T,
      { impactRequirement: "Class 4 impact-resistant shingles" },
    );
    expect(s.find((x) => x.templateId === "legacy")).toMatchObject({
      strength: "TYPE",
      warning: null,
    });
    expect(s.find((x) => x.templateId === "hdz")?.warning).toMatch(/Class 4/);
    expect(s.find((x) => x.templateId === "cm")?.warning).toBeNull();
  });
});
