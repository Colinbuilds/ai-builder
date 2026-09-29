// Low-slope (TPO / EPDM / mod bit) takeoff. Fastening patterns and coverages are always user-entered from the
// spec or manufacturer requirement — never assumed.
import { ceilUnits, line, n, type CalcLine, type Sourced, type Waste } from "./core";

export type Product = { itemNumber: string | null; name: string };
export type FasteningZone = { label: string; sf: number; perBoard: number };
export type AccessoryCount = Product & { qty: Sourced; unit: string; key: string };

export type LowSlopeInput = {
  system: "TPO" | "PVC" | "EPDM" | "MOD_BIT";
  preSecured: boolean; // pre-secured EPDM (ROOF-09)
  fieldSf: Sourced;
  flashingAllowances: { label: string; sf: number }[]; // user-entered
  waste: Waste;
  membrane: Product & { sfPerRoll: Sourced };
  insulationLayers: (Product & { boardSf: Sourced; layer: string; fastening?: FasteningZone[] })[];
  coverBoard: (Product & { boardSf: Sourced; fastening?: FasteningZone[] }) | null;
  fastener: (Product & { perBox: Sourced }) | null;
  plate: (Product & { perBox: Sourced }) | null;
  preSecurement?: { fastener: Product & { perBox: Sourced }; plate: Product & { perBox: Sourced }; count: Sourced } | null;
  seamTape?: Product & { lf: Sourced; lfPerRoll: Sourced };
  primer?: Product & { sfPerUnit: Sourced; unit: string };
  adhesive?: Product & { sfPerUnit: Sourced; unit: string };
  terminationBar?: Product & { lf: Sourced; lfPerPiece: Sourced };
  edgeMetal?: Product & { lf: Sourced; lfPerPiece: Sourced };
  accessories: AccessoryCount[]; // walk pads, pipe boots, corners, curbs, drains…
};

export function lowSlopeTakeoff(i: LowSlopeInput): CalcLine[] {
  const S = "MATERIAL_ROOFING" as const;
  const wasteSrc = { value: i.waste.pct, source: i.waste.basis };
  const allowance = i.flashingAllowances.reduce((a, x) => a + x.sf, 0);
  const lines: CalcLine[] = [];

  lines.push(
    line(
      {
        key: "membrane",
        itemName: i.membrane.name,
        section: S,
        itemNumber: i.membrane.itemNumber,
        unit: "RL",
        inputs: { allowances: i.flashingAllowances.map((a) => `${a.label} ${n(a.sf)} SF`).join("; ") || "none" },
      },
      { field_sf: i.fieldSf, waste_pct: wasteSrc, sf_per_roll: i.membrane.sfPerRoll },
      (v) => {
        const total = (v.field_sf + allowance) * (1 + v.waste_pct / 100);
        const q = ceilUnits(total / v.sf_per_roll);
        return {
          quantity: q,
          formula: `ceil((${n(v.field_sf)} field + ${n(allowance)} flashing SF) × ${n(1 + v.waste_pct / 100)} ÷ ${n(v.sf_per_roll)} SF/RL) = ${q} RL`,
        };
      },
    ),
  );

  const boards = (key: string, p: Product & { boardSf: Sourced }, label: string) =>
    line(
      { key, itemName: `${p.name}${label ? ` (${label})` : ""}`, section: S, itemNumber: p.itemNumber, unit: "SH" },
      { field_sf: i.fieldSf, waste_pct: wasteSrc, board_sf: p.boardSf },
      (v) => {
        const q = ceilUnits((v.field_sf * (1 + v.waste_pct / 100)) / v.board_sf);
        return { quantity: q, formula: `ceil(${n(v.field_sf)} SF × ${n(1 + v.waste_pct / 100)} ÷ ${n(v.board_sf)} SF/SH) = ${q} SH` };
      },
    );
  i.insulationLayers.forEach((l, idx) => lines.push(boards(`insulation_${idx + 1}`, l, l.layer)));

  if (i.system === "EPDM" && !i.coverBoard) {
    lines.push({
      key: "cover_board",
      itemName: "Cover board (required on EPDM)",
      section: S,
      itemNumber: null,
      quantity: null,
      unit: "SH",
      formula: "MISSING: product — EPDM cover board is always a standard line item",
      inputs: {},
      missing: ["product"],
      ruleId: "ROOF-08",
    });
  }
  if (i.coverBoard) {
    const cb = boards("cover_board", i.coverBoard, "cover board");
    if (i.system === "EPDM") cb.ruleId = "ROOF-08";
    lines.push(cb);
  }

  // Fasteners & plates from the user-entered pattern, per board layer and zone.
  let fastenerCount = 0;
  const patternMissing: string[] = [];
  const patternParts: string[] = [];
  for (const layer of [...i.insulationLayers.map((l) => ({ ...l, label: l.layer })), ...(i.coverBoard ? [{ ...i.coverBoard, label: "cover board" }] : [])]) {
    if (!layer.fastening?.length) continue;
    if (layer.boardSf.value == null) {
      patternMissing.push(`${layer.label} board size`);
      continue;
    }
    for (const z of layer.fastening) {
      const count = ceilUnits((z.sf / layer.boardSf.value) * z.perBoard);
      fastenerCount += count;
      patternParts.push(`${layer.label} ${z.label}: ceil(${n(z.sf)} SF ÷ ${n(layer.boardSf.value)} × ${n(z.perBoard)}/board) = ${n(count)}`);
    }
  }
  const hasPattern = patternParts.length > 0;
  for (const [key, prod] of [
    ["fasteners", i.fastener],
    ["plates", i.plate],
  ] as const) {
    lines.push(
      line(
        { key, itemName: prod?.name ?? (key === "fasteners" ? "Insulation fasteners" : "Insulation plates"), section: S, itemNumber: prod?.itemNumber ?? null, unit: "BX", inputs: { pattern: patternParts.join("; ") || null } },
        { fastening_pattern: hasPattern && !patternMissing.length ? { value: fastenerCount, source: "user-entered pattern" } : null, per_box: prod?.perBox ?? null },
        (v) => {
          const q = ceilUnits(v.fastening_pattern / v.per_box);
          return { quantity: q, formula: `${patternParts.join(" + ")} → ceil(${n(v.fastening_pattern)} ÷ ${n(v.per_box)}/BX) = ${q} BX` };
        },
      ),
    );
  }

  if (i.system === "EPDM" && i.preSecured) {
    const ps = i.preSecurement;
    for (const [key, prod] of [
      ["presecure_fasteners", ps?.fastener],
      ["presecure_plates", ps?.plate],
    ] as const) {
      lines.push(
        line(
          { key, itemName: prod?.name ?? (key === "presecure_fasteners" ? "Pre-securement fasteners" : "Pre-securement plates"), section: S, itemNumber: prod?.itemNumber ?? null, unit: "BX", ruleId: "ROOF-09" },
          { presecurement_count: ps?.count ?? null, per_box: prod?.perBox ?? null },
          (v) => {
            const q = ceilUnits(v.presecurement_count / v.per_box);
            return { quantity: q, formula: `ceil(${n(v.presecurement_count)} ÷ ${n(v.per_box)}/BX) = ${q} BX` };
          },
        ),
      );
    }
  }

  if (i.seamTape) {
    const t = i.seamTape;
    lines.push(
      line({ key: "seam_tape", itemName: t.name, section: S, itemNumber: t.itemNumber, unit: "RL" }, { seam_lf: t.lf, lf_per_roll: t.lfPerRoll }, (v) => {
        const q = ceilUnits(v.seam_lf / v.lf_per_roll);
        return { quantity: q, formula: `ceil(${n(v.seam_lf)} LF ÷ ${n(v.lf_per_roll)} LF/RL) = ${q} RL` };
      }),
    );
  }
  for (const [key, p] of [
    ["primer", i.primer],
    ["adhesive", i.adhesive],
  ] as const) {
    if (!p) continue;
    lines.push(
      line({ key, itemName: p.name, section: S, itemNumber: p.itemNumber, unit: p.unit }, { area_sf: i.fieldSf, sf_per_unit: p.sfPerUnit }, (v) => {
        const q = ceilUnits(v.area_sf / v.sf_per_unit);
        return { quantity: q, formula: `ceil(${n(v.area_sf)} SF ÷ ${n(v.sf_per_unit)} SF/${p.unit}) = ${q} ${p.unit}` };
      }),
    );
  }
  for (const [key, p] of [
    ["termination_bar", i.terminationBar],
    ["edge_metal", i.edgeMetal],
  ] as const) {
    if (!p) continue;
    lines.push(
      line({ key, itemName: p.name, section: S, itemNumber: p.itemNumber, unit: "PC" }, { lf: p.lf, lf_per_piece: p.lfPerPiece }, (v) => {
        const q = ceilUnits(v.lf / v.lf_per_piece);
        return { quantity: q, formula: `ceil(${n(v.lf)} LF ÷ ${n(v.lf_per_piece)} LF/PC) = ${q} PC` };
      }),
    );
  }
  for (const a of i.accessories) {
    lines.push(
      line({ key: a.key, itemName: a.name, section: S, itemNumber: a.itemNumber, unit: a.unit }, { qty: a.qty }, (v) => ({
        quantity: ceilUnits(v.qty),
        formula: `${n(v.qty)} ${a.unit} (${a.qty.source})`,
      })),
    );
  }
  return lines;
}
