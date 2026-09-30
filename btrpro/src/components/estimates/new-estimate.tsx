"use client";

import { useFormAction } from "@/components/use-form-action";
import { createEstimateAction } from "@/app/projects/estimate-actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";
import { TemplateSelect, type TemplateOpt } from "./templates";

export function NewEstimate({ projectId, defaultScope, templates = [] }: { projectId: string; defaultScope: string; templates?: TemplateOpt[] }) {
  const [state, action, pending] = useFormAction(createEstimateAction, null);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Select name="scopeType" defaultValue={defaultScope} className="h-8">
        <option value="STEEP">Steep-slope</option>
        <option value="LOW_SLOPE">Low-slope</option>
        <option value="DECK">Roof deck</option>
        <option value="SIDING">Siding</option>
        <option value="PANELS">Metal / wall panels</option>
        <option value="MIXED">Mixed scopes</option>
      </Select>
      {templates.length > 0 && <TemplateSelect templates={templates} blank="No template (pick products yourself)" />}
      <Button size="sm" disabled={pending}>
        {pending ? "Starting…" : "Start estimate"}
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}
