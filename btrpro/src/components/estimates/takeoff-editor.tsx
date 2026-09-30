"use client";

import { useState, useTransition } from "react";
import { saveAndRunTakeoffAction } from "@/app/projects/estimate-actions";
import { ItemPicker, type PickedItem } from "./item-picker";
import { MEASUREMENTS } from "@/lib/docs/measurements";
import type { DeckConfig, LowSlopeConfig, Module, Pick, SidingConfig, SteepConfig, TakeoffConfig } from "@/lib/estimates/takeoff";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

type UiPick = Pick & { descCoverageQty?: number | null; descCoverageUnit?: string | null; price?: string | null };

const fromItem = (p: UiPick, it: PickedItem | null): UiPick =>
  it
    ? {
        ...p,
        itemNumber: it.itemNumber,
        sheetCode: it.sheetCode,
        name: it.description,
        descCoverageQty: it.coverageQty,
        descCoverageUnit: it.coverageUnit,
        price: `${it.priceStatus === "CALL" || it.unitPrice == null ? "CALL" : `$${it.unitPrice.toFixed(2)}`}/${it.uom} · ${it.sheetCode}${it.warning ? " · confirm account" : ""}`,
        coverage: null,
        coverageSource: null,
      }
    : { itemNumber: null, coverage: p.coverage ?? null, coverageSource: p.coverageSource ?? null };

const numOrNull = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One product slot: item picker + coverage (only prefilled from an explicit matching description). */
function Slot({ label, pick, unit, coverageLabel, onChange, noCoverage }: { label: string; pick: UiPick; unit: string | null; coverageLabel?: string; onChange: (p: UiPick) => void; noCoverage?: boolean }) {
  const parsedMatches = pick.descCoverageUnit && unit && pick.descCoverageUnit === unit;
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)_14rem] sm:items-center">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 flex-col">
        <ItemPicker value={{ itemNumber: pick.itemNumber, description: pick.name }} label={label} onPick={(it) => onChange(fromItem(pick, it))} />
        {pick.price && <span className="text-xs text-muted-foreground">{pick.price}</span>}
      </div>
      {!noCoverage && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <Input
              className="h-8 w-20"
              inputMode="decimal"
              value={pick.coverage ?? ""}
              placeholder={parsedMatches ? String(pick.descCoverageQty) : "—"}
              onChange={(e) => onChange({ ...pick, coverage: numOrNull(e.target.value), coverageSource: e.target.value ? "entered by user" : null })}
            />
            <span className="text-xs text-muted-foreground">{coverageLabel ?? unit}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {pick.coverage != null
              ? "entered"
              : parsedMatches
                ? `from description (${pick.descCoverageQty} ${pick.descCoverageUnit})`
                : pick.itemNumber
                  ? pick.descCoverageUnit
                    ? `description reads ${pick.descCoverageQty} ${pick.descCoverageUnit} — enter ${coverageLabel ?? unit}`
                    : "enter coverage from the product data"
                  : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function Rows<T>({ rows, render, onAdd, addLabel }: { rows: T[]; render: (r: T, i: number) => React.ReactNode; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          {render(r, i)}
        </div>
      ))}
      <button type="button" className="self-start text-xs underline" onClick={onAdd}>
        + {addLabel}
      </button>
    </div>
  );
}
const Num = ({ value, onChange, placeholder, w = "w-24" }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder: string; w?: string }) => (
  <Input className={`h-8 ${w}`} inputMode="decimal" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(numOrNull(e.target.value))} />
);
const Txt = ({ value, onChange, placeholder, w = "w-40" }: { value: string; onChange: (v: string) => void; placeholder: string; w?: string }) => (
  <Input className={`h-8 ${w}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
);
const Remove = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={onClick}>
    remove
  </button>
);
function MeasureSelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  return (
    <Select className="h-8 w-52" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— enter a number —</option>
      {MEASUREMENTS.map((m) => (
        <option key={m.key} value={m.key}>
          from {m.label}
        </option>
      ))}
    </Select>
  );
}
function upd<T>(arr: T[], i: number, patch: Partial<T>) {
  return arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

function SteepEditor({ c, set }: { c: SteepConfig; set: (c: SteepConfig) => void }) {
  const s = (k: keyof SteepConfig) => (p: UiPick) => set({ ...c, [k]: { ...(c[k] as object), ...p } });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        30-yr default when the brand isn&apos;t specified (ROOF-06): pick Malarkey Vista AR (02MLVIA3AB) or CertainTeed Landmark ClimateFlex (03CTLCF3WW).
      </p>
      <Slot label="Shingles" pick={c.shingle} unit="BD/SQ" coverageLabel="BD/SQ" onChange={s("shingle")} />
      <Slot label="Starter (eaves + rakes)" pick={c.starter} unit="LF/BD" onChange={s("starter")} />
      <Slot label="Hip & ridge" pick={c.hipRidge} unit={null} noCoverage onChange={s("hipRidge")} />
      <p className="text-xs text-muted-foreground sm:pl-44">Hip & ridge is figured at the company 25 LF/BD (ROOF-07); the sheet&apos;s LF is shown for reference.</p>
      <Slot label="Ridge vent" pick={c.ridgeVent} unit="LF/PC" coverageLabel="LF per piece" onChange={s("ridgeVent")} />
      <Slot label="Underlayment" pick={c.underlayment} unit="SQ/RL" onChange={s("underlayment")} />
      <Slot label="Ice & water" pick={c.iceWater} unit="SQ/RL" onChange={s("iceWater")} />
      <div className="sm:pl-44">
        <Rows
          rows={c.iceWater.rows}
          addLabel="I&W row (eaves courses, valleys…)"
          onAdd={() => set({ ...c, iceWater: { ...c.iceWater, rows: [...c.iceWater.rows, { label: "", lf: 0, widthFt: 3 }] } })}
          render={(r, i) => (
            <>
              <Txt value={r.label} placeholder="Eaves, 2 courses" onChange={(v) => set({ ...c, iceWater: { ...c.iceWater, rows: upd(c.iceWater.rows, i, { label: v }) } })} />
              <Num value={r.lf} placeholder="LF" onChange={(v) => set({ ...c, iceWater: { ...c.iceWater, rows: upd(c.iceWater.rows, i, { lf: v ?? 0 }) } })} />
              <span className="text-xs">LF ×</span>
              <Num value={r.widthFt} placeholder="width FT" onChange={(v) => set({ ...c, iceWater: { ...c.iceWater, rows: upd(c.iceWater.rows, i, { widthFt: v ?? 0 }) } })} />
              <span className="text-xs">FT wide</span>
              <Remove onClick={() => set({ ...c, iceWater: { ...c.iceWater, rows: c.iceWater.rows.filter((_, j) => j !== i) } })} />
            </>
          )}
        />
      </div>
      <Slot label="Drip edge" pick={c.dripEdge} unit="LF/PC" coverageLabel="LF per piece" onChange={s("dripEdge")} />
      <Slot label="Step flashing" pick={c.stepFlashing} unit={null} coverageLabel={`LF per ${c.stepFlashing.unit}`} onChange={s("stepFlashing")} />
      <Slot label="Pipe boots" pick={c.pipeBoot} unit={null} noCoverage onChange={s("pipeBoot")} />
      <p className="text-xs text-muted-foreground">Coil nails (0150080011) and 1.25&quot; cap nails (4292804534) are added automatically at 1 BX per 15 SQ (ROOF-02/03).</p>
    </div>
  );
}

function LowSlopeEditor({ c, set }: { c: LowSlopeConfig; set: (c: LowSlopeConfig) => void }) {
  const s = <K extends keyof LowSlopeConfig>(k: K) => (p: UiPick) => set({ ...c, [k]: { ...(c[k] as object), ...p } });
  const zones = (z: { label: string; sf: number; perBoard: number }[], onZ: (z: { label: string; sf: number; perBoard: number }[]) => void) => (
    <Rows
      rows={z}
      addLabel="fastening zone (from spec / manufacturer)"
      onAdd={() => onZ([...z, { label: "field", sf: 0, perBoard: 0 }])}
      render={(r, i) => (
        <>
          <Txt value={r.label} placeholder="field / perimeter / corner" w="w-36" onChange={(v) => onZ(upd(z, i, { label: v }))} />
          <Num value={r.sf} placeholder="SF" onChange={(v) => onZ(upd(z, i, { sf: v ?? 0 }))} />
          <span className="text-xs">SF at</span>
          <Num value={r.perBoard} placeholder="per board" onChange={(v) => onZ(upd(z, i, { perBoard: v ?? 0 }))} />
          <span className="text-xs">fasteners/board</span>
          <Remove onClick={() => onZ(z.filter((_, j) => j !== i))} />
        </>
      )}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">System</span>
        <Select className="h-8" value={c.system ?? ""} onChange={(e) => set({ ...c, system: (e.target.value || null) as LowSlopeConfig["system"] })}>
          <option value="">— pick —</option>
          <option value="TPO">TPO</option>
          <option value="PVC">PVC</option>
          <option value="EPDM">EPDM</option>
          <option value="MOD_BIT">Mod bit</option>
        </Select>
        {c.system === "EPDM" && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={c.preSecured} onChange={(e) => set({ ...c, preSecured: e.target.checked })} /> Pre-secured (ROOF-09)
          </label>
        )}
      </div>
      <Slot label="Membrane" pick={c.membrane} unit="SF/RL" onChange={s("membrane")} />
      <div className="sm:pl-44">
        <Rows
          rows={c.allowances}
          addLabel="flashing allowance (parapets, curbs…)"
          onAdd={() => set({ ...c, allowances: [...c.allowances, { label: "", sf: 0 }] })}
          render={(r, i) => (
            <>
              <Txt value={r.label} placeholder="Parapet walls" onChange={(v) => set({ ...c, allowances: upd(c.allowances, i, { label: v }) })} />
              <Num value={r.sf} placeholder="SF" onChange={(v) => set({ ...c, allowances: upd(c.allowances, i, { sf: v ?? 0 }) })} />
              <span className="text-xs">SF</span>
              <Remove onClick={() => set({ ...c, allowances: c.allowances.filter((_, j) => j !== i) })} />
            </>
          )}
        />
      </div>
      {c.insulation.map((l, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-md border p-2">
          <Slot label={`Insulation ${l.layer || i + 1}`} pick={l} unit="SF/SH" coverageLabel="SF per board" onChange={(p) => set({ ...c, insulation: upd(c.insulation, i, p) })} />
          <div className="flex flex-wrap items-center gap-2 sm:pl-44">
            <Txt value={l.layer} placeholder="Layer name" w="w-32" onChange={(v) => set({ ...c, insulation: upd(c.insulation, i, { layer: v }) })} />
            <Remove onClick={() => set({ ...c, insulation: c.insulation.filter((_, j) => j !== i) })} />
          </div>
          <div className="sm:pl-44">{zones(l.fastening, (z) => set({ ...c, insulation: upd(c.insulation, i, { fastening: z }) }))}</div>
        </div>
      ))}
      <button type="button" className="self-start text-xs underline" onClick={() => set({ ...c, insulation: [...c.insulation, { itemNumber: null, layer: `layer ${c.insulation.length + 1}`, fastening: [] }] })}>
        + insulation layer
      </button>
      {c.coverBoard ? (
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <Slot label="Cover board" pick={c.coverBoard} unit="SF/SH" coverageLabel="SF per board" onChange={(p) => set({ ...c, coverBoard: { ...c.coverBoard!, ...p } })} />
          <div className="sm:pl-44">{zones(c.coverBoard.fastening, (z) => set({ ...c, coverBoard: { ...c.coverBoard!, fastening: z } }))}</div>
          {c.system !== "EPDM" && <Remove onClick={() => set({ ...c, coverBoard: null })} />}
        </div>
      ) : (
        <button type="button" className="self-start text-xs underline" onClick={() => set({ ...c, coverBoard: { itemNumber: null, fastening: [] } })}>
          + cover board{c.system === "EPDM" ? " (required on EPDM — ROOF-08)" : ""}
        </button>
      )}
      <Slot label="Fasteners" pick={c.fastener} unit="EA/BX" coverageLabel="per box" onChange={s("fastener")} />
      <Slot label="Plates" pick={c.plate} unit="EA/BX" coverageLabel="per box" onChange={s("plate")} />
      {c.system === "EPDM" && c.preSecured && (
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <Slot label="Pre-secure fasteners" pick={c.preSecurement.fastener} unit="EA/BX" coverageLabel="per box" onChange={(p) => set({ ...c, preSecurement: { ...c.preSecurement, fastener: { ...c.preSecurement.fastener, ...p } } })} />
          <Slot label="Pre-secure plates" pick={c.preSecurement.plate} unit="EA/BX" coverageLabel="per box" onChange={(p) => set({ ...c, preSecurement: { ...c.preSecurement, plate: { ...c.preSecurement.plate, ...p } } })} />
          <div className="flex items-center gap-2 sm:pl-44">
            <Num value={c.preSecurement.count} placeholder="count" onChange={(v) => set({ ...c, preSecurement: { ...c.preSecurement, count: v } })} />
            <span className="text-xs">pre-securement fasteners per the manufacturer pattern</span>
          </div>
        </div>
      )}
      <Slot label="Seam tape" pick={c.seamTape} unit="LF/RL" onChange={s("seamTape")} />
      {c.seamTape.itemNumber && (
        <div className="flex items-center gap-2 sm:pl-44">
          <Num value={c.seamTape.lf} placeholder="seam LF" onChange={(v) => set({ ...c, seamTape: { ...c.seamTape, lf: v } })} />
          <span className="text-xs">LF of seams</span>
        </div>
      )}
      <Slot label="Primer" pick={c.primer} unit={null} coverageLabel={`SF per ${c.primer.unit}`} onChange={s("primer")} />
      <Slot label="Adhesive" pick={c.adhesive} unit={null} coverageLabel={`SF per ${c.adhesive.unit}`} onChange={s("adhesive")} />
      <Slot label="Termination bar" pick={c.terminationBar} unit={null} coverageLabel="LF per piece" onChange={s("terminationBar")} />
      {c.terminationBar.itemNumber && (
        <div className="flex items-center gap-2 sm:pl-44">
          <Num value={c.terminationBar.lf} placeholder="LF" onChange={(v) => set({ ...c, terminationBar: { ...c.terminationBar, lf: v } })} />
          <span className="text-xs">LF</span>
        </div>
      )}
      <Slot label="Edge metal" pick={c.edgeMetal} unit={null} coverageLabel="LF per piece" onChange={s("edgeMetal")} />
      {c.edgeMetal.itemNumber && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-44">
          <MeasureSelect value={c.edgeMetal.lfFrom} onChange={(v) => set({ ...c, edgeMetal: { ...c.edgeMetal, lfFrom: v } })} />
          {!c.edgeMetal.lfFrom && <Num value={c.edgeMetal.lf} placeholder="LF" onChange={(v) => set({ ...c, edgeMetal: { ...c.edgeMetal, lf: v } })} />}
        </div>
      )}
      <AccessoryRows rows={c.accessories} onChange={(a) => set({ ...c, accessories: a })} />
    </div>
  );
}

function AccessoryRows({ rows, onChange }: { rows: LowSlopeConfig["accessories"]; onChange: (r: LowSlopeConfig["accessories"]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">Accessories (walk pads, pipe boots, corners, curbs, drains…)</span>
      {rows.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <div className="min-w-72 flex-1">
            <ItemPicker value={{ itemNumber: a.itemNumber, description: a.name }} label={a.label || "Accessory"} onPick={(it) => onChange(upd(rows, i, fromItem(a, it)))} />
          </div>
          <Txt value={a.label} placeholder="Label" w="w-32" onChange={(v) => onChange(upd(rows, i, { label: v }))} />
          <MeasureSelect value={a.qtyFrom} onChange={(v) => onChange(upd(rows, i, { qtyFrom: v }))} />
          {!a.qtyFrom && <Num value={a.qty} placeholder="qty" w="w-20" onChange={(v) => onChange(upd(rows, i, { qty: v }))} />}
          <Txt value={a.unit} placeholder="EA" w="w-16" onChange={(v) => onChange(upd(rows, i, { unit: v }))} />
          <Remove onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button type="button" className="self-start text-xs underline" onClick={() => onChange([...rows, { itemNumber: null, key: `a${Date.now()}`, label: "", qty: null, qtyFrom: null, unit: "EA" }])}>
        + accessory
      </button>
    </div>
  );
}

function DeckEditor({ c, set }: { c: DeckConfig; set: (c: DeckConfig) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Deck isn&apos;t on the BTR sheets; add the deck supplier&apos;s quote as a priced line if needed. Coverage and fastening patterns come from the deck spec.</p>
      <Slot label="Deck" pick={c.deck} unit={null} coverageLabel={`SF per ${c.deck.unit}`} onChange={(p) => set({ ...c, deck: { ...c.deck, ...p } })} />
      <Slot label="Side-lap fasteners" pick={c.sideLap} unit="EA/BX" coverageLabel="per box" onChange={(p) => set({ ...c, sideLap: { ...c.sideLap, ...p } })} />
      <div className="flex items-center gap-2 sm:pl-44">
        <Num value={c.sideLap.perSheet} placeholder="per sheet" onChange={(v) => set({ ...c, sideLap: { ...c.sideLap, perSheet: v } })} />
        <span className="text-xs">side-lap fasteners per sheet (spec)</span>
      </div>
      <Slot label="Deck screws" pick={c.screws} unit="EA/BX" coverageLabel="per box" onChange={(p) => set({ ...c, screws: { ...c.screws, ...p } })} />
      <div className="flex items-center gap-2 sm:pl-44">
        <Num value={c.screws.perSheet} placeholder="per sheet" onChange={(v) => set({ ...c, screws: { ...c.screws, perSheet: v } })} />
        <span className="text-xs">screws per sheet</span>
        <Num value={c.weldsPerSheet} placeholder="welds/sheet" onChange={(v) => set({ ...c, weldsPerSheet: v })} />
        <span className="text-xs">puddle welds per sheet</span>
      </div>
      <Slot label="Closures" pick={c.closures} unit={null} coverageLabel="LF per piece" onChange={(p) => set({ ...c, closures: { ...c.closures, ...p } })} />
      <div className="flex items-center gap-2 sm:pl-44">
        <Num value={c.closures.lf} placeholder="LF" onChange={(v) => set({ ...c, closures: { ...c.closures, lf: v } })} />
        <span className="text-xs">LF of closures</span>
      </div>
    </div>
  );
}

function SidingEditor({ c, set }: { c: SidingConfig; set: (c: SidingConfig) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Slot label="Siding" pick={c.plank} unit={null} noCoverage onChange={(p) => set({ ...c, plank: { ...c.plank, ...p } })} />
      <div className="flex flex-wrap items-center gap-2 sm:pl-44">
        <Num value={c.plank.exposureIn} placeholder='exposure "' onChange={(v) => set({ ...c, plank: { ...c.plank, exposureIn: v, exposureSource: "confirmed by user" } })} />
        <span className="text-xs">in exposure (confirm from the manufacturer — not assumed)</span>
        <Num value={c.plank.lengthFt} placeholder="length ft" onChange={(v) => set({ ...c, plank: { ...c.plank, lengthFt: v } })} />
        <span className="text-xs">ft long</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">House wrap</span>
        <label className="flex items-center gap-1">
          <input type="radio" checked={c.houseWrap.mode === "cheapest"} onChange={() => set({ ...c, houseWrap: { ...c.houseWrap, mode: "cheapest" } })} /> Cheapest on the siding&apos;s sheet (SID-04)
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={c.houseWrap.mode === "pick"} onChange={() => set({ ...c, houseWrap: { ...c.houseWrap, mode: "pick" } })} /> Spec requires a specific wrap
        </label>
      </div>
      {c.houseWrap.mode === "pick" && <Slot label="Wrap (spec)" pick={c.houseWrap.pick} unit="SF/RL" onChange={(p) => set({ ...c, houseWrap: { ...c.houseWrap, pick: { ...c.houseWrap.pick, ...p } } })} />}
      <span className="text-sm font-medium">Trim, corners, J-channel, starter, fascia (LF → pieces)</span>
      {c.trim.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <div className="min-w-72 flex-1">
            <ItemPicker value={{ itemNumber: t.itemNumber, description: t.name }} label={t.label} onPick={(it) => set({ ...c, trim: upd(c.trim, i, fromItem(t, it)) })} />
          </div>
          <Txt value={t.label} placeholder="Label" w="w-32" onChange={(v) => set({ ...c, trim: upd(c.trim, i, { label: v }) })} />
          <MeasureSelect value={t.lfFrom} onChange={(v) => set({ ...c, trim: upd(c.trim, i, { lfFrom: v }) })} />
          {!t.lfFrom && <Num value={t.lf} placeholder="LF" w="w-20" onChange={(v) => set({ ...c, trim: upd(c.trim, i, { lf: v }) })} />}
          <Num value={t.pieceLengthFt} placeholder="piece ft" w="w-20" onChange={(v) => set({ ...c, trim: upd(c.trim, i, { pieceLengthFt: v }) })} />
          <span className="text-xs">ft pieces</span>
          <Remove onClick={() => set({ ...c, trim: c.trim.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <button type="button" className="self-start text-xs underline" onClick={() => set({ ...c, trim: [...c.trim, { itemNumber: null, key: `t${Date.now()}`, label: "", lf: null, lfFrom: null, pieceLengthFt: 12 }] })}>
        + trim run
      </button>
      <Slot label="Soffit" pick={c.soffit} unit={null} coverageLabel="SF per panel" onChange={(p) => set({ ...c, soffit: { ...c.soffit, ...p } })} />
      {c.soffit.itemNumber && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-44">
          <MeasureSelect value={c.soffit.sfFrom} onChange={(v) => set({ ...c, soffit: { ...c.soffit, sfFrom: v } })} />
          {!c.soffit.sfFrom && <Num value={c.soffit.sf} placeholder="SF" onChange={(v) => set({ ...c, soffit: { ...c.soffit, sf: v } })} />}
        </div>
      )}
      <span className="text-sm font-medium">Counted items (OSI Quad Max, touch-up kits, joint flashing, nails…)</span>
      {c.counted.map((x, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <div className="min-w-72 flex-1">
            <ItemPicker value={{ itemNumber: x.itemNumber, description: x.name }} label={x.label || "Item"} onPick={(it) => set({ ...c, counted: upd(c.counted, i, fromItem(x, it)) })} />
          </div>
          <Txt value={x.label} placeholder="Label" w="w-32" onChange={(v) => set({ ...c, counted: upd(c.counted, i, { label: v }) })} />
          <Num value={x.qty} placeholder="qty" w="w-20" onChange={(v) => set({ ...c, counted: upd(c.counted, i, { qty: v }) })} />
          <Txt value={x.unit} placeholder="TB" w="w-16" onChange={(v) => set({ ...c, counted: upd(c.counted, i, { unit: v }) })} />
          <Remove onClick={() => set({ ...c, counted: c.counted.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <button type="button" className="self-start text-xs underline" onClick={() => set({ ...c, counted: [...c.counted, { itemNumber: null, key: `c${Date.now()}`, label: "", qty: null, unit: "EA" }] })}>
        + counted item
      </button>
    </div>
  );
}

export function TakeoffEditor({ estimateId, module, initial, locked }: { estimateId: string; module: Module; initial: NonNullable<TakeoffConfig[Module]>; locked: boolean }) {
  const [config, setConfig] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<{ problems: string[]; note?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (c: typeof config) => {
    setConfig(c);
    setDirty(true);
  };
  const go = (run: boolean) =>
    start(async () => {
      const r = await saveAndRunTakeoffAction(estimateId, module, config, run);
      setResult(r);
      if (r?.ok) setDirty(false);
    });
  return (
    <fieldset disabled={locked} className="flex flex-col gap-3">
      {module === "steep" && <SteepEditor c={config as SteepConfig} set={set} />}
      {module === "lowSlope" && <LowSlopeEditor c={config as LowSlopeConfig} set={set} />}
      {module === "deck" && <DeckEditor c={config as DeckConfig} set={set} />}
      {module === "siding" && <SidingEditor c={config as SidingConfig} set={set} />}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background py-2">
        <Button type="button" size="sm" disabled={pending || locked} onClick={() => go(true)}>
          {pending ? "Calculating…" : "Save & calculate"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending || locked || !dirty} onClick={() => go(false)}>
          Save only
        </Button>
        {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Unsaved changes</span>}
        {result?.note && <span className="text-xs text-muted-foreground">{result.note}</span>}
        {result?.problems.map((p) => (
          <span key={p} className="text-xs text-destructive">
            {p}
          </span>
        ))}
      </div>
    </fieldset>
  );
}
