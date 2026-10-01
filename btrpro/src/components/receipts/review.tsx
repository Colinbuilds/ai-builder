"use client";

import { useMemo, useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { approveReceiptAction } from "@/app/receipts/actions";
import { receiptPricing } from "@/lib/receipts/pricing";
import { Problems } from "@/components/projects/problems";
import { Button } from "@/components/ui/button";

type Line = { itemNumber: string | null; description: string; quantity: number | null; uom: string | null; amount: number | null };
type Outcome = "COST_ONLY" | "CHANGE_ORDER" | "INVOICE";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (s: string) => {
  const t = s.replace(/[%\s]/g, "");
  return t === "" ? NaN : Number(t);
};

export function ReceiptReview(props: {
  id: string;
  vendor: string;
  date: string | null;
  invoiceNumber: string | null;
  employee: string | null;
  lines: Line[];
  tax: number | null;
  defaultMarkup: number;
  lineMarkup: Record<string, number>;
  reason: string | null;
  project: { id: string; name: string; address: string | null; sold: boolean; contractNow: number | null } | null;
  company: { name: string; address: string };
  qbo: { connected: boolean; itemSet: boolean; expenseSet: boolean };
  filed: { outcome: string | null; qboStatus: string | null } | null;
  canApprove: boolean;
}) {
  const p = props;
  const [markup, setMarkup] = useState(String(p.defaultMarkup));
  const [lineM, setLineM] = useState<Record<string, string>>(Object.fromEntries(Object.entries(p.lineMarkup).map(([k, v]) => [k, String(v)])));
  const [outcome, setOutcome] = useState<Outcome>((p.filed?.outcome as Outcome) ?? (p.project?.sold ? "CHANGE_ORDER" : "COST_ONLY"));
  const [reason, setReason] = useState(p.reason ?? "");
  const [state, action, pending] = useFormAction(approveReceiptAction, null);
  const base = num(markup);
  const markups = p.lines.map((_, i) => {
    const o = lineM[String(i)];
    return o != null && o !== "" && Number.isFinite(num(o)) ? num(o) : Number.isFinite(base) ? base : 0;
  });
  const pr = useMemo(() => receiptPricing(p.lines.map((l) => l.amount ?? 0), p.tax, markups), [p.lines, p.tax, markups.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const overrides = Object.fromEntries(
    Object.entries(lineM)
      .filter(([, v]) => v !== "" && Number.isFinite(num(v)))
      .map(([k, v]) => [k, num(v)]),
  );
  const done = !!p.filed;
  const items = p.lines.map((l, i) => ({ item: l.description, qty: l.quantity != null ? `${l.quantity} ${l.uom ?? ""}`.trim() : "", amount: pr.lines[i].billed }));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-btr-line bg-background p-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pricing · internal only</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Item</th>
                <th className="py-1 pr-2 text-right font-medium">Cost</th>
                <th className="py-1 pr-2 text-right font-medium">Markup</th>
                <th className="py-1 pr-2 text-right font-medium">Billed</th>
                <th className="py-1 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="py-1.5 pr-2">
                    {l.description}
                    {l.quantity != null && (
                      <span className="block text-xs text-muted-foreground">
                        {l.quantity} {l.uom}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{usd(pr.lines[i].cost)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <input
                      aria-label={`Markup for ${l.description}`}
                      disabled={done}
                      value={lineM[String(i)] ?? ""}
                      placeholder={`${Number.isFinite(base) ? base : 0}`}
                      onChange={(e) => setLineM({ ...lineM, [String(i)]: e.target.value })}
                      className="w-14 rounded border border-input bg-background px-1 py-0.5 text-right text-sm tabular-nums"
                    />
                    %
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{usd(pr.lines[i].billed)}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(pr.lines[i].profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Cost (incl. tax)" value={usd(pr.cost)} />
          <div className="rounded-md border border-btr-line p-2">
            <div className="text-xs text-muted-foreground">Markup</div>
            <label className="flex items-baseline gap-1 text-lg font-semibold">
              <input aria-label="Markup for the whole receipt" disabled={done} value={markup} onChange={(e) => setMarkup(e.target.value)} className="w-16 rounded border border-input bg-background px-1 text-right tabular-nums" />%
            </label>
          </div>
          <Tile label="Total billed" value={usd(pr.billed)} />
          <Tile label={`Profit · ${pr.marginPct ?? 0}% margin`} value={usd(pr.profit)} strong />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {p.tax ? `The ${usd(p.tax)} sales tax you paid is counted in cost and spread across the lines. ` : "No sales tax printed. "}Markup is {p.defaultMarkup}% by default (Company settings); change it for this receipt or per line.
        </p>
      </section>

      <section className="rounded-lg border border-btr-line bg-background p-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Make</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["COST_ONLY", "Job cost only", "Materials for the contracted work — nothing billed."],
              ["CHANGE_ORDER", "Change order", "Extra work: the customer signs it, then it adds to the contract."],
              ["INVOICE", "Invoice", "Bill the materials now."],
            ] as const
          ).map(([k, l, h]) => (
            <label key={k} className={`flex cursor-pointer flex-col rounded-md border p-2 text-sm ${outcome === k ? "border-btr-black ring-1 ring-btr-black" : "border-btr-line"} ${done ? "opacity-70" : ""}`}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="outcome-pick" checked={outcome === k} disabled={done} onChange={() => setOutcome(k)} />
                {l}
              </span>
              <span className="text-xs text-muted-foreground">{h}</span>
            </label>
          ))}
        </div>
        {outcome !== "COST_ONLY" && (
          <label className="mt-3 flex flex-col gap-1 text-sm">
            <span className="font-medium">Reason (shows on the {outcome === "CHANGE_ORDER" ? "change order" : "invoice"})</span>
            <textarea value={reason} disabled={done} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-md border border-input bg-background px-2 py-1" placeholder="e.g. Rotted decking found on the back slope; customer approved replacement." />
          </label>
        )}
      </section>

      {outcome !== "COST_ONLY" && p.project && (
        <section className="rounded-lg border border-btr-line bg-background p-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{outcome === "CHANGE_ORDER" ? "Change order" : "Invoice"} · what the customer sees</h2>
          <div className="rounded-md border border-btr-line p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{p.company.name}</div>
                <div className="text-xs text-muted-foreground">{p.company.address}</div>
              </div>
              <div className="text-base font-bold tracking-wide">{outcome === "CHANGE_ORDER" ? "CHANGE ORDER" : "INVOICE"}</div>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="font-medium">Project</dt>
              <dd>{p.project.name}</dd>
              {p.project.address && (
                <>
                  <dt className="font-medium">Location</dt>
                  <dd>{p.project.address}</dd>
                </>
              )}
              <dt className="font-medium">Date</dt>
              <dd>{p.date ?? new Date().toISOString().slice(0, 10)}</dd>
              {outcome === "CHANGE_ORDER" && reason && (
                <>
                  <dt className="font-medium">Reason</dt>
                  <dd>{reason}</dd>
                </>
              )}
            </dl>
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Vendor</th>
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-2">{p.vendor}</td>
                    <td className="py-1 pr-2">{x.item}</td>
                    <td className="py-1 pr-2 text-right">{x.qty}</td>
                    <td className="py-1 text-right tabular-nums">{usd(x.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td colSpan={3} className="py-1">
                    Total
                  </td>
                  <td className="py-1 text-right tabular-nums">{usd(pr.billed)}</td>
                </tr>
              </tbody>
            </table>
            {outcome === "CHANGE_ORDER" && (
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-2 text-xs">
                <dt>Net increase</dt>
                <dd className="text-right tabular-nums">{usd(pr.billed)}</dd>
                <dt>Previous contract price</dt>
                <dd className="text-right tabular-nums">{p.project.contractNow != null ? usd(p.project.contractNow) : "MISSING"}</dd>
                <dt className="font-semibold">Contract price with this change</dt>
                <dd className="text-right font-semibold tabular-nums">{p.project.contractNow != null ? usd(p.project.contractNow + pr.billed) : "MISSING"}</dd>
              </dl>
            )}
            {outcome === "INVOICE" && !p.project.sold && <p className="mt-2 text-xs font-medium">This job isn&apos;t sold yet, so it can&apos;t be invoiced. Use a change order or cost only.</p>}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-btr-line bg-background p-4 text-sm">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">QuickBooks Online · sent on approval</h2>
        {!p.qbo.connected ? (
          <p className="text-muted-foreground">QuickBooks isn&apos;t connected (Admin → Integrations), so nothing will be sent. Everything still files in BTRpro.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {outcome === "CHANGE_ORDER" && <QboRow title="Change order as an Estimate" amount={usd(pr.billed)} note={`Customer: ${p.project?.name ?? "the job"} · ${p.lines.length} lines`} ok={p.qbo.itemSet} />}
            {outcome === "INVOICE" && <QboRow title="Invoice" amount={usd(pr.billed)} note={`Customer: ${p.project?.name ?? "the job"} · ${p.lines.length} lines`} ok={p.qbo.itemSet} />}
            <QboRow title="Expense (job cost)" amount={usd(pr.cost)} note={`Vendor: ${p.vendor} · Customer: ${p.project?.name ?? "the job"}`} ok={p.qbo.expenseSet} />
          </ul>
        )}
        {p.filed?.qboStatus && <p className="mt-2 text-xs">{p.filed.qboStatus}</p>}
      </section>

      {!done && p.canApprove && (
        <form onSubmit={action} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="projectId" value={p.project?.id ?? ""} />
          <input type="hidden" name="outcome" value={outcome} />
          <input type="hidden" name="markupPct" value={markup} />
          <input type="hidden" name="lineMarkup" value={JSON.stringify(overrides)} />
          <input type="hidden" name="reason" value={reason} />
          <Button disabled={pending || !p.project || !!state?.ok || (outcome === "INVOICE" && !p.project?.sold)}>
            {pending ? "Approving…" : !p.project ? "Pick the job first" : outcome === "COST_ONLY" ? "Approve — file to job costs" : outcome === "CHANGE_ORDER" ? "Approve — draft change order + file costs" : "Approve — draft invoice + file costs"}
          </Button>
          {state?.ok && <p className="text-sm text-btr-blue">{state.note}</p>}
          <Problems state={state} />
        </form>
      )}
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-md p-2 ${strong ? "bg-btr-black text-white" : "border border-btr-line"}`}>
      <div className={`text-xs ${strong ? "text-white/70" : "text-muted-foreground"}`}>{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function QboRow({ title, amount, note, ok }: { title: string; amount: string; note: string; ok: boolean }) {
  return (
    <li className="rounded-md border border-btr-line p-2">
      <div className="flex justify-between gap-2 font-medium">
        <span>{title}</span>
        <span className="tabular-nums">{amount}</span>
      </div>
      <div className="text-xs text-muted-foreground">{note}</div>
      {!ok && <div className="text-xs font-medium">Set the QuickBooks ids under Admin → Company settings first.</div>}
    </li>
  );
}
