import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BILLING_ROLES } from "@/lib/roles";
import { payTotals, type SovLine } from "@/lib/billing/payapps";
import { ContractSettings, NewPayApp } from "@/components/billing/payapp-forms";
import { appName } from "@/lib/company-profile";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function Contract({ params }: { params: Promise<{ cid: string }> }) {
  const user = await requireUser();
  const { cid } = await params;
  const c = await prisma.payContract.findUnique({ where: { id: cid }, include: { apps: { orderBy: { number: "desc" } } } });
  if (!c) notFound();
  const can = (BILLING_ROLES as readonly string[]).includes(user.role);
  const lines = c.lines as SovLine[];
  const T = payTotals(lines, c.retainagePct ?? 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/billing/pay-apps" className="text-sm text-muted-foreground hover:underline">
          ← Pay applications
        </Link>
        <h1 className="text-2xl font-semibold">{c.project}</h1>
        <span className="text-sm text-muted-foreground">
          {c.gc} · {c.superName} · contract {usd(T.scheduled)} · billed {usd(T.completed)} ({Math.round(T.pct * 100)}%)
          {c.source === "SHEET" ? " · schedule of values from the AIAs tab" : ""}
        </span>
      </div>
      {can && <ContractSettings id={c.id} retainagePct={c.retainagePct} submitVia={c.submitVia} dueNote={c.dueNote} />}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Applications</h2>
        {c.apps.length ? (
          <ul className="divide-y rounded-md border text-sm">
            {c.apps.map((a) => {
              const t = payTotals(a.lines as SovLine[], a.retainagePct);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <Link href={`/billing/pay-apps/${c.id}/${a.id}`} className="font-medium text-btr-link hover:underline">
                    Application #{a.number}
                  </Link>
                  <span>period to {a.periodTo.toLocaleDateString("en-US")}</span>
                  <span className="text-muted-foreground">{a.status.toLowerCase()}</span>
                  <span className="ml-auto tabular-nums">this period {usd(t.thisPeriod + t.stored)}</span>
                  <a href={`/api/pay-apps/${a.id}`} target="_blank" className="text-btr-link hover:underline">
                    PDF
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No applications made in {appName()} yet. The first one starts from what&apos;s already billed on the sheet.</p>
        )}
        {can && <NewPayApp id={c.id} />}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Schedule of values ({lines.length} lines)</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Scheduled</th>
                <th className="px-2 py-1.5 text-right">Billed so far</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l) => (
                <tr key={l.item + l.description}>
                  <td className="px-2 py-1 text-xs">{l.item}</td>
                  <td className="px-2 py-1">{l.description}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(l.scheduled)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(l.previous + l.thisPeriod + l.stored)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
