"use client";

import { useState } from "react";

/** A <details> whose open state belongs to the user, so server re-renders don't close it. */
export function Collapsible({
  title,
  defaultOpen,
  children,
  className,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={className}
    >
      <summary className="cursor-pointer font-semibold">{title}</summary>
      {children}
    </details>
  );
}
