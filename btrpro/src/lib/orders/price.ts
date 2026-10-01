import { round } from "@/lib/calc/core";
import { toSheetUnit } from "@/lib/calc/pricing";

export type SheetItem = { uom: string; unitPrice: number | null; priceStatus: string; coverageQty: number | null; coverageUnit: string | null };

/**
 * Expected cost of an order line from the price sheet. The order keeps the unit the crew counts in
 * (e.g. bundles); the price is converted only through the item's printed coverage. CALL items and unit
 * mismatches stay unpriced (null) instead of being guessed.
 */
export function orderLinePrice(qty: number | null, unit: string | null, item: SheetItem | null): { extended: number | null; formula: string | null } {
  if (qty == null || !item) return { extended: null, formula: item ? null : "not on a price sheet — priced by the supplier" };
  if (item.priceStatus === "CALL" || item.unitPrice == null) return { extended: null, formula: "CALL for price" };
  const conv = toSheetUnit(qty, unit, item);
  if (!conv.ok || conv.quantity == null) return { extended: null, formula: conv.note };
  const extended = round(conv.quantity * item.unitPrice, 2);
  const sheetQty = conv.formula ? `${conv.quantity} ${item.uom} (${qty} ${unit})` : `${qty} ${item.uom}`;
  return { extended, formula: `${sheetQty} × $${item.unitPrice.toFixed(2)}/${item.uom} = ${extended.toFixed(2)}` };
}

export type ReceiveLine = { quantity: number | null; received: number; backordered: number; returned: number };

/** Order status from what has arrived. */
export function deliveryStatus(lines: ReceiveLine[]): "PARTIAL" | "DELIVERED" | null {
  const anyIn = lines.some((l) => l.received > 0);
  if (!anyIn) return null;
  const all = lines.every((l) => l.quantity == null || l.received >= l.quantity);
  return all ? "DELIVERED" : "PARTIAL";
}

/**
 * Squares → bundles for ordering, only through the item's own printed coverage (e.g. "3/SQ" → 3 BD/SQ).
 * Partial bundles round up: you can't buy a third of a bundle.
 */
export function toOrderUnit(qty: number | null, unit: string | null, item: SheetItem | null): { quantity: number | null; unit: string | null; note: string | null } {
  if (qty != null && unit === "SQ" && item?.uom === "SQ" && item.coverageUnit === "BD/SQ" && item.coverageQty) {
    const bd = Math.ceil(qty * item.coverageQty - 1e-6);
    return { quantity: bd, unit: "BD", note: `${qty} SQ × ${item.coverageQty} BD/SQ = ${bd} BD` };
  }
  return { quantity: qty == null ? null : Math.ceil(qty * 100 - 1e-6) / 100, unit, note: null };
}
