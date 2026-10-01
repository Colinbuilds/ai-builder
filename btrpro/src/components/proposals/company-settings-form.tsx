"use client";

import { useFormAction } from "@/components/use-form-action";
import { saveCompanySettingsAction } from "@/app/proposal-actions";
import type { CompanySettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function CompanySettingsForm({ s }: { s: CompanySettings }) {
  const [state, action, pending] = useFormAction(
    saveCompanySettingsAction,
    null,
  );
  const field = (name: keyof CompanySettings, label: string, hint: string) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input
        name={name}
        defaultValue={(s[name] as number | null) ?? ""}
        inputMode="decimal"
        className="w-32"
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
  return (
    <form onSubmit={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field(
          "markupPct",
          "Default markup %",
          "Applied to estimate cost (+ tax) to get the proposal price. Can be changed per proposal.",
        )}
        {field(
          "salesTaxPct",
          "Sales tax % on materials",
          "Skipped on tax-exempt jobs. Leave blank if tax is carried in your costs.",
        )}
        {field(
          "depositPct",
          "Deposit %",
          "Shown on proposals as due at signing.",
        )}
        {field(
          "proposalValidDays",
          "Proposal valid for (days)",
          "After this the customer can't sign.",
        )}
        {field(
          "overheadPct",
          "Company overhead % of revenue",
          "Used for net profit on job P&Ls. Net profit shows MISSING until this is set.",
        )}
        {field(
          "costVarianceThresholdPct",
          "Flag costs over estimate by %",
          "A job-cost category gets a red flag when it runs this far over its estimate.",
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field(
          "invoiceNetDays",
          "Invoices due in (days)",
          "Due date = issue date + this. Blank = due on receipt.",
        )}
        {field(
          "iceWaterEavesFt",
          "Ice & water at eaves (FT wide)",
          "Company standard. Used on shingle takeoffs with the job's confirmed eaves LF when no rows are entered on the estimate. Blank = enter per job.",
        )}
        {field(
          "iceWaterValleysFt",
          "Ice & water in valleys (FT wide)",
          "Company standard for valleys, with the job's confirmed valleys LF. Blank = enter per job.",
        )}
        {field(
          "receiptMarkupPct",
          "Receipt markup %",
          "Billed on materials from receipts (change orders and invoices). Blank = 15%. Can be changed per receipt or line.",
        )}
        {field(
          "takeoffAllowancePct",
          "Plan takeoff allowance %",
          "Added on top of traced plan measurements so they land slightly over, never under. Blank = 1%. Waste is separate.",
        )}
        {field(
          "cardSurchargePct",
          "Card surcharge %",
          "Added to card payments only, where permitted (up to 3%). Blank = none.",
        )}
      </div>
      <fieldset className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">QuickBooks Online (only used once QuickBooks is connected)</legend>
        {(
          [
            ["qboItemId", "Item for invoice & estimate lines", "The QuickBooks product/service id lines are booked to (e.g. Roofing Services)."],
            ["qboExpenseAccountId", "Expense account for receipts", "Account id for job materials (cost of goods sold)."],
            ["qboPaymentAccountId", "Receipts paid from", "Account id of the credit card, bank, or A/P account the receipts were paid with."],
          ] as const
        ).map(([name, label, hint]) => (
          <div key={name} className="flex flex-col gap-1">
            <Label>{label}</Label>
            <Input name={name} defaultValue={(s[name] as string | null) ?? ""} placeholder="QuickBooks id, e.g. 42" />
            <span className="text-xs text-muted-foreground">{hint}</span>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label>How to pay (printed on invoices)</Label>
        <textarea
          name="remitTo"
          defaultValue={s.remitTo ?? ""}
          rows={3}
          className="rounded-md border border-input bg-background p-2 text-sm"
          placeholder="Make checks payable to BTR Contracting, 10852 Hanover St., Omaha, NE 68142. ACH details on request."
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>ABC branch order email</Label>
        <Input
          name="supplierOrderEmail"
          type="email"
          defaultValue={s.supplierOrderEmail ?? ""}
          className="w-80"
          placeholder="Branch #112 order desk"
        />
        <span className="text-xs text-muted-foreground">
          Material orders are emailed here. Leave blank to send orders yourself
          and mark them sent.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Proposal terms</Label>
        <textarea
          name="proposalTerms"
          defaultValue={s.proposalTerms ?? ""}
          rows={10}
          className="rounded-md border border-input bg-background p-2 text-sm"
          placeholder="Payment terms, change-order policy, schedule, insurance, lien rights, cancellation…"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Warranty</Label>
        <textarea
          name="warrantyText"
          defaultValue={s.warrantyText ?? ""}
          rows={4}
          className="rounded-md border border-input bg-background p-2 text-sm"
          placeholder="Workmanship warranty and manufacturer warranty language"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={pending}>Save</Button>
        {state?.ok && (
          <span className="text-sm text-green-700 dark:text-green-400">
            Saved.
          </span>
        )}
      </div>
      <Problems state={state} />
    </form>
  );
}
