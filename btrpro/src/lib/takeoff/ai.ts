// AI draft takeoff: Claude looks at the part of the plan sheet on screen and traces what it can identify.
// It only draws — lengths and areas still come from the sheet's checked scale and our own geometry, and every
// AI item stays a draft (not counted, can't be sent to the job) until a person reviews and accepts it.
import { z } from "zod";
import { aiParse } from "@/lib/ai/claude";
import { TAKEOFF_TYPES, type Pt, type TakeoffItem, type View } from "./geometry";

export class AiMeasureError extends Error {}

const ROOF_TYPES = ["roof_area", "eave", "rake", "ridge", "hip", "valley", "wall_flashing", "side_flashing", "chimney", "cricket", "penetration"] as const;
const WALL_TYPES = ["wall_area", "masonry", "rough_opening", "top_board", "starter", "outside_corner", "inside_corner"] as const;

export const typesFor = (view: View): readonly string[] => (view === "ROOF_PLAN" ? ROOF_TYPES : view === "ELEVATION" ? WALL_TYPES : [...ROOF_TYPES, ...WALL_TYPES]);

const Point = z.object({ x: z.number().describe("0 = left edge of the image, 1000 = right edge"), y: z.number().describe("0 = top edge, 1000 = bottom edge") });
const Schema = z.object({
  sheet: z.string().describe("What this view is, in a few words (e.g. 'roof plan, building A')"),
  items: z.array(
    z.object({
      type: z.string().describe("one of the allowed measurement type ids"),
      points: z.array(Point),
      note: z.string().describe("what this is on the drawing, a few words"),
    }),
  ),
  cannot_trace: z.array(z.string()).describe("things the estimator should trace by hand because they aren't clear on the drawing"),
});

function task(view: View, allowed: readonly string[]) {
  const lines = TAKEOFF_TYPES.filter((t) => allowed.includes(t.id)).map((t) => `- ${t.id}: ${t.label} — ${t.tool === "line" ? "a polyline along the edge" : t.tool === "count" ? "one point at its center" : t.tool === "rect" ? "4 corner points" : "a closed polygon, corners in order"}${t.hint ? ` (${t.hint})` : ""}`);
  return [
    "TASK: draft a plan takeoff by tracing what is drawn on this construction-plan image. You only trace geometry; the app computes every length and area from the sheet's verified scale.",
    `This sheet is set as: ${view === "ROOF_PLAN" ? "ROOF PLAN (seen from above)" : view === "ELEVATION" ? "ELEVATION (wall face, true size)" : "other"}.`,
    "Allowed measurement types:",
    ...lines,
    "Coordinates: x and y from 0 to 1000 across the IMAGE you are shown (0,0 = top-left corner, 1000,1000 = bottom-right), placed exactly on the drawn lines and corners.",
    "Rules:",
    "- Trace only what is actually drawn on this image. Never invent, extend or guess geometry that isn't shown; leave out anything you can't place precisely and list it in cannot_trace.",
    "- Ignore dimension strings, leaders, grid lines, title blocks, notes, hatching labels and text.",
    view === "ROOF_PLAN"
      ? "- Roof plan: each roof plane is its own roof_area polygon. Eaves are the low horizontal outer edges, rakes the sloped gable edges, ridges the level peaks, hips the external sloped intersections, valleys the internal ones."
      : view === "ELEVATION"
        ? "- Elevation: wall_area is the whole siding face of each wall; trace each window and door as a rough_opening; trace brick or stone as masonry (it is excluded from siding)."
        : "- Use only the types that clearly apply.",
    "- One item per run of a type; don't duplicate an edge under two types.",
  ].join("\n");
}

export type AiRegion = { x: number; y: number; w: number; h: number };

/** Sends the captured view to Claude and maps its traced points back onto the sheet. */
export async function aiDraftTakeoff(input: { imageBase64: string; mediaType: "image/jpeg" | "image/png"; region: AiRegion; view: View }) {
  const { region } = input;
  if (!(region.w > 0 && region.h > 0)) throw new AiMeasureError("Nothing on screen to measure.");
  if (input.imageBase64.length > 15_000_000) throw new AiMeasureError("That view is too large to send. Zoom in on one part of the sheet.");
  const allowed = typesFor(input.view);
  const { data } = await aiParse({
    task: task(input.view, allowed),
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
    items.push({ id: `ai${Math.random().toString(36).slice(2, 9)}`, type: it.type, points: pts, note: `AI: ${it.note}`.slice(0, 200), ai: true });
  }
  return { items, sheet: data.sheet, cannotTrace: data.cannot_trace, dropped };
}
