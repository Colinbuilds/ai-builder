import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { closeRate, pipeline, type Market } from "@/lib/reports/sales";
import { arAging } from "@/lib/billing/service";
import { STAGE_LABEL, type Stage } from "@/lib/projects/workflow";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const PERIODS = [
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "12 months"],
] as const;

function Card({
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
      <p className="text-xl tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; market?: string }>;
}) {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const sp = await searchParams;
  const days = PERIODS.some(([d]) => d === sp.days) ? Number(sp.days) : 90;
  const market: Market =
    sp.market === "RESIDENTIAL" || sp.market === "COMMERCIAL"
      ? sp.market
      : null;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const [pipe, close, ar] = await Promise.all([
    pipeline(market),
    closeRate(from, to, market),
    user.role === "ADMIN" ? arAging() : null,
  ]);
  const q = (o: Record<string, string | null>) => {
    const p = new URLSearchParams(
      Object.entries({ days: String(days), market, ...o }).filter(
        ([, v]) => v,
      ) as [string, string][],
    );
    return `/reports/sales?${p}`;
  };
  const openValue = pipe.stages.reduce((a, s) => a + s.value, 0);
  const backlogValue = pipe.backlog.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales &amp; pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Open bids are valued at their latest proposal price; jobs without a
          proposal are counted but not valued. Backlog is sold work not yet
          complete, at contract amount.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {PERIODS.map(([d, l]) => (
          <Link
            key={d}
            href={q({ days: d })}
            className={`rounded-md border px-2 py-1 ${String(days) === d ? "bg-muted font-medium" : ""}`}
          >
            {l}
          </Link>
        ))}
        <span className="mx-2 border-l" />
        {[
          [null, "All"],
          ["RESIDENTIAL", "Residential"],
          ["COMMERCIAL", "Commercial"],
        ].map(([m, l]) => (
          <Link
            key={l}
            href={q({ market: m })}
            className={`rounded-md border px-2 py-1 ${market === m ? "bg-muted font-medium" : ""}`}
          >
            {l}
          </Link>
        ))}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card
          label="Open pipeline"
          value={usd(openValue)}
          sub={`${pipe.stages.reduce((a, s) => a + s.jobs, 0)} jobs · ${pipe.stages.reduce((a, s) => a + s.jobs - s.priced, 0)} not priced yet`}
        />
        <Card
          label={`Close rate (${days} days)`}
          value={close.rate == null ? "—" : `${close.rate}%`}
          sub={`${close.won} won · ${close.lost} lost`}
        />
        <Card label={`Sold (${days} days)`} value={usd(close.sold)} />
        <Card
          label="Production backlog"
          value={usd(backlogValue)}
          sub={`${pipe.backlog.reduce((a, s) => a + s.jobs, 0)} jobs`}
        />
        {ar && (
          <Card
            label="Receivables"
            value={
              <Link href="/reports/ar" className="hover:underline">
                {usd(ar.total)}
              </Link>
            }
            sub={`${usd(ar.rows.filter((r) => r.bucket !== "Current").reduce((a, r) => a + r.balance, 0))} past due`}
          />
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Pipeline by stage</h2>
          <Table>
            <THead>
              <TR>
                <TH>Stage</TH>
                <TH className="text-right">Jobs</TH>
                <TH className="text-right">Value</TH>
              </TR>
            </THead>
            <TBody>
              {[...pipe.stages, ...pipe.backlog].map((s) => (
                <TR key={s.stage}>
                  <TD>
                    <Link
                      href={`/jobs?stage=${s.stage}`}
                      className="hover:underline"
                    >
                      {STAGE_LABEL[s.stage as Stage]}
                    </Link>
                  </TD>
                  <TD className="text-right tabular-nums">{s.jobs}</TD>
                  <TD className="text-right tabular-nums">
                    {usd(s.value)}
                    {"priced" in s && s.jobs > s.priced && (
                      <span className="block text-xs text-muted-foreground">
                        {s.jobs - s.priced} not priced
                      </span>
                    )}
                    {"noContract" in s && s.noContract > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {s.noContract} no contract amount
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Sales by rep ({days} days)</h2>
          <Table>
            <THead>
              <TR>
                <TH>Salesperson</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Lost</TH>
                <TH className="text-right">Close rate</TH>
                <TH className="text-right">Sold</TH>
              </TR>
            </THead>
            <TBody>
              {close.reps.map((r) => (
                <TR key={r.name}>
                  <TD>{r.name}</TD>
                  <TD className="text-right tabular-nums">{r.won}</TD>
                  <TD className="text-right tabular-nums">{r.lost}</TD>
                  <TD className="text-right tabular-nums">
                    {r.rate == null ? "—" : `${r.rate}%`}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {usd(r.sold)}
                    {r.unpriced > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        +{r.unpriced} with no contract amount
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
              {close.reps.length === 0 && (
                <TR>
                  <TD
                    colSpan={5}
                    className="py-4 text-center text-muted-foreground"
                  >
                    No jobs moved to Sold or Lost in this period.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Won and lost come from stage changes made in BTRpro. Jobs imported
            already sold aren&apos;t counted.
          </p>
        </div>
      </section>
    </div>
  );
}
