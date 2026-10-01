import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { cropOf, type Saved } from "@/lib/receipts/service";
import { loadBill } from "@/lib/bills/service";
import { ReceiptPhotos } from "@/components/receipts/photo-tools";
import { ApproveBill, DisputeBill, PaidBill, VoidBill } from "@/components/bills/forms";
import { recheckBillAction, reopenBillAction, setBillJobAction } from "@/app/bills/actions";
import { AutoRefresh } from "@/components/receipts/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { STATUS } from "@/components/bills/status";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" }) : "MISSING");
const FLAG: Record<string, string> = {
  NOT_ON_PO: "not on PO",
  MORE_THAN_ORDERED: "over ordered",
  MORE_THAN_DELIVERED: "billed not delivered",
  OVER_SHEET: "over sheet price",
  NO_AMOUNT: "no amount",
  ALREADY_BILLED: "already billed",
};

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(STAFF_ROLES);
  const { id } = await params;
  const loaded = await loadBill(id);
  if (!loaded) notFound();
  const { bill, data, order, match, ownerOver } = loaded;
  const scan = bill.scan;
  if (scan.status === "READING")
    return (
      <p className="text-sm">
        <AutoRefresh /> Reading the invoice…
      </p>
    );
  const files = scan.files as Saved[];
  const pages = files.map((f, i) => ({ index: i, pdf: f.type === "application/pdf", crop: cropOf(f), manual: f.crop != null, rotate: f.rotate ?? 0 }));
  const version = encodeURIComponent(JSON.stringify(files.map((f) => [f.crop ?? null, f.rotate ?? 0, f.auto ? 1 : 0])).slice(0, 300));
  const jobs = await prisma.project.findMany({ where: { status: { notIn: ["CLOSED", "LOST"] } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 300 });
  const open = ["NEEDS_LOOK", "READY"].includes(bill.status);
  const flagged = !match?.ready;
  const overLimit = ownerOver != null && (bill.total ?? 0) > ownerOver;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/bills" className="text-sm text-muted-foreground">
          ← Supplier bills
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {bill.vendor}
            {bill.invoiceNumber ? ` · ${bill.invoiceNumber}` : ""}
          </h1>
          <Badge variant={STATUS[bill.status]?.[1] ?? "outline"}>{STATUS[bill.status]?.[0] ?? bill.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Invoice {day(bill.invoiceDate)} · due {day(bill.dueDate)}
          {bill.terms ? ` (${bill.terms})` : ""} · total {usd(bill.total)} · {scan.source === "EMAIL" ? `emailed by ${scan.employee}` : `added by ${scan.employee}`}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <ReceiptPhotos rid={scan.id} pages={pages} version={version} canEdit={open} />

        <div className="flex min-w-0 flex-col gap-4">
          <form action={setBillJobAction} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="id" value={bill.id} />
            <span className="font-medium">Job</span>
            <Select name="projectId" defaultValue={bill.projectId ?? ""} disabled={!open} className="max-w-xs">
              <option value="">— pick the job —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </Select>
            {open && (
              <Button size="sm" variant="outline">
                Use this job
              </Button>
            )}
            {data?.match && <span className="text-xs text-muted-foreground">matched by {data.match.by}</span>}
          </form>
          <p className="text-sm">
            PO:{" "}
            {order ? (
              <Link href={`/projects/${order.projectId}/orders/${order.id}`} className="text-btr-link hover:underline">
                {order.number}
              </Link>
            ) : (
              <span className="text-amber-700">none matched</span>
            )}
          </p>

          {match && match.notes.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              {match.notes.map((n) => (
                <li key={n}>⚠ {n}</li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Item</th>
                  <th className="px-2 py-1.5 text-right">Ordered</th>
                  <th className="px-2 py-1.5 text-right">Delivered</th>
                  <th className="px-2 py-1.5 text-right">Billed</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                  <th className="px-2 py-1.5">Check</th>
                </tr>
              </thead>
              <tbody>
                {data?.lines.map((l, i) => {
                  const m = match?.lines[i];
                  return (
                    <tr key={i} className="border-t align-top">
                      <td className="px-2 py-1.5">
                        <div>{l.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.itemNumber ?? "no item #"} · {l.uom ?? "?"} · {l.check.note}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{m?.ordered ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{m?.delivered ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {l.quantity ?? "—"}
                        {m?.billedBefore ? <div className="text-xs text-muted-foreground">+{m.billedBefore} before</div> : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{usd(l.amount)}</td>
                      <td className="px-2 py-1.5">
                        {m?.flags.length ? (
                          <div className="flex flex-col gap-0.5">
                            {m.flags.map((f) => (
                              <Badge key={f} variant="red">
                                {FLAG[f] ?? f}
                              </Badge>
                            ))}
                            <span className="text-xs text-muted-foreground">{m.notes.join(" ")}</span>
                          </div>
                        ) : (
                          <Badge variant="green">✓</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t text-sm">
                <tr>
                  <td colSpan={4} className="px-2 py-1.5 text-right text-muted-foreground">
                    Tax
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{usd(data?.receipt.tax)}</td>
                  <td />
                </tr>
                <tr>
                  <td colSpan={4} className="px-2 py-1.5 text-right font-medium">
                    Total
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{usd(bill.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {match && match.unbilled.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Delivered on this PO but not on this bill (may come on another invoice): {match.unbilled.map((u) => `${u.description} (${u.delivered})`).join("; ")}
            </p>
          )}

          {open && (
            <section className="flex flex-col gap-3 rounded-md border p-3">
              {overLimit && !user.isOwner && <p className="text-sm text-amber-700">Over ${ownerOver!.toLocaleString()} — an owner has to approve this one.</p>}
              <ApproveBill id={bill.id} flagged={flagged} />
              <div className="flex flex-wrap items-start gap-3">
                <DisputeBill id={bill.id} defaultTo={order?.sentTo ?? null} />
                <form action={recheckBillAction}>
                  <input type="hidden" name="id" value={bill.id} />
                  <Button size="sm" variant="outline">
                    Re-check
                  </Button>
                </form>
              </div>
              <VoidBill id={bill.id} />
            </section>
          )}
          {bill.status === "DISPUTED" && (
            <section className="flex flex-col gap-2 rounded-md border border-red-300 p-3 text-sm">
              <p>
                Held {bill.disputedAt ? `on ${bill.disputedAt.toLocaleDateString("en-US")}` : ""}: {bill.disputeNote}
              </p>
              <form action={reopenBillAction}>
                <input type="hidden" name="id" value={bill.id} />
                <Button size="sm" variant="outline">
                  Fixed — check it again
                </Button>
              </form>
            </section>
          )}
          {(bill.status === "APPROVED" || bill.status === "PAID") && (
            <section className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <p>
                Approved by {bill.approvedBy} {bill.approvedAt?.toLocaleDateString("en-US")}
                {bill.approveNote ? ` — “${bill.approveNote}”` : ""}
                {bill.ownerApprovedBy ? ` · owner approved by ${bill.ownerApprovedBy}` : ""}
              </p>
              {bill.qboStatus && <p className="text-muted-foreground">{bill.qboStatus}</p>}
              {bill.status === "APPROVED" ? <PaidBill id={bill.id} /> : <p className="text-green-700">Paid {bill.paidAt?.toLocaleDateString("en-US")}{bill.paidRef ? ` · ${bill.paidRef}` : ""}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
