"use client";

import { useActionState } from "react";
import { syncAbcAction } from "@/app/connections/actions";

export function AbcSyncButton() {
  const [state, run, pending] = useActionState(syncAbcAction, null);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className="h-8 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
        {pending ? "Reading ABC…" : "Sync now"}
      </button>
      {state && <span className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
