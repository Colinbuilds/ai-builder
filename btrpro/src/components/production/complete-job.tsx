"use client";

import { useActionState, useState } from "react";
import { completeJobAction } from "@/app/projects/field-actions";
import { Problems } from "@/components/projects/problems";

export function CompleteJob({ projectId, ready }: { projectId: string; ready: boolean }) {
  const [state, dispatch, pending] = useActionState(completeJobAction, null);
  const [note, setNote] = useState(false);
  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      {(!ready || note) && <input name="note" required={!ready} placeholder={ready ? "Note (optional)" : "Why complete it with items still open?"} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Completing…" : "Mark job complete → final invoice"}
        </button>
        {ready && !note && (
          <button type="button" onClick={() => setNote(true)} className="text-xs text-muted-foreground hover:underline">
            add a note
          </button>
        )}
      </div>
      <Problems state={state} />
    </form>
  );
}
