import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCompany } from "@/lib/company-profile";
import { crewPortal } from "@/lib/portal/crew";
import { CrewLogForm, CrewTicketForm } from "@/components/portal/forms";

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return {
  title: `Crew — ${co.name}`,
  robots: { index: false },
};
}
const d = (x: Date) =>
  x.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const maps = (a: string) =>
  `https://maps.google.com/?q=${encodeURIComponent(a)}`;

/** The crew's phone page. No login; the link is the key. Shows only their jobs and their own logged work. */
export default async function CrewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const co = await getCompany();
  const { token } = await params;
  const c = await crewPortal(token);
  if (!c) notFound();
  const todayMs = c.today.getTime();
  const isToday = (s: Date, e: Date) =>
    s.getTime() <= todayMs + 86_399_999 && e.getTime() >= todayMs;
  const today = c.events.filter((e) => isToday(e.startDate, e.endDate));
  const later = c.events.filter((e) => !isToday(e.startDate, e.endDate));
  const piece = c.crew.payType === "PIECE";
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-2 text-base">
      <header>
        <p className="text-sm text-muted-foreground">
          {co.name} ·{" "}
          <a href={`tel:${co.phone}`} className="underline">
            {co.phone}
          </a>
        </p>
        <h1 className="text-2xl font-semibold">{c.crew.name}</h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Today</h2>
        {today.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing on the schedule today.
          </p>
        )}
        {today.map((e) => (
          <div key={e.id} className="rounded-md border p-3">
            <p className="font-medium">{e.project?.name ?? e.title}</p>
            <p className="text-sm">{e.title}</p>
            {e.project?.address && (
              <a href={maps(e.project.address)} className="text-sm underline">
                {e.project.address} — Maps
              </a>
            )}
            {e.weatherNote && (
              <p className="text-sm text-amber-700">{e.weatherNote}</p>
            )}
            {e.notes && (
              <p className="text-sm text-muted-foreground">{e.notes}</p>
            )}
          </div>
        ))}
      </section>

      {later.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Next two weeks</h2>
          {later.map((e) => (
            <p key={e.id} className="text-sm">
              <strong>{d(e.startDate)}</strong>
              {e.endDate.getTime() !== e.startDate.getTime() &&
                `–${d(e.endDate)}`}{" "}
              · {e.project?.name ?? e.title}
              {e.status === "TENTATIVE" && (
                <span className="text-muted-foreground"> (tentative)</span>
              )}
            </p>
          ))}
        </section>
      )}

      {c.orders.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Work orders</h2>
          {c.orders.map((w) => (
            <a
              key={w.id}
              href={`/w/${w.token}`}
              className="rounded-md border p-3 text-sm hover:bg-muted"
            >
              <span className="font-medium">{w.number}</span> · {w.project.name}
              <span className="block text-muted-foreground">
                {w.status === "IN_PROGRESS" ? "In progress" : "Open"} — tap for
                scope, materials and pay
              </span>
            </a>
          ))}
        </section>
      )}

      {c.jobs.length > 0 && (
        <>
          <section className="flex flex-col gap-2 rounded-md border p-3">
            <h2 className="text-lg font-semibold">
              {piece ? "Log work done" : "Log hours"}
            </h2>
            <CrewLogForm
              token={token}
              jobs={c.jobs}
              piece={piece}
              unit={c.crew.rateUnit}
              today={c.today.toISOString().slice(0, 10)}
            />
          </section>
          <section className="flex flex-col gap-2 rounded-md border p-3">
            <h2 className="text-lg font-semibold">Delivery ticket</h2>
            <p className="text-sm text-muted-foreground">
              Snap the ticket when materials drop. It goes on the job for the
              office.
            </p>
            <CrewTicketForm token={token} jobs={c.jobs} />
          </section>
        </>
      )}

      {c.recent.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Logged recently</h2>
          {c.recent.map((t) => (
            <p key={t.id} className="text-sm">
              {d(t.date)} · {t.project.name} ·{" "}
              {t.basis === "HOURLY" ? `${t.hours} h` : `${t.qty} ${t.unit}`} ·{" "}
              {t.approvedAt ? "approved" : "waiting for approval"}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
