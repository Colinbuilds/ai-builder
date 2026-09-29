"use client";

import { useState, useTransition } from "react";
import { lineAction } from "@/app/projects/estimate-actions";
import { ItemPicker } from "./item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LineActions({ lineId, quantity }: { lineId: string; quantity: number | null }) {
  const [mode, setMode] = useState<null | "quantity" | "substitute">(null);
  const [qty, setQty] = useState(quantity != null ? String(quantity) : "");
  const [reason, setReason] = useState("");
  const [item, setItem] = useState<{ itemNumber: string | null; description?: string | null }>({ itemNumber: null });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = (kind: string, extra: Record<string, string> = {}) =>
    start(async () => {
      const f = new FormData();
      f.set("lineId", lineId);
      f.set("kind", kind);
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      const e = await lineAction(f);
      setErr(e);
      if (!e) setMode(null);
    });
  if (!mode)
    return (
      <div className="flex gap-2 text-xs">
        <button className="underline" onClick={() => setMode("quantity")}>
          qty
        </button>
        <button className="underline" onClick={() => setMode("substitute")}>
          substitute
        </button>
        <button className="text-muted-foreground underline hover:text-destructive" disabled={pending} onClick={() => confirm("Remove this line?") && send("delete")}>
          remove
        </button>
        {err && <span className="text-destructive">{err}</span>}
      </div>
    );
  return (
    <div className="flex min-w-72 flex-col gap-1">
      {mode === "quantity" ? (
        <Input className="h-7 w-24" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity" />
      ) : (
        <ItemPicker value={item} label="Substitute with" onPick={(it) => setItem(it ? { itemNumber: it.itemNumber, description: it.description } : { itemNumber: null })} />
      )}
      <Input className="h-7" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "quantity" ? "Why change the calculated quantity?" : "Who approved the substitution and why"} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => (mode === "quantity" ? send("quantity", { quantity: qty, reason }) : send("substitute", { itemNumber: item.itemNumber ?? "", reason }))}
        >
          {mode === "quantity" ? "Change quantity" : "Substitute (requires approval)"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
          Cancel
        </Button>
      </div>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}
