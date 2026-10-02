import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { extrasDesk } from "@/lib/production/field";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function ExtrasPage() {
  await requireUser(STAFF_ROLES);
  const d = await extrasDesk();
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Extra work desk</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every extra-work tag and found-on-site issue the crews logged that isn&apos;t approved money yet, oldest first. Price a tag within a few days while the super still remembers asking for it — after 30 days
          most extras get written off. Price it from the job&apos;s Production tab; send the change order for signature from Costs.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card label="Tags not priced" value={String(d.unpriced)} bad={d.unpriced > 0 && (d.oldestUnpriced ?? 0) > 7} note={d.oldestUnpriced != null ? `oldest ${d.oldestUnpriced} days` : undefined} />
        <Card label="Priced, waiting on signature" value={usd(d.waitingAmount)} />
        <Card label="Under a week old" value={String(d.buckets.week)} />
        <Card label="Over 30 days old" value={String(d.buckets.older)} bad={d.buckets.older > 0} note={`${d.buckets.month} at 8–30 days`} />
      </div>
      {d.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing open. Crews log extra work from their job page in the crew portal.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Age</th>
                <th className="px-2 py-1.5">Job</th>
                <th className="px-2 py-1.5">What</th>
                <th className="px-2 py-1.5">Crew</th>
                <th className="px-2 py-1.5">Signed on site</th>
                <th className="px-2 py-1.5">Where it stands</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className={`px-2 py-1.5 tabular-nums ${r.days > 30 ? "font-semibold text-red-700" : r.days > 7 ? "text-amber-800" : ""}`}>{r.days}d</td>
                  <td className="px-2 py-1.5">
                    <Link href={`/projects/${r.projectId}/production#issues`} className="text-btr-link hover:underline">
                      {r.job}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">{r.kind === "EXTRA" ? "Tag" : "Found"}</span>
                    {r.note.slice(0, 120)}
                    {r.hours ? <span className="text-xs text-muted-foreground"> · {r.hours} man-hrs</span> : null}
                  </td>
                  <td className="px-2 py-1.5">{r.crew}</td>
                  <td className="px-2 py-1.5">{r.signed ? "yes" : <span className="text-muted-foreground">no</span>}</td>
                  <td className="px-2 py-1.5">
                    {r.stage === "UNPRICED" ? (
                      <span className="text-amber-800">needs a price</span>
                    ) : (
                      <span>
                        {r.co?.number} {usd(r.co?.amount ?? 0)} · {r.co?.sentAt ? "sent, waiting on signature" : <b className="text-amber-800">not sent yet</b>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${bad ? "border-red-300 bg-red-50 dark:bg-red-950/30" : "bg-background"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs">{note}</div>}
    </div>
  );
}
