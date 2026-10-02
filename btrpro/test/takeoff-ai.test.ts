// TEST_ONLY AI draft takeoff: the AI's 0–1000 points land on the right place on the sheet, junk is dropped,
// and AI drafts are never counted or sent until accepted.
import { afterAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/lib/ai/claude";
import { aiDraftTakeoff, matchPreset } from "@/lib/takeoff/ai";
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
        sheet_type: "ROOF_PLAN",
        printed_scale: null,
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
    expect(body.system.map((s) => s.text).join("\n")).toMatch(/ROOF_PLAN/);
    expect(r.detectedView).toBe("ROOF_PLAN");
  });

  it("a sheet set as roof plan that is really an elevation gets its walls traced, not refused", async () => {
    fake({
      sheet: "south elevation",
      sheet_type: "ELEVATION",
      printed_scale: 'SCALE: 1/8" = 1\'-0"',
      items: [
        { type: "wall_area", points: [{ x: 0, y: 400 }, { x: 1000, y: 400 }, { x: 1000, y: 900 }, { x: 0, y: 900 }], note: "main wall" },
        { type: "window", points: [{ x: 100, y: 500 }, { x: 200, y: 500 }, { x: 200, y: 700 }, { x: 100, y: 700 }], note: "window" },
        { type: "patio_door", points: [{ x: 300, y: 450 }, { x: 380, y: 450 }, { x: 380, y: 700 }, { x: 300, y: 700 }], note: "slider behind railing" },
        { type: "roof_area", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 500, y: 300 }], note: "roof seen in elevation" },
      ],
      scale_bar: { x0: 100, y0: 950, x1: 225, y1: 950, feet: 10 },
      counted: { windows: 1, doors: 0, patio_sliders: 1, garage_doors: 0 },
      cannot_trace: ["1", "2", "3", "4", "5", "6", "7"],
    });
    const r = await aiDraftTakeoff({ imageBase64: "AAAA", mediaType: "image/jpeg", region: { x: 0, y: 0, w: 1000, h: 1000 }, view: "ROOF_PLAN" });
    expect(r.detectedView).toBe("ELEVATION");
    expect(r.items.map((i) => i.type)).toEqual(["wall_area", "window", "patio_door"]);
    // the scale bar comes back in sheet units (region is 0..1000 here): 125 units = 10'
    expect(r.scaleBar).toEqual({ a: [100, 950], b: [225, 950], feet: 10 });
    expect(r.counted.patio_sliders).toBe(1);
    expect(r.printedScale).toBe('1/8" = 1\'-0"');
    expect(r.cannotTrace).toHaveLength(5);
  });

  it("a floor plan traces nothing", async () => {
    fake({ sheet: "first floor plan", sheet_type: "FLOOR_PLAN", printed_scale: null, items: [{ type: "wall_area", points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }], note: "x" }], cannot_trace: [] });
    const r = await aiDraftTakeoff({ imageBase64: "AAAA", mediaType: "image/jpeg", region: { x: 0, y: 0, w: 10, h: 10 }, view: "ELEVATION" });
    expect(r.detectedView).toBeNull();
    expect(r.items).toEqual([]);
  });

  it("an opening inside masonry isn't taken out twice; shake is reported apart from lap", () => {
    const page: PageTakeoff = {
      view: "ELEVATION",
      pitch: null,
      scale: { upf: 1, method: "CALIBRATED", label: "TEST_ONLY", check: { expectedFt: 10, measuredFt: 10, diffPct: 0 } },
      items: [
        { id: "w", type: "wall_area", points: [[0, 0], [100, 0], [100, 30], [0, 30]] }, // 3000
        { id: "m", type: "masonry", points: [[0, 20], [100, 20], [100, 30], [0, 30]] }, // 1000 (lower floor stone)
        { id: "g", type: "garage_door", points: [[10, 22], [20, 30]] }, // 80, inside the stone
        { id: "s", type: "patio_door", points: [[40, 5], [46, 12]] }, // 42, in siding
        { id: "k", type: "shake_area", points: [[60, 0], [80, 0], [80, 5], [60, 5]] }, // 100
      ],
    };
    const t = pageTotals(page, 0).totals;
    const v = (k: string) => t.find((x) => x.key === k)?.raw;
    expect(v("siding_sf")).toBe(3000 - 1000 - 42);
    expect(v("lap_siding_sf")).toBe(3000 - 1000 - 42 - 100);
    expect(v("garage_door_count")).toBe(1);
    expect(v("rough_openings_count")).toBe(2);
  });

  it("reads printed scales", () => {
    expect(matchPreset('1/4" = 1\'-0"')).toBe('1/4" = 1\'-0"');
    expect(matchPreset("SCALE: 3/32\"=1'")).toBe('3/32" = 1\'-0"');
    expect(matchPreset('1" = 1\'-0"')).toBe('1" = 1\'-0"');
    expect(matchPreset("NTS")).toBeNull();
    expect(matchPreset(null)).toBeNull();
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
    expect(t.problems.join(" ")).toMatch(/BTRbot-drawn item isn't reviewed/);
    t = pageTotals({ ...page, items: [{ ...page.items[0], ai: undefined }] });
    expect(t.totals.find((x) => x.key === "siding_starter_lf")?.raw).toBe(10);
  });
});
