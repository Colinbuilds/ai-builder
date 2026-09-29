"use client";

import { useFormAction } from "@/components/use-form-action";
import type { ActionResult } from "@/app/projects/actions";
import { SCOPES, SCOPE_LABEL } from "@/lib/projects/intake";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "./problems";

type Opt = { id: string; name: string };
export type ProjectFormValues = {
  id?: string;
  name?: string;
  address?: string | null;
  buildingUse?: string | null;
  constructionType?: string | null;
  scopes?: string[];
  isPublic?: boolean;
  isTaxExempt?: boolean;
  bidDueDate?: string | null;
  acculynxJobNumber?: string | null;
  leadSource?: string | null;
  clientCompanyId?: string | null;
  salespersonId?: string | null;
  estimatorId?: string | null;
  contractAmount?: number | null;
  contractSignedAt?: string | null;
};

export function ProjectForm({
  action,
  values = {},
  companies,
  users,
  showContract = false,
  submitLabel,
}: {
  action: (s: ActionResult, f: FormData) => Promise<ActionResult>;
  values?: ProjectFormValues;
  companies: Opt[];
  users: Opt[];
  showContract?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useFormAction(action, null);
  const v = values;
  return (
    <form onSubmit={formAction} className="grid gap-3 sm:grid-cols-2">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <Field label="Job name" className="sm:col-span-2">
        <Input name="name" defaultValue={v.name} required placeholder="e.g. Fontenelle Hills Apartments — Bldg C reroof" />
      </Field>
      <Field label="Address">
        <Input name="address" defaultValue={v.address ?? ""} />
      </Field>
      <Field label="Client (GC / owner / property manager)">
        <Select name="clientCompanyId" defaultValue={v.clientCompanyId ?? ""}>
          <option value="">— none / homeowner —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Building use">
        <Input name="buildingUse" defaultValue={v.buildingUse ?? ""} placeholder="Multi-family, retail, school…" />
      </Field>
      <Field label="New construction or reroof">
        <Select name="constructionType" defaultValue={v.constructionType ?? ""}>
          <option value="">— not known yet —</option>
          <option value="NEW">New construction</option>
          <option value="REROOF">Reroof / re-side</option>
        </Select>
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Scopes (decides which intake fields apply)</legend>
        <div className="flex flex-wrap gap-4">
          {SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scopes" value={s} defaultChecked={v.scopes?.includes(s)} />
              {SCOPE_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-6 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isPublic" defaultChecked={v.isPublic} /> Public / government job
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isTaxExempt" defaultChecked={v.isTaxExempt} /> Tax-exempt
        </label>
      </div>
      <Field label="Bid due">
        <Input name="bidDueDate" type="date" defaultValue={v.bidDueDate ?? ""} />
      </Field>
      <Field label="AccuLynx job #">
        <Input name="acculynxJobNumber" defaultValue={v.acculynxJobNumber ?? ""} />
      </Field>
      <Field label="Lead source">
        <Input name="leadSource" defaultValue={v.leadSource ?? ""} placeholder="GC invite, repeat client, referral…" list="lead-sources" />
        <datalist id="lead-sources">
          <option value="GC bid invite" />
          <option value="Public bid advertisement" />
          <option value="Repeat client" />
          <option value="Referral" />
          <option value="Website" />
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Salesperson">
          <UserSelect name="salespersonId" users={users} value={v.salespersonId} />
        </Field>
        <Field label="Estimator">
          <UserSelect name="estimatorId" users={users} value={v.estimatorId} />
        </Field>
      </div>
      {showContract && (
        <>
          <Field label="Contract amount">
            <Input name="contractAmount" inputMode="decimal" defaultValue={v.contractAmount ?? ""} placeholder="Set when sold" />
          </Field>
          <Field label="Contract signed">
            <Input name="contractSignedAt" type="date" defaultValue={v.contractSignedAt ?? ""} />
          </Field>
        </>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
      </div>
      <Problems state={state} className="sm:col-span-2" />
    </form>
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

function UserSelect({ name, users, value }: { name: string; users: Opt[]; value?: string | null }) {
  return (
    <Select name={name} defaultValue={value ?? ""}>
      <option value="">—</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}
