import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { deliveryBoard, WINDOWS } from "@/lib/orders/service";
import { OrderStatusBadge } from "@/components/orders/status";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export default async function Deliveries() {
  await requireUser();
  const orders = await deliveryBoard();
  const today = dayKey(new Date());
  const overdue = orders.filter((o) => o.when && dayKey(o.when) < today && o.status !== "PARTIAL");
  const backorders = orders.flatMap((o) => o.backorders.map((l) => ({ o, l })));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Deliveries</h1>
        <p className="text-sm text-muted-foreground">Every open material order across jobs, by delivery date. Confirmed dates win over requested ones.</p>
      </div>
      {overdue.length > 0 && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {overdue.length} order(s) past their delivery date and not received: {overdue.map((o) => o.number).join(", ")}. Receive them or call the branch.
        </p>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Job</TH>
            <TH>PO</TH>
            <TH>Drop</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {orders.map((o) => (
            <TR key={o.id} className={o.when && dayKey(o.when) === today ? "bg-blue-50 dark:bg-blue-950/40" : ""}>
              <TD className="whitespace-nowrap">
                {o.when ? formatDate(o.when) : <span className="text-red-700">no date</span>}
                <span className="block text-xs text-muted-foreground">
                  {o.deliveryWindow ? WINDOWS[o.deliveryWindow] : ""}
                  {o.confirmedDate ? " · confirmed" : " · requested"}
                </span>
              </TD>
              <TD>
                <Link href={`/projects/${o.project.id}/orders/${o.id}`} className="font-medium hover:underline">
                  {o.project.name}
                </Link>
                <span className="block text-xs text-muted-foreground">{o.project.address}</span>
              </TD>
              <TD className="font-mono text-xs">
                {o.number}
                {o.supplierOrderNumber && <span className="block">ABC {o.supplierOrderNumber}</span>}
              </TD>
              <TD>
                {o.dropLocation}
                {o.siteContact && <span className="block text-xs text-muted-foreground">{o.siteContact}</span>}
              </TD>
              <TD>
                <OrderStatusBadge status={o.status} />
              </TD>
            </TR>
          ))}
          {orders.length === 0 && (
            <TR>
              <TD colSpan={5} className="text-muted-foreground">
                Nothing on order.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Backorders</h2>
        {backorders.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          backorders.map(({ o, l }) => (
            <p key={l.id} className="text-sm">
              <Badge variant="amber">{formatDate(l.backorderDate)}</Badge> {l.backordered} {l.unit} {l.description} for{" "}
              <Link href={`/projects/${o.project.id}/orders/${o.id}`} className="underline">
                {o.project.name}
              </Link>{" "}
              ({o.number})
            </p>
          ))
        )}
      </section>
    </div>
  );
}
