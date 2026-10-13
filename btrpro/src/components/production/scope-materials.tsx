"use client";

import { useState, useTransition } from "react";
import { scopeDetailsAction } from "@/app/production/homes/actions";

type Row = { name: string; qty: string; unit: string };
const cell = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** One scope's material list, sell and pay out inside a house's drop-down. */
export function ScopeMaterials({ id, scope, materials, sell, payout, source, notes, canEdit }: { id: string; scope: string; notes?: string | null; materials: { name: string; qty: number; unit: string }[]; sell: number | null; payout: number | null; source: string | null; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(materials.length ? materials.map((m) => ({ name: m.name, qty: String(m.qty), unit: m.unit })) : [{ name: "", qty: "", unit: "" }]);
  const [s, setSell] = useState(sell == null ? "" : String(sell));
  const [p, setPayout] = useState(payout == null ? "" : String(payout));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, k: keyof Row, v: string) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setMsg(null);
  };
  const sv = Number(s.replace(/[$,\s]/g, ""));
  const pv = Number(p.replace(/[$,\s]/g, ""));
  const spread = s.trim() && p.trim() && Number.isFinite(sv) && Number.isFinite(pv) ? sv - pv : null;
  return (
    <section className="flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{scope}</h3>
        <span className="text-xs text-muted-foreground">{source ?? "No material list yet — type it in."}</span>
      </div>
      {notes && <p className="text-xs text-muted-foreground">{notes}</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-1 font-normal">Material</th>
            <th className="w-24 pb-1 font-normal">Qty</th>
            <th className="w-20 pb-1 font-normal">Unit</th>
            {canEdit && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-1">
                <input aria-label={`${scope} material ${i + 1}`} value={r.name} disabled={!canEdit} onChange={(e) => set(i, "name", e.target.value)} className={cell} />
              </td>
              <td className="py-0.5 pr-1">
                <input aria-label={`${scope} quantity ${i + 1}`} value={r.qty} inputMode="decimal" disabled={!canEdit} onChange={(e) => set(i, "qty", e.target.value)} className={`${cell} text-right tabular-nums`} />
              </td>
              <td className="py-0.5 pr-1">
                <input aria-label={`${scope} unit ${i + 1}`} value={r.unit} disabled={!canEdit} onChange={(e) => set(i, "unit", e.target.value)} placeholder="EA" className={cell} />
              </td>
              {canEdit && (
                <td className="py-0.5 text-center">
                  <button type="button" aria-label={`Remove ${r.name || "line"}`} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ name: "", qty: "", unit: "" }])} className="text-muted-foreground hover:text-red-700">
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <button type="button" onClick={() => setRows([...rows, { name: "", qty: "", unit: "" }])} className="self-start text-xs text-btr-link hover:underline">
          + Add material
        </button>
      )}
      <div className="flex flex-wrap items-end gap-3 border-t pt-2">
        <label className="flex flex-col gap-1 text-xs">
          Sell (to builder)
          <input aria-label={`${scope} sell`} value={s} inputMode="decimal" disabled={!canEdit} onChange={(e) => (setSell(e.target.value), setMsg(null))} className={`${cell} w-32 text-right tabular-nums`} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Pay out (to crew)
          <input aria-label={`${scope} pay out`} value={p} inputMode="decimal" disabled={!canEdit} onChange={(e) => (setPayout(e.target.value), setMsg(null))} className={`${cell} w-32 text-right tabular-nums`} />
        </label>
        {spread != null && <span className={`pb-1.5 text-xs ${spread < 0 ? "text-red-700" : "text-muted-foreground"}`}>Sell − pay out: {usd(spread)}</span>}
        {canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await scopeDetailsAction(id, { materials: rows, sell: s, payout: p });
                setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Saved." });
              })
            }
            className="ml-auto h-8 rounded-md bg-btr-blue px-3 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50"
          >
            {pending ? "Saving…" : `Save ${scope}`}
          </button>
        )}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>{msg.text}</p>}
    </section>
  );
}
