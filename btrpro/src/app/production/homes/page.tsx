import Link from "next/link";
import { Fragment } from "react";
import { requireUser } from "@/lib/auth";
import { pickers } from "@/lib/production/board";
import { builderNames, HOME_SCOPES, homeSchedule, materialsOf, modelsByBuilder, SCOPE_STATUS, statusOf, type House } from "@/lib/production/homes";
import { ScopeMaterials } from "@/components/production/scope-materials";
import { ScopeStatusSelect } from "@/components/production/scope-status";
import { addScopeAction } from "./actions";
import { HouseForm } from "@/components/production/house-form";
import { Collapsible } from "@/components/collapsible";
import { NavSelect } from "@/components/dashboard/tab-select";

const day = (d: Date | null) => (d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : "");

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function HouseDetails({ h, canEdit }: { h: House; canEdit: boolean }) {
  const lines = HOME_SCOPES.flatMap((sc) => (h.scopes[sc] ?? []).map((l) => [sc, l] as const));
  const sell = lines.reduce((a, [, l]) => a + (l.sell ?? 0), 0);
  const payout = lines.reduce((a, [, l]) => a + (l.payout ?? 0), 0);
  const noList = lines.filter(([, l]) => !materialsOf(l).length).map(([sc]) => sc);
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-btr-link select-none hover:underline">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span> Materials, sell &amp; pay out
        <span className="ml-2 text-muted-foreground">
          sell {usd(sell)} · pay out {usd(payout)}
          {noList.length > 0 && ` · no material list: ${noList.join(", ")}`}
        </span>
      </summary>
      {lines.length ? (
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {lines.map(([sc, l]) => (
            <ScopeMaterials key={l.id} id={l.id} scope={sc} materials={materialsOf(l)} sell={l.sell} payout={l.payout} source={l.materialsSrc} canEdit={canEdit} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No scopes on this house yet.</p>
      )}
    </details>
  );
}

const STATUS_OPTIONS = Object.entries(SCOPE_STATUS) as [string, string][];

function ScopeCell({ h, scope, canEdit }: { h: House; scope: (typeof HOME_SCOPES)[number]; canEdit: boolean }) {
  const lines = h.scopes[scope] ?? [];
  if (!lines.length)
    return canEdit && h.model && h.elevation ? (
      <form action={addScopeAction}>
        {(
          [
            ["builder", h.builder],
            ["address", h.address],
            ["model", h.model],
            ["elevation", h.elevation],
            ["superName", h.superName ?? ""],
            ["scope", scope],
          ] as const
        ).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button className="h-8 rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:bg-muted" title={`Add ${scope} to ${h.address}`}>
          + Add
        </button>
      </form>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  return (
    <div className="flex flex-col gap-1">
      {lines.map((l) => (
        <div key={l.id} className="flex flex-col gap-0.5">
          <ScopeStatusSelect id={l.id} value={statusOf(l)} options={STATUS_OPTIONS} label={`${scope} at ${h.address}`} disabled={!canEdit} />
          <Link href={`/production/${l.id}`} className="max-w-36 truncate text-xs text-muted-foreground hover:underline" title={l.type ?? scope}>
            {l.crew ?? "No crew"}
          </Link>
        </div>
      ))}
    </div>
  );
}

export default async function HomeCompanySchedule({ searchParams }: { searchParams: Promise<{ b?: string; new?: string; added?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const builders = await builderNames();
  const builder = sp.b && builders.includes(sp.b) ? sp.b : null;
  const [houses, models, { supers }] = await Promise.all([homeSchedule(builder), modelsByBuilder(), pickers()]);
  const canEdit = user.role !== "VIEWER";
  const href = (b: string | null) => `/production/homes${b ? `?b=${encodeURIComponent(b)}` : ""}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Home Company Schedule</h1>
          <p className="text-sm text-muted-foreground">
            New-construction houses for home builders, one row per address. Each scope is a line on the{" "}
            <Link href="/production" className="text-btr-link hover:underline">
              main schedule
            </Link>
            . Set each scope&apos;s status right here: Job Done tells the office the crew can be paid, and Sent to Billing tells them to bill the builder. Click the crew name
            under a status to set the crew, dates, pay out and sell.
          </p>
        </div>
        {builders.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            Builder
            <NavSelect label="Builder" value={href(builder)} className="w-56" options={[{ label: "All builders", href: href(null) }, ...builders.map((b) => ({ label: b, href: href(b) }))]} />
          </label>
        )}
      </div>
      {sp.added && <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">Job created. Its scopes are in &quot;New — to be placed&quot; until a crew is set.</p>}
      {canEdit && (
        <Collapsible title={<span className="font-semibold">+ Create job</span>} defaultOpen={!!sp.new} className="rounded-md border p-3">
          <div className="mt-3">
            <HouseForm builders={builders} models={models} supers={supers} scopes={HOME_SCOPES} builder={builder ?? undefined} />
          </div>
        </Collapsible>
      )}
      {houses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open builder houses{builder ? ` for ${builder}` : ""} yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Address</th>
                <th className="px-2 py-1.5">Model</th>
                {HOME_SCOPES.map((sc) => (
                  <th key={sc} className="px-2 py-1.5">
                    {sc}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd):not(:first-child)]:border-t">
              {houses.map((h) => (
                <Fragment key={h.key}>
                  <tr className="align-top">
                    <td className="min-w-48 px-2 py-1.5">
                      <span className="font-medium">{h.address}</span>
                      <div className="text-xs text-muted-foreground">{[!builder && h.builder, h.start && `starts ${day(h.start)}`, h.superName].filter(Boolean).join(" · ")}</div>
                      {h.other.length > 0 && <div className="text-xs text-muted-foreground">Also: {h.other.map((l) => l.type).join(", ")}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-sm">
                      {h.model}
                      {h.elevation && <div className="text-xs text-muted-foreground">Elevation {h.elevation}</div>}
                    </td>
                    {HOME_SCOPES.map((sc) => (
                      <td key={sc} className="px-2 py-1.5">
                        <ScopeCell h={h} scope={sc} canEdit={canEdit} />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t-0 bg-muted/20">
                    <td colSpan={2 + HOME_SCOPES.length} className="px-2 pt-0 pb-2">
                      <HouseDetails h={h} canEdit={canEdit} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot className="bg-muted/30 text-xs">
              <tr>
                <td className="px-2 py-1.5" colSpan={2 + HOME_SCOPES.length}>
                  {houses.length} house{houses.length === 1 ? "" : "s"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
