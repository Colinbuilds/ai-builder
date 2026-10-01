import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { BILLING_ROLES } from "@/lib/roles";
import { officeDesk } from "@/lib/desks";
import { Panel, axLink } from "@/components/shell/panel";
import { CallLog } from "@/components/desk/call-log";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const OUT: Record<string, string> = { CALLED: "talked", LEFT_VM: "left VM", EMAILED: "emailed", PROMISED: "promised", DISPUTE: "disputes it" };

function Count({ n, tone = "default" }: { n: number; tone?: "default" | "warn" | "bad" }) {
  const c = !n ? "bg-muted text-muted-foreground" : tone === "bad" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : tone === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-btr-blue-soft text-btr-blue-dark";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${c}`}>{n}</span>;
}

export default async function OfficeDesk() {
  const user = await requireUser(BILLING_ROLES);
  const d = await officeDesk();
  const allClear = !d.callList.length && !d.drafts.length && !d.completeNoFinal.length && !d.crewToApprove.length && !d.bills.ready && !d.bills.needsLook && !d.qboProblems.length;
  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Office desk</h1>
          <p className="text-sm text-muted-foreground">Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {user.name.split(" ")[0]}. Work it top to bottom; the list empties as you go.</p>
        </div>
        <div className="flex gap-4 text-sm">
          <span>
            Coming in this week <b className="tabular-nums">{usd(d.comingIn)}</b>
          </span>
          <span>
            Going out (due + past due) <b className="tabular-nums">{usd(d.goingOut)}</b>
          </span>
        </div>
      </div>
      {allClear && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-300">All caught up for today.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2">Collections — call today <Count n={d.callList.length} tone="bad" /></span>} right={d.parked ? <span className="text-muted-foreground">{d.parked} waiting on a promise date</span> : null} bodyClass="p-0">
          <ul className="divide-y text-sm">
            {d.callList.slice(0, 25).map((r) => (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/projects/${r.projectId}/billing`} className={`font-medium ${axLink}`}>
                    {r.who ?? r.job} · {r.number}
                  </Link>
                  <span className="font-semibold tabular-nums">{usd(r.balance)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className={r.daysLate > 30 ? "font-medium text-red-600" : ""}>{r.daysLate} days late</span> · {r.job}
                  {r.phone && (
                    <>
                      {" "}·{" "}
                      <a href={`tel:${r.phone}`} className={axLink}>
                        {r.phone}
                      </a>
                    </>
                  )}
                  {r.lastCall && ` · last: ${OUT[r.lastCall.outcome] ?? r.lastCall.outcome} ${day(r.lastCall.createdAt)}${r.lastCall.note ? ` — ${r.lastCall.note}` : ""}`}
                </div>
                <CallLog invoiceId={r.id} />
              </li>
            ))}
            {!d.callList.length && <li className="px-4 py-3 text-muted-foreground">Nobody to call.</li>}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title={<span className="flex items-center gap-2">Supplier bills <Count n={d.bills.ready + d.bills.needsLook} /></span>} right={<Link href="/bills" className={axLink}>Open bills</Link>}>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Link href="/bills?tab=ready" className="rounded border p-2 hover:bg-accent">
                <div className="text-xs text-muted-foreground">Ready to approve</div>
                <div className="text-lg font-semibold">{d.bills.ready}</div>
              </Link>
              <Link href="/bills?tab=look" className="rounded border p-2 hover:bg-accent">
                <div className="text-xs text-muted-foreground">Need a look</div>
                <div className="text-lg font-semibold">{d.bills.needsLook}</div>
              </Link>
              <Link href="/bills?tab=unpaid" className="rounded border p-2 hover:bg-accent">
                <div className="text-xs text-muted-foreground">Due this week</div>
                <div className="text-lg font-semibold tabular-nums">{usd(d.bills.dueThisWeek)}</div>
              </Link>
              <Link href="/bills?tab=unpaid" className="rounded border p-2 hover:bg-accent">
                <div className="text-xs text-muted-foreground">Past due</div>
                <div className={`text-lg font-semibold tabular-nums ${d.bills.pastDue ? "text-red-600" : ""}`}>{usd(d.bills.pastDue)}</div>
              </Link>
            </div>
          </Panel>

          <Panel title={<span className="flex items-center gap-2">Invoices to send <Count n={d.drafts.length + d.completeNoFinal.length} /></span>} bodyClass="p-0">
            <ul className="divide-y text-sm">
              {d.drafts.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href={`/projects/${i.project.id}/billing`} className={axLink}>
                    Draft {i.kind.toLowerCase().replace("_", " ")} {i.number} · {i.project.name}
                  </Link>
                  <span className="tabular-nums">{usd(i.amountDue)}</span>
                </li>
              ))}
              {d.completeNoFinal.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href={`/projects/${p.id}/billing`} className={axLink}>
                    {p.name} — complete, no final invoice yet
                  </Link>
                  <span className="text-xs text-muted-foreground">since {day(p.statusChangedAt)}</span>
                </li>
              ))}
              {!d.drafts.length && !d.completeNoFinal.length && <li className="px-4 py-3 text-muted-foreground">Nothing waiting to go out.</li>}
            </ul>
          </Panel>

          <Panel title={<span className="flex items-center gap-2">Crew invoices <Count n={d.crewToApprove.length} /></span>} right={<Link href="/crews/invoices" className={axLink}>Open</Link>} bodyClass="p-0">
            <ul className="divide-y text-sm">
              {d.crewToApprove.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href="/crews/invoices" className={axLink}>
                    To approve: {c.crew.name} · {c.project.name}
                  </Link>
                  <span className="tabular-nums">{usd(c.amount)}</span>
                </li>
              ))}
              {d.crewToPay.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href="/crews/invoices" className={axLink}>
                    To pay: {c.crew.name} · {c.project.name}
                  </Link>
                  <span className="tabular-nums">{usd(c.amount)}</span>
                </li>
              ))}
              {!d.crewToApprove.length && !d.crewToPay.length && <li className="px-4 py-3 text-muted-foreground">None waiting.</li>}
            </ul>
          </Panel>

          {d.qboProblems.length > 0 && (
            <Panel title={<span className="flex items-center gap-2">QuickBooks didn&apos;t take these <Count n={d.qboProblems.length} tone="warn" /></span>} bodyClass="p-0">
              <ul className="divide-y text-sm">
                {d.qboProblems.map((q) => (
                  <li key={q.href + q.label} className="px-4 py-2">
                    <Link href={q.href} className={axLink}>
                      {q.label}
                    </Link>
                    <div className="text-xs text-muted-foreground">{q.error}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Panel title={<span className="flex items-center gap-2">Waiting on payment <Count n={d.awaitingPayment.length} /></span>} right={<Link href="/reports/ar" className={axLink}>Receivables report</Link>} bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {d.awaitingPayment.slice(0, 30).map((r) => (
                <tr key={r.id} className="border-t first:border-t-0">
                  <td className="px-4 py-2">
                    <Link href={`/projects/${r.projectId}/billing`} className={axLink}>
                      {r.number} · {r.job}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.who}</td>
                  <td className={`px-4 py-2 tabular-nums ${r.daysLate > 0 ? "text-red-600" : ""}`}>due {day(r.dueDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{usd(r.balance)}</td>
                </tr>
              ))}
              {!d.awaitingPayment.length && (
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">No open invoices.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">Record a check or ACH from the job&apos;s Invoices &amp; payments tab.</p>
      </Panel>
    </div>
  );
}
