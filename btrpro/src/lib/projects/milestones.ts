// Job milestones, in BTR blue from light to dark as the job moves forward (Lead → Prospect → Approved → Completed → Invoiced → Closed) over BTR's job stages.
import { STAGES, STAGE_LABEL, type Stage } from "./workflow";

export type Milestone = { key: string; letter: string; label: string; stages: Stage[]; color: string };

export const MILESTONES: Milestone[] = [
  { key: "LEAD", letter: "L", label: "Lead", stages: ["LEAD"], color: "#6fa8ea" },
  { key: "PROSPECT", letter: "P", label: "Prospect", stages: ["ESTIMATING", "SUBMITTED"], color: "#3f8ae0" },
  { key: "APPROVED", letter: "A", label: "Approved", stages: ["SOLD", "SCHEDULED", "IN_PRODUCTION"], color: "#1f6fd1" },
  { key: "COMPLETED", letter: "C", label: "Completed", stages: ["COMPLETE"], color: "#1857a8" },
  { key: "INVOICED", letter: "I", label: "Invoiced", stages: ["INVOICED", "PAID"], color: "#123f7a" },
  { key: "CLOSED", letter: "✓", label: "Closed", stages: ["CLOSED"], color: "#0e0f11" },
];
export const LOST_COLOR = "#8a9099";

export const milestoneOf = (s: Stage): Milestone | null => MILESTONES.find((m) => m.stages.includes(s)) ?? null;
export const milestoneIndex = (s: Stage) => MILESTONES.findIndex((m) => m.stages.includes(s));

/** The next stage in the normal flow, or null once the job is closed or lost. */
export function nextStage(s: Stage): Stage | null {
  if (s === "LOST" || s === "CLOSED") return null;
  return STAGES[STAGES.indexOf(s) + 1] ?? null;
}

const STAGE_RE = new RegExp(`\\b(${STAGES.join("|")})\\b`, "g");
/** "moved the job LEAD → IN_PRODUCTION" → "moved the job Lead → In production". */
export const prettyStages = (text: string) => text.replace(STAGE_RE, (s) => STAGE_LABEL[s as Stage] ?? s);
/** Feed title for a stage move: "Moved to Sold". */
export function stageMoveTitle(data: unknown): string | null {
  const to = (data as { to?: string } | null)?.to;
  return to && to in STAGE_LABEL ? `Moved to ${STAGE_LABEL[to as Stage]}` : null;
}
