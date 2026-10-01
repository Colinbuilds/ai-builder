// Calc engine — acceptance tests 4, 5, 7, 9 plus module rules. Item numbers and coverages come from /data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyWaste, ceilUnits, round, sfToSq } from "@/lib/calc/core";
import { steepTakeoff, type SteepInput } from "@/lib/calc/steep";
import { lowSlopeTakeoff, type LowSlopeInput } from "@/lib/calc/lowslope";
import { deckTakeoff } from "@/lib/calc/deck";
import {
  cheapestHouseWrap,
  sidingAreaUsed,
  sidingTakeoff,
} from "@/lib/calc/siding";
import {
  estimateTotals,
  priceStatusFor,
  toSheetUnit,
} from "@/lib/calc/pricing";
import { parseCoverage } from "@/lib/sheets/coverage";

type Raw = {
  item_number: string;
  description: string;
  unit_price: number | null;
  uom: string;
  sheet_code: string;
  price_status: string;
};
const items: Raw[] = JSON.parse(
  readFileSync(new URL("../data/price_items.json", import.meta.url), "utf8"),
).items;
const item = (num: string) => items.find((i) => i.item_number === num)!;
const cov = (num: string) =>
  parseCoverage(item(num).description, item(num).uom)!.qty;
const s = (value: number | null, source = "TEST") => ({ value, source });

const steep = (over: Partial<SteepInput> = {}): SteepInput => ({
  roofSf: s(3240, "EagleView p.1"),
  eavesLf: s(180),
  rakesLf: s(120),
  ridgesLf: s(40),
  hipsLf: s(95),
  waste: { pct: 5, approved: true, basis: "Company residential default 5%" },
  shingle: {
    itemNumber: "02MLVIA3AB",
    name: item("02MLVIA3AB").description,
    bundlesPerSq: s(cov("02MLVIA3AB"), "parsed 3/SQ"),
  },
  starter: {
    itemNumber: "04MLWSSAB",
    name: item("04MLWSSAB").description,
    lfPerBundle: s(cov("04MLWSSAB")),
  },
  hipRidge: {
    itemNumber: "04MLHR12AB",
    name: item("04MLHR12AB").description,
    sheetLfPerBundle: cov("04MLHR12AB"),
  },
  ridgeVent: { itemNumber: null, name: "Ridge vent", lfPerPiece: s(null) },
  underlayment: {
    itemNumber: "GAFTIGERPAW",
    name: "TEST_ONLY underlayment",
    sqPerRoll: s(10),
  },
  iceWater: {
    itemNumber: "TEST_ONLY_IW",
    name: "TEST_ONLY I&W",
    sqPerRoll: s(2),
    rows: [{ label: "eaves 2 courses", lf: 180, widthFt: 6 }],
  },
  dripEdge: {
    itemNumber: "TEST_ONLY_DE",
    name: "TEST_ONLY drip edge",
    lfPerPiece: s(10),
  },
  coilNailName: item("0150080011").description,
  capNailName: item("4292804534").description,
  ...over,
});
const byKey = (lines: { key: string }[], k: string) =>
  lines.find((l) => l.key === k) as ReturnType<
    typeof steepTakeoff
  >["lines"][number];

describe("core helpers", () => {
  it("rounds up to purchasable units, never down, tolerating float noise", () => {
    expect(ceilUnits(2.0000000000001)).toBe(2);
    expect(ceilUnits(2.01)).toBe(3);
    expect(sfToSq(3240)).toBe(32.4);
    expect(round(applyWaste(32.4, 5), 2)).toBe(34.02);
  });
});

describe("steep-slope — acceptance tests 4 and 5", () => {
  const { lines, roofSqWithWaste } = steepTakeoff(steep());

  it("32.4 SQ at 5% → 34.02 SQ; coil nails 3 BX and cap nails 3 BX (1 BX per 15 SQ)", () => {
    expect(roofSqWithWaste).toBe(34.02);
    expect(byKey(lines, "coil_nails")).toMatchObject({
      itemNumber: "0150080011",
      quantity: 3,
      unit: "BX",
      ruleId: "ROOF-02",
    });
    expect(byKey(lines, "cap_nails")).toMatchObject({
      itemNumber: "4292804534",
      quantity: 3,
      unit: "BX",
      ruleId: "ROOF-03",
    });
    expect(byKey(lines, "coil_nails").formula).toBe(
      "ceil(34.02 SQ ÷ 15 SQ/BX) = 3 BX",
    );
  });

  it("H&R for 95 LF hips + 40 LF ridge = 6 BD at the company 25 LF/BD, not the sheet's 31 LF", () => {
    const hr = byKey(lines, "hip_ridge");
    expect(hr).toMatchObject({ quantity: 6, ruleId: "ROOF-07" });
    expect(hr.formula).toBe("ceil((95 hips + 40 ridges LF) ÷ 25 LF/BD) = 6 BD");
    expect(hr.note).toMatch(/Sheet lists 31 LF\/BD/);
  });

  it("shingles use the formula from the spec and show it", () => {
    expect(byKey(lines, "shingles").formula).toBe(
      "ceil(32.4 SQ × 1.05 × 3 BD/SQ) = 103 BD",
    );
    expect(byKey(lines, "shingles").quantity).toBe(103);
  });

  it("starter covers eaves AND rakes (ROOF-05)", () => {
    expect(byKey(lines, "starter")).toMatchObject({
      quantity: 5,
      ruleId: "ROOF-05",
    }); // (180+120)/70 = 4.29 → 5
  });

  it("ridge vent is always a line (ROOF-04) and stays MISSING until a product and coverage are picked", () => {
    expect(byKey(lines, "ridge_vent")).toMatchObject({
      quantity: null,
      ruleId: "ROOF-04",
    });
    expect(byKey(lines, "ridge_vent").missing).toEqual([
      "lf_per_piece",
      "product",
    ]);
  });

  it("I&W comes from user-entered rows; drip edge defaults to eaves + rakes", () => {
    expect(byKey(lines, "ice_water")).toMatchObject({ quantity: 6 }); // 180×6 = 1080 SF = 10.8 SQ ÷ 2 = 5.4 → 6
    expect(byKey(lines, "drip_edge").formula).toBe(
      "ceil(300 LF (eaves + rakes) ÷ 10 LF/PC) = 30 PC",
    );
  });

  it("missing measurements or unapproved-null waste leave lines MISSING instead of guessing", () => {
    const r = steepTakeoff(
      steep({
        roofSf: s(null),
        waste: { pct: null, approved: false, basis: "not set" },
      }),
    );
    expect(byKey(r.lines, "shingles").quantity).toBeNull();
    expect(byKey(r.lines, "shingles").formula).toMatch(
      /^MISSING: roof_sf, waste_pct/,
    );
    expect(byKey(r.lines, "coil_nails").quantity).toBeNull();
  });
});

describe("low-slope", () => {
  const base = (over: Partial<LowSlopeInput> = {}): LowSlopeInput => ({
    system: "EPDM",
    preSecured: false,
    fieldSf: s(22400, "Roof plan A-501"),
    flashingAllowances: [{ label: "parapets", sf: 1200 }],
    waste: { pct: 7, approved: true, basis: "Approved 7% (EPDM reference)" },
    membrane: {
      itemNumber: "TEST_ONLY_EPDM",
      name: "TEST_ONLY EPDM 10x100",
      sfPerRoll: s(1000),
    },
    insulationLayers: [
      {
        itemNumber: "TEST_ONLY_ISO",
        name: "TEST_ONLY ISO",
        layer: "layer 1",
        boardSf: s(32),
        fastening: [{ label: "field", sf: 22400, perBoard: 5 }],
      },
    ],
    coverBoard: null,
    fastener: {
      itemNumber: "TEST_ONLY_FAST",
      name: "TEST_ONLY fastener",
      perBox: s(1000),
    },
    plate: {
      itemNumber: "TEST_ONLY_PLATE",
      name: "TEST_ONLY plate",
      perBox: s(1000),
    },
    accessories: [],
    ...over,
  });

  it("membrane rolls include flashing allowances and waste", () => {
    const m = byKey(lowSlopeTakeoff(base()), "membrane");
    expect(m.quantity).toBe(26); // (22400+1200)×1.07 = 25252 ÷ 1000 → 26
  });

  it("ROOF-08: EPDM without a cover board gets a MISSING cover-board line", () => {
    const cb = byKey(lowSlopeTakeoff(base()), "cover_board");
    expect(cb).toMatchObject({ ruleId: "ROOF-08", quantity: null });
  });

  it("ROOF-09: pre-secured EPDM always carries pre-securement fasteners and plates", () => {
    const lines = lowSlopeTakeoff(base({ preSecured: true }));
    expect(byKey(lines, "presecure_fasteners")).toMatchObject({
      ruleId: "ROOF-09",
      quantity: null,
    });
    expect(byKey(lines, "presecure_plates")).toMatchObject({
      ruleId: "ROOF-09",
      quantity: null,
    });
  });

  it("fasteners come only from the entered pattern", () => {
    const lines = lowSlopeTakeoff(base());
    expect(byKey(lines, "fasteners").quantity).toBe(4); // 22400/32×5 = 3500 → 4 BX of 1000
    const none = lowSlopeTakeoff(
      base({
        insulationLayers: [
          { itemNumber: "X", name: "ISO", layer: "l1", boardSf: s(32) },
        ],
      }),
    );
    expect(byKey(none, "fasteners").formula).toMatch(
      /MISSING: fastening_pattern/,
    );
  });
});

describe("deck", () => {
  it("sheets and fasteners from user-entered profile coverage and pattern", () => {
    const lines = deckTakeoff({
      deckSf: s(10000),
      waste: { pct: 5, approved: true, basis: "approved" },
      deck: {
        itemNumber: "TEST_ONLY_DECK",
        name: "TEST_ONLY 1.5B 22ga",
        sfPerSheet: s(60),
        unit: "SH",
      },
      sideLapFastenersPerSheet: {
        value: 6,
        source: "spec",
        name: "TEST_ONLY SL screw",
        itemNumber: "TEST_ONLY_SL",
        perBox: s(500),
      },
      weldsPerSheet: s(12),
    });
    expect(byKey(lines, "deck").quantity).toBe(175); // 10500/60
    expect(byKey(lines, "side_lap_fasteners").quantity).toBe(3); // 1050/500
    expect(byKey(lines, "puddle_welds").quantity).toBe(2100);
  });
});

describe("siding — acceptance test 7", () => {
  it("uses the EagleView siding area only: 2,400 SF with 600 SF masonry and 310 SF openings → 2,400 SF", () => {
    const r = sidingAreaUsed([
      { key: "siding_sf", value: 2400, status: "CONFIRMED" },
      { key: "masonry_sf", value: 600, status: "CONFIRMED" },
      { key: "openings_sf", value: 310, status: "CONFIRMED" },
      { key: "siding_sf", value: 999, status: "EXTRACTED_PENDING" }, // unconfirmed never counts
    ]);
    expect(r.sf).toBe(2400);
    expect(r.excluded.masonrySf).toBe(600);
    expect(r.formula).toMatch(/SID-01/);
  });

  it('plank count needs a user-confirmed exposure; default product is 8.25" HardiePlank (SID-03)', () => {
    const plank = item("25H5KEC8");
    expect(plank.description).toMatch(/8\.25/);
    const lines = sidingTakeoff({
      sidingSf: s(2400),
      waste: {
        pct: 5,
        approved: true,
        basis: "Company residential default 5%",
      },
      plank: {
        itemNumber: "25H5KEC8",
        name: plank.description,
        exposureIn: s(null),
        lengthFt: s(12),
      },
      houseWrap: null,
      trim: [
        {
          key: "outside_corners",
          name: "TEST_ONLY corner",
          itemNumber: "X",
          lf: s(160),
          pieceLengthFt: s(12),
        },
      ],
      counted: [],
    });
    expect(byKey(lines, "siding").formula).toMatch(/MISSING: exposure_in/);
    expect(byKey(lines, "outside_corners").quantity).toBe(14);
  });

  it("SID-04 picks the cheapest wrap per SF of coverage on the sheet in use", () => {
    const wraps = items
      .filter((i) => /wrap/i.test(i.description) && i.uom === "RL")
      .map((i) => ({
        itemNumber: i.item_number,
        name: i.description,
        unitPrice: i.unit_price,
        coverageSf:
          parseCoverage(i.description, i.uom)?.unit === "SF/RL"
            ? parseCoverage(i.description, i.uom)!.qty
            : null,
        sheetCode: i.sheet_code,
      }));
    const nx = cheapestHouseWrap(wraps, "NX");
    expect(nx?.name).toMatch(/House Wrap/);
    expect(cheapestHouseWrap(wraps, "SS")).toBeNull();
  });
});

describe("pricing and totals — acceptance test 9", () => {
  it("a line with a non-existent item number is MISSING_ITEM, left out of totals, and the total is INCOMPLETE", () => {
    const capNail = item("4292804534");
    const good = priceStatusFor(
      3,
      {
        itemNumber: "4292804534",
        unitPrice: capNail.unit_price,
        priceStatus: "LISTED",
        uom: "BX",
        sheetStatus: "STALE",
      },
      "4292804534",
    );
    expect(good).toEqual({
      sourceStatus: "SHEET_STALE",
      unitCost: 19.99,
      total: 59.97,
    });
    const bad = priceStatusFor(4, null, "NOPE-123");
    expect(bad.sourceStatus).toBe("MISSING_ITEM");
    const t = estimateTotals(
      [
        { section: "MATERIAL_ROOFING", ...good },
        { section: "MATERIAL_ROOFING", ...bad },
      ],
      [{ total: 1000, sourceStatus: "VERIFIED" }],
      null,
    );
    expect(t.materials).toBe(59.97);
    expect(t.incomplete).toBe(true);
    expect(t.grandTotal).toBe(1059.97);
  });

  it("CALL items and expired sheets", () => {
    expect(
      priceStatusFor(
        2,
        {
          itemNumber: "25H5SSC6AW",
          unitPrice: null,
          priceStatus: "CALL",
          uom: "PNL",
          sheetStatus: "STALE",
        },
        "25H5SSC6AW",
      ).sourceStatus,
    ).toBe("CALL_FOR_PRICE");
    expect(
      priceStatusFor(
        2,
        {
          itemNumber: "x",
          unitPrice: 10,
          priceStatus: "LISTED",
          uom: "EA",
          sheetStatus: "EXPIRED",
        },
        "x",
      ).sourceStatus,
    ).toBe("SHEET_EXPIRED");
  });

  it("totals are complete only when every line and labor has a number", () => {
    const t = estimateTotals(
      [{ section: "MATERIAL_ROOFING", total: 100, sourceStatus: "VERIFIED" }],
      [{ total: 50, sourceStatus: "VERIFIED" }],
      5,
    );
    expect(t).toMatchObject({
      subtotal: 150,
      contingency: 7.5,
      grandTotal: 157.5,
      incomplete: false,
    });
  });
});

describe("unit conversion to the sheet's UOM", () => {
  it("converts bundles to squares only with the item's printed coverage, and never silently otherwise", () => {
    expect(
      toSheetUnit(103, "BD", {
        uom: "SQ",
        coverageQty: 3,
        coverageUnit: "BD/SQ",
      }),
    ).toMatchObject({ quantity: 34.3333, ok: true, note: "Order 103 BD." });
    expect(
      toSheetUnit(5, "BD", {
        uom: "BD",
        coverageQty: 70,
        coverageUnit: "LF/BD",
      }),
    ).toMatchObject({ quantity: 5, ok: true });
    const bad = toSheetUnit(12, "PC", {
      uom: "BD",
      coverageQty: null,
      coverageUnit: null,
    });
    expect(bad.ok).toBe(false);
    expect(bad.note).toMatch(/Not priced/);
  });
});

describe("coverage: piece lengths in feet", () => {
  it("reads one foot-marked length on items sold by the piece, and nothing ambiguous", () => {
    expect(
      parseCoverage("Lomanco PRO4SWN Omniridge Pro 4'", "PC"),
    ).toMatchObject({ qty: 4, unit: "LF/PC" });
    expect(
      parseCoverage("NDX 3/4\" X 12' Matte J-Channel - WHITE", "PC"),
    ).toMatchObject({ qty: 12, unit: "LF/PC" });
    expect(
      parseCoverage("Galvanized Starter Strip 3.5\" 10'", "PC"),
    ).toMatchObject({ qty: 10, unit: "LF/PC" });
    expect(parseCoverage("MH Aeroweb 6' Hose", "EA")).toBeNull(); // not sold by the piece
    expect(parseCoverage("Drip Edge", "PC")).toBeNull(); // no length printed → stays MISSING
    expect(parseCoverage("Flashing 10' x 50'", "PC")?.unit).toBe("SF/PC"); // both sides in feet is an area
  });
});

describe("ice & water company standard", () => {
  it("uses the rows on the estimate first, else the standard on confirmed eaves/valleys, else nothing", async () => {
    const { iceWaterRows } = await import("@/lib/estimates/takeoff");
    const m = new Map([
      ["eaves_lf", { value: 180, source: "EV p.2" }],
      ["valleys_lf", { value: 24, source: "EV p.2" }],
    ]);
    const ctx = (std?: {
      eavesFt: number | null;
      valleysFt: number | null;
    }) => ({ m, items: new Map(), waste: {} as never, iceWaterStd: std });
    const entered = [{ label: "Eaves", lf: 100, widthFt: 3 }];
    expect(iceWaterRows(entered, ctx({ eavesFt: 6, valleysFt: 3 }))).toBe(
      entered,
    );
    expect(iceWaterRows([], ctx())).toEqual([]);
    expect(iceWaterRows([], ctx({ eavesFt: null, valleysFt: null }))).toEqual(
      [],
    );
    expect(iceWaterRows([], ctx({ eavesFt: 6, valleysFt: 3 }))).toEqual([
      { label: "Eaves (company standard 6 FT)", lf: 180, widthFt: 6 },
      { label: "Valleys (company standard 3 FT)", lf: 24, widthFt: 3 },
    ]);
    m.delete("valleys_lf");
    expect(iceWaterRows([], ctx({ eavesFt: 6, valleysFt: 3 }))).toEqual([]); // valleys not confirmed → MISSING, not zero
    expect(iceWaterRows([], ctx({ eavesFt: 6, valleysFt: null }))).toHaveLength(
      1,
    );
  });
});
