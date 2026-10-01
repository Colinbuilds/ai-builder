// TEST_ONLY AI draft takeoff: the AI's 0–1000 points land on the right place on the sheet, junk is dropped,
// and AI drafts are never counted or sent until accepted.
import { afterAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/lib/ai/claude";
import { aiDraftTakeoff } from "@/lib/takeoff/ai";
import { pageTotals, type PageTakeoff } from "@/lib/takeoff/geometry";

afterAll(() => setAiClientForTests(null));

function fake(output: unknown, seen: unknown[] = []) {
  setAiClientForTests({ beta: { messages: { parse: async (b: unknown) => (seen.push(b), { stop_reason: "end_turn", model: "fake", parsed_output: output }) } } } as never);
}

describe("AI draft takeoff", () => {
  it("maps points from the on-screen region back to the sheet and keeps only allowed, complete items", async () => {
    const seen: Record<string, unknown>[] = [];
    fake(
      {
        sheet: "roof plan",
        items: [
          { type: "eave", points: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }], note: "front eave" },
          { type: "roof_area", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], note: "main plane" },
          { type: "wall_area", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], note: "not allowed on a roof plan" },
          { type: "ridge", points: [{ x: 500, y: 500 }], note: "only one point" },
          { type: "chimney", points: [{ x: 500, y: 250 }, { x: 600, y: 250 }], note: "chimney" },
          { type: "bogus", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], note: "?" },
        ],
        cannot_trace: ["back porch roof is hidden by a note"],
      },
      seen,
    );
    const r = await aiDraftTakeoff({ imageBase64: "AAAA", mediaType: "image/jpeg", region: { x: 100, y: 200, w: 400, h: 300 }, view: "ROOF_PLAN" });
    expect(r.items.map((i) => i.type)).toEqual(["eave", "roof_area", "chimney"]);
    expect(r.dropped).toBe(3);
    expect(r.items[0].points).toEqual([[100, 500], [500, 500]]);
    expect(r.items[2].points).toEqual([[300, 275]]);
    expect(r.items.every((i) => i.ai)).toBe(true);
    expect(r.cannotTrace).toEqual(["back porch roof is hidden by a note"]);
    // the image went to the model, with the estimator system prompt and the roof-plan instructions
    const body = seen[0] as { messages: { content: { type: string }[] }[]; system: { text: string }[] };
    expect(body.messages[0].content[0].type).toBe("image");
    // a non-streaming request: the SDK refuses large max_tokens without streaming
    expect((seen[0] as { max_tokens: number }).max_tokens).toBeLessThanOrEqual(16000);
    expect(body.system.map((s) => s.text).join("\n")).toMatch(/ROOF PLAN/);
  });

  it("AI drafts don't count toward totals until accepted", async () => {
    const page: PageTakeoff = {
      view: "ELEVATION",
      pitch: null,
      scale: { upf: 10, method: "CALIBRATED", label: "TEST_ONLY", check: { expectedFt: 10, measuredFt: 10, diffPct: 0 } },
      items: [{ id: "a", type: "starter", points: [[0, 0], [100, 0]], ai: true }],
    };
    let t = pageTotals(page);
    expect(t.totals).toEqual([]);
    expect(t.problems.join(" ")).toMatch(/AI-drawn item isn't reviewed/);
    t = pageTotals({ ...page, items: [{ ...page.items[0], ai: undefined }] });
    expect(t.totals.find((x) => x.key === "siding_starter_lf")?.raw).toBe(10);
  });
});
