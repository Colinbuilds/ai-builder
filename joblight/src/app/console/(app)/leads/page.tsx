import Link from "next/link";
import { prisma } from "@/lib/db";
import { tradeLabel } from "@/lib/trades";
import { monthlyFor, usd } from "@/lib/pricing";
import { setLeadStatus } from "../../actions";

const STATUSES = [
  ["NEW", "New"],
  ["CONTACTED", "Contacted"],
  ["DEMO_BOOKED", "Demo booked"],
  ["WON", "Won"],
  ["LOST", "Lost"],
] as const;

export default async function Leads() {
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Leads</h1>
      {!leads.length && <p className="text-sm text-muted">No demo requests yet. They arrive from the Book a demo page.</p>}
      <div className="grid gap-3">
        {leads.map((l) => {
          const est = l.users ? (l.users <= 20 ? monthlyFor(l.users) : null) : null;
          return (
            <div key={l.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold">{l.company}</span>
                <span className="text-sm text-muted">{tradeLabel(l.trade)}</span>
                <span className="text-sm text-muted">
                  {l.users ? `${l.users} users${est != null ? ` · ~${usd(est)}/mo` : " · custom"}` : "team size not given"}
                </span>
                <span className="ml-auto text-xs text-muted">{l.createdAt.toLocaleDateString("en-US")}</span>
              </div>
              <p className="mt-1 text-sm">
                {l.name} ·{" "}
                <a href={`mailto:${l.email}`} className="underline">
                  {l.email}
                </a>
                {l.phone && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={`tel:${l.phone}`} className="underline">
                      {l.phone}
                    </a>
                  </>
                )}
              </p>
              {l.message && <p className="mt-2 text-sm whitespace-pre-line text-muted">“{l.message}”</p>}
              <form action={setLeadStatus} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={l.id} />
                <select name="status" defaultValue={l.status} className="field h-9 w-40">
                  {STATUSES.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <input name="notes" defaultValue={l.notes ?? ""} placeholder="Notes" className="field h-9 min-w-48 flex-1" />
                <button className="btn-ghost h-9">Save</button>
                {l.status !== "WON" && (
                  <Link href={`/console/buildouts/new?lead=${l.id}`} className="btn h-9">
                    Start buildout
                  </Link>
                )}
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
