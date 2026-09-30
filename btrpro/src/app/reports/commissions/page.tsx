import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { profitReport } from "@/lib/costing/report";
import { round } from "@/lib/calc/core";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const usd = (n: number | null) =>
  n == null
    ? "MISSING"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function Commissions({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const sp = await searchParams;
  const year = new Date().getFullYear();
  const from = sp.from ?? `${year}-01-01`;
  const to = sp.to ?? new Date().toISOString().slice(0, 10);
  const report = await profitReport(
    { from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59`) },
    user,
  );
  // Non-Admins see only their own commissions.
  const mine =
    user.role === "ADMIN"
      ? report.rows
      : report.rows.filter((r) => r.salesperson === user.name);
  const rows = mine.filter((r) => r.salesperson);
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    _sum: { amount: true },
    where: { invoice: { projectId: { in: rows.map((r) => r.id) } } },
  });
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: paid.map((p) => p.invoiceId) } },
    select: { id: true, projectId: true },
  });
  const collected = new Map<string, number>();
  for (const p of paid) {
    const pid = invoices.find((i) => i.id === p.invoiceId)!.projectId;
    collected.set(
      pid,
      round((collected.get(pid) ?? 0) + (p._sum.amount ?? 0), 2),
    );
  }
  const reps = [...new Set(rows.map((r) => r.salesperson!))].sort();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Commissions</h1>
        <p className="text-sm text-muted-foreground">
          Jobs sold in the period, with each salesperson&apos;s plan applied to
          the job P&amp;L. Final once job costing is closed; until then
          gross-profit commissions move as bills come in. Plans are set under
          Settings → Company.
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="flex flex-col gap-1">
          From{" "}
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-8 rounded-md border bg-background px-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          To{" "}
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-8 rounded-md border bg-background px-2"
          />
        </label>
        <button className="h-8 rounded-md border px-3">Show</button>
      </form>
      {reps.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No sold jobs with a salesperson in this period.
        </p>
      )}
      {reps.map((rep) => {
        const rs = rows.filter((r) => r.salesperson === rep);
        const total = round(
          rs.reduce((a, r) => a + (r.pnl.commission ?? 0), 0),
          2,
        );
        const final = round(
          rs
            .filter((r) => r.closed)
            .reduce((a, r) => a + (r.pnl.commission ?? 0), 0),
          2,
        );
        const missing = rs.filter((r) => r.pnl.commission == null).length;
        return (
          <section key={rep} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-semibold">{rep}</h2>
              <span className="text-sm">
                {usd(total)} total · {usd(final)} final
                {missing > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {missing} job(s) MISSING (no plan or no contract/costs)
                  </span>
                )}
              </span>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Job</TH>
                  <TH>Sold</TH>
                  <TH className="text-right">Revenue</TH>
                  <TH className="text-right">Collected</TH>
                  <TH className="text-right">Commission</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rs.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link
                        href={`/projects/${r.id}/costs`}
                        className="hover:underline"
                      >
                        {r.name}
                      </Link>
                    </TD>
                    <TD className="text-sm">
                      {r.soldAt.toLocaleDateString("en-US")}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {usd(r.pnl.revenue)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {usd(collected.get(r.id) ?? 0)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {usd(r.pnl.commission)}
                      {r.pnl.commissionFormula && (
                        <span className="block text-xs text-muted-foreground">
                          {r.pnl.commissionFormula}
                        </span>
                      )}
                    </TD>
                    <TD>
                      {r.closed ? (
                        <Badge variant="green">final</Badge>
                      ) : (
                        <Badge variant="amber">estimated</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}
