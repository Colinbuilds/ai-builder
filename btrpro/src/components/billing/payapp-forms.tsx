"use client";

import { useActionState, useMemo, useState } from "react";
import { contractSettingsAction, newPayAppAction, savePayAppAction } from "@/app/billing/pay-apps/actions";
import { Problems } from "@/components/projects/problems";
import type { SovLine } from "@/lib/billing/payapps";

const box = "h-8 rounded-md border border-input bg-background px-2 text-sm";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function ContractSettings({ id, retainagePct, submitVia, dueNote }: { id: string; retainagePct: number | null; submitVia: string | null; dueNote: string | null }) {
  const [state, dispatch, pending] = useActionState(contractSettingsAction, null);
  return (
    <form action={dispatch} className="flex flex-wrap items-end gap-3 text-sm">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1">
        Retainage %
        <input name="retainagePct" defaultValue={retainagePct ?? ""} inputMode="decimal" placeholder="e.g. 10" className={`${box} w-24`} />
      </label>
      <label className="flex flex-col gap-1">
        Submit through
        <input name="submitVia" defaultValue={submitVia ?? ""} placeholder="Procore, email…" className={`${box} w-64`} />
      </label>
      <label className="flex flex-col gap-1">
        Due
        <input name="dueNote" defaultValue={dueNote ?? ""} placeholder="20th of the month" className={`${box} w-40`} />
      </label>
      <button disabled={pending} className="h-8 rounded-md border px-3 hover:bg-muted">
        Save
      </button>
      {state?.ok && <span className="text-green-700">Saved.</span>}
      <Problems state={state} />
    </form>
  );
}

export function NewPayApp({ id }: { id: string }) {
  const [state, dispatch, pending] = useActionState(newPayAppAction, null);
  const d = new Date();
  const def = new Date(Date.UTC(d.getFullYear(), d.getMonth(), Math.min(20, 28))).toISOString().slice(0, 10);
  return (
    <form action={dispatch} className="flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1">
        Period to
        <input type="date" name="periodTo" defaultValue={def} className={box} />
      </label>
      <button disabled={pending} className="h-8 rounded-md bg-btr-blue px-3 text-white hover:bg-btr-blue-dark disabled:opacity-50">
        Start next pay application
      </button>
      <Problems state={state} />
    </form>
  );
}

export function PayAppEditor({ id, lines, retainagePct, locked }: { id: string; lines: SovLine[]; retainagePct: number; locked: boolean }) {
  const [state, dispatch, pending] = useActionState(savePayAppAction, null);
  const [vals, setVals] = useState(() => Object.fromEntries(lines.map((l) => [l.item, { t: l.thisPeriod, s: l.stored }])));
  const totals = useMemo(() => {
    let sched = 0, prev = 0, th = 0, st = 0;
    for (const l of lines) {
      sched += l.scheduled;
      prev += l.previous;
      th += vals[l.item]?.t ?? 0;
      st += vals[l.item]?.s ?? 0;
    }
    const done = prev + th + st;
    return { sched, prev, th, st, done, ret: (done * retainagePct) / 100 };
  }, [lines, vals, retainagePct]);
  const set = (item: string, k: "t" | "s", v: string) => setVals((x) => ({ ...x, [item]: { ...x[item], [k]: Number(v.replace(/[$,]/g, "")) || 0 } }));
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5">Item</th>
              <th className="px-2 py-1.5">Description</th>
              <th className="px-2 py-1.5 text-right">Scheduled</th>
              <th className="px-2 py-1.5 text-right">Previous</th>
              <th className="px-2 py-1.5 text-right">This period</th>
              <th className="px-2 py-1.5 text-right">Stored</th>
              <th className="px-2 py-1.5 text-right">% done</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const v = vals[l.item];
              const done = l.previous + v.t + v.s;
              const left = Math.round((l.scheduled - l.previous - v.s) * 100) / 100;
              return (
                <tr key={l.item}>
                  <td className="px-2 py-1 text-xs">
                    {l.item}
                    <input type="hidden" name="item" value={l.item} />
                  </td>
                  <td className="px-2 py-1">{l.description}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(l.scheduled)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(l.previous)}</td>
                  <td className="px-2 py-1 text-right">
                    <input name={`this_${l.item}`} disabled={locked} defaultValue={v.t || ""} onChange={(e) => set(l.item, "t", e.target.value)} inputMode="decimal" className={`${box} w-28 text-right`} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input name={`stored_${l.item}`} disabled={locked} defaultValue={v.s || ""} onChange={(e) => set(l.item, "s", e.target.value)} inputMode="decimal" className={`${box} w-24 text-right`} />
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${done > l.scheduled + 0.005 ? "font-semibold text-red-700" : ""}`}>{l.scheduled ? Math.round((done / l.scheduled) * 100) : 0}%</td>
                  <td className="px-2 py-1">
                    {!locked && left > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = (e.currentTarget.closest("tr")!.querySelector(`input[name="this_${l.item}"]`) as HTMLInputElement)!;
                          input.value = String(left);
                          set(l.item, "t", String(left));
                        }}
                        className="text-xs text-btr-link hover:underline"
                      >
                        bill rest
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid max-w-md gap-1 rounded-md border p-3 text-sm">
        {[
          ["Completed & stored to date", totals.done],
          [`Retainage (${retainagePct}%)`, totals.ret],
          ["Earned less retainage", totals.done - totals.ret],
          ["This period (work + stored)", totals.th + totals.st],
          ["Balance to finish", totals.sched - totals.done],
        ].map(([k, v]) => (
          <div key={k as string} className="flex justify-between">
            <span>{k}</span>
            <span className="tabular-nums">{usd(v as number)}</span>
          </div>
        ))}
      </div>
      {!locked && (
        <div className="flex gap-2">
          <button disabled={pending} className="h-9 rounded-md border px-4 text-sm hover:bg-muted">
            Save draft
          </button>
          <button name="submit" value="1" disabled={pending} className="h-9 rounded-md bg-btr-blue px-4 text-sm text-white hover:bg-btr-blue-dark">
            Save and mark submitted
          </button>
          {state?.ok && <span className="self-center text-sm text-green-700">Saved.</span>}
        </div>
      )}
      <Problems state={state} />
    </form>
  );
}
