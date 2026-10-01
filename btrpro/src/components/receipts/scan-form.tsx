"use client";

import { startTransition, useActionState, useState } from "react";
import { fileReceiptAction, scanReceiptAction } from "@/app/receipts/actions";
import { shrinkPhoto } from "@/components/shrink-photo";
import { Problems } from "@/components/projects/problems";
import { Button } from "@/components/ui/button";

export function ScanReceiptForm() {
  const [state, dispatch, pending] = useActionState(scanReceiptAction, null);
  const [picked, setPicked] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-btr-line p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
        f.delete("photos");
        setBusy(true);
        for (const file of files) f.append("photos", file.type === "application/pdf" ? file : await shrinkPhoto(file), file.name);
        setBusy(false);
        startTransition(() => dispatch(f));
      }}
    >
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-btr-line px-4 py-8 text-center">
        <input name="photos" type="file" accept="image/*,application/pdf" capture="environment" multiple className="sr-only" onChange={(e) => setPicked(e.currentTarget.files?.length ?? 0)} />
        <span className="text-base font-medium text-btr-link">{picked ? `${picked} photo${picked === 1 ? "" : "s"} ready` : "Take a photo of the receipt"}</span>
        <span className="text-xs text-muted-foreground">Flat, in good light, the whole receipt in frame. Several photos if it&apos;s long. A PDF works too.</span>
      </label>
      <Button disabled={!picked || pending || busy}>{busy ? "Preparing…" : pending ? "Reading the receipt…" : "Read receipt"}</Button>
      <Problems state={state} />
    </form>
  );
}

export function FileReceiptForm({ id, projectId, disabled }: { id: string; projectId: string | null; disabled: string | null }) {
  const [state, dispatch, pending] = useActionState(fileReceiptAction, null);
  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId ?? ""} />
      {disabled ? <p className="text-sm text-muted-foreground">{disabled}</p> : null}
      <Button disabled={!!disabled || pending || !projectId || !!state?.ok}>{pending ? "Filing…" : "File to job costs"}</Button>
      {state?.ok && <p className="text-sm text-btr-blue">{state.note}</p>}
      <Problems state={state} />
    </form>
  );
}
