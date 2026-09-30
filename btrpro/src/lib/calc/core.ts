// Deterministic takeoff math (BUILD_PROMPT §4). The AI never does arithmetic; everything here is unit-tested.

const EPS = 1e-9;

/** Round up to purchasable units — never down. Tolerates float noise (3.0000000001 → 3). */
export const ceilUnits = (x: number) => Math.ceil(x - EPS);
export const sfToSq = (sf: number) => sf / 100;
export const applyWaste = (qty: number, wastePct: number) => qty * (1 + wastePct / 100);
export const round = (x: number, dp = 2) => Math.round((x + Number.EPSILON) * 10 ** dp) / 10 ** dp;
export const piecesFromLf = (lf: number, pieceLengthFt: number) => ceilUnits(lf / pieceLengthFt);
export const rollsFromArea = (sf: number, sfPerRoll: number) => ceilUnits(sf / sfPerRoll);
export const boxesFromCount = (count: number, perBox: number) => ceilUnits(count / perBox);

/** Number for formulas: up to 3 decimals, no trailing zeros, thousands separators. */
export const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 3 });

export type Section = "MATERIAL_ROOFING" | "MATERIAL_DECK" | "MATERIAL_SIDING" | "GENERAL_CONDITIONS" | "LABOR";

/** A value with where it came from. null value = MISSING. */
export type Sourced = { value: number | null; source: string };
export const src = (value: number | null | undefined, source: string): Sourced => ({ value: value ?? null, source });

export type CalcLine = {
  key: string;
  itemName: string;
  section: Section;
  /** supplier item number chosen for this line (null = no product picked yet) */
  itemNumber: string | null;
  quantity: number | null;
  unit: string | null;
  formula: string;
  inputs: Record<string, number | string | null>;
  /** what is missing; non-empty means the line is MISSING */
  missing: string[];
  ruleId?: string;
  note?: string;
};

export type Waste = { pct: number | null; approved: boolean; basis: string };

/** Builds a line; if any required input is missing, quantity is null and the formula says what's missing. */
export function line(
  base: Omit<CalcLine, "quantity" | "formula" | "missing" | "inputs"> & { inputs?: Record<string, number | string | null> },
  required: Record<string, Sourced | number | null | undefined>,
  compute: (v: Record<string, number>) => { quantity: number; formula: string },
): CalcLine {
  const missing: string[] = [];
  const vals: Record<string, number> = {};
  const inputs: Record<string, number | string | null> = { ...(base.inputs ?? {}) };
  for (const [k, raw] of Object.entries(required)) {
    const v = raw == null ? null : typeof raw === "number" ? raw : raw.value;
    if (v == null || !Number.isFinite(v)) missing.push(k);
    else vals[k] = v;
    inputs[k] = v;
    if (raw && typeof raw === "object" && raw.source) inputs[`${k}__source`] = raw.source;
  }
  if (!base.itemNumber) missing.push("product");
  if (missing.length) {
    return { ...base, inputs, quantity: null, formula: `MISSING: ${missing.join(", ")}`, missing };
  }
  const { quantity, formula } = compute(vals);
  return { ...base, inputs, quantity, formula, missing: [] };
}
