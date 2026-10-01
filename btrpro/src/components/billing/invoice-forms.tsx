"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  createInvoiceAction,
  deletePaymentAction,
  recordPaymentAction,
  sendInvoiceAction,
  suggestAction,
  voidInvoiceAction,
} from "@/app/projects/billing-actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

const KINDS: [string, string][] = [
  ["DEPOSIT", "Deposit"],
  ["PROGRESS", "Progress"],
  ["FINAL", "Final"],
  ["CHANGE_ORDER", "Change order"],
  ["RETAINAGE_RELEASE", "Retainage release"],
  ["OTHER", "Other"],
];
const METHODS: [string, string][] = [
  ["CHECK", "Check"],
  ["ACH", "ACH / bank transfer"],
  ["CARD", "Card"],
  ["CASH", "Cash"],
  ["INSURANCE_CHECK", "Insurance check"],
  ["OTHER", "Other"],
];
const today = () => new Date().toISOString().slice(0, 10);

export function NewInvoice({
  projectId,
  commercial,
  retainagePct,
}: {
  projectId: string;
  commercial: boolean;
  retainagePct: number | null;
}) {
  const [state, action, pending] = useFormAction(createInvoiceAction, null, {
    resetOnOk: true,
  });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("PROGRESS");
  const [lines, setLines] = useState([{ d: "", a: "" }]);
  const [hint, setHint] = useState<string | null>(null);
  if (!open)
    return (
      <Button size="sm" className="self-start" onClick={() => setOpen(true)}>
        New invoice
      </Button>
    );
  const suggestAmt = async () => {
    const s = await suggestAction(projectId, kind);
    setHint(
      s.why
        ? `${s.amount != null ? `$${s.amount.toFixed(2)}` : "No suggestion"} — ${s.why}`
        : "No suggestion for this kind.",
    );
    if (s.amount != null)
      setLines([
        {
          d: lines[0]?.d || `${KINDS.find((k) => k[0] === kind)?.[1]} billing`,
          a: s.amount.toFixed(2),
        },
        ...lines.slice(1),
      ]);
  };
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <h3 className="font-semibold">New invoice</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label>Kind</Label>
          <Select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-8"
          >
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        {(kind === "DEPOSIT" ||
          kind === "FINAL" ||
          kind === "RETAINAGE_RELEASE") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={suggestAmt}
          >
            Suggest amount
          </Button>
        )}
        <div className="flex flex-col gap-1">
          <Label>Due date</Label>
          <Input type="date" name="dueDate" className="h-8" />
        </div>
        {(kind === "PROGRESS" ||
          kind === "FINAL" ||
          kind === "CHANGE_ORDER") && (
          <div className="flex flex-col gap-1">
            <Label>Retainage %</Label>
            <Input
              name="retainagePct"
              defaultValue={
                commercial && retainagePct != null ? String(retainagePct) : ""
              }
              placeholder={commercial ? "job default" : "none"}
              className="h-8 w-24"
              inputMode="decimal"
            />
          </div>
        )}
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground">Suggested: {hint}</p>
      )}
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Input
              name="lineDesc"
              value={l.d}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === i ? { ...x, d: e.target.value } : x,
                  ),
                )
              }
              placeholder="Description, e.g. Roofing — 50% progress"
              className="h-8"
            />
            <Input
              name="lineAmount"
              value={l.a}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === i ? { ...x, a: e.target.value } : x,
                  ),
                )
              }
              placeholder="Amount"
              inputMode="decimal"
              className="h-8 w-36"
            />
          </div>
        ))}
        <button
          type="button"
          className="self-start text-xs underline"
          onClick={() => setLines([...lines, { d: "", a: "" }])}
        >
          + line
        </button>
      </div>
      <Input
        name="notes"
        placeholder="Notes printed on the invoice (optional)"
        className="h-8"
      />
      {state?.needsOverride && (
        <Input
          name="override"
          placeholder="Why this bills past the contract (required to continue)"
          className="h-8"
          required
        />
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        {state?.ok && (
          <span className="text-sm text-green-700 dark:text-green-400">
            {state.note}
          </span>
        )}
      </div>
      <Problems state={state} />
    </form>
  );
}

export function SendInvoice({
  id,
  name,
  email,
}: {
  id: string;
  name: string | null;
  email: string | null;
}) {
  const [state, action, pending] = useFormAction(sendInvoiceAction, null);
  if (state?.ok)
    return (
      <p className="text-xs text-green-700 dark:text-green-400">
        {state.note}{" "}
        <a className="underline" href={state.url} target="_blank">
          Customer link
        </a>
      </p>
    );
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="name"
        defaultValue={name ?? ""}
        placeholder="Bill to"
        className="h-8 w-40"
      />
      <Input
        name="email"
        type="email"
        defaultValue={email ?? ""}
        placeholder="Email"
        className="h-8 w-52"
      />
      <Button size="sm" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function VoidInvoice({ id, draft }: { id: string; draft: boolean }) {
  const [state, action, pending] = useFormAction(voidInvoiceAction, null);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setOpen(true)}
      >
        {draft ? "Discard" : "Void"}
      </button>
    );
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="reason"
        placeholder={draft ? "Reason (optional)" : "Why is it void?"}
        required={!draft}
        className="h-8 w-56"
      />
      <Button size="sm" variant="outline" disabled={pending}>
        {draft ? "Discard draft" : "Void invoice"}
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function RecordPayment({
  invoiceId,
  balance,
  surchargePct,
}: {
  invoiceId: string;
  balance: number;
  surchargePct: number | null;
}) {
  const [state, action, pending] = useFormAction(recordPaymentAction, null, {
    resetOnOk: true,
  });
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("CHECK");
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-2 rounded-md border p-3"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label>Received</Label>
          <Input
            type="date"
            name="date"
            defaultValue={today()}
            className="h-8"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Amount</Label>
          <Input
            name="amount"
            defaultValue={balance.toFixed(2)}
            inputMode="decimal"
            className="h-8 w-32"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>How</Label>
          <Select
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-8"
          >
            {METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>
            {method === "CHECK" || method === "INSURANCE_CHECK"
              ? "Check #"
              : "Reference"}
          </Label>
          <Input
            name="reference"
            className="h-8 w-32"
            required={method === "CHECK" || method === "INSURANCE_CHECK"}
          />
        </div>
        {method === "CARD" && surchargePct ? (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="surcharge" /> add {surchargePct}% card
            surcharge
          </label>
        ) : null}
        <Button size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save payment"}
        </Button>
      </div>
      {state?.ok && (
        <p className="text-xs text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
    </form>
  );
}

export function DeletePayment({ id }: { id: string }) {
  const [state, action, pending] = useFormAction(deletePaymentAction, null);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => setOpen(true)}
      >
        remove
      </button>
    );
  return (
    <form
      onSubmit={action}
      className="inline-flex flex-wrap items-center gap-1"
    >
      <input type="hidden" name="id" value={id} />
      <Input name="reason" placeholder="Why?" required className="h-7 w-40" />
      <Button size="sm" variant="outline" disabled={pending}>
        Remove
      </Button>
      <Problems state={state} />
    </form>
  );
}
