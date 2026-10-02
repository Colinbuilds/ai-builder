import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { LIEN_DAYS, riskDesk } from "@/lib/reports/risk";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: "UTC" }) : "—");

function When({ days }: { days: number | null }) {
  if (days == null) return <span className="text-amber-700">not on file</span>;
  if (days < 0) return <b className="text-red-700">lapsed {-days} days ago</b>;
  return <span className={days <= 15 ? "font-semibold text-red-700" : days <= 30 ? "text-amber-800" : ""}>in {days} days</span>;
}

export default async function RiskPage() {
  await requireUser(STAFF_ROLES);
  const r = await riskDesk();
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Risk desk</h1>
        <p className="text-sm text-muted-foreground">Dates that cost real money when they slip by: crew insurance and the Nebraska lien deadline.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          Crew & sub insurance {r.lapsedWithWork > 0 && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{r.lapsedWithWork} lapsed with open work</span>}
        </h2>
        <p className="text-xs text-muted-foreground">
          GL (certificate of insurance) and workers&apos; comp are separate policies with separate dates. A crew without workers&apos; comp on your job puts their payroll on your WC audit. Expiring within 60 days, or missing
          with open work. Update dates on each crew&apos;s page.
        </p>
        <div className="overflow-x-auto rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Crew / sub</th>
                <th className="px-2 py-1.5">COI (general liability)</th>
                <th className="px-2 py-1.5">Workers&apos; comp</th>
                <th className="px-2 py-1.5">Open work</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.crews.map((c) => (
                <tr key={c.id} className={c.worst < 0 && c.openWork ? "bg-red-50 dark:bg-red-950/30" : ""}>
                  <td className="px-2 py-1.5">
                    <Link href={`/crews/${c.id}`} className="text-btr-link hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  {c.items.map((i) => (
                    <td key={i.what} className="px-2 py-1.5">
                      {day(i.date)} · <When days={i.days} />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 tabular-nums">{c.openWork ? `${c.openWork} job line${c.openWork === 1 ? "" : "s"}` : "none"}</td>
                </tr>
              ))}
              {!r.crews.length && (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-muted-foreground">
                    Nothing expiring in the next 60 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Lien deadlines on unpaid jobs</h2>
        <p className="text-xs text-muted-foreground">
          In Nebraska a construction lien must be recorded within {LIEN_DAYS} days after the last day BTR furnished labor or materials (Neb. Rev. Stat. § 52-137). On owner-occupied residential (&quot;protected
          party&quot;) jobs a Notice of Right to Lien should have been served. If a deadline is close and the money isn&apos;t coming, call the attorney now — the deadline doesn&apos;t move.
        </p>
        <div className="overflow-x-auto rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Job</th>
                <th className="px-2 py-1.5 text-right">Owed</th>
                <th className="px-2 py-1.5">Last work</th>
                <th className="px-2 py-1.5">Record lien by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.liens.map((l) => (
                <tr key={l.id} className={l.daysLeft != null && l.daysLeft <= 30 ? (l.daysLeft < 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-amber-50 dark:bg-amber-950/30") : ""}>
                  <td className="px-2 py-1.5">
                    <Link href={`/projects/${l.id}/billing`} className="text-btr-link hover:underline">
                      {l.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{l.market.toLowerCase()}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{usd(l.owed)}</td>
                  <td className="px-2 py-1.5 text-xs">{l.lastWork ? `${day(l.lastWork)} (${l.lastWorkSource})` : <span className="text-amber-700">no completion date — mark the job complete or schedule its work days</span>}</td>
                  <td className="px-2 py-1.5">
                    {day(l.deadline)} {l.daysLeft != null && (l.daysLeft < 0 ? <b className="text-red-700">· passed</b> : <span className={l.daysLeft <= 30 ? "font-semibold text-amber-800" : "text-muted-foreground"}>· {l.daysLeft} days left</span>)}
                  </td>
                </tr>
              ))}
              {!r.liens.length && (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-muted-foreground">
                    No unpaid invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
