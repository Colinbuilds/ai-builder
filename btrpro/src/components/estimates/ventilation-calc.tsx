"use client";

import { useMemo, useState } from "react";
import { VENT_PRODUCTS, ventilation } from "@/lib/estimates/ventilation";
import { useBrand } from "@/components/brand";

const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** Code ventilation count — Lomanco method. Ratings come from the product list (with sources) or are typed in. */
export function VentilationCalc({ initialAttic, source }: { initialAttic: number | null; source: string | null }) {
  const { shortName } = useBrand();
  const [attic, setAttic] = useState(initialAttic ? String(initialAttic) : "");
  const [ratio, setRatio] = useState<150 | 300>(300);
  const [ex, setEx] = useState("lomanco-135");
  const [exCustom, setExCustom] = useState("");
  const [inn, setInn] = useState("custom");
  const [inCustom, setInCustom] = useState("");
  const exNfa = ex === "custom" ? num(exCustom) : (VENT_PRODUCTS.find((p) => p.id === ex)?.nfa ?? null);
  const inNfa = inn === "custom" ? num(inCustom) : (VENT_PRODUCTS.find((p) => p.id === inn)?.nfa ?? null);
  const a = num(attic);
  const r = useMemo(() => (a ? ventilation(a, ratio, exNfa, inNfa) : null), [a, ratio, exNfa, inNfa]);
  const field = "h-9 rounded-md border border-input bg-background px-2";
  const exProduct = VENT_PRODUCTS.find((p) => p.id === ex);
  const inProduct = VENT_PRODUCTS.find((p) => p.id === inn);
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Attic floor area (SF)</span>
          <input id="vent-attic" value={attic} onChange={(e) => setAttic(e.target.value)} inputMode="decimal" className={field} placeholder="e.g. 2,000" />
          {source && <span className="text-xs text-muted-foreground">From the job: {source}</span>}
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">Ratio</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="ratio" checked={ratio === 300} onChange={() => setRatio(300)} /> 1/300 — balanced intake &amp; exhaust ({shortName} default)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="ratio" checked={ratio === 150} onChange={() => setRatio(150)} /> 1/150 — when the 1/300 conditions aren&apos;t met
          </label>
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Exhaust vent</span>
          <select id="vent-ex" value={ex} onChange={(e) => setEx(e.target.value)} className={field}>
            {VENT_PRODUCTS.filter((p) => p.kind === "exhaust").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.nfa} sq in
              </option>
            ))}
            <option value="custom">Other — enter its rating</option>
          </select>
          {ex === "custom" && <input value={exCustom} onChange={(e) => setExCustom(e.target.value)} inputMode="decimal" className={field} placeholder="Net free area per vent, sq in (from the manufacturer)" />}
          {exProduct && (
            <a href={exProduct.source} target="_blank" rel="noreferrer" className="text-xs text-btr-link hover:underline">
              Rating source
            </a>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Intake (soffit or intake vent)</span>
          <select id="vent-in" value={inn} onChange={(e) => setInn(e.target.value)} className={field}>
            <option value="custom">Enter its rating</option>
            {VENT_PRODUCTS.filter((p) => p.kind === "intake").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.nfa} sq in
              </option>
            ))}
          </select>
          {inn === "custom" && <input value={inCustom} onChange={(e) => setInCustom(e.target.value)} inputMode="decimal" className={field} placeholder="Net free area per piece or vent, sq in" />}
          {inProduct && (
            <a href={inProduct.source} target="_blank" rel="noreferrer" className="text-xs text-btr-link hover:underline">
              Rating source
            </a>
          )}
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {!r ? (
          <p className="text-sm text-muted-foreground">Enter the attic floor area to see what code requires.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-4">
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Exhaust</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{r.exhaustCount ?? "MISSING"}</div>
                <div className="text-sm text-muted-foreground">{r.exhaustSqIn.toLocaleString()} sq in needed{r.exhaustCount == null ? " · enter the vent's rating" : " · vents"}</div>
              </div>
              <div className="rounded-md border p-4">
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Intake</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{r.intakeCount ?? "MISSING"}</div>
                <div className="text-sm text-muted-foreground">{r.intakeSqIn.toLocaleString()} sq in needed{r.intakeCount == null ? " · enter the intake product's rating" : " · pieces / vents"}</div>
              </div>
            </div>
            <ol className="list-decimal pl-5 text-sm">
              {r.formula.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">
              Method: Lomanco / IRC — 1 sq ft of net free area per 150 sq ft of attic, or per 300 when the vapor-retarder and vent-placement conditions are
              met; split evenly between intake and exhaust. Vent counts round up.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
