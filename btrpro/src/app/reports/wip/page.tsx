import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { BILLING_ROLES } from "@/lib/roles";
import { wipSchedule } from "@/lib/reports/wip";
import { etcAction, snapshotAction } from "./actions";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

export default async function WipPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const user = await requireUser(BILLING_ROLES);
  const sp = await searchParams;
  const w = await wipSchedule(user);
  const t = w.totals;
  const rows = w.rows.filter((r) => (sp.only === "fade" ? (r.fade != null && r.fade <= -2) || r.loss : sp.only === "stale" ? r.stale && r.hasCosts : true));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">WIP schedule</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Work in progress on every sold, open job, the way your CPA, bank and surety read it: percent complete by cost, earned revenue, over/under billing and projected margin against the bid. PMs update
            each job&apos;s <b>cost to complete</b> monthly; save the month-end WIP so next month shows the fade.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/reports/wip" className="h-9 rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Download CSV
          </a>
          {(user.role === "ADMIN" || user.role === "OFFICE") && (
            <form action={snapshotAction}>
              <button className="h-9 rounded-md bg-btr-blue px-3 text-sm font-medium text-white hover:bg-btr-blue-dark">{t.snapshotSaved ? "Re-save this month's WIP" : "Save month-end WIP"}</button>
            </form>
          )}
        </div>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open contracts" v={usd(t.revenue)} sub={`${t.jobs} jobs`} />
        <Stat label="Backlog (not yet earned)" v={usd(t.backlog)} />
        <Stat label="Projected gross profit" v={usd(t.projectedGp)} sub={pct(t.marginPct)} />
        <Stat label="Overbilled (liability)" v={usd(t.overbilled)} />
        <Stat label="Underbilled (asset)" v={usd(-t.underbilled)} tone={t.underbilled < -1 ? "warn" : undefined} />
        <Stat label="Need attention" v={`${t.fading + t.losses} fading/loss · ${t.stale} stale`} tone={t.fading + t.losses ? "bad" : undefined} />
      </div>

      <div className="flex gap-2 text-sm">
        {[
          [undefined, "All jobs"],
          ["fade", "Fading or losing"],
          ["stale", "Forecast over a month old"],
        ].map(([k, l]) => (
          <Link key={l} href={k ? `/reports/wip?only=${k}` : "/reports/wip"} className={`rounded-md px-2 py-1 ${sp.only === k ? "bg-btr-blue text-white" : "hover:bg-muted"}`}>
            {l}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-right text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Job</th>
              <th className="px-2 py-1.5">Contract</th>
              <th className="px-2 py-1.5">Cost to date</th>
              <th className="px-2 py-1.5">Cost to complete (PM)</th>
              <th className="px-2 py-1.5">Est. total cost</th>
              <th className="px-2 py-1.5">% done</th>
              <th className="px-2 py-1.5">Earned</th>
              <th className="px-2 py-1.5">Billed</th>
              <th className="px-2 py-1.5">Over / (under)</th>
              <th className="px-2 py-1.5">Margin: bid → now</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className={`align-top ${r.loss ? "bg-red-50 dark:bg-red-950/30" : r.fade != null && r.fade <= -2 ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                <td className="px-2 py-1.5">
                  <Link href={`/projects/${r.id}/costs`} className="font-medium text-btr-link hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {[r.pm, r.status.replace("_", " ").toLowerCase(), !r.hasCosts ? "no costs entered" : null, r.noBudget ? "no frozen budget" : null].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.revenue)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.costToDate)}</td>
                <td className="px-2 py-1.5 text-right">
                  <form action={etcAction} className="flex items-center justify-end gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="etc" defaultValue={r.etc ?? ""} placeholder={usd(Math.max(0, r.estTotalCost - r.costToDate))} inputMode="decimal" className="h-7 w-24 rounded-md border border-input bg-background px-1 text-right text-xs" />
                    <button className="h-7 rounded-md border px-1.5 text-xs hover:bg-muted">Save</button>
                  </form>
                  <div className={`text-[11px] ${r.stale ? "text-amber-700" : "text-muted-foreground"}`}>
                    {r.etcAt ? `${r.etcBy} ${r.etcAt.toLocaleDateString("en-US")}` : "using budget"}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {usd(r.estTotalCost)}
                  <div className="text-[11px] text-muted-foreground">{r.basis}</div>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.pctComplete.toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.earned)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.billed)}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.overUnder < 0 ? "text-amber-800" : ""}`}>{r.overUnder < 0 ? `(${usd(-r.overUnder)})` : usd(r.overUnder)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {pct(r.bidMarginPct)} → <b className={r.loss ? "text-red-700" : r.fade != null && r.fade <= -2 ? "text-amber-800" : ""}>{pct(r.projectedMarginPct)}</b>
                  {r.monthChange != null && <div className="text-[11px] text-muted-foreground">{r.monthChange >= 0 ? "+" : ""}{r.monthChange} pts vs last month</div>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">
                  No open sold jobs with a contract amount yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        % complete = cost to date ÷ estimated total cost. Earned = contract × % complete. Over/(under) = billed − earned: overbilling is cash collected ahead of the work; underbilling is work done that isn&apos;t billed
        yet. A job forecast to lose money is shown in red; one whose margin has dropped 2+ points from the bid in amber.
      </p>
    </div>
  );
}

function Stat({ label, v, sub, tone }: { label: string; v: string; sub?: string; tone?: "warn" | "bad" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "bad" ? "border-red-300 bg-red-50 dark:bg-red-950/30" : tone === "warn" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "bg-background"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{v}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
