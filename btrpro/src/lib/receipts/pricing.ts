// Receipt pricing for the customer — pure, so the review screen can recalculate live as markups change.
import { round } from "@/lib/calc/core";

export const DEFAULT_RECEIPT_MARKUP = 15; // Colin's JobReceipts design: 15% unless changed in Company settings, per receipt or per line

export type PricedLine = { cost: number; taxShare: number; markupPct: number; billed: number; profit: number };

/**
 * Cost to BTR per line = printed amount + its share of the receipt's sales tax (spread by amount; the last line takes
 * the rounding so the costs add up to exactly amount + tax). Billed = cost × (1 + markup). All math here, never the AI.
 */
export function receiptPricing(amounts: number[], tax: number | null, markups: number[]) {
  const sum = round(amounts.reduce((a, b) => a + b, 0), 2);
  const t = tax ?? 0;
  let left = t;
  const lines: PricedLine[] = amounts.map((amt, i) => {
    const share = sum !== 0 ? (i === amounts.length - 1 ? round(left, 2) : round((t * amt) / sum, 2)) : 0;
    left = round(left - share, 2);
    const cost = round(amt + share, 2);
    // in whole cents, so $545.70 × 1.15 = $627.555 rounds to $627.56 (floating point would give $627.55)
    const billed = Math.round(Math.round(cost * 100) * (100 + markups[i]) / 100 + 1e-7) / 100;
    return { cost, taxShare: share, markupPct: markups[i], billed, profit: round(billed - cost, 2) };
  });
  const cost = round(lines.reduce((a, l) => a + l.cost, 0), 2);
  const billed = round(lines.reduce((a, l) => a + l.billed, 0), 2);
  const profit = round(billed - cost, 2);
  return { lines, cost, billed, profit, marginPct: billed ? round((profit / billed) * 100, 2) : null, taxSpread: sum !== 0 ? t : 0 };
}

