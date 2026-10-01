"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** "More crews…" picker on the dashboard: switches the production square to that crew. */
export function TabSelect({ param, options, value }: { param: string; options: string[]; value: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  if (!options.length) return null;
  return (
    <select
      aria-label="More crews"
      value={options.includes(value) ? value : ""}
      onChange={(e) => {
        const next = new URLSearchParams(sp.toString());
        next.set(param, e.target.value);
        next.set("dash", "1");
        router.push(`/?${next.toString()}`, { scroll: false });
      }}
      className="h-7 max-w-40 shrink-0 rounded-md border border-input bg-background px-1 text-xs"
    >
      <option value="">More crews…</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
