"use client";

import { usePathname } from "next/navigation";

/** The overview lays out its own panels; every other job section sits in one white panel. */
export function JobBody({ id, children }: { id: string; children: React.ReactNode }) {
  const path = usePathname();
  if (path === `/projects/${id}`) return <>{children}</>;
  return <div className="rounded-lg border border-btr-line bg-background p-4 sm:p-6">{children}</div>;
}
