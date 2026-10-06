"use client";

import { useActionState } from "react";
import { saveEntryAction, sheetSettingsAction, syncSheetAction } from "@/app/estimating/schedule/actions";
import { Problems } from "@/components/projects/problems";
import { useBrand } from "@/components/brand";

const box = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const area = "min-h-[4.5rem] w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export type EntryValues = {
  id?: string;
  board: string;
  market: string;
  kind?: string | null;
  priority?: string;
  customer?: string | null;
  project?: string;
  scope?: string | null;
  estimator?: string | null;
  receivedAt?: Date | null;
  dueAt?: Date | null;
  sentAt?: Date | null;
  bidDate?: Date | null;
  status?: string | null;
  waitingOn?: string | null;
  sentTo?: string | null;
  results?: string | null;
  notes?: string | null;
  folderLink?: string | null;
};

export function SyncButton() {
  const [state, dispatch, pending] = useActionState(syncSheetAction, null);
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className="h-8 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
        {pending ? "Reading the sheet…" : "Sync from the sheet now"}
      </button>
      {state?.message && <span className="text-sm text-green-700">{state.message}</span>}
      <Problems state={state} />
    </form>
  );
}

export function SheetSettings({ link, off }: { link: string; off: boolean }) {
  const { productName: app } = useBrand();
  const [state, dispatch, pending] = useActionState(sheetSettingsAction, null);
  return (
    <form action={dispatch} className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        Estimating sheet link
        <input name="estimatingSheet" defaultValue={link} className={box} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="off" defaultChecked={off} /> {app} is now the estimating schedule — stop the automatic sheet sync
      </label>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="h-8 rounded-md border px-3 hover:bg-muted">
          Save
        </button>
        {state?.message && <span className="text-green-700">{state.message}</span>}
      </div>
    </form>
  );
}

export function EntryForm({ v, boards, priorities }: { v: EntryValues; boards: [string, string][]; priorities: [string, string][] }) {
  const [state, dispatch, pending] = useActionState(saveEntryAction, null);
  const field = (name: keyof EntryValues, label: string, opts: { area?: boolean; type?: string; ph?: string } = {}) => {
    const val = v[name];
    const def = opts.type === "date" ? ymd(val as Date | null) : ((val as string | null | undefined) ?? "");
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        {opts.area ? <textarea name={name} defaultValue={def} placeholder={opts.ph} className={area} /> : <input name={name} type={opts.type ?? "text"} defaultValue={def} placeholder={opts.ph} className={box} />}
      </label>
    );
  };
  return (
    <form action={dispatch} className="flex max-w-4xl flex-col gap-3">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Market
          <select name="market" defaultValue={v.market} className={box}>
            <option value="COMMERCIAL">Commercial</option>
            <option value="RESIDENTIAL">Residential</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          List
          <select name="board" defaultValue={v.board} className={box}>
            {boards.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Priority
          <select name="priority" defaultValue={v.priority ?? "STANDARD"} className={box}>
            {priorities.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select name="kind" defaultValue={v.kind ?? ""} className={box}>
            <option value="">—</option>
            <option value="NEW_BUILD">New build</option>
            <option value="REMODEL">Remodel / re-roof</option>
            {v.kind && !["NEW_BUILD", "REMODEL"].includes(v.kind) && <option value={v.kind}>{v.kind}</option>}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("customer", "Customer / GCs bidding", { ph: "Ronco, Hausmann…" })}
        <label className="flex flex-col gap-1 text-sm">
          Project
          <input name="project" required defaultValue={v.project ?? ""} className={box} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-3">{field("scope", "Scope / tasks", { ph: "Siding L&M/Roofing L&M/Gutters L&M" })}</div>
        {field("estimator", "Estimator (initials)", { ph: "EO" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {field("receivedAt", "Received", { type: "date" })}
        {field("dueAt", "Due", { type: "date" })}
        {field("sentAt", "Sent to suppliers", { type: "date" })}
        {field("bidDate", "Bid date", { type: "date" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {field("status", "Status", { ph: "Sent for review, TF done…" })}
        {field("waitingOn", "Waiting on", { ph: "ABC/Millard/Taper" })}
        {field("sentTo", "Bid sent to / reviewer", { ph: "Bobby/Rusty" })}
      </div>
      {field("folderLink", "Drive folder link")}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("results", "Results / follow-ups", { area: true, ph: "9/3 called Scott, waiting on bank…" })}
        {field("notes", "Notes", { area: true })}
      </div>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Saving…" : v.id ? "Save" : "Add to schedule"}
        </button>
      </div>
      <Problems state={state} />
    </form>
  );
}
