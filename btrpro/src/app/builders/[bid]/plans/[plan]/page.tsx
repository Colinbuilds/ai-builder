import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBook } from "@/lib/builders/planbook";
import { buildOut, findPlan, modelLabel, type PlanOption, type Selection, type Trade } from "@/lib/builders/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUsd } from "@/lib/utils";
import { saveTakeoffAction, scheduleHouseAction } from "../actions";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const TABS = [
  ["takeoff", "Takeoff"],
  ["order", "Order"],
  ["schedule", "Add to schedule"],
] as const;
// unit shown on the order: the sheet lists LF items by length, everything else by count
const unitFor = (name: string, trade: Trade) => (trade === "GUTTERS" && /gutter|downspout|accessor/i.test(name) ? "LF" : "EA");

export default async function ModelPage({ params, searchParams }: { params: Promise<{ bid: string; plan: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { bid, plan: planParam } = await params;
  const sp = await searchParams;
  const book = sp.book ? await getBook(sp.book) : null;
  if (!book || book.companyId !== bid) notFound();
  const plan = findPlan(book.data.plans, decodeURIComponent(planParam));
  if (!plan) notFound();
  const tab = TABS.some(([k]) => k === sp.t) ? sp.t! : "takeoff";

  const all = [...plan.roofing, ...plan.gutters];
  const elevs = [...new Set(all.filter((o) => o.kind === "ELEVATION").map((o) => o.label))];
  const has3 = all.some((o) => o.kind === "GARAGE");
  const hasPorch = all.some((o) => o.kind === "PORCH");
  const sel: Selection = {
    elevation: elevs.includes(sp.e ?? "") ? sp.e! : (elevs[0] ?? ""),
    garage: sp.g === "3" && has3 ? "3" : "2",
    basement: sp.b === "DLWO" ? "DLWO" : "STANDARD",
    porch: sp.p === "1" && hasPorch,
  };
  const out = buildOut(book.data, plan, sel);
  const label = modelLabel(plan.name, sel);
  const query = (patch: Partial<Record<"e" | "g" | "b" | "p" | "t", string>> = {}) =>
    new URLSearchParams({ book: book.id, e: sel.elevation, g: sel.garage, b: sel.basement, p: sel.porch ? "1" : "0", t: tab, ...patch }).toString();
  const base = `/builders/${bid}/plans/${encodeURIComponent(plan.name)}`;
  const backPath = `/${encodeURIComponent(plan.name)}?${query()}`;
  const chip = (on: boolean, to: string, text: string) => (
    <Link key={text} href={to} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
      {text}
    </Link>
  );
  const canEdit = ["ADMIN", "ESTIMATOR", "PURCHASING"].includes(user.role);
  const edited = (trade: Trade, o: PlanOption) => (book.data.edits ?? []).filter((e) => e.plan === plan.name && e.trade === trade && e.option === o.label);
  const trades = [
    ["ROOFING", "Roofing", out.roofing],
    ["GUTTERS", "Gutters", out.gutters],
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/builders/${bid}/plans`} className="text-sm text-muted-foreground">
        ← {book.company.name} models
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{plan.name}</h1>
          <p className="text-sm text-muted-foreground">{[book.company.name, book.label, plan.sqft && `${plan.sqft.toLocaleString()} sq ft`].filter(Boolean).join(" · ")}</p>
        </div>
        {user.role !== "VIEWER" && tab !== "schedule" && (
          <Link href={`${base}?${query({ t: "schedule" })}`}>
            <Button>Add to schedule</Button>
          </Link>
        )}
      </div>
      {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{sp.err}</p>}
      {sp.saved && <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">{sp.saved}</p>}
      {sp.scheduled && (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Added {sp.scheduled} line{sp.scheduled === "1" ? "" : "s"} to the production schedule (ADD board).{" "}
          <Link href="/production" className="underline">
            Open schedule →
          </Link>
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm text-muted-foreground">Elevation</span>
          {elevs.map((e) => chip(e === sel.elevation, `${base}?${query({ e })}`, e))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm text-muted-foreground">Garage</span>
          {chip(sel.garage === "2", `${base}?${query({ g: "2" })}`, "2 car")}
          {has3 && chip(sel.garage === "3", `${base}?${query({ g: "3" })}`, "3 car")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm text-muted-foreground">Basement</span>
          {chip(sel.basement === "STANDARD", `${base}?${query({ b: "STANDARD" })}`, "Standard")}
          {chip(sel.basement === "DLWO", `${base}?${query({ b: "DLWO" })}`, "Daylight / walkout")}
        </div>
        {hasPorch && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm text-muted-foreground">Rear porch</span>
            {chip(!sel.porch, `${base}?${query({ p: "0" })}`, "No")}
            {chip(sel.porch, `${base}?${query({ p: "1" })}`, "Yes")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [`Sell to ${book.company.name}`, out.total.sell, null],
            ["Crew payout", out.total.payout, null],
            ["Materials", out.roofing.materials$ + out.gutters.materials$, null],
            ["BTR profit", out.total.profit, out.total.marginPct != null ? `${out.total.marginPct}% of sell` : null],
          ] as const
        ).map(([k, v, sub]) => (
          <div key={k} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-xl font-semibold">{formatUsd(v)}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
          </div>
        ))}
      </div>
      {out.dlwoNote && <p className="text-sm text-muted-foreground">{out.dlwoNote}</p>}
      {out.oldRoofing?.sell != null && (
        <p className="text-sm text-muted-foreground">
          Old Pricing tab ({out.oldRoofing.key}): roofing sell {formatUsd(out.oldRoofing.sell)}
          {out.oldRoofing.payout != null ? `, payout ${formatUsd(out.oldRoofing.payout)}` : ""} vs. {formatUsd(out.roofing.sell)} now ({out.roofing.sell >= out.oldRoofing.sell ? "+" : ""}
          {formatUsd(out.roofing.sell - out.oldRoofing.sell)}).
        </p>
      )}

      <nav className="flex gap-1 border-b text-sm">
        {TABS.map(([k, name]) => (
          <Link key={k} href={`${base}?${query({ t: k })}`} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {name}
          </Link>
        ))}
      </nav>

      {tab === "takeoff" &&
        trades.map(([trade, name, t]) => (
          <section key={trade} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-semibold">{name}</h2>
              <span className="text-sm text-muted-foreground">
                sell {formatUsd(t.sell)} · payout {formatUsd(t.payout)} · profit {formatUsd(t.profit)}
              </span>
            </div>
            {t.missing.length > 0 && <p className="text-sm text-amber-700">MISSING: {t.missing.join("; ")}</p>}
            {t.picked.map((o) => {
              const ed = edited(trade, o);
              return (
                <form key={o.label} action={saveTakeoffAction} className="flex flex-col gap-2 rounded-lg border p-3">
                  {[
                    ["bid", bid],
                    ["book", book.id],
                    ["plan", plan.name],
                    ["trade", trade],
                    ["option", o.label],
                    ["back", backPath],
                  ].map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.kind === "ELEVATION" ? `Elevation ${o.label}` : o.label}</span>
                    <span className="text-xs text-muted-foreground">
                      sell {formatUsd(o.sell ?? 0)} · payout {formatUsd(o.payout ?? 0)} · profit {formatUsd(o.profit ?? 0)}
                    </span>
                    {ed.length > 0 && (
                      <Badge variant="blue" title={ed.map((e) => `${e.by} ${e.at.slice(0, 10)}: ${e.changes.join("; ")}`).join("\n")}>
                        edited in BTRpro · {ed.at(-1)!.by}
                      </Badge>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1 font-normal">Item</th>
                          <th className="w-28 py-1 text-right font-normal">Qty</th>
                          <th className="w-28 py-1 text-right font-normal">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...o.materials, ...Array.from({ length: canEdit ? 2 : 0 }, () => null)].map((m, i) => (
                          <tr key={m?.name ?? `new-${i}`} className="border-t">
                            <td className="py-1 pr-2">{canEdit ? <Input name="name" defaultValue={m?.name ?? ""} placeholder={m ? "" : "Add an item"} className="h-8" /> : m?.name}</td>
                            <td className="py-1 pr-2 text-right">{canEdit ? <Input name="qty" type="number" step="any" min="0" defaultValue={m ? fmtQty(m.qty) : ""} className="h-8 text-right" /> : m && fmtQty(m.qty)}</td>
                            <td className="py-1 text-right text-muted-foreground">{m?.cost != null ? formatUsd(m.cost) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-end gap-3">
                      {trade === "ROOFING" && (
                        <label className="text-xs text-muted-foreground">
                          Labor squares
                          <Input name="squares" type="number" step="any" min="0" defaultValue={o.squares != null ? Math.round(o.squares * 100) / 100 : ""} className="h-8 w-28" />
                        </label>
                      )}
                      <Button type="submit" variant="outline" size="sm">
                        Save takeoff
                      </Button>
                      <span className="text-xs text-muted-foreground">Changes this {o.kind === "ELEVATION" ? "elevation" : "option"} for every {plan.name} from now on; the price re-figures from the sheet&apos;s rates. Qty 0 removes a line.</span>
                    </div>
                  )}
                </form>
              );
            })}
          </section>
        ))}

      {tab === "order" && (
        <form action="/api/builders/plans/order" method="post" target="_blank" className="flex max-w-3xl flex-col gap-3">
          <p className="text-sm text-muted-foreground">Starts from the takeoff for this pick. Change anything for this house — it only changes this order, not the plan book — then make the PDF.</p>
          <input type="hidden" name="builder" value={book.company.name} />
          <label className="text-sm">
            Model
            <Input name="model" defaultValue={label} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Deliver to (lot / address)
              <Input name="address" />
            </label>
            <label className="text-sm">
              PO
              <Input name="po" />
            </label>
            <label className="text-sm">
              Delivery date
              <Input name="deliver" type="date" />
            </label>
            <label className="text-sm">
              Color
              <Input name="color" />
            </label>
          </div>
          {trades.map(([trade, name, t]) => (
            <div key={trade} className="flex flex-col gap-1">
              <h3 className="font-semibold">{name}</h3>
              {[...t.materials, null, null].map((m, i) => (
                <div key={m?.name ?? `blank-${trade}-${i}`} className="grid grid-cols-[1fr_6rem_5rem] gap-2">
                  <Input name="name" defaultValue={m?.name ?? ""} placeholder={m ? "" : "Add an item"} className="h-8" />
                  <Input name="qty" defaultValue={m ? fmtQty(m.qty) : ""} className="h-8 text-right" />
                  <Input name="unit" defaultValue={m ? unitFor(m.name, trade) : ""} className="h-8" />
                </div>
              ))}
            </div>
          ))}
          <label className="text-sm">
            Notes
            <Input name="notes" />
          </label>
          <Button type="submit" className="self-start">
            Make order PDF
          </Button>
        </form>
      )}

      {tab === "schedule" &&
        (user.role === "VIEWER" ? (
          <p className="text-sm text-muted-foreground">Viewers can&apos;t add to the schedule.</p>
        ) : (
          <form action={scheduleHouseAction} className="flex max-w-2xl flex-col gap-2 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Adds “{label}” to the residential ADD board — one line per trade with the sell and payout above.
            </p>
            {[
              ["bid", bid],
              ["book", book.id],
              ["plan", plan.name],
              ["e", sel.elevation],
              ["g", sel.garage],
              ["b", sel.basement],
              ["p", sel.porch ? "1" : "0"],
            ].map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <label className="text-sm">
              Lot / address
              <Input name="address" required placeholder="e.g. Lot 14 · 1234 Main St" />
            </label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="checkbox" name="trade" value="ROOFING" defaultChecked={out.roofing.picked.length > 0} disabled={!out.roofing.picked.length} /> Roofing ({formatUsd(out.roofing.sell)})
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" name="trade" value="GUTTERS" defaultChecked={out.gutters.picked.length > 0} disabled={!out.gutters.picked.length} /> Gutters ({formatUsd(out.gutters.sell)})
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                PO / VPO
                <Input name="po" />
              </label>
              <label className="text-sm">
                Color
                <Input name="color" />
              </label>
              <label className="text-sm">
                Crew
                <Input name="crew" />
              </label>
              <label className="text-sm">
                Super
                <Input name="super" />
              </label>
            </div>
            <label className="text-sm">
              Notes
              <Input name="notes" />
            </label>
            <Button type="submit" className="self-start">
              Add to schedule
            </Button>
          </form>
        ))}
    </div>
  );
}
