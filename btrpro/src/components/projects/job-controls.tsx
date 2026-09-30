"use client";

import { Binoculars } from "lucide-react";
import { setPriorityAction, toggleWatchAction } from "@/app/shell-actions";

/** Priority dropdown (saves on change) for the job header. */
export function PriorityPicker({ projectId, priority, canEdit }: { projectId: string; priority: string; canEdit: boolean }) {
  const high = priority === "HIGH";
  return (
    <form action={setPriorityAction} className="flex flex-col px-3 text-xs">
      <input type="hidden" name="projectId" value={projectId} />
      <span className="text-muted-foreground">Job priority:</span>
      <span className="flex items-center gap-1.5">
        <span className={`size-2.5 rounded-full border-2 ${high ? "border-btr-black bg-btr-black" : "border-btr-future"}`} />
        <select
          name="priority"
          defaultValue={priority}
          disabled={!canEdit}
          aria-label="Job priority"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="bg-transparent text-sm outline-none"
        >
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
        </select>
      </span>
    </form>
  );
}

export function WatchButton({ projectId, watching }: { projectId: string; watching: boolean }) {
  return (
    <form action={toggleWatchAction} className="flex">
      <input type="hidden" name="projectId" value={projectId} />
      <button
        title={watching ? "Watching: activity on this job shows in your notifications. Click to stop." : "Watch this job: get its activity in your notifications"}
        className={`flex flex-col items-center justify-center px-3 text-xs ${watching ? "text-btr-blue" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Binoculars size={18} />
        {watching ? "Watching" : "Watch"}
      </button>
    </form>
  );
}
