"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewAction } from "@/app/audit/actions";
import { Problems } from "@/components/projects/problems";

/** ✓ / ⚑ for the item on top of the stack. Keys: ← back, → skip, Enter = looks good, F = flag. */
export function ReviewButtons({ entity, id, prevHref, nextHref }: { entity: string; id: string; prevHref: string | null; nextHref: string | null }) {
  const [state, dispatch, pending] = useActionState(reviewAction, null);
  const [flag, setFlag] = useState(false);
  const okForm = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (e.key === "ArrowRight" && nextHref) router.push(nextHref);
      if (e.key === "ArrowLeft" && prevHref) router.push(prevHref);
      if (e.key === "Enter") okForm.current?.requestSubmit();
      if (e.key.toLowerCase() === "f") setFlag(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [nextHref, prevHref, router]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form ref={okForm} action={dispatch}>
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="result" value="OK" />
          <button disabled={pending} className="rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800 disabled:opacity-50">
            ✓ Looks good
          </button>
        </form>
        <button type="button" onClick={() => setFlag((v) => !v)} className="rounded-md border border-red-300 px-4 py-2 font-medium text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40">
          ⚑ Flag
        </button>
        {prevHref && (
          <a href={prevHref} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
            ← Back
          </a>
        )}
        {nextHref && (
          <a href={nextHref} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
            Skip →
          </a>
        )}
        <span className="text-xs text-muted-foreground">Keys: Enter = looks good · F = flag · ← →</span>
      </div>
      {flag && (
        <form action={dispatch} className="flex flex-wrap gap-2">
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="result" value="FLAG" />
          <input name="note" autoFocus required placeholder="Your question for whoever approved it" className="h-9 min-w-72 flex-1 rounded-md border border-input bg-background px-2 text-sm" />
          <button disabled={pending} className="rounded-md bg-red-700 px-3 text-sm text-white disabled:opacity-50">
            Send back
          </button>
        </form>
      )}
      <Problems state={state} />
    </div>
  );
}
