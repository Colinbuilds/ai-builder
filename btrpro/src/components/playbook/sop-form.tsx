"use client";

import { useFormAction } from "@/components/use-form-action";
import { saveSopAction } from "@/app/playbook/actions";

const input = "h-9 rounded-md border border-input bg-background px-2 text-sm";
type Sop = { id: string; title: string; area: string; ownerName: string | null; body: string; reviewEveryMonths: number; draft: boolean };

export function SopForm({ sop, areas, people }: { sop: Sop | null; areas: [string, string][]; people: string[] }) {
  const [s, act, pending] = useFormAction(saveSopAction, null);
  return (
    <form onSubmit={act} className="flex flex-col gap-2">
      {sop && <input type="hidden" name="id" value={sop.id} />}
      <input name="title" required defaultValue={sop?.title} placeholder="What it's for — e.g. Ordering materials for a residential reroof" className={input} />
      <div className="grid gap-2 sm:grid-cols-3">
        <select name="area" required defaultValue={sop?.area ?? ""} className={input}>
          <option value="" disabled>
            Area
          </option>
          {areas.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input name="ownerName" list="sop-people" defaultValue={sop?.ownerName ?? ""} placeholder="Owner (keeps it current)" className={input} />
        <datalist id="sop-people">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <label className="flex items-center gap-2 text-sm">
          Review every
          <input name="reviewEveryMonths" type="number" min={1} max={36} defaultValue={sop?.reviewEveryMonths ?? 12} className={`${input} w-16`} />
          months
        </label>
      </div>
      <textarea name="body" required rows={14} defaultValue={sop?.body} placeholder={"1. First step — one action, who does it\n2. …\n\nUse **bold** for the button or page name."} className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="draft" value="1" defaultChecked={sop?.draft ?? true} /> Draft (not yet confirmed by the owner)
      </label>
      {s?.problems.length ? <p className="text-sm text-red-700">{s.problems.join(" ")}</p> : null}
      <button disabled={pending} className="h-9 self-start rounded-md bg-btr-blue px-3 text-sm text-white hover:bg-btr-blue-dark disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
