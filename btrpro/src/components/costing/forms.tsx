"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  addChangeOrderAction,
  addCommitmentAction,
  addCostAction,
  bidResultAction,
  closeCostingAction,
  commitmentStatusAction,
  commissionPlanAction,
  decideChangeOrderAction,
  deleteCostAction,
  freezeBaselineAction,
  invoiceImportAction,
  noneExpectedAction,
  reopenCostingAction,
  type CResult,
} from "@/app/projects/costing-actions";
import { CATEGORY_LABEL, COST_CATEGORIES } from "@/lib/costing/pnl";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const today = () => new Date().toISOString().slice(0, 10);
const Saved = ({ state, text = "Saved." }: { state: CResult; text?: string }) => (state?.ok ? <span className="text-sm text-green-700 dark:text-green-400">{state.note ?? text}</span> : null);

function CategorySelect({ defaultValue, name = "category" }: { defaultValue?: string; name?: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} required>
      <option value="" disabled>
        Category…
      </option>
      {COST_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_LABEL[c]}
        </option>
      ))}
    </Select>
  );
}

export function AddCostForm({ projectId, commitments }: { projectId: string; commitments: { id: string; label: string }[] }) {
  const [state, action, pending] = useFormAction(addCostAction, null, { resetOnOk: true });
  const [mode, setMode] = useState<"bill" | "crew">("bill");
  return (
    <form onSubmit={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "bill"} onChange={() => setMode("bill")} /> Bill / receipt / credit
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "crew"} onChange={() => setMode("crew")} /> Crew hours
        </label>
      </div>
      {mode === "crew" && <input type="hidden" name="kind" value="CREW_HOURS" />}
      <div className="grid gap-2 sm:grid-cols-4">
        {mode === "crew" ? (
          <>
            <input type="hidden" name="category" value="LABOR" />
            <Input name="vendor" placeholder="Crew / foreman" required />
          </>
        ) : (
          <>
            <CategorySelect />
            <Input name="vendor" placeholder="Vendor / sub / crew" required />
          </>
        )}
        <Input name="date" type="date" defaultValue={today()} required />
        <Input name="reference" placeholder="Invoice / ticket / check #" />
      </div>
      <Input name="description" placeholder={mode === "crew" ? "Tear-off and dry-in, day 1" : "What was it for?"} required />
      {mode === "crew" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Input name="hours" inputMode="decimal" placeholder="Total crew hours" required />
          <Input name="rate" inputMode="decimal" placeholder="$ / hour" required />
          <Input name="burdenPct" inputMode="decimal" placeholder="Burden % (0 if none)" required />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <Input name="amount" inputMode="decimal" placeholder="Amount (negative = return/credit)" required />
          <Select name="commitmentId" defaultValue="">
            <option value="">Not against a commitment</option>
            {commitments.map((c) => (
              <option key={c.id} value={c.id}>
                Bills: {c.label}
              </option>
            ))}
          </Select>
          <Input name="file" type="file" accept="image/*,application/pdf" capture="environment" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          Add cost
        </Button>
        <Saved state={state} text="Added." />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function DeleteCost({ projectId, costId }: { projectId: string; costId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(deleteCostAction, null);
  if (!open)
    return (
      <button className="text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        remove
      </button>
    );
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="costId" value={costId} />
      <div className="flex gap-1">
        <Input name="reason" className="h-7 w-40 text-xs" placeholder="Why?" autoFocus required />
        <Button size="sm" variant="outline" className="h-7" disabled={pending}>
          Remove
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}

export function CommitmentForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(addCommitmentAction, null, { resetOnOk: true });
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-2 sm:grid-cols-5">
        <CategorySelect />
        <Input name="vendor" placeholder="Vendor / sub" required />
        <Input name="description" placeholder="Open order, sub proposal…" required />
        <Input name="amount" inputMode="decimal" placeholder="Amount" required />
        <Input name="reference" placeholder="PO / proposal #" />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending}>
          Add commitment
        </Button>
        <Saved state={state} text="Added." />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function CommitmentStatus({ projectId, id, status }: { projectId: string; id: string; status: string }) {
  const [state, action] = useFormAction(commitmentStatusAction, null);
  return (
    <form onSubmit={action} className="flex items-center gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="id" value={id} />
      {status === "OPEN" ? (
        <>
          <Button size="sm" variant="ghost" className="h-7 text-xs" name="status" value="BILLED">
            Fully billed
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" name="status" value="CANCELLED">
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 text-xs" name="status" value="OPEN">
          Reopen
        </Button>
      )}
      <Problems state={state} />
    </form>
  );
}

export function ChangeOrderForm({ projectId, market }: { projectId: string; market: string }) {
  const [state, action, pending] = useFormAction(addChangeOrderAction, null, { resetOnOk: true });
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-2 sm:grid-cols-4">
        <Select name="kind" defaultValue={market === "RESIDENTIAL" ? "SUPPLEMENT" : "CHANGE_ORDER"}>
          <option value="CHANGE_ORDER">Change order</option>
          <option value="SUPPLEMENT">Insurance supplement</option>
          <option value="CREDIT">Credit to customer</option>
        </Select>
        <Input name="amount" inputMode="decimal" placeholder="Amount to customer" required />
        <Input name="costImpact" inputMode="decimal" placeholder="Added cost to us (if known)" />
        <Input name="source" placeholder="Source: signed CO, adjuster email…" />
      </div>
      <Input name="description" placeholder="What changed" required />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending}>
          Add
        </Button>
        <Saved state={state} text="Added — pending approval." />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function DecideChangeOrder({ projectId, id, status }: { projectId: string; id: string; status: string }) {
  const [state, action] = useFormAction(decideChangeOrderAction, null);
  return (
    <form onSubmit={action} className="flex items-center gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="id" value={id} />
      {status !== "APPROVED" && (
        <Button size="sm" variant="ghost" className="h-7 text-xs" name="decision" value="APPROVED">
          Approve
        </Button>
      )}
      {status !== "REJECTED" && (
        <Button size="sm" variant="ghost" className="h-7 text-xs" name="decision" value="REJECTED">
          Reject
        </Button>
      )}
      <Problems state={state} />
    </form>
  );
}

export function BaselineForm({ projectId, estimates, frozen, isAdmin }: { projectId: string; estimates: { id: string; label: string }[]; frozen: boolean; isAdmin: boolean }) {
  const [state, action, pending] = useFormAction(freezeBaselineAction, null);
  if (frozen && !isAdmin) return null;
  if (!estimates.length) return <p className="text-sm text-muted-foreground">No estimates on this job yet.</p>;
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <Select name="estimateId" className="w-72" defaultValue={estimates[0].id}>
          {estimates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
        {frozen && <Input name="reason" className="w-72" placeholder="Why replace the frozen baseline?" required />}
        <Button size="sm" variant={frozen ? "outline" : "default"} disabled={pending}>
          {frozen ? "Replace baseline (Admin)" : "Freeze as cost baseline"}
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}

export function NoneExpectedToggle({ projectId, category, on }: { projectId: string; category: string; on: boolean }) {
  const [state, action, pending] = useFormAction(noneExpectedAction, null);
  return (
    <form onSubmit={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="none" value={on ? "0" : "1"} />
      <button className="text-xs text-muted-foreground underline" disabled={pending}>
        {on ? "undo none-expected" : "none expected"}
      </button>
      <Problems state={state} />
    </form>
  );
}

export function CloseCosting({ projectId, closed, isAdmin, blockers }: { projectId: string; closed: boolean; isAdmin: boolean; blockers: string[] }) {
  const [state, action, pending] = useFormAction(closeCostingAction, null);
  const [rState, rAction, rPending] = useFormAction(reopenCostingAction, null);
  if (closed)
    return isAdmin ? (
      <form onSubmit={rAction} className="flex flex-col gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <div className="flex gap-2">
          <Input name="reason" className="w-80" placeholder="Why reopen? (logged)" required />
          <Button size="sm" variant="outline" disabled={rPending}>
            Reopen costing
          </Button>
        </div>
        <Problems state={rState} />
      </form>
    ) : null;
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      {blockers.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <Button size="sm" className="self-start" disabled={pending || blockers.length > 0}>
        Close job costing &amp; lock final P&amp;L
      </Button>
      <Problems state={state} />
    </form>
  );
}

export function InvoiceImport({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(invoiceImportAction, null);
  const pv = state?.preview;
  const newRows = pv?.rows.filter((r) => r.status === "NEW") ?? [];
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="step" value="preview" />
        <Input name="file" type="file" accept=".csv,text/csv" className="w-72" required />
        <Button size="sm" variant="outline" disabled={pending}>
          Preview import
        </Button>
        {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">{state.note}</span>}
      </form>
      <Problems state={state && !pv ? state : null} />
      {pv && (
        <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="step" value="confirm" />
          <input type="hidden" name="csv" value={pv.csv} />
          <input type="hidden" name="fileName" value={pv.fileName} />
          <p className="text-sm">
            <strong>{pv.fileName}</strong>: {pv.rows.length} line(s), {newRows.length} new, total of new lines{" "}
            {usd(newRows.reduce((a, r) => a + r.amount + (r.tax ?? 0), 0))} (incl. tax column).
          </p>
          {pv.pos.length > 1 && (
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="font-medium">Only lines for PO / job:</span>
              {pv.pos.map((po) => (
                <label key={po} className="flex items-center gap-1">
                  <input type="checkbox" name="po" value={po} /> {po}
                </label>
              ))}
              <span className="text-xs text-muted-foreground">(none checked = all lines)</span>
            </div>
          )}
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="p-1">Invoice</th>
                  <th className="p-1">PO</th>
                  <th className="p-1">Item</th>
                  <th className="p-1">Description</th>
                  <th className="p-1 text-right">Qty</th>
                  <th className="p-1 text-right">Amount</th>
                  <th className="p-1">Check</th>
                </tr>
              </thead>
              <tbody>
                {pv.rows.map((r) => (
                  <tr key={r.line} className={`border-t ${r.status !== "NEW" ? "text-muted-foreground line-through" : ""}`}>
                    <td className="p-1">{r.invoice}</td>
                    <td className="p-1">{r.po}</td>
                    <td className="p-1 font-mono">{r.itemNumber}</td>
                    <td className="p-1">{r.description}</td>
                    <td className="p-1 text-right">
                      {r.quantity} {r.uom}
                    </td>
                    <td className="p-1 text-right tabular-nums">{usd(r.amount)}</td>
                    <td className="p-1">
                      {r.note && <span>{r.note}</span>}
                      {r.priceFlag && <span className="text-red-700 dark:text-red-400">{r.priceFlag}</span>}
                      {r.formula && <span className="text-muted-foreground"> {r.formula}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pv.parseProblems.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">
              {pv.parseProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input name="vendor" defaultValue="ABC Supply" className="w-56" required />
            <Button size="sm" disabled={pending || !newRows.length}>
              Import {newRows.length} line(s) as material cost
            </Button>
          </div>
          <Problems state={state} />
        </form>
      )}
    </div>
  );
}

export function BidResultForm({ projectId, initial }: { projectId: string; initial: { ourBid: number | null; won: boolean | null; tabs: { bidder: string; amount: number }[]; notes: string | null } | null }) {
  const [state, action, pending] = useFormAction(bidResultAction, null);
  const [rows, setRows] = useState(Math.max(3, (initial?.tabs.length ?? 0) + 1));
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <Input name="ourBid" inputMode="decimal" className="w-40" placeholder="Our bid" defaultValue={initial?.ourBid ?? ""} />
        <Select name="won" defaultValue={initial?.won == null ? "" : initial.won ? "yes" : "no"} className="w-40">
          <option value="">Result pending</option>
          <option value="yes">We won</option>
          <option value="no">We lost</option>
        </Select>
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-2">
          <Input name="bidder" className="w-64" placeholder="Bidder" defaultValue={initial?.tabs[i]?.bidder ?? ""} />
          <Input name="bidAmount" inputMode="decimal" className="w-40" placeholder="Amount" defaultValue={initial?.tabs[i]?.amount ?? ""} />
        </div>
      ))}
      <button type="button" className="self-start text-xs underline" onClick={() => setRows(rows + 1)}>
        + bidder
      </button>
      <Input name="notes" placeholder="Notes (scope differences, alternates…)" defaultValue={initial?.notes ?? ""} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending}>
          Save bid tab
        </Button>
        <Saved state={state} />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function CommissionPlanForm({ userId, plan }: { userId: string; plan: { basis: string; pct: number; note: string | null } | null }) {
  const [state, action, pending] = useFormAction(commissionPlanAction, null);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Input name="pct" inputMode="decimal" className="w-24" placeholder="%" defaultValue={plan?.pct ?? ""} />
      <Select name="basis" defaultValue={plan?.basis ?? "GROSS_PROFIT"} className="w-44">
        <option value="GROSS_PROFIT">of gross profit</option>
        <option value="REVENUE">of revenue</option>
      </Select>
      <Input name="note" className="w-56" placeholder="Note (draw, split…)" defaultValue={plan?.note ?? ""} />
      <Button size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <Saved state={state} />
      <Problems state={state} className="w-full" />
    </form>
  );
}

