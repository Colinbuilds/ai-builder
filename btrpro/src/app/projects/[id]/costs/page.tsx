import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canSeeCosts,
  closeoutProblems,
  loadCosting,
} from "@/lib/costing/service";
import {
  BUCKET_LABEL,
  CATEGORY_LABEL,
  COST_CATEGORIES,
  type Baseline,
} from "@/lib/costing/pnl";
import {
  AddCostForm,
  BaselineForm,
  BidResultForm,
  ChangeOrderForm,
  CloseCosting,
  CommitmentForm,
  CommitmentStatus,
  DecideChangeOrder,
  DeleteCost,
  InvoiceImport,
  NoneExpectedToggle,
} from "@/components/costing/forms";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const Money = ({ v, strong }: { v: number | null; strong?: boolean }) =>
  v == null ? (
    <span className="font-semibold text-red-700 dark:text-red-400">
      MISSING
    </span>
  ) : (
    <span
      className={`tabular-nums ${strong ? "font-semibold" : ""} ${v < 0 ? "text-red-700 dark:text-red-400" : ""}`}
    >
      {usd(v)}
    </span>
  );
const Pct = ({ v }: { v: number | null }) =>
  v == null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span
      className={`tabular-nums ${v < 0 ? "text-red-700 dark:text-red-400" : ""}`}
    >
      {v}%
    </span>
  );

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
      <p className="text-lg">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function CostsPage({
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
        Job costs and margins are visible to Admins and to the estimator or
        salesperson on this job.
      </p>
    );
  const { project: p, pnl, noneExpected, settings } = await loadCosting(id);
  const isAdmin = user.role === "ADMIN";
  const closed = !!p.costClosedAt;
  const canEdit = !closed || isAdmin;
  const baseline = p.costBaseline as unknown as Baseline | null;
  const blockers = closed ? [] : await closeoutProblems(id);
  const openCommitments = p.commitments.filter((c) => c.status === "OPEN");
  const bid = p.bidResults[0];

  return (
    <div className="flex flex-col gap-6">
      {closed && (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          Job costing closed by {p.costClosedBy} on {formatDate(p.costClosedAt)}
          . The final P&amp;L is locked; changes need an Admin and are logged.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={<Money v={pnl.revenue} strong />}
          sub={pnl.revenueFormula}
        />
        <Stat
          label="Estimated cost (frozen)"
          value={<Money v={pnl.estimated} />}
          sub={
            baseline
              ? `${baseline.estimateName} rev ${baseline.revision}${pnl.changeOrderCost ? ` + ${usd(pnl.changeOrderCost)} CO cost` : ""}`
              : "freeze the sold estimate below"
          }
        />
        <Stat
          label="Actual cost to date"
          value={<Money v={pnl.actual} />}
          sub={
            pnl.committed
              ? `+ ${usd(pnl.committed)} committed = ${usd(pnl.projected)} projected`
              : "nothing committed and unbilled"
          }
        />
        <Stat
          label="Gross profit (projected)"
          value={
            <>
              <Money v={pnl.projectedGrossProfit} strong />{" "}
              <Pct v={pnl.projectedMarginPct} />
            </>
          }
          sub={
            <>
              to date <Money v={pnl.grossProfit} /> · estimated{" "}
              <Money v={pnl.estimatedGrossProfit} /> (
              {pnl.estimatedMarginPct ?? "—"}%)
            </>
          }
        />
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Overhead"
          value={<Money v={pnl.overhead} />}
          sub={
            pnl.overheadFormula ??
            "set Company overhead % under Settings → Company"
          }
        />
        <Stat
          label="Net profit (projected)"
          value={
            <>
              <Money v={pnl.netProfit} strong /> <Pct v={pnl.netMarginPct} />
            </>
          }
          sub="gross profit − overhead (commissions: Reports → Commission calculator)"
        />
      </section>
      {pnl.missing.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">
            Missing, so some figures can&apos;t be calculated:
          </p>
          <ul className="list-disc pl-5">
            {pnl.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Estimate vs. actual</h2>
        <Table>
          <THead>
            <TR>
              <TH>Bucket</TH>
              <TH className="text-right">Estimated</TH>
              <TH className="text-right">Actual</TH>
              <TH className="text-right">Committed</TH>
              <TH className="text-right">Projected</TH>
              <TH className="text-right">Variance</TH>
            </TR>
          </THead>
          <TBody>
            {pnl.buckets.map((b) => (
              <TR
                key={b.bucket}
                className={b.flagged ? "bg-red-50 dark:bg-red-950/40" : ""}
              >
                <TD>
                  {BUCKET_LABEL[b.bucket]}{" "}
                  {b.flagged && (
                    <Badge variant="red">
                      over by more than {settings.costVarianceThresholdPct}%
                    </Badge>
                  )}
                </TD>
                <TD className="text-right">
                  <Money v={b.estimated} />
                </TD>
                <TD className="text-right">
                  <Money v={b.actual} />
                </TD>
                <TD className="text-right">
                  {b.committed ? <Money v={b.committed} /> : "—"}
                </TD>
                <TD className="text-right">
                  <Money v={b.projected} />
                </TD>
                <TD className="text-right">
                  {b.variance == null ? (
                    "—"
                  ) : (
                    <span
                      className={
                        b.variance > 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-green-700 dark:text-green-400"
                      }
                    >
                      {b.variance > 0 ? "+" : ""}
                      {usd(b.variance)}{" "}
                      {b.variancePct == null
                        ? "(nothing estimated)"
                        : `(${b.variancePct}%)`}
                    </span>
                  )}
                </TD>
              </TR>
            ))}
            {pnl.changeOrderCost !== 0 && (
              <TR>
                <TD className="text-muted-foreground">
                  Approved change-order cost (estimate only; its bills land in
                  the buckets above)
                </TD>
                <TD className="text-right">
                  <Money v={pnl.changeOrderCost} />
                </TD>
                <TD colSpan={4} />
              </TR>
            )}
            {baseline && (
              <TR>
                <TD className="text-muted-foreground">
                  Contingency (estimate only)
                </TD>
                <TD className="text-right">
                  <Money v={baseline.contingency} />
                </TD>
                <TD colSpan={4} />
              </TR>
            )}
          </TBody>
        </Table>
        {baseline && (
          <p className="text-xs text-muted-foreground">
            Materials include tax: {baseline.taxNote}. Labor + subs compares
            crew and subcontractor costs against estimated labor. Equipment,
            disposal, permits, and other roll into general conditions.
          </p>
        )}
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {COST_CATEGORIES.map((c) => {
            const has = p.costs.some((x) => x.category === c);
            const none = noneExpected.includes(c);
            return (
              <div
                key={c}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"
              >
                <span>
                  {CATEGORY_LABEL[c]}: <Money v={pnl.actualByCat[c]} />
                  {none && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (none expected)
                    </span>
                  )}
                </span>
                {canEdit && !has && (
                  <NoneExpectedToggle projectId={id} category={c} on={none} />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Cost baseline</h2>
        {baseline ? (
          <p className="text-sm">
            Frozen from <strong>{baseline.estimateName}</strong> (rev{" "}
            {baseline.revision}) by {baseline.frozenBy} on{" "}
            {formatDate(p.costBaselineAt)}: materials {usd(baseline.materials)}{" "}
            + tax{" "}
            {baseline.materialTax == null ? (
              <span className="font-semibold text-red-700">MISSING</span>
            ) : (
              usd(baseline.materialTax)
            )}
            , general conditions {usd(baseline.generalConditions)}, labor{" "}
            {usd(baseline.labor)}, contingency {usd(baseline.contingency)}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not frozen yet. It&apos;s frozen automatically when the customer
            signs a proposal; otherwise pick the estimate the job was sold on.
          </p>
        )}
        {canEdit && (
          <BaselineForm
            projectId={id}
            estimates={p.estimates.map((e) => ({
              id: e.id,
              label: `${e.name} (rev ${e.revision})`,
            }))}
            frozen={!!baseline}
            isAdmin={isAdmin}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Change orders &amp; supplements</h2>
        {p.changeOrders.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>What</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Cost impact</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.changeOrders.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-xs">{c.number}</TD>
                  <TD>
                    {c.description}
                    {c.source && (
                      <span className="block text-xs text-muted-foreground">
                        {c.source}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {c.kind === "CREDIT" ? `−${usd(c.amount)}` : usd(c.amount)}
                  </TD>
                  <TD className="text-right">
                    {c.kind === "CREDIT" ? "—" : <Money v={c.costImpact} />}
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
                    {c.decidedBy && (
                      <span className="block text-xs text-muted-foreground">
                        {c.decidedBy}
                      </span>
                    )}
                  </TD>
                  <TD>
                    {canEdit && (c.status === "PENDING" || isAdmin) && (
                      <DecideChangeOrder
                        projectId={id}
                        id={c.id}
                        status={c.status}
                      />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {canEdit && <ChangeOrderForm projectId={id} market={p.market} />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Committed, not yet billed</h2>
        {p.commitments.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH>What</TH>
                <TH className="text-right">Committed</TH>
                <TH className="text-right">Billed</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.commitments.map((c) => (
                <TR key={c.id}>
                  <TD>{c.vendor}</TD>
                  <TD>
                    {c.description}{" "}
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_LABEL[c.category]}
                      {c.reference && ` · ${c.reference}`}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{usd(c.amount)}</TD>
                  <TD className="text-right tabular-nums">
                    {usd(c.bills.reduce((a, b) => a + b.amount, 0))}
                  </TD>
                  <TD>{c.status.toLowerCase()}</TD>
                  <TD>
                    {canEdit && (
                      <CommitmentStatus
                        projectId={id}
                        id={c.id}
                        status={c.status}
                      />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {canEdit && <CommitmentForm projectId={id} />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Actual costs</h2>
        {canEdit && (
          <>
            <AddCostForm
              projectId={id}
              commitments={openCommitments.map((c) => ({
                id: c.id,
                label: `${c.vendor} — ${c.description} (${usd(c.amount)})`,
              }))}
            />
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">
                Import supplier invoices (CSV from myABCsupply or any supplier) ·{" "}
                <Link href={`/receipts`} className="font-normal text-btr-link underline">
                  or scan a paper receipt
                </Link>
              </p>
              <InvoiceImport projectId={id} />
            </div>
          </>
        )}
        {p.costs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No costs entered yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Category</TH>
                <TH>Vendor</TH>
                <TH>Description</TH>
                <TH className="text-right">Amount</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.costs.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap">{formatDate(c.date)}</TD>
                  <TD className="text-xs">{CATEGORY_LABEL[c.category]}</TD>
                  <TD>
                    {c.vendor}
                    {c.reference && (
                      <span className="block text-xs text-muted-foreground">
                        #{c.reference}
                      </span>
                    )}
                  </TD>
                  <TD>
                    {c.description}
                    {c.itemNumber && (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">
                        {c.itemNumber}
                      </span>
                    )}
                    {(c.formula ||
                      c.commitment ||
                      c.document ||
                      (c.sheetPrice != null &&
                        c.unitPrice != null &&
                        c.sheetPrice !== c.unitPrice)) && (
                      <span className="block text-xs text-muted-foreground">
                        {c.formula}
                        {c.commitment &&
                          ` · against ${c.commitment.vendor} commitment`}
                        {c.sheetPrice != null &&
                          c.unitPrice != null &&
                          Math.abs(c.sheetPrice - c.unitPrice) > 0.01 && (
                            <span className="text-red-700 dark:text-red-400">
                              {" "}
                              · billed {usd(c.unitPrice)} vs sheet{" "}
                              {usd(c.sheetPrice)}
                            </span>
                          )}
                        {c.document && (
                          <>
                            {" · "}
                            <a
                              className="underline"
                              href={`/api/documents/${c.document.id}`}
                            >
                              {c.document.fileName}
                            </a>
                          </>
                        )}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      entered by {c.enteredBy?.name ?? "—"}
                    </span>
                  </TD>
                  <TD className="text-right">
                    <Money v={c.amount} />
                  </TD>
                  <TD>
                    {canEdit && <DeleteCost projectId={id} costId={c.id} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {p.isPublic && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Public bid tab</h2>
          <p className="text-sm text-muted-foreground">
            Record every bidder from the bid opening. It feeds the profit report
            so future bids can be tuned.
          </p>
          {user.role !== "VIEWER" && (
            <BidResultForm
              projectId={id}
              initial={
                bid
                  ? {
                      ourBid: bid.ourBid,
                      won: bid.won,
                      tabs:
                        (bid.bidTabs as
                          | { bidder: string; amount: number }[]
                          | null) ?? [],
                      notes: bid.notes,
                    }
                  : null
              }
            />
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Close-out</h2>
        <CloseCosting
          projectId={id}
          closed={closed}
          isAdmin={isAdmin}
          blockers={blockers}
        />
      </section>
      <p className="text-xs text-muted-foreground">
        Company-wide numbers:{" "}
        <Link href="/reports/profit" className="underline">
          Profit report
        </Link>
      </p>
    </div>
  );
}
