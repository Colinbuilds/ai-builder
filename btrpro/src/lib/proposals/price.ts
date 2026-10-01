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

/** Price, tax, gross profit and margin for an estimate: from its latest proposal, or a preview at the company markup. */
export function estimatePricing(
  t: { grandTotal: number; materials: number },
  opts: { taxExempt: boolean; taxPct: number | null; markupPct: number | null },
  proposal: { number: string; basePrice: number; taxAmount: number; costTotal: number; status: string } | null,
) {
  if (proposal) {
    const profit = round(proposal.basePrice - proposal.costTotal - proposal.taxAmount, 2);
    return { source: `proposal ${proposal.number} (${proposal.status.toLowerCase()})`, price: proposal.basePrice, tax: proposal.taxAmount, profit, marginPct: proposal.basePrice ? round((profit / proposal.basePrice) * 100, 1) : null, preview: false };
  }
  if (opts.markupPct == null) return null;
  const p = proposalPrice({ cost: t.grandTotal, materials: t.materials, taxExempt: opts.taxExempt, taxPct: opts.taxPct, markupPct: opts.markupPct });
  const profit = round(p.basePrice - t.grandTotal - p.taxAmount, 2);
  return { source: `preview at company markup ${opts.markupPct}%`, price: p.basePrice, tax: p.taxAmount, profit, marginPct: p.basePrice ? round((profit / p.basePrice) * 100, 1) : null, preview: true };
}
