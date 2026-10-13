"use client";

import { useEffect, useRef } from "react";

/** A near-full-screen panel over the page (native <dialog>: Esc closes it, focus stays inside). */
export function FullSheet({ open, onClose, title, right, children }: { open: boolean; onClose: () => void; title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto h-[calc(100dvh-1.5rem)] max-h-none w-[calc(100vw-1.5rem)] max-w-none overflow-hidden rounded-lg border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)]"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">{title}</div>
            <div className="flex items-center gap-3">
              {right}
              <button type="button" onClick={onClose} className="h-8 rounded-md border px-3 text-sm hover:bg-muted" aria-label="Close">
                Close ✕
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
