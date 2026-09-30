// AccuLynx-style milestones (Lead → Prospect → Approved → Completed → Invoiced → Closed) over BTR's job stages.
import { STAGES, STAGE_LABEL, type Stage } from "./workflow";

export type Milestone = { key: string; letter: string; label: string; stages: Stage[]; color: string };

export const MILESTONES: Milestone[] = [
  { key: "LEAD", letter: "L", label: "Lead", stages: ["LEAD"], color: "#f2b705" },
  { key: "PROSPECT", letter: "P", label: "Prospect", stages: ["ESTIMATING", "SUBMITTED"], color: "#f58220" },
  { key: "APPROVED", letter: "A", label: "Approved", stages: ["SOLD", "SCHEDULED", "IN_PRODUCTION"], color: "#78b833" },
  { key: "COMPLETED", letter: "C", label: "Completed", stages: ["COMPLETE"], color: "#1ea5dd" },
  { key: "INVOICED", letter: "I", label: "Invoiced", stages: ["INVOICED", "PAID"], color: "#e23b3b" },
  { key: "CLOSED", letter: "✓", label: "Closed", stages: ["CLOSED"], color: "#8e959c" },
];
export const LOST_COLOR = "#6b7280";

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
