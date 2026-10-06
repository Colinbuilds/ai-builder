// AI draft takeoff. Whole-sheet mode reads the sheet first (aiReadSheet: where each elevation / roof plan is, every
// note and material callout), then traces each view on its own at high resolution with those notes in hand.
// "On screen" mode traces just the part of the sheet that's showing.
// It only draws — lengths and areas still come from the sheet's checked scale and our own geometry, and every
// AI item stays a draft (not counted, can't be sent to the job) until a person reviews and accepts it.
import { z } from "zod";
import { aiParse } from "@/lib/ai/claude";
import { botName } from "@/lib/brand-names";
import { PRESET_SCALES, TAKEOFF_TYPES, parseFeet, type Pt, type TakeoffItem, type View } from "./geometry";

export class AiMeasureError extends Error {}

const ROOF_TYPES = ["roof_area", "eave", "rake", "ridge", "hip", "valley", "wall_flashing", "side_flashing", "chimney", "cricket", "penetration"] as const;
const WALL_TYPES = ["wall_area", "masonry", "shake_area", "window", "patio_door", "door", "garage_door", "top_board", "starter", "outside_corner", "inside_corner"] as const;

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
  scale_bar: z
    .object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number(), feet: z.number().describe("the length the bar's last mark stands for, in feet (e.g. 10)") })
    .nullable()
    .describe("the graphic scale bar drawn for this view: its 0 mark and its last numbered mark, on the bar's line; null if there is none"),
  counted: z
    .object({ windows: z.number(), doors: z.number(), patio_sliders: z.number(), garage_doors: z.number() })
    .describe("how many of each opening you counted on the drawing BEFORE tracing (floor by floor)"),
  cannot_trace: z.array(z.string()).describe("at most 5 short lines (under 15 words each): specific things left for the estimator to trace by hand"),
  returns: z
    .array(
      z.object({
        where: z.string().describe("which recess, e.g. 'front entry, left side wall' or 'covered deck, both side walls'"),
        sides: z.number().describe("how many side walls this recess has (usually 2; 1 if it's open on one side)"),
        top: Point.describe("on the elevation: the top of the return wall (ceiling / soffit / beam line inside the recess)"),
        bottom: Point.describe("on the elevation: the bottom of the return wall (floor / deck / grade line), straight below `top`"),
      }),
    )
    .describe("every place on this elevation where the wall steps back at a recessed entry, porch, covered deck, balcony or alcove (side walls run straight back and can't be measured here). Empty if none."),
});

const describe = (ids: readonly string[]) =>
  TAKEOFF_TYPES.filter((t) => ids.includes(t.id)).map(
    (t) => `- ${t.id}: ${t.label} — ${t.tool === "line" ? "a polyline along the edge" : t.tool === "count" ? "one point at its center" : t.tool === "rect" ? "4 corner points" : "a closed polygon, corners in order"}${t.hint ? ` (${t.hint})` : ""}`,
  );

function task(view: View, notes?: string) {
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
    "- Elevation materials: READ THE NOTES AND CALLOUTS. A callout with a leader (e.g. STONE VENEER, FACE BRICK, HORIZ. SIDING, SHAKE SIDING) names ONE area; every other area drawn with the SAME HATCH PATTERN is the same material even with no label. Typical patterns: lap siding = evenly spaced horizontal lines; shake = rows of short staggered vertical marks; face brick = small running-bond rectangles; stone veneer = larger/irregular coursed blocks; board & batten = vertical lines. Decide each area by its pattern, not by guessing.",
    "- wall_area: the whole face of each wall plane from the grade/foundation line up to the soffit/roof line, INCLUDING the masonry and openings inside it (the app subtracts those).",
    "- masonry: EVERY brick or stone area as its own polygon inside the wall — full-height brick pilaster bands between siding panels, whole lower floors of stone, wainscots, columns. Follow stepped or sloped grade lines. Never mark a siding pattern as masonry.",
    "- shake_area: shake or other accent siding (usually gables), inside the wall_area.",
    "- ONE ITEM PER PIECE, never grouped: each window its own `window` box, each balcony/patio slider its own `patio_door` box, each entry door its own `door`, each garage door its own `garage_door`, each masonry band or stone area its own `masonry` polygon, each wall plane its own `wall_area`. Never one polygon covering several windows or several walls, and never two items for the same piece — the estimator deletes a wrong piece with one click.",
    "- Openings, 4 corners each: windows, entry doors, garage doors, storefronts, and PATIO / BALCONY SLIDING DOORS — on apartments the slider sits behind the balcony railing; box the full door (head of the door down to the balcony floor), not the railing. Count openings floor by floor first (counted), then make sure each one has a box. Size notes on the drawing (e.g. '38sf') tell you which openings are which.",
    "- Don't trace roofs, railings, gutters, downspouts, dashed (hidden/future) lines, or anything below the grade line. Roof area comes from the roof plan.",
    "- RETURNS (elevations): where the wall steps back at a recessed entry, porch, covered deck, balcony or alcove, the side walls of that recess run straight back from this face, so they are NOT in any wall_area you trace and their length can't be seen here. List each one in `returns` with the top and bottom of the return wall as drawn (for its height). Never guess the return's length — the app asks for it from the floor plan.",
    "- scale_bar: if a graphic scale bar (0 4 10 …) is drawn for this view, give its 0 mark and its last numbered mark precisely.",
    "- One item per run of a type; don't duplicate an edge or area under two types.",
    "- printed_scale: copy the scale printed under or near this view, if there is one.",
    "- cannot_trace: at most 5 short, specific lines. No explanations of rules, no lectures.",
    ...(notes ? ["", "NOTES, CALLOUTS AND LEGEND READ FROM THIS SHEET (use them):", notes] : []),
  ].join("\n");
}

export type AiRegion = { x: number; y: number; w: number; h: number };

/** Sends the captured view to Claude and maps its traced points back onto the sheet. */
export async function aiDraftTakeoff(input: { imageBase64: string; mediaType: "image/jpeg" | "image/png"; region: AiRegion; view: View; notes?: string }) {
  const { region } = input;
  if (!(region.w > 0 && region.h > 0)) throw new AiMeasureError("Nothing on screen to measure.");
  if (input.imageBase64.length > 15_000_000) throw new AiMeasureError("That view is too large to send. Zoom in on one part of the sheet.");
  const { data } = await aiParse({
    task: task(input.view, input.notes?.slice(0, 6000)),
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
    items.push({ id: `ai${Math.random().toString(36).slice(2, 9)}`, type: it.type, points: pts, note: `${botName()}: ${it.note}`.slice(0, 200), ai: true });
  }
  return {
    items,
    sheet: data.sheet,
    detectedView: detected,
    sheetType: data.sheet_type,
    printedScale: matchPreset(data.printed_scale),
    // the scale bar in sheet units: lets the editor calibrate without a typed dimension
    scaleBar:
      data.scale_bar && data.scale_bar.feet > 0
        ? { a: toSheet({ x: data.scale_bar.x0, y: data.scale_bar.y0 }), b: toSheet({ x: data.scale_bar.x1, y: data.scale_bar.y1 }), feet: data.scale_bar.feet }
        : null,
    counted: data.counted,
    returns: (data.returns ?? []).map((r) => ({ where: r.where.slice(0, 200), sides: Math.min(8, Math.max(1, Math.round(r.sides || 2))), heightPts: [toSheet(r.top), toSheet(r.bottom)] as [Pt, Pt] })),
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

// ---------- whole-sheet read ----------

const SheetRead = z.object({
  views: z.array(
    z.object({
      title: z.string().describe("the view's title as printed, e.g. 'SOUTH ELEVATION'"),
      type: z.enum(["ROOF_PLAN", "ELEVATION", "FLOOR_PLAN", "SECTION", "DETAIL", "OTHER"]),
      box: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).describe("a box around the whole drawing of this view (not its title), 0–1000 image coordinates, with a little margin"),
    }),
  ),
  notes: z.array(z.string()).describe("every material callout, legend entry, general note and size note on the sheet, as written (e.g. 'STONE VENEER — lower floor, grid-coursed pattern', '38sf — balcony doors')"),
  printed_scale: z.string().nullable(),
  returns: z
    .array(
      z.object({
        where: z.string().describe("the recess: e.g. 'front entry', 'rear covered deck', 'unit balconies (typ.)'"),
        depth_as_printed: z.string().nullable().describe("the return's length (how far the wall goes back) EXACTLY as a printed dimension on this sheet shows it, e.g. 6'-0\"; null if no printed dimension on this sheet gives it"),
        found_on: z.string().nullable().describe("the view where that dimension is printed, e.g. 'MAIN FLOOR PLAN'"),
      }),
    )
    .describe("every recessed entry, porch, covered deck, balcony or alcove where wall returns occur; empty if none"),
});

/** First pass over a whole sheet: where each view is, and every note/callout to carry into the tracing. */
export async function aiReadSheet(input: { imageBase64: string; mediaType: "image/jpeg" | "image/png" }) {
  if (input.imageBase64.length > 15_000_000) throw new AiMeasureError("That sheet is too large to send.");
  const { data } = await aiParse({
    task: [
      "TASK: read this construction-plan sheet before a takeoff. List every view drawn on it (elevations, roof plan, floor plans, sections, details) with a box around each drawing, and copy every material callout, legend item, general note and size note.",
      "For each material callout, also say which hatch pattern it points to (e.g. 'FACE BRICK — small running-bond pattern, full-height bands between siding').",
      "Boxes use 0–1000 image coordinates (0,0 top-left). Include the whole drawing of the view, but not the title block or other views.",
      "RETURNS: list every recessed entry, porch, covered deck, balcony or alcove — the side walls there (returns) run straight back and can't be measured on an elevation. Give each return's length only from a printed dimension on THIS sheet (floor plan, deck plan, section); copy it exactly and say which view it's on. If no printed dimension gives it, leave depth_as_printed null. Never estimate a length from the drawing.",
    ].join("\n"),
    schema: SheetRead,
    effort: "high",
    maxTokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.imageBase64 } },
          { type: "text", text: "Read this sheet." },
        ],
      },
    ],
  });
  const clamp = (n: number) => Math.min(1000, Math.max(0, n));
  return {
    views: data.views
      .map((v) => ({ ...v, box: { x0: clamp(Math.min(v.box.x0, v.box.x1)), y0: clamp(Math.min(v.box.y0, v.box.y1)), x1: clamp(Math.max(v.box.x0, v.box.x1)), y1: clamp(Math.max(v.box.y0, v.box.y1)) } }))
      .filter((v) => v.box.x1 - v.box.x0 > 10 && v.box.y1 - v.box.y0 > 10),
    notes: data.notes.slice(0, 80),
    printedScale: matchPreset(data.printed_scale),
    returns: (data.returns ?? []).slice(0, 40).map((r) => ({ where: r.where.slice(0, 200), depthFt: r.depth_as_printed ? parseFeet(r.depth_as_printed.replace(/\s+/g, "")) : null, printed: r.depth_as_printed, foundOn: r.found_on })),
  };
}
