"use client";

import { useFormAction } from "@/components/use-form-action";
import { extractAction } from "@/app/projects/docs-actions";
import { Button } from "@/components/ui/button";

export function ExtractButton({
  id,
  label,
  disabled,
}: {
  id: string;
  label: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useFormAction(extractAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Button size="sm" variant="outline" disabled={pending || disabled}>
        {pending ? "Reading document…" : label}
      </Button>
      {state?.note && (
        <span className="text-xs text-muted-foreground">{state.note}</span>
      )}
      {state?.problems.map((p) => (
        <span key={p} className="text-xs text-destructive">
          {p}
        </span>
      ))}
    </form>
  );
}
