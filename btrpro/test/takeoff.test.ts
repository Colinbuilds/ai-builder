// TEST_ONLY geometry for the plan takeoff tool — no real plans.
import { describe, expect, it } from "vitest";
import { hipFactor, measureItem, pageTotals, parseFeet, presetUpf, slopeFactor, type PageTakeoff } from "@/lib/takeoff/geometry";

const page = (over: Partial<PageTakeoff> = {}): PageTakeoff => ({
  view: "ROOF_PLAN",
  pitch: 6,
  scale: { upf: 10, method: "CALIBRATED", label: "test", check: { expectedFt: 20, measuredFt: 20.05, diffPct: 0.25 } },
  items: [],
  ...over,
});

describe("takeoff math", () => {
  it("reads feet and inches", () => {
    expect(parseFeet("12'6\"")).toBe(12.5);
    expect(parseFeet("12' 6")).toBe(12.5);
    expect(parseFeet("12-6")).toBe(12.5);
    expect(parseFeet("120")).toBe(120);
    expect(parseFeet("12'13\"")).toBeNull();
    expect(parseFeet("abc")).toBeNull();
  });

  it("uses the standard pitch factors", () => {
    expect(slopeFactor(6)).toBeCloseTo(1.118, 3);
    expect(slopeFactor(3)).toBeCloseTo(1.0308, 4);
    expect(hipFactor(6)).toBeCloseTo(1.0607, 4); // = 1.5 per run ÷ √2 on the plan diagonal
    expect(presetUpf(1 / 8)).toBe(9); // 1/8" = 1' → 9 PDF points per foot
  });

  it("applies pitch only to sloped runs on a roof plan", () => {
    const eave = measureItem({ id: "a", type: "eave", points: [[0, 0], [100, 0]] }, page());
    expect(eave?.value).toBe(10);
    const rake = measureItem({ id: "b", type: "rake", points: [[0, 0], [0, 100]] }, page());
    expect(rake?.value).toBeCloseTo(11.18, 2);
    expect(rake?.formula).toMatch(/6\/12 slope factor/);
    const onElevation = measureItem({ id: "c", type: "rake", points: [[0, 0], [0, 100]] }, page({ view: "ELEVATION" }));
    expect(onElevation?.value).toBe(10);
    // no pitch → refuse to guess
    expect(measureItem({ id: "d", type: "rake", points: [[0, 0], [0, 100]] }, page({ pitch: null }))).toBeNull();
    // item pitch overrides the sheet
    expect(measureItem({ id: "e", type: "hip", pitch: 12, points: [[0, 0], [100, 0]] }, page())?.value).toBeCloseTo(10 * Math.sqrt(1 + 144 / 288), 4);
  });

  it("totals a roof: squares, allowance, rounding up", () => {
    const { totals, problems } = pageTotals(
      page({ items: [{ id: "r", type: "roof_area", points: [[0, 0], [400, 0], [400, 250], [0, 250]] }, { id: "v", type: "penetration", points: [[1, 1], [2, 2], [3, 3]] }] }),
    );
    // 40 ft × 25 ft = 1,000 SF plan × 1.118 = 1,118.03 SF; +1% = 1,129.22 → 1,130
    const sf = totals.find((t) => t.key === "roof_total_sf")!;
    expect(sf.raw).toBeCloseTo(1118.03, 2);
    expect(sf.value).toBe(1130);
    expect(totals.find((t) => t.key === "roof_sq")!.value).toBe(11.3);
    expect(totals.find((t) => t.key === "penetrations_count")!.value).toBe(3);
    expect(problems).toEqual([]);
  });

  it("nets siding: wall − masonry − openings, with opening count and perimeter", () => {
    const { totals } = pageTotals(
      page({
        view: "ELEVATION",
        pitch: null,
        items: [
          { id: "w", type: "wall_area", points: [[0, 0], [1000, 0], [1000, 300], [0, 300]] }, // 100 × 30 = 3,000 SF
          { id: "m", type: "masonry", points: [[0, 250], [1000, 250], [1000, 300], [0, 300]] }, // 500 SF
          { id: "o", type: "rough_opening", points: [[100, 100], [130, 150]] }, // 3 × 5 = 15 SF, 16 LF
        ],
      }),
      0,
    );
    const get = (k: string) => totals.find((t) => t.key === k)!.value;
    expect(get("siding_sf")).toBe(2485);
    expect(get("rough_openings_count")).toBe(1);
    expect(get("opening_perimeter_lf")).toBe(16);
  });

  it("warns on an unchecked or failed scale and roof area off the roof plan", () => {
    const off = pageTotals(page({ view: "ELEVATION", scale: { upf: 10, method: "PRESET", label: "x", check: { expectedFt: 100, measuredFt: 103, diffPct: 3 } }, items: [{ id: "r", type: "roof_area", points: [[0, 0], [10, 0], [10, 10]] }] }));
    expect(off.problems.join(" ")).toMatch(/off by 3%/);
    expect(off.problems.join(" ")).toMatch(/ROOF-01/);
    expect(pageTotals(page({ scale: null, items: [{ id: "e", type: "eave", points: [[0, 0], [1, 1]] }] })).problems[0]).toMatch(/Set the scale/);
  });
});

import { ventilation } from "@/lib/estimates/ventilation";
describe("ventilation (Lomanco method)", () => {
  it("matches Lomanco's 2,000 SF example and sizes vents", () => {
    const v = ventilation(2000, 300, 50, 36);
    expect(v.totalSqIn).toBe(960);
    expect(v.exhaustSqIn).toBe(480);
    expect(v.exhaustCount).toBe(10); // 480 ÷ 50
    expect(v.intakeCount).toBe(14); // 480 ÷ 36 = 13.3 → 14
  });
  it("TEST_ONLY attic: 1/300 vs 1/150 with 144 sq in louvers", () => {
    expect(ventilation(11564, 300, 144, null).exhaustCount).toBe(20);
    expect(ventilation(11564, 150, 144, null).exhaustCount).toBe(39);
    expect(ventilation(11564, 300, null, null).exhaustCount).toBeNull();
  });
});
