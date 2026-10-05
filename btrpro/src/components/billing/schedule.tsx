"use client";

import { useFormAction } from "@/components/use-form-action";
import { scheduleAction } from "@/app/projects/billing-actions";

type Step = { id: string; label: string; basis: string; pct: number | null; amount: number | null; trigger: string; triggerDate: string | null; status: string; preview: number | null; invoiceNumber: string | null };
const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const input = "h-8 rounded-md border border-input bg-background px-2 text-sm";
const STATUS: Record<string, string> = { PLANNED: "waiting", READY: "ready to bill", INVOICED: "invoiced", SKIPPED: "skipped" };

function Msg({ s }: { s: { problems: string[]; note?: string } | null }) {
  if (!s) return null;
  return s.problems.length ? <p className="text-sm text-red-700">{s.problems.join(" ")}</p> : s.note ? <p className="text-sm text-green-700">{s.note}</p> : null;
}

/** One button that runs a schedule op. */
function Op({ projectId, op, id, label, primary }: { projectId: string; op: string; id?: string; label: string; primary?: boolean }) {
  const [s, act, pending] = useFormAction(scheduleAction, null);
  return (
    <form onSubmit={act} className="inline-flex flex-col items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="op" value={op} />
      {id && <input type="hidden" name="id" value={id} />}
      <button disabled={pending} className={primary ? "h-8 rounded-md bg-btr-blue px-3 text-sm text-white hover:bg-btr-blue-dark disabled:opacity-60" : "h-8 rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-60"}>
        {pending ? "…" : label}
      </button>
      {s?.problems.length ? <span className="max-w-xs text-right text-xs text-red-700">{s.problems.join(" ")}</span> : null}
    </form>
  );
}

export function BillingSchedule({ projectId, steps, triggers, bases, presets, warnings, canEdit }: { projectId: string; steps: Step[]; triggers: Record<string, string>; bases: Record<string, string>; presets: { key: string; label: string }[]; warnings: string[]; canEdit: boolean }) {
  const [addS, add, adding] = useFormAction(scheduleAction, null, { resetOnOk: true });
  const [preS, pre, presetting] = useFormAction(scheduleAction, null);
  const [pctS, pct, billing] = useFormAction(scheduleAction, null, { resetOnOk: true });
  return (
    <section className="flex flex-col gap-3 rounded-md border p-3">
      <div>
        <h2 className="font-semibold">Progress billing schedule</h2>
        <p className="text-sm text-muted-foreground">
          Bill the job in draws as the work moves. Each draw comes due on a job event; when it does, it shows here and on the Office desk, and the salesperson gets a task. Draft the invoice with one click,
          check it, send it. Amounts follow the contract including approved change orders.
        </p>
      </div>

      {steps.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Draw</th>
              <th className="py-1">Amount</th>
              <th className="py-1">Comes due</th>
              <th className="py-1">Status</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {steps.map((s, i) => (
              <tr key={s.id} className={s.status === "SKIPPED" ? "opacity-50" : s.status === "READY" ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                <td className="py-1.5 pr-2">
                  {i + 1}. {s.label}
                </td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {usd(s.preview)}
                  <span className="block text-xs text-muted-foreground">{s.basis === "PERCENT" ? `${s.pct}% of contract` : bases[s.basis]}</span>
                </td>
                <td className="py-1.5 pr-2">
                  {triggers[s.trigger]}
                  {s.triggerDate && ` ${s.triggerDate}`}
                </td>
                <td className="py-1.5 pr-2">
                  <span className={s.status === "READY" ? "font-medium text-amber-800" : s.status === "INVOICED" ? "text-green-700" : "text-muted-foreground"}>{STATUS[s.status] ?? s.status}</span>
                  {s.invoiceNumber && <span className="block font-mono text-xs">{s.invoiceNumber}</span>}
                </td>
                <td className="py-1.5 text-right">
                  {canEdit && (
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      {(s.status === "READY" || s.status === "PLANNED") && <Op projectId={projectId} op="invoice" id={s.id} label={s.status === "READY" ? "Draft invoice" : "Bill now"} primary={s.status === "READY"} />}
                      {s.status === "PLANNED" && s.trigger === "MANUAL" && <Op projectId={projectId} op="ready" id={s.id} label="Mark ready" />}
                      {s.status !== "INVOICED" && s.status !== "SKIPPED" && <Op projectId={projectId} op="skip" id={s.id} label="Skip" />}
                      {s.status === "PLANNED" && <Op projectId={projectId} op="delete" id={s.id} label="Remove" />}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {warnings.map((w) => (
        <p key={w} className="text-sm text-amber-800">
          ⚠ {w}
        </p>
      ))}

      {canEdit && (
        <div className="grid gap-3 lg:grid-cols-3">
          {!steps.some((s) => s.status !== "SKIPPED") && (
            <form onSubmit={pre} className="flex flex-col gap-2 rounded-md bg-muted/40 p-2 text-sm">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="op" value="preset" />
              <span className="font-medium">Start from a schedule</span>
              <select name="preset" className={input} defaultValue={presets[0]?.key}>
                {presets.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button disabled={presetting} className="h-8 self-start rounded-md bg-btr-blue px-3 text-white hover:bg-btr-blue-dark disabled:opacity-60">
                Use it
              </button>
              <Msg s={preS} />
            </form>
          )}
          <form onSubmit={add} className="flex flex-col gap-2 rounded-md bg-muted/40 p-2 text-sm">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="op" value="add" />
            <span className="font-medium">Add a draw</span>
            <input name="label" placeholder="Name — e.g. Dry-in" className={input} />
            <div className="flex gap-1">
              <select name="basis" defaultValue="PERCENT" className={`${input} flex-1`}>
                {Object.entries(bases).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input name="value" inputMode="decimal" placeholder="% or $" className={`${input} w-20`} />
            </div>
            <div className="flex gap-1">
              <select name="trigger" defaultValue="STARTED" className={`${input} flex-1`}>
                {Object.entries(triggers).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input name="triggerDate" type="date" className={`${input} w-36`} title="Only for “On a date”" />
            </div>
            <button disabled={adding} className="h-8 self-start rounded-md border px-3 hover:bg-muted disabled:opacity-60">
              Add draw
            </button>
            <Msg s={addS} />
          </form>
          <form onSubmit={pct} className="flex flex-col gap-2 rounded-md bg-muted/40 p-2 text-sm">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="op" value="percent" />
            <span className="font-medium">Bill by % complete</span>
            <span className="text-xs text-muted-foreground">For jobs billed on progress: the invoice is the contract × % complete, less everything already invoiced.</span>
            <label className="flex items-center gap-2">
              <input name="pct" inputMode="decimal" placeholder="65" className={`${input} w-20`} /> % complete
            </label>
            <button disabled={billing} className="h-8 self-start rounded-md border px-3 hover:bg-muted disabled:opacity-60">
              Draft progress invoice
            </button>
            <Msg s={pctS} />
          </form>
        </div>
      )}
    </section>
  );
}
