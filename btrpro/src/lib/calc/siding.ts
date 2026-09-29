// Siding takeoff with BTR's locked siding rules.
import { ceilUnits, line, n, type CalcLine, type Sourced, type Waste } from "./core";

export const SIDING_DEFAULT_PRODUCTS = { primed_cedarmill: "25H5KEC8", primed_smooth: "25H5KES8", statement_cedarmill: "25H5KEC8AW" }; // SID-03

type M = { key: string; value: number | null; status: string };

/**
 * SID-01 (locked): siding area = EagleView "Siding" wall area only (already net of windows/doors).
 * Masonry area and masonry corner LF are never added. Openings are not deducted again.
 */
export function sidingAreaUsed(measurements: M[]) {
  const usable = measurements.filter((m) => (m.status === "CONFIRMED" || m.status === "USER_ENTERED") && m.value != null);
  const siding = usable.filter((m) => m.key === "siding_sf");
  const sf = siding.length ? siding.reduce((a, m) => a + m.value!, 0) : null;
  const masonry = usable.filter((m) => m.key === "masonry_sf").reduce((a, m) => a + m.value!, 0);
  const masonryCorners = usable.filter((m) => m.key === "masonry_corner_lf").reduce((a, m) => a + m.value!, 0);
  return {
    sf,
    excluded: { masonrySf: masonry, masonryCornerLf: masonryCorners },
    formula:
      sf == null
        ? "MISSING: EagleView siding area"
        : `siding area = EagleView Siding ${siding.map((m) => n(m.value!)).join(" + ")} SF = ${n(sf)} SF (masonry ${n(masonry)} SF and masonry corners ${n(masonryCorners)} LF excluded — SID-01; openings already excluded)`,
  };
}

export type HouseWrapOption = { itemNumber: string; name: string; unitPrice: number | null; coverageSf: number | null; sheetCode: string };

/** SID-04: the cheapest wrap per SF of coverage on the sheet in use. Items without a price or coverage can't be compared. */
export function cheapestHouseWrap(options: HouseWrapOption[], sheetCode: string) {
  const comparable = options.filter((o) => o.sheetCode === sheetCode && o.unitPrice != null && o.coverageSf);
  if (!comparable.length) return null;
  return comparable.reduce((best, o) => (o.unitPrice! / o.coverageSf! < best.unitPrice! / best.coverageSf! ? o : best));
}

export type TrimRun = { key: string; name: string; itemNumber: string | null; lf: Sourced; pieceLengthFt: Sourced };

export type SidingInput = {
  sidingSf: Sourced; // from sidingAreaUsed
  waste: Waste;
  plank: { itemNumber: string | null; name: string; exposureIn: Sourced; lengthFt: Sourced };
  houseWrap: { itemNumber: string | null; name: string; sfPerRoll: Sourced } | null;
  trim: TrimRun[]; // outside/inside corners, window/door trim, J-channel, starter, fascia…
  soffit?: { itemNumber: string | null; name: string; sf: Sourced; sfPerPanel: Sourced };
  counted: { key: string; name: string; itemNumber: string | null; qty: Sourced; unit: string }[]; // sealant tubes, touch-up kits, nails…
};

export function sidingTakeoff(i: SidingInput): CalcLine[] {
  const S = "MATERIAL_SIDING" as const;
  const lines: CalcLine[] = [];
  const wasteSrc = { value: i.waste.pct, source: i.waste.basis };
  lines.push(
    line(
      { key: "siding", itemName: i.plank.name, section: S, itemNumber: i.plank.itemNumber, unit: "PC", ruleId: "SID-01" },
      { siding_sf: i.sidingSf, waste_pct: wasteSrc, exposure_in: i.plank.exposureIn, length_ft: i.plank.lengthFt },
      (v) => {
        const perPc = (v.exposure_in / 12) * v.length_ft;
        const q = ceilUnits((v.siding_sf * (1 + v.waste_pct / 100)) / perPc);
        return {
          quantity: q,
          formula: `ceil(${n(v.siding_sf)} SF × ${n(1 + v.waste_pct / 100)} ÷ (${n(v.exposure_in)}" exposure ÷ 12 × ${n(v.length_ft)}' = ${n(perPc)} SF/PC)) = ${q} PC`,
        };
      },
    ),
  );
  if (i.houseWrap) {
    const hw = i.houseWrap;
    lines.push(
      line({ key: "house_wrap", itemName: hw.name, section: S, itemNumber: hw.itemNumber, unit: "RL", ruleId: "SID-04" }, { siding_sf: i.sidingSf, sf_per_roll: hw.sfPerRoll }, (v) => {
        const q = ceilUnits(v.siding_sf / v.sf_per_roll);
        return { quantity: q, formula: `ceil(${n(v.siding_sf)} SF ÷ ${n(v.sf_per_roll)} SF/RL) = ${q} RL` };
      }),
    );
  }
  for (const t of i.trim) {
    lines.push(
      line({ key: t.key, itemName: t.name, section: S, itemNumber: t.itemNumber, unit: "PC" }, { lf: t.lf, piece_length_ft: t.pieceLengthFt }, (v) => {
        const q = ceilUnits(v.lf / v.piece_length_ft);
        return { quantity: q, formula: `ceil(${n(v.lf)} LF ÷ ${n(v.piece_length_ft)}' pieces) = ${q} PC` };
      }),
    );
  }
  if (i.soffit) {
    const s = i.soffit;
    lines.push(
      line({ key: "soffit", itemName: s.name, section: S, itemNumber: s.itemNumber, unit: "PNL" }, { soffit_sf: s.sf, sf_per_panel: s.sfPerPanel }, (v) => {
        const q = ceilUnits(v.soffit_sf / v.sf_per_panel);
        return { quantity: q, formula: `ceil(${n(v.soffit_sf)} SF ÷ ${n(v.sf_per_panel)} SF/PNL) = ${q} PNL` };
      }),
    );
  }
  for (const c of i.counted) {
    lines.push(
      line({ key: c.key, itemName: c.name, section: S, itemNumber: c.itemNumber, unit: c.unit }, { qty: c.qty }, (v) => ({
        quantity: ceilUnits(v.qty),
        formula: `${n(v.qty)} ${c.unit} (${c.qty.source})`,
      })),
    );
  }
  return lines;
}
