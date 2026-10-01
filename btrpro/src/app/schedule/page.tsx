import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calendar, crewsWithCompliance } from "@/lib/production/service";
import { addDays, atNoon, day } from "@/lib/production/rules";
import { EventControls, EventForm } from "@/components/production/forms";
import { EVENT_KINDS } from "@/lib/production/rules";
import { crewWarning } from "@/components/production/compliance-badge";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function monday(d: Date) {
  const n = new Date(`${day(d)}T12:00:00Z`);
  const dow = n.getUTCDay();
  return addDays(n, dow === 0 ? -6 : 1 - dow);
}

export default async function Schedule({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const start = sp.from ? monday(atNoon(sp.from)) : monday(new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })));
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  const end = days[13];
  const crewId = sp.crew || null;
  const [{ events, deliveries }, crews, projects] = await Promise.all([
    calendar(start, end, crewId),
    crewsWithCompliance(),
    prisma.project.findMany({ where: { status: { in: ["SOLD", "SCHEDULED", "IN_PRODUCTION", "COMPLETE"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const crewOpts = crews.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, kind: c.kind, warn: crewWarning(c.compliance) }));
  const today = day(new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })));
  const q = (from: Date) => `/schedule?from=${day(from)}${crewId ? `&crew=${crewId}` : ""}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={q(addDays(start, -7))} className="underline">
            ← week
          </Link>
          <Link href="/schedule" className="underline">
            this week
          </Link>
          <Link href={q(addDays(start, 7))} className="underline">
            week →
          </Link>
        </div>
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="from" value={day(start)} />
          <Select name="crew" defaultValue={crewId ?? ""} className="h-8 w-56">
            <option value="">All crews + deliveries</option>
            {crewOpts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </div>
      {events.some((e) => e.conflict === "OPEN") && <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">A crew is double-booked in this window (shown in red).</p>}
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const k = day(d);
          const evs = events.filter((e) => day(e.startDate) <= k && k <= day(e.endDate));
          const dels = deliveries.filter((o) => day(o.when) === k);
          const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
          return (
            <div key={k} className={`flex min-h-28 flex-col gap-1 rounded-md border p-2 text-xs ${k === today ? "border-primary" : ""} ${weekend ? "bg-muted/40" : ""}`}>
              <p className="font-medium">
                {DOW[d.getUTCDay()]} {d.getUTCMonth() + 1}/{d.getUTCDate()}
              </p>
              {evs.map((e) => (
                <div
                  key={e.id}
                  className={`rounded border px-1.5 py-1 ${e.status === "CANCELLED" ? "line-through opacity-50" : e.conflict === "OPEN" ? "border-red-400 bg-red-50 dark:bg-red-950" : e.conflict ? "border-amber-400 bg-amber-50 dark:bg-amber-950" : e.status === "CONFIRMED" ? "border-blue-300 bg-blue-50 dark:bg-blue-950" : e.status === "DONE" ? "opacity-60" : "border-dashed"}`}
                >
                  <p className="font-medium">
                    {EVENT_KINDS[e.kind]}: {e.title}
                  </p>
                  {e.project && (
                    <Link href={`/projects/${e.project.id}/production`} className="block underline">
                      {e.project.name}
                    </Link>
                  )}
                  <p className="text-muted-foreground">
                    {e.crew?.name ?? "no crew"} · {e.status.toLowerCase()}
                  </p>
                  {e.weatherNote && <p className="text-amber-700">{e.weatherNote}</p>}
                  {e.conflict === "ACCEPTED" && <p className="text-amber-700">double-booked on purpose</p>}
                  {user.role !== "VIEWER" && k === day(e.startDate) && <EventControls id={e.id} projectId={e.projectId} status={e.status} start={day(e.startDate)} end={day(e.endDate)} crewId={e.crewId} crews={crewOpts} />}
                </div>
              ))}
              {dels.map((o) => (
                <Link key={o.id} href={`/projects/${o.project.id}/orders/${o.id}`} className="rounded border border-amber-300 bg-amber-50 px-1.5 py-1 dark:bg-amber-950">
                  <Badge variant="amber">delivery</Badge> {o.project.name}
                  <span className="block text-muted-foreground">
                    {o.number} · {o.dropLocation}
                    {!o.confirmedDate && " · not confirmed"}
                  </span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      {user.role !== "VIEWER" && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Add to the schedule</h2>
          <EventForm projects={projects} crews={crewOpts} />
          <p className="text-xs text-muted-foreground">Scheduling an install on a sold job moves it to Scheduled; that needs a signed contract (and the Form 17 on public tax-exempt jobs). Deliveries come from material orders.</p>
        </section>
      )}
    </div>
  );
}
