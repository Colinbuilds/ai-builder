"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SheetUpload } from "./sheet-upload";

/** Measure page: pick any open job, then upload a plan or photo for it right here. */
export function JobPicker({ jobs }: { jobs: { id: string; name: string }[] }) {
  const [id, setId] = useState("");
  const router = useRouter();
  return (
    <div className="flex max-w-3xl flex-col gap-2 rounded-lg border bg-background p-3">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Measure a new plan or photo for</span>
        <select value={id} onChange={(e) => setId(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-1">
          <option value="">Pick the job…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        {id && (
          <button type="button" onClick={() => router.push(`/projects/${id}/takeoff`)} className="text-xs text-btr-link hover:underline">
            open the job&apos;s sheets
          </button>
        )}
      </label>
      {id && <SheetUpload key={id} projectId={id} />}
    </div>
  );
}
