"use client";

import { useEffect, useRef, useState } from "react";
import { useFormAction } from "@/components/use-form-action";
import { declineAction, signAction } from "@/app/proposal-actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Problems } from "@/components/projects/problems";

type Alt = { name: string; description: string; price: number };
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function SignForm({
  token,
  base,
  alternates,
  depositPct,
  defaultName,
  defaultEmail,
}: {
  token: string;
  base: number;
  alternates: Alt[];
  depositPct: number | null;
  defaultName: string;
  defaultEmail: string;
}) {
  const [state, action, pending] = useFormAction(signAction, null);
  const [dState, dAction] = useFormAction(declineAction, null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sig, setSig] = useState("");
  const [declining, setDeclining] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const total =
    base +
    alternates
      .filter((a) => picked.includes(a.name))
      .reduce((s, a) => s + a.price, 0);

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

  if (state?.ok)
    return (
      <p className="rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
        Signed. Refresh to download your copy.
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
      <h2 className="font-semibold">Accept and sign</h2>
      <form onSubmit={action} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="signatureImage" value={sig} />
        {alternates.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label>Options</Label>
            {alternates.map((a) => (
              <label key={a.name} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="alternate"
                  value={a.name}
                  checked={picked.includes(a.name)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...picked, a.name]
                        : picked.filter((x) => x !== a.name),
                    )
                  }
                />
                <span>
                  <strong>{a.name}</strong> (+{usd(a.price)})
                  {a.description && ` — ${a.description}`}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="text-lg font-semibold">
          Total: {usd(total)}
          {depositPct ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              deposit {usd((total * depositPct) / 100)}
            </span>
          ) : null}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            name="name"
            defaultValue={defaultName}
            placeholder="Full name"
            required
          />
          <Input
            name="email"
            type="email"
            defaultValue={defaultEmail}
            placeholder="Email"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>
            Signature (draw with your finger or mouse, optional — your typed
            name also signs)
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
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required />
          <span>
            I agree to sign this proposal electronically, and my electronic
            signature is legally binding, the same as a handwritten one.
          </span>
        </label>
        <Button disabled={pending}>
          {pending ? "Signing…" : `Accept & sign for ${usd(total)}`}
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
            Decline proposal
          </Button>
          <Problems state={dState} />
        </form>
      ) : (
        <button
          className="self-start text-xs text-muted-foreground underline"
          onClick={() => setDeclining(true)}
        >
          Decline this proposal
        </button>
      )}
    </section>
  );
}
