"use client";

import { useFormAction } from "@/components/use-form-action";
import { pasteEmailAction, pullMailboxAction } from "@/app/projects/comms-actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function PasteEmail({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(pasteEmailAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="from" placeholder="From (name <email>)" required />
        <Input name="to" placeholder="To" />
        <Input name="subject" placeholder="Subject" required />
        <Input name="sentAt" type="datetime-local" />
      </div>
      <textarea name="body" rows={6} required placeholder="Paste the email text" className="rounded-md border border-input bg-background p-2 text-sm" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add to job"}
        </Button>
        {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Added.</span>}
      </div>
      <Problems state={state} />
    </form>
  );
}

export function PullMailbox({ projectId, query, providers }: { projectId: string; query: string; providers: { value: string; label: string }[] }) {
  const [state, action, pending] = useFormAction(pullMailboxAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="provider">
          {providers.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        <Input name="query" defaultValue={query} className="min-w-72 flex-1" />
        <Button size="sm" disabled={pending}>
          {pending ? "Searching…" : "Pull matching email"}
        </Button>
      </div>
      {state?.note && <p className="text-sm text-muted-foreground">{state.note}</p>}
      <Problems state={state} />
    </form>
  );
}
