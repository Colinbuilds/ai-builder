"use client";

import { useFormAction } from "@/components/use-form-action";
import { saveBuilderAction } from "@/app/builder-actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

type B = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  abcAccount: string | null;
  sheetPrefix: string | null;
  pricingFallback: string | null;
  poRequired: boolean;
  standardSpecs: string | null;
  billingTerms: string | null;
  notes: string | null;
};
const ta = "rounded-md border border-input bg-background p-2 text-sm";

export function BuilderForm({
  b,
  lockPrefix,
}: {
  b?: B;
  lockPrefix?: boolean;
}) {
  const [state, action, pending] = useFormAction(saveBuilderAction, null);
  const f = (
    name: keyof B,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input
        name={name}
        defaultValue={(b?.[name] as string) ?? ""}
        {...props}
      />
    </div>
  );
  return (
    <form onSubmit={action} className="flex flex-col gap-4">
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {f("name", "Builder name", {
          required: true,
          placeholder: "Legacy Homes",
        })}
        {f("phone", "Phone", { type: "tel" })}
        {f("email", "Email (billing / purchasing)", { type: "email" })}
        {f("address", "Office address")}
        {f("website", "Website")}
        {f("abcAccount", "ABC account / pricing agreement #", {
          placeholder: "their ABC account #",
        })}
      </div>
      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Pricing</legend>
        <div className="flex flex-col gap-1">
          <Label>Sheet prefix</Label>
          <Input
            name="sheetPrefix"
            defaultValue={b?.sheetPrefix ?? ""}
            placeholder="LEG"
            maxLength={4}
            className="w-28 uppercase"
            readOnly={lockPrefix}
          />
          <span className="text-xs text-muted-foreground">
            2–4 letters. Their sheets are coded with it (LEG-SS, LEG-HP…).{" "}
            {lockPrefix && "Locked: sheets already use it."}
          </span>
        </div>
        <p className="text-sm font-medium">
          When an item isn&apos;t on this builder&apos;s pricing:
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="pricingFallback"
            value="STANDARD"
            defaultChecked={b?.pricingFallback === "STANDARD"}
            required
          />
          <span>
            Use BTR&apos;s standard ABC price, and flag the line &quot;not on
            builder pricing&quot;
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="pricingFallback"
            value="MISSING"
            defaultChecked={b?.pricingFallback === "MISSING"}
          />
          <span>
            Leave it MISSING until the builder price is on their sheet
          </span>
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>Standard specs</Label>
          <textarea
            name="standardSpecs"
            rows={4}
            defaultValue={b?.standardSpecs ?? ""}
            className={ta}
            placeholder="Shingle line and color, underlayment, drip edge color, vents, siding profile…"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Billing terms / how they pay</Label>
          <textarea
            name="billingTerms"
            rows={4}
            defaultValue={b?.billingTerms ?? ""}
            className={ta}
            placeholder="Net 30 after lot completion, invoice portal, lien waivers…"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="poRequired"
          defaultChecked={b?.poRequired}
        />{" "}
        Builder PO number required on every job / invoice
      </label>
      <div className="flex flex-col gap-1">
        <Label>Notes</Label>
        <textarea
          name="notes"
          rows={3}
          defaultValue={b?.notes ?? ""}
          className={ta}
          placeholder="Superintendents, lot access rules, walk-through process…"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={pending}>{b ? "Save" : "Add builder"}</Button>
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
