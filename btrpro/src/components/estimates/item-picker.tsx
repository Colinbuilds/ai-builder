"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type PickedItem = {
  itemNumber: string;
  description: string;
  uom: string;
  unitPrice: number | null;
  priceStatus: string;
  sheetCode: string;
  sheetStatus: string;
  warning: string | null;
  coverageQty: number | null;
  coverageUnit: string | null;
};

const money = (n: number | null, s: string) => (s === "CALL" || n == null ? "CALL" : `$${n.toFixed(2)}`);

/** Search-as-you-type picker over the live price sheets. */
export function ItemPicker({
  value,
  label,
  onPick,
  placeholder = "Search item #, product, or section",
  sheets,
}: {
  value: { itemNumber: string | null; description?: string | null };
  label?: string;
  onPick: (item: PickedItem | null) => void;
  placeholder?: string;
  sheets?: string[];
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickedItem[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ q, limit: "20" });
      if (sheets?.length) params.set("sheets", sheets.join(","));
      const r = await fetch(`/api/price-items?${params}`);
      if (r.ok) setResults(await r.json());
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, sheets]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      {value.itemNumber && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 w-full items-center gap-2 truncate rounded-md border border-input bg-background px-2 text-left text-sm"
          title="Change product"
        >
          <span className="font-mono text-xs">{value.itemNumber}</span>
          <span className="truncate">{value.description}</span>
        </button>
      ) : (
        <Input
          autoFocus={open}
          className="h-8"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder={label ? `${label}: ${placeholder}` : placeholder}
        />
      )}
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full min-w-96 overflow-y-auto rounded-md border bg-background shadow-lg">
          {value.itemNumber && (
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-accent"
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
            >
              Clear product
            </button>
          )}
          {results.map((r) => (
            <button
              type="button"
              key={`${r.sheetCode}-${r.itemNumber}`}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                onPick(r);
                setOpen(false);
                setQ("");
              }}
            >
              <span className="font-mono text-xs">{r.itemNumber}</span>
              <span className="flex-1 truncate">{r.description}</span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {money(r.unitPrice, r.priceStatus)}/{r.uom} · {r.sheetCode}
                {r.coverageQty != null && ` · ${r.coverageQty} ${r.coverageUnit}`}
              </span>
            </button>
          ))}
          {results.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No matches on the loaded sheets.</p>}
        </div>
      )}
    </div>
  );
}
