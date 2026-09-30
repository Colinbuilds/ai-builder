// Commission calculator. BTR plans are "overhead / company / rep": overhead % comes off the contract,
// what's left after job cost and overhead is the profit, and that profit splits company % / rep %.
import { round } from "@/lib/calc/core";

export type CommissionPlanKey = "10/60/40" | "8/50/50" | "CUSTOM";
export const PLANS: { key: Exclude<CommissionPlanKey, "CUSTOM">; overheadPct: number; companyPct: number; repPct: number }[] = [
  { key: "10/60/40", overheadPct: 10, companyPct: 60, repPct: 40 },
  { key: "8/50/50", overheadPct: 8, companyPct: 50, repPct: 50 },
];

export type CommissionInput = { contract: number; jobCost: number; overheadPct: number; companyPct: number; repPct: number };

export function commission(i: CommissionInput) {
  const problems: string[] = [];
  if (!Number.isFinite(i.contract) || i.contract <= 0) problems.push("Enter the contract price.");
  if (!Number.isFinite(i.jobCost) || i.jobCost < 0) problems.push("Enter the job cost (materials, labor, everything else).");
  if (!Number.isFinite(i.overheadPct) || i.overheadPct < 0 || i.overheadPct >= 100) problems.push("Overhead % must be 0–99.");
  if (!Number.isFinite(i.companyPct) || !Number.isFinite(i.repPct) || i.companyPct < 0 || i.repPct < 0 || round(i.companyPct + i.repPct, 4) !== 100)
    problems.push("Company % and rep % must add up to 100.");
  if (problems.length) return { ok: false as const, problems };
  const overhead = round((i.contract * i.overheadPct) / 100, 2);
  const profit = round(i.contract - i.jobCost - overhead, 2);
  const split = profit > 0 ? profit : 0;
  const rep = round((split * i.repPct) / 100, 2);
  const company = round(split - rep, 2);
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return {
    ok: true as const,
    overhead,
    profit,
    rep,
    company,
    marginPct: round((profit / i.contract) * 100, 1),
    lost: profit <= 0,
    formulas: {
      overhead: `${usd(i.contract)} contract × ${i.overheadPct}%`,
      profit: `${usd(i.contract)} − ${usd(i.jobCost)} job cost − ${usd(overhead)} overhead`,
      rep: profit > 0 ? `${usd(profit)} profit × ${i.repPct}%` : "no profit to split",
      company: profit > 0 ? `${usd(profit)} profit × ${i.companyPct}%` : "no profit to split",
    },
  };
}
