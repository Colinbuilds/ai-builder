"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  addTimeAction,
  approveTimeAction,
  createWorkOrderAction,
  crewWorkOrderAction,
  deleteTimeAction,
  saveCrewAction,
  scheduleEventAction,
  sendWorkOrderAction,
  updateEventAction,
  updateWorkOrderAction,
  workOrderStatusAction,
  type PRes,
} from "@/app/production-actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";
import { EVENT_KINDS } from "@/lib/production/rules";

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const Ok = ({ s, text = "Saved." }: { s: PRes; text?: string }) => (s?.ok ? <span className="text-sm text-green-700 dark:text-green-400">{s.note ?? text}</span> : null);
const textarea = "rounded-md border border-input bg-background p-2 text-sm";
type CrewOpt = { id: string; name: string; kind: string; warn?: string | null };


export function CrewForm({ crew }: { crew?: Record<string, unknown> & { id: string } }) {
  const [state, action, pending] = useFormAction(saveCrewAction, null);
  const c = (crew ?? {}) as Record<string, string | number | boolean | Date | null>;
  const [pay, setPay] = useState((c.payType as string) ?? "");
  const f = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input name={name} defaultValue={props.type === "date" ? iso(c[name] as Date) : ((c[name] as string) ?? "")} {...props} />
    </div>
  );
  return (
    <form onSubmit={action} className="flex flex-col gap-4">
      {crew && <input type="hidden" name="id" value={crew.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {f("name", "Name", { required: true, placeholder: "Crew 1 / ABC Gutters LLC" })}
        <div className="flex flex-col gap-1">
          <Label>Type</Label>
          <Select name="kind" defaultValue={(c.kind as string) ?? "CREW"}>
            <option value="CREW">In-house crew</option>
            <option value="SUB">Subcontractor</option>
          </Select>
        </div>
        {f("trade", "Trade", { placeholder: "roofing, siding, gutters…" })}
        {f("leadName", "Foreman / contact")}
        {f("phone", "Phone", { type: "tel" })}
        {f("email", "Email", { type: "email" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label>Default pay</Label>
          <Select name="payType" value={pay} onChange={(e) => setPay(e.target.value)}>
            <option value="">None / per job</option>
            <option value="HOURLY">Hourly</option>
            <option value="PIECE">Piece rate</option>
          </Select>
        </div>
        {pay && f("defaultRate", pay === "HOURLY" ? "$ per hour" : "$ per unit", { inputMode: "decimal" })}
        {pay === "PIECE" && f("rateUnit", "Unit", { placeholder: "SQ, SF, LF" })}
        {pay === "HOURLY" && f("burdenPct", "Burden %", { inputMode: "decimal", placeholder: "taxes, WC, benefits" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {f("coiExpires", "Insurance (COI) expires", { type: "date" })}
        {f("workersCompExpires", "Workers' comp expires", { type: "date" })}
        {f("licenseNumber", "License #")}
        {f("licenseExpires", "License expires", { type: "date" })}
      </div>
      <div className="flex flex-col gap-1">
        <Label>Notes</Label>
        <textarea name="notes" defaultValue={(c.notes as string) ?? ""} rows={2} className={textarea} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={crew ? !!c.active : true} /> Active
      </label>
      <div className="flex items-center gap-2">
        <Button disabled={pending}>{crew ? "Save" : "Add crew / sub"}</Button>
        <Ok s={state} />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function EventForm({ projectId, projects, crews, defaultTitle, defaultDate }: { projectId?: string; projects?: { id: string; name: string }[]; crews: CrewOpt[]; defaultTitle?: string; defaultDate?: string }) {
  const [state, action, pending] = useFormAction(scheduleEventAction, null, { resetOnOk: true });
  const [start, setStart] = useState(defaultDate ?? "");
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {projects && (
          <Select name="projectId" defaultValue="" className="lg:col-span-2">
            <option value="">No job (shop, service call…)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Select name="kind" defaultValue="INSTALL">
          {Object.entries(EVENT_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input name="title" placeholder="What" defaultValue={defaultTitle} required className={projects ? "" : "lg:col-span-2"} />
        <Input type="date" name="startDate" value={start} onChange={(e) => setStart(e.target.value)} required />
        <Input type="date" name="endDate" defaultValue="" min={start} title="Last day (blank = one day)" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Select name="crewId" defaultValue="">
          <option value="">No crew yet</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.kind === "SUB" ? " (sub)" : ""}
              {c.warn ? ` — ${c.warn}` : ""}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue="TENTATIVE">
          <option value="TENTATIVE">Tentative</option>
          <option value="CONFIRMED">Confirmed with the customer</option>
        </Select>
        <Input name="notes" placeholder="Notes (tarp, access, dog…)" />
      </div>
      {state?.needsOverride && <Input name="override" placeholder="Schedule anyway? Say why (kept on the event)" required autoFocus />}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          {state?.needsOverride ? "Schedule anyway" : "Add to schedule"}
        </Button>
        <Ok s={state} />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function EventControls({ id, projectId, status, start, end, crewId, crews }: { id: string; projectId: string | null; status: string; start: string; end: string; crewId: string | null; crews: CrewOpt[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(updateEventAction, null);
  const [sState, sAction] = useFormAction(updateEventAction, null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {status !== "DONE" && status !== "CANCELLED" && (
          <>
            <button className="text-xs underline" onClick={() => setOpen(!open)}>
              move / reassign
            </button>
            <form onSubmit={sAction} className="flex gap-1">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="projectId" value={projectId ?? ""} />
              {status === "TENTATIVE" && (
                <button className="text-xs underline" name="status" value="CONFIRMED">
                  confirm
                </button>
              )}
              <button className="text-xs underline" name="status" value="DONE">
                done
              </button>
              <button className="text-xs text-muted-foreground underline" name="status" value="CANCELLED">
                cancel
              </button>
            </form>
          </>
        )}
      </div>
      {open && (
        <form onSubmit={action} className="flex flex-col gap-1 rounded border p-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="projectId" value={projectId ?? ""} />
          <div className="flex flex-wrap gap-1">
            <Input type="date" name="startDate" defaultValue={start} className="h-7 w-36 text-xs" />
            <Input type="date" name="endDate" defaultValue={end} className="h-7 w-36 text-xs" />
            <Select name="crewId" defaultValue={crewId ?? ""} className="h-7 text-xs">
              <option value="">No crew</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input name="weatherNote" placeholder="Why (rain, wind…)" className="h-7 w-40 text-xs" />
          </div>
          {state?.needsOverride && <Input name="override" placeholder="Move anyway? Say why" className="h-7 text-xs" required />}
          <Button size="sm" variant="outline" className="h-7 self-start" disabled={pending}>
            Save
          </Button>
          <Problems state={state} />
        </form>
      )}
      <Problems state={sState} />
    </div>
  );
}

export function NewWorkOrder({ projectId, crews }: { projectId: string; crews: CrewOpt[] }) {
  const [state, action, pending] = useFormAction(createWorkOrderAction, null);
  if (!crews.length) return <p className="text-sm text-muted-foreground">Add crews and subs under Operations → Crews &amp; subs first.</p>;
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Select name="crewId" required defaultValue="" className="w-72">
        <option value="" disabled>
          Crew or sub…
        </option>
        {crews.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.kind === "SUB" ? " (sub)" : ""}
            {c.warn ? ` — ${c.warn}` : ""}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="outline" disabled={pending}>
        New work order
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

type WO = { id: string; status: string; scope: string[]; exclusions: string[]; instructions: string | null; startDate: Date | null; payBasis: string | null; payQty: number | null; payUnit: string | null; payRate: number | null; amount: number | null };
export function WorkOrderEditor({ projectId, w, showPay }: { projectId: string; w: WO; showPay: boolean }) {
  const [state, action, pending] = useFormAction(updateWorkOrderAction, null);
  const [sState, sAction, sPending] = useFormAction(sendWorkOrderAction, null);
  const [basis, setBasis] = useState(w.payBasis ?? "");
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={action} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={w.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Scope — one line each</Label>
            <textarea name="scope" rows={5} defaultValue={w.scope.join("\n")} className={textarea} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Not included</Label>
            <textarea name="exclusions" rows={5} defaultValue={w.exclusions.join("\n")} className={textarea} />
          </div>
        </div>
        <Input name="instructions" defaultValue={w.instructions ?? ""} placeholder="Instructions: tear-off layers, protect landscaping, magnet sweep, photos in CompanyCam…" />
        <div className="flex flex-wrap items-center gap-2">
          <Label>Start</Label>
          <Input type="date" name="startDate" defaultValue={iso(w.startDate)} className="w-40" />
          {showPay && (
            <>
              <Select name="payBasis" value={basis} onChange={(e) => setBasis(e.target.value)} className="w-40">
                <option value="">Pay…</option>
                <option value="PIECE">Piece rate</option>
                <option value="LUMP">Lump sum</option>
                <option value="HOURLY">Hourly (timesheets)</option>
              </Select>
              {basis === "PIECE" && (
                <>
                  <Input name="payQty" defaultValue={w.payQty ?? ""} placeholder="Qty" inputMode="decimal" className="w-20" />
                  <Input name="payUnit" defaultValue={w.payUnit ?? ""} placeholder="SQ" className="w-16" />
                  <span className="text-sm">×</span>
                  <Input name="payRate" defaultValue={w.payRate ?? ""} placeholder="$/unit" inputMode="decimal" className="w-24" />
                </>
              )}
              {basis === "LUMP" && <Input name="amount" defaultValue={w.amount ?? ""} placeholder="Agreed $" inputMode="decimal" className="w-32" />}
            </>
          )}
          <Button size="sm" variant="outline" disabled={pending}>
            Save
          </Button>
          <Ok s={state} />
        </div>
        <Problems state={state} />
      </form>
      <form onSubmit={sAction} className="flex items-center gap-2">
        <input type="hidden" name="id" value={w.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <Button size="sm" disabled={sPending}>
          Send to crew
        </Button>
        <span className="text-xs text-muted-foreground">Emails the crew a link (or gives you one to text). Pay becomes committed cost.</span>
      </form>
      {sState?.ok && <p className="text-sm break-all text-green-700 dark:text-green-400">{sState.note}</p>}
      <Problems state={sState} />
    </div>
  );
}

export function WorkOrderStatus({ projectId, id, status }: { projectId: string; id: string; status: string }) {
  const [state, action] = useFormAction(workOrderStatusAction, null);
  const [cancel, setCancel] = useState(false);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      {status !== "COMPLETE" && status !== "CANCELLED" && (
        <Button size="sm" variant="ghost" className="h-7 text-xs" name="status" value="COMPLETE">
          Mark complete
        </Button>
      )}
      {status !== "COMPLETE" && status !== "CANCELLED" && !cancel && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setCancel(true)}>
          cancel
        </button>
      )}
      {cancel && (
        <>
          <Input name="reason" placeholder="Why?" className="h-7 w-40 text-xs" required />
          <Button size="sm" variant="ghost" className="h-7 text-xs" name="status" value="CANCELLED">
            Cancel work order
          </Button>
        </>
      )}
      <Problems state={state} />
    </form>
  );
}

export function CrewWorkOrderButtons({ token, status }: { token: string; status: string }) {
  const [state, action, pending] = useFormAction(crewWorkOrderAction, null);
  if (status === "COMPLETE") return <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">Marked complete. Thanks!</p>;
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      <input type="hidden" name="token" value={token} />
      <Input name="name" placeholder="Your name" required />
      <div className="flex gap-2">
        {status !== "IN_PROGRESS" && (
          <Button type="submit" name="status" value="IN_PROGRESS" variant="outline" disabled={pending} className="flex-1">
            Started
          </Button>
        )}
        <Button type="submit" name="status" value="COMPLETE" disabled={pending} className="flex-1">
          Job complete
        </Button>
      </div>
      <Ok s={state} text="Thanks — the office has it." />
      <Problems state={state} />
    </form>
  );
}

export function TimeForm({ projectId, crews }: { projectId: string; crews: (CrewOpt & { payType: string | null; defaultRate: number | null; rateUnit: string | null; burdenPct: number | null })[] }) {
  const [state, action, pending] = useFormAction(addTimeAction, null, { resetOnOk: true });
  const [crewId, setCrewId] = useState("");
  const crew = crews.find((c) => c.id === crewId);
  const [basis, setBasis] = useState("HOURLY");
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        <Select
          name="crewId"
          value={crewId}
          onChange={(e) => {
            setCrewId(e.target.value);
            const c = crews.find((x) => x.id === e.target.value);
            if (c?.payType) setBasis(c.payType);
          }}
          required
          className="w-56"
        >
          <option value="" disabled>
            Crew / sub…
          </option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input type="date" name="date" defaultValue={iso(new Date())} className="w-40" required />
        <Select name="basis" value={basis} onChange={(e) => setBasis(e.target.value)} className="w-32">
          <option value="HOURLY">Hours</option>
          <option value="PIECE">Piece</option>
        </Select>
        {basis === "HOURLY" ? (
          <>
            <Input name="hours" placeholder="Total crew hours" inputMode="decimal" className="w-36" required />
            <Input name="rate" placeholder={crew?.payType === "HOURLY" && crew.defaultRate != null ? `$${crew.defaultRate}/h (default)` : "$/hour"} inputMode="decimal" className="w-40" />
            <Input name="burdenPct" placeholder={crew?.burdenPct != null ? `${crew.burdenPct}% burden (default)` : "Burden %"} inputMode="decimal" className="w-44" />
          </>
        ) : (
          <>
            <Input name="qty" placeholder="Qty done" inputMode="decimal" className="w-24" required />
            <Input name="unit" defaultValue={crew?.rateUnit ?? ""} placeholder="SQ" className="w-16" required />
            <Input name="rate" placeholder={crew?.payType === "PIECE" && crew.defaultRate != null ? `$${crew.defaultRate} (default)` : "$/unit"} inputMode="decimal" className="w-32" />
          </>
        )}
      </div>
      <Input name="note" placeholder="Note (tear-off day 1, 2 layers…)" />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending}>
          Log time
        </Button>
        <Ok s={state} />
      </div>
      <Problems state={state} />
    </form>
  );
}

export function TimeActions({ projectId, id, approved, canApprove }: { projectId: string; id: string; approved: boolean; canApprove: boolean }) {
  const [state, action] = useFormAction(approveTimeAction, null);
  const [dState, dAction] = useFormAction(deleteTimeAction, null);
  if (approved) return <span className="text-xs text-green-700">in job costing</span>;
  return (
    <div className="flex items-center gap-2">
      {canApprove && (
        <form onSubmit={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button className="text-xs underline">approve</button>
        </form>
      )}
      <form onSubmit={dAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="projectId" value={projectId} />
        <button className="text-xs text-muted-foreground underline">delete</button>
      </form>
      <Problems state={state ?? dState} />
    </div>
  );
}
