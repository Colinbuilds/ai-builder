import { round } from "@/lib/calc/core";

// Pure P&L math for one job (BUILD_PROMPT §12). No database, no guesses: an unknown input
// makes every figure that depends on it null (shown as MISSING), never zero.

export const COST_CATEGORIES = ["MATERIALS", "LABOR", "SUBCONTRACTOR", "EQUIPMENT", "DISPOSAL", "PERMITS", "OTHER"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<CostCategory, string> = {
  MATERIALS: "Materials",
  LABOR: "Labor (crew)",
  SUBCONTRACTOR: "Subcontractors",
  EQUIPMENT: "Equipment / rentals",
  DISPOSAL: "Dumpster / disposal",
  PERMITS: "Permits",
  OTHER: "Other",
};

// The estimate has three cost buckets; actual cost categories roll up into them for the variance.
export const BUCKETS = ["materials", "labor", "generalConditions"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = { materials: "Materials (incl. tax)", labor: "Labor + subs", generalConditions: "General conditions" };
export const BUCKET_OF: Record<CostCategory, Bucket> = {
  MATERIALS: "materials",
  LABOR: "labor",
  SUBCONTRACTOR: "labor",
  EQUIPMENT: "generalConditions",
  DISPOSAL: "generalConditions",
  PERMITS: "generalConditions",
  OTHER: "generalConditions",
};

export type Baseline = {
  estimateId: string;
  estimateName: string;
  revision: number;
  materials: number;
  materialTax: number | null; // null = no tax rate was set when frozen (and the job isn't exempt)
  taxNote: string;
  generalConditions: number;
  labor: number;
  contingency: number;
  frozenBy: string;
  // add-ons the customer accepted on the proposal: priced into the contract, but the estimate has no cost for them
  uncostedAddOns?: string[];
};

export type PnlInput = {
  contractAmount: number | null;
  changeOrders: { kind: "CHANGE_ORDER" | "SUPPLEMENT" | "CREDIT"; status: string; amount: number; costImpact: number | null }[];
  baseline: Baseline | null;
  costs: { category: CostCategory; amount: number; commitmentId?: string | null }[];
  commitments: { id: string; category: CostCategory; amount: number; status: string }[];
  overheadPct: number | null;
  thresholdPct: number | null;
  commission: { basis: "REVENUE" | "GROSS_PROFIT"; pct: number; person: string } | null;
};

export type BucketRow = { bucket: Bucket; estimated: number | null; actual: number; committed: number; projected: number; variance: number | null; variancePct: number | null; flagged: boolean };

const r2 = (x: number) => round(x, 2);
const pct = (num: number, den: number) => (den === 0 ? null : round((num / den) * 100, 1));

export function computePnl(i: PnlInput) {
  const approved = i.changeOrders.filter((c) => c.status === "APPROVED");
  const coAdds = r2(approved.filter((c) => c.kind !== "CREDIT").reduce((a, c) => a + c.amount, 0));
  const credits = r2(approved.filter((c) => c.kind === "CREDIT").reduce((a, c) => a + c.amount, 0));
  const revenue = i.contractAmount == null ? null : r2(i.contractAmount + coAdds - credits);
  const revenueFormula = i.contractAmount == null ? "contract amount MISSING" : `${i.contractAmount.toFixed(2)} contract + ${coAdds.toFixed(2)} approved COs/supplements − ${credits.toFixed(2)} credits`;
  const coCost = approved.reduce((a, c) => a + (c.costImpact ?? 0), 0);
  const coCostMissing = approved.some((c) => c.kind !== "CREDIT" && c.costImpact == null);

  // actual by category
  const actualByCat = Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>;
  for (const c of i.costs) actualByCat[c.category] = r2(actualByCat[c.category] + c.amount);
  const actual = r2(COST_CATEGORIES.reduce((a, c) => a + actualByCat[c], 0));

  // committed = what's left on open commitments after the bills already linked to them
  const billed = new Map<string, number>();
  for (const c of i.costs) if (c.commitmentId) billed.set(c.commitmentId, (billed.get(c.commitmentId) ?? 0) + c.amount);
  const committedByCat = Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>;
  for (const m of i.commitments) {
    if (m.status !== "OPEN") continue;
    committedByCat[m.category] = r2(committedByCat[m.category] + Math.max(0, m.amount - (billed.get(m.id) ?? 0)));
  }
  const committed = r2(COST_CATEGORIES.reduce((a, c) => a + committedByCat[c], 0));
  const projected = r2(actual + committed);

  const b = i.baseline;
  const estBucket: Record<Bucket, number | null> = b
    ? { materials: b.materialTax == null ? b.materials : r2(b.materials + b.materialTax), labor: b.labor, generalConditions: b.generalConditions }
    : { materials: null, labor: null, generalConditions: null };
  const estimated = b ? r2(estBucket.materials! + estBucket.labor! + estBucket.generalConditions! + b.contingency + coCost) : null;

  const buckets: BucketRow[] = BUCKETS.map((bucket) => {
    const cats = COST_CATEGORIES.filter((c) => BUCKET_OF[c] === bucket);
    const act = r2(cats.reduce((a, c) => a + actualByCat[c], 0));
    const com = r2(cats.reduce((a, c) => a + committedByCat[c], 0));
    const proj = r2(act + com);
    const est = estBucket[bucket];
    const variance = est == null ? null : r2(proj - est);
    const variancePct = est == null ? null : pct(proj - est, est);
    const flagged = est != null && i.thresholdPct != null && (est === 0 ? proj > 0 : proj > est * (1 + i.thresholdPct / 100));
    return { bucket, estimated: est, actual: act, committed: com, projected: proj, variance, variancePct, flagged };
  });

  const grossProfit = revenue == null ? null : r2(revenue - actual);
  const projectedGrossProfit = revenue == null ? null : r2(revenue - projected);
  const estimatedGrossProfit = revenue == null || estimated == null ? null : r2(revenue - estimated);
  const margin = (gp: number | null) => (gp == null || revenue == null ? null : pct(gp, revenue));
  const overhead = revenue == null || i.overheadPct == null ? null : r2((revenue * i.overheadPct) / 100);
  const commissionBase = !i.commission ? null : i.commission.basis === "REVENUE" ? revenue : projectedGrossProfit;
  const commission = commissionBase == null || !i.commission ? null : r2((commissionBase * i.commission.pct) / 100);
  const netProfit = projectedGrossProfit == null || overhead == null || commission == null ? null : r2(projectedGrossProfit - overhead - commission);

  const missing: string[] = [];
  const hasCosts = i.costs.length > 0 || committed > 0;
  if (!hasCosts) missing.push("No costs entered yet — profit shows the whole contract until bills, crew hours, or commitments are entered");
  if (i.contractAmount == null) missing.push("Contract amount");
  if (!b) missing.push("Estimated-cost baseline (freeze the sold estimate)");
  if (b && b.materialTax == null) missing.push("Sales tax on materials in the baseline (no tax rate was set)");
  if (b?.uncostedAddOns?.length) missing.push(`Cost of accepted add-on(s) not in the estimate: ${b.uncostedAddOns.join(", ")} — an Admin can re-freeze the baseline from a revision that includes them`);
  if (coCostMissing) missing.push("Cost impact on an approved change order");
  if (i.overheadPct == null) missing.push("Company overhead % (Settings → Company)");
  if (!i.commission) missing.push("Commission plan for the salesperson (Settings → Company)");
  if (i.thresholdPct == null) missing.push("Over-budget flag threshold (Settings → Company)");

  return {
    hasCosts,
    revenue,
    revenueFormula,
    coAdds,
    credits,
    estimated,
    changeOrderCost: r2(coCost),
    contingency: b?.contingency ?? null,
    actual,
    actualByCat,
    committed,
    committedByCat,
    projected,
    buckets,
    grossProfit,
    grossMarginPct: margin(grossProfit),
    projectedGrossProfit,
    projectedMarginPct: margin(projectedGrossProfit),
    estimatedGrossProfit,
    estimatedMarginPct: margin(estimatedGrossProfit),
    overhead,
    overheadFormula: overhead == null ? null : `${revenue!.toFixed(2)} revenue × ${i.overheadPct}%`,
    commission,
    commissionFormula: commission == null ? null : `${commissionBase!.toFixed(2)} ${i.commission!.basis === "REVENUE" ? "revenue" : "projected gross profit"} × ${i.commission!.pct}% (${i.commission!.person})`,
    netProfit,
    netMarginPct: margin(netProfit),
    missing,
  };
}
export type Pnl = ReturnType<typeof computePnl>;

/** Crew-hours cost: hours × rate × (1 + burden%). */
export function crewCost(hours: number, rate: number, burdenPct: number) {
  const amount = r2(hours * rate * (1 + burdenPct / 100));
  return { amount, formula: `${hours} h × $${rate}/h × (1 + ${burdenPct}% burden) = ${amount.toFixed(2)}` };
}
