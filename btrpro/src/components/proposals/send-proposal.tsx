"use client";

import { useFormAction } from "@/components/use-form-action";
import { sendProposalAction } from "@/app/proposal-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function SendProposal({
  id,
  name,
  email,
  canEmail,
}: {
  id: string;
  name: string | null;
  email: string | null;
  canEmail: boolean;
}) {
  const [state, action, pending] = useFormAction(sendProposalAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <Input
          name="name"
          defaultValue={name ?? ""}
          placeholder="Customer name"
          className="h-8 w-48"
        />
        <Input
          name="email"
          type="email"
          defaultValue={email ?? ""}
          placeholder="Customer email"
          className="h-8 w-64"
        />
        <Button size="sm" disabled={pending}>
          {canEmail ? "Email proposal" : "Mark as sent"}
        </Button>
      </div>
      {!canEmail && (
        <span className="text-xs text-muted-foreground">
          Outbound email isn&apos;t set up (POSTMARK_SERVER_TOKEN, EMAIL_FROM) —
          copy the link and send it yourself.
        </span>
      )}
      {state?.note && (
        <span className="text-sm text-green-700 dark:text-green-400">
          {state.note}
        </span>
      )}
      <Problems state={state} />
    </form>
  );
}
