"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** A button with a menu that opens below it. The menu is fixed-positioned so a scrolling toolbar can't clip it. */
export function Dropdown({
  button,
  children,
  align = "left",
  className = "",
  width = 240,
  label,
}: {
  button: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  width?: number;
  label: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setPos(null), [path]);
  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) setPos(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const gone = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", gone);
    };
  }, [pos]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = align === "right" ? r.right - w : r.left;
    setPos({ top: r.bottom + 2, left: Math.max(8, Math.min(left, window.innerWidth - w - 8)) });
  };
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={!!pos} aria-label={label} onClick={toggle} className={className}>
        {button}
      </button>
      {pos && (
        <div
          ref={menu}
          role="menu"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 16) }}
          className="z-50 max-h-[70vh] overflow-y-auto rounded-md border bg-background py-1 text-sm text-foreground shadow-lg"
          onClick={(e) => (e.target as HTMLElement).closest("a") && setPos(null)}
        >
          {children}
        </div>
      )}
    </>
  );
}

export function MenuHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>;
}
