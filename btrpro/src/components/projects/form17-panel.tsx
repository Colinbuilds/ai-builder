"use client";

import { useFormAction } from "@/components/use-form-action";
import { executeForm17Action } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "./problems";

// Persistent banner for public + tax-exempt jobs until Form 17 is executed (PUB-01, acceptance test 11).
export function Form17Banner({
  id,
  canEdit,
}: {
  id: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useFormAction(executeForm17Action, null);
  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <p className="font-semibold">Form 17 required: public, tax-exempt job</p>
      <p className="mt-1">
        Nebraska Form 17 Purchasing Agent Appointment must be executed with the
        owner before any materials are purchased. Confirm it before setting this
        job to tax-exempt. The job can&apos;t be scheduled until
        it&apos;s recorded here.
      </p>
      {canEdit && (
        <form
          onSubmit={action}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="id" value={id} />
          <Input
            type="date"
            name="executedAt"
            required
            className="w-40 bg-background"
          />
          <Input
            name="note"
            placeholder="Signed by / where the copy is filed"
            className="w-72 bg-background"
          />
          <Button size="sm" disabled={pending}>
            Record Form 17 as executed
          </Button>
          <Problems state={state} className="w-full" />
        </form>
      )}
    </div>
  );
}
