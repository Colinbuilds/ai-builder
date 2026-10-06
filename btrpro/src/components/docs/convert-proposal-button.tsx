"use client";

import { useFormAction } from "@/components/use-form-action";
import { convertProposalAction } from "@/app/projects/docs-actions";
import { Button } from "@/components/ui/button";
import { useBrand } from "@/components/brand";

/** Old Drive proposal → a copy in BTR's current proposal layout. */
export function ConvertProposalButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const { productName: app } = useBrand();
  const [state, action, pending] = useFormAction(convertProposalAction, null);
  return (
    <form onSubmit={action} className="mb-1 flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Button size="sm" variant="outline" disabled={pending || disabled}>
        {pending ? "Reprinting…" : `Reprint in ${app} format`}
      </Button>
      {state?.note && <span className="text-xs text-muted-foreground">{state.note}</span>}
      {state?.problems.map((p) => (
        <span key={p} className="text-xs text-destructive">
          {p}
        </span>
      ))}
    </form>
  );
}
