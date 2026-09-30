"use client";

import { useFormAction } from "@/components/use-form-action";
import { addMeasurementAction } from "@/app/projects/docs-actions";
import { MEASUREMENTS } from "@/lib/docs/measurements";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function ManualMeasurement({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(addMeasurementAction, null, { resetOnOk: true });
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <Select name="key">
          {MEASUREMENTS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({m.unit})
            </option>
          ))}
        </Select>
        <Input name="value" inputMode="decimal" placeholder="Value" className="w-28" required />
        <Input name="facet" placeholder="Facet / elevation (optional)" className="w-48" />
        <Input name="source" placeholder="Source: sheet & page, or field measure by whom" className="min-w-64 flex-1" required />
        <Button size="sm" variant="outline" disabled={pending}>
          Add
        </Button>
      </div>
      {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Added.</span>}
      <Problems state={state} />
    </form>
  );
}
