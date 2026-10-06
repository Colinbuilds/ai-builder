"use client";

import { useActionState } from "react";
import { reprintAllAction, scanAction } from "@/app/settings/drive-jobs/actions";
import { useBrand } from "@/components/brand";

export function DriveScanButton() {
  const [state, run, pending] = useActionState(scanAction, null);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className="h-9 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
        {pending ? "Scanning Drive (can take a few minutes)…" : "1. Scan Drive"}
      </button>
      {state && <span className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}

export function ReprintAllButton() {
  const { productName: app } = useBrand();
  const [state, run, pending] = useActionState(reprintAllAction, null);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className="h-9 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
        {pending ? "Reprinting proposals…" : `3. Reprint moved proposals in ${app} format (open jobs)`}
      </button>
      {state && <span className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
