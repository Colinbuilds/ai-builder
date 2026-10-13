"use client";

import Link from "next/link";
import { useState } from "react";
import { addScopeAction } from "@/app/production/homes/actions";
import { FullSheet } from "./full-sheet";
import { ScopeMaterials } from "./scope-materials";
import { ScopeStatusSelect } from "./scope-status";

export type RowLine = { id: string; status: string; crew: string | null; vpo: string | null; hasWo: boolean; materials: { name: string; qty: number; unit: string }[]; sell: number | null; payout: number | null; materialsSrc: string | null; notes: string | null };
export type RowHouse = {
  key: string;
  builder: string;
  address: string;
  model: string | null;
  elevation: string | null;
  superName: string | null;
  start: string | null;
  description: string;
  houseInfo: string | null;
  planLine: string | null;
  other: string[];
  scopes: Record<string, RowLine[]>;
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function AddScope({ h, scope, named }: { h: RowHouse; scope: string; named?: boolean }) {
  return (
    <form action={addScopeAction}>
      {(
        [
          ["builder", h.builder],
          ["address", h.address],
          ["model", h.model ?? ""],
          ["elevation", h.elevation ?? ""],
          ["superName", h.superName ?? ""],
          ["scope", scope],
        ] as const
      ).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className="h-6 rounded border border-dashed px-2 text-[11px] text-muted-foreground hover:bg-muted" title={`Add ${scope} to ${h.address}`}>
        + {named ? scope : "Add"}
      </button>
    </form>
  );
}

/** One builder house on one line; "Open" shows everything about it in a full-screen panel. */
export function HouseRow({ h, scopes, options, canEdit, showBuilder }: { h: RowHouse; scopes: readonly string[]; options: [string, string][]; canEdit: boolean; showBuilder: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = scopes.flatMap((sc) => (h.scopes[sc] ?? []).map((l) => [sc, l] as const));
  const sell = lines.reduce((a, [, l]) => a + (l.sell ?? 0), 0);
  const payout = lines.reduce((a, [, l]) => a + (l.payout ?? 0), 0);
  const noList = lines.filter(([, l]) => !l.materials.length).map(([sc]) => sc);
  const street = h.address.split(",")[0];
  const canAdd = canEdit && !!h.model && !!h.elevation;
  const detail = [h.address, h.builder, h.start && `starts ${h.start}`, h.superName && `super ${h.superName}`].filter(Boolean).join(" · ");
  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="max-w-48 truncate px-2 py-0.5 2xl:max-w-64" title={detail}>
        <button type="button" onClick={() => setOpen(true)} className="font-medium hover:underline">
          {street}
        </button>
        {showBuilder && <span className="text-[11px] text-muted-foreground"> · {h.builder}</span>}
      </td>
      <td className="max-w-48 truncate px-2 py-0.5 text-xs 2xl:max-w-72" title={[h.model, h.description, h.houseInfo].filter(Boolean).join("\n")}>
        <span className="font-medium">{h.model}</span>
        {h.elevation && <span className="text-muted-foreground"> · {h.elevation}</span>}
        <span className="text-muted-foreground"> · {h.description.replace(/^Elevation [^·]*· /, "")}</span>
      </td>
      {scopes.map((sc) => (
        <td key={sc} className="w-32 px-0.5 py-0.5">
          {(h.scopes[sc] ?? []).length ? (
            (h.scopes[sc] ?? []).map((l) => (
              <ScopeStatusSelect key={l.id} id={l.id} value={l.status} options={options} label={`${sc} at ${h.address}`} title={`${sc}: ${l.crew ?? "no crew"}${l.vpo ? ` · WO ${l.vpo}` : ""}`} disabled={!canEdit} compact />
            ))
          ) : canAdd ? (
            <AddScope h={h} scope={sc} />
          ) : (
            <span className="pl-2 text-xs text-muted-foreground">—</span>
          )}
        </td>
      ))}
      <td className="px-2 py-0.5 text-right text-xs whitespace-nowrap tabular-nums" title={`Sell ${usd(sell)} · pay out ${usd(payout)}`}>
        {usd(sell)}
      </td>
      <td className="px-1 py-0.5">
        <button type="button" onClick={() => setOpen(true)} className="h-6 rounded border px-2 text-[11px] whitespace-nowrap hover:bg-muted" title={noList.length ? `No material list yet: ${noList.join(", ")}` : "Materials, sell & pay out"}>
          Open
        </button>
        <FullSheet
          open={open}
          onClose={() => setOpen(false)}
          title={
            <>
              <h2 className="text-lg font-semibold">{h.address}</h2>
              <p className="text-sm">
                <span className="font-medium">{h.model}</span> · {h.description}
              </p>
              <p className="text-xs text-muted-foreground">{[h.builder, h.start && `starts ${h.start}`, h.superName && `super ${h.superName}`, h.houseInfo, h.other.length && `also ${h.other.join(", ")}`].filter(Boolean).join(" · ")}</p>
            </>
          }
          right={
            <>
              <span className="text-sm tabular-nums">
                Sell <b>{usd(sell)}</b> · Pay out <b>{usd(payout)}</b> · <span className={sell - payout < 0 ? "text-red-700 dark:text-red-300" : ""}>Sell − pay out {usd(sell - payout)}</span>
              </span>
              {h.planLine && (
                <a href={`/api/production/file/${h.planLine}/plan`} target="_blank" rel="noreferrer" className="h-8 rounded-md border px-3 text-sm leading-8 hover:bg-muted">
                  Plans
                </a>
              )}
            </>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {lines.map(([sc, l]) => (
              <div key={l.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <div className="w-40">
                    <ScopeStatusSelect id={l.id} value={l.status} options={options} label={`${sc} status`} disabled={!canEdit} />
                  </div>
                  <Link href={`/production/${l.id}`} className="text-btr-link hover:underline">
                    {l.crew ?? "No crew"} — set crew &amp; dates
                  </Link>
                  {l.hasWo && (
                    <a href={`/api/production/file/${l.id}/wo`} target="_blank" rel="noreferrer" className="text-btr-link hover:underline">
                      Work order {l.vpo ?? ""}
                    </a>
                  )}
                </div>
                <ScopeMaterials id={l.id} scope={sc} materials={l.materials} sell={l.sell} payout={l.payout} source={l.materialsSrc} notes={l.notes} canEdit={canEdit} />
              </div>
            ))}
            {canAdd && scopes.some((sc) => !(h.scopes[sc] ?? []).length) && (
              <div className="flex flex-wrap items-center gap-2 self-start rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Add a scope:
                {scopes
                  .filter((sc) => !(h.scopes[sc] ?? []).length)
                  .map((sc) => (
                    <AddScope key={sc} h={h} scope={sc} named />
                  ))}
              </div>
            )}
          </div>
        </FullSheet>
      </td>
    </tr>
  );
}
