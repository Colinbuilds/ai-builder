// Code attic ventilation, Lomanco's method (IRC): total net free area (NFA) = attic floor SF ÷ 300 (or ÷ 150 when
// the 1/300 conditions aren't met) × 144 sq in, split evenly between exhaust and intake; vents = NFA ÷ the vent's
// published rating, rounded up. Ratings come only from the manufacturer — unknown ones must be entered.

export type VentProduct = { id: string; label: string; nfa: number; kind: "exhaust" | "intake"; per: "vent" | "LF"; source: string };

/** Published net free area ratings (sq in). Add a product only with its manufacturer source. */
export const VENT_PRODUCTS: VentProduct[] = [
  { id: "lomanco-135", label: "Lomanco 135 roof louver", nfa: 144, kind: "exhaust", per: "vent", source: "https://www.lomanco.com/lmc-gallery/135-vent/" },
  { id: "lomanco-750", label: "Lomanco 750 slant back vent", nfa: 50, kind: "exhaust", per: "vent", source: "https://www.lomanco.com/ventilation-articles/how-many-vents/" },
  { id: "lomanco-da4", label: "Lomanco Deck-Air DA-4 (intake)", nfa: 36, kind: "intake", per: "vent", source: "https://www.lomanco.com/ventilation-articles/how-many-vents/" },
];

export type VentResult = {
  ratio: 150 | 300;
  totalSqIn: number;
  exhaustSqIn: number;
  intakeSqIn: number;
  exhaustCount: number | null;
  intakeCount: number | null;
  formula: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function ventilation(atticSf: number, ratio: 150 | 300, exhaustNfa: number | null, intakeNfa: number | null): VentResult {
  const totalSqIn = (atticSf / ratio) * 144;
  const half = totalSqIn / 2;
  const exhaustCount = exhaustNfa && exhaustNfa > 0 ? Math.ceil(half / exhaustNfa) : null;
  const intakeCount = intakeNfa && intakeNfa > 0 ? Math.ceil(half / intakeNfa) : null;
  const formula = [
    `${atticSf.toLocaleString()} SF attic ÷ ${ratio} × 144 = ${r1(totalSqIn).toLocaleString()} sq in total NFA`,
    `÷ 2 = ${r1(half).toLocaleString()} sq in exhaust and ${r1(half).toLocaleString()} sq in intake (intake should meet or slightly exceed exhaust)`,
  ];
  if (exhaustCount != null) formula.push(`Exhaust: ${r1(half).toLocaleString()} ÷ ${exhaustNfa} sq in per vent = ${r1(half / exhaustNfa!)} → ${exhaustCount}`);
  if (intakeCount != null) formula.push(`Intake: ${r1(half).toLocaleString()} ÷ ${intakeNfa} sq in each = ${r1(half / intakeNfa!)} → ${intakeCount}`);
  return { ratio, totalSqIn: r1(totalSqIn), exhaustSqIn: r1(half), intakeSqIn: r1(half), exhaustCount, intakeCount, formula };
}
