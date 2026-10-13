// House description text, shared by the server and the Create job form.
export const BASEMENTS = { FULL_DIG: "Full Dig", WALKOUT: "Walkout", DAYLIGHT: "Daylight" } as const;
export type Basement = keyof typeof BASEMENTS;

/** "Paloma · Elevation B (Extended Porch w/ Shed Dormer) · Full Dig basement · Covered Rear Deck, Ext Front Porch" */
export function houseDescription(h: { model?: string | null; elevation?: string | null; elevationType?: string | null; basement?: string | null; addOns?: string[] | string | null }) {
  const adds = Array.isArray(h.addOns) ? h.addOns : (h.addOns ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const b = h.basement && h.basement in BASEMENTS ? BASEMENTS[h.basement as Basement] : BASEMENTS.FULL_DIG;
  const elev = h.elevation?.replace(/^\s*elev(ation)?\.?\s*/i, "").trim();
  const type = h.elevationType?.trim();
  const elevText = elev ? `Elevation ${type && type.toUpperCase().startsWith(elev.toUpperCase()) ? type : elev + (type ? ` · ${type}` : "")}` : type ? `Elevation ${type}` : null;
  return [h.model?.trim(), elevText, `${b} basement`, adds.length ? adds.join(", ") : "No add-ons"].filter(Boolean).join(" · ");
}
