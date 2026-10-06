import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { scorecard, type Tone } from "@/lib/reports/scorecard";

const TONE: Record<Tone, string> = {
  good: "border-green-300 bg-green-50 dark:bg-green-950/30",
  watch: "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
  bad: "border-red-300 bg-red-50 dark:bg-red-950/30",
  none: "bg-background",
};
const DOT: Record<Tone, string> = { good: "bg-green-600", watch: "bg-amber-500", bad: "bg-red-600", none: "bg-muted-foreground/40" };
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function Scorecard() {
  const user = await requireUser(["ADMIN", "OFFICE"]);
  const s = await scorecard(user);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Owner scorecard</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            The numbers that decide whether growth is healthy — backlog, margin, billing position, cash, collections, win rate, change orders, customer concentration and the risk dates. Each card shows
            what good looks like. Walk through it in the weekly meeting; click a card for the detail.
          </p>
        </div>
        <Link href="/reports/wip" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
          WIP schedule →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {s.metrics.map((m) => {
          const body = (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${DOT[m.tone]}`} />
                {m.label}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{m.value}</div>
              {m.note && <div className="text-xs">{m.note}</div>}
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.benchmark}</div>
            </>
          );
          return m.href ? (
            <Link key={m.key} href={m.href} className={`rounded-lg border p-3 hover:shadow-sm ${TONE[m.tone]}`}>
              {body}
            </Link>
          ) : (
            <div key={m.key} className={`rounded-lg border p-3 ${TONE[m.tone]}`}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section id="bids" className="flex flex-col gap-2 rounded-lg border bg-background p-3">
          <h2 className="font-semibold">Win rate — trailing 12 months</h2>
          <Table
            head={["", "Bids", "Decided", "Won", "Win rate"]}
            rows={[
              ...s.bids.byMarket.map((g) => [g.name === "COMMERCIAL" ? "Commercial" : g.name === "RESIDENTIAL" ? "Residential" : g.name, g.bids, g.decided, g.won, g.rate == null ? "—" : `${g.rate}%`]),
            ]}
          />
          <h3 className="mt-2 text-sm font-medium">By estimator</h3>
          <Table head={["Estimator", "Bids", "Decided", "Won", "Win rate"]} rows={s.bids.byEstimator.map((g) => [g.name, g.bids, g.decided, g.won, g.rate == null ? "—" : `${g.rate}%`])} />
          <h3 className="mt-2 text-sm font-medium">Bids due in the next 14 days</h3>
          <Table head={["Estimator", "Bids due"]} rows={s.bids.dueNext14.map((d) => [d.estimator, d.count])} />
          <p className="text-xs text-muted-foreground">An estimator carrying many bids at a low win rate is the place to pass on more work early.</p>
        </section>

        <section id="customers" className="flex flex-col gap-2 rounded-lg border bg-background p-3">
          <h2 className="font-semibold">Win rate and revenue by customer</h2>
          <Table head={["Customer", "Bids", "Won", "Win rate"]} rows={s.bids.byCustomer.map((g) => [g.name, g.bids, g.won, g.rate == null ? "—" : `${g.rate}%`])} />
          <h3 className="mt-2 text-sm font-medium">Billed, last 12 months · {usd(s.revenue12.total)}</h3>
          <Table head={["Customer", "Billed", "Share"]} rows={s.revenue12.byCustomer.slice(0, 10).map((c) => [c.name, usd(c.revenue), `${c.share}%`])} />
        </section>

        <section className="flex flex-col gap-2 rounded-lg border bg-background p-3 lg:col-span-2">
          <h2 className="font-semibold">Crew capacity — weeks of work queued</h2>
          <p className="text-xs text-muted-foreground">Open schedule lines for each crew ÷ the lines that crew finished per week over the last 8 weeks. Over ~6 weeks queued means jobs will wait — line up another crew before selling more of that work.</p>
          <Table
            head={["Crew", "Open lines", "Finishes / week", "Weeks queued"]}
            rows={s.crews.slice(0, 20).map((c) => [c.crew, c.open, c.perWeek, c.weeks == null ? "no finishes logged in 8 weeks" : c.weeks])}
          />
        </section>
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Not enough history yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          {head.map((h, i) => (
            <th key={i} className={`py-1 ${i ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`py-1 ${j ? "text-right tabular-nums" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
