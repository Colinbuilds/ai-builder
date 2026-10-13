"use client";

import { useActionState, useState } from "react";
import { createHouseAction } from "@/app/production/homes/actions";
import { AddressInput } from "@/components/address-input";
import { Problems } from "@/components/projects/problems";

const box = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function HouseForm({ builders, models, supers, scopes, builder: first }: { builders: string[]; models: Record<string, string[]>; supers: string[]; scopes: readonly string[]; builder?: string }) {
  const [state, dispatch, pending] = useActionState(createHouseAction, null);
  const [builder, setBuilder] = useState(first ?? "");
  const [address, setAddress] = useState("");
  const modelList = models[builder] ?? [];
  return (
    <form action={dispatch} className="flex max-w-4xl flex-col gap-4">
      <datalist id="builders">{builders.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="models">{modelList.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id="supers">{supers.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Builder
          <input name="builder" value={builder} onChange={(e) => setBuilder(e.target.value)} list="builders" placeholder="Pick or type the builder" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Address from the builder
          <AddressInput value={address} onChange={setAddress} placeholder="Lot address" ariaLabel="Address from the builder" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Model
          <input name="model" list="models" placeholder={modelList.length ? "Pick from the plan book or type it" : "e.g. Sienna"} className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Elevation
          <input name="elevation" placeholder="e.g. A, B, Craftsman" className={box} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Scopes</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {scopes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scope" value={s} className="size-4" /> {s}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Each scope goes on the schedule as its own line, so it gets its own crew, pay out, sell and billing.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Builder&apos;s super
          <input name="superName" list="supers" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          VPO / PO #
          <input name="vpo" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Target start
          <input name="startDate" type="date" className={box} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Notes
        <textarea name="notes" rows={2} className="w-full rounded-md border border-input bg-background p-2 text-sm" placeholder="Colors, lot notes, anything from the builder" />
      </label>
      <div>
        <button disabled={pending} className="rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Creating…" : "Create job"}
        </button>
      </div>
      <Problems state={state} />
    </form>
  );
}
