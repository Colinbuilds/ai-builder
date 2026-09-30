"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({
  id,
  counts,
  showCosts,
}: {
  id: string;
  showCosts: boolean;
  counts: {
    chat: number;
    mentioned: boolean;
    email: number;
    documents: number;
    estimates: number;
  };
}) {
  const path = usePathname();
  const base = `/projects/${id}`;
  const tabs: [string, string, React.ReactNode?][] = [
    [base, "Overview"],
    [
      `${base}/chat`,
      "Team chat",
      counts.chat ? (
        <Pill key="c" n={counts.chat} hot={counts.mentioned} />
      ) : null,
    ],
    [
      `${base}/email`,
      "Email",
      counts.email ? <Pill key="e" n={counts.email} /> : null,
    ],
    [
      `${base}/documents`,
      "Documents",
      counts.documents ? <Pill key="d" n={counts.documents} /> : null,
    ],
    [`${base}/photos`, "Photos"],
    [`${base}/plans`, "Plan review"],
    [
      `${base}/estimates`,
      "Estimates",
      counts.estimates ? <Pill key="s" n={counts.estimates} /> : null,
    ],
    [`${base}/proposals`, "Proposals"],
    [`${base}/orders`, "Orders"],
    [`${base}/production`, "Production"],
    ...(showCosts
      ? ([[`${base}/billing`, "Billing"], [`${base}/costs`, "Job costing"]] as [string, string][])
      : []),
    [`${base}/assistant`, "AI assistant"],
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm">
      {tabs.map(([href, label, extra]) => {
        const active = href === base ? path === base : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 whitespace-nowrap ${
              active
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {extra}
          </Link>
        );
      })}
    </nav>
  );
}

function Pill({ n, hot }: { n: number; hot?: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 text-xs tabular-nums ${hot ? "bg-red-600 text-white" : "bg-muted text-muted-foreground"}`}
    >
      {n}
    </span>
  );
}
