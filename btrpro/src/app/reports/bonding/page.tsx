import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { bondingCapacity } from "@/lib/reports/bonding";
import { bondingSettingsAction } from "./actions";

const usd = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const input = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export default async function BondingPage() {
  const u = await requireUser(["ADMIN", "OFFICE"]);
  const b = await bondingCapacity(u);
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Bonding capacity</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Public and larger commercial work needs performance and payment bonds, and the surety caps both the biggest single job and the total bonded work you can have open. Running out of bonding is one of
          the walls between $40M and $100M — this shows how much room is left before you bid the next bonded job.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card label="Bonded backlog (work left on bonded jobs)" value={usd(b.bondedBacklog)} />
        <Card label={`Aggregate limit${b.fromLetter ? "" : " (estimated)"}`} value={usd(b.aggregate)} />
        <Card label="Room left" value={usd(b.room)} tone={b.room == null ? undefined : b.room < 0 ? "bad" : (b.usedPct ?? 0) > 80 ? "watch" : "good"} note={b.usedPct != null ? `${b.usedPct}% used` : undefined} />
        <Card label={`Single-job limit${b.letterSingle != null || !b.estimate ? "" : " (estimated)"}`} value={usd(b.single)} />
      </div>
      {!b.fromLetter && b.estimate && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          Estimated from working capital — a rule of thumb, not a promise. Single job ≈ 10× working capital (sureties range {usd(b.estimate.singleRange[0])}–{usd(b.estimate.singleRange[1])}) or 5× net
          worth, whichever is less; aggregate ≈ 20× ({usd(b.estimate.aggregateRange[0])}–{usd(b.estimate.aggregateRange[1])}). Enter the limits from the surety&apos;s letter below for the real numbers.
        </p>
      )}
      {b.statementStale && <p className="text-sm text-amber-800">The financial statement on file is over 15 months old. Sureties want the latest year-end CPA statement.</p>}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Open bonded jobs</h2>
        <p className="text-xs text-muted-foreground">Jobs marked &ldquo;performance bond required&rdquo; on the job. Work left = contract − earned to date (from the WIP schedule).</p>
        <div className="overflow-x-auto rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Job</th>
                <th className="px-2 py-1.5 text-right">Contract</th>
                <th className="px-2 py-1.5 text-right">% complete</th>
                <th className="px-2 py-1.5 text-right">Work left</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {b.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-1.5">
                    <Link href={`/projects/${r.id}`} className="text-btr-link hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.revenue)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.pctComplete}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.backlog)}</td>
                </tr>
              ))}
              {!b.rows.length && (
                <tr>
                  <td colSpan={4} className="px-2 py-2 text-muted-foreground">
                    No open bonded jobs with a contract amount.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <form action={bondingSettingsAction} className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">From the surety letter and the CPA statement</h2>
        <Field label="Surety / bond agent" name="suretyName" value={b.surety ?? ""} />
        <Field label="Statement date" name="financialsAsOf" value={b.financialsAsOf ?? ""} type="date" />
        <Field label="Single-job limit (letter)" name="bondSingleLimit" value={b.letterSingle == null ? "" : String(b.letterSingle)} />
        <Field label="Aggregate limit (letter)" name="bondAggregateLimit" value={b.letterAggregate == null ? "" : String(b.letterAggregate)} />
        <Field label="Working capital" name="workingCapital" value={b.workingCapital == null ? "" : String(b.workingCapital)} />
        <Field label="Net worth (equity)" name="netWorth" value={b.netWorth == null ? "" : String(b.netWorth)} />
        <button className="h-9 self-end rounded-md bg-btr-blue px-3 text-sm text-white hover:bg-btr-blue-dark sm:col-span-2 sm:justify-self-start">Save</button>
      </form>
    </div>
  );
}

function Field({ label, name, value, type = "text" }: { label: string; name: string; value: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input name={name} type={type} defaultValue={value} inputMode={type === "text" && name !== "suretyName" ? "decimal" : undefined} className={input} />
    </label>
  );
}

function Card({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "watch" | "bad" }) {
  const c = tone === "bad" ? "border-red-300 bg-red-50 dark:bg-red-950/30" : tone === "watch" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : tone === "good" ? "border-green-300 bg-green-50 dark:bg-green-950/30" : "bg-background";
  return (
    <div className={`rounded-lg border p-3 ${c}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs">{note}</div>}
    </div>
  );
}
