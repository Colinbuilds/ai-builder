"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import type { ActionResult } from "@/app/projects/actions";
import { MARKET_DEFAULTS, type Market } from "@/lib/market-shared";
import { WORK_TYPES, WORK_TYPE_LABEL } from "@/lib/projects/work-types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "./problems";
import { AddressInput } from "@/components/address-input";

type Opt = { id: string; name: string };

/**
 * New job / lead, in the order the office takes a call:
 * name → phone/email → address → what kind of job → who it's assigned to. Everything else is under "More details".
 */
export function NewLeadForm({
  action,
  companies,
  users,
  properties,
  me,
  market: startMarket,
  clientCompanyId,
  propertyId,
}: {
  action: (s: ActionResult, f: FormData) => Promise<ActionResult>;
  companies: (Opt & { type?: string })[];
  users: Opt[];
  properties: { id: string; name: string; address: string | null; companyId: string }[];
  me: string;
  market: Market;
  clientCompanyId: string | null;
  propertyId: string | null;
}) {
  const [state, formAction, pending] = useFormAction(action, null);
  const [market, setMarket] = useState<Market>(startMarket);
  const [types, setTypes] = useState<string[]>([]);
  const [clientId, setClientId] = useState(clientCompanyId ?? "");
  const [propId, setPropId] = useState(propertyId ?? "");
  const [address, setAddress] = useState(properties.find((p) => p.id === propertyId)?.address ?? "");
  const [insurance, setInsurance] = useState(false);
  const sites = properties.filter((p) => p.companyId === clientId);
  const res = market === "RESIDENTIAL";

  return (
    <form onSubmit={formAction} className="flex flex-col gap-5">
      <Section n={1} title="Customer">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input name="hoFirstName" autoComplete="off" autoFocus />
          </Field>
          <Field label="Last name">
            <Input name="hoLastName" autoComplete="off" />
          </Field>
        </div>
      </Section>

      <Section n={2} title="Phone / email">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input name="hoPhone" type="tel" inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="Email">
            <Input name="hoEmail" type="email" autoComplete="off" />
          </Field>
        </div>
      </Section>

      <Section n={3} title="Address">
        <AddressInput value={address} onChange={setAddress} placeholder="Start typing — pick the match" ariaLabel="Address" />
      </Section>

      <Section n={4} title="What kind of job">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Job type">
          {WORK_TYPES.map((t) => {
            const on = types.includes(t);
            return (
              <label
                key={t}
                className={`cursor-pointer rounded-md border px-4 py-2 text-sm select-none ${on ? "border-btr-blue bg-btr-blue text-white" : "border-btr-line hover:bg-accent"}`}
              >
                <input
                  type="checkbox"
                  name="workTypes"
                  value={t}
                  checked={on}
                  onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))}
                  className="sr-only"
                />
                {WORK_TYPE_LABEL[t]}
              </label>
            );
          })}
        </div>
        <span className="text-xs text-muted-foreground">Pick all that apply.</span>
      </Section>

      <Section n={5} title="Assigned to">
        <Select name="salespersonId" defaultValue={me} aria-label="Assigned to" className="sm:max-w-sm">
          <option value="">— unassigned —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Section>

      <details className="rounded-lg border border-btr-line p-3" open={!!clientCompanyId || !!propertyId}>
        <summary className="cursor-pointer text-sm font-medium">More details (optional)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex gap-2 sm:col-span-2" role="radiogroup" aria-label="Market">
            {(["RESIDENTIAL", "COMMERCIAL"] as const).map((m) => (
              <label key={m} className={`flex cursor-pointer items-center rounded-md border px-4 py-2 text-sm ${market === m ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}>
                <input type="radio" name="market" value={m} checked={market === m} onChange={() => setMarket(m)} className="sr-only" />
                {m === "RESIDENTIAL" ? "Residential" : "Commercial"}
              </label>
            ))}
          </div>
          <Field label={res ? "Builder / company, if any" : "Client (GC / owner / property manager)"}>
            <Select
              name="clientCompanyId"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setPropId("");
              }}
            >
              <option value="">— none —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.type === "BUILDER" ? " (builder pricing)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          {sites.length > 0 ? (
            <Field label="Property">
              <Select
                name="propertyId"
                value={propId}
                onChange={(e) => {
                  setPropId(e.target.value);
                  const a = sites.find((p) => p.id === e.target.value)?.address;
                  if (a) setAddress(a);
                }}
              >
                <option value="">— pick the community / site —</option>
                {sites.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label="Lead source">
            <Input name="leadSource" list={`lead-sources-${market}`} />
            <datalist id={`lead-sources-${market}`}>
              {MARKET_DEFAULTS[market].leadSources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue="NORMAL">
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </Select>
          </Field>
          <Field label="First appointment" className="sm:col-span-2">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 sm:max-w-md">
              <Input name="apptDate" type="date" aria-label="Appointment date" />
              <Input name="apptStart" type="time" aria-label="Start time" className="w-28" />
              <Input name="apptEnd" type="time" aria-label="End time" className="w-28" />
            </div>
          </Field>
          {res && (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <input type="checkbox" name="isInsuranceClaim" checked={insurance} onChange={(e) => setInsurance(e.target.checked)} />
                Insurance claim
              </label>
              {insurance && (
                <>
                  <Input name="insuranceCarrier" placeholder="Carrier" />
                  <Input name="claimNumber" placeholder="Claim #" />
                  <Input name="dateOfLoss" type="date" aria-label="Date of loss" />
                </>
              )}
            </div>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <textarea name="notes" rows={3} maxLength={1000} placeholder="What the customer asked for, gate code, best time to call…" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The appointment goes on the schedule and the assignee&apos;s My day; notes go in the job&apos;s team chat. Bid dates, bonds and the rest are on the job&apos;s Job details after it&apos;s created.
          </p>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Create job"}</Button>
      </div>
      <Problems state={state} />
    </form>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-btr-black text-[11px] text-white">{n}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
