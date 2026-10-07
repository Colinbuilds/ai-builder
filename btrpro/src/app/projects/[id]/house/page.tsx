import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts, loadCosting } from "@/lib/costing/service";
import { actualSplit } from "@/lib/costing/split";
import { houseName, houseOf } from "@/lib/builders/house";
import { MoneyDonut, moneySlices } from "@/components/charts/money-donut";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatUsd } from "@/lib/utils";
import { billHouseAction } from "./actions";

const TABS = [
  ["estimate", "Estimate"],
  ["invoice", "Invoice"],
  ["profit", "Profit"],
] as const;
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const unitFor = (name: string, trade: string) => (trade === "GUTTERS" && /gutter|downspout|accessor/i.test(name) ? "LF" : "EA");

export default async function HousePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, builderHouse: true, estimatorId: true, salespersonId: true, invoices: { orderBy: { issueDate: "desc" }, select: { id: true, number: true, status: true, subtotal: true, issueDate: true, kind: true } }, prodLines: { select: { id: true, type: true, board: true, crew: true, startDate: true } } },
  });
  if (!p) notFound();
  const h = houseOf(p);
  if (!h) notFound();
  const seeMoney = canSeeCosts(user, p);
  const tab = TABS.some(([k]) => k === sp.t) ? sp.t! : "estimate";
  const trades = (["ROOFING", "GUTTERS"] as const).filter((t) => h.trades[t]);
  const sell = trades.reduce((a, t) => a + h.trades[t]!.sell, 0);
  const planned = { materials: 0, tax: 0, labor: 0, other: 0 };
  for (const t of trades) {
    planned.materials += h.trades[t]!.materials;
    planned.tax += h.trades[t]!.tax;
    planned.labor += h.trades[t]!.payout;
  }
  const plannedPie = moneySlices({ revenue: sell, ...planned });
  const plannedProfit = trades.reduce((a, t) => a + h.trades[t]!.profit, 0);
  const costing = seeMoney && tab === "profit" ? await loadCosting(id) : null;
  const actual = costing ? actualSplit(costing.project.costs) : null;
  const spent = actual ? actual.materials + actual.tax + actual.labor + actual.other : 0;
  const actualPie = actual ? moneySlices({ revenue: costing!.pnl.revenue ?? sell, ...actual }) : null;
  const billed = p.invoices.filter((i) => i.status !== "VOID").reduce((a, i) => a + i.subtotal, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{h.label}</h2>
          <p className="text-sm text-muted-foreground">
            {[h.builder, houseName(h), h.city, h.permit && `Permit ${h.permit}`, h.color && `Color: ${h.color}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Link href={`/builders/${h.builderId}/plans/${encodeURIComponent(h.plan)}?book=${h.bookId}&e=${encodeURIComponent(h.sel.elevation)}&g=${h.sel.garage}&b=${h.sel.basement}&p=${h.sel.porch ? 1 : 0}`} className="text-sm text-btr-link underline">
          Open this model in the plan book →
        </Link>
      </div>

      {sp.err && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{sp.err}</p>}
      {sp.ok && <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">{sp.ok}</p>}

      <nav className="flex gap-1 border-b">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/projects/${id}/house?t=${k}`} className={`-mb-px border-b-2 px-4 py-2 text-base ${tab === k ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "estimate" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Big label={`Sell to ${h.builder}`} value={formatUsd(sell)} />
            <Big label="On the schedule" value={p.prodLines.length ? p.prodLines.map((l) => `${l.type ?? ""}${l.crew ? ` (${l.crew})` : ""}`).join(", ") : "Not yet"} small />
            <Big label="Options" value={[`Elev ${h.sel.elevation}`, h.sel.garage === "3" ? "3 car" : "2 car", h.sel.basement === "DLWO" ? "Daylight / walkout" : "Standard basement", h.sel.porch ? "Rear porch" : null].filter(Boolean).join(" · ")} small />
          </div>
          {trades.map((t) => {
            const n = h.trades[t]!;
            const mats = h.materials[t] ?? [];
            return (
              <section key={t} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold">{t === "ROOFING" ? "Roofing" : "Gutters"}</h3>
                  <span className="text-sm text-muted-foreground">
                    {n.options.join(" + ")} · sell {formatUsd(n.sell)} · crew payout {formatUsd(n.payout)}
                  </span>
                </div>
                <Table>
                  <THead>
                    <TR>
                      <TH>Item</TH>
                      <TH className="text-right">Qty</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {mats.map((m) => (
                      <TR key={m.name}>
                        <TD>{m.name}</TD>
                        <TD className="text-right">{fmtQty(m.qty)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <form action="/api/builders/plans/order" method="post" target="_blank" className="flex flex-wrap gap-2">
                  <input type="hidden" name="builder" value={h.builder} />
                  <input type="hidden" name="model" value={`${h.label} — ${t === "ROOFING" ? "Roofing" : "Gutters"}`} />
                  <input type="hidden" name="address" value={[houseName(h), h.city].filter(Boolean).join(", ")} />
                  <input type="hidden" name="po" value="" />
                  <input type="hidden" name="deliver" value="" />
                  <input type="hidden" name="color" value={h.color ?? ""} />
                  <input type="hidden" name="notes" value={h.permit ? `Permit ${h.permit}` : ""} />
                  {mats.map((m) => (
                    <span key={m.name} className="hidden">
                      <input name="name" defaultValue={m.name} />
                      <input name="qty" defaultValue={fmtQty(m.qty)} />
                      <input name="unit" defaultValue={unitFor(m.name, t)} />
                    </span>
                  ))}
                  <Button type="submit" variant="outline">
                    Print the {t === "ROOFING" ? "roofing" : "gutter"} order (PDF)
                  </Button>
                </form>
              </section>
            );
          })}
          <p className="text-xs text-muted-foreground">To change quantities for this model from now on, use “Open this model in the plan book” → Takeoff. To change just this house&apos;s order, use the model&apos;s Order tab.</p>
        </div>
      )}

      {tab === "invoice" && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Big label="House total" value={formatUsd(sell)} />
            <Big label="Invoiced so far" value={formatUsd(billed)} />
            <Big label="Left to invoice" value={formatUsd(Math.max(0, sell - billed))} />
          </div>
          {billed < sell - 0.5 && ["ADMIN", "ESTIMATOR", "OFFICE"].includes(user.role) && (
            <form action={billHouseAction}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" size="lg">
                {billed ? `Invoice the balance (${formatUsd(sell - billed)})` : `Make the ${h.builder} invoice for this house (${formatUsd(sell)})`}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">One line per trade at the plan book price. It&apos;s saved as a draft — you send it from Invoices &amp; payments.</p>
            </form>
          )}
          {p.invoices.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Date</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {p.invoices.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <Link href={`/projects/${id}/billing`} className="text-btr-link underline">
                        {i.number}
                      </Link>
                    </TD>
                    <TD>{formatDate(i.issueDate)}</TD>
                    <TD>
                      <Badge variant="outline">{i.status.toLowerCase()}</Badge>
                    </TD>
                    <TD className="text-right">{formatUsd(i.subtotal)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          )}
          <Link href={`/projects/${id}/billing`} className="text-sm text-btr-link underline">
            Invoices &amp; payments (send, record payment) →
          </Link>
        </div>
      )}

      {tab === "profit" &&
        (!seeMoney ? (
          <p className="text-sm text-muted-foreground">Profit is visible to Admins and to the estimator or salesperson on this job.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Big label="Sell" value={formatUsd(sell)} />
              <Big label="Planned profit" value={`${formatUsd(plannedProfit)} (${sell ? Math.round((plannedProfit / sell) * 1000) / 10 : 0}%)`} />
              <Big label="Spent so far" value={formatUsd(spent)} />
              <Big label={spent > 0 ? "Profit if nothing else is spent" : "Profit so far"} value={spent > 0 ? formatUsd((costing?.pnl.revenue ?? sell) - spent) : "— no costs yet"} small={spent <= 0} />
            </div>
            {spent > planned.materials + planned.tax + planned.labor + 0.005 && (
              <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                Costs so far are {formatUsd(spent - planned.materials - planned.tax - planned.labor)} over the plan book. Check the receipts and bills on this house.
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <MoneyDonut title="The plan (from the plan book)" slices={plannedPie.slices} loss={plannedPie.loss} center={formatUsd(sell)} centerNote="sell" />
              {actualPie && spent > 0 ? (
                <MoneyDonut title="Actual so far (receipts, bills, crew pay)" slices={actualPie.slices} loss={actualPie.loss} center={formatUsd(costing!.pnl.revenue ?? sell)} centerNote="sell" />
              ) : (
                <div className="flex items-center rounded-lg border p-4 text-sm text-muted-foreground">No costs on this job yet. Scanned receipts, supplier bills and crew pay show up here as they come in.</div>
              )}
            </div>
            <Link href={`/projects/${id}/costs`} className="text-sm text-btr-link underline">
              Full profit analysis (every cost line) →
            </Link>
          </div>
        ))}
    </div>
  );
}

function Big({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={small ? "text-sm font-medium" : "text-2xl font-semibold tabular-nums"}>{value}</div>
    </div>
  );
}
