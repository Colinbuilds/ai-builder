"use client";

import { useFormAction } from "@/components/use-form-action";
import { saveCompanySettingsAction } from "@/app/proposal-actions";
import type { CompanySettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function CompanySettingsForm({ s }: { s: CompanySettings }) {
  const [state, action, pending] = useFormAction(saveCompanySettingsAction, null);
  const field = (name: keyof CompanySettings, label: string, hint: string) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input name={name} defaultValue={(s[name] as number | null) ?? ""} inputMode="decimal" className="w-32" />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
  return (
    <form onSubmit={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("markupPct", "Default markup %", "Applied to estimate cost (+ tax) to get the proposal price. Can be changed per proposal.")}
        {field("salesTaxPct", "Sales tax % on materials", "Skipped on tax-exempt jobs. Leave blank if tax is carried in your costs.")}
        {field("depositPct", "Deposit %", "Shown on proposals as due at signing.")}
        {field("proposalValidDays", "Proposal valid for (days)", "After this the customer can't sign.")}
      </div>
      <div className="flex flex-col gap-1">
        <Label>Proposal terms</Label>
        <textarea name="proposalTerms" defaultValue={s.proposalTerms ?? ""} rows={10} className="rounded-md border border-input bg-background p-2 text-sm" placeholder="Payment terms, change-order policy, schedule, insurance, lien rights, cancellation…" />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Warranty</Label>
        <textarea name="warrantyText" defaultValue={s.warrantyText ?? ""} rows={4} className="rounded-md border border-input bg-background p-2 text-sm" placeholder="Workmanship warranty and manufacturer warranty language" />
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={pending}>Save</Button>
        {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
      </div>
      <Problems state={state} />
    </form>
  );
}
