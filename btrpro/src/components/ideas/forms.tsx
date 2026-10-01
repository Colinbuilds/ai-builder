"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addIdeaAction } from "@/app/ideas/actions";
import { Problems } from "@/components/projects/problems";

const box = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function IdeaForm({ areas, often }: { areas: readonly string[]; often: [string, string][] }) {
  const [state, dispatch, pending] = useActionState(addIdeaAction, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={dispatch} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        What would make your job easier?
        <input name="title" required maxLength={140} placeholder="e.g. Send the deposit invoice right from the signed proposal" className={box} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Tell us more — what do you do today, and what would be better?
        <textarea name="details" required rows={4} placeholder="Today I copy the job into QuickBooks by hand, then email the PDF. It would be faster if…" className="w-full rounded-md border border-input bg-background p-2 text-sm" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Area
          <select name="area" className={box} defaultValue="">
            <option value="">Pick one</option>
            {areas.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          How often does this come up?
          <select name="often" className={box} defaultValue="WEEKLY">
            {often.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Minutes it would save each time
          <input name="minutes" type="number" min={1} max={600} placeholder="e.g. 10" className={box} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Sending…" : "Send idea"}
        </button>
        {state?.ok && <span className="text-sm text-green-700">Thanks — it&apos;s on the list below.</span>}
      </div>
      <Problems state={state} />
    </form>
  );
}

export function CopyForClaude({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2500);
      }}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
    >
      {done ? "Copied — paste it to Claude" : "Copy open ideas for Claude"}
    </button>
  );
}
