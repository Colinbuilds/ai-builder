// A job's money split the way the donut shows it: materials, sales tax, crew/labor, other.
import type { CostCategory } from "@prisma/client";
import type { Baseline } from "./pnl";

const r2 = (n: number) => Math.round(n * 100) / 100;
const isTax = (d: string) => /\b(sales\s+)?tax\b/i.test(d);

/** Actual costs entered on the job. Tax lines from receipts and invoices count as tax, not materials. */
export function actualSplit(costs: { category: CostCategory; amount: number; description: string }[]) {
  const out = { materials: 0, tax: 0, labor: 0, other: 0 };
  for (const c of costs) {
    if (c.category === "MATERIALS") out[isTax(c.description) ? "tax" : "materials"] += c.amount;
    else if (c.category === "LABOR" || c.category === "SUBCONTRACTOR") out.labor += c.amount;
    else out.other += c.amount;
  }
  return { materials: r2(out.materials), tax: r2(out.tax), labor: r2(out.labor), other: r2(out.other) };
}

/** What the estimate (frozen baseline) planned to spend. */
export function plannedSplit(b: Baseline) {
  return { materials: r2(b.materials), tax: r2(b.materialTax ?? 0), labor: r2(b.labor), other: r2(b.generalConditions + b.contingency) };
}

export type Slice = { key: "materials" | "tax" | "labor" | "other" | "profit"; label: string; value: number };

/** The usual split of a job's money. Profit is what's left of the sell; a loss shows as its own row, not a slice. */
export function moneySlices(i: { revenue: number; materials: number; tax: number; labor: number; other: number }): { slices: Slice[]; loss: number } {
  const profit = i.revenue - i.materials - i.tax - i.labor - i.other;
  const slices: Slice[] = [
    { key: "materials" as const, label: "Materials", value: i.materials },
    { key: "tax" as const, label: "Sales tax", value: i.tax },
    { key: "labor" as const, label: "Crew / labor", value: i.labor },
    { key: "other" as const, label: "Other costs", value: i.other },
    { key: "profit" as const, label: "Profit", value: Math.max(0, profit) },
  ].filter((s) => s.value > 0.005);
  return { slices, loss: profit < 0 ? -profit : 0 };
}

