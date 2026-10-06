import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { cashForecast } from "@/lib/reports/cash";
import { cashItemAction, cashSettingsAction, deleteCashItemAction } from "./actions";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const box = "h-9 w-36 rounded-md border border-input bg-background px-2 text-sm";

export default async function CashPage() {
  await requireUser(["ADMIN", "OFFICE"]);
  const [f, s] = await Promise.all([cashForecast(), getSettings()]);
  const top = Math.max(1, ...f.weeks.map((w) => Math.abs(w.close)));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">13-week cash forecast</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Your bank balance rolled forward week by week. Invoices land on the date each customer actually tends to pay, pay apps about 45 days out, builder billing at each builder&apos;s pace; supplier
          bills on their due dates and crews when they&apos;re marked done. Past-due items land in this week.
        </p>
      </div>

      {f.missing.length > 0 && <p className="rounded-md border-l-4 border-l-amber-500 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">Fill in {f.missing.join(", ")} below so the forecast starts from real numbers.</p>}

      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <Stat label={`Bank balance${f.asOf ? ` (${f.asOf})` : ""}`} v={usd(f.opening)} />
        <Stat label={`Lowest point (week of ${day(f.low.start)})`} v={usd(f.low.close)} tone={f.floor != null && f.low.close < f.floor ? "bad" : f.low.close < 0 ? "bad" : undefined} />
        <Stat label="Weeks below your floor" v={f.floor == null ? "set a floor" : String(f.belowFloor.length)} tone={f.belowFloor.length ? "bad" : undefined} />
        <Stat label="Retainage held (not in forecast)" v={usd(f.retainageHeld)} />
      </div>

      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-right text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Week of</th>
              <th className="px-2 py-1.5">Coming in</th>
              <th className="px-2 py-1.5">Going out</th>
              <th className="px-2 py-1.5">End balance</th>
              <th className="px-2 py-1.5 text-left" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {f.weeks.map((w) => (
              <tr key={w.start.toISOString()} className={`align-top ${f.floor != null && w.close < f.floor ? "bg-red-50 dark:bg-red-950/30" : ""}`}>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <details>
                    <summary className="cursor-pointer">{day(w.start)}</summary>
                    <ul className="mt-1 w-[min(36rem,80vw)] text-xs">
                      {w.lines.map((l, i) => (
                        <li key={i} className="flex justify-between gap-3 py-0.5">
                          <span className="truncate">
                            {day(l.date)} ·{" "}
                            {l.href ? (
                              <Link href={l.href} className="text-btr-link hover:underline">
                                {l.label}
                              </Link>
                            ) : (
                              l.label
                            )}
                          </span>
                          <span className={`tabular-nums ${l.amount < 0 ? "text-red-700" : "text-green-700"}`}>{usd(l.amount)}</span>
                        </li>
                      ))}
                      {!w.lines.length && <li className="text-muted-foreground">Nothing scheduled.</li>}
                    </ul>
                  </details>
                </td>
                <td className="px-2 py-1.5 text-right text-green-700 tabular-nums">{usd(w.in)}</td>
                <td className="px-2 py-1.5 text-right text-red-700 tabular-nums">{usd(w.out)}</td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{usd(w.close)}</td>
                <td className="w-1/3 px-2 py-1.5">
                  <div className={`h-3 rounded-sm ${w.close < 0 ? "bg-red-500" : "bg-btr-blue"}`} style={{ width: `${Math.max(2, (Math.abs(w.close) / top) * 100)}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={cashSettingsAction} className="flex flex-col gap-2 rounded-md border bg-background p-3 text-sm">
          <h2 className="font-semibold">Starting numbers</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              Bank balance today
              <input name="cashOnHand" defaultValue={s.cashOnHand ?? ""} inputMode="decimal" className={box} />
            </label>
            <label className="flex flex-col gap-1">
              Lowest balance you&apos;re OK with
              <input name="cashFloor" defaultValue={s.cashFloor ?? ""} inputMode="decimal" className={box} />
            </label>
            <label className="flex flex-col gap-1">
              Payroll per week (all-in)
              <input name="weeklyPayroll" defaultValue={s.weeklyPayroll ?? ""} inputMode="decimal" className={box} />
            </label>
            <label className="flex flex-col gap-1">
              Overhead per month
              <input name="monthlyOverhead" defaultValue={s.monthlyOverhead ?? ""} inputMode="decimal" className={box} />
            </label>
          </div>
          <button className="self-start rounded-md bg-btr-blue px-3 py-1.5 text-white hover:bg-btr-blue-dark">Save</button>
        </form>
        <div className="flex flex-col gap-2 rounded-md border bg-background p-3 text-sm">
          <h2 className="font-semibold">One-off items</h2>
          <form action={cashItemAction} className="flex flex-wrap items-end gap-2">
            <input type="date" name="date" required className="h-9 rounded-md border border-input bg-background px-2" />
            <input name="label" required placeholder="Truck payment, LOC draw…" className="h-9 min-w-40 flex-1 rounded-md border border-input bg-background px-2" />
            <select name="dir" className="h-9 rounded-md border border-input bg-background px-2">
              <option value="out">Out</option>
              <option value="in">In</option>
            </select>
            <input name="amount" required inputMode="decimal" placeholder="$" className="h-9 w-28 rounded-md border border-input bg-background px-2" />
            <button className="h-9 rounded-md border px-3 hover:bg-muted">Add</button>
          </form>
          <ul className="divide-y">
            {f.items.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1">
                <span>
                  {day(c.date)} · {c.label}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`tabular-nums ${c.amount < 0 ? "text-red-700" : "text-green-700"}`}>{usd(c.amount)}</span>
                  <form action={deleteCashItemAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs text-muted-foreground hover:underline">remove</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: string; tone?: "bad" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "bad" ? "border-red-300 bg-red-50 dark:bg-red-950/30" : "bg-background"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{v}</div>
    </div>
  );
}
