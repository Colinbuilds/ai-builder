"use client";

import { startTransition, useActionState, useState } from "react";
import { approveBillAction, disputeBillAction, paidBillAction, scanBillAction, voidBillAction } from "@/app/bills/actions";
import { shrinkPhoto } from "@/components/shrink-photo";
import { Problems } from "@/components/projects/problems";
import { Button } from "@/components/ui/button";

const input = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const Note = ({ state }: { state: { ok?: boolean; note?: string } | null }) => (state?.ok && state.note ? <p className="text-sm text-green-700 dark:text-green-400">{state.note}</p> : null);

export function ScanBillForm() {
  const [state, dispatch, pending] = useActionState(scanBillAction, null);
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-btr-line p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
        f.delete("files");
        setBusy(true);
        for (const file of files) f.append("files", file.type === "application/pdf" ? file : await shrinkPhoto(file), file.name);
        setBusy(false);
        startTransition(() => dispatch(f));
      }}
    >
      <label className="cursor-pointer text-sm">
        <input name="files" type="file" accept="application/pdf,image/*" multiple className="sr-only" onChange={(e) => setPicked(e.currentTarget.files?.length ?? 0)} />
        <span className="font-medium text-btr-link">{picked ? `${picked} file${picked === 1 ? "" : "s"} ready` : "Add a supplier invoice (PDF or photos)…"}</span>
      </label>
      {picked > 0 && (
        <Button disabled={pending || busy} className="self-start">
          {busy ? "Preparing…" : pending ? "Reading and matching…" : "Read invoice"}
        </Button>
      )}
      <Problems state={state} />
    </form>
  );
}

export function ApproveBill({ id, flagged }: { id: string; flagged: boolean }) {
  const [state, dispatch, pending] = useActionState(approveBillAction, null);
  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      {flagged && <textarea name="note" rows={2} required placeholder="Why it's OK to pay anyway (logged for the owner audit)" className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />}
      <Button disabled={pending} className="self-start">
        {pending ? "Approving…" : flagged ? "Approve anyway" : "Approve — job costs + QuickBooks bill"}
      </Button>
      <Problems state={state} />
      <Note state={state} />
    </form>
  );
}

export function DisputeBill({ id, defaultTo }: { id: string; defaultTo: string | null }) {
  const [state, dispatch, pending] = useActionState(disputeBillAction, null);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="self-start">
        Dispute with supplier…
      </Button>
    );
  return (
    <form action={dispatch} className="flex flex-col gap-2 rounded-md border p-3">
      <input type="hidden" name="id" value={id} />
      <textarea name="note" rows={2} required placeholder="What's wrong, e.g. billed 20 drip edge, 18 delivered" className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />
      <input name="to" type="email" defaultValue={defaultTo ?? ""} placeholder="Rep's email (optional — sends it if email is set up)" className={input} />
      <Button disabled={pending} variant="outline" className="self-start">
        {pending ? "Holding…" : "Hold bill"}
      </Button>
      <Problems state={state} />
      <Note state={state} />
      {state?.text && <textarea readOnly value={state.text} rows={8} className="w-full rounded-md border bg-muted/40 p-2 font-mono text-xs" />}
    </form>
  );
}

export function VoidBill({ id }: { id: string }) {
  const [state, dispatch, pending] = useActionState(voidBillAction, null);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-muted-foreground hover:underline">
        Void (duplicate / replaced)…
      </button>
    );
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required placeholder="Why" className={input} />
      <Button size="sm" variant="outline" disabled={pending}>
        Void
      </Button>
      <Problems state={state} />
    </form>
  );
}

export function PaidBill({ id }: { id: string }) {
  const [state, dispatch, pending] = useActionState(paidBillAction, null);
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="ref" placeholder="Check # / ACH ref (optional)" className={input} />
      <Button size="sm" variant="outline" disabled={pending}>
        Mark paid
      </Button>
      <Problems state={state} />
      <Note state={state} />
    </form>
  );
}
