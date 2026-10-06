// Measurement keys (BUILD_PROMPT §Data model) and how confirmed values fill intake fields.
export const MEASUREMENTS = [
  // roofing
  { key: "roof_total_sf", label: "Total roof area", unit: "SF", group: "roof", intake: "roof_area" },
  { key: "roof_sq", label: "Roof squares", unit: "SQ", group: "roof" },
  { key: "pitch_by_facet", label: "Pitch (rise per 12)", unit: "/12", group: "roof", intake: "roof_slope", perFacet: true },
  { key: "eaves_lf", label: "Eaves", unit: "LF", group: "roof" },
  { key: "rakes_lf", label: "Rakes", unit: "LF", group: "roof" },
  { key: "ridges_lf", label: "Ridges", unit: "LF", group: "roof" },
  { key: "hips_lf", label: "Hips", unit: "LF", group: "roof" },
  { key: "valleys_lf", label: "Valleys", unit: "LF", group: "roof" },
  { key: "step_flashing_lf", label: "Step flashing", unit: "LF", group: "roof" },
  { key: "wall_flashing_lf", label: "Wall / headwall flashing", unit: "LF", group: "roof" },
  { key: "drip_edge_lf", label: "Drip edge", unit: "LF", group: "roof" },
  { key: "parapet_lf", label: "Parapet", unit: "LF", group: "roof" },
  { key: "perimeter_lf", label: "Roof perimeter", unit: "LF", group: "roof" },
  { key: "penetrations_count", label: "Penetrations", unit: "EA", group: "roof", intake: "penetrations" },
  { key: "curbs_count", label: "Curbs", unit: "EA", group: "roof", intake: "curbs" },
  { key: "drains_count", label: "Drains", unit: "EA", group: "roof" },
  { key: "skylights_count", label: "Skylights", unit: "EA", group: "roof", intake: "skylights" },
  { key: "chimneys_count", label: "Chimneys", unit: "EA", group: "roof" },
  { key: "cricket_sf", label: "Crickets", unit: "SF", group: "roof" },
  { key: "attic_sf", label: "Attic floor area (ventilation)", unit: "SF", group: "roof" },
  // walls
  { key: "wall_total_sf", label: "Total wall area", unit: "SF", group: "wall" },
  { key: "siding_sf", label: "Siding area (EagleView Siding category)", unit: "SF", group: "wall" },
  { key: "masonry_sf", label: "Masonry area (never in siding math — SID-01)", unit: "SF", group: "wall" },
  { key: "shake_sf", label: "Shake / accent siding area (part of siding)", unit: "SF", group: "wall" },
  { key: "lap_siding_sf", label: "Lap siding area (siding − shake)", unit: "SF", group: "wall" },
  { key: "openings_sf", label: "Window & door openings", unit: "SF", group: "wall" },
  { key: "window_count", label: "Windows", unit: "EA", group: "wall" },
  { key: "door_count", label: "Doors", unit: "EA", group: "wall" },
  { key: "outside_corners_lf", label: "Outside corners", unit: "LF", group: "wall" },
  { key: "inside_corners_lf", label: "Inside corners", unit: "LF", group: "wall" },
  { key: "masonry_corner_lf", label: "Masonry corners (never in siding math — SID-01)", unit: "LF", group: "wall" },
  { key: "rough_openings_count", label: "Rough openings", unit: "EA", group: "wall" },
  { key: "opening_perimeter_lf", label: "Window & door perimeter", unit: "LF", group: "wall" },
  { key: "top_board_lf", label: "Top board", unit: "LF", group: "wall" },
  { key: "siding_starter_lf", label: "Siding starter", unit: "LF", group: "wall" },
  { key: "j_channel_lf", label: "J-channel", unit: "LF", group: "wall" },
  { key: "soffit_sf", label: "Soffit", unit: "SF", group: "wall" },
  { key: "fascia_lf", label: "Fascia", unit: "LF", group: "wall" },
  { key: "building_height", label: "Building height", unit: "FT", group: "wall", intake: "building_height" },
  { key: "wall_heights", label: "Wall height", unit: "FT", group: "wall", intake: "wall_heights", perFacet: true },
] as const;

export type MeasurementKey = (typeof MEASUREMENTS)[number]["key"];
export const MEASUREMENT_KEYS = MEASUREMENTS.map((m) => m.key) as [MeasurementKey, ...MeasurementKey[]];
export const MEASUREMENT_BY_KEY = new Map<string, (typeof MEASUREMENTS)[number]>(MEASUREMENTS.map((m) => [m.key, m]));

/** Only these statuses may feed calculations. */
export const USABLE_STATUSES = ["CONFIRMED", "USER_ENTERED"] as const;
