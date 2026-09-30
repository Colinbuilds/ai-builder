// Metal roof deck takeoff. Profile coverage and fastening patterns are user-entered from the deck spec.
import { ceilUnits, line, n, type CalcLine, type Sourced, type Waste } from "./core";

export type DeckInput = {
  deckSf: Sourced;
  waste: Waste;
  deck: { itemNumber: string | null; name: string; sfPerSheet: Sourced; unit: string };
  sideLapFastenersPerSheet?: Sourced & { name: string; itemNumber: string | null; perBox: Sourced };
  weldsPerSheet?: Sourced;
  screwsPerSheet?: Sourced & { name: string; itemNumber: string | null; perBox: Sourced };
  closuresLf?: Sourced & { name: string; itemNumber: string | null; lfPerPiece: Sourced };
};

export function deckTakeoff(i: DeckInput): CalcLine[] {
  const S = "MATERIAL_DECK" as const;
  const lines: CalcLine[] = [];
  const sheets =
    i.deckSf.value != null && i.waste.pct != null && i.deck.sfPerSheet.value
      ? ceilUnits((i.deckSf.value * (1 + i.waste.pct / 100)) / i.deck.sfPerSheet.value)
      : null;
  lines.push(
    line(
      { key: "deck", itemName: i.deck.name, section: S, itemNumber: i.deck.itemNumber, unit: i.deck.unit },
      { deck_sf: i.deckSf, waste_pct: { value: i.waste.pct, source: i.waste.basis }, sf_per_sheet: i.deck.sfPerSheet },
      (v) => ({
        quantity: sheets!,
        formula: `ceil(${n(v.deck_sf)} SF × ${n(1 + v.waste_pct / 100)} ÷ ${n(v.sf_per_sheet)} SF/${i.deck.unit}) = ${sheets} ${i.deck.unit}`,
      }),
    ),
  );
  const perSheet = (key: string, p: (Sourced & { name: string; itemNumber: string | null; perBox: Sourced }) | undefined) => {
    if (!p) return;
    lines.push(
      line(
        { key, itemName: p.name, section: S, itemNumber: p.itemNumber, unit: "BX" },
        { sheets: sheets == null ? null : { value: sheets, source: "deck sheets" }, per_sheet: p, per_box: p.perBox },
        (v) => {
          const count = ceilUnits(v.sheets * v.per_sheet);
          const q = ceilUnits(count / v.per_box);
          return { quantity: q, formula: `ceil(${n(v.sheets)} sheets × ${n(v.per_sheet)}/sheet = ${n(count)} ÷ ${n(v.per_box)}/BX) = ${q} BX` };
        },
      ),
    );
  };
  perSheet("side_lap_fasteners", i.sideLapFastenersPerSheet);
  perSheet("deck_screws", i.screwsPerSheet);
  if (i.weldsPerSheet?.value != null && sheets != null) {
    const welds = ceilUnits(sheets * i.weldsPerSheet.value);
    lines.push({
      key: "puddle_welds",
      itemName: "Puddle welds (labor/equipment count — no material item)",
      section: S,
      itemNumber: "N/A",
      quantity: welds,
      unit: "EA",
      formula: `${n(sheets)} sheets × ${n(i.weldsPerSheet.value)} welds/sheet = ${n(welds)} EA`,
      inputs: { sheets, welds_per_sheet: i.weldsPerSheet.value },
      missing: [],
    });
  }
  if (i.closuresLf) {
    const c = i.closuresLf;
    lines.push(
      line({ key: "closures", itemName: c.name, section: S, itemNumber: c.itemNumber, unit: "PC" }, { closure_lf: c, lf_per_piece: c.lfPerPiece }, (v) => {
        const q = ceilUnits(v.closure_lf / v.lf_per_piece);
        return { quantity: q, formula: `ceil(${n(v.closure_lf)} LF ÷ ${n(v.lf_per_piece)} LF/PC) = ${q} PC` };
      }),
    );
  }
  return lines;
}
