"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { askAction } from "@/app/library/codes/actions";
import { useBrand } from "@/components/brand";

export function AskForm({ jobs, job, jurisdiction = "Omaha, NE" }: { jobs: { id: string; name: string }[]; job?: string; jurisdiction?: string }) {
  const { assistantName: bot } = useBrand();
  const [state, run, pending] = useActionState(askAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.id) router.push(`/library/codes?q=${state.id}${job ? `&job=${job}` : ""}#q-${state.id}`);
  }, [state, router, job]);
  return (
    <form action={run} className="flex flex-col gap-2 text-sm">
      <textarea
        name="question"
        required
        rows={3}
        placeholder="e.g. What does the 2018 IRC require for ice barrier at the eaves in Omaha? · HardiePlank clearance to roof line? · Mule-Hide EPDM fastening at the perimeter for a 20-year warranty?"
        className="w-full rounded-md border border-input bg-background p-2"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          Where
          <input name="jurisdiction" defaultValue={jurisdiction} className="h-8 w-40 rounded-md border border-input bg-background px-2" />
        </label>
        <label className="flex items-center gap-1">
          Job
          <select name="projectId" defaultValue={job ?? ""} className="h-8 max-w-56 rounded-md border border-input bg-background px-1">
            <option value="">— none —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="specs" defaultChecked /> check the job&apos;s spec book & plans
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="official" /> official sources only
        </label>
        <button disabled={pending} className="ml-auto h-9 rounded-md bg-btr-blue px-4 font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Researching… (up to a minute or two)" : `Ask ${bot}`}
        </button>
      </div>
      {state && !state.ok && <p className="text-red-700">{state.message}</p>}
    </form>
  );
}
