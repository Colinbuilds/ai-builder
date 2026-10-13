"use client";

import { useState, useTransition } from "react";
import { scopeStatusAction } from "@/app/production/homes/actions";

const TONE: Record<string, string> = {
  WAITING: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  IN_PROGRESS: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  DONE: "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
  BILLING: "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
};

/** One scope's status on the Home Company Schedule; picking a new one saves right away. */
export function ScopeStatusSelect({ id, value, options, label, disabled }: { id: string; value: string; options: [string, string][]; label: string; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-0.5">
      <select
        aria-label={label}
        value={v}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value;
          const prev = v;
          if (next === "DONE" && !confirm(`Mark ${label} Job Done? The office gets a note that the crew can be paid.`)) return;
          setV(next);
          setError(null);
          start(async () => {
            const r = await scopeStatusAction(id, next);
            if (r.error) {
              setV(prev);
              setError(r.error);
            }
          });
        }}
        className={`h-8 w-full min-w-28 rounded-md border px-1.5 text-xs font-medium disabled:opacity-60 ${TONE[v] ?? ""}`}
      >
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {error && <span className="max-w-40 text-xs text-red-700 dark:text-red-300">{error}</span>}
    </div>
  );
}
