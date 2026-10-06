"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { requestDemo } from "@/app/actions";
import { TRADES } from "@/lib/trades";

export function DemoForm({ users }: { users?: number }) {
  const [state, action, pending] = useActionState(requestDemo, null);
  if (state?.ok)
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <CheckCircle2 className="mx-auto text-ok" size={36} />
        <h2 className="mt-3 text-xl font-semibold">Got it — we&apos;ll be in touch within one business day.</h2>
        <p className="mt-2 text-muted">We&apos;ll set up a demo around your kind of jobs.</p>
      </div>
    );
  return (
    <form action={action} className="grid gap-4 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-2">
      <Field label="Your name" name="name" autoComplete="name" required />
      <Field label="Company" name="company" autoComplete="organization" required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Phone (optional)" name="phone" type="tel" autoComplete="tel" />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Trade
        <select name="trade" required defaultValue="" className="field">
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
      <Field label="People who'd sign in" name="users" type="number" min={1} defaultValue={users ? String(users) : ""} />
      <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
        What would you like Joblight to handle? (optional)
        <textarea name="message" rows={4} className="field h-auto py-2" placeholder="e.g. We lose track of quotes, and invoicing takes my whole Friday." />
      </label>
      {/* honeypot: people don't see it, bots fill it */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state?.error && <p className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      <button className="btn sm:col-span-2" disabled={pending}>
        {pending ? "Sending…" : "Request my demo"}
      </button>
    </form>
  );
}

function Field({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input {...p} className="field" />
    </label>
  );
}
