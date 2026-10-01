import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { winBackList, winLoss, type Row } from "@/lib/reports/win-loss";
import { Panel, axLink } from "@/components/shell/panel";

const DAY = 86_400_000;
const PERIODS: Record<string, [string, number]> = { "90": ["Last 90 days", 90], "365": ["Last 12 months", 365], all: ["All time", 36500] };
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Table({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-1.5">{label}</th>
          <th className="px-2 py-1.5 text-right">Won</th>
          <th className="px-2 py-1.5 text-right">Lost</th>
          <th className="px-2 py-1.5 text-right">Close rate</th>
          <th className="px-4 py-1.5 text-right">Won $</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t">
            <td className="px-4 py-1.5">{r.key}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{r.won}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{r.lost}</td>
            <td className="px-2 py-1.5 text-right font-medium tabular-nums">{r.rate == null ? "—" : `${r.rate}%`}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{usd0(r.wonValue)}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td className="px-4 py-3 text-muted-foreground" colSpan={5}>
              Nothing decided in this period.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default async function WinLossPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireUser(STAFF_ROLES);
  const p = PERIODS[(await searchParams).p ?? "365"] ? ((await searchParams).p ?? "365") : "365";
  const [d, back] = await Promise.all([winLoss(new Date(Date.now() - PERIODS[p][1] * DAY)), winBackList()]);
  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Win / loss</h1>
          <p className="text-sm text-muted-foreground">
            {d.total.won} won · {d.total.lost} lost · close rate {d.total.rate == null ? "—" : `${d.total.rate}%`} · {usd0(d.total.wonValue)} won
          </p>
        </div>
        <nav className="flex gap-1 text-sm">
          {Object.entries(PERIODS).map(([k, [label]]) => (
            <Link key={k} href={`/reports/win-loss?p=${k}`} className={`rounded-md border px-3 py-1 ${p === k ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By rep" bodyClass="p-0">
          <Table rows={d.byRep} label="Rep" />
        </Panel>
        <Panel title="Why we lose" bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.reasons.map(([r, n]) => (
              <li key={r} className="flex justify-between px-4 py-1.5">
                <span>{r}</span>
                <span className="tabular-nums">{n}</span>
              </li>
            ))}
            {!d.reasons.length && <li className="px-4 py-3 text-muted-foreground">No lost jobs in this period.</li>}
          </ul>
        </Panel>
        <Panel title="By lead source" bodyClass="p-0">
          <Table rows={d.bySource} label="Source" />
        </Panel>
        <Panel title="By job type" bodyClass="p-0">
          <Table rows={d.byType} label="Job type" />
        </Panel>
      </div>
      <Panel title={`Win-back list (${back.length})`} right={<span className="text-muted-foreground">Lost on price, timing or no response — call again in spring or after the next storm</span>} bodyClass="p-0">
        <ul className="divide-y text-sm">
          {back.map((j) => {
            const c = j.contacts[0]?.contact;
            return (
              <li key={j.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2">
                <Link href={`/projects/${j.id}`} className={axLink}>
                  {j.name}
                </Link>
                <span className="text-muted-foreground">
                  {j.lostCategory} · lost {j.statusChangedAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })} · {j.salesperson?.name ?? "unassigned"}
                </span>
                {c?.phone && (
                  <a href={`tel:${c.phone}`} className={`ml-auto ${axLink}`}>
                    {c.firstName} {c.lastName} · {c.phone}
                  </a>
                )}
                {j.lostReason && j.lostReason !== j.lostCategory && <span className="w-full text-xs text-muted-foreground">{j.lostReason}</span>}
              </li>
            );
          })}
          {!back.length && <li className="px-4 py-3 text-muted-foreground">Nobody on the win-back list.</li>}
        </ul>
      </Panel>
    </div>
  );
}
