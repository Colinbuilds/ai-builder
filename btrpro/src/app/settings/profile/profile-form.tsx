"use client";

import { useFormAction } from "@/components/use-form-action";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";
import { saveProfileAction } from "./actions";

type Current = Record<string, unknown> & { proposalAddress: string[]; ownAddresses: string[]; supplier: { name: string; address: string; phone: string; surchargeNote: string } };

export function ProfileForm(props: {
  saved: Record<string, unknown>;
  current: Current;
  hasLogo: boolean;
  states: { code: string; name: string; lienDays: number | null; form: string | null }[];
  region: { name: string; lien: string | null; form: string | null };
  rules: string;
  rulesSaved: boolean;
}) {
  const [state, action, pending] = useFormAction(saveProfileAction, null);
  const { saved, current } = props;
  const sup = (saved.supplier ?? {}) as Record<string, string>;
  const val = (k: string) => (typeof saved[k] === "string" || typeof saved[k] === "number" ? String(saved[k]) : "");
  const field = (name: string, label: string, placeholder: string, hint?: string, w = "w-full") => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input name={name} defaultValue={val(name)} placeholder={placeholder} className={w} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
  const area = (name: string, label: string, value: string, placeholder: string, rows = 3, hint?: string) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <textarea name={name} defaultValue={value} placeholder={placeholder} rows={rows} className="rounded-md border border-input bg-background p-2 text-sm" />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
  return (
    <form onSubmit={action} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Names</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("name", "Company name", String(current.name), "On proposals, invoices, emails and customer pages.")}
          {field("shortName", "Short name", String(current.shortName), "Used in copy like “BTR standard price”.")}
          {field("productName", "App name", String(current.productName), "Top bar, page titles, PDFs.")}
          {field("assistantName", "AI assistant name", String(current.assistantName))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Contact &amp; letterhead</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("address", "Address", String(current.address))}
          {field("phone", "Phone", String(current.phone))}
          {field("email", "Email", String(current.email), "Reply-to on proposals.")}
          {field("officePhone", "Office phone (proposal letterhead)", String(current.officePhone))}
          {area("proposalAddress", "Proposal letterhead address (one line each)", Array.isArray(saved.proposalAddress) ? (saved.proposalAddress as string[]).join("\n") : "", current.proposalAddress.join("\n"), 2)}
          {area("ownAddresses", "Own addresses (office, shop, bill-to; one per line)", Array.isArray(saved.ownAddresses) ? (saved.ownAddresses as string[]).join("\n") : "", current.ownAddresses.join("\n"), 3, "Receipt matching ignores material shipped to these.")}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Primary supplier</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Supplier</Label>
            <Input name="supplierName" defaultValue={sup.name ?? ""} placeholder={current.supplier.name} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Supplier address</Label>
            <Input name="supplierAddress" defaultValue={sup.address ?? ""} placeholder={current.supplier.address} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Supplier phone</Label>
            <Input name="supplierPhone" defaultValue={sup.phone ?? ""} placeholder={current.supplier.phone} />
          </div>
          {field("abcAccount", "Your account number with them", String(current.abcAccount), "Price sheets issued to another account get a warning.")}
        </div>
        <div className="flex flex-col gap-1">
          <Label>Card surcharge note (on estimates)</Label>
          <Input name="supplierNote" defaultValue={sup.surchargeNote ?? ""} placeholder={current.supplier.surchargeNote} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">State rules</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("state", "State (two letters)", String(current.state), undefined, "w-24")}
          {field("jurisdiction", "Home jurisdiction (codes)", String(current.jurisdiction))}
          {field("lienDays", "Lien deadline (days)", props.region.lien ? props.region.lien.split(" ")[0] : "MISSING", "Blank = the state's rule.", "w-28")}
        </div>
        <p className="text-xs text-muted-foreground">
          Now: {props.region.name} · lien {props.region.lien ?? "MISSING — set the days above"} · tax-exempt public jobs: {props.region.form ?? "no state form on file"}. States with built-in rules:{" "}
          {props.states.map((s) => `${s.name} (${s.lienDays ?? "?"} days, ${s.form ?? "no form"})`).join(", ")}. Other states start with nothing assumed.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Branding</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("brandColor", "Accent color", "#1f6fd1 (BTR blue)", "Buttons and links. #rrggbb.", "w-40")}
          {field("headerColor", "Top bar color", "#0e0f11 (BTR black)", "#rrggbb.", "w-40")}
          <div className="flex flex-col gap-1">
            <Label>Logo (PNG or JPEG, under 2 MB)</Label>
            <input type="file" name="logo" accept="image/png,image/jpeg" className="text-sm" />
            <span className="text-xs text-muted-foreground">Top bar and proposal PDFs. {props.hasLogo ? "A logo is uploaded." : "None — the BTR logo is used."}</span>
            {props.hasLogo && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="removeLogo" /> Remove the uploaded logo
              </label>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Estimating rules for the AI</h2>
        {area(
          "aiRules",
          "Company rules (company context, price sheets, locked takeoff rules, waste defaults, communication style)",
          props.rules,
          "e.g. Default shingle: … · Waste: roofing 5%, siding 5% · Always include … · Never …",
          18,
          props.rulesSaved
            ? "Saved rules are used with the general estimating rules. Clear the box to go back to the built-in rules."
            : "Not saved yet: the built-in rules are in use (BTR's CLAUDE.md, shown above for BTR). Edit and save to use your own. Saving it unchanged keeps the built-in rules.",
        )}
      </section>

      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
        {state?.ok && <span className="text-sm text-green-700">Saved.</span>}
      </div>
      <Problems state={state} />
    </form>
  );
}
