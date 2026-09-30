// Claude extraction from EagleView reports and plans/specs (BUILD_PROMPT §3).
// Every value needs a page reference; anything the document doesn't show comes back absent, never estimated.
// Nothing extracted is used until a person confirms it.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import { aiParse } from "@/lib/ai/claude";
import { MEASUREMENT_BY_KEY, MEASUREMENT_KEYS } from "./measurements";

const MAX_PDF_BYTES = 30 * 1024 * 1024; // request limit is 32 MB
const MAX_PDF_PAGES = 600;

const EagleViewSchema = z.object({
  measurements: z.array(
    z.object({
      key: z.enum(MEASUREMENT_KEYS),
      value: z.number(),
      unit: z.string(),
      facet: z
        .string()
        .nullable()
        .describe(
          "Facet, pitch group, structure, or elevation label when the value is per-facet; else null",
        ),
      page: z
        .number()
        .int()
        .describe("1-based page number in this PDF where the value is printed"),
      quote: z
        .string()
        .describe("The exact text on that page the value was read from"),
    }),
  ),
  notes: z
    .array(z.string())
    .describe(
      "Anything the estimator should know: multiple structures, excluded areas, report type",
    ),
});

const EAGLEVIEW_TASK = `Read this EagleView measurement report and pull out the measurements listed in the schema.
Rules:
- Only values printed in the report. If a measurement isn't in the report, leave it out. Never compute, round, or estimate one.
- Every value needs the 1-based PDF page it appears on and the exact text you read it from.
- roof_total_sf is the report's total roof area. roof_sq only if the report prints squares.
- pitch_by_facet: one entry per pitch the report lists (value = rise per 12, facet = the pitch/area label).
- Walls: siding_sf is the "Siding" wall category only. masonry_sf and masonry_corner_lf are reported separately and are never part of siding.
- wall_heights: one entry per elevation when listed.
- If the report covers more than one structure, say so in notes and label facet with the structure.`;

export const PLAN_FACT_KEYS = [
  "roof_system_type",
  "insulation_requirements",
  "warranty_duration",
  "edge_metal_requirements",
  "deck_type",
  "roof_slope",
  "building_height",
  "wall_panel_type",
  "siding_type",
  "spec_section",
] as const;

export const RoofAreaSchema = z
  .object({
    valueSf: z.number(),
    page: z.number().int(),
    quote: z.string(),
    source: z
      .enum(["ROOF_PLAN", "FLOOR_PLAN_SCHEDULE", "OTHER"])
      .describe("Where the area was printed"),
    sheet: z.string().nullable().describe("Sheet number, e.g. A-501"),
  })
  .nullable()
  .describe("Only a roof area printed in the document; null if none");

const PlansSchema = z.object({
  facts: z.array(
    z.object({
      key: z.enum(PLAN_FACT_KEYS),
      value: z
        .string()
        .describe(
          "As written in the document, e.g. '60 mil TPO, mechanically attached' or 'Section 07 54 23 Thermoplastic Polyolefin Roofing'",
        ),
      page: z.number().int(),
      quote: z.string(),
    }),
  ),
  roofArea: RoofAreaSchema,
});

const PLANS_TASK = `Read these construction plans/specifications for a roofing/exterior bid and pull out the facts in the schema.
Rules:
- Only what the document states. Leave out anything it doesn't say. No assumptions.
- Every fact needs the 1-based PDF page and the exact text.
- insulation_requirements: R-value and/or thickness and layers as written. warranty_duration: years and warranty type as written.
- spec_section: one entry per Division 07 (and relevant Division 08) section found, value = section number and title.
- roofArea: report a roof area only if the document prints one, and say where it came from. A floor-plan area schedule (gross/net floor area by level) is FLOOR_PLAN_SCHEDULE, not a roof area.`;

type Msg = Anthropic.Beta.BetaMessageParam;

export async function documentMessage(
  doc: {
    fileUrl: string;
    fileName: string;
    pages: number | null;
    extractedText: string | null;
  },
  ask: string,
): Promise<Msg> {
  const bytes = await readUpload(doc.fileUrl);
  if (
    bytes.length <= MAX_PDF_BYTES &&
    (doc.pages ?? 0) <= MAX_PDF_PAGES &&
    doc.fileName.toLowerCase().endsWith(".pdf")
  ) {
    return {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: bytes.toString("base64"),
          },
          title: doc.fileName,
        },
        { type: "text", text: ask },
      ],
    };
  }
  if (!doc.extractedText)
    throw new Error(
      `${doc.fileName} is too large to send and has no readable text.`,
    );
  // Too large for a PDF block: send page-marked text instead (all pages, nothing dropped).
  const pages = doc.extractedText
    .split("\f")
    .map((t, i) => `=== Page ${i + 1} ===\n${t}`);
  return {
    role: "user",
    content: `${ask}\n\nDocument "${doc.fileName}" (text by page):\n\n${pages.join("\n\n")}`,
  };
}

export const validPage = (page: number, pages: number | null) =>
  Number.isInteger(page) && page >= 1 && (pages == null || page <= pages);

export async function logRun(
  documentId: string,
  kind: string,
  status: "OK" | "FAILED",
  message: string,
  model?: string,
) {
  await prisma.extractionRun.create({
    data: { documentId, kind, status, message, model },
  });
}

export async function extractEagleView(documentId: string) {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });
  const msg = await documentMessage(
    doc,
    "Extract the measurements from this EagleView report.",
  );
  const { data, model } = await aiParse({
    task: EAGLEVIEW_TASK,
    schema: EagleViewSchema,
    messages: [msg],
    effort: "high",
    maxTokens: 16000,
  });
  let kept = 0;
  const dropped: string[] = [];
  // Re-running replaces this document's unconfirmed values; confirmed ones stay.
  await prisma.measurement.deleteMany({
    where: { sourceDocId: doc.id, status: "EXTRACTED_PENDING" },
  });
  for (const m of data.measurements) {
    const def = MEASUREMENT_BY_KEY.get(m.key);
    if (
      !def ||
      !validPage(m.page, doc.pages) ||
      !Number.isFinite(m.value) ||
      m.value < 0 ||
      !m.quote.trim()
    ) {
      dropped.push(`${m.key} (no valid page/quote)`);
      continue;
    }
    await prisma.measurement.create({
      data: {
        projectId: doc.projectId,
        key: m.key,
        value: m.value,
        unit: def.unit,
        facet: m.facet,
        sourceDocId: doc.id,
        sourcePage: m.page,
        quote: m.quote.slice(0, 500),
        extractedValue: m.value,
        status: "EXTRACTED_PENDING",
      },
    });
    kept++;
  }
  const message = [
    `${kept} measurement${kept === 1 ? "" : "s"} waiting for confirmation.`,
    dropped.length
      ? `Dropped without a page reference: ${dropped.join(", ")}.`
      : "",
    ...data.notes,
  ]
    .filter(Boolean)
    .join(" ");
  await logRun(doc.id, "EAGLEVIEW", "OK", message, model);
  return { kept, dropped, notes: data.notes };
}

export async function extractPlansSpecs(documentId: string) {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });
  const msg = await documentMessage(
    doc,
    "Extract the roofing/exterior facts from this document.",
  );
  const { data, model } = await aiParse({
    task: PLANS_TASK,
    schema: PlansSchema,
    messages: [msg],
    effort: "high",
    maxTokens: 16000,
  });
  await prisma.extractedFact.deleteMany({
    where: { documentId: doc.id, status: "PENDING" },
  });
  let facts = 0;
  for (const f of data.facts) {
    if (!validPage(f.page, doc.pages) || !f.value.trim()) continue;
    await prisma.extractedFact.create({
      data: {
        projectId: doc.projectId,
        documentId: doc.id,
        key: f.key,
        value: f.value.trim(),
        page: f.page,
        quote: f.quote.slice(0, 500),
      },
    });
    facts++;
  }
  const notes: string[] = [
    `${facts} fact${facts === 1 ? "" : "s"} waiting for confirmation.`,
  ];
  const raNote = data.roofArea
    ? await recordRoofArea(doc, data.roofArea)
    : null;
  if (raNote) notes.push(raNote);
  await logRun(doc.id, "PLANS_SPECS", "OK", notes.join(" "), model);
  return { facts, notes };
}

export type RoofAreaRead = NonNullable<z.infer<typeof RoofAreaSchema>>;

/** Records a roof area read from plans. ROOF-01 (locked): only a roof plan sheet counts; anything else is stored REJECTED with the reason. */
export async function recordRoofArea(
  doc: { id: string; projectId: string; pages: number | null },
  ra: RoofAreaRead,
): Promise<string | null> {
  if (!validPage(ra.page, doc.pages) || !(ra.valueSf > 0)) return null;
  await prisma.measurement.deleteMany({
    where: {
      sourceDocId: doc.id,
      key: "roof_total_sf",
      status: { in: ["EXTRACTED_PENDING", "REJECTED"] },
    },
  });
  if (ra.source === "ROOF_PLAN") {
    await prisma.measurement.create({
      data: {
        projectId: doc.projectId,
        key: "roof_total_sf",
        value: ra.valueSf,
        extractedValue: ra.valueSf,
        unit: "SF",
        sourceDocId: doc.id,
        sourcePage: ra.page,
        quote: ra.quote.slice(0, 500),
        note: ra.sheet ? `Roof plan sheet ${ra.sheet}` : "Roof plan sheet",
        status: "EXTRACTED_PENDING",
      },
    });
    return `Roof area ${ra.valueSf} SF from the roof plan (p.${ra.page}) waiting for confirmation.`;
  } else {
    // ROOF-01 (locked): roof area must come from the roof plan sheet, never a floor-plan area schedule.
    const why =
      ra.source === "FLOOR_PLAN_SCHEDULE"
        ? `ROOF-01: the only area found (${ra.valueSf} SF, p.${ra.page}) is a floor-plan area schedule. Floor-plan schedules overcount on multi-story buildings, so it was rejected. Use the roof plan sheet or an EagleView report.`
        : `ROOF-01: the area found (${ra.valueSf} SF, p.${ra.page}) isn't from a roof plan sheet, so it was rejected. Use the roof plan sheet or an EagleView report.`;
    await prisma.measurement.create({
      data: {
        projectId: doc.projectId,
        key: "roof_total_sf",
        value: ra.valueSf,
        extractedValue: ra.valueSf,
        unit: "SF",
        sourceDocId: doc.id,
        sourcePage: ra.page,
        quote: ra.quote.slice(0, 500),
        note: why,
        status: "REJECTED",
        confirmedBy: "ROOF-01",
      },
    });
    return why;
  }
}
