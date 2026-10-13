"use client";

import { useActionState, useRef, useState } from "react";
import { createHouseAction, readPacketAction } from "@/app/production/homes/actions";
import { AddressInput } from "@/components/address-input";
import { Problems } from "@/components/projects/problems";
import { BASEMENTS, houseDescription } from "@/lib/production/house-text";
import type { Packet, PacketScope } from "@/lib/production/work-order";

const box = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const word = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/)[0] ?? "";

export function HouseForm({ builders, models, supers, scopes, addOnNames, builder: first }: { builders: string[]; models: Record<string, string[]>; supers: string[]; scopes: readonly string[]; addOnNames: readonly string[]; builder?: string }) {
  const [state, dispatch, pending] = useActionState(createHouseAction, null);
  const [builder, setBuilder] = useState(first ?? "");
  const [address, setAddress] = useState("");
  const [model, setModel] = useState("");
  const [elevation, setElevation] = useState("");
  const [elevationType, setElevationType] = useState("");
  const [basement, setBasement] = useState("FULL_DIG");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [houseInfo, setHouseInfo] = useState("");
  const [orders, setOrders] = useState<PacketScope[]>([]);
  const [planUrl, setPlanUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ read: string[]; problems: string[] } | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const modelList = models[builder] ?? [];
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function read(files: FileList | null) {
    const pdfs = [...(files ?? [])];
    if (!pdfs.length) return;
    const fd = new FormData();
    for (const f of pdfs) fd.append("file", f);
    setReading(true);
    setReadNote(null);
    try {
      const r = await readPacketAction(fd);
      if (r.error || !r.packet) return setReadNote({ read: [], problems: [r.error ?? "Couldn't read those files."] });
      fill(r.packet);
    } catch {
      setReadNote({ read: [], problems: ["Couldn't upload those files. Try again, or drop fewer at a time."] });
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function fill(p: Packet) {
    // "Hubbell Homes of Omaha, LC" → the builder already set up as "Hubbell Homes"
    if (p.builder) setBuilder(builders.find((b) => word(b) && word(b) === word(p.builder!)) ?? p.builder);
    if (p.street) setAddress([p.street, p.city].filter(Boolean).join(", "));
    if (p.model) setModel(p.model);
    if (p.elevation) setElevation(p.elevation);
    if (p.elevationType) setElevationType(p.elevationType);
    if (p.basement) setBasement(p.basement);
    if (p.addOns.length) setAddOns((cur) => [...new Set([...cur, ...p.addOns])]);
    if (p.houseInfo.length) setHouseInfo(p.houseInfo.join(" · "));
    if (p.planUrl) setPlanUrl(p.planUrl);
    if (p.scopes.length) {
      setOrders((cur) => [...cur.filter((o) => !p.scopes.some((s) => s.scope === o.scope)), ...p.scopes]);
      setPicked((cur) => [...new Set([...cur, ...p.scopes.map((s) => s.scope)])]);
    }
    setReadNote({ read: p.read, problems: p.problems });
  }

  const sent = orders.filter((o) => picked.includes(o.scope));
  return (
    <form action={dispatch} className="flex max-w-4xl flex-col gap-4">
      <datalist id="builders">{builders.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="models">{modelList.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id="supers">{supers.map((m) => <option key={m} value={m} />)}</datalist>
      <input type="hidden" name="planUrl" value={planUrl} />
      <input type="hidden" name="workOrders" value={JSON.stringify(sent)} />

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop the work orders and plan set here, or click to choose them"
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          read(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed p-5 text-center text-sm ${over ? "border-btr-blue bg-blue-50 dark:bg-blue-950" : "border-input hover:bg-muted/50"}`}
      >
        <span className="font-medium">{reading ? "Reading the work orders…" : "Drop the work orders and plan set here"}</span>
        <span className="text-xs text-muted-foreground">PDFs — one work order per scope, plus the scaled print. Or click to choose them. Everything read fills the form below for you to check.</span>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => read(e.target.files)} />
      </div>
      {readNote && (
        <div className="flex flex-col gap-1 text-xs">
          {readNote.read.map((r) => (
            <span key={r} className="text-green-800 dark:text-green-300">
              ✓ {r}
            </span>
          ))}
          {readNote.problems.length > 0 && <Problems state={{ problems: readNote.problems }} />}
        </div>
      )}

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
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Model
          <input name="model" value={model} onChange={(e) => setModel(e.target.value)} list="models" placeholder={modelList.length ? "Pick from the plan book or type it" : "e.g. Paloma"} className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Elevation
          <input name="elevation" value={elevation} onChange={(e) => setElevation(e.target.value)} placeholder="e.g. A, B" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Elevation type
          <input name="elevationType" value={elevationType} onChange={(e) => setElevationType(e.target.value)} placeholder="e.g. B (Extended Porch w/ Shed Dormer)" className={box} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Basement
          <select name="basement" value={basement} onChange={(e) => setBasement(e.target.value)} className={box}>
            {Object.entries(BASEMENTS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
                {k === "FULL_DIG" ? " (base)" : ""}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1 text-sm sm:col-span-2">
          <legend className="mb-1">Add-ons</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {addOnNames.map((a) => (
              <label key={a} className="flex items-center gap-1.5">
                <input type="checkbox" name="addOn" value={a} checked={addOns.includes(a)} onChange={() => setAddOns(toggle(addOns, a))} className="size-4" /> {a}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">Description: </span>
        {model || elevation ? houseDescription({ model, elevation, elevationType, basement, addOns }) : <span className="text-muted-foreground">fills in from the model, elevation, basement and add-ons</span>}
      </p>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Scopes</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {scopes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scope" value={s} checked={picked.includes(s)} onChange={() => setPicked(toggle(picked, s))} className="size-4" /> {s}
            </label>
          ))}
        </div>
        {orders.length > 0 && (
          <table className="mt-1 w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Scope</th>
                <th className="py-1 font-normal">Work order</th>
                <th className="py-1 text-right font-normal">Sell</th>
                <th className="py-1 pl-3 font-normal">Options</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => (
                <tr key={o.scope} className={picked.includes(o.scope) ? "" : "opacity-50"}>
                  <td className="py-1 font-medium">{o.scope}</td>
                  <td className="py-1">{o.workOrder}</td>
                  <td className="py-1 text-right tabular-nums">{o.sell != null ? usd(o.sell) : "—"}</td>
                  <td className="py-1 pl-3">{o.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground">Each scope goes on the schedule as its own line, so it gets its own crew, pay out, sell and billing. A work order&apos;s total becomes that scope&apos;s sell.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Builder&apos;s super
          <input name="superName" list="supers" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          VPO / PO # <span className="text-xs text-muted-foreground">(work order numbers fill in per scope)</span>
          <input name="vpo" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Target start
          <input name="startDate" type="date" className={box} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Other selections
        <input name="houseInfo" value={houseInfo} onChange={(e) => setHouseInfo(e.target.value)} placeholder="Lot, deck/patio, garage…" className={box} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Notes
        <textarea name="notes" rows={2} className="w-full rounded-md border border-input bg-background p-2 text-sm" placeholder="Colors, lot notes, anything from the builder" />
      </label>
      <div>
        <button disabled={pending || reading} className="rounded-md bg-btr-blue px-4 py-2 text-sm font-medium text-white hover:bg-btr-blue-dark disabled:opacity-50">
          {pending ? "Creating…" : "Create job"}
        </button>
      </div>
      <Problems state={state} />
    </form>
  );
}
