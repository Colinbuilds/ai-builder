import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts } from "@/lib/costing/service";
import {
  loadBilling,
  invoiceUrl,
  stripeConfigured,
} from "@/lib/billing/service";
import {
  balanceDue,
  INVOICE_KIND_LABEL,
  PAYMENT_METHODS,
} from "@/lib/billing/math";
import { getSettings } from "@/lib/settings";
import { qboConnected } from "@/lib/integrations/quickbooks";
import {
  DeletePayment,
  NewInvoice,
  RecordPayment,
  SendInvoice,
  VoidInvoice,
} from "@/components/billing/invoice-forms";
import {
  CoFromEstimate,
  ImportCo,
  SendCo,
} from "@/components/billing/change-order-forms";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const usd = (n: number | null) =>
  n == null
    ? "MISSING"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const d = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "UTC" });
const STATUS: Record<string, "outline" | "blue" | "amber" | "green" | "red"> = {
  DRAFT: "outline",
  SENT: "blue",
  PARTIAL: "amber",
  PAID: "green",
  VOID: "red",
};

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function BillingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const access = await prisma.project.findUnique({
    where: { id },
    select: { estimatorId: true, salespersonId: true },
  });
  if (!access) notFound();
  if (!canSeeCosts(user, access))
    return (
      <p className="text-sm text-muted-foreground">
        Billing is visible to Admins and to the estimator or salesperson on this
        job.
      </p>
    );
  const [
    { project, invoices, summary },
    s,
    qbo,
    changeOrders,
    estimates,
    contact,
  ] = await Promise.all([
    loadBilling(id),
    getSettings(),
    qboConnected(),
    prisma.changeOrder.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.estimate.findMany({
      where: { projectId: id },
      select: { id: true, name: true, revision: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.projectContact.findFirst({
      where: { projectId: id, isPrimary: true },
      include: { contact: true },
    }),
  ]);
  const canEdit = user.role !== "VIEWER";
  const isAdmin = user.role === "ADMIN";
  const sold = !["LEAD", "ESTIMATING", "SUBMITTED", "LOST"].includes(
    project.status,
  );
  const baselineId = (project.costBaseline as { estimateId?: string } | null)
    ?.estimateId;
  const coEmail = contact?.contact.email ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Contract (incl. approved COs)"
          value={usd(summary.revenue)}
        />
        <Stat label="Billed" value={usd(summary.billedWork)} />
        <Stat label="Left to bill" value={usd(summary.unbilled)} />
        <Stat label="Retainage held" value={usd(summary.retainageHeld)} />
        <Stat label="Paid" value={usd(summary.paid)} />
        <Stat
          label="Open AR"
          value={usd(summary.openAR)}
          sub={
            summary.remaining != null
              ? `${usd(summary.remaining)} still owed overall`
              : undefined
          }
        />
      </section>
      {summary.revenue == null && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Contract amount is MISSING. Set it on the Overview (or have the
          customer sign the proposal) before billing.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Invoices</h2>
          {qbo && (
            <span className="text-xs text-muted-foreground">
              Sent invoices and payments are pushed to QuickBooks.
            </span>
          )}
        </div>
        {canEdit && sold && summary.revenue != null && (
          <NewInvoice
            projectId={id}
            commercial={project.market === "COMMERCIAL"}
            retainagePct={project.retainagePct}
          />
        )}
        {canEdit && !sold && (
          <p className="text-sm text-muted-foreground">
            Invoices go on sold jobs. Move the job to Sold first.
          </p>
        )}
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {invoices.map((inv) => {
              const bal = balanceDue(inv);
              return (
                <div
                  key={inv.id}
                  className={`flex flex-col gap-2 rounded-md border p-3 ${inv.status === "VOID" ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">
                      {inv.number}
                    </span>
                    <Badge variant={STATUS[inv.status]}>
                      {inv.status.toLowerCase()}
                    </Badge>
                    <span className="text-sm">
                      {INVOICE_KIND_LABEL[inv.kind]}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      issued {d(inv.issueDate)} · due {d(inv.dueDate)}
                      {inv.viewedAt && ` · viewed ${d(inv.viewedAt)}`}
                    </span>
                    <span className="ml-auto flex gap-3 text-xs">
                      <a
                        className="underline"
                        href={`/api/invoices/${inv.id}`}
                        target="_blank"
                      >
                        PDF
                      </a>
                      {inv.status !== "DRAFT" && (
                        <a
                          className="underline"
                          href={invoiceUrl(inv.token)}
                          target="_blank"
                        >
                          Customer link
                        </a>
                      )}
                    </span>
                  </div>
                  <Table>
                    <TBody>
                      {(
                        inv.lines as { description: string; amount: number }[]
                      ).map((l, i) => (
                        <TR key={i}>
                          <TD>{l.description}</TD>
                          <TD className="text-right tabular-nums">
                            {usd(l.amount)}
                          </TD>
                        </TR>
                      ))}
                      {inv.retainage > 0 && (
                        <TR>
                          <TD className="text-muted-foreground">
                            Retainage withheld ({inv.retainagePct}%)
                          </TD>
                          <TD className="text-right tabular-nums">
                            −{usd(inv.retainage)}
                          </TD>
                        </TR>
                      )}
                      <TR>
                        <TD className="font-medium">Amount due</TD>
                        <TD className="text-right font-medium tabular-nums">
                          {usd(inv.amountDue)}
                        </TD>
                      </TR>
                      {inv.payments.map((p) => (
                        <TR key={p.id}>
                          <TD className="text-sm text-muted-foreground">
                            {d(p.date)} ·{" "}
                            {PAYMENT_METHODS[p.method] ?? p.method}
                            {p.reference && ` #${p.reference}`} · {p.recordedBy}
                            {p.surcharge > 0 &&
                              ` · +${usd(p.surcharge)} surcharge`}{" "}
                            {isAdmin && <DeletePayment id={p.id} />}
                          </TD>
                          <TD className="text-right text-sm tabular-nums text-muted-foreground">
                            −{usd(p.amount)}
                          </TD>
                        </TR>
                      ))}
                      {inv.status !== "DRAFT" && inv.status !== "VOID" && (
                        <TR>
                          <TD className="font-medium">Balance</TD>
                          <TD className="text-right font-medium tabular-nums">
                            {usd(bal)}
                          </TD>
                        </TR>
                      )}
                    </TBody>
                  </Table>
                  {inv.override && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Over contract: {inv.override}
                    </p>
                  )}
                  {inv.voidReason && (
                    <p className="text-xs text-muted-foreground">
                      Void: {inv.voidReason}
                    </p>
                  )}
                  {inv.qboError && (
                    <p className="text-xs text-destructive">
                      QuickBooks: {inv.qboError}
                    </p>
                  )}
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-3">
                      {inv.status === "DRAFT" && (
                        <SendInvoice
                          id={inv.id}
                          name={inv.billTo}
                          email={inv.billToEmail}
                        />
                      )}
                      {(inv.status === "SENT" || inv.status === "PARTIAL") && (
                        <RecordPayment
                          invoiceId={inv.id}
                          balance={bal}
                          surchargePct={s.cardSurchargePct}
                        />
                      )}
                      {inv.status !== "VOID" && inv.payments.length === 0 && (
                        <VoidInvoice
                          id={inv.id}
                          draft={inv.status === "DRAFT"}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!stripeConfigured() && (
          <p className="text-xs text-muted-foreground">
            Online card payment is off (STRIPE_SECRET_KEY not set). Customers
            see your remit-to instructions instead.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Change orders for signature</h2>
        {changeOrders.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>What</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {changeOrders.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-xs">{c.number}</TD>
                  <TD className="max-w-md">
                    {c.description}
                    {c.priceFormula && (
                      <span className="block text-xs text-muted-foreground">
                        {c.priceFormula}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {c.kind === "CREDIT" ? `−${usd(c.amount)}` : usd(c.amount)}
                  </TD>
                  <TD>
                    <Badge
                      variant={
                        c.status === "APPROVED"
                          ? "green"
                          : c.status === "REJECTED"
                            ? "red"
                            : "amber"
                      }
                    >
                      {c.status.toLowerCase()}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">
                      {c.signedAt
                        ? `signed by ${c.signerName}`
                        : c.sentAt
                          ? `sent ${d(c.sentAt)}${c.sentTo ? ` to ${c.sentTo}` : ""}`
                          : (c.decidedBy ?? "")}
                      {c.declineReason && ` — ${c.declineReason}`}
                    </span>
                  </TD>
                  <TD>
                    {c.signedDocumentId ? (
                      <a
                        className="text-xs underline"
                        href={`/api/documents/${c.signedDocumentId}`}
                        target="_blank"
                      >
                        Signed copy
                      </a>
                    ) : c.status === "PENDING" &&
                      c.kind !== "CREDIT" &&
                      canEdit ? (
                      <SendCo id={c.id} email={c.sentTo ?? coEmail} />
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {canEdit && (
          <>
            <CoFromEstimate
              projectId={id}
              estimates={estimates
                .filter((e) => e.id !== baselineId)
                .map((e) => ({
                  id: e.id,
                  label: `${e.name} (rev ${e.revision})`,
                }))}
              defaultMarkup={s.markupPct}
            />
            <ImportCo projectId={id} />
            <p className="text-xs text-muted-foreground">
              Enter a change order by hand, or approve one the customer signed
              on paper, on the{" "}
              <Link className="underline" href={`/projects/${id}/costs`}>
                Job costing
              </Link>{" "}
              tab.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
