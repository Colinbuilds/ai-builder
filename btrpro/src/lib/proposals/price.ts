// Proposal pricing: cost from the estimate, sales tax on materials (not on tax-exempt jobs), then markup.
import { round } from "@/lib/calc/core";

export function proposalPrice(i: { cost: number; materials: number; taxExempt: boolean; taxPct: number | null; markupPct: number }) {
  const taxAmount = i.taxExempt || !i.taxPct ? 0 : round((i.materials * i.taxPct) / 100, 2);
  const basePrice = round((i.cost + taxAmount) * (1 + i.markupPct / 100), 2);
  return {
    taxAmount,
    basePrice,
    breakdown: `(${i.cost.toFixed(2)} cost + ${taxAmount.toFixed(2)} tax${i.taxExempt ? " (tax-exempt job)" : i.taxPct ? ` at ${i.taxPct}% of materials` : " (no tax rate set)"}) × ${round(1 + i.markupPct / 100, 4)} = ${basePrice.toFixed(2)}`,
  };
}

export type Alternate = { name: string; description: string; price: number };
export function acceptedTotal(base: number, alternates: Alternate[], selected: string[]) {
  return round(base + alternates.filter((a) => selected.includes(a.name)).reduce((s, a) => s + a.price, 0), 2);
}
