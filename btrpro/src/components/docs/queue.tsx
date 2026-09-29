"use client";

import { useState, useTransition } from "react";
import { decideFactAction, decideMeasurementAction } from "@/app/projects/docs-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type QueueItem = {
  id: string;
  kind: "measurement" | "fact";
  label: string;
  value: string;
  unit: string | null;
  facet: string | null;
  docId: string | null;
  docName: string | null;
  page: number | null;
  quote: string | null;
};

// Confirmation queue beside a PDF viewer opened at the source page (BUILD_PROMPT §3).
export function ConfirmationQueue({ items, canEdit }: { items: QueueItem[]; canEdit: boolean }) {
  const first = items.find((i) => i.docId);
  const [viewing, setViewing] = useState<{ docId: string; page: number | null } | null>(first ? { docId: first.docId!, page: first.page } : null);
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing waiting for confirmation.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <ul className="flex max-h-[75vh] flex-col gap-2 overflow-y-auto pr-1">
        {items.map((i) => (
          <Row
            key={`${i.kind}-${i.id}`}
            item={i}
            canEdit={canEdit}
            active={viewing?.docId === i.docId && viewing?.page === i.page}
            onView={() => i.docId && setViewing({ docId: i.docId, page: i.page })}
          />
        ))}
      </ul>
      <div className="min-h-[60vh] overflow-hidden rounded-md border">
        {viewing ? (
          <iframe key={`${viewing.docId}-${viewing.page}`} title="Source document" src={`/api/documents/${viewing.docId}#page=${viewing.page ?? 1}`} className="h-[75vh] w-full" />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Pick an item to see its source page.</p>
        )}
      </div>
    </div>
  );
}

function Row({ item, canEdit, active, onView }: { item: QueueItem; canEdit: boolean; active: boolean; onView: () => void }) {
  const [value, setValue] = useState(item.value);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "confirm" | "reject") =>
    start(async () => {
      const f = new FormData();
      f.set("id", item.id);
      f.set("decision", decision);
      if (value !== item.value) f.set("value", value);
      setErr(await (item.kind === "measurement" ? decideMeasurementAction(f) : decideFactAction(f)));
    });
  return (
    <li className={`rounded-md border p-3 text-sm ${active ? "border-primary" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {item.label}
          {item.facet && <span className="font-normal text-muted-foreground"> · {item.facet}</span>}
        </span>
        {item.docId && (
          <button onClick={onView} className="text-xs underline">
            {item.docName} p.{item.page}
          </button>
        )}
      </div>
      {item.quote && <p className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground">“{item.quote}”</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} className={`h-8 ${item.kind === "fact" ? "min-w-64 flex-1" : "w-32"}`} disabled={!canEdit} />
        {item.unit && <span className="text-muted-foreground">{item.unit}</span>}
        {canEdit && (
          <>
            <Button size="sm" disabled={pending} onClick={() => decide("confirm")}>
              {value !== item.value ? "Save edit & confirm" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("reject")}>
              Reject
            </Button>
          </>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </li>
  );
}
