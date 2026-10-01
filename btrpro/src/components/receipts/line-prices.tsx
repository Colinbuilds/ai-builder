"use client";

import { useFormAction } from "@/components/use-form-action";
import { linePricesAction } from "@/app/receipts/actions";
import { Problems } from "@/components/projects/problems";
import { Button } from "@/components/ui/button";

/** Unit prices for lines with no printed price and none on our sheets — typed by the office, never guessed. */
export function LinePrices({ id, lines }: { id: string; lines: { index: number; label: string; qty: number | null; uom: string | null; price: number | null }[] }) {
  const [state, action, pending] = useFormAction(linePricesAction, null);
  return (
    <form onSubmit={action} className="flex flex-col gap-2 rounded-lg border border-btr-line p-3 text-sm">
      <input type="hidden" name="id" value={id} />
      <div className="font-medium">Prices to enter</div>
      <p className="text-xs text-muted-foreground">No price printed and not on our sheets. Enter the unit price from the invoice or quote; the amount is quantity × price.</p>
      {lines.map((l) => (
        <label key={l.index} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">{l.label}</span>
          <span className="text-xs text-muted-foreground">
            {l.qty ?? "?"} {l.uom ?? ""} ×
          </span>
          <input name={`price_${l.index}`} inputMode="decimal" defaultValue={l.price ?? ""} placeholder="$ each" className="w-24 rounded border border-input bg-background px-2 py-1 text-right tabular-nums" />
        </label>
      ))}
      <Button size="sm" variant="outline" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save prices"}
      </Button>
      {state?.ok && <span className="text-xs text-btr-blue">{state.note}</span>}
      <Problems state={state} />
    </form>
  );
}
