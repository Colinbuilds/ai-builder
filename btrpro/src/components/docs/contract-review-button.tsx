"use client";

import { useFormAction } from "@/components/use-form-action";
import { contractReviewAction } from "@/app/projects/docs-actions";
import { Button } from "@/components/ui/button";
import { useBrand } from "@/components/brand";

export function ContractReviewButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const { assistantName: bot } = useBrand();
  const [state, action, pending] = useFormAction(contractReviewAction, null);
  return (
    <form onSubmit={action} className="mb-1 flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Button size="sm" variant="outline" disabled={pending || disabled}>
        {pending ? "Reading the contract… (up to a minute)" : `Review contract (${bot})`}
      </Button>
      {state?.problems.map((p) => (
        <span key={p} className="text-xs text-destructive">
          {p}
        </span>
      ))}
    </form>
  );
}
