"use client";

import { useFormAction } from "@/components/use-form-action";
import { setWasteAction } from "@/app/projects/estimate-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WasteGate({
  estimateId,
  section,
  entry,
  reference,
  locked,
}: {
  estimateId: string;
  section: string;
  entry: {
    pct: number | null;
    approved: boolean;
    basis: string;
    approvedBy?: string | null;
  };
  reference: string;
  locked: boolean;
}) {
  const [state, action, pending] = useFormAction(setWasteAction, null);
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-1 rounded-md border p-3 text-sm"
    >
      <input type="hidden" name="estimateId" value={estimateId} />
      <input type="hidden" name="section" value={section} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 font-medium capitalize">
          {section.toLowerCase()}
        </span>
        <Input
          name="pct"
          defaultValue={entry.pct ?? ""}
          inputMode="decimal"
          className="h-8 w-20"
          disabled={locked}
        />
        <span>%</span>
        {entry.pct == null ? (
          <Badge variant="red">MISSING</Badge>
        ) : entry.approved ? (
          <Badge variant="green">Approved</Badge>
        ) : (
          <Badge variant="amber">Not approved</Badge>
        )}
        {!locked && (
          <>
            <Button size="sm" name="approve" value="1" disabled={pending}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              name="approve"
              value="0"
              disabled={pending}
            >
              Save without approving
            </Button>
          </>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {entry.basis}. Reference (for approval only): {reference}
      </span>
      {state?.problems.map((p) => (
        <span key={p} className="text-xs text-destructive">
          {p}
        </span>
      ))}
    </form>
  );
}
