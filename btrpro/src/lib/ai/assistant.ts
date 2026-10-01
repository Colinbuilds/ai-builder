// The per-job AI estimator assistant: streaming tool loop (BUILD_PROMPT §8).
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { aiClient, AiRefusalError, FALLBACK_BETAS, MODEL, system } from "./claude";
import { ASSISTANT_TOOLS, runTool, type ToolCtx } from "./assistant-tools";
import { INTAKE_BY_KEY } from "@/lib/projects/intake";
import { sheetDateStatus } from "@/lib/sheets/date-status";
import { STAGE_LABEL } from "@/lib/projects/workflow";

const MAX_TOOL_ROUNDS = 12;

const ASSISTANT_RULES = `You are BTRbot, the estimator assistant inside BTRpro for one BTR job (introduce yourself as BTRbot if asked who you are). The user is on the job's page.
- Use the tools for every fact: prices and item numbers only from search_price_items / get_price_item, measurements only from get_measurements, and all quantities from run_calc. Never do takeoff arithmetic yourself.
- To put something on the estimate, call propose_line_items; lines arrive as PENDING_AI for a person to accept. Say so.
- Follow CLAUDE.md exactly: missing information stays MISSING, assumptions need approval and are NOT FOR FINAL BID, no substitutions without explicit approval.
- Ask one targeted question at a time. Be brief and practical; results over explanations. Markdown tables are fine.
- You work only while answering this message. Never say you'll do something later or in the background.`;

async function jobSnapshot(projectId: string) {
  const [p, intake, measures, estimate, sheets] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { clientCompany: true } }),
    prisma.intakeField.findMany({ where: { projectId } }),
    prisma.measurement.groupBy({ by: ["status"], where: { projectId }, _count: true }),
    prisma.estimate.findFirst({ where: { projectId }, orderBy: { revision: "desc" }, include: { lines: true, laborLines: true } }),
    prisma.priceSheet.findMany({ where: { isActive: true, isLoaded: true } }),
  ]);
  const missing = intake.filter((f) => f.status === "MISSING").map((f) => INTAKE_BY_KEY.get(f.key)?.label ?? f.key);
  const lineSummary = estimate
    ? estimate.lines.map((l) => `${l.itemName} [${l.supplierItemNumber ?? "—"}] ${l.quantity ?? "MISSING"} ${l.unit ?? ""} ${l.sourceStatus}`).join("; ")
    : "no estimate yet";
  return [
    `Job: ${p.name} (${p.market.toLowerCase()}), stage ${STAGE_LABEL[p.status]}, readiness ${p.readiness}.`,
    p.address && `Address: ${p.address}.`,
    p.clientCompany && `Client: ${p.clientCompany.name}.`,
    p.clientCompany?.type === "BUILDER" &&
      `PRICING: this is a ${p.clientCompany.name} job. Price only from ${p.clientCompany.name}'s own sheets (the tools already do). Items not on them: ${p.clientCompany.pricingFallback === "STANDARD" ? "BTR standard price, flagged" : "MISSING"}. Never quote BTR standard prices as builder pricing.`,
    p.isPublic && `Public job${p.isTaxExempt ? `, tax-exempt, Form 17 ${p.form17Status}` : ""}.`,
    p.isInsuranceClaim && `Insurance claim ${p.claimNumber ?? ""} with ${p.insuranceCarrier ?? "carrier"}.`,
    `Missing intake: ${missing.join(", ") || "none"}.`,
    `Measurements by status: ${measures.map((m) => `${m.status} ${m._count}`).join(", ") || "none"}.`,
    `Current estimate: ${estimate ? `${estimate.name} (${estimate.scopeType}${estimate.locked ? ", locked" : ""}), waste approved: ${estimate.wasteApproved}, ${estimate.laborLines.length} labor lines. Lines: ${lineSummary}` : "none"}.`,
    `Price sheets: ${sheets.map((s) => `${s.code} ${sheetDateStatus(s).status}`).join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type StreamEvent = { type: "text"; text: string } | { type: "tool"; name: string } | { type: "error"; message: string };

export async function runAssistant(projectId: string, user: { id: string; name: string }, userText: string, emit: (e: StreamEvent) => void) {
  const history = await prisma.assistantMessage.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, take: 40 });
  await prisma.assistantMessage.create({ data: { projectId, userId: user.id, role: "user", content: userText } });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: `${user.name}: ${userText}` },
  ];
  const sys = [...system(ASSISTANT_RULES), { type: "text" as const, text: `Current job snapshot:\n${await jobSnapshot(projectId)}` }];
  const ctx: ToolCtx = { projectId, user };
  const trace: { name: string; input: unknown; ok: boolean }[] = [];
  let finalText = "";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const stream = aiClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        betas: FALLBACK_BETAS,
        fallbacks: "default",
        system: sys,
        output_config: { effort: "high" },
        tools: ASSISTANT_TOOLS,
        messages,
      });
      stream.on("text", (delta) => {
        finalText += delta;
        emit({ type: "text", text: delta });
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new AiRefusalError(msg.stop_details?.category ?? null);
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason === "max_tokens" && uses.length) throw new Error("The answer was cut off mid-tool call. Try a narrower question.");
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      if (!uses.length) break;
      messages.push({ role: "assistant", content: msg.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        emit({ type: "tool", name: u.name });
        const r = await runTool(u.name, u.input, ctx);
        trace.push({ name: u.name, input: u.input, ok: r.ok });
        results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, ...(r.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
      if (finalText && !finalText.endsWith("\n")) {
        finalText += "\n\n";
        emit({ type: "text", text: "\n\n" });
      }
      if (round === MAX_TOOL_ROUNDS) throw new Error("Stopped after too many tool calls. Try a narrower question.");
    }
  } catch (e) {
    const message =
      e instanceof AiRefusalError
        ? e.message
        : e instanceof Anthropic.APIError
          ? `BTRbot service error (${e.status ?? "network"}).`
          : e instanceof Error
            ? e.message
            : String(e);
    emit({ type: "error", message });
    finalText += `\n\n_${message}_`;
  }
  await prisma.assistantMessage.create({ data: { projectId, userId: null, role: "assistant", content: finalText.trim() || "(no answer)", toolTrace: trace as never } });
}

export const QUICK_ACTIONS: { key: string; label: string; prompt: string }[] = [
  {
    key: "start",
    label: "Start project",
    prompt:
      "Start this project: give me the concise missing-information checklist (what's MISSING and the exact source needed for each), then do whatever safe preliminary work the confirmed data allows, labeled INCOMPLETE where it depends on missing items.",
  },
  { key: "missing", label: "What's missing?", prompt: "What's missing before this can be a hard bid? List blockers in order of what to chase first, with the exact source for each." },
  {
    key: "co",
    label: "Review change order",
    prompt:
      "Review the change order document(s) on this job against the current estimate. Give a table: item | CO says | our estimate | issue (missing scope, duplicate scope, quantity or pricing discrepancy) | labor/schedule impact | recommended adjustment. Only use figures from the documents and tools.",
  },
  {
    key: "subs",
    label: "Compare sub proposals",
    prompt:
      "Compare the subcontractor proposals on this job. Give a table with a column per proposal and rows for inclusions, exclusions, unit pricing, material specs, warranty, labor assumptions, and risks/gaps. Flag anything missing or inconsistent.",
  },
  { key: "scope", label: "Write scope", prompt: "Write the We Will / We Will Not scope for the current estimate from the confirmed scope, measurements, and lines, and add it with propose_scope so I can edit it." },
];
