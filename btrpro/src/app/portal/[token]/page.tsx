import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCompany } from "@/lib/company-profile";
import { getPortal } from "@/lib/portal/customer";
import { INVOICE_KIND_LABEL } from "@/lib/billing/math";

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return {
  title: `Your project — ${co.name}`,
  robots: { index: false },
};
}
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const d = (x: Date) =>
  x.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const KIND: Record<string, string> = {
  INSTALL: "Install",
  TEAR_OFF: "Tear-off",
  INSPECTION: "Inspection",
  DUMPSTER: "Dumpster",
  REPAIR: "Repair",
  OTHER: "Scheduled",
};

export default async function CustomerPortal({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const co = await getCompany();
  const { token } = await params;
  const p = await getPortal(token);
  if (!p) notFound();
  const owed = p.invoices.reduce((a, i) => a + i.balance, 0);
  const upcoming = p.schedule.filter((e) => !e.done);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
      <header className="border-b pb-3">
        <p className="text-xl font-semibold">{co.name}</p>
        <p className="text-sm text-muted-foreground">
          {co.address} ·{" "}
          <a href={`tel:${co.phone}`} className="underline">
            {co.phone}
          </a>{" "}
          · {co.email}
        </p>
      </header>
      <div>
        <h1 className="text-2xl font-semibold">{p.project.name}</h1>
        {p.project.address && <p>{p.project.address}</p>}
        <p className="mt-1 inline-block rounded-md bg-muted px-2 py-1 text-sm font-medium">
          {p.project.stage}
        </p>
      </div>

      {owed > 0.005 && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          Balance due: <strong>{usd(owed)}</strong>. Open an invoice below to
          see how to pay.
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Schedule</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {p.schedule.length
              ? "All scheduled work is done."
              : "Not scheduled yet — we'll post dates here as soon as they're set."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {upcoming.map((e) => (
              <li key={e.id}>
                <strong>{d(e.start)}</strong>
                {e.end.getTime() !== e.start.getTime() &&
                  ` – ${d(e.end)}`} · {KIND[e.kind] ?? e.kind}
                {!e.confirmed && (
                  <span className="text-muted-foreground">
                    {" "}
                    (tentative — weather permitting)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {p.proposals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Proposal</h2>
          {p.proposals.map((x) => (
            <div
              key={x.number}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span>
                {x.number} · {x.title} · {usd(x.price)}
                <span className="block text-xs text-muted-foreground">
                  {x.status === "SIGNED"
                    ? `Signed ${x.signedAt?.toLocaleDateString("en-US")}`
                    : x.status === "DECLINED"
                      ? "Declined"
                      : "Waiting for your signature"}
                </span>
              </span>
              <a className="underline" href={`/p/${x.token}`}>
                {x.status === "SIGNED" || x.status === "DECLINED"
                  ? "View"
                  : "Review & sign"}
              </a>
            </div>
          ))}
        </section>
      )}

      {p.changeOrders.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Change orders</h2>
          {p.changeOrders.map((c) => (
            <div
              key={c.number}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span>
                {c.number} · {c.description} · {usd(c.amount)}
                <span className="block text-xs text-muted-foreground">
                  {c.status === "APPROVED"
                    ? "Approved"
                    : c.status === "REJECTED"
                      ? "Declined"
                      : "Waiting for your signature"}
                </span>
              </span>
              {c.token && (
                <a className="underline" href={`/co/${c.token}`}>
                  {c.status === "PENDING" ? "Review & sign" : "View"}
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Invoices &amp; payments</h2>
        {p.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          p.invoices.map((i) => (
            <div
              key={i.number}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm ${i.status === "VOID" ? "opacity-60" : ""}`}
            >
              <span>
                {i.number} · {INVOICE_KIND_LABEL[i.kind]} · {usd(i.amountDue)}
                <span className="block text-xs text-muted-foreground">
                  {i.status === "VOID"
                    ? "Void"
                    : i.balance <= 0.005
                      ? "Paid"
                      : `${usd(i.balance)} due ${d(i.dueDate)}`}
                  {i.payments
                    .map((x) => ` · paid ${usd(x.amount)} ${d(x.date)}`)
                    .join("")}
                </span>
              </span>
              <a className="underline" href={`/i/${i.token}`}>
                {i.balance > 0.005 && i.status !== "VOID"
                  ? "View & pay"
                  : "View"}
              </a>
            </div>
          ))
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Questions? Call {co.phone}. This page is private to you — please
        don&apos;t share the link.
      </p>
    </div>
  );
}
