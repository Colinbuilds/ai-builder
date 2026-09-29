"use client";

import Link from "next/link";
import { useFormAction } from "@/components/use-form-action";
import { createCompanyAction, createContactAction, type CustomerResult } from "../actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

function Dups({ state }: { state: CustomerResult }) {
  if (!state?.problems.length) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {state.problems.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {state.duplicates && (
        <ul className="mt-1 list-disc pl-5">
          {state.duplicates.map((d) => (
            <li key={d.id}>
              <Link href={d.href} className="underline">
                {d.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TYPES = ["GC", "OWNER", "PROPERTY_MANAGER", "PUBLIC_AGENCY", "ARCHITECT", "SUBCONTRACTOR", "SUPPLIER", "OTHER"];

export function CompanyForm() {
  const [state, action, pending] = useFormAction(createCompanyAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <Input name="name" placeholder="Company name" required />
      <Select name="type" defaultValue="GC">
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ").toLowerCase()}
          </option>
        ))}
      </Select>
      <Input name="phone" placeholder="Phone" />
      <Input name="email" type="email" placeholder="Email" />
      <Input name="address" placeholder="Address" />
      <Input name="notes" placeholder="Notes" />
      <Dups state={state} />
      {state?.duplicates && <input type="hidden" name="confirmDuplicate" value="1" />}
      <Button disabled={pending}>{state?.duplicates ? "Save anyway" : "Save company"}</Button>
    </form>
  );
}

export function ContactForm({ companies, companyId, returnTo }: { companies: { id: string; name: string }[]; companyId?: string; returnTo?: string }) {
  const [state, action, pending] = useFormAction(createContactAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <div className="grid grid-cols-2 gap-2">
        <Input name="firstName" placeholder="First name" required />
        <Input name="lastName" placeholder="Last name" required />
      </div>
      <Select name="companyId" defaultValue={companyId ?? ""}>
        <option value="">Homeowner / no company</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Input name="title" placeholder="Title (PM, superintendent…)" />
      <Input name="phone" placeholder="Phone" />
      <Input name="email" type="email" placeholder="Email" />
      <Input name="address" placeholder="Address (homeowners)" />
      <Input name="notes" placeholder="Notes" />
      <Dups state={state} />
      {state?.duplicates && <input type="hidden" name="confirmDuplicate" value="1" />}
      <Button disabled={pending}>{state?.duplicates ? "Save anyway" : "Save contact"}</Button>
    </form>
  );
}
