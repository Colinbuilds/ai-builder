"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  deleteProjectAction,
  deleteProjectsAction,
} from "@/app/projects/delete-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function DeleteJob({
  id,
  name,
  blocker,
}: {
  id: string;
  name: string;
  blocker: string | null;
}) {
  const [state, action, pending] = useFormAction(deleteProjectAction, null);
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-2 rounded-md border border-red-200 p-4 text-sm dark:border-red-900">
      <h2 className="font-semibold">Delete this job</h2>
      {blocker ? (
        <p className="text-muted-foreground">{blocker}</p>
      ) : !open ? (
        <button
          type="button"
          className="self-start text-sm text-destructive underline"
          onClick={() => setOpen(true)}
        >
          Delete job…
        </button>
      ) : (
        <form onSubmit={action} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={id} />
          <p>
            This permanently deletes the job and everything on it: estimates,
            documents, chat, email, costs, orders, schedule, invoices and tasks.
            It can&apos;t be undone. Type <strong>{name}</strong> to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input name="confirm" autoComplete="off" className="h-8 max-w-md" />
            <Button size="sm" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
          <Problems state={state} />
        </form>
      )}
    </section>
  );
}

/** Bulk bar for the jobs list; the row checkboxes use form="bulk-delete". */
export function BulkDelete() {
  const [state, action, pending] = useFormAction(deleteProjectsAction, null, {
    resetOnOk: true,
  });
  return (
    <form
      id="bulk-delete"
      onSubmit={action}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="text-muted-foreground">Delete ticked jobs:</span>
      <Input
        name="confirm"
        placeholder="type DELETE"
        autoComplete="off"
        className="h-8 w-32"
      />
      <Button size="sm" variant="destructive" disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {state?.ok && (
        <span className="text-green-700 dark:text-green-400">{state.note}</span>
      )}
      <Problems state={state} className="w-full" />
    </form>
  );
}
