import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { createEstimate, decideAiLine } from "@/lib/estimates/service";
import { runTool } from "@/lib/ai/assistant-tools";
import { runAssistant, type StreamEvent } from "@/lib/ai/assistant";
import { setAiClientForTests } from "@/lib/ai/claude";

afterAll(() => {
  setAiClientForTests(null);
  return prisma.$disconnect();
});

const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};
async function jobWithEstimate() {
  const a = await admin();
  const p = await createProject({ name: "TEST_ONLY AI job", market: "RESIDENTIAL", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
  const e = await createEstimate(p.id, "STEEP", a);
  return { a, p, e, ctx: { projectId: p.id, user: a } };
}

describe("acceptance test 10 — AI proposals are validated server-side", () => {
  it("rejects a mismatched price or unknown item; accepted lines are PENDING_AI and not counted until a person accepts", async () => {
    const { a, e, ctx } = await jobWithEstimate();
    const r = await runTool(
      "propose_line_items",
      {
        lines: [
          { section: "MATERIAL_ROOFING", item_number: "4292804534", item_name: "cap nails", quantity: 3, unit: "BX", unit_price: 17.5, reason: "ROOF-03", formula: null },
          { section: "MATERIAL_ROOFING", item_number: "MADE-UP-9", item_name: "vent", quantity: 2, unit: "EA", unit_price: null, reason: "x", formula: null },
          { section: "MATERIAL_ROOFING", item_number: "0150080011", item_name: "coil nails", quantity: 3, unit: "BX", unit_price: 40, reason: "ROOF-02", formula: "ceil(34.02/15)" },
        ],
      },
      ctx,
    );
    expect(r.content).toMatch(/REJECTED 4292804534: price \$17\.50 doesn't match the sheet \(\$19\.99\)/);
    expect(r.content).toMatch(/REJECTED MADE-UP-9: not on any loaded sheet/);
    expect(r.content).toMatch(/ADDED as PENDING_AI: 0150080011 × 3 BX/);
    const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sourceStatus: "PENDING_AI", total: null });
    await decideAiLine(lines[0].id, true, a);
    expect(await prisma.estimateLine.findUniqueOrThrow({ where: { id: lines[0].id } })).toMatchObject({ total: 120 });
  });

  it("validates tool input shapes", async () => {
    const { ctx } = await jobWithEstimate();
    const r = await runTool("get_price_item", { item: 1 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Invalid input/);
  });

  it("run_calc uses the deterministic calculator, and read_document refuses docs from other jobs", async () => {
    const { ctx } = await jobWithEstimate();
    const calc = await runTool("run_calc", { module: "steep" }, ctx);
    expect(calc.content).toMatch(/MISSING/); // no measurements confirmed on this job
    expect((await runTool("read_document", { document_id: "nope" }, ctx)).content).toMatch(/No such document/);
  });
});

describe("assistant loop", () => {
  it("streams text, runs tools between turns, feeds results back, and saves the conversation", async () => {
    const { a, p } = await jobWithEstimate();
    const bodies: { messages: { role: string; content: unknown }[]; tools: { name: string; eager_input_streaming?: boolean }[]; fallbacks: string }[] = [];
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "text", text: "Checking the sheet." }, { type: "tool_use", id: "t1", name: "get_price_item", input: { item_number: "4292804534" } }], text: "Checking the sheet." },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Cap nails are $19.99/BX on SS." }], text: "Cap nails are $19.99/BX on SS." },
    ];
    setAiClientForTests({
      beta: {
        messages: {
          stream: (body: never) => {
            bodies.push(JSON.parse(JSON.stringify(body)));
            const r = replies[bodies.length - 1];
            let cb: (t: string) => void = () => {};
            return {
              on: (_: string, f: (t: string) => void) => {
                cb = f;
              },
              finalMessage: async () => {
                cb(r.text);
                return { ...r, stop_details: null };
              },
            };
          },
        },
      },
    } as never);
    const events: StreamEvent[] = [];
    await runAssistant(p.id, a, "What do cap nails cost?", (e) => events.push(e));
    expect(events.filter((e) => e.type === "tool")).toEqual([{ type: "tool", name: "get_price_item" }]);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toContain("$19.99/BX");
    const toolResult = bodies[1].messages.at(-1)!.content as { type: string; content: string }[];
    expect(toolResult[0]).toMatchObject({ type: "tool_result" });
    expect(toolResult[0].content).toMatch(/4292804534 \| 1\.25" Plastic Cap Nails 2000\/BX \| \$19\.99\/BX/);
    expect(bodies[0].tools.every((t) => t.eager_input_streaming)).toBe(true);
    expect(bodies[0].fallbacks).toBe("default");
    const saved = await prisma.assistantMessage.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" } });
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved[1].content).toContain("$19.99/BX");
  });

  it("stops on a refusal and says so", async () => {
    const { a, p } = await jobWithEstimate();
    setAiClientForTests({
      beta: { messages: { stream: () => ({ on: () => {}, finalMessage: async () => ({ stop_reason: "refusal", stop_details: { category: null }, content: [] }) }) } },
    } as never);
    const events: StreamEvent[] = [];
    await runAssistant(p.id, a, "hi", (e) => events.push(e));
    expect(events).toContainEqual({ type: "error", message: "BTRbot declined this request. Nothing was saved." });
  });
});
