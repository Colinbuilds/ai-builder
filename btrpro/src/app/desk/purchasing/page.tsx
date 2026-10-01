import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PURCHASING_ROLES } from "@/lib/roles";
import { purchasingDesk } from "@/lib/desks";
import { Panel, axLink } from "@/components/shell/panel";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "—");
function Count({ n, tone = "default" }: { n: number; tone?: "default" | "warn" | "bad" }) {
  const c = !n ? "bg-muted text-muted-foreground" : tone === "bad" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : tone === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-btr-blue-soft text-btr-blue-dark";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${c}`}>{n}</span>;
}
const Empty = ({ children }: { children: React.ReactNode }) => <li className="px-4 py-3 text-muted-foreground">{children}</li>;

export default async function PurchasingDesk() {
  await requireUser(PURCHASING_ROLES);
  const d = await purchasingDesk();
  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Purchasing desk</h1>
        <p className="text-sm text-muted-foreground">Orders to place, deliveries coming, backorders and credits to chase, and price problems.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2">Sold jobs with no order <Count n={d.needOrders.length} tone="warn" /></span>} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.needOrders.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 px-4 py-2">
                <Link href={`/projects/${p.id}/orders`} className={axLink}>
                  {p.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {p.status.toLowerCase().replace("_", " ")} since {day(p.statusChangedAt)}
                </span>
              </li>
            ))}
            {!d.needOrders.length && <Empty>Every sold job has an order.</Empty>}
            {d.drafts.map((o) => (
              <li key={o.id} className="flex justify-between gap-2 px-4 py-2">
                <Link href={`/projects/${o.project.id}/orders/${o.id}`} className={axLink}>
                  Draft {o.number} not sent · {o.project.name}
                </Link>
                <span className="text-xs text-muted-foreground">started {day(o.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={<span className="flex items-center gap-2">Deliveries today &amp; tomorrow <Count n={d.deliveries.length} /></span>} right={<Link href="/deliveries" className={axLink}>Delivery board</Link>} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.deliveries.map((o) => (
              <li key={o.id} className="px-4 py-2">
                <Link href={`/projects/${o.project.id}/orders/${o.id}`} className={`font-medium ${axLink}`}>
                  {o.number} · {o.project.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {day(o.confirmedDate ?? o.requestedDate)}
                  {o.confirmedDate ? " (confirmed)" : " (requested — not confirmed)"}
                  {o.deliveryWindow ? ` · ${o.deliveryWindow.toLowerCase().replace("_", " ")}` : ""}
                  {o.dropLocation ? ` · drop: ${o.dropLocation}` : ""}
                  {o.siteContact ? ` · ${o.siteContact}` : ""}
                  {o.project.address ? ` · ${o.project.address}` : ""}
                </div>
              </li>
            ))}
            {!d.deliveries.length && <Empty>No deliveries today or tomorrow.</Empty>}
          </ul>
        </Panel>

        <Panel title={<span className="flex items-center gap-2">Backorders <Count n={d.backorders.length} tone={d.backorders.some((b) => b.overdue) ? "bad" : "default"} /></span>} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.backorders.map((b) => (
              <li key={b.id} className="flex justify-between gap-2 px-4 py-2">
                <Link href={`/projects/${b.order.project.id}/orders/${b.order.id}`} className={axLink}>
                  {b.backordered} {b.unit ?? ""} {b.description} · {b.order.project.name}
                </Link>
                <span className={`text-xs ${b.overdue ? "font-medium text-red-600" : "text-muted-foreground"}`}>{b.backorderDate ? `${b.overdue ? "was due" : "due"} ${day(b.backorderDate)}` : "no date — ask ABC"}</span>
              </li>
            ))}
            {!d.backorders.length && <Empty>Nothing on backorder.</Empty>}
          </ul>
        </Panel>

        <Panel title={<span className="flex items-center gap-2">Returns still waiting on a credit <Count n={d.creditsMissing.length} tone="warn" /></span>} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.creditsMissing.map((r) => (
              <li key={r.id} className="px-4 py-2">
                <Link href={`/projects/${r.order.project.id}/orders/${r.order.id}`} className={axLink}>
                  {r.returned} {r.unit ?? ""} {r.description}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {r.order.number} · {r.order.project.name} · no credit memo on file
                </div>
              </li>
            ))}
            {!d.creditsMissing.length && <Empty>No open returns.</Empty>}
          </ul>
        </Panel>

        <Panel title={<span className="flex items-center gap-2">Bills over sheet price <Count n={d.priceProblems.length} tone="bad" /></span>} right={<Link href="/bills?tab=look" className={axLink}>Open bills</Link>} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.priceProblems.map((b) => (
              <li key={b.id} className="px-4 py-2">
                <Link href={`/bills/${b.id}`} className={axLink}>
                  {b.vendor} {b.invoiceNumber ?? ""}
                </Link>
              </li>
            ))}
            {!d.priceProblems.length && <Empty>No price problems.</Empty>}
          </ul>
        </Panel>

        <Panel title={<span className="flex items-center gap-2">Price sheets expiring <Count n={d.sheets.length} tone={d.sheets.some((s) => s.expired) ? "bad" : "warn"} /></span>} right={<Link href="/library/sheets" className={axLink}>Price sheets</Link>} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.sheets.map((s) => (
              <li key={s.id} className="flex justify-between gap-2 px-4 py-2">
                <span>
                  {s.code} · {s.name}
                </span>
                <span className={`text-xs ${s.expired ? "font-medium text-red-600" : "text-amber-700"}`}>
                  {s.expired ? "expired" : "expires"} {day(s.expirationDate)}
                </span>
              </li>
            ))}
            {!d.sheets.length && <Empty>All sheets current for 30+ days.</Empty>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
