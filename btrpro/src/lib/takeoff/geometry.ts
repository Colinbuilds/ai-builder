// Plan takeoff: what can be traced, and the arithmetic that turns traced points into feet.
// Pure and shared by the browser tool and the server, so the screen and the saved totals always agree.
// Points are in the sheet's own units (PDF points for PDFs, pixels for images); the page's scale says how
// many of those units make one foot.

export type View = "ROOF_PLAN" | "ELEVATION" | "OTHER";
export type Tool = "line" | "area" | "count" | "rect";
/** How a pitch changes a length or area traced on a roof plan (seen from above). */
export type PitchRule = "none" | "slope" | "hip";

export type TakeoffType = {
  id: string;
  label: string;
  group: "Roof" | "Siding" | "Other";
  tool: Tool;
  /** the job measurement this total feeds */
  key: string;
  unit: "LF" | "SF" | "EA";
  pitch: PitchRule;
  color: string;
  hint?: string;
};

export const TAKEOFF_TYPES: TakeoffType[] = [
  // roof — trace on the roof plan; sloped lines and areas get the pitch factor
  { id: "roof_area", label: "Roof area", group: "Roof", tool: "area", key: "roof_total_sf", unit: "SF", pitch: "slope", color: "#1f6fd1", hint: "Trace each roof plane on the roof plan. Squares = SF ÷ 100." },
  { id: "eave", label: "Eave", group: "Roof", tool: "line", key: "eaves_lf", unit: "LF", pitch: "none", color: "#0b8a6b" },
  { id: "rake", label: "Rake", group: "Roof", tool: "line", key: "rakes_lf", unit: "LF", pitch: "slope", color: "#d97706" },
  { id: "ridge", label: "Ridge", group: "Roof", tool: "line", key: "ridges_lf", unit: "LF", pitch: "none", color: "#b91c1c" },
  { id: "hip", label: "Hip", group: "Roof", tool: "line", key: "hips_lf", unit: "LF", pitch: "hip", color: "#9333ea" },
  { id: "valley", label: "Valley", group: "Roof", tool: "line", key: "valleys_lf", unit: "LF", pitch: "hip", color: "#0e7490" },
  { id: "wall_flashing", label: "Wall flashing", group: "Roof", tool: "line", key: "wall_flashing_lf", unit: "LF", pitch: "none", color: "#4d7c0f", hint: "Headwall / apron flashing — level runs where the roof meets a wall." },
  { id: "side_flashing", label: "Side flashing", group: "Roof", tool: "line", key: "step_flashing_lf", unit: "LF", pitch: "slope", color: "#a16207", hint: "Step flashing — runs up the slope along a sidewall." },
  { id: "chimney", label: "Chimney", group: "Roof", tool: "count", key: "chimneys_count", unit: "EA", pitch: "none", color: "#57534e" },
  { id: "cricket", label: "Cricket", group: "Roof", tool: "area", key: "cricket_sf", unit: "SF", pitch: "slope", color: "#78716c", hint: "Trace the cricket behind the chimney." },
  { id: "penetration", label: "Penetration", group: "Roof", tool: "count", key: "penetrations_count", unit: "EA", pitch: "none", color: "#be185d" },
  // siding — trace on the elevations (true size; no pitch)
  { id: "wall_area", label: "Wall area", group: "Siding", tool: "area", key: "wall_total_sf", unit: "SF", pitch: "none", color: "#1f6fd1", hint: "Trace the whole wall face. Masonry and openings traced inside it are taken out of the siding total." },
  { id: "masonry", label: "Masonry (excluded)", group: "Siding", tool: "area", key: "masonry_sf", unit: "SF", pitch: "none", color: "#7f1d1d", hint: "Brick or stone. Never counted in siding (SID-01)." },
  { id: "rough_opening", label: "Rough opening", group: "Siding", tool: "rect", key: "openings_sf", unit: "SF", pitch: "none", color: "#0f766e", hint: "Drag corner to corner over each window or door. Gives the opening count, area and perimeter." },
  { id: "top_board", label: "Top board", group: "Siding", tool: "line", key: "top_board_lf", unit: "LF", pitch: "none", color: "#c2410c" },
  { id: "starter", label: "Starter", group: "Siding", tool: "line", key: "siding_starter_lf", unit: "LF", pitch: "none", color: "#15803d" },
  { id: "outside_corner", label: "Outside corner", group: "Siding", tool: "line", key: "outside_corners_lf", unit: "LF", pitch: "none", color: "#6d28d9" },
  { id: "inside_corner", label: "Inside corner", group: "Siding", tool: "line", key: "inside_corners_lf", unit: "LF", pitch: "none", color: "#db2777" },
  { id: "j_channel", label: "J-channel", group: "Siding", tool: "line", key: "j_channel_lf", unit: "LF", pitch: "none", color: "#0369a1" },
  { id: "opening_trim", label: "Window/door perimeter (extra)", group: "Siding", tool: "line", key: "opening_perimeter_lf", unit: "LF", pitch: "none", color: "#115e59", hint: "Only for trim not covered by a traced rough opening — rough openings already add their perimeter." },
  // other
  { id: "attic_area", label: "Attic floor area", group: "Other", tool: "area", key: "attic_sf", unit: "SF", pitch: "none", color: "#525252", hint: "For the code ventilation count (Lomanco method)." },
];
export const TYPE_BY_ID = new Map(TAKEOFF_TYPES.map((t) => [t.id, t]));

export type Pt = [number, number];
// ai: drawn by the AI measurer and not yet reviewed — never counted until a person accepts it
export type TakeoffItem = { id: string; type: string; points: Pt[]; pitch?: number | null; note?: string | null; ai?: boolean };
export type Scale = {
  /** sheet units per foot */
  upf: number;
  method: "CALIBRATED" | "PRESET";
  label: string;
  /** a second known dimension measured to confirm the scale */
  check?: { expectedFt: number; measuredFt: number; diffPct: number } | null;
};
export type PageTakeoff = { view: View; pitch: number | null; scale: Scale | null; items: TakeoffItem[] };

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const pathLength = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
export function polygonArea(pts: Pt[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
/** a rectangle from two opposite corners */
export const rectCorners = (a: Pt, b: Pt): Pt[] => [a, [b[0], a[1]], b, [a[0], b[1]]];

/** Rise-per-12 → how much longer a sloped run is than it looks from above. */
export const slopeFactor = (rise: number) => Math.sqrt(1 + (rise / 12) ** 2);
/** Hips and valleys between two planes of the same pitch, measured along their plan (diagonal) length. */
export const hipFactor = (rise: number) => Math.sqrt(1 + rise ** 2 / 288);

/** Architectural and engineering scales as inches-on-paper per foot. Only valid on a full-size PDF. */
export const PRESET_SCALES: { label: string; inPerFt: number }[] = [
  { label: '1/16" = 1\'-0"', inPerFt: 1 / 16 },
  { label: '3/32" = 1\'-0"', inPerFt: 3 / 32 },
  { label: '1/8" = 1\'-0"', inPerFt: 1 / 8 },
  { label: '3/16" = 1\'-0"', inPerFt: 3 / 16 },
  { label: '1/4" = 1\'-0"', inPerFt: 1 / 4 },
  { label: '3/8" = 1\'-0"', inPerFt: 3 / 8 },
  { label: '1/2" = 1\'-0"', inPerFt: 1 / 2 },
  { label: '3/4" = 1\'-0"', inPerFt: 3 / 4 },
  { label: '1" = 1\'-0"', inPerFt: 1 },
  { label: "1\" = 10'", inPerFt: 1 / 10 },
  { label: "1\" = 20'", inPerFt: 1 / 20 },
  { label: "1\" = 30'", inPerFt: 1 / 30 },
  { label: "1\" = 40'", inPerFt: 1 / 40 },
  { label: "1\" = 50'", inPerFt: 1 / 50 },
  { label: "1\" = 60'", inPerFt: 1 / 60 },
  { label: "1\" = 100'", inPerFt: 1 / 100 },
];
/** PDF user space is 72 units per inch. */
export const presetUpf = (inPerFt: number) => 72 * inPerFt;

/** "12'6", "12' 6\"", "12.5", "12-6" → feet. Null when it can't be read. */
export function parseFeet(s: string): number | null {
  const t = s.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:-?\s*(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i);
  if (!m) return null;
  const ft = Number(m[1]);
  const inch = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(ft) || inch >= 12) return null;
  return ft + inch / 12;
}
export const fmtFeet = (ft: number) => {
  const whole = Math.floor(ft);
  const inch = Math.round((ft - whole) * 12);
  return inch === 12 ? `${whole + 1}'-0"` : `${whole}'-${inch}"`;
};

export type ItemResult = { value: number; perimeterLf?: number; factor: number; formula: string };

/** One traced item in feet / SF / EA, with the formula shown to the estimator. */
export function measureItem(item: TakeoffItem, page: Pick<PageTakeoff, "view" | "pitch" | "scale">): ItemResult | null {
  const t = TYPE_BY_ID.get(item.type);
  if (!t) return null;
  if (t.tool === "count") return { value: item.points.length, factor: 1, formula: `${item.points.length} counted` };
  if (!page.scale || page.scale.upf <= 0) return null;
  const upf = page.scale.upf;
  const rise = item.pitch ?? page.pitch ?? null;
  const onPlan = page.view === "ROOF_PLAN";
  let factor = 1;
  let why = "";
  if (onPlan && t.pitch !== "none") {
    if (rise == null) return null; // can't size a sloped run without the pitch
    factor = t.pitch === "hip" ? hipFactor(rise) : slopeFactor(rise);
    why = ` × ${round(factor, 4)} (${rise}/12 ${t.pitch === "hip" ? "hip/valley" : "slope"} factor)`;
  }
  if (t.tool === "line") {
    const plan = pathLength(item.points) / upf;
    return { value: plan * factor, factor, formula: `${round(plan)} LF traced${why}` };
  }
  const pts = t.tool === "rect" && item.points.length === 2 ? rectCorners(item.points[0], item.points[1]) : item.points;
  if (pts.length < 3) return null;
  const sf = polygonArea(pts) / upf ** 2;
  const per = (pathLength(pts) + Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])) / upf;
  return { value: sf * factor, perimeterLf: per, factor, formula: `${round(sf)} SF traced${why}` };
}

export type Total = { key: string; label: string; unit: string; raw: number; value: number; formula: string };

/**
 * Totals for one sheet, by job measurement. `allowancePct` (company default 1%) is added on top and LF/SF are
 * rounded up, so the takeoff lands slightly over, never under. Counts are never padded.
 */
export function pageTotals(page: PageTakeoff, allowancePct = 1): { totals: Total[]; problems: string[] } {
  const sums = new Map<string, { raw: number; label: string; unit: string; parts: number }>();
  const problems: string[] = [];
  const add = (key: string, label: string, unit: string, v: number) => {
    const cur = sums.get(key) ?? { raw: 0, label, unit, parts: 0 };
    cur.raw += v;
    cur.parts += 1;
    sums.set(key, cur);
  };
  let unsized = 0;
  let drafts = 0;
  for (const it of page.items) {
    const t = TYPE_BY_ID.get(it.type);
    if (!t) continue;
    if (it.ai) {
      drafts++;
      continue;
    }
    const r = measureItem(it, page);
    if (!r) {
      unsized++;
      continue;
    }
    add(t.key, t.label, t.unit, r.value);
    if (t.id === "rough_opening") {
      add("rough_openings_count", "Rough openings", "EA", 1);
      add("opening_perimeter_lf", "Window/door perimeter", "LF", r.perimeterLf ?? 0);
    }
  }
  if (unsized) problems.push(!page.scale ? "Set the scale before anything can be measured." : `${unsized} item${unsized === 1 ? "" : "s"} need${unsized === 1 ? "s" : ""} a pitch (set the sheet pitch or the item's own).`);
  if (drafts) problems.push(`${drafts} AI-drawn item${drafts === 1 ? " isn't" : "s aren't"} reviewed yet and ${drafts === 1 ? "isn't" : "aren't"} counted. Check each one against the plan, then accept or delete.`);
  const roof = sums.get("roof_total_sf");
  if (roof) add("roof_sq", "Roof squares", "SQ", roof.raw / 100);
  const wall = sums.get("wall_total_sf");
  if (wall) {
    const net = wall.raw - (sums.get("masonry_sf")?.raw ?? 0) - (sums.get("openings_sf")?.raw ?? 0);
    add("siding_sf", "Siding (wall − masonry − openings)", "SF", Math.max(0, net));
  }
  if (page.view !== "ROOF_PLAN" && page.items.some((i) => TYPE_BY_ID.get(i.type)?.key === "roof_total_sf"))
    problems.push("Roof area should come from the roof plan sheet (ROOF-01). Set this sheet's view to Roof plan.");
  if (page.scale && !page.scale.check) problems.push("Scale not checked yet: measure a second known dimension to confirm it.");
  if (page.scale?.check && Math.abs(page.scale.check.diffPct) > 1)
    problems.push(`Scale check is off by ${round(page.scale.check.diffPct, 1)}% — re-calibrate before using these numbers.`);
  const pad = 1 + allowancePct / 100;
  const totals: Total[] = [...sums.entries()].map(([key, s]) => {
    if (s.unit === "EA") return { key, label: s.label, unit: s.unit, raw: s.raw, value: s.raw, formula: `${s.raw} counted` };
    const value = Math.ceil(s.raw * pad * (s.unit === "SQ" ? 100 : 1)) / (s.unit === "SQ" ? 100 : 1);
    return { key, label: s.label, unit: s.unit, raw: round(s.raw), value, formula: `${round(s.raw)} ${s.unit}${allowancePct ? ` + ${allowancePct}% allowance` : ""}, rounded up` };
  });
  const order = TAKEOFF_TYPES.map((t) => t.key);
  totals.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
  return { totals, problems };
}
