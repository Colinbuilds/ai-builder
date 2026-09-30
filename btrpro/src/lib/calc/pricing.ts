// Pricing lines against the loaded BTR sheets, and estimate totals (BUILD_PROMPT §5).
import { round } from "./core";

export type SheetDateStatus = "EXPIRED" | "EXPIRING" | "STALE" | "CURRENT" | "UNKNOWN";
export type PricedItem = { itemNumber: string; unitPrice: number | null; priceStatus: "LISTED" | "CALL"; uom: string; sheetStatus: SheetDateStatus };
export type SourceStatus =
  | "VERIFIED"
  | "SHEET_STALE"
  | "SHEET_EXPIRED"
  | "CALL_FOR_PRICE"
  | "MISSING_ITEM"
  | "MISSING_PRICE"
  | "PLACEHOLDER"
  | "ASSUMPTION_APPROVED"
  | "PENDING_AI"
  | "MISSING";

/** Status of a material line given what the price library returned for its item number. */
export function priceStatusFor(quantity: number | null, item: PricedItem | null, requestedItemNumber: string | null): {
  sourceStatus: SourceStatus;
  unitCost: number | null;
  total: number | null;
} {
  if (!requestedItemNumber || !item) return { sourceStatus: requestedItemNumber ? "MISSING_ITEM" : "MISSING", unitCost: null, total: null };
  if (item.priceStatus === "CALL") return { sourceStatus: "CALL_FOR_PRICE", unitCost: null, total: null };
  if (item.unitPrice == null) return { sourceStatus: "MISSING_PRICE", unitCost: null, total: null };
  if (quantity == null) return { sourceStatus: "MISSING", unitCost: item.unitPrice, total: null };
  const total = round(quantity * item.unitPrice, 2);
  const s = item.sheetStatus === "EXPIRED" ? "SHEET_EXPIRED" : item.sheetStatus === "CURRENT" ? "VERIFIED" : "SHEET_STALE";
  return { sourceStatus: s, unitCost: item.unitPrice, total };
}

/** Lines that don't carry a usable number are left out of totals and make the estimate INCOMPLETE. */
const COUNTS = new Set(["VERIFIED", "SHEET_STALE", "ASSUMPTION_APPROVED", "PLACEHOLDER"]);

export type TotalsLine = { section: string; total: number | null; sourceStatus: string };

export function estimateTotals(
  lines: TotalsLine[],
  labor: { total: number | null; sourceStatus: string }[],
  contingencyPct: number | null,
) {
  let incomplete = false;
  const sum = (ls: TotalsLine[]) =>
    round(
      ls.reduce((a, l) => {
        if (!COUNTS.has(l.sourceStatus) || l.total == null) {
          incomplete = true;
          return a;
        }
        return a + l.total;
      }, 0),
      2,
    );
  const materials = sum(lines.filter((l) => l.section.startsWith("MATERIAL")));
  const generalConditions = sum(lines.filter((l) => l.section === "GENERAL_CONDITIONS"));
  const laborTotal = sum(labor.map((l) => ({ section: "LABOR", ...l })));
  if (!labor.length) incomplete = true;
  const subtotal = round(materials + generalConditions + laborTotal, 2);
  const contingency = contingencyPct ? round((subtotal * contingencyPct) / 100, 2) : 0;
  return { materials, generalConditions, labor: laborTotal, subtotal, contingency, grandTotal: round(subtotal + contingency, 2), incomplete };
}

/**
 * Puts a takeoff quantity into the unit the sheet sells by. Only the explicit, printed relationship is used
 * (bundles → squares via the item's own "3/SQ" coverage); anything else is a mismatch and stays unpriced
 * rather than being converted silently (CLAUDE.md §5).
 */
export function toSheetUnit(
  qty: number | null,
  takeoffUnit: string | null,
  item: { uom: string; coverageQty: number | null; coverageUnit: string | null },
): { quantity: number | null; ok: boolean; formula: string | null; note: string | null } {
  if (qty == null || !takeoffUnit || takeoffUnit === item.uom) return { quantity: qty, ok: true, formula: null, note: null };
  if (takeoffUnit === "BD" && item.uom === "SQ" && item.coverageUnit === "BD/SQ" && item.coverageQty) {
    const sq = qty / item.coverageQty;
    return {
      quantity: Math.round(sq * 10000) / 10000,
      ok: true,
      formula: `${qty} BD ÷ ${item.coverageQty} BD/SQ = ${Math.round(sq * 1000) / 1000} SQ (sheet sells by SQ)`,
      note: `Order ${qty} BD.`,
    };
  }
  return {
    quantity: qty,
    ok: false,
    formula: null,
    note: `Unit mismatch: takeoff counts ${takeoffUnit}, the sheet sells by ${item.uom}. Not priced — confirm the conversion with the supplier.`,
  };
}
