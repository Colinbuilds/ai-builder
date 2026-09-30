"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { createProposalAction } from "@/app/proposal-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function CreateProposal({ estimateId, defaultMarkup, notReady }: { estimateId: string; defaultMarkup: number | null; notReady: boolean }) {
  const [state, action, pending] = useFormAction(createProposalAction, null);
  const [alts, setAlts] = useState(0);
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-4 text-sm">
      <input type="hidden" name="estimateId" value={estimateId} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Markup</span>
        <Input name="markupPct" defaultValue={defaultMarkup ?? ""} className="h-8 w-20" placeholder="%" />
        <span>%</span>
        <span className="ml-4 font-medium">Final price override</span>
        <Input name="priceOverride" className="h-8 w-32" placeholder="optional $" />
        <Input name="priceNote" className="h-8 min-w-64 flex-1" placeholder="Why the price differs (required with an override)" />
      </div>
      {Array.from({ length: alts }).map((_, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <Input name="altName" className="h-8 w-48" placeholder="Option name (e.g. Upgrade to Class 4 shingle)" />
          <Input name="altDesc" className="h-8 min-w-64 flex-1" placeholder="Description" />
          <Input name="altPrice" className="h-8 w-28" placeholder="+ $ price" />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="text-xs underline" onClick={() => setAlts(alts + 1)}>
          + optional add-on the customer can pick
        </button>
        {notReady && (
          <label className="flex items-center gap-1 text-xs text-destructive">
            <input type="checkbox" name="acknowledgeNotReady" /> Job is NOT READY FOR HARD BID — send anyway
          </label>
        )}
        <Button size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create proposal"}
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}
