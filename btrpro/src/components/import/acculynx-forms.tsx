"use client";

import { useFormAction } from "@/components/use-form-action";
import {
  importAccuLynxAction,
  loadAccuLynxAction,
} from "@/app/settings/acculynx/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function LoadAccuLynx() {
  const [state, action, pending] = useFormAction(loadAccuLynxAction, null);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="file" name="file" accept=".csv,.xlsx" className="text-sm" />
      <Button size="sm" disabled={pending}>
        {pending ? "Reading…" : "Preview"}
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

const STAGES = [
  "LEAD",
  "ESTIMATING",
  "SUBMITTED",
  "SOLD",
  "SCHEDULED",
  "IN_PRODUCTION",
  "COMPLETE",
  "INVOICED",
  "PAID",
  "CLOSED",
  "LOST",
];

export function MapAccuLynx({
  fileUrl,
  fileName,
  header,
  fields,
  map,
  milestones,
}: {
  fileUrl: string;
  fileName: string;
  header: string[];
  fields: { key: string; label: string }[];
  map: Record<string, number>;
  milestones: { value: string; count: number; stage: string | null }[];
}) {
  const [state, action, pending] = useFormAction(importAccuLynxAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-4">
      <input type="hidden" name="fileUrl" value={fileUrl} />
      <input type="hidden" name="fileName" value={fileName} />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Columns</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs">
              {f.label}
              <Select
                name={`col:${f.key}`}
                defaultValue={map[f.key] != null ? String(map[f.key]) : ""}
                className="h-8"
              >
                <option value="">— not in the export —</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `(column ${i + 1})`}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Milestones → stages</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {milestones.map((m) => (
            <label
              key={m.value}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {m.value || "(blank)"}{" "}
                <span className="text-muted-foreground">· {m.count}</span>
              </span>
              <Select
                name={`stage:${m.value}`}
                defaultValue={m.stage ?? "LEAD"}
                className="h-8"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ").toLowerCase()}
                  </option>
                ))}
                <option value="SKIP">don&apos;t import</option>
              </Select>
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        Jobs are
        <Select name="market" defaultValue="RESIDENTIAL" className="h-8">
          <option value="RESIDENTIAL">Residential</option>
          <option value="COMMERCIAL">Commercial</option>
        </Select>
        <span className="text-xs text-muted-foreground">
          (export residential and commercial separately if they&apos;re mixed)
        </span>
      </label>
      <Button className="self-start" disabled={pending}>
        {pending ? "Importing… (large exports take a minute)" : "Import jobs"}
      </Button>
      {state?.ok && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      {state?.errors?.map((e) => (
        <p key={e} className="text-xs text-destructive">
          {e}
        </p>
      ))}
      <Problems state={state} />
    </form>
  );
}

