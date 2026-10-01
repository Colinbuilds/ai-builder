// What kind of job a lead is — picked on the new job/lead form. Usable on client and server.
import type { Scope } from "./intake";

export const WORK_TYPES = ["REROOF", "NEW_ROOF", "SIDING", "GUTTERS", "INSULATION", "WINDOWS", "REPAIR", "WARRANTY"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  REROOF: "Reroof",
  NEW_ROOF: "New con roof",
  SIDING: "Siding",
  GUTTERS: "Gutters",
  INSULATION: "Insulation",
  WINDOWS: "Windows",
  REPAIR: "Repair",
  WARRANTY: "Warranty",
};

export function parseWorkTypes(v: unknown): WorkType[] {
  return Array.isArray(v) ? WORK_TYPES.filter((t) => v.includes(t)) : [];
}

/** Estimating scopes and new-vs-reroof that follow from the job types (roof → steep on residential, low-slope on commercial). */
export function scopesForWork(types: WorkType[], market: "RESIDENTIAL" | "COMMERCIAL") {
  const roof = types.includes("REROOF") || types.includes("NEW_ROOF");
  const scopes: Scope[] = [];
  if (roof) scopes.push(market === "RESIDENTIAL" ? "STEEP" : "LOW_SLOPE");
  if (types.includes("SIDING")) scopes.push("SIDING");
  const constructionType = types.includes("NEW_ROOF") && !types.includes("REROOF") ? "NEW" : types.includes("REROOF") && !types.includes("NEW_ROOF") ? "REROOF" : null;
  return { scopes, constructionType: constructionType as "NEW" | "REROOF" | null };
}

/** Default job name: "Jane Smith — Reroof, Gutters" (editable later in Job details). */
export function leadName(first: string, last: string, company: string | null, types: WorkType[]) {
  const who = [first.trim(), last.trim()].filter(Boolean).join(" ") || company?.trim() || "New lead";
  return types.length ? `${who} — ${types.map((t) => WORK_TYPE_LABEL[t]).join(", ")}` : who;
}
