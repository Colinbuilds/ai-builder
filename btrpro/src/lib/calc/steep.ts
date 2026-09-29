// Steep-slope (shingle) takeoff with BTR's locked company rules.
import { applyWaste, ceilUnits, line, n, round, sfToSq, type CalcLine, type Sourced, type Waste } from "./core";

export const COMPANY = {
  COIL_NAIL_ITEM: "0150080011", // ROOF-02
  CAP_NAIL_ITEM: "4292804534", // ROOF-03
  SQ_PER_NAIL_BOX: 15, // ROOF-02 / ROOF-03
  HIP_RIDGE_LF_PER_BUNDLE: 25, // ROOF-07
};

export type IceWaterRow = { label: string; lf: number; widthFt: number };

export type SteepInput = {
  roofSf: Sourced; // confirmed roof_total_sf
  eavesLf: Sourced;
  rakesLf: Sourced;
  ridgesLf: Sourced;
  hipsLf: Sourced;
  dripEdgeLf?: Sourced; // defaults to eaves + rakes when not measured
  stepFlashingLf?: Sourced;
  penetrations?: Sourced;
  waste: Waste;
  shingle: { itemNumber: string | null; name: string; bundlesPerSq: Sourced };
  starter: { itemNumber: string | null; name: string; lfPerBundle: Sourced };
  hipRidge: { itemNumber: string | null; name: string; sheetLfPerBundle: number | null };
  ridgeVent: { itemNumber: string | null; name: string; lfPerPiece: Sourced };
  underlayment: { itemNumber: string | null; name: string; sqPerRoll: Sourced };
  iceWater: { itemNumber: string | null; name: string; sqPerRoll: Sourced; rows: IceWaterRow[] };
  dripEdge: { itemNumber: string | null; name: string; lfPerPiece: Sourced };
  stepFlashing?: { itemNumber: string | null; name: string; lfPerUnit: Sourced; unit: string };
  pipeBoot?: { itemNumber: string | null; name: string };
  coilNailName: string;
  capNailName: string;
};

export function steepTakeoff(i: SteepInput): { lines: CalcLine[]; roofSqWithWaste: number | null } {
  const S = "MATERIAL_ROOFING" as const;
  const w = i.waste.pct;
  const sq = i.roofSf.value == null ? null : sfToSq(i.roofSf.value);
  const sqW = sq == null || w == null ? null : round(applyWaste(sq, w), 4);
  const wasteSrc = { value: w, source: i.waste.basis };
  const lines: CalcLine[] = [];

  lines.push(
    line(
      { key: "shingles", itemName: i.shingle.name, section: S, itemNumber: i.shingle.itemNumber, unit: "BD" },
      { roof_sf: i.roofSf, waste_pct: wasteSrc, bundles_per_sq: i.shingle.bundlesPerSq },
      (v) => {
        const s = sfToSq(v.roof_sf);
        const q = ceilUnits(s * (1 + v.waste_pct / 100) * v.bundles_per_sq);
        return { quantity: q, formula: `ceil(${n(s)} SQ × ${n(1 + v.waste_pct / 100)} × ${n(v.bundles_per_sq)} BD/SQ) = ${q} BD` };
      },
    ),
  );

  lines.push(
    line(
      { key: "starter", itemName: i.starter.name, section: S, itemNumber: i.starter.itemNumber, unit: "BD", ruleId: "ROOF-05" },
      { eaves_lf: i.eavesLf, rakes_lf: i.rakesLf, lf_per_bundle: i.starter.lfPerBundle },
      (v) => {
        const q = ceilUnits((v.eaves_lf + v.rakes_lf) / v.lf_per_bundle);
        return { quantity: q, formula: `ceil((${n(v.eaves_lf)} eaves + ${n(v.rakes_lf)} rakes LF) ÷ ${n(v.lf_per_bundle)} LF/BD) = ${q} BD` };
      },
    ),
  );

  lines.push(
    line(
      {
        key: "hip_ridge",
        itemName: i.hipRidge.name,
        section: S,
        itemNumber: i.hipRidge.itemNumber,
        unit: "BD",
        ruleId: "ROOF-07",
        note: i.hipRidge.sheetLfPerBundle ? `Sheet lists ${n(i.hipRidge.sheetLfPerBundle)} LF/BD; company takeoff uses 25 LF/BD.` : undefined,
      },
      { hips_lf: i.hipsLf, ridges_lf: i.ridgesLf },
      (v) => {
        const q = ceilUnits((v.hips_lf + v.ridges_lf) / COMPANY.HIP_RIDGE_LF_PER_BUNDLE);
        return { quantity: q, formula: `ceil((${n(v.hips_lf)} hips + ${n(v.ridges_lf)} ridges LF) ÷ 25 LF/BD) = ${q} BD` };
      },
    ),
  );

  lines.push(
    line(
      { key: "ridge_vent", itemName: i.ridgeVent.name, section: S, itemNumber: i.ridgeVent.itemNumber, unit: "PC", ruleId: "ROOF-04" },
      { ridges_lf: i.ridgesLf, lf_per_piece: i.ridgeVent.lfPerPiece },
      (v) => {
        const q = ceilUnits(v.ridges_lf / v.lf_per_piece);
        return { quantity: q, formula: `ceil(${n(v.ridges_lf)} ridge LF ÷ ${n(v.lf_per_piece)} LF/PC) = ${q} PC` };
      },
    ),
  );

  lines.push(
    line(
      { key: "underlayment", itemName: i.underlayment.name, section: S, itemNumber: i.underlayment.itemNumber, unit: "RL" },
      { roof_sf: i.roofSf, waste_pct: wasteSrc, sq_per_roll: i.underlayment.sqPerRoll },
      (v) => {
        const s = sfToSq(v.roof_sf) * (1 + v.waste_pct / 100);
        const q = ceilUnits(s / v.sq_per_roll);
        return { quantity: q, formula: `ceil(${n(round(s, 2))} SQ ÷ ${n(v.sq_per_roll)} SQ/RL) = ${q} RL` };
      },
    ),
  );

  const iwSf = i.iceWater.rows.reduce((a, r) => a + r.lf * r.widthFt, 0);
  lines.push(
    line(
      {
        key: "ice_water",
        itemName: i.iceWater.name,
        section: S,
        itemNumber: i.iceWater.itemNumber,
        unit: "RL",
        inputs: { rows: i.iceWater.rows.map((r) => `${r.label}: ${n(r.lf)} LF × ${n(r.widthFt)} FT`).join("; ") },
      },
      { ice_water_sf: i.iceWater.rows.length ? iwSf : null, sq_per_roll: i.iceWater.sqPerRoll },
      (v) => {
        const q = ceilUnits(v.ice_water_sf / 100 / v.sq_per_roll);
        const parts = i.iceWater.rows.map((r) => `${n(r.lf)}×${n(r.widthFt)}`).join(" + ");
        return { quantity: q, formula: `ceil((${parts}) SF ÷ 100 ÷ ${n(v.sq_per_roll)} SQ/RL) = ${q} RL` };
      },
    ),
  );

  const dripLf = i.dripEdgeLf?.value != null ? i.dripEdgeLf : i.eavesLf.value != null && i.rakesLf.value != null
    ? { value: i.eavesLf.value + i.rakesLf.value, source: "eaves + rakes" }
    : { value: null, source: "eaves + rakes" };
  lines.push(
    line(
      { key: "drip_edge", itemName: i.dripEdge.name, section: S, itemNumber: i.dripEdge.itemNumber, unit: "PC" },
      { drip_edge_lf: dripLf, lf_per_piece: i.dripEdge.lfPerPiece },
      (v) => {
        const q = ceilUnits(v.drip_edge_lf / v.lf_per_piece);
        return { quantity: q, formula: `ceil(${n(v.drip_edge_lf)} LF (${dripLf.source}) ÷ ${n(v.lf_per_piece)} LF/PC) = ${q} PC` };
      },
    ),
  );

  if (i.stepFlashing && i.stepFlashingLf?.value) {
    const sf = i.stepFlashing;
    lines.push(
      line(
        { key: "step_flashing", itemName: sf.name, section: S, itemNumber: sf.itemNumber, unit: sf.unit },
        { step_flashing_lf: i.stepFlashingLf, lf_per_unit: sf.lfPerUnit },
        (v) => {
          const q = ceilUnits(v.step_flashing_lf / v.lf_per_unit);
          return { quantity: q, formula: `ceil(${n(v.step_flashing_lf)} LF ÷ ${n(v.lf_per_unit)} LF/${sf.unit}) = ${q} ${sf.unit}` };
        },
      ),
    );
  }

  if (i.pipeBoot && i.penetrations?.value) {
    lines.push(
      line(
        { key: "pipe_boots", itemName: i.pipeBoot.name, section: S, itemNumber: i.pipeBoot.itemNumber, unit: "EA" },
        { penetrations: i.penetrations },
        (v) => ({ quantity: v.penetrations, formula: `${n(v.penetrations)} penetrations = ${n(v.penetrations)} EA` }),
      ),
    );
  }

  const nails = (key: string, name: string, itemNumber: string, ruleId: string): CalcLine =>
    line(
      { key, itemName: name, section: S, itemNumber, unit: "BX", ruleId },
      { roof_sq_with_waste: sqW == null ? null : { value: sqW, source: "roof SQ × (1 + waste)" } },
      (v) => {
        const q = ceilUnits(v.roof_sq_with_waste / COMPANY.SQ_PER_NAIL_BOX);
        return { quantity: q, formula: `ceil(${n(round(v.roof_sq_with_waste, 2))} SQ ÷ 15 SQ/BX) = ${q} BX` };
      },
    );
  lines.push(nails("coil_nails", i.coilNailName, COMPANY.COIL_NAIL_ITEM, "ROOF-02"));
  lines.push(nails("cap_nails", i.capNailName, COMPANY.CAP_NAIL_ITEM, "ROOF-03"));

  return { lines, roofSqWithWaste: sqW };
}
