// Job stages and the checks that gate moving between them (BUILD_PROMPT §13, PUB-01).
import type { Readiness } from "./readiness";
import { exemptForm } from "@/lib/brand-names";

export const STAGES = [
  "LEAD",
  "ESTIMATING",
  "SUBMITTED",
  "SOLD",
  "SCHEDULED",
  "IN_PRODUCTION",
  "COMPLETE",
  "INVOICED",
  "PAID",
  "CLOSED",
  "LOST",
] as const;
export type Stage = (typeof STAGES)[number];

/** Why a job was lost — a fixed list so the win/loss report can count them. */
export const LOST_REASONS = ["Price", "Went with another contractor", "Insurance / adjuster", "Timing — not now", "No response", "Did it themselves", "Other"] as const;
/** Lost for these reasons are worth another call later (spring, or after the next storm). */
export const WIN_BACK = ["Price", "Timing — not now", "No response"];

export const STAGE_LABEL: Record<Stage, string> = {
  LEAD: "Lead",
  ESTIMATING: "Estimating",
  SUBMITTED: "Submitted",
  SOLD: "Sold",
  SCHEDULED: "Scheduled",
  IN_PRODUCTION: "In production",
  COMPLETE: "Complete",
  INVOICED: "Invoiced",
  PAID: "Paid",
  CLOSED: "Closed",
  LOST: "Lost",
};

const order = (s: Stage) => STAGES.indexOf(s);
export const isSoldOrLater = (s: Stage) => s !== "LOST" && order(s) >= order("SOLD");

export type GateInput = {
  from: Stage;
  to: Stage;
  readiness: Readiness;
  form17Status: "NOT_REQUIRED" | "PENDING" | "EXECUTED";
  contractAmount: number | null;
  contractSignedAt: Date | null;
  reason?: string; // required for overrides, moving backward, and LOST
  override?: boolean; // only the Submitted readiness check can be overridden
};

export type GateResult = { ok: true; overridden: boolean } | { ok: false; problems: string[]; overridable: boolean };

export function checkStageChange(g: GateInput): GateResult {
  const problems: string[] = [];
  let overridable = false;
  const reason = g.reason?.trim();
  if (g.from === g.to) return { ok: false, problems: ["The job is already in that stage."], overridable: false };

  if (g.to === "LOST") {
    if (isSoldOrLater(g.from)) problems.push("A sold job can't be marked Lost. Move it back first if the sale fell through.");
    if (!reason) problems.push("Give a reason the job was lost.");
  } else if (g.from !== "LOST" && order(g.to) < order(g.from) && !reason) {
    problems.push("Moving a job backward needs a reason.");
  }

  if (g.to === "SUBMITTED" && g.readiness === "NOT_READY") {
    if (g.override && reason) {
      // allowed, logged as an override
    } else {
      problems.push("Estimate is NOT READY FOR HARD BID. Fix the blockers, or override with a reason.");
      overridable = true;
    }
  }
  if (isSoldOrLater(g.to) && g.contractAmount == null) problems.push("Enter the contract amount before marking the job Sold.");
  if (order(g.to) >= order("SCHEDULED") && g.to !== "LOST") {
    if (!g.contractSignedAt) problems.push("A signed contract is required before scheduling.");
    if (g.form17Status === "PENDING")
      problems.push(`PUB-01: ${exemptForm().named} must be executed with the owner before materials are purchased or the job is scheduled.`);
  }
  if (problems.length) return { ok: false, problems, overridable: overridable && problems.length === 1 };
  return { ok: true, overridden: g.to === "SUBMITTED" && g.readiness === "NOT_READY" };
}

/** Form 17 is required exactly when a job is both public and tax-exempt (PUB-01). */
export function nextForm17Status(isPublic: boolean, isTaxExempt: boolean, current: "NOT_REQUIRED" | "PENDING" | "EXECUTED") {
  if (!(isPublic && isTaxExempt)) return "NOT_REQUIRED" as const;
  return current === "EXECUTED" ? ("EXECUTED" as const) : ("PENDING" as const);
}
export const showForm17Banner = (p: { isPublic: boolean; isTaxExempt: boolean; form17Status: string }) =>
  p.isPublic && p.isTaxExempt && p.form17Status !== "EXECUTED";
