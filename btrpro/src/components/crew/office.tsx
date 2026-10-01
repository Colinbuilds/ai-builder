"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { crewLoginSetAction, reviewCrewInvoiceAction, reviewPhotoAction, staffPhotosAction } from "@/app/crews/crew-portal-actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function CrewLoginPanel({ crewId, email, on, lastLogin, admin }: { crewId: string; email: string | null; on: boolean; lastLogin: string | null; admin: boolean }) {
  const [state, action, pending] = useFormAction(crewLoginSetAction, null);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-btr-line p-4 text-sm">
      <h2 className="font-semibold">Crew portal login</h2>
      <p className="text-muted-foreground">
        The crew signs in at <span className="font-mono">/crew</span> on this site. All they can do there is send invoices and job photos (before, during, finished, cleanup) for jobs they&apos;re
        scheduled on. Finished and cleanup photos are required before they can invoice.
      </p>
      <p>
        {on ? (
          <>
            Login on for <span className="font-medium">{email}</span>
            {lastLogin ? ` · last signed in ${lastLogin}` : " · hasn't signed in yet"}
          </>
        ) : (
          "No login yet."
        )}
      </p>
      {admin ? (
        <form onSubmit={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="crewId" value={crewId} />
          <label className="flex flex-col gap-1">
            Email
            <Input name="email" type="email" defaultValue={email ?? ""} className="w-64" />
          </label>
          <label className="flex flex-col gap-1">
            {on ? "New password" : "Password"}
            <Input name="password" type="text" autoComplete="off" placeholder="8+ characters" className="w-48" />
          </label>
          <Button size="sm" disabled={pending}>
            {on ? "Change password" : "Turn on login"}
          </Button>
          {on && (
            <Button size="sm" variant="outline" name="off" value="1" disabled={pending}>
              Turn off
            </Button>
          )}
          {state?.ok && <span className="w-full text-btr-blue">{state.note}</span>}
          <Problems state={state} className="w-full" />
        </form>
      ) : (
        <p className="text-muted-foreground">An Admin sets crew logins.</p>
      )}
    </section>
  );
}

export function InvoiceReview({ id }: { id: string }) {
  const [state, action, pending] = useFormAction(reviewCrewInvoiceAction, null);
  const [back, setBack] = useState(false);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {back ? (
        <>
          <Input name="note" placeholder="Why it's going back to the crew" className="w-64" required />
          <Button size="sm" variant="outline" name="decision" value="REJECTED" disabled={pending}>
            Send back
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setBack(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" name="decision" value="APPROVED" disabled={pending}>
            {pending ? "Saving…" : "Approve into job costs"}
          </Button>
          <Button size="sm" variant="outline" type="button" onClick={() => setBack(true)}>
            Send back…
          </Button>
        </>
      )}
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function PhotoReview({ id, review, note }: { id: string; review: string; note: string | null }) {
  const [state, action, pending] = useFormAction(reviewPhotoAction, null);
  const [flag, setFlag] = useState(false);
  return (
    <form onSubmit={action} className="flex flex-col gap-1 text-xs">
      <input type="hidden" name="id" value={id} />
      {review !== "PENDING" && !flag && (
        <span className={review === "ISSUE" ? "font-semibold" : "text-btr-blue"}>{review === "ISSUE" ? `Issue: ${note}` : "Checked OK"}</span>
      )}
      {flag ? (
        <span className="flex gap-1">
          <input name="note" placeholder="Quality or cleanup issue" required className="min-w-0 flex-1 rounded border px-1.5 py-1" />
          <button name="review" value="ISSUE" disabled={pending} className="rounded bg-btr-black px-2 text-white">
            Flag
          </button>
        </span>
      ) : (
        <span className="flex gap-2">
          {review !== "OK" && (
            <button name="review" value="OK" disabled={pending} className="text-btr-link hover:underline">
              OK
            </button>
          )}
          <button type="button" onClick={() => setFlag(true)} className="text-muted-foreground hover:underline">
            Flag issue
          </button>
        </span>
      )}
      <Problems state={state} />
    </form>
  );
}

export function StaffPhotoUpload({ projectId, stages }: { projectId: string; stages: [string, string][] }) {
  const [state, action, pending] = useFormAction(staffPhotosAction, null, { resetOnOk: true });
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="projectId" value={projectId} />
      <Select name="stage" defaultValue="PROGRESS">
        {stages.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
      <input name="photos" type="file" accept="image/*" multiple className="text-sm" />
      <Button size="sm" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add photos"}
      </Button>
      {state?.ok && <span className="text-btr-blue">{state.note}</span>}
      <Problems state={state} className="w-full" />
    </form>
  );
}
