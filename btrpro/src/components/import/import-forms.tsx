"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  loadScheduleAction,
  runImportAction,
} from "@/app/settings/import-jobs/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function LoadSchedule({
  driveReady,
  presets,
}: {
  driveReady: boolean;
  presets: { label: string; link: string }[];
}) {
  const [state, action, pending] = useFormAction(loadScheduleAction, null);
  const [link, setLink] = useState("");
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 className="font-semibold">1. Pick the schedule</h2>
      {driveReady ? (
        <>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.link}
                type="button"
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                onClick={() => setLink(p.link)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Input
            name="link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Google Sheets link"
          />
          <p className="text-xs text-muted-foreground">
            Or upload a copy instead:
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Google Drive isn&apos;t connected (Admin → Integrations). Download the
          sheet as Excel (File → Download → .xlsx) and upload it:
        </p>
      )}
      <input type="file" name="file" accept=".xlsx,.csv" className="text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="market" defaultValue="AUTO" className="h-8 max-w-xs">
          <option value="AUTO">
            Residential or commercial: from the file name
          </option>
          <option value="RESIDENTIAL">
            Residential schedule (one row per house)
          </option>
          <option value="COMMERCIAL">
            Commercial schedule (GC - Project, rows per building)
          </option>
        </Select>
        <Button size="sm" disabled={pending}>
          {pending ? "Reading…" : "Preview"}
        </Button>
      </div>
      <Problems state={state} />
    </form>
  );
}

type Row = {
  text: string;
  jobs: number;
  matchId: string | null;
  matchName: string | null;
  ambiguous: string[];
  suggestedType: string;
};
const TYPES: [string, string][] = [
  ["BUILDER", "Builder"],
  ["GC", "General contractor"],
  ["OWNER", "Customer / owner"],
  ["PROPERTY_MANAGER", "Property manager"],
];

export function MapAndImport({
  fileUrl,
  fileName,
  market,
  rows,
  choices,
}: {
  fileUrl: string;
  fileName: string;
  market: string;
  rows: Row[];
  choices: { id: string; name: string; type: string }[];
}) {
  const [state, action, pending] = useFormAction(runImportAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-3">
      <input type="hidden" name="fileUrl" value={fileUrl} />
      <input type="hidden" name="fileName" value={fileName} />
      <input type="hidden" name="market" value={market} />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2">On the schedule</th>
              <th className="p-2 text-right">Jobs</th>
              <th className="p-2">Goes into account</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.text} className="border-t">
                <td className="p-2">
                  {r.text}
                  {r.ambiguous.length > 1 && (
                    <span className="block text-xs text-amber-700 dark:text-amber-400">
                      Could be {r.ambiguous.join(" or ")} — check.
                    </span>
                  )}
                </td>
                <td className="p-2 text-right tabular-nums">{r.jobs}</td>
                <td className="p-2">
                  <Select
                    name={`map:${r.text}`}
                    defaultValue={r.matchId ?? `NEW:${r.suggestedType}`}
                    className="h-8 w-full max-w-sm"
                  >
                    <optgroup label="New account">
                      {TYPES.map(([v, l]) => (
                        <option key={v} value={`NEW:${v}`}>
                          Create “{r.text.slice(0, 40)}” as {l}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Existing account">
                      {choices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                    <option value="NONE">Import with no account</option>
                    <option value="SKIP">Don&apos;t import these</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button className="self-start" disabled={pending}>
        {pending ? "Importing… (large schedules take a minute)" : "Import jobs"}
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
