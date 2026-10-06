"use client";

import { useActionState } from "react";
import type { Buildout } from "@prisma/client";
import { saveBuildout } from "@/app/console/actions";
import { TRADES } from "@/lib/trades";
import { monthlyFor, usd } from "@/lib/pricing";

type Prefill = Partial<Pick<Buildout, "company" | "trade" | "users" | "ownerName" | "ownerEmail" | "notes">> & { leadId?: string };

export function BuildoutForm({ b, prefill }: { b?: Buildout; prefill?: Prefill }) {
  const [state, action, pending] = useActionState(saveBuildout, null);
  const v = { ...prefill, ...b };
  const users = v.users ?? 1;
  const std = users <= 20 ? monthlyFor(users) : null;
  return (
    <form action={action} className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
      {b && <input type="hidden" name="id" value={b.id} />}
      {prefill?.leadId && <input type="hidden" name="leadId" value={prefill.leadId} />}
      <F label="Company" name="company" defaultValue={v.company ?? ""} required />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Trade
        <select name="trade" defaultValue={v.trade ?? ""} required className="field">
          <option value="" disabled>
            Pick one
          </option>
          {TRADES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Status
        <select name="status" defaultValue={b?.status ?? "ONBOARDING"} className="field">
          <option value="ONBOARDING">Onboarding</option>
          <option value="LIVE">Live (billing)</option>
          <option value="PAUSED">Paused</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </label>
      <F label="Users" name="users" type="number" min={1} defaultValue={String(users)} hint={std != null ? `Standard rate: ${usd(std)}/month` : "Over 20: set the agreed monthly rate"} />
      <F label="Agreed monthly rate (blank = standard)" name="customMonthly" defaultValue={b?.customMonthly != null ? String(b.customMonthly) : ""} />
      <F label="Setup fee" name="setupFee" defaultValue={b?.setupFee != null ? String(b.setupFee) : ""} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="setupPaid" defaultChecked={b?.setupPaid ?? false} /> Setup fee paid
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="protected" defaultChecked={b?.protected ?? false} /> Protected (never in bulk actions)
      </label>
      <F label="Public address" name="url" placeholder="https://acme.joblight.net" defaultValue={b?.url ?? ""} />
      <F label="Private address (Railway)" name="internalUrl" placeholder="http://acme.railway.internal:3000" defaultValue={b?.internalUrl ?? ""} hint="Health checks use this when set." />
      <F label="Railway service" name="railwayService" defaultValue={b?.railwayService ?? ""} />
      <F label="Deploys from branch" name="branch" defaultValue={b?.branch ?? ""} />
      <F label="Owner name" name="ownerName" defaultValue={v.ownerName ?? ""} />
      <F label="Owner email" name="ownerEmail" type="email" defaultValue={v.ownerEmail ?? ""} />
      <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
        Notes
        <textarea name="notes" rows={3} defaultValue={v.notes ?? ""} className="field h-auto py-2" />
      </label>
      {state?.error && <p className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      {state?.ok && <p className="text-sm text-ok sm:col-span-2">Saved.</p>}
      <button className="btn sm:col-span-2" disabled={pending}>
        {pending ? "Saving…" : b ? "Save" : "Create buildout"}
      </button>
    </form>
  );
}

function F({ label, hint, ...p }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input {...p} className="field" />
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}
