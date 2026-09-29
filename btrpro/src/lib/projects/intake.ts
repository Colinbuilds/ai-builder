// Project intake fields (CLAUDE.md §4). CLAUDE.md lists 20 fields; BUILD_PROMPT says "19" — CLAUDE.md wins.
export const SCOPES = ["STEEP", "LOW_SLOPE", "DECK", "SIDING", "PANELS"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABEL: Record<Scope, string> = {
  STEEP: "Steep-slope roofing",
  LOW_SLOPE: "Low-slope roofing",
  DECK: "Roof decking",
  SIDING: "Siding",
  PANELS: "Metal / wall panels",
};

type Ctx = { scopes: Scope[]; constructionType: "NEW" | "REROOF" | null };
const any = (c: Ctx, ...s: Scope[]) => s.some((x) => c.scopes.includes(x));
const ROOF: Scope[] = ["STEEP", "LOW_SLOPE", "DECK"];
const WALL: Scope[] = ["SIDING", "PANELS"];

export type IntakeDef = {
  key: string;
  label: string;
  /** what to ask for when it's MISSING */
  source: string;
  unit?: string;
  relevant: (c: Ctx) => boolean;
};

export const INTAKE_FIELDS: IntakeDef[] = [
  { key: "location", label: "Location", source: "Job address from the bid docs or client", relevant: () => true },
  { key: "building_use", label: "Building use", source: "Plans cover sheet or client", relevant: () => true },
  { key: "construction_type", label: "New construction or reroof", source: "Bid docs / client", relevant: () => true },
  { key: "roof_area", label: "Roof area", unit: "SF", source: "Roof plan sheet or EagleView (never floor-plan schedules — ROOF-01)", relevant: (c) => any(c, ...ROOF) },
  { key: "building_height", label: "Building height", unit: "FT", source: "Elevations or EagleView", relevant: () => true },
  { key: "roof_slope", label: "Roof slope", source: "Roof plan / EagleView pitch by facet", relevant: (c) => any(c, ...ROOF) },
  { key: "deck_type", label: "Deck type", source: "Structural drawings / specs", relevant: (c) => any(c, ...ROOF) },
  { key: "existing_roof_layers", label: "Existing roof layers", source: "Core cut or site inspection", relevant: (c) => any(c, ...ROOF) && c.constructionType !== "NEW" },
  { key: "insulation_requirements", label: "Insulation requirements", source: "Spec Div. 07 (R-value / thickness)", relevant: (c) => any(c, "LOW_SLOPE", "DECK") },
  { key: "roof_system_type", label: "Roof system type", source: "Spec Div. 07 or client", relevant: (c) => any(c, ...ROOF) },
  { key: "warranty_duration", label: "Warranty duration", unit: "YR", source: "Spec / manufacturer warranty requirement", relevant: (c) => any(c, "STEEP", "LOW_SLOPE", "PANELS") },
  { key: "edge_metal_requirements", label: "Edge metal requirements", source: "Details sheet / spec", relevant: (c) => any(c, ...ROOF) },
  { key: "penetrations", label: "Penetrations", unit: "EA", source: "Roof plan / EagleView / site photos", relevant: (c) => any(c, ...ROOF) },
  { key: "curbs", label: "Curbs", unit: "EA", source: "Roof plan / mechanical drawings", relevant: (c) => any(c, "LOW_SLOPE", "DECK") },
  { key: "skylights", label: "Skylights", unit: "EA", source: "Roof plan / EagleView", relevant: (c) => any(c, ...ROOF) },
  { key: "equipment_supports", label: "Equipment supports", unit: "EA", source: "Mechanical drawings", relevant: (c) => any(c, "LOW_SLOPE", "DECK") },
  { key: "wall_panel_type", label: "Wall panel type", source: "Spec / elevations", relevant: (c) => any(c, "PANELS") },
  { key: "siding_type", label: "Siding type", source: "Spec / elevations (default 8.25\" HardiePlank — SID-03)", relevant: (c) => any(c, "SIDING") },
  { key: "building_perimeter", label: "Building perimeter", unit: "LF", source: "EagleView walls report / plans", relevant: (c) => any(c, ...WALL) },
  { key: "wall_heights", label: "Wall heights", unit: "FT", source: "Elevations / EagleView walls report", relevant: (c) => any(c, ...WALL) },
];

export const INTAKE_BY_KEY = new Map(INTAKE_FIELDS.map((f) => [f.key, f]));

export function parseScopes(v: unknown): Scope[] {
  return Array.isArray(v) ? v.filter((x): x is Scope => SCOPES.includes(x as Scope)) : [];
}

export type IntakeState = { key: string; status: "VERIFIED" | "MISSING" | "ASSUMED" | "NOT_APPLICABLE"; autoNa: boolean };

/**
 * What each intake field's status should become for the job's scopes.
 * Out-of-scope fields are marked N/A automatically; a field that was auto-N/A and is back
 * in scope returns to MISSING. Anything a person set is never changed.
 */
export function reconcileIntake(current: IntakeState[], ctx: Ctx): IntakeState[] {
  const byKey = new Map(current.map((f) => [f.key, f]));
  return INTAKE_FIELDS.map((def) => {
    const f = byKey.get(def.key) ?? { key: def.key, status: "MISSING" as const, autoNa: false };
    const relevant = def.relevant(ctx);
    if (!relevant && f.status === "MISSING") return { key: def.key, status: "NOT_APPLICABLE", autoNa: true };
    if (relevant && f.autoNa) return { key: def.key, status: "MISSING", autoNa: false };
    return f;
  });
}
