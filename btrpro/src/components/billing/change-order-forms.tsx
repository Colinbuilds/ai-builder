"use client";

import { useEffect, useRef, useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import {
  coFromEstimateAction,
  declineCoAction,
  importCoAction,
  sendCoAction,
  signCoAction,
} from "@/app/projects/billing-actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

export function CoFromEstimate({
  projectId,
  estimates,
  defaultMarkup,
}: {
  projectId: string;
  estimates: { id: string; label: string }[];
  defaultMarkup: number | null;
}) {
  const [state, action, pending] = useFormAction(coFromEstimateAction, null, {
    resetOnOk: true,
  });
  if (!estimates.length)
    return (
      <p className="text-xs text-muted-foreground">
        To price a change order, start a separate estimate for the change (e.g.
        &quot;CO-2 extra layer&quot;) on the Estimates tab.
      </p>
    );
  return (
    <form
      onSubmit={action}
      className="flex flex-col gap-2 rounded-md border p-3"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <h3 className="text-sm font-semibold">
        Price a change order from an estimate
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          name="estimateId"
          className="h-8 max-w-xs"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Estimate for the change…
          </option>
          {estimates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
        <Select name="kind" className="h-8">
          <option value="CHANGE_ORDER">Change order</option>
          <option value="SUPPLEMENT">Insurance supplement</option>
        </Select>
        <Input
          name="markupPct"
          placeholder={
            defaultMarkup != null ? `markup ${defaultMarkup}%` : "markup %"
          }
          inputMode="decimal"
          className="h-8 w-28"
        />
      </div>
      <Input
        name="description"
        placeholder="What changed, as the customer will read it"
        className="h-8"
        required
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>
          {pending ? "Pricing…" : "Create change order"}
        </Button>
        {state?.ok && (
          <span className="text-xs text-green-700 dark:text-green-400">
            {state.note}
          </span>
        )}
      </div>
      <Problems state={state} />
    </form>
  );
}

export function SendCo({ id, email }: { id: string; email: string | null }) {
  const [state, action, pending] = useFormAction(sendCoAction, null);
  const [open, setOpen] = useState(false);
  if (state?.ok)
    return (
      <p className="text-xs text-green-700 dark:text-green-400">
        {state.note}{" "}
        <a className="underline" href={state.url} target="_blank">
          Signing link
        </a>
      </p>
    );
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Send for signature
      </Button>
    );
  return (
    <form onSubmit={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="name" placeholder="Name" className="h-8 w-36" />
      <Input
        name="email"
        type="email"
        defaultValue={email ?? ""}
        placeholder="Email"
        className="h-8 w-48"
      />
      <Button size="sm" disabled={pending}>
        Send
      </Button>
      <Problems state={state} className="w-full" />
    </form>
  );
}

export function ImportCo({ projectId }: { projectId: string }) {
  const [state, action, pending] = useFormAction(importCoAction, null);
  return (
    <form
      onSubmit={action}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <span>Import from</span>
      <Select name="source" className="h-8">
        <option>Buildertrend</option>
        <option>Procore</option>
      </Select>
      <input type="file" name="file" accept=".csv" className="text-xs" />
      <Button size="sm" variant="outline" disabled={pending}>
        Import CSV
      </Button>
      {state?.ok && (
        <span className="text-xs text-green-700 dark:text-green-400">
          {state.note}
        </span>
      )}
      <Problems state={state} className="w-full" />
    </form>
  );
}

/** Finger/mouse signature → PNG data URL in a hidden input. */
function SignaturePad({ name }: { name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [sig, setSig] = useState("");
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [
        ((e.clientX - r.left) * c.width) / r.width,
        ((e.clientY - r.top) * c.height) / r.height,
      ] as const;
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      ctx.beginPath();
      ctx.moveTo(...pos(e));
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      ctx.lineTo(...pos(e));
      ctx.stroke();
    };
    const up = () => {
      if (drawing.current) setSig(c.toDataURL("image/png"));
      drawing.current = false;
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);
  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name={name} value={sig} />
      <Label>
        Signature (draw with your finger or mouse, optional — your typed name
        also signs)
      </Label>
      <canvas
        ref={canvas}
        width={600}
        height={150}
        className="h-32 w-full max-w-xl touch-none rounded-md border bg-white"
      />
      <button
        type="button"
        className="self-start text-xs underline"
        onClick={() => {
          canvas.current!.getContext("2d")!.clearRect(0, 0, 600, 150);
          setSig("");
        }}
      >
        Clear
      </button>
    </div>
  );
}

export function CoSignForm({
  token,
  amount,
  defaultEmail,
}: {
  token: string;
  amount: string;
  defaultEmail: string;
}) {
  const [state, action, pending] = useFormAction(signCoAction, null);
  const [dState, dAction] = useFormAction(declineCoAction, null);
  const [declining, setDeclining] = useState(false);
  if (state?.ok)
    return (
      <p className="rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
        Signed. Thank you! Refresh to see your copy.
      </p>
    );
  if (dState?.ok)
    return (
      <p className="rounded-md border p-4">
        Declined. Thank you for letting us know.
      </p>
    );
  return (
    <section className="flex flex-col gap-4 rounded-md border p-4">
      <h2 className="font-semibold">Approve and sign</h2>
      <form onSubmit={action} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input name="name" placeholder="Full name" required />
          <Input
            name="email"
            type="email"
            defaultValue={defaultEmail}
            placeholder="Email"
            required
          />
        </div>
        <SignaturePad name="signatureImage" />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required />
          <span>
            I agree to sign this change order electronically, and my electronic
            signature is legally binding, the same as a handwritten one.
          </span>
        </label>
        <Button disabled={pending}>
          {pending ? "Signing…" : `Approve & sign — ${amount}`}
        </Button>
        <Problems state={state} />
      </form>
      {declining ? (
        <form onSubmit={dAction} className="flex flex-col gap-2 border-t pt-3">
          <input type="hidden" name="token" value={token} />
          <Input
            name="reason"
            placeholder="Anything we should know? (optional)"
          />
          <Button variant="outline" size="sm" className="self-start">
            Decline change order
          </Button>
          <Problems state={dState} />
        </form>
      ) : (
        <button
          className="self-start text-xs text-muted-foreground underline"
          onClick={() => setDeclining(true)}
        >
          Decline this change order
        </button>
      )}
    </section>
  );
}
