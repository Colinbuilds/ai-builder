"use client";

import { usePathname } from "next/navigation";

// The dashboard and job pages lay out their own panels on the gray canvas; every other page sits in one white panel.
const OWN_LAYOUT = [/^\/$/, /^\/projects\/(?!new$)[^/]+/];

export function PagePanel({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (OWN_LAYOUT.some((r) => r.test(path))) return <>{children}</>;
  return <div className="rounded-sm border-t-2 border-t-[#3b7bc8] bg-background p-4 shadow-sm sm:p-6">{children}</div>;
}
