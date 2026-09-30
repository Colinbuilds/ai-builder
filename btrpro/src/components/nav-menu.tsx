"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] } | NavItem;

const isGroup = (g: NavGroup): g is { label: string; items: NavItem[] } => "items" in g;

/** Top navigation: single links plus small dropdown groups, so the bar fits on one line. */
export function NavMenu({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(null), [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/projects") : path.startsWith(href));
  const cls = (on: boolean) => `rounded-md px-2 py-1 ${on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-1">
      {groups.map((g) =>
        isGroup(g) ? (
          g.items.length > 0 && (
            <div key={g.label} className="relative">
              <button type="button" className={cls(g.items.some((i) => active(i.href)))} aria-expanded={open === g.label} onClick={() => setOpen(open === g.label ? null : g.label)}>
                {g.label} <span className="text-xs">▾</span>
              </button>
              {open === g.label && (
                <div className="absolute left-0 z-20 mt-1 flex min-w-44 flex-col rounded-md border bg-background p-1 shadow-md">
                  {g.items.map((i) => (
                    <Link key={i.href} href={i.href} className={`rounded px-3 py-1.5 hover:bg-muted ${active(i.href) ? "font-medium" : ""}`}>
                      {i.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          <Link key={g.href} href={g.href} className={cls(active(g.href))}>
            {g.label}
          </Link>
        ),
      )}
    </div>
  );
}
