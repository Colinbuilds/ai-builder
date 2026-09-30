// Tools for the AI estimator assistant (BUILD_PROMPT §8). Claude only sees prices and item numbers that
// these tools return, and anything it proposes lands as PENDING_AI for a person to accept.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { searchPriceItems } from "@/lib/price";
import { notOnBuilderNote, priceScopeFor } from "@/lib/pricing-scope";
import { sheetDateStatus } from "@/lib/sheets/date-status";
import { INTAKE_BY_KEY } from "@/lib/projects/intake";
import { MEASUREMENT_BY_KEY } from "@/lib/docs/measurements";
import { liveItems, measureMap } from "@/lib/estimates/service";
import { runModule, defaultConfig, type Module, type TakeoffConfig } from "@/lib/estimates/takeoff";
import { buildJobRecord } from "@/lib/comms/summaries";
import { refreshReadiness } from "@/lib/projects/service";

export type ToolCtx = { projectId: string; user: { id: string; name: string } };

const SECTIONS = ["MATERIAL_ROOFING", "MATERIAL_DECK", "MATERIAL_SIDING", "GENERAL_CONDITIONS"] as const;

export const TOOL_SCHEMAS = {
  search_price_items: z.object({ query: z.string(), sheet_codes: z.array(z.string()).optional() }),
  get_price_item: z.object({ item_number: z.string() }),
  get_measurements: z.object({}),
  get_intake: z.object({}),
  get_sheet_status: z.object({}),
  run_calc: z.object({ module: z.enum(["steep", "lowSlope", "deck", "siding"]), overrides: z.record(z.string(), z.unknown()).optional() }),
  propose_line_items: z.object({
    lines: z.array(
      z.object({
        section: z.enum(SECTIONS),
        item_number: z.string().nullable(),
        item_name: z.string(),
        quantity: z.number().nonnegative(),
        unit: z.string(),
        unit_price: z.number().nullable().describe("Only a price returned by search_price_items/get_price_item; null if not priced"),
        reason: z.string(),
        formula: z.string().nullable(),
      }),
    ),
  }),
  list_open_items: z.object({}),
  add_open_item: z.object({ text: z.string(), owner: z.string().nullable().optional() }),
  get_job_communications: z.object({ since: z.string().nullable().optional() }),
  list_documents: z.object({}),
  read_document: z.object({ document_id: z.string(), pages: z.string().nullable().optional().describe("e.g. '1-3' or '5'; null for all") }),
  propose_scope: z.object({ we_will: z.array(z.string()), we_will_not: z.array(z.string()) }),
} as const;

type ToolName = keyof typeof TOOL_SCHEMAS;

const DESCRIPTIONS: Record<ToolName, string> = {
  search_price_items: "Search BTR's loaded price sheets by item number, description words, or section. Returns item #, description, unit price (or CALL), UOM, sheet code, sheet date status, and parsed coverage. The only source of prices and item numbers.",
  get_price_item: "Look up one item number on the live sheets. Says so if it's not on any loaded sheet.",
  get_measurements: "Confirmed and hand-entered measurements for this job with their sources, plus how many extracted values are still waiting for confirmation (those can't be used).",
  get_intake: "The job's intake checklist: each field's status (VERIFIED / MISSING / ASSUMED / N/A), value, and source.",
  get_sheet_status: "Every price sheet with effective/expiration dates, date status (CURRENT / STALE / EXPIRING / EXPIRED), and warnings.",
  run_calc: "Run the deterministic takeoff calculator for a module using the current estimate's saved takeoff settings (optionally with overrides to those settings). Returns each line's quantity and formula, or what's missing. Does not change the estimate. Always use this instead of doing arithmetic yourself.",
  propose_line_items: "Propose lines for the current estimate. Each lands as PENDING_AI for a person to accept or reject. Item numbers and unit prices must match the price sheets exactly (the server rejects mismatches). Include a reason and the formula used.",
  list_open_items: "Open items on this job.",
  add_open_item: "Add an open item (missing info, RFI, confirmation needed) to the current estimate.",
  get_job_communications: "Team chat, emails, and the activity log for this job (optionally since an ISO date).",
  list_documents: "Documents on this job with id, type, file name, page count.",
  read_document: "The text of a job document (change orders, sub proposals, specs), marked by page.",
  propose_scope: "Add We Will / We Will Not scope items to the current estimate for the user to edit.",
};

const JSON_SCHEMAS: Record<ToolName, Anthropic.Beta.BetaTool.InputSchema> = Object.fromEntries(
  Object.entries(TOOL_SCHEMAS).map(([k, s]) => {
    const js = z.toJSONSchema(s) as Record<string, unknown>;
    delete js.$schema;
    return [k, { type: "object", ...js } as Anthropic.Beta.BetaTool.InputSchema];
  }),
) as never;

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  input_schema: JSON_SCHEMAS[name],
  eager_input_streaming: true,
}));

async function currentEstimate(projectId: string) {
  return prisma.estimate.findFirst({ where: { projectId, locked: false }, orderBy: { revision: "desc" } });
}

const money = (n: number | null) => (n == null ? "CALL" : `$${n.toFixed(2)}`);

export async function runTool(name: string, rawInput: unknown, ctx: ToolCtx): Promise<{ ok: boolean; content: string }> {
  if (!(name in TOOL_SCHEMAS)) return { ok: false, content: `Unknown tool ${name}` };
  const parsed = TOOL_SCHEMAS[name as ToolName].safeParse(rawInput);
  if (!parsed.success) return { ok: false, content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const input = parsed.data as never;
  try {
    return { ok: true, content: await TOOLS[name as ToolName](input, ctx) };
  } catch (e) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) };
  }
}

type Impl = { [K in ToolName]: (i: z.infer<(typeof TOOL_SCHEMAS)[K]>, ctx: ToolCtx) => Promise<string> };

const TOOLS: Impl = {
  async search_price_items(i, ctx) {
    const scope = await priceScopeFor(ctx.projectId);
    const r = await searchPriceItems({ q: i.query, sheetCodes: i.sheet_codes, pageSize: 25, scope });
    if (!r.items.length) return `No items match "${i.query}" on the loaded sheets.`;
    return r.items
      .map(
        (it) =>
          `${it.itemNumber} | ${it.description} | ${money(it.unitPrice)}/${it.uom} | sheet ${it.sheet.code}${scope.builderId ? (it.sheet.companyId ? ` (${scope.builderName} pricing)` : " (BTR standard — not builder pricing)") : ""} (${sheetDateStatus(it.sheet).status})${it.coverageQty != null ? ` | coverage ${it.coverageQty} ${it.coverageUnit}` : ""}${it.sheet.warning ? " | CONFIRM ACCOUNT" : ""}`,
      )
      .join("\n");
  },
  async get_price_item(i, ctx) {
    const scope = await priceScopeFor(ctx.projectId);
    const it = (await liveItems([i.item_number.trim()], scope)).get(i.item_number.trim());
    if (!it) return scope.builderId ? `${i.item_number} — ${notOnBuilderNote(scope)} Mark it MISSING.` : `${i.item_number} is not on any loaded BTR price sheet. Mark it MISSING and ask for the correct sheet.`;
    return `${it.itemNumber} | ${it.description} | ${money(it.unitPrice)}/${it.uom} | sheet ${it.sheetCode}${it.priceSource === "BUILDER" ? ` (${scope.builderName} pricing)` : it.priceSource === "STANDARD_FALLBACK" ? " (BTR standard fallback — not on the builder's sheet)" : ""} (${it.sheetStatus})${it.coverageQty != null ? ` | coverage ${it.coverageQty} ${it.coverageUnit}` : ""}${it.sheetWarning ? ` | WARNING: ${it.sheetWarning}` : ""}`;
  },
  async get_measurements(_i, ctx) {
    const ms = await prisma.measurement.findMany({ where: { projectId: ctx.projectId }, include: { sourceDoc: { select: { fileName: true } } } });
    const usable = ms.filter((m) => m.status === "CONFIRMED" || m.status === "USER_ENTERED");
    const pending = ms.filter((m) => m.status === "EXTRACTED_PENDING").length;
    const lines = usable.map(
      (m) =>
        `${MEASUREMENT_BY_KEY.get(m.key)?.label ?? m.key}${m.facet ? ` (${m.facet})` : ""}: ${m.value} ${m.unit ?? ""} — ${m.sourceDoc ? `${m.sourceDoc.fileName} p.${m.sourcePage}` : (m.note ?? "entered")}`,
    );
    return `${lines.join("\n") || "No confirmed measurements."}\n${pending ? `${pending} extracted value(s) waiting for confirmation (not usable yet).` : ""}`;
  },
  async get_intake(_i, ctx) {
    const f = await prisma.intakeField.findMany({ where: { projectId: ctx.projectId } });
    return f
      .map((x) => `${INTAKE_BY_KEY.get(x.key)?.label ?? x.key}: ${x.status}${x.value ? ` = ${x.value}${x.unit ? ` ${x.unit}` : ""}` : ""}${x.note ? ` (${x.note})` : ""}`)
      .join("\n");
  },
  async get_sheet_status() {
    const sheets = await prisma.priceSheet.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
    return sheets
      .map((s) => {
        if (!s.isLoaded) return `${s.code} ${s.name}: NOT LOADED — items stay MISSING`;
        const st = sheetDateStatus(s);
        return `${s.code} ${s.name}: ${st.status} (effective ${s.effectiveDate?.toISOString().slice(0, 10)}, expires ${s.expirationDate?.toISOString().slice(0, 10)}, ${st.ageDays} days old)${s.warning ? ` WARNING: ${s.warning}` : ""}`;
      })
      .join("\n");
  },
  async run_calc(i, ctx) {
    const e = await currentEstimate(ctx.projectId);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    const saved = ((e?.takeoff as TakeoffConfig) ?? {})[i.module as Module] ?? defaultConfig(i.module as Module, p.market);
    const config = { [i.module]: { ...(saved as object), ...(i.overrides ?? {}) } } as TakeoffConfig;
    const w = (e?.wastePctBySection as Record<string, { pct: number | null; approved: boolean; basis: string }>) ?? {};
    const pick = (s: string) => w[s] ?? { pct: null, approved: false, basis: "not set" };
    const items = await liveItems(JSON.stringify(config).match(/"itemNumber":"([^"]+)"/g)?.map((m) => m.slice(14, -1)) ?? [], await priceScopeFor(ctx.projectId));
    const { lines, problems } = runModule(i.module as Module, config, {
      m: await measureMap(ctx.projectId),
      items,
      waste: { ROOFING: pick("ROOFING"), SIDING: pick("SIDING"), DECK: pick("DECK") },
    });
    if (problems.length) return problems.join(" ");
    return lines.map((l) => `${l.itemName} [${l.itemNumber ?? "no product"}]: ${l.quantity ?? "MISSING"} ${l.unit ?? ""} — ${l.formula}`).join("\n");
  },
  async propose_line_items(i, ctx) {
    const e = await currentEstimate(ctx.projectId);
    if (!e) return "There's no open estimate on this job. Ask the user to start one on the Estimates tab.";
    const items = await liveItems(i.lines.map((l) => l.item_number ?? "").filter(Boolean), await priceScopeFor(ctx.projectId));
    const results: string[] = [];
    let accepted = 0;
    for (const l of i.lines) {
      const it = l.item_number ? items.get(l.item_number.trim()) : undefined;
      if (l.item_number && !it) {
        results.push(`REJECTED ${l.item_number}: not on any loaded sheet.`);
        continue;
      }
      if (it && l.unit_price != null && (it.unitPrice == null || Math.abs(it.unitPrice - l.unit_price) > 0.005)) {
        results.push(`REJECTED ${l.item_number}: price ${money(l.unit_price)} doesn't match the sheet (${money(it.unitPrice)}).`);
        continue;
      }
      if (!it && l.unit_price != null) {
        results.push(`REJECTED "${l.item_name}": a price was given for an item that isn't on a sheet.`);
        continue;
      }
      if (it && l.unit !== it.uom) {
        results.push(`REJECTED ${l.item_number}: unit ${l.unit} doesn't match the sheet's UOM ${it.uom}.`);
        continue;
      }
      await prisma.estimateLine.create({
        data: {
          estimateId: e.id,
          section: l.section,
          itemName: it?.description ?? l.item_name,
          priceItemId: it?.id ?? null,
          supplierItemNumber: it?.itemNumber ?? null,
          quantity: l.quantity,
          unit: it?.uom ?? l.unit,
          unitCost: it?.unitPrice ?? null,
          total: null, // counted only once a person accepts it
          formula: l.formula,
          sourceStatus: "PENDING_AI",
          note: `AI suggestion: ${l.reason}`,
          sortOrder: 9000,
        },
      });
      accepted++;
      results.push(`ADDED as PENDING_AI: ${it?.itemNumber ?? l.item_name} × ${l.quantity} ${it?.uom ?? l.unit}`);
    }
    if (accepted) {
      await prisma.projectActivity.create({ data: { projectId: ctx.projectId, userId: null, kind: "estimate", text: `AI assistant proposed ${accepted} line(s) on ${e.name} for review` } });
      await refreshReadiness(ctx.projectId);
    }
    return results.join("\n");
  },
  async list_open_items(_i, ctx) {
    const o = await prisma.openItem.findMany({ where: { projectId: ctx.projectId, resolved: false } });
    return o.map((x) => `- ${x.text}${x.owner ? ` (${x.owner})` : ""}`).join("\n") || "No open items.";
  },
  async add_open_item(i, ctx) {
    const e = await currentEstimate(ctx.projectId);
    await prisma.openItem.create({ data: { projectId: ctx.projectId, estimateId: e?.id ?? null, text: i.text, owner: i.owner ?? null } });
    return `Added open item: ${i.text}`;
  },
  async get_job_communications(i, ctx) {
    const since = i.since ? new Date(i.since) : null;
    return (await buildJobRecord(ctx.projectId, since && !Number.isNaN(since.getTime()) ? since : null)).text;
  },
  async list_documents(_i, ctx) {
    const d = await prisma.document.findMany({ where: { projectId: ctx.projectId }, orderBy: { uploadedAt: "desc" } });
    return d.map((x) => `${x.id} | ${x.type} | ${x.fileName} | ${x.pages ?? "?"} pages${x.extractedText ? "" : " | no readable text"}`).join("\n") || "No documents.";
  },
  async read_document(i, ctx) {
    const d = await prisma.document.findFirst({ where: { id: i.document_id, projectId: ctx.projectId } });
    if (!d) return "No such document on this job.";
    if (!d.extractedText) return `${d.fileName} has no readable text (scanned or an image). Ask the user for the figures or a text PDF.`;
    const pages = d.extractedText.split("\f");
    let from = 1;
    let to = pages.length;
    const m = i.pages?.match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      from = Math.max(1, +m[1]);
      to = Math.min(pages.length, m[2] ? +m[2] : +m[1]);
    }
    return pages
      .slice(from - 1, to)
      .map((t, k) => `=== ${d.fileName} page ${from + k} ===\n${t}`)
      .join("\n\n");
  },
  async propose_scope(i, ctx) {
    const e = await currentEstimate(ctx.projectId);
    if (!e) return "There's no open estimate on this job.";
    let n = 0;
    for (const [type, list] of [
      ["WE_WILL", i.we_will],
      ["WE_WILL_NOT", i.we_will_not],
    ] as const)
      for (const text of list) if (text.trim()) await prisma.scopeItem.create({ data: { estimateId: e.id, type, text: text.trim(), sortOrder: 5000 + n++ } });
    return `Added ${n} scope item(s) to ${e.name} for the user to edit.`;
  },
};
