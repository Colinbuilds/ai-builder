"use client";

import { useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  companyCamAction,
  crewLinkAction,
  crewLogAction,
  crewTicketAction,
  eagleViewOrderAction,
  revokePortalAction,
  sharePortalAction,
} from "@/app/projects/portal-actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

function Copy({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        readOnly
        value={url}
        className="h-8 max-w-md font-mono text-xs"
        onFocus={(e) => e.target.select()}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(() => setDone(true));
        }}
      >
        {done ? "Copied" : "Copy"}
      </Button>
      <a href={url} target="_blank" className="text-xs underline">
        Open
      </a>
    </span>
  );
}

export function PortalCard({
  projectId,
  url,
  contactEmail,
}: {
  projectId: string;
  url: string | null;
  contactEmail: string | null;
}) {
  const [state, action, pending] = useFormAction(sharePortalAction, null);
  const link = state?.url ?? url;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-semibold">Customer portal</h2>
      <p className="text-muted-foreground">
        One link for the customer: proposal, schedule, change orders, invoices
        and payments. No costs or internal notes.
      </p>
      {link && <Copy url={link} />}
      <form onSubmit={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        {!link && (
          <Button
            size="sm"
            variant="outline"
            name="email"
            value="0"
            disabled={pending}
          >
            Make link
          </Button>
        )}
        {contactEmail && (
          <Button
            size="sm"
            variant="outline"
            name="email"
            value="1"
            disabled={pending}
          >
            Email it to {contactEmail}
          </Button>
        )}
      </form>
      {state?.note && (
        <p className="text-xs text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
      {link && (
        <form action={revokePortalAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <button className="text-xs text-muted-foreground underline">
            Turn off this link
          </button>
        </form>
      )}
    </div>
  );
}

export function CrewLink({
  crewId,
  url,
}: {
  crewId: string;
  url: string | null;
}) {
  const [state, action, pending] = useFormAction(crewLinkAction, null);
  const link = state?.url ?? url;
  return (
    <section className="flex flex-col gap-2 rounded-md border p-4 text-sm">
      <h2 className="font-semibold">Crew phone link</h2>
      <p className="text-muted-foreground">
        The crew&apos;s own page: this week&apos;s jobs with addresses, their
        work orders, logging hours or piece work, and delivery-ticket photos. No
        sign-in; text it to the crew lead.
      </p>
      {link && <Copy url={link} />}
      <form onSubmit={action} className="flex gap-2">
        <input type="hidden" name="crewId" value={crewId} />
        {!link ? (
          <Button size="sm" variant="outline" disabled={pending}>
            Make link
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            name="rotate"
            value="1"
            disabled={pending}
          >
            Make a new link (old one stops working)
          </Button>
        )}
      </form>
      {state?.note && (
        <p className="text-xs text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
    </section>
  );
}

export function CompanyCamLink({
  projectId,
  current,
}: {
  projectId: string;
  current: string | null;
}) {
  const [state, action, pending] = useFormAction(companyCamAction, null);
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Input
        name="link"
        defaultValue={
          current ? `https://app.companycam.com/projects/${current}` : ""
        }
        placeholder="CompanyCam project link"
        className="h-8 max-w-md"
      />
      <Button size="sm" variant="outline" disabled={pending}>
        {current ? "Update" : "Link"}
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function EagleViewOrder({
  projectId,
  reportId,
  orderedAt,
}: {
  projectId: string;
  reportId: string | null;
  orderedAt: string | null;
}) {
  const [state, action, pending] = useFormAction(eagleViewOrderAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-sm text-muted-foreground">
        {orderedAt
          ? `Ordered ${orderedAt}${reportId ? ` · report #${reportId}` : ""}. Upload the PDF here when it arrives.`
          : "Order the report in EagleView, then record it here so the job shows it's on the way."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="reportId"
          defaultValue={reportId ?? ""}
          placeholder="EagleView report # (optional)"
          className="h-8 w-56"
        />
        <Button size="sm" variant="outline" disabled={pending}>
          {orderedAt ? "Update" : "Mark ordered"}
        </Button>
        <a
          href="https://www.eagleview.com/"
          target="_blank"
          className="text-xs underline"
        >
          Open EagleView
        </a>
      </div>
      {state?.note && (
        <p className="text-xs text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
    </form>
  );
}

export function CrewLogForm({
  token,
  jobs,
  piece,
  unit,
  today,
}: {
  token: string;
  jobs: { id: string; name: string }[];
  piece: boolean;
  unit: string | null;
  today: string;
}) {
  const [state, action, pending] = useFormAction(crewLogAction, null, {
    resetOnOk: true,
  });
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <select
        name="projectId"
        required
        className="h-10 rounded-md border bg-background px-2 text-base"
        defaultValue={jobs.length === 1 ? jobs[0].id : ""}
      >
        <option value="" disabled>
          Which job?
        </option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label>Date</Label>
          <Input
            type="date"
            name="date"
            defaultValue={today}
            className="h-10 text-base"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>
            {piece ? `${unit ?? "Qty"} done` : "Crew hours (total)"}
          </Label>
          <Input
            name="amount"
            inputMode="decimal"
            className="h-10 text-base"
            required
          />
        </div>
      </div>
      <Input
        name="note"
        placeholder="Note (optional)"
        className="h-10 text-base"
      />
      <Button disabled={pending}>
        {pending ? "Sending…" : piece ? "Log work" : "Log hours"}
      </Button>
      {state?.ok && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
    </form>
  );
}

export function CrewTicketForm({
  token,
  jobs,
}: {
  token: string;
  jobs: { id: string; name: string }[];
}) {
  const [state, action, pending] = useFormAction(crewTicketAction, null, {
    resetOnOk: true,
  });
  return (
    <form onSubmit={action} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <select
        name="projectId"
        required
        className="h-10 rounded-md border bg-background px-2 text-base"
        defaultValue={jobs.length === 1 ? jobs[0].id : ""}
      >
        <option value="" disabled>
          Which job?
        </option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </select>
      <input
        type="file"
        name="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="text-base"
      />
      <Button variant="outline" disabled={pending}>
        {pending ? "Uploading…" : "Upload ticket"}
      </Button>
      {state?.ok && (
        <p className="text-sm text-green-700 dark:text-green-400">
          {state.note}
        </p>
      )}
      <Problems state={state} />
    </form>
  );
}
