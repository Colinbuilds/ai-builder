"use client";

import { useRouter } from "next/navigation";

/** A dropdown that goes to the picked option's page (crew / PM pickers on the dashboard and the schedule). */
export function NavSelect({ label, options, value, className = "" }: { label: string; options: { label: string; href: string; group?: string }[]; value: string; className?: string }) {
  const router = useRouter();
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  const render = (os: typeof options) =>
    os.map((o) => (
      <option key={o.href} value={o.href}>
        {o.label}
      </option>
    ));
  return (
    <select aria-label={label} value={value} onChange={(e) => router.push(e.target.value, { scroll: false })} className={`h-8 rounded-md border border-input bg-background px-2 text-sm ${className}`}>
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {render(options.filter((o) => o.group === g))}
          </optgroup>
        ) : (
          render(options.filter((o) => !o.group))
        ),
      )}
    </select>
  );
}
