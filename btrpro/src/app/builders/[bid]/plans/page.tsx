import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeBooks } from "@/lib/builders/planbook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatUsd } from "@/lib/utils";
import type { PlanBookData } from "@/lib/builders/plans";
import { importPlanBookAction } from "./actions";

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 1000) / 10}%`);
const usd = (n: number | null) => (n == null ? "—" : formatUsd(n));

/** The sheet's own price list and rates — what every model's numbers are built from. */
function PriceSheet({ data }: { data: PlanBookData }) {
  const R = data.rates.roofing;
  const G = data.rates.gutters;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Price sheet — material prices &amp; rates</summary>
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Roofing</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Tax on materials</dt>
            <dd>{pct(R.taxPct)}</dd>
            <dt className="text-muted-foreground">Material markup</dt>
            <dd>{pct(R.markupPct)}</dd>
            <dt className="text-muted-foreground">Labor (crew payout)</dt>
            <dd>{usd(R.laborPerSq)}/SQ</dd>
            <dt className="text-muted-foreground">Labor markup</dt>
            <dd>{usd(R.laborMarkupPerSq)}/SQ</dd>
            <dt className="text-muted-foreground">Boot trip</dt>
            <dd>
              {usd(R.bootTrip)}
              {R.bootTripMarkup ? ` + ${usd(R.bootTripMarkup)} markup` : " (no markup)"}
            </dd>
            <dt className="text-muted-foreground">Fuel surcharge</dt>
            <dd>{usd(R.fuelSurcharge)}</dd>
          </dl>
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 font-normal">Material</th>
                <th className="py-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {R.catalog.map((c) => (
                <tr key={c.name} className="border-b last:border-0">
                  <td className="py-1">{c.name}</td>
                  <td className="py-1 text-right">{usd(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Gutters</h3>
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 font-normal">Material</th>
                <th className="py-1 text-right font-normal">Cost</th>
                <th className="py-1 text-right font-normal">Markup</th>
              </tr>
            </thead>
            <tbody>
              {G.catalog.map((c) => (
                <tr key={c.name} className="border-b last:border-0">
                  <td className="py-1">{c.name}</td>
                  <td className="py-1 text-right">{usd(c.cost)}</td>
                  <td className="py-1 text-right">{usd(c.markup)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {G.dlwoPrice != null && (
            <p className="text-muted-foreground">
              Daylight / walkout basement: +{G.dlwoDownspoutLf ?? 0} LF downspouts, +{usd(G.dlwoPrice)}
            </p>
          )}
          <h3 className="mt-2 font-semibold">Siding</h3>
          <p className="text-muted-foreground">{data.rates.siding.priced ? `${data.rates.siding.catalog.length} items priced.` : data.rates.siding.catalog.length ? `${data.rates.siding.catalog.length} items listed, not priced yet.` : "Not on the sheet."}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Roofing sell = materials × (1 + tax + markup) + SQ × (labor + labor markup) + boot trip. Payout = SQ × labor + boot trip. Gutters: LF × cost to the sub, LF × (cost + markup) to the builder.</p>
    </details>
  );
}

export default async function PlansPage({ params, searchParams }: { params: Promise<{ bid: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { bid } = await params;
  const sp = await searchParams;
  const b = await prisma.company.findUnique({ where: { id: bid }, select: { id: true, name: true, type: true } });
  if (!b || b.type !== "BUILDER") notFound();
  const books = await activeBooks(b.id);
  const canImport = user.role !== "VIEWER";

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/builders/${b.id}`} className="text-sm text-muted-foreground">
        ← {b.name}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{b.name} — plans &amp; models</h1>
        {books.length > 0 && (
          <Link href={`/builders/${b.id}/plans/audit`} className="text-sm text-primary underline">
            Profit audit →
          </Link>
        )}
      </div>
      {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{sp.err}</p>}
      {sp.ok && <p className="text-sm text-green-700">Plan book imported — {sp.ok}.</p>}

      {books.length === 0 && <p className="text-sm text-muted-foreground">No plan book yet. Import {b.name}&apos;s master sheet below: each model, its elevations and options, the ordering list, sell and payout come from it.</p>}

      {books.map((book) => (
        <section key={book.id} id={`book-${book.id}`} className="flex scroll-mt-4 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-lg font-semibold">{book.label}</h2>
            <span className="text-xs text-muted-foreground">
              {book.data.plans.length} models · imported {formatDate(book.importedAt)} by {book.importedBy}
              {book.sourceName ? ` · ${book.sourceName}` : ""}
            </span>
          </div>
          {book.data.warnings.length > 0 && (
            <ul className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-8 pr-3 text-sm dark:border-amber-800 dark:bg-amber-950">
              {book.data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <PriceSheet data={book.data} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {book.data.plans.map((p) => {
              const elevs = p.roofing.filter((o) => o.kind === "ELEVATION");
              const sells = elevs.map((o) => o.sell ?? 0).filter(Boolean);
              return (
                <Link key={p.name} href={`/builders/${b.id}/plans/${encodeURIComponent(p.name)}?book=${book.id}`} className="rounded-lg border p-3 hover:border-primary hover:bg-muted/40">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{[p.sqft && `${p.sqft.toLocaleString()} sq ft`, elevs.length && `Elev ${elevs.map((o) => o.label).join(", ")}`].filter(Boolean).join(" · ")}</div>
                  <div className="mt-1 text-sm">{sells.length ? `Roofing ${formatUsd(Math.min(...sells))}${sells.length > 1 ? `–${formatUsd(Math.max(...sells))}` : ""}` : <Badge variant="outline">no roofing price</Badge>}</div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {canImport && (
        <form action={importPlanBookAction} className="flex max-w-2xl flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-semibold">{books.length ? "Re-import / add a plan book" : "Import plan book"}</h2>
          <p className="text-xs text-muted-foreground">
            Paste the Google Sheet link (share it with the BTRpro service account as Viewer) or upload the .xlsx (File → Download → Microsoft Excel). Re-importing a book with the same name replaces it; nothing in Drive is changed.
          </p>
          <input type="hidden" name="bid" value={b.id} />
          <label className="text-sm">
            Name
            <Input name="label" defaultValue={books[0]?.label ?? ""} placeholder="e.g. Kansas City" required />
          </label>
          <label className="text-sm">
            Google Sheet link
            <Input name="link" defaultValue={books[0]?.sourceUrl ?? ""} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </label>
          <label className="text-sm">
            or .xlsx file
            <Input name="file" type="file" accept=".xlsx" />
          </label>
          <Button type="submit" className="self-start">
            Import
          </Button>
        </form>
      )}
    </div>
  );
}
