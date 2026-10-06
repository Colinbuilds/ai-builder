"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import type { ActionResult } from "@/app/projects/actions";
import { SCOPES, SCOPE_LABEL } from "@/lib/projects/intake";
import { WORK_TYPES, WORK_TYPE_LABEL, parseWorkTypes } from "@/lib/projects/work-types";
import { MARKET_DEFAULTS, type Market } from "@/lib/market-shared";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "./problems";
import { AddressInput } from "@/components/address-input";
import { useBrand } from "@/components/brand";

type Opt = { id: string; name: string };
export type ProjectFormValues = {
  id?: string;
  market?: Market;
  name?: string;
  address?: string | null;
  buildingUse?: string | null;
  constructionType?: string | null;
  scopes?: string[];
  workTypes?: unknown;
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
  isInsuranceClaim?: boolean;
  insuranceCarrier?: string | null;
  claimNumber?: string | null;
  dateOfLoss?: string | null;
  adjusterName?: string | null;
  adjusterPhone?: string | null;
  adjusterEmail?: string | null;
  deductible?: number | null;
  bidBondRequired?: boolean;
  perfBondRequired?: boolean;
  prevailingWage?: boolean;
  retainagePct?: number | null;
};

export function ProjectForm({
  action,
  values = {},
  companies,
  users,
  showContract = false,
  isNew = false,
  submitLabel,
  properties = [],
  propertyId,
}: {
  action: (s: ActionResult, f: FormData) => Promise<ActionResult>;
  values?: ProjectFormValues;
  companies: (Opt & { type?: string })[];
  users: Opt[];
  showContract?: boolean;
  isNew?: boolean;
  submitLabel: string;
  /** a customer's sites (apartment communities etc.) — picking one fills the address and adds its staff to the job */
  properties?: { id: string; name: string; address: string | null; companyId: string }[];
  propertyId?: string | null;
}) {
  const { shortName } = useBrand();
  const [state, formAction, pending] = useFormAction(action, null);
  const v = values;
  const [market, setMarket] = useState<Market>(v.market ?? "COMMERCIAL");
  const [scopes, setScopes] = useState<string[]>(
    v.scopes ?? MARKET_DEFAULTS[v.market ?? "COMMERCIAL"].scopes,
  );
  const [insurance, setInsurance] = useState(!!v.isInsuranceClaim);
  const res = market === "RESIDENTIAL";
  const [clientId, setClientId] = useState(v.clientCompanyId ?? "");
  const [propId, setPropId] = useState(propertyId ?? "");
  const [address, setAddress] = useState(v.address ?? properties.find((p) => p.id === propertyId)?.address ?? "");
  const sites = properties.filter((p) => p.companyId === clientId);

  const pickMarket = (m: Market) => {
    setMarket(m);
    if (isNew) setScopes(MARKET_DEFAULTS[m].scopes);
  };

  return (
    <form onSubmit={formAction} className="grid gap-3 sm:grid-cols-2">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div
        className="flex gap-2 sm:col-span-2"
        role="radiogroup"
        aria-label="Market"
      >
        {(["RESIDENTIAL", "COMMERCIAL"] as const).map((m) => (
          <label
            key={m}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm ${market === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            <input
              type="radio"
              name="market"
              value={m}
              checked={market === m}
              onChange={() => pickMarket(m)}
              className="sr-only"
            />
            {m === "RESIDENTIAL" ? "Residential" : "Commercial"}
          </label>
        ))}
      </div>

      <Field label="Job name" className="sm:col-span-2">
        <Input
          name="name"
          defaultValue={v.name}
          required
          placeholder={
            res
              ? "e.g. Johnson — hail reroof + gutters"
              : "e.g. Fontenelle Hills Apartments — Bldg C reroof"
          }
        />
      </Field>
      <Field label={res ? "Property address" : "Job site address"}>
        <AddressInput value={address} onChange={setAddress} />
      </Field>

      {res && isNew ? (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-sm font-medium">Homeowner</legend>
          <Input name="hoFirstName" placeholder="First name" />
          <Input name="hoLastName" placeholder="Last name" />
          <Input name="hoPhone" placeholder="Phone" />
          <Input name="hoEmail" type="email" placeholder="Email" />
          <div className="col-span-2 mt-2 flex flex-col gap-1">
            <span className="text-sm font-medium">
              Builder (new construction)
            </span>
            <Select
              name="clientCompanyId"
              defaultValue={v.clientCompanyId ?? ""}
            >
              <option value="">— none: homeowner job, {shortName} pricing —</option>
              {companies
                .filter((c) => c.type === "BUILDER")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — their pricing
                  </option>
                ))}
            </Select>
            <span className="text-xs text-muted-foreground">
              A builder job is priced from that builder&apos;s own ABC sheets.
              Homeowner is optional on builder jobs.
            </span>
          </div>
        </fieldset>
      ) : (
        <Field
          label={
            res
              ? "Company (property manager / builder), if any"
              : "Client (GC / owner / property manager)"
          }
        >
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
      )}
      {sites.length > 0 && (
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
          {isNew && <span className="text-xs text-muted-foreground">Fills the address and adds the site&apos;s staff to the job&apos;s contacts.</span>}
        </Field>
      )}

      <Field label="Building use">
        <Input
          name="buildingUse"
          defaultValue={
            v.buildingUse ?? (isNew && res ? "Single-family residence" : "")
          }
          placeholder={
            res
              ? "Single-family, townhome, detached garage…"
              : "Multi-family, retail, school…"
          }
        />
      </Field>
      <Field label="New construction or reroof">
        <Select
          name="constructionType"
          defaultValue={v.constructionType ?? (isNew && res ? "REROOF" : "")}
        >
          <option value="">— not known yet —</option>
          <option value="NEW">New construction</option>
          <option value="REROOF">Reroof / re-side</option>
        </Select>
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Job type</legend>
        <div className="flex flex-wrap gap-4">
          {WORK_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="workTypes" value={t} defaultChecked={parseWorkTypes(v.workTypes).includes(t)} />
              {WORK_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">
          Scopes (decides which intake fields apply)
        </legend>
        <div className="flex flex-wrap gap-4">
          {SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="scopes"
                value={s}
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, s]
                      : scopes.filter((x) => x !== s),
                  )
                }
              />
              {SCOPE_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>

      {res ? (
        <fieldset className="grid gap-3 rounded-md border p-3 sm:col-span-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="isInsuranceClaim"
              checked={insurance}
              onChange={(e) => setInsurance(e.target.checked)}
            />
            Insurance claim
          </label>
          {insurance && (
            <>
              <Input
                name="insuranceCarrier"
                defaultValue={v.insuranceCarrier ?? ""}
                placeholder="Carrier"
              />
              <Input
                name="claimNumber"
                defaultValue={v.claimNumber ?? ""}
                placeholder="Claim #"
              />
              <Field label="Date of loss">
                <Input
                  name="dateOfLoss"
                  type="date"
                  defaultValue={v.dateOfLoss ?? ""}
                />
              </Field>
              <Field label="Deductible">
                <Input
                  name="deductible"
                  inputMode="decimal"
                  defaultValue={v.deductible ?? ""}
                />
              </Field>
              <Input
                name="adjusterName"
                defaultValue={v.adjusterName ?? ""}
                placeholder="Adjuster name"
              />
              <Input
                name="adjusterPhone"
                defaultValue={v.adjusterPhone ?? ""}
                placeholder="Adjuster phone"
              />
              <Input
                name="adjusterEmail"
                defaultValue={v.adjusterEmail ?? ""}
                placeholder="Adjuster email"
                className="sm:col-span-2"
              />
            </>
          )}
        </fieldset>
      ) : (
        <fieldset className="grid gap-3 rounded-md border p-3 sm:col-span-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={v.isPublic}
            />{" "}
            Public / government job
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isTaxExempt"
              defaultChecked={v.isTaxExempt}
            />{" "}
            Tax-exempt
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="prevailingWage"
              defaultChecked={v.prevailingWage}
            />{" "}
            Prevailing wage
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="bidBondRequired"
              defaultChecked={v.bidBondRequired}
            />{" "}
            Bid bond required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="perfBondRequired"
              defaultChecked={v.perfBondRequired}
            />{" "}
            Performance / payment bond
          </label>
          <Field label="Retainage %">
            <Input
              name="retainagePct"
              inputMode="decimal"
              defaultValue={v.retainagePct ?? ""}
              placeholder="Per contract"
            />
          </Field>
        </fieldset>
      )}

      {!res && (
        <Field label="Bid due">
          <Input
            name="bidDueDate"
            type="date"
            defaultValue={v.bidDueDate ?? ""}
          />
        </Field>
      )}
      <Field label="Old AccuLynx job # (imported jobs)">
        <Input
          name="acculynxJobNumber"
          defaultValue={v.acculynxJobNumber ?? ""}
        />
      </Field>
      <Field label="Lead source">
        <Input
          name="leadSource"
          defaultValue={v.leadSource ?? ""}
          list={`lead-sources-${market}`}
        />
        <datalist id={`lead-sources-${market}`}>
          {MARKET_DEFAULTS[market].leadSources.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Salesperson">
          <UserSelect
            name="salespersonId"
            users={users}
            value={v.salespersonId}
          />
        </Field>
        <Field label="Estimator">
          <UserSelect name="estimatorId" users={users} value={v.estimatorId} />
        </Field>
      </div>
      {showContract && (
        <>
          <Field label="Contract amount">
            <Input
              name="contractAmount"
              inputMode="decimal"
              defaultValue={v.contractAmount ?? ""}
              placeholder="Set when sold"
            />
          </Field>
          <Field label="Contract signed">
            <Input
              name="contractSignedAt"
              type="date"
              defaultValue={v.contractSignedAt ?? ""}
            />
          </Field>
        </>
      )}
      {isNew && (
        <fieldset className="grid gap-3 rounded-lg border border-btr-line p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Lead details</legend>
          <Field label="Priority">
            <Select name="priority" defaultValue="NORMAL">
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </Select>
          </Field>
          <Field label="First appointment (optional)">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <Input name="apptDate" type="date" aria-label="Appointment date" />
              <Input name="apptStart" type="time" aria-label="Start time" className="w-28" />
              <Input name="apptEnd" type="time" aria-label="End time" className="w-28" />
            </div>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <textarea name="notes" rows={3} maxLength={1000} placeholder="What the customer asked for, gate code, best time to call…" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The appointment goes on the schedule and on the salesperson&apos;s My day; notes go in the job&apos;s team chat.
          </p>
        </fieldset>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        {state?.ok && (
          <span className="text-sm text-green-700 dark:text-green-400">
            Saved.
          </span>
        )}
      </div>
      <Problems state={state} className="sm:col-span-2" />
    </form>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function UserSelect({
  name,
  users,
  value,
}: {
  name: string;
  users: Opt[];
  value?: string | null;
}) {
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
