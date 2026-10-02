"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { shrinkPhoto as shrink } from "@/components/shrink-photo";
import { crewInvoiceAction, crewLoginAction, crewPhotosAction, crewIssueAction, crewExtraAction, type CrewResult } from "@/app/crew/actions";

const field = "w-full rounded-lg border border-btr-line bg-background px-3 py-3 text-base";
const primary = "w-full rounded-lg bg-btr-blue px-4 py-3 text-base font-semibold text-white disabled:opacity-60";

function Result({ state }: { state: CrewResult }) {
  if (!state) return null;
  if (state.problems.length)
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {state.problems.join(" ")}
      </div>
    );
  return state.note ? <div className="rounded-lg bg-btr-blue-soft p-3 text-sm">{state.note}</div> : null;
}

export function CrewLoginForm() {
  const [state, action, pending] = useActionState(crewLoginAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input name="email" type="email" autoComplete="username" required className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={field} />
      </label>
      <button disabled={pending} className={primary}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function PhotoUploader({ projectId, stage, label, hint, count, required }: { projectId: string; stage: string; label: string; hint: string; count: number; required: boolean }) {
  const [state, dispatch, pending] = useActionState(crewPhotosAction, null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="flex flex-col gap-2 rounded-xl border border-btr-line bg-background p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
        f.delete("photos");
        setBusy(true);
        for (const file of files) f.append("photos", await shrink(file), file.name.replace(/\.\w+$/, "") + ".jpg");
        setBusy(false);
        startTransition(() => dispatch(f));
        form.current?.reset();
        setPicked(0);
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="stage" value={stage} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {label}
            {required && <span className="ml-2 rounded bg-btr-black px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">Required</span>}
          </h3>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${count ? "bg-btr-blue text-white" : required ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-muted text-muted-foreground"}`}>
          {count}
        </span>
      </div>
      <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-btr-line px-3 py-4 text-base font-medium text-btr-link">
        <input name="photos" type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => setPicked(e.currentTarget.files?.length ?? 0)} />
        {picked ? `${picked} photo${picked === 1 ? "" : "s"} ready` : "Take or choose photos"}
      </label>
      {picked > 0 && <input name="note" placeholder="Note (optional)" className={field} />}
      {picked > 0 && (
        <button disabled={pending || busy} className={primary}>
          {busy ? "Preparing…" : pending ? "Sending…" : `Send ${picked} photo${picked === 1 ? "" : "s"}`}
        </button>
      )}
      <Result state={state} />
    </form>
  );
}

export function CrewInvoiceForm({ projectId, blocked }: { projectId: string; blocked: string | null }) {
  const [state, action, pending] = useActionState(crewInvoiceAction, null);
  if (blocked)
    return <p className="rounded-lg border border-btr-line bg-muted p-3 text-sm">{blocked}</p>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Invoice #
          <input name="invoiceNumber" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Date
          <input name="invoiceDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={field} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amount
        <input name="amount" inputMode="decimal" required placeholder="$" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        What it&apos;s for
        <textarea name="description" required rows={2} placeholder="e.g. Tear-off and install, 32 SQ" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Invoice file (PDF or photo)
        <input name="file" type="file" accept="application/pdf,image/*" className="text-sm" />
      </label>
      <button disabled={pending} className={primary}>
        {pending ? "Sending…" : "Send invoice to BTR"}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Found something extra (rotted decking, hidden damage): photos + a note go to the office to price before the work is done. */
export function IssueForm({ projectId }: { projectId: string }) {
  const [state, dispatch, pending] = useActionState(crewIssueAction, null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
        f.delete("photos");
        setBusy(true);
        for (const file of files) f.append("photos", await shrink(file), file.name.replace(/\.\w+$/, "") + ".jpg");
        setBusy(false);
        startTransition(() => dispatch(f));
        form.current?.reset();
        setPicked(0);
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-btr-line px-3 py-4 text-base font-medium text-btr-link">
        <input name="photos" type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => setPicked(e.currentTarget.files?.length ?? 0)} />
        {picked ? `${picked} photo${picked === 1 ? "" : "s"} ready` : "Photos of the problem"}
      </label>
      <textarea name="note" rows={2} required placeholder="What you found and about how much — e.g. rotted decking, about 6 sheets, back slope" className={field} />
      <button disabled={pending || busy || !picked} className={primary}>
        {busy ? "Preparing…" : pending ? "Sending…" : "Report to the office"}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Signature pad: draws with a finger, hands back a PNG data URL ("" when cleared). */
function SignaturePad({ onChange }: { onChange: (png: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height] as const;
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      ctx.beginPath();
      ctx.moveTo(...pos(e));
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      e.preventDefault();
      ctx.lineTo(...pos(e));
      ctx.stroke();
    };
    const up = () => {
      if (drawing.current) {
        setHas(true);
        onChange(c.toDataURL("image/png"));
      }
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
  }, [onChange]);
  return (
    <div className="flex flex-col gap-1">
      <canvas ref={canvas} width={600} height={180} className="w-full touch-none rounded-lg border border-btr-line bg-white" aria-label="Sign here" />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{has ? "Signed" : "Super / builder signs here with a finger"}</span>
        <button
          type="button"
          className="underline"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setHas(false);
            onChange("");
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/** Extra-work (T&M) tag: what was done beyond the contract, hours, materials, photos, and the super's signature. */
export function ExtraWorkForm({ projectId }: { projectId: string }) {
  const [state, dispatch, pending] = useActionState(crewExtraAction, null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(0);
  const [sig, setSig] = useState("");
  const [key, setKey] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
        f.delete("photos");
        setBusy(true);
        for (const file of files) f.append("photos", await shrink(file), file.name.replace(/\.\w+$/, "") + ".jpg");
        setBusy(false);
        f.set("signature", sig);
        startTransition(() => dispatch(f));
        form.current?.reset();
        setPicked(0);
        setSig("");
        setKey((k) => k + 1);
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <textarea name="note" rows={2} required placeholder="What extra work — e.g. replaced 6 sheets rotted decking, back slope; added cricket behind chimney" className={field} />
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Date
          <input name="workDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Workers
          <input name="men" inputMode="numeric" placeholder="3" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Man-hours
          <input name="hours" inputMode="decimal" placeholder="12" className={field} />
        </label>
      </div>
      <input name="materials" placeholder="Materials used — e.g. 6 sheets 7/16 OSB, 1 box nails" className={field} />
      <input name="directedBy" placeholder="Who asked for it (super / builder / owner)" className={field} />
      <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-btr-line px-3 py-4 text-base font-medium text-btr-link">
        <input name="photos" type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => setPicked(e.currentTarget.files?.length ?? 0)} />
        {picked ? `${picked} photo${picked === 1 ? "" : "s"} ready` : "Photos of the extra work"}
      </label>
      <SignaturePad key={key} onChange={setSig} />
      <input name="signerName" placeholder="Name of who signed" required={!!sig} className={field} />
      <button disabled={pending || busy || (!picked && !sig)} className={primary}>
        {busy ? "Preparing…" : pending ? "Sending…" : "Send extra work tag"}
      </button>
      <Result state={state} />
    </form>
  );
}
