import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeBooks } from "@/lib/builders/planbook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatUsd } from "@/lib/utils";
import { importPlanBookAction } from "./actions";

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
        <section key={book.id} className="flex flex-col gap-3">
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
