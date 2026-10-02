import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { relationships, type Health } from "@/lib/reports/relationships";

const LABEL: Record<Health, string> = { DORMANT: "Gone quiet", DECLINING: "Sending fewer bids", COOLING: "Cooling off", ACTIVE: "Active" };
const TONE: Record<Health, string> = { DORMANT: "bg-red-100 text-red-800", DECLINING: "bg-amber-100 text-amber-900", COOLING: "bg-amber-50 text-amber-800", ACTIVE: "bg-green-100 text-green-800" };

export default async function CustomersHealth() {
  await requireUser(STAFF_ROLES);
  const r = await relationships();
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Customer relationships</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          GCs and builders who sent BTR 3+ bids in the last two years, from the estimating schedule. Repeat customers are most of the work, and a GC who stops inviting you rarely says so — the bid
          invitations just stop. Call the quiet ones: outreach works best 30–90 days after an account goes quiet.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {(["DORMANT", "DECLINING", "COOLING", "ACTIVE"] as Health[]).map((h) => (
          <div key={h} className="rounded-lg border bg-background p-3">
            <div className="text-xs text-muted-foreground">{LABEL[h]}</div>
            <div className="text-lg font-semibold tabular-nums">{r.counts[h]}</div>
            <div className="text-[11px] text-muted-foreground">
              {h === "DORMANT" ? "no bid request in 4+ months" : h === "COOLING" ? "none in 2–4 months" : h === "DECLINING" ? "this year's bids under half of last year's" : "bid in the last 2 months"}
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5">Customer</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5">Last bid request</th>
              <th className="px-2 py-1.5 text-right">Bids, last 12 mo</th>
              <th className="px-2 py-1.5 text-right">Prior 12 mo</th>
              <th className="px-2 py-1.5 text-right">Won</th>
              <th className="px-2 py-1.5 text-right">Win rate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {r.customers.map((c) => (
              <tr key={c.name}>
                <td className="px-2 py-1.5">
                  {c.name} <span className="text-xs text-muted-foreground">{c.market.toLowerCase()}</span>
                </td>
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[c.health]}`}>{LABEL[c.health]}</span>
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {c.last.toISOString().slice(0, 10)} <span className="text-xs text-muted-foreground">({c.days} days)</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.bids12}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.bidsPrior12}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.won}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.rate == null ? "—" : `${c.rate}%`}</td>
              </tr>
            ))}
            {!r.customers.length && (
              <tr>
                <td colSpan={7} className="px-2 py-2 text-muted-foreground">
                  No customers with 3+ bids yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
