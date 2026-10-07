import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { startView } from "@/lib/builders/starts";
import { buildOut, modelLabel } from "@/lib/builders/plans";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/utils";
import { addStartAction, dismissStartAction } from "../actions";

// One read start sheet, said back in plain words, with one big button to add it.
export default async function StartPage({ params, searchParams }: { params: Promise<{ sid: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { sid } = await params;
  const sp = await searchParams;
  const v = await startView(sid);
  if (!v) notFound();
  const { data: d, company, book, plan, sel, flags, color } = v;
  const out = book && plan ? buildOut(book.data, plan, sel) : null;
  const label = plan ? modelLabel(plan.name, sel) : null;
  const done = v.start.status === "SCHEDULED";
  const sell = out ? out.roofing.sell + out.gutters.sell : 0;
  // "Change something" opens the model with everything from the sheet filled in
  const fix =
    company && book
      ? `/builders/${company.id}/plans/${encodeURIComponent(plan?.name ?? book.data.plans[0]?.name ?? "")}?${new URLSearchParams({ book: book.id, e: sel.elevation, g: sel.garage, b: sel.basement, p: sel.porch ? "1" : "0", t: "schedule", start: sid, lot: d.lot ?? "", sub: d.subdivision ?? "", addr: d.address ?? "", city: d.city ?? "", permit: d.permit ?? "", color: color ?? "" }).toString()}`
      : null;
  const facts: [string, string | null][] = [
    ["Builder", company?.name ?? d.builder],
    ["Where", [d.lot && `Lot ${d.lot}`, d.subdivision].filter(Boolean).join(", ") || null],
    ["Address", [d.address, d.city].filter(Boolean).join(", ") || null],
    ["Permit", d.permit],
    ["Model", plan ? plan.name : d.planCode ? `${d.planCode} (not found in the plan book)` : null],
    ["Elevation", d.elevationCode ? `${sel.elevation}  (sheet says ${d.elevationCode})` : sel.elevation],
    ["Garage", sel.garage === "3" ? "3 car" : "2 car"],
    ["Basement", sel.basement === "DLWO" ? "Daylight / walkout" : (d.options.find((o) => /BASEMENT|BSMT/i.test(o.description) && !/DECK|PATIO/i.test(o.description))?.description.toLowerCase() ?? "standard")],
    ["Rear porch", sel.porch ? "Yes" : "No"],
    ["Garage swing", d.swing],
    ["Exterior", color],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href="/builders/add-house" className="text-sm text-muted-foreground">
        ← Add a builder house
      </Link>
      <h1 className="text-2xl font-semibold">{done ? "This house was added" : "Is this right?"}</h1>
      {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{sp.err}</p>}

      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 rounded-xl border p-5 text-base">
        {facts
          .filter(([, v]) => v)
          .map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{val}</dd>
            </div>
          ))}
      </dl>

      {out && (
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Sell", sell],
            ["Crew payout", out.roofing.payout + out.gutters.payout],
            ["Profit", out.total.profit],
          ].map(([k, n]) => (
            <div key={k as string} className="rounded-lg border px-4 py-3">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-xl font-semibold tabular-nums">{formatUsd(n as number)}</div>
            </div>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle size={18} /> Check these
          </div>
          <ul className="list-disc pl-6 text-sm">
            {flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {!done && user.role !== "VIEWER" && (
        <div className="flex flex-col gap-3">
          {out && label && (
            <form action={addStartAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={sid} />
              <div className="flex gap-6 text-base">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="trade" value="ROOFING" className="h-5 w-5" defaultChecked={out.roofing.picked.length > 0} disabled={!out.roofing.picked.length} /> Roofing
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="trade" value="GUTTERS" className="h-5 w-5" defaultChecked={out.gutters.picked.length > 0} disabled={!out.gutters.picked.length} /> Gutters
                </label>
              </div>
              <Button type="submit" size="lg" className="h-14 bg-green-700 text-lg hover:bg-green-800">
                <CheckCircle2 className="mr-2" /> Yes — add this house ({label})
              </Button>
            </form>
          )}
          <div className="flex flex-wrap gap-3">
            {!fix && (
              <Link href="/builders/add-house">
                <Button variant="outline" size="lg">
                  Pick the builder and model myself
                </Button>
              </Link>
            )}
            {fix && (
              <Link href={fix}>
                <Button variant="outline" size="lg">
                  Something&apos;s wrong — change it
                </Button>
              </Link>
            )}
            <a href={`/api/builders/starts/${sid}`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="lg">
                Look at the PDF
              </Button>
            </a>
            <form action={dismissStartAction}>
              <input type="hidden" name="id" value={sid} />
              <Button type="submit" variant="ghost" size="lg">
                Not a house — ignore it
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
