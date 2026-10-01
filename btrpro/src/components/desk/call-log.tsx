"use client";

import { useActionState, useState } from "react";
import { logCallAction } from "@/app/desk/actions";
import { Problems } from "@/components/projects/problems";

const field = "h-8 rounded-md border border-input bg-background px-2 text-sm";

export function CallLog({ invoiceId }: { invoiceId: string }) {
  const [state, dispatch, pending] = useActionState(logCallAction, null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("LEFT_VM");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-btr-link hover:underline">
        Log call
      </button>
    );
  return (
    <form action={dispatch} className="mt-1 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field} aria-label="What happened">
        <option value="LEFT_VM">Left voicemail</option>
        <option value="CALLED">Talked to them</option>
        <option value="PROMISED">Promised to pay</option>
        <option value="EMAILED">Emailed</option>
        <option value="DISPUTE">They dispute it</option>
      </select>
      <input name="note" placeholder={outcome === "LEFT_VM" ? "Note (optional)" : "What they said"} className={`${field} min-w-40 flex-1`} />
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        {outcome === "PROMISED" ? "Pay by" : "Follow up"}
        <input name="followUpOn" type="date" className={field} />
      </label>
      <button disabled={pending} className="h-8 rounded-md bg-btr-black px-3 text-sm text-white disabled:opacity-50">
        Save
      </button>
      <Problems state={state} />
      {state?.ok && <span className="text-xs text-green-700">Saved</span>}
    </form>
  );
}
