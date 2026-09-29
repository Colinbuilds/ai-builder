"use client";

import { useFormAction } from "@/components/use-form-action";
import { updateIntakeAction } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { IntakeStatusBadge } from "./badges";

export type IntakeRowData = {
  key: string;
  label: string;
  source: string;
  value: string | null;
  unit: string | null;
  status: string;
  note: string | null;
  approvedBy: string | null;
  autoNa: boolean;
};

export function IntakeRow({ projectId, f, canEdit }: { projectId: string; f: IntakeRowData; canEdit: boolean }) {
  const [state, action, pending] = useFormAction(updateIntakeAction, null);
  const dim = f.status === "NOT_APPLICABLE";
  return (
    <tr id={`intake-${f.key}`} className={`border-b align-top target:bg-amber-50 dark:target:bg-amber-950 ${dim ? "text-muted-foreground" : ""}`}>
      <td className="px-3 py-2">
        <div className="font-medium">{f.label}</div>
        {f.status === "MISSING" && <div className="text-xs text-muted-foreground">Need: {f.source}</div>}
        {f.autoNa && <div className="text-xs">Not in this job&apos;s scopes</div>}
      </td>
      <td className="px-3 py-2">
        <IntakeStatusBadge status={f.status} />
        {f.status === "ASSUMED" && <div className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">NOT FOR FINAL BID</div>}
      </td>
      <td className="px-3 py-2" colSpan={canEdit ? 1 : 2}>
        {canEdit ? (
          <form onSubmit={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="key" value={f.key} />
            <Input name="value" defaultValue={f.value ?? ""} className="h-8 w-36" placeholder="Value" />
            <Input name="unit" defaultValue={f.unit ?? ""} className="h-8 w-16" placeholder="Unit" />
            <Select name="status" defaultValue={f.status} className="h-8">
              <option value="VERIFIED">Verified</option>
              <option value="MISSING">Missing</option>
              <option value="ASSUMED">Assumed</option>
              <option value="NOT_APPLICABLE">N/A</option>
            </Select>
            <Input name="note" defaultValue={f.note ?? ""} className="h-8 w-48" placeholder="Source (sheet, page) or basis" />
            <Button size="sm" variant="outline" disabled={pending}>
              Save
            </Button>
            {state?.problems.map((p) => (
              <span key={p} className="w-full text-xs text-destructive">
                {p}
              </span>
            ))}
          </form>
        ) : (
          <span>
            {f.value ?? "—"} {f.unit}
            {f.note && <span className="text-muted-foreground"> · {f.note}</span>}
          </span>
        )}
      </td>
      {canEdit && <td className="px-3 py-2 text-xs text-muted-foreground">{f.approvedBy}</td>}
    </tr>
  );
}
