// Saved takeoff settings per estimate (products picked, coverages, patterns, rows) and how they become
// calc-engine inputs. Coverage is prefilled only from explicit description patterns whose unit matches
// what the formula needs; otherwise the user enters it (with a source) or the line stays MISSING.
import { steepTakeoff, type SteepInput } from "@/lib/calc/steep";
import { lowSlopeTakeoff, type LowSlopeInput } from "@/lib/calc/lowslope";
import { deckTakeoff, type DeckInput } from "@/lib/calc/deck";
import { sidingTakeoff, type SidingInput } from "@/lib/calc/siding";
import type { CalcLine, Sourced, Waste } from "@/lib/calc/core";

export type Pick = {
  itemNumber: string | null;
  sheetCode?: string | null;
  name?: string | null;
  coverage?: number | null;
  coverageSource?: string | null;
};
const P = (): Pick => ({ itemNumber: null });

export type Zone = { label: string; sf: number; perBoard: number };
export type SteepConfig = {
  shingle: Pick;
  starter: Pick;
  hipRidge: Pick;
  ridgeVent: Pick;
  underlayment: Pick;
  iceWater: Pick & { rows: { label: string; lf: number; widthFt: number }[] };
  dripEdge: Pick;
  stepFlashing: Pick & { unit: string };
  pipeBoot: Pick;
};
export type LowSlopeConfig = {
  system: "TPO" | "PVC" | "EPDM" | "MOD_BIT" | null;
  preSecured: boolean;
  membrane: Pick;
  allowances: { label: string; sf: number }[];
  insulation: (Pick & { layer: string; fastening: Zone[] })[];
  coverBoard: (Pick & { fastening: Zone[] }) | null;
  fastener: Pick;
  plate: Pick;
  preSecurement: {
    fastener: Pick;
    plate: Pick;
    count: number | null;
    countSource?: string | null;
  };
  seamTape: Pick & { lf: number | null };
  primer: Pick & { unit: string };
  adhesive: Pick & { unit: string };
  terminationBar: Pick & { lf: number | null };
  edgeMetal: Pick & { lf: number | null; lfFrom?: string | null };
  accessories: (Pick & {
    key: string;
    label: string;
    qty: number | null;
    qtyFrom?: string | null;
    unit: string;
  })[];
};
export type DeckConfig = {
  deck: Pick & { unit: string };
  sideLap: Pick & { perSheet: number | null };
  screws: Pick & { perSheet: number | null };
  weldsPerSheet: number | null;
  closures: Pick & { lf: number | null };
};
export type SidingConfig = {
  plank: Pick & {
    exposureIn: number | null;
    exposureSource?: string | null;
    lengthFt: number | null;
  };
  houseWrap: { mode: "cheapest" | "pick"; pick: Pick };
  trim: (Pick & {
    key: string;
    label: string;
    lfFrom?: string | null;
    lf?: number | null;
    pieceLengthFt: number | null;
  })[];
  soffit: Pick & { sfFrom?: string | null; sf?: number | null };
  counted: (Pick & {
    key: string;
    label: string;
    qty: number | null;
    unit: string;
  })[];
};
export type TakeoffConfig = {
  steep?: SteepConfig;
  lowSlope?: LowSlopeConfig;
  deck?: DeckConfig;
  siding?: SidingConfig;
};
export type Module = keyof TakeoffConfig;

/** Expected coverage unit per slot (compared with parsed description coverage, e.g. "BD/SQ"). */
export const COVERAGE_UNIT: Record<string, string | null> = {
  "steep.shingle": "BD/SQ",
  "steep.starter": "LF/BD",
  "steep.hipRidge": "LF/BD",
  "steep.ridgeVent": "LF/PC",
  "steep.underlayment": "SQ/RL",
  "steep.iceWater": "SQ/RL",
  "steep.dripEdge": "LF/PC",
  "steep.stepFlashing": null,
  "lowSlope.membrane": "SF/RL",
  "lowSlope.insulation": "SF/SH",
  "lowSlope.coverBoard": "SF/SH",
  "lowSlope.fastener": "EA/BX",
  "lowSlope.plate": "EA/BX",
  "lowSlope.seamTape": "LF/RL",
  "siding.houseWrap": "SF/RL",
};

export function defaultConfig(
  module: Module,
  market: "RESIDENTIAL" | "COMMERCIAL",
): NonNullable<TakeoffConfig[Module]> {
  switch (module) {
    case "steep":
      return {
        shingle: P(),
        starter: P(),
        hipRidge: P(),
        ridgeVent: P(),
        underlayment: P(),
        iceWater: { ...P(), rows: [] },
        dripEdge: P(),
        stepFlashing: { ...P(), unit: "BX" },
        pipeBoot: P(),
      } satisfies SteepConfig;
    case "lowSlope":
      return {
        system: null,
        preSecured: false,
        membrane: P(),
        allowances: [],
        insulation: [],
        coverBoard: null,
        fastener: P(),
        plate: P(),
        preSecurement: { fastener: P(), plate: P(), count: null },
        seamTape: { ...P(), lf: null },
        primer: { ...P(), unit: "CN" },
        adhesive: { ...P(), unit: "PA" },
        terminationBar: { ...P(), lf: null },
        edgeMetal: { ...P(), lf: null, lfFrom: "perimeter_lf" },
        accessories: [],
      } satisfies LowSlopeConfig;
    case "deck":
      return {
        deck: { ...P(), unit: "SH" },
        sideLap: { ...P(), perSheet: null },
        screws: { ...P(), perSheet: null },
        weldsPerSheet: null,
        closures: { ...P(), lf: null },
      } satisfies DeckConfig;
    case "siding":
      return {
        // SID-03: 8.25" HardiePlank is the residential default unless the job specifies otherwise.
        plank: {
          itemNumber: market === "RESIDENTIAL" ? "25H5KEC8" : null,
          sheetCode: market === "RESIDENTIAL" ? "HP" : null,
          exposureIn: null,
          lengthFt: 12,
        },
        houseWrap: { mode: "cheapest", pick: P() },
        trim: [
          {
            ...P(),
            key: "outside_corners",
            label: "Outside corners",
            lfFrom: "outside_corners_lf",
            pieceLengthFt: 12,
          },
          {
            ...P(),
            key: "inside_corners",
            label: "Inside corners",
            lfFrom: "inside_corners_lf",
            pieceLengthFt: 12,
          },
        ],
        soffit: { ...P(), sfFrom: "soffit_sf" },
        counted: [],
      } satisfies SidingConfig;
  }
}

export type MeasureMap = Map<string, Sourced>;
export type ItemInfo = {
  itemNumber: string;
  description: string;
  sheetCode: string;
  coverageQty: number | null;
  coverageUnit: string | null;
  uom?: string;
};
export type Ctx = {
  m: MeasureMap;
  items: Map<string, ItemInfo>;
  waste: Record<"ROOFING" | "SIDING" | "DECK", Waste>;
  /** company ice & water standard (Settings → Company): width in feet at eaves and in valleys; null = not set */
  iceWaterStd?: { eavesFt: number | null; valleysFt: number | null };
};

/**
 * Ice & water rows: what the estimator entered on this job, else the company standard applied to the job's
 * confirmed eaves / valley footage. With neither, there are no rows and the line stays MISSING.
 */
export function iceWaterRows(
  entered: { label: string; lf: number; widthFt: number }[],
  ctx: Ctx,
) {
  if (entered.length) return entered;
  const std = ctx.iceWaterStd;
  const parts = [
    { label: "Eaves", key: "eaves_lf", w: std?.eavesFt ?? null },
    { label: "Valleys", key: "valleys_lf", w: std?.valleysFt ?? null },
  ].filter((p) => p.w != null);
  // every standard row needs its confirmed footage; one missing leaves the whole line MISSING
  if (!parts.length || parts.some((p) => ctx.m.get(p.key)?.value == null))
    return [];
  return parts
    .filter((p) => ctx.m.get(p.key)!.value! > 0)
    .map((p) => ({
      label: `${p.label} (company standard ${p.w} FT)`,
      lf: ctx.m.get(p.key)!.value!,
      widthFt: p.w!,
    }));
}

const M = (ctx: Ctx, key: string | null | undefined): Sourced =>
  key
    ? (ctx.m.get(key) ?? { value: null, source: `${key} (not confirmed)` })
    : { value: null, source: "not set" };
const name = (ctx: Ctx, p: Pick, fallback: string) =>
  (p.itemNumber && ctx.items.get(p.itemNumber)?.description) ||
  p.name ||
  fallback;
/** Coverage for a slot: the user's value wins; otherwise the parsed coverage when its unit matches. */
export function coverage(
  ctx: Ctx,
  p: Pick,
  expectedUnit: string | null,
): Sourced {
  if (p.coverage != null)
    return { value: p.coverage, source: p.coverageSource || "entered by user" };
  const it = p.itemNumber ? ctx.items.get(p.itemNumber) : null;
  if (
    it &&
    it.coverageQty != null &&
    expectedUnit &&
    it.coverageUnit === expectedUnit
  )
    return {
      value: it.coverageQty,
      source: `from item description (${it.coverageQty} ${it.coverageUnit})`,
    };
  return { value: null, source: "coverage not entered" };
}
const num = (v: number | null | undefined, source: string): Sourced => ({
  value: v ?? null,
  source,
});

export function runModule(
  module: Module,
  config: TakeoffConfig,
  ctx: Ctx,
): { lines: CalcLine[]; problems: string[] } {
  if (module === "steep") {
    const c = config.steep!;
    const input: SteepInput = {
      roofSf: M(ctx, "roof_total_sf"),
      eavesLf: M(ctx, "eaves_lf"),
      rakesLf: M(ctx, "rakes_lf"),
      ridgesLf: M(ctx, "ridges_lf"),
      hipsLf: M(ctx, "hips_lf"),
      dripEdgeLf: ctx.m.get("drip_edge_lf"),
      stepFlashingLf: ctx.m.get("step_flashing_lf"),
      penetrations: ctx.m.get("penetrations_count"),
      waste: ctx.waste.ROOFING,
      shingle: {
        itemNumber: c.shingle.itemNumber,
        name: name(ctx, c.shingle, "Shingles"),
        bundlesPerSq: coverage(ctx, c.shingle, "BD/SQ"),
      },
      starter: {
        itemNumber: c.starter.itemNumber,
        name: name(ctx, c.starter, "Starter strip"),
        lfPerBundle: coverage(ctx, c.starter, "LF/BD"),
      },
      hipRidge: {
        itemNumber: c.hipRidge.itemNumber,
        name: name(ctx, c.hipRidge, "Hip & ridge"),
        sheetLfPerBundle: coverage(ctx, c.hipRidge, "LF/BD").value,
      },
      ridgeVent: {
        itemNumber: c.ridgeVent.itemNumber,
        name: name(ctx, c.ridgeVent, "Ridge vent"),
        lfPerPiece: coverage(ctx, c.ridgeVent, "LF/PC"),
      },
      underlayment: {
        itemNumber: c.underlayment.itemNumber,
        name: name(ctx, c.underlayment, "Underlayment"),
        sqPerRoll: coverage(ctx, c.underlayment, "SQ/RL"),
      },
      iceWater: {
        itemNumber: c.iceWater.itemNumber,
        name: name(ctx, c.iceWater, "Ice & water shield"),
        sqPerRoll: coverage(ctx, c.iceWater, "SQ/RL"),
        rows: iceWaterRows(c.iceWater.rows, ctx),
      },
      dripEdge: {
        itemNumber: c.dripEdge.itemNumber,
        name: name(ctx, c.dripEdge, "Drip edge"),
        lfPerPiece: coverage(ctx, c.dripEdge, "LF/PC"),
      },
      stepFlashing: c.stepFlashing.itemNumber
        ? {
            itemNumber: c.stepFlashing.itemNumber,
            name: name(ctx, c.stepFlashing, "Step flashing"),
            lfPerUnit: coverage(ctx, c.stepFlashing, null),
            unit: c.stepFlashing.unit,
          }
        : undefined,
      pipeBoot: c.pipeBoot.itemNumber
        ? {
            itemNumber: c.pipeBoot.itemNumber,
            name: name(ctx, c.pipeBoot, "Pipe boots"),
          }
        : undefined,
      coilNailName:
        ctx.items.get("0150080011")?.description ?? '1.25" Coil Nail',
      capNailName:
        ctx.items.get("4292804534")?.description ?? '1.25" Plastic Cap Nails',
    };
    return { lines: steepTakeoff(input).lines, problems: [] };
  }
  if (module === "lowSlope") {
    const c = config.lowSlope!;
    if (!c.system)
      return {
        lines: [],
        problems: ["Pick the roof system (TPO, PVC, EPDM, or mod bit) first."],
      };
    const withCov = (p: Pick, unit: string | null, fallback: string) => ({
      itemNumber: p.itemNumber,
      name: name(ctx, p, fallback),
      cov: coverage(ctx, p, unit),
    });
    const mem = withCov(c.membrane, "SF/RL", "Membrane");
    const input: LowSlopeInput = {
      system: c.system,
      preSecured: c.preSecured,
      fieldSf: M(ctx, "roof_total_sf"),
      flashingAllowances: c.allowances,
      waste: ctx.waste.ROOFING,
      membrane: {
        itemNumber: mem.itemNumber,
        name: mem.name,
        sfPerRoll: mem.cov,
      },
      insulationLayers: c.insulation.map((l, i) => ({
        itemNumber: l.itemNumber,
        name: name(ctx, l, `Insulation layer ${i + 1}`),
        layer: l.layer || `layer ${i + 1}`,
        boardSf: coverage(ctx, l, "SF/SH"),
        fastening: l.fastening,
      })),
      coverBoard: c.coverBoard
        ? {
            itemNumber: c.coverBoard.itemNumber,
            name: name(ctx, c.coverBoard, "Cover board"),
            boardSf: coverage(ctx, c.coverBoard, "SF/SH"),
            fastening: c.coverBoard.fastening,
          }
        : null,
      fastener: c.fastener.itemNumber
        ? {
            itemNumber: c.fastener.itemNumber,
            name: name(ctx, c.fastener, "Fasteners"),
            perBox: coverage(ctx, c.fastener, "EA/BX"),
          }
        : null,
      plate: c.plate.itemNumber
        ? {
            itemNumber: c.plate.itemNumber,
            name: name(ctx, c.plate, "Plates"),
            perBox: coverage(ctx, c.plate, "EA/BX"),
          }
        : null,
      preSecurement: {
        fastener: {
          itemNumber: c.preSecurement.fastener.itemNumber,
          name: name(ctx, c.preSecurement.fastener, "Pre-securement fasteners"),
          perBox: coverage(ctx, c.preSecurement.fastener, "EA/BX"),
        },
        plate: {
          itemNumber: c.preSecurement.plate.itemNumber,
          name: name(ctx, c.preSecurement.plate, "Pre-securement plates"),
          perBox: coverage(ctx, c.preSecurement.plate, "EA/BX"),
        },
        count: num(
          c.preSecurement.count,
          c.preSecurement.countSource || "entered by user",
        ),
      },
      seamTape: c.seamTape.itemNumber
        ? {
            itemNumber: c.seamTape.itemNumber,
            name: name(ctx, c.seamTape, "Seam tape"),
            lf: num(c.seamTape.lf, "entered by user"),
            lfPerRoll: coverage(ctx, c.seamTape, "LF/RL"),
          }
        : undefined,
      primer: c.primer.itemNumber
        ? {
            itemNumber: c.primer.itemNumber,
            name: name(ctx, c.primer, "Primer"),
            sfPerUnit: coverage(ctx, c.primer, null),
            unit: c.primer.unit,
          }
        : undefined,
      adhesive: c.adhesive.itemNumber
        ? {
            itemNumber: c.adhesive.itemNumber,
            name: name(ctx, c.adhesive, "Adhesive"),
            sfPerUnit: coverage(ctx, c.adhesive, null),
            unit: c.adhesive.unit,
          }
        : undefined,
      terminationBar: c.terminationBar.itemNumber
        ? {
            itemNumber: c.terminationBar.itemNumber,
            name: name(ctx, c.terminationBar, "Termination bar"),
            lf: num(c.terminationBar.lf, "entered by user"),
            lfPerPiece: coverage(ctx, c.terminationBar, "LF/PC"),
          }
        : undefined,
      edgeMetal: c.edgeMetal.itemNumber
        ? {
            itemNumber: c.edgeMetal.itemNumber,
            name: name(ctx, c.edgeMetal, "Edge metal"),
            lf:
              c.edgeMetal.lf != null
                ? num(c.edgeMetal.lf, "entered by user")
                : M(ctx, c.edgeMetal.lfFrom),
            lfPerPiece: coverage(ctx, c.edgeMetal, "LF/PC"),
          }
        : undefined,
      accessories: c.accessories.map((a) => ({
        key: `acc_${a.key}`,
        itemNumber: a.itemNumber,
        name: name(ctx, a, a.label),
        unit: a.unit,
        qty: a.qty != null ? num(a.qty, "entered by user") : M(ctx, a.qtyFrom),
      })),
    };
    return { lines: lowSlopeTakeoff(input), problems: [] };
  }
  if (module === "deck") {
    const c = config.deck!;
    const input: DeckInput = {
      deckSf: M(ctx, "roof_total_sf"),
      waste: ctx.waste.DECK,
      deck: {
        itemNumber: c.deck.itemNumber,
        name: name(ctx, c.deck, "Metal roof deck"),
        sfPerSheet: coverage(ctx, c.deck, null),
        unit: c.deck.unit,
      },
      sideLapFastenersPerSheet: c.sideLap.itemNumber
        ? {
            value: c.sideLap.perSheet,
            source: "entered by user",
            name: name(ctx, c.sideLap, "Side-lap fasteners"),
            itemNumber: c.sideLap.itemNumber,
            perBox: coverage(ctx, c.sideLap, "EA/BX"),
          }
        : undefined,
      screwsPerSheet: c.screws.itemNumber
        ? {
            value: c.screws.perSheet,
            source: "entered by user",
            name: name(ctx, c.screws, "Deck screws"),
            itemNumber: c.screws.itemNumber,
            perBox: coverage(ctx, c.screws, "EA/BX"),
          }
        : undefined,
      weldsPerSheet:
        c.weldsPerSheet != null
          ? num(c.weldsPerSheet, "entered by user")
          : undefined,
      closuresLf: c.closures.itemNumber
        ? {
            value: c.closures.lf,
            source: "entered by user",
            name: name(ctx, c.closures, "Closures"),
            itemNumber: c.closures.itemNumber,
            lfPerPiece: coverage(ctx, c.closures, "LF/PC"),
          }
        : undefined,
    };
    return { lines: deckTakeoff(input), problems: [] };
  }
  const c = config.siding!;
  const input: SidingInput = {
    sidingSf: M(ctx, "siding_sf"),
    waste: ctx.waste.SIDING,
    plank: {
      itemNumber: c.plank.itemNumber,
      name: name(ctx, c.plank, "Siding"),
      exposureIn: num(
        c.plank.exposureIn,
        c.plank.exposureSource || "entered by user",
      ),
      lengthFt: num(c.plank.lengthFt, "entered by user"),
      soldBySquare:
        !!c.plank.itemNumber && ctx.items.get(c.plank.itemNumber)?.uom === "SQ",
    },
    houseWrap: c.houseWrap.pick.itemNumber
      ? {
          itemNumber: c.houseWrap.pick.itemNumber,
          name: name(ctx, c.houseWrap.pick, "House wrap"),
          sfPerRoll: coverage(ctx, c.houseWrap.pick, "SF/RL"),
        }
      : null,
    trim: c.trim.map((t) => ({
      key: `trim_${t.key}`,
      name: name(ctx, t, t.label),
      itemNumber: t.itemNumber,
      lf: t.lf != null ? num(t.lf, "entered by user") : M(ctx, t.lfFrom),
      pieceLengthFt: num(t.pieceLengthFt, "entered by user"),
    })),
    soffit: c.soffit.itemNumber
      ? {
          itemNumber: c.soffit.itemNumber,
          name: name(ctx, c.soffit, "Soffit"),
          sf:
            c.soffit.sf != null
              ? num(c.soffit.sf, "entered by user")
              : M(ctx, c.soffit.sfFrom),
          sfPerPanel: coverage(ctx, c.soffit, null),
        }
      : undefined,
    counted: c.counted.map((x) => ({
      key: `count_${x.key}`,
      name: name(ctx, x, x.label),
      itemNumber: x.itemNumber,
      qty: num(x.qty, "entered by user"),
      unit: x.unit,
    })),
  };
  return { lines: sidingTakeoff(input), problems: [] };
}

export const MODULE_LABEL: Record<Module, string> = {
  steep: "Steep-slope roofing",
  lowSlope: "Low-slope roofing",
  deck: "Roof deck",
  siding: "Siding",
};
export const MODULES_FOR_SCOPE: Record<string, Module[]> = {
  STEEP: ["steep"],
  LOW_SLOPE: ["lowSlope"],
  DECK: ["deck"],
  SIDING: ["siding"],
  PANELS: [],
  MIXED: ["steep", "lowSlope", "deck", "siding"],
};
