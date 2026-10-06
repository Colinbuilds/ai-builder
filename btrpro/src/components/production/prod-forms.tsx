"use client";

import { useActionState } from "react";
import { prodSheetSettingsAction, saveProdAction, syncProdAction } from "@/app/production/actions";
import { Problems } from "@/components/projects/problems";
import { useBrand } from "@/components/brand";

const box = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export type ProdValues = Record<string, string | number | Date | null | undefined> & { id?: string };

export function ProdForm({ v, back, crews, supers, boards }: { v: ProdValues; back: string; crews: string[]; supers: string[]; boards: [string, string][] }) {
  const { shortName } = useBrand();
  const [state, dispatch, pending] = useActionState(saveProdAction, null);
  const f = (name: string, label: string, o: { type?: string; ph?: string; list?: string; area?: boolean } = {}) => {
    const val = v[name];
    const def = o.type === "date" ? ymd(val as Date | null) : val == null ? "" : String(val);
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        {o.area ? (
          <textarea name={name} defaultValue={def} rows={2} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
        ) : (
          <input name={name} type={o.type ?? "text"} defaultValue={def} placeholder={o.ph} list={o.list} inputMode={o.type === "money" ? "decimal" : undefined} className={box} />
        )}
      </label>
    );
  };
  return (
    <form action={dispatch} className="flex max-w-5xl flex-col gap-3">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <input type="hidden" name="back" value={back} />
      <datalist id="crews">{crews.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="supers">{supers.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Market
          <select name="market" defaultValue={String(v.market ?? "RESIDENTIAL")} className={box}>
            <option value="RESIDENTIAL">Residential</option>
            <option value="COMMERCIAL">Commercial</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          List
          <select name="board" defaultValue={String(v.board ?? "ADD")} className={box}>
            {boards.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {f("estimateNo", "Estimate / QuickBooks #", { ph: "est 6024" })}
        {f("vpo", "VPO / CO #", { ph: "Builder's VPO number" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {f("builder", "Builder / GC")}
        {f("project", "Project (commercial)")}
        {f("location", "Address / building")}
        {f("model", "Model / plan")}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {f("type", "Type of work", { ph: "Siding Labor, Gutters, Roofing L&M…" })}
        {f("crew", "Crew", { list: "crews" })}
        {f("superName", "Super / PM", { list: "supers" })}
        {f("salesRep", "Sales rep", { ph: "House" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {f("startDate", "Crew starts", { type: "date" })}
        {f("endDate", "Crew done by", { type: "date" })}
        {f("payout", "Pay out (to crew)", { type: "money" })}
        {f("sell", "Sell (to builder)", { type: "money" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {f("completed", "Completed")}
        {f("approved", "Crew paid / approved")}
        {f("billed", "Billed")}
        {f("btrPaid", `${shortName} paid`)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {f("notes", "Notes", { area: true })}
        {f("billingNotes", "Billing notes", { area: true })}
      </div>
      <div>
        <button disabled={pending} className="rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Saving…" : v.id ? "Save" : "Add to the schedule"}
        </button>
      </div>
      <Problems state={state} />
    </form>
  );
}

export function ProdSyncButton() {
  const [state, dispatch, pending] = useActionState(syncProdAction, null);
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className="h-8 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
        {pending ? "Reading the schedules…" : "Sync from the live sheets now"}
      </button>
      {state?.message && <span className="text-sm text-green-700">{state.message}</span>}
      <Problems state={state} />
    </form>
  );
}

export function ProdSheetSettings({ res, comm, off }: { res: string; comm: string; off: boolean }) {
  const { productName: app } = useBrand();
  const [state, dispatch, pending] = useActionState(prodSheetSettingsAction, null);
  return (
    <form action={dispatch} className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        Residential schedule link
        <input name="res" defaultValue={res} className={box} />
      </label>
      <label className="flex flex-col gap-1">
        Commercial schedule link
        <input name="comm" defaultValue={comm} className={box} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="off" defaultChecked={off} /> {app} is now the schedule — stop the sheet sync
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
