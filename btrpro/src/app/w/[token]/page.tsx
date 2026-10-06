import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getWorkOrderByToken, markWorkOrderViewed } from "@/lib/production/service";
import { getCompany } from "@/lib/company-profile";
import { CrewWorkOrderButtons } from "@/components/production/forms";

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return { title: `Work order — ${co.name}`, robots: { index: false } };
}
const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "TBD");

/** What the crew sees on their phone. No login; the link is the key. No costs except their own pay. */
export default async function CrewWorkOrder({ params }: { params: Promise<{ token: string }> }) {
  const co = await getCompany();
  const { token } = await params;
  const w = await getWorkOrderByToken(token);
  if (!w) notFound();
  await markWorkOrderViewed(token);
  const p = w.project;
  const owner = p.contacts[0]?.contact;
  const scope = (w.scope as string[] | null) ?? [];
  const excl = (w.exclusions as string[] | null) ?? [];
  const maps = p.address ? `https://maps.google.com/?q=${encodeURIComponent(p.address)}` : null;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 py-2">
      <header>
        <p className="text-sm text-muted-foreground">
          {co.name} · {co.phone}
        </p>
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="text-sm">
          Work order {w.number} · {w.crew.name}
        </p>
      </header>
      <section className="rounded-md border p-3">
        <p className="font-medium">{p.address ?? "Address: call the office"}</p>
        {maps && (
          <a href={maps} className="text-sm underline">
            Open in Maps
          </a>
        )}
        {owner && (
          <p className="text-sm">
            Customer: {owner.firstName} {owner.lastName}
            {owner.phone && (
              <>
                {" · "}
                <a href={`tel:${owner.phone}`} className="underline">
                  {owner.phone}
                </a>
              </>
            )}
          </p>
        )}
        <p className="text-sm">Start: {fmt(w.startDate)}</p>
        {p.scheduleEvents.map((e) => (
          <p key={e.id} className="text-sm text-muted-foreground">
            {fmt(e.startDate)}
            {e.endDate.getTime() !== e.startDate.getTime() && ` – ${fmt(e.endDate)}`}: {e.title}
          </p>
        ))}
      </section>
      <section>
        <h2 className="font-semibold">Scope</h2>
        <ul className="list-disc pl-5 text-sm">{scope.length ? scope.map((s, i) => <li key={i}>{s}</li>) : <li>Call the office for the scope.</li>}</ul>
        {excl.length > 0 && (
          <>
            <h3 className="mt-2 text-sm font-semibold">Not included</h3>
            <ul className="list-disc pl-5 text-sm">
              {excl.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {w.instructions && <p className="mt-2 rounded-md bg-muted p-2 text-sm">{w.instructions}</p>}
      </section>
      {p.materialOrders.length > 0 && (
        <section>
          <h2 className="font-semibold">Materials</h2>
          {p.materialOrders.map((o) => (
            <div key={o.id} className="mb-2 text-sm">
              <p className="text-muted-foreground">
                {o.number}: {o.status === "DELIVERED" ? "delivered" : `delivery ${fmt(o.confirmedDate ?? o.requestedDate)}`} · {o.dropLocation}
              </p>
              <ul className="pl-1">
                {o.lines.map((l) => (
                  <li key={l.id}>
                    {l.quantity} {l.unit} — {l.description}
                    {l.backordered > 0 && <span className="text-amber-700"> ({l.backordered} backordered)</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {w.amount != null && (
        <p className="text-sm">
          Your pay: <strong>${w.amount.toFixed(2)}</strong> {w.payFormula && <span className="text-muted-foreground">({w.payFormula})</span>}
        </p>
      )}
      {w.status !== "CANCELLED" && <CrewWorkOrderButtons token={token} status={w.status} />}
    </div>
  );
}
