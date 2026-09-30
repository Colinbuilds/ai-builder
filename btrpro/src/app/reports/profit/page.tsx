import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { bidTabReport, profitReport, type ReportFilters } from "@/lib/costing/report";
import { BUCKET_LABEL, BUCKETS } from "@/lib/costing/pnl";
import { SCOPE_LABEL } from "@/lib/projects/intake";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const usd = (n: number | null) => (n == null ? "MISSING" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const usd2 = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
type SP = Record<string, string | undefined>;

export default async function ProfitReport({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const sp = await searchParams;
  const f: ReportFilters = {
    from: sp.from ? new Date(`${sp.from}T00:00:00`) : null,
    to: sp.to ? new Date(`${sp.to}T23:59:59`) : null,
    market: sp.market === "RESIDENTIAL" || sp.market === "COMMERCIAL" ? sp.market : null,
    scope: sp.scope || null,
    isPublic: sp.public === "yes" ? true : sp.public === "no" ? false : null,
    salespersonId: sp.sales || null,
    estimatorId: sp.est || null,
    clientCompanyId: sp.client || null,
    closedOnly: sp.closed === "1",
  };
  const [{ rows, totals }, bids, users, clients] = await Promise.all([
    profitReport(f, user),
    bidTabReport(user),
    prisma.user.findMany({ where: { role: { not: "VIEWER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({ where: { projects: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Profit report</h1>
        <p className="text-sm text-muted-foreground">
          Sold jobs{user.role === "ESTIMATOR" ? " you're the estimator or salesperson on" : ""}. Projected = actual cost + committed but unbilled. Figures without a contract show MISSING and are left out of totals.
        </p>
      </div>

      <form className="grid gap-3 rounded-md border p-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label>Sold from</Label>
          <Input type="date" name="from" defaultValue={sp.from} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>to</Label>
          <Input type="date" name="to" defaultValue={sp.to} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Side</Label>
          <Select name="market" defaultValue={sp.market ?? ""}>
            <option value="">Both</option>
            <option value="RESIDENTIAL">Residential</option>
            <option value="COMMERCIAL">Commercial</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Job type</Label>
          <Select name="scope" defaultValue={sp.scope ?? ""}>
            <option value="">All</option>
            {Object.entries(SCOPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Public / private</Label>
          <Select name="public" defaultValue={sp.public ?? ""}>
            <option value="">Both</option>
            <option value="yes">Public</option>
            <option value="no">Private</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Salesperson</Label>
          <Select name="sales" defaultValue={sp.sales ?? ""}>
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Estimator</Label>
          <Select name="est" defaultValue={sp.est ?? ""}>
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>GC / client</Label>
          <Select name="client" defaultValue={sp.client ?? ""}>
            <option value="">Any</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="closed" value="1" defaultChecked={f.closedOnly} /> Closed jobs only
        </label>
        <div className="flex items-end gap-2">
          <Button size="sm">Apply</Button>
          <Link href="/reports/profit" className="text-sm underline">
            Clear
          </Link>
        </div>
      </form>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Jobs</p>
          <p className="text-lg">{totals.jobs}</p>
          {totals.missingRevenue > 0 && <p className="text-xs text-red-700">{totals.missingRevenue} with no contract amount</p>}
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Revenue</p>
          <p className="text-lg tabular-nums">{usd(totals.revenue)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Projected gross profit</p>
          <p className="text-lg tabular-nums">
            {usd(totals.projectedGp)} <span className="text-sm">{totals.marginPct != null ? `${totals.marginPct}%` : ""}</span>
          </p>
          <p className="text-xs text-muted-foreground">on {usd(totals.costedRevenue)} revenue from jobs with costs{totals.noCosts ? `; ${totals.noCosts} job(s) with no costs yet left out` : ""}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Estimate accuracy (actual ÷ estimated, {totals.closedJobs} closed job{totals.closedJobs === 1 ? "" : "s"})</p>
          {BUCKETS.map((b) => (
            <p key={b} className="text-sm">
              {BUCKET_LABEL[b]}: <span className={`tabular-nums ${totals.accuracy[b] != null && totals.accuracy[b]! > 1 ? "text-red-700 dark:text-red-400" : ""}`}>{totals.accuracy[b] != null ? `${(totals.accuracy[b]! * 100).toFixed(1)}%` : "—"}</span>
            </p>
          ))}
        </div>
      </section>

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Job</TH>
              <TH>Sold</TH>
              <TH className="text-right">Revenue</TH>
              <TH className="text-right">Est. cost</TH>
              <TH className="text-right">Projected cost</TH>
              <TH className="text-right">Gross profit</TH>
              <TH className="text-right">Margin</TH>
              <TH className="text-right">$/SQ sold · cost</TH>
              <TH className="text-right">$/SF siding · cost</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/projects/${r.id}/costs`} className="font-medium underline-offset-2 hover:underline">
                    {r.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {[r.market === "RESIDENTIAL" ? "Res" : "Com", r.isPublic && "public", r.client, r.salesperson && `sales ${r.salesperson}`, r.closed ? "closed" : "open"].filter(Boolean).join(" · ")}
                  </span>
                  {r.flagged.map((b) => (
                    <Badge key={b} variant="red" className="mr-1">
                      {BUCKET_LABEL[b]} over
                    </Badge>
                  ))}
                </TD>
                <TD className="whitespace-nowrap">{formatDate(r.soldAt)}</TD>
                <TD className={`text-right tabular-nums ${r.pnl.revenue == null ? "font-semibold text-red-700" : ""}`}>{usd(r.pnl.revenue)}</TD>
                <TD className={`text-right tabular-nums ${r.pnl.estimated == null ? "font-semibold text-red-700" : ""}`}>{usd(r.pnl.estimated)}</TD>
                <TD className="text-right tabular-nums">{usd(r.pnl.projected)}</TD>
                {r.pnl.hasCosts ? (
                  <>
                    <TD className="text-right tabular-nums">{r.pnl.projectedGrossProfit == null ? "—" : usd(r.pnl.projectedGrossProfit)}</TD>
                    <TD className={`text-right tabular-nums ${r.pnl.projectedMarginPct != null && r.pnl.projectedMarginPct < 0 ? "text-red-700" : ""}`}>{r.pnl.projectedMarginPct != null ? `${r.pnl.projectedMarginPct}%` : "—"}</TD>
                  </>
                ) : (
                  <TD colSpan={2} className="text-right text-xs text-amber-700 dark:text-amber-400">
                    no costs entered yet
                  </TD>
                )}
                <TD className="text-right text-xs tabular-nums">{r.squares ? `${usd2(r.revenuePerSq)} · ${usd2(r.costPerSq)} (${r.squares} SQ)` : "—"}</TD>
                <TD className="text-right text-xs tabular-nums">{r.sidingSf ? `${usd2(r.revenuePerSf)} · ${usd2(r.costPerSf)} (${r.sidingSf} SF)` : "—"}</TD>
              </TR>
            ))}
            {rows.length === 0 && (
              <TR>
                <TD colSpan={9} className="text-muted-foreground">
                  No sold jobs match.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">$/SQ uses confirmed roof squares (or confirmed roof SF ÷ 100). $/SF uses confirmed siding SF. Jobs without confirmed measurements show —.</p>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Public bid tabs</h2>
        {bids.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bid tabs recorded. Add them on a public job&apos;s Job costing tab after the bid opening.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Job</TH>
                <TH className="text-right">Our bid</TH>
                <TH className="text-right">Low bid</TH>
                <TH className="text-right">Rank</TH>
                <TH className="text-right">Over low</TH>
                <TH>Result</TH>
              </TR>
            </THead>
            <TBody>
              {bids.map((b) => (
                <TR key={b.project.id}>
                  <TD>
                    <Link href={`/projects/${b.project.id}/costs`} className="hover:underline">
                      {b.project.name}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{usd(b.ourBid)}</TD>
                  <TD className="text-right tabular-nums">{b.low == null ? "—" : usd(b.low)}</TD>
                  <TD className="text-right">{b.rank ? `${b.rank} of ${b.bidders}` : "—"}</TD>
                  <TD className="text-right tabular-nums">
                    {b.overLowPct == null ? "—" : b.overLowPct === 0 ? (b.nextAbovePct != null ? `low by ${b.nextAbovePct}%` : "low") : `+${b.overLowPct}%`}
                  </TD>
                  <TD>{b.won == null ? "pending" : b.won ? <Badge variant="green">won</Badge> : <Badge variant="outline">lost</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">&quot;Low by x%&quot; is money left on the table: how far under the next bidder we were.</p>
      </section>
    </div>
  );
}
