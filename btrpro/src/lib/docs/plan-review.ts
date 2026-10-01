// New-construction plan & spec review. Reads a plan set / project manual and writes an estimator brief:
// what's on which sheet, roof systems and pitches, wall claddings and trim, products specified, requirements,
// scope by others, alternates, conflicts, and questions to send the builder (RFIs).
// Rules: only what the documents say, every item with its ORIGINAL page and exact quote; no quantities are
// computed. Facts, pitches and a roof-plan area go to the confirmation queue; RFIs become open items.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import { aiParse } from "@/lib/ai/claude";
import {
  PLAN_FACT_KEYS,
  RoofAreaSchema,
  logRun,
  recordRoofArea,
} from "./extraction";
import {
  PLAN_MAX_BYTES,
  choosePages,
  scorePages,
  subsetPdf,
} from "./plan-pages";
import {
  suggestTemplates,
  type MatchTemplate,
  type SpecProduct,
} from "@/lib/estimates/template-match";

export const SCOPE_CATEGORIES = [
  "ROOF_COVERING",
  "UNDERLAYMENT",
  "ICE_WATER",
  "VENTILATION",
  "FLASHING",
  "EDGE_METAL",
  "GUTTERS",
  "WALL_CLADDING",
  "WEATHER_BARRIER",
  "TRIM",
  "SOFFIT_FASCIA",
  "INSULATION",
  "DECK_SHEATHING",
  "OTHER",
] as const;
export const SCOPE_LABEL: Record<string, string> = {
  ROOF_COVERING: "Roof covering",
  UNDERLAYMENT: "Underlayment",
  ICE_WATER: "Ice & water",
  VENTILATION: "Ventilation",
  FLASHING: "Flashing",
  EDGE_METAL: "Drip edge / edge metal",
  GUTTERS: "Gutters & downspouts",
  WALL_CLADDING: "Wall cladding",
  WEATHER_BARRIER: "Weather barrier",
  TRIM: "Trim",
  SOFFIT_FASCIA: "Soffit & fascia",
  INSULATION: "Insulation",
  DECK_SHEATHING: "Deck / sheathing",
  OTHER: "Other",
};
const REQ_KINDS = [
  "WARRANTY",
  "IMPACT_RATING",
  "WIND_RATING",
  "FIRE_RATING",
  "CODE",
  "INSTALLATION",
  "SUBMITTAL",
  "OTHER",
] as const;

const cite = {
  page: z
    .number()
    .int()
    .describe("1-based page number in the PDF you were given"),
  quote: z.string().describe("Exact text on that page"),
};

export const PlanReviewSchema = z.object({
  summary: z
    .string()
    .describe(
      "3–6 sentences for the estimator: building, roof and wall systems, anything unusual. Only what the documents say.",
    ),
  projectDescription: z
    .string()
    .nullable()
    .describe(
      "As written, e.g. '2-story single-family, 2,850 SF conditioned'; null if not stated",
    ),
  sheetIndex: z
    .array(
      z.object({
        sheet: z.string(),
        title: z.string(),
        page: z.number().int(),
      }),
    )
    .describe(
      "Relevant sheets only: cover, roof plan, elevations, sections, details, exterior finish schedule, Division 07 sections",
    ),
  roofSystems: z.array(
    z.object({
      area: z
        .string()
        .nullable()
        .describe("Main roof, porch, garage, low slope over…"),
      system: z.string().describe("As written"),
      ...cite,
    }),
  ),
  pitches: z.array(
    z.object({
      rise: z.number().describe("Rise per 12, only as printed (6/12 → 6)"),
      label: z.string().nullable(),
      ...cite,
    }),
  ),
  scopeItems: z.array(
    z.object({
      category: z.enum(SCOPE_CATEGORIES),
      description: z
        .string()
        .describe("What the document calls for, as written"),
      product: z
        .string()
        .nullable()
        .describe(
          "Manufacturer and product line exactly as written, e.g. 'GAF Timberline HDZ'; null if only generic",
        ),
      orEqual: z
        .boolean()
        .describe(
          "True if the document allows 'or equal' / 'approved equal' / substitutions",
        ),
      location: z
        .string()
        .nullable()
        .describe("Where it applies: front elevation, gables, porch ceiling…"),
      ...cite,
    }),
  ),
  requirements: z.array(
    z.object({ kind: z.enum(REQ_KINDS), text: z.string(), ...cite }),
  ),
  facts: z.array(
    z.object({ key: z.enum(PLAN_FACT_KEYS), value: z.string(), ...cite }),
  ),
  roofArea: RoofAreaSchema,
  byOthers: z
    .array(z.object({ text: z.string(), ...cite }))
    .describe("Work the documents assign to others or exclude"),
  alternates: z.array(z.object({ text: z.string(), ...cite })),
  conflicts: z.array(
    z.object({
      text: z
        .string()
        .describe(
          "What disagrees, e.g. elevations show board & batten on gables, finish schedule says lap",
        ),
      pages: z.array(z.number().int()),
    }),
  ),
  rfis: z.array(
    z.object({
      question: z.string().describe("Question to send the builder/architect"),
      reason: z.string(),
      page: z.number().int().nullable(),
    }),
  ),
});
export type PlanBrief = z.infer<typeof PlanReviewSchema>;

const TASK = `You are helping a residential/commercial roofing & exterior contractor (roofing, siding, gutters, soffit/fascia, trim) bid a NEW CONSTRUCTION job from a plan set and/or specifications.
Write an estimator brief using the schema. Rules:
- Only what the documents state. Never assume, compute, scale off drawings, or estimate a quantity. If something the estimator needs isn't shown, add an RFI instead.
- Every item needs the 1-based page number of the PDF you were given and the exact text you read it from.
- scopeItems: one entry per distinct material/system in our trades (roof covering, underlayment, ice & water, ventilation, flashing, drip edge/edge metal, gutters, wall cladding by type and location, weather barrier, trim, soffit & fascia, roof insulation, roof deck/sheathing). Keep the manufacturer and product line exactly as written, and note "or equal".
- pitches: every roof pitch printed on the roof plan, elevations or sections (6/12 → rise 6), labelled by roof area when shown.
- requirements: warranty, impact rating (Class 4 / UL 2218), wind rating, fire rating, code requirements, installation requirements, submittals.
- facts use the listed keys only. roofArea only if a roof area is printed; a floor-plan area schedule is FLOOR_PLAN_SCHEDULE, never a roof area.
- conflicts: where drawings, schedules and specs disagree with each other.
- rfis: missing or unclear information an estimator needs to price our scope (e.g. siding profile not specified, no gutter size, soffit material not shown, no roof pitch on the porch).`;

type Msg = Anthropic.Beta.BetaMessageParam;

async function buildMessage(
  doc: {
    fileUrl: string;
    fileName: string;
    pages: number | null;
    extractedText: string | null;
  },
  manual: string | null,
) {
  const bytes = await readUpload(doc.fileUrl);
  const texts = doc.extractedText ? doc.extractedText.split("\f") : [];
  const isPdf =
    doc.fileName.toLowerCase().endsWith(".pdf") ||
    (bytes[0] === 0x25 && bytes[1] === 0x50);
  const total = doc.pages ?? texts.length;
  if (!isPdf) {
    if (!texts.length)
      throw new Error(`${doc.fileName} isn't a PDF and has no readable text.`);
    return {
      msg: textMessage(doc.fileName, texts, null),
      map: null as number[] | null,
      reason: "Text only.",
    };
  }
  const choice = choosePages({
    texts,
    totalPages: total,
    bytes: bytes.length,
    manual,
  });
  let pdf: Uint8Array = bytes;
  let map: number[] | null = null;
  if (choice.pages) {
    const priority = new Map(scorePages(texts).map((s) => [s.page, s.score]));
    try {
      const sub = await subsetPdf(bytes, choice.pages, priority);
      pdf = sub.bytes;
      map = sub.pages;
    } catch (e) {
      // pdf-lib can't open some encrypted/damaged sets: fall back to the page text of the chosen pages.
      if (!texts.length) throw e;
      return {
        msg: textMessage(doc.fileName, texts, choice.pages),
        map: null,
        reason: `${choice.reason} Sent as text (the PDF couldn't be split).`,
      };
    }
  }
  if (pdf.length > PLAN_MAX_BYTES)
    throw new Error(
      "The plan set is too large to send. Enter the page numbers to review.",
    );
  const intro = map
    ? `This PDF holds ${map.length} pages taken from "${doc.fileName}".`
    : `Plan set "${doc.fileName}".`;
  const msg: Msg = {
    role: "user",
    content: [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: Buffer.from(pdf).toString("base64"),
        },
        title: doc.fileName,
      },
      { type: "text", text: `${intro} Write the estimator brief.` },
    ],
  };
  return {
    msg,
    map,
    reason:
      choice.reason +
      (map && map.length < (choice.pages?.length ?? 0)
        ? ` Trimmed to ${map.length} pages to fit the size limit.`
        : ""),
  };
}

function textMessage(
  fileName: string,
  texts: string[],
  pages: number[] | null,
): Msg {
  const pick = pages ?? texts.map((_, i) => i + 1);
  const body = pick
    .map((p) => `=== Page ${p} ===\n${texts[p - 1] ?? ""}`)
    .join("\n\n");
  return {
    role: "user",
    content: `Write the estimator brief. Page numbers below are the document's own; cite them as written.\n\nDocument "${fileName}" (text by page):\n\n${body}`,
  };
}

/** Maps a page reported against the sent PDF back to the original document; null when it's not a real page. */
export function originalPage(
  page: number | null | undefined,
  map: number[] | null,
  total: number | null,
): number | null {
  if (page == null || !Number.isInteger(page) || page < 1) return null;
  if (map) return map[page - 1] ?? null;
  return total == null || page <= total ? page : null;
}

/** Drops items without a real page, rewrites pages to the original document. */
export function remapBrief(
  b: PlanBrief,
  map: number[] | null,
  total: number | null,
): { brief: PlanBrief; dropped: number } {
  let dropped = 0;
  const fix = <T extends { page: number }>(xs: T[]): T[] =>
    xs.flatMap((x) => {
      const p = originalPage(x.page, map, total);
      if (
        p == null ||
        ("quote" in x && !String((x as { quote?: string }).quote ?? "").trim())
      )
        return (dropped++, []);
      return [{ ...x, page: p }];
    });
  const ra = b.roofArea ? originalPage(b.roofArea.page, map, total) : null;
  return {
    dropped,
    brief: {
      ...b,
      sheetIndex: fix(b.sheetIndex.map((s) => ({ ...s, quote: s.title }))).map(
        ({ quote: _q, ...s }) => s,
      ),
      roofSystems: fix(b.roofSystems),
      pitches: fix(b.pitches).filter(
        (p) => Number.isFinite(p.rise) && p.rise > 0 && p.rise <= 36,
      ),
      scopeItems: fix(b.scopeItems),
      requirements: fix(b.requirements),
      facts: fix(b.facts),
      roofArea: b.roofArea && ra != null ? { ...b.roofArea, page: ra } : null,
      byOthers: fix(b.byOthers),
      alternates: fix(b.alternates),
      conflicts: b.conflicts.map((c) => ({
        ...c,
        pages: c.pages
          .map((p) => originalPage(p, map, total))
          .filter((p): p is number => p != null),
      })),
      rfis: b.rfis.map((r) => ({
        ...r,
        page: originalPage(r.page, map, total),
      })),
    },
  };
}

const rfiPrefix = (fileName: string) => `RFI (${fileName}`;

export async function runPlanReview(
  documentId: string,
  opts: { pages?: string | null; userId?: string | null } = {},
) {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
  });
  let pagesSent: number[] | null = null;
  try {
    const { msg, map, reason } = await buildMessage(doc, opts.pages ?? null);
    pagesSent = map;
    const { data, model } = await aiParse({
      task: TASK,
      schema: PlanReviewSchema,
      messages: [msg],
      effort: "high",
      maxTokens: 32000,
    });
    const { brief, dropped } = remapBrief(data, map, doc.pages);

    // Confirmation queue: facts, pitches, roof-plan area. Re-running replaces this document's unconfirmed values.
    await prisma.extractedFact.deleteMany({
      where: { documentId: doc.id, status: "PENDING" },
    });
    for (const f of brief.facts)
      if (f.value.trim())
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
    await prisma.measurement.deleteMany({
      where: {
        sourceDocId: doc.id,
        key: "pitch_by_facet",
        status: "EXTRACTED_PENDING",
      },
    });
    for (const p of brief.pitches)
      await prisma.measurement.create({
        data: {
          projectId: doc.projectId,
          key: "pitch_by_facet",
          value: p.rise,
          extractedValue: p.rise,
          unit: "/12",
          facet: p.label,
          sourceDocId: doc.id,
          sourcePage: p.page,
          quote: p.quote.slice(0, 500),
          status: "EXTRACTED_PENDING",
        },
      });
    const raNote = brief.roofArea
      ? await recordRoofArea(doc, brief.roofArea)
      : null;

    // RFIs → open items on the job (replaces this document's unresolved ones).
    await prisma.openItem.deleteMany({
      where: {
        projectId: doc.projectId,
        resolved: false,
        text: { startsWith: rfiPrefix(doc.fileName) },
      },
    });
    for (const r of brief.rfis)
      await prisma.openItem.create({
        data: {
          projectId: doc.projectId,
          text: `${rfiPrefix(doc.fileName)}${r.page ? ` p.${r.page}` : ""}): ${r.question}`,
          owner: "Estimator",
        },
      });

    const message = [
      reason,
      `${brief.scopeItems.length} scope items, ${brief.facts.length} facts and ${brief.pitches.length} pitches to confirm, ${brief.rfis.length} RFIs.`,
      dropped ? `${dropped} item(s) dropped for a missing page or quote.` : "",
      raNote ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    const review = await prisma.planReview.create({
      data: {
        projectId: doc.projectId,
        documentId: doc.id,
        status: "OK",
        pagesSent: map ?? undefined,
        brief: brief as never,
        message,
        model,
        createdById: opts.userId ?? null,
      },
    });
    await logRun(doc.id, "PLAN_REVIEW", "OK", message, model);
    await prisma.projectActivity.create({
      data: {
        projectId: doc.projectId,
        userId: opts.userId ?? null,
        kind: "document",
        text: `Plan review of "${doc.fileName}": ${brief.rfis.length} RFIs, ${brief.scopeItems.length} scope items`,
      },
    });
    return { review, brief, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.planReview.create({
      data: {
        projectId: doc.projectId,
        documentId: doc.id,
        status: "FAILED",
        pagesSent: pagesSent ?? undefined,
        message,
        createdById: opts.userId ?? null,
      },
    });
    throw e;
  }
}

/** Template suggestions for a brief, from the templates this job can use. */
export function briefSuggestions(brief: PlanBrief, templates: MatchTemplate[]) {
  const impact =
    brief.requirements
      .filter((r) => r.kind === "IMPACT_RATING")
      .map((r) => r.text)
      .join(" ") || null;
  return suggestTemplates(brief.scopeItems as SpecProduct[], templates, {
    impactRequirement: impact,
  });
}
