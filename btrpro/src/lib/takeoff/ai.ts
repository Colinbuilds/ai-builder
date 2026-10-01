// AI draft takeoff: Claude looks at the part of the plan sheet on screen and traces what it can identify.
// It only draws — lengths and areas still come from the sheet's checked scale and our own geometry, and every
// AI item stays a draft (not counted, can't be sent to the job) until a person reviews and accepts it.
import { z } from "zod";
import { aiParse } from "@/lib/ai/claude";
import { PRESET_SCALES, TAKEOFF_TYPES, type Pt, type TakeoffItem, type View } from "./geometry";

export class AiMeasureError extends Error {}

const ROOF_TYPES = ["roof_area", "eave", "rake", "ridge", "hip", "valley", "wall_flashing", "side_flashing", "chimney", "cricket", "penetration"] as const;
const WALL_TYPES = ["wall_area", "masonry", "rough_opening", "top_board", "starter", "outside_corner", "inside_corner"] as const;

export const typesFor = (view: View): readonly string[] => (view === "ROOF_PLAN" ? ROOF_TYPES : view === "ELEVATION" ? WALL_TYPES : [...ROOF_TYPES, ...WALL_TYPES]);

const Point = z.object({ x: z.number().describe("0 = left edge of the image, 1000 = right edge"), y: z.number().describe("0 = top edge, 1000 = bottom edge") });
const Schema = z.object({
  sheet: z.string().describe("What this view is, in a few words (e.g. 'south elevation, building A')"),
  sheet_type: z.enum(["ROOF_PLAN", "ELEVATION", "FLOOR_PLAN", "OTHER"]).describe("what the image actually shows, whatever the sheet was set as"),
  printed_scale: z.string().nullable().describe('the drawing scale printed for this view, exactly as written (e.g. 1/8" = 1\'-0"), or null if none is printed'),
  items: z.array(
    z.object({
      type: z.string().describe("one of the allowed measurement type ids"),
      points: z.array(Point),
      note: z.string().describe("what this is on the drawing, a few words"),
    }),
  ),
  cannot_trace: z.array(z.string()).describe("at most 5 short lines (under 15 words each): specific things left for the estimator to trace by hand"),
});

const describe = (ids: readonly string[]) =>
  TAKEOFF_TYPES.filter((t) => ids.includes(t.id)).map(
    (t) => `- ${t.id}: ${t.label} — ${t.tool === "line" ? "a polyline along the edge" : t.tool === "count" ? "one point at its center" : t.tool === "rect" ? "4 corner points" : "a closed polygon, corners in order"}${t.hint ? ` (${t.hint})` : ""}`,
  );

function task(view: View) {
  return [
    "TASK: draft a takeoff by tracing what is drawn on this construction-plan image. You only trace geometry; the app computes every length and area from the sheet's verified scale.",
    `The estimator set this sheet as ${view === "ROOF_PLAN" ? "a roof plan" : view === "ELEVATION" ? "an elevation" : "other"}, but that setting may be wrong. First decide what the image actually shows (sheet_type), then trace with the types for THAT kind of sheet. Never refuse because the setting was wrong — the app switches it to your sheet_type.`,
    "If it is a ROOF_PLAN (roof seen from above), use:",
    ...describe(ROOF_TYPES),
    "If it is an ELEVATION (a wall face, true size), use:",
    ...describe(WALL_TYPES),
    "If it is a FLOOR_PLAN or anything else, trace nothing and say in one line which sheet to open instead.",
    "Coordinates: x and y from 0 to 1000 across the IMAGE you are shown (0,0 = top-left corner, 1000,1000 = bottom-right), placed exactly on the drawn lines and corners.",
    "Rules:",
    "- Trace only what is actually drawn. Never invent, extend or guess geometry; leave out anything you can't place precisely.",
    "- Ignore dimension strings, leaders, grid lines, title blocks, notes, hatching labels and text.",
    "- Roof plan: each roof plane is its own roof_area polygon. Eaves are the low outer edges, rakes the sloped gable edges, ridges the level peaks, hips the external sloped intersections, valleys the internal ones.",
    "- Elevation: wall_area is the siding face of each wall section (outline it below the roof line, down to the grade/foundation line); trace each window and door as a rough_opening; trace brick or stone as masonry (excluded from siding). Do not trace roofs on an elevation — roof area comes from the roof plan.",
    "- One item per run of a type; don't duplicate an edge under two types.",
    "- printed_scale: copy the scale printed under or near this view, if there is one.",
    "- cannot_trace: at most 5 short, specific lines. No explanations of rules, no lectures.",
  ].join("\n");
}

export type AiRegion = { x: number; y: number; w: number; h: number };

/** Sends the captured view to Claude and maps its traced points back onto the sheet. */
export async function aiDraftTakeoff(input: { imageBase64: string; mediaType: "image/jpeg" | "image/png"; region: AiRegion; view: View }) {
  const { region } = input;
  if (!(region.w > 0 && region.h > 0)) throw new AiMeasureError("Nothing on screen to measure.");
  if (input.imageBase64.length > 15_000_000) throw new AiMeasureError("That view is too large to send. Zoom in on one part of the sheet.");
  const { data } = await aiParse({
    task: task(input.view),
    schema: Schema,
    effort: "high",
    maxTokens: 16000, // above ~21k the SDK insists on streaming; aiParse is a single request
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 } },
          { type: "text", text: "Trace this view." },
        ],
      },
    ],
  });
  const toSheet = (p: { x: number; y: number }): Pt => [
    Math.round((region.x + (Math.min(1000, Math.max(0, p.x)) / 1000) * region.w) * 100) / 100,
    Math.round((region.y + (Math.min(1000, Math.max(0, p.y)) / 1000) * region.h) * 100) / 100,
  ];
  // the sheet type BTRbot saw wins over the setting; a floor plan or detail gets nothing traced
  const detected: View | null = data.sheet_type === "ROOF_PLAN" || data.sheet_type === "ELEVATION" ? data.sheet_type : null;
  const allowed: readonly string[] = detected ? typesFor(detected) : [];
  const tool = new Map(TAKEOFF_TYPES.map((t) => [t.id, t.tool]));
  const items: TakeoffItem[] = [];
  let dropped = 0;
  for (const it of data.items) {
    const t = tool.get(it.type);
    if (!t || !allowed.includes(it.type)) {
      dropped++;
      continue;
    }
    let pts = it.points.map(toSheet);
    if (t === "count") pts = pts.slice(0, 1);
    if (t === "rect" && pts.length >= 4) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      pts = [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ];
    }
    const need = t === "count" ? 1 : t === "line" || t === "rect" ? 2 : 3;
    if (pts.length < need) {
      dropped++;
      continue;
    }
    items.push({ id: `ai${Math.random().toString(36).slice(2, 9)}`, type: it.type, points: pts, note: `BTRbot: ${it.note}`.slice(0, 200), ai: true });
  }
  return {
    items,
    sheet: data.sheet,
    detectedView: detected,
    sheetType: data.sheet_type,
    printedScale: matchPreset(data.printed_scale),
    cannotTrace: data.cannot_trace.slice(0, 5),
    dropped,
  };
}

/** Maps a printed scale ("1/8\" = 1'-0\"", "SCALE: 1/4"=1'") onto one of the editor's preset labels. */
export function matchPreset(printed: string | null | undefined): string | null {
  if (!printed) return null;
  const m = printed.replace(/\s+/g, "").match(/(\d+)\/(\d+)"?=1'(-?0"?)?|(?:^|[^/\d])(1)"=1'/);
  if (!m) return null;
  const inPerFt = m[4] ? 1 : Number(m[1]) / Number(m[2]);
  return PRESET_SCALES.find((p) => Math.abs(p.inPerFt - inPerFt) < 1e-9)?.label ?? null;
}
