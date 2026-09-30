import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  DROP_LOCATIONS,
  WINDOWS,
  loadOrder,
  sendProblems,
} from "@/lib/orders/service";
import { canSeeCosts } from "@/lib/costing/service";
import {
  AddOrderLine,
  CancelOrder,
  ConfirmOrder,
  EditLineQty,
  OrderDetails,
  ReceiveOrder,
  ReturnLine,
  SendOrder,
} from "@/components/orders/forms";
import { OrderStatusBadge } from "@/components/orders/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string; oid: string }>;
}) {
  const user = await requireUser();
  const { id, oid } = await params;
  const o = await loadOrder(oid).catch(() => null);
  if (!o || o.projectId !== id) notFound();
  const access = await prisma.project.findUniqueOrThrow({
    where: { id },
    select: { estimatorId: true, salespersonId: true },
  });
  const showCost = canSeeCosts(user, access);
  const canEdit = user.role !== "VIEWER";
  const draft = o.status === "DRAFT";
  const live = ["SENT", "CONFIRMED", "PARTIAL", "DELIVERED"].includes(o.status);
  const ids = { projectId: id, orderId: o.id };
  const expected = o.lines.reduce((a, l) => a + (l.extended ?? 0), 0);
  const unpriced = o.lines.filter((l) => l.extended == null).length;
  const s = await getSettings();
  const docs = await prisma.document.findMany({
    where: {
      id: {
        in: o.tickets.map((t) => t.documentId).filter((x): x is string => !!x),
      },
    },
    select: { id: true, fileName: true },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/projects/${id}/orders`}
          className="text-sm text-muted-foreground"
        >
          ← Orders
        </Link>
        <h2 className="font-mono text-lg font-semibold">{o.number}</h2>
        <OrderStatusBadge status={o.status} />
        <span className="text-sm text-muted-foreground">
          {o.supplier}
          {o.sentAt &&
            ` · sent ${formatDate(o.sentAt)} by ${o.sentBy}${o.sentTo ? ` to ${o.sentTo}` : ""}`}
          {o.cancelReason && ` · cancelled: ${o.cancelReason}`}
        </span>
        <a
          href={`/api/orders/${o.id}/pdf`}
          className="ml-auto text-sm underline"
          target="_blank"
        >
          PDF
        </a>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Delivery</h3>
        <OrderDetails
          ids={ids}
          o={o}
          drops={DROP_LOCATIONS}
          windows={WINDOWS}
          editable={
            canEdit &&
            (draft || o.status === "SENT" || o.status === "CONFIRMED")
          }
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Lines</h3>
        <Table>
          <THead>
            <TR>
              <TH>Item #</TH>
              <TH>Description</TH>
              <TH className="text-right">Qty</TH>
              {live && <TH className="text-right">Received</TH>}
              {showCost && <TH className="text-right">Expected cost</TH>}
              <TH />
            </TR>
          </THead>
          <TBody>
            {o.lines.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">{l.itemNumber ?? "—"}</TD>
                <TD>
                  {l.description}
                  {l.note && (
                    <span className="block text-xs text-amber-700 dark:text-amber-400">
                      {l.note}
                    </span>
                  )}
                  {l.backordered > 0 && (
                    <span className="block text-xs text-amber-700 dark:text-amber-400">
                      {l.backordered} {l.unit} backordered, due{" "}
                      {formatDate(l.backorderDate)}
                    </span>
                  )}
                </TD>
                <TD className="text-right">
                  {draft && canEdit ? (
                    <div className="flex items-center justify-end gap-1">
                      <EditLineQty
                        ids={ids}
                        lineId={l.id}
                        quantity={l.quantity}
                      />
                      <span className="w-8 text-left text-xs">{l.unit}</span>
                    </div>
                  ) : (
                    <span className="tabular-nums">
                      {l.quantity ?? (
                        <span className="font-semibold text-red-700">
                          MISSING
                        </span>
                      )}{" "}
                      {l.unit}
                    </span>
                  )}
                </TD>
                {live && (
                  <TD className="text-right tabular-nums">
                    <span
                      className={
                        l.quantity != null && l.received < l.quantity
                          ? "text-amber-700"
                          : ""
                      }
                    >
                      {l.received}
                    </span>
                    {l.returned > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {l.returned} returned
                      </span>
                    )}
                  </TD>
                )}
                {showCost && (
                  <TD className="text-right">
                    {l.extended == null ? (
                      <span className="text-xs text-muted-foreground">
                        unpriced
                      </span>
                    ) : (
                      <span className="tabular-nums">{usd(l.extended)}</span>
                    )}
                    {l.priceFormula && (
                      <span className="block text-xs text-muted-foreground">
                        {l.priceFormula}
                      </span>
                    )}
                  </TD>
                )}
                <TD>
                  {canEdit && live && l.received > l.returned && (
                    <ReturnLine ids={ids} lineId={l.id} />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {showCost && (
          <p className="text-sm">
            Expected from price sheets: <strong>{usd(expected)}</strong>
            {unpriced > 0 && (
              <span className="text-muted-foreground">
                {" "}
                + {unpriced} unpriced line(s) (CALL, not on a sheet, or unit
                mismatch)
              </span>
            )}
            {o.commitment && (
              <span className="text-muted-foreground">
                {" "}
                · committed {usd(o.commitment.amount)}, billed{" "}
                {usd(o.commitment.bills.reduce((a, b) => a + b.amount, 0))} (
                {o.commitment.status.toLowerCase()})
              </span>
            )}
          </p>
        )}
        {draft && canEdit && <AddOrderLine ids={ids} />}
      </section>

      {draft && canEdit && (
        <SendOrder
          ids={ids}
          problems={sendProblems(o)}
          defaultTo={s.supplierOrderEmail}
          pdfHref={`/api/orders/${o.id}/pdf`}
        />
      )}

      {live && canEdit && (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Branch confirmation</h3>
            <ConfirmOrder
              ids={ids}
              supplierOrderNumber={o.supplierOrderNumber}
              confirmedDate={o.confirmedDate}
            />
          </section>
          {o.status !== "DELIVERED" && (
            <ReceiveOrder ids={ids} lines={o.lines} />
          )}
        </>
      )}

      {o.tickets.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">Delivery tickets</h3>
          {o.tickets.map((t) => {
            const d = docs.find((x) => x.id === t.documentId);
            return (
              <p key={t.id} className="text-sm">
                {formatDate(t.date)} ·{" "}
                {t.ticketNumber ? `ticket ${t.ticketNumber}` : "no ticket #"} ·
                received by {t.receivedBy}
                {t.note && ` · ${t.note}`}
                {d && (
                  <>
                    {" · "}
                    <a className="underline" href={`/api/documents/${d.id}`}>
                      {d.fileName}
                    </a>
                  </>
                )}
              </p>
            );
          })}
        </section>
      )}

      {canEdit && ["DRAFT", "SENT", "CONFIRMED"].includes(o.status) && (
        <CancelOrder ids={ids} draft={draft} />
      )}
      {showCost && live && (
        <p className="text-xs text-muted-foreground">
          Invoices imported on Job costing with PO {o.number} (or ABC order #)
          bill this order automatically.
        </p>
      )}
    </div>
  );
}
