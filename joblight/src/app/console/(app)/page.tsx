import Link from "next/link";
import { prisma } from "@/lib/db";
import { summary } from "@/lib/buildouts";
import { buildoutMonthly, usd } from "@/lib/pricing";
import { tradeLabel } from "@/lib/trades";
import { checkNow } from "../actions";
import { Health } from "@/components/health";

const STATUS: Record<string, string> = { ONBOARDING: "Onboarding", LIVE: "Live", PAUSED: "Paused", CANCELLED: "Cancelled" };

export default async function ConsoleHome() {
  const [s, buildouts] = await Promise.all([summary(), prisma.buildout.findMany({ orderBy: [{ status: "asc" }, { company: "asc" }] })]);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Monthly recurring" value={usd(s.mrr)} note={s.unpriced ? `${s.unpriced} live without an agreed rate` : "live buildouts"} />
        <Stat label="Live" value={String(s.live)} note={`${s.onboarding} onboarding`} />
        <Stat label="Down at last check" value={String(s.down)} tone={s.down ? "bad" : undefined} />
        <Stat label="Setup fees owed" value={usd(s.setupOwed)} />
        <Stat label="New leads" value={String(s.newLeads)} href="/console/leads" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Buildouts</h1>
        <form action={checkNow} className="ml-auto">
          <button className="btn-ghost h-9">Check all now</button>
        </form>
        <Link href="/console/buildouts/new" className="btn h-9">
          New buildout
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Users</th>
              <th className="px-3 py-2 text-right">Monthly</th>
              <th className="px-3 py-2">Health</th>
              <th className="px-3 py-2">Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {buildouts.map((b) => {
              const m = buildoutMonthly(b);
              return (
                <tr key={b.id}>
                  <td className="px-3 py-2">
                    <Link href={`/console/buildouts/${b.id}`} className="font-medium hover:underline">
                      {b.company}
                    </Link>
                    {b.protected && <span className="ml-2 rounded bg-light-soft px-1.5 py-0.5 text-[11px] text-light-strong">protected</span>}
                    <div className="text-xs text-muted">{tradeLabel(b.trade)}</div>
                  </td>
                  <td className="px-3 py-2">{STATUS[b.status]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.users}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m == null ? <span className="text-bad">set rate</span> : usd(m)}</td>
                  <td className="px-3 py-2">
                    <Health ok={b.lastCheckOk} ms={b.lastCheckMs} at={b.lastCheckAt} error={b.lastCheckError} />
                  </td>
                  <td className="max-w-56 truncate px-3 py-2 text-xs text-muted">{b.url ?? "—"}</td>
                </tr>
              );
            })}
            {!buildouts.length && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted">
                  No buildouts yet. Start one from a lead, or add a customer with New buildout.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone, href }: { label: string; value: string; note?: string; tone?: "bad"; href?: string }) {
  const body = (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-bad" : ""}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
