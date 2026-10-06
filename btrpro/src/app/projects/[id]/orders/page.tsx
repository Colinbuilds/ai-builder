import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { showForm17Banner } from "@/lib/projects/workflow";
import { NewOrder } from "@/components/orders/forms";
import { OrderStatusBadge } from "@/components/orders/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { exemptForm } from "@/lib/company-profile";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [project, orders, estimates] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id },
      select: { isPublic: true, isTaxExempt: true, form17Status: true },
    }),
    prisma.materialOrder.findMany({
      where: { projectId: id },
      include: { lines: { select: { backordered: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.estimate.findMany({
      where: { projectId: id },
      select: { id: true, name: true, revision: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return (
    <div className="flex flex-col gap-4">
      {showForm17Banner(project) && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          PUB-01: public, tax-exempt job. Orders can be drafted, but none can be
          sent until the {exemptForm().short} is executed.
        </p>
      )}
      {user.role !== "VIEWER" && (
        <NewOrder
          projectId={id}
          estimates={estimates.map((e) => ({
            id: e.id,
            label: `${e.name} (rev ${e.revision})`,
          }))}
        />
      )}
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No material orders yet. Start one from the estimate: same item numbers
          and quantities, then set the delivery details and send it to the
          branch.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>PO</TH>
              <TH>Status</TH>
              <TH>Delivery</TH>
              <TH>Drop</TH>
              <TH>ABC #</TH>
            </TR>
          </THead>
          <TBody>
            {orders.map((o) => (
              <TR key={o.id}>
                <TD>
                  <Link
                    href={`/projects/${id}/orders/${o.id}`}
                    className="font-mono font-medium hover:underline"
                  >
                    {o.number}
                  </Link>
                </TD>
                <TD>
                  <OrderStatusBadge status={o.status} />
                  {o.lines.some((l) => l.backordered > 0) && (
                    <span className="ml-1 text-xs text-amber-700">
                      backorder
                    </span>
                  )}
                </TD>
                <TD>
                  {formatDate(o.confirmedDate ?? o.requestedDate)}
                  {o.confirmedDate && (
                    <span className="ml-1 text-xs text-green-700">
                      confirmed
                    </span>
                  )}
                </TD>
                <TD>{o.dropLocation ?? "—"}</TD>
                <TD>{o.supplierOrderNumber ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
