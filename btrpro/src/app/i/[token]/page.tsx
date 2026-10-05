import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCompany } from "@/lib/company-profile";
import { getSettings } from "@/lib/settings";
import { getInvoiceByToken, stripeConfigured } from "@/lib/billing/service";
import {
  balanceDue,
  cardSurcharge,
  INVOICE_KIND_LABEL,
} from "@/lib/billing/math";
import { payOnlineAction } from "@/app/projects/billing-actions";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return {
  title: `Invoice — ${co.name}`,
  robots: { index: false },
};
}
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const d = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "UTC" });

export default async function PublicInvoice({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; error?: string }>;
}) {
  const co = await getCompany();
  const { token } = await params;
  const { paid, error } = await searchParams;
  const inv = await getInvoiceByToken(token);
  if (!inv) notFound();
  if (!inv.viewedAt)
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { viewedAt: new Date() },
    });
  const s = await getSettings();
  const bal = balanceDue(inv);
  const sur = cardSurcharge(bal, s.cardSurchargePct);
  const lines = inv.lines as { description: string; amount: number }[];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
      <header className="border-b pb-3">
        <p className="text-xl font-semibold">{co.name}</p>
        <p className="text-sm text-muted-foreground">
          {co.address} · {co.phone} · {co.email}
        </p>
      </header>
      <div>
        <h1 className="text-2xl font-semibold">
          {inv.status === "VOID" && "VOID — "}Invoice {inv.number}
        </h1>
        <p>
          {inv.project.name}
          {inv.project.address && ` · ${inv.project.address}`}
        </p>
        <p className="text-sm text-muted-foreground">
          {INVOICE_KIND_LABEL[inv.kind]} · issued {d(inv.issueDate)} · due{" "}
          {d(inv.dueDate)}
          {inv.billTo && ` · bill to ${inv.billTo}`}
        </p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{usd(l.amount)}</td>
            </tr>
          ))}
          {inv.retainage > 0 && (
            <tr className="border-b text-muted-foreground">
              <td className="py-2">Retainage withheld ({inv.retainagePct}%)</td>
              <td className="py-2 text-right tabular-nums">
                −{usd(inv.retainage)}
              </td>
            </tr>
          )}
          {inv.payments.map((p) => (
            <tr key={p.id} className="border-b text-muted-foreground">
              <td className="py-2">Payment received {d(p.date)}</td>
              <td className="py-2 text-right tabular-nums">−{usd(p.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-semibold">Balance due</td>
            <td className="py-2 text-right text-lg font-semibold tabular-nums">
              {usd(bal)}
            </td>
          </tr>
        </tbody>
      </table>
      {inv.notes && <p className="text-sm whitespace-pre-wrap">{inv.notes}</p>}
      {paid && (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          Thank you — your card payment went through. It will show here in a
          moment.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-300 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {inv.status === "VOID" ? (
        <p className="rounded-md border p-3 text-sm">
          This invoice was voided. Nothing is due on it.
        </p>
      ) : bal <= 0 ? (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          Paid in full. Thank you!
        </p>
      ) : (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="font-semibold">How to pay</h2>
          {stripeConfigured() && (
            <form action={payOnlineAction} className="flex flex-col gap-1">
              <input type="hidden" name="token" value={token} />
              <Button className="self-start">Pay {usd(bal)} by card</Button>
              {sur.surcharge > 0 && (
                <span className="text-xs text-muted-foreground">
                  A {s.cardSurchargePct}% card surcharge ({usd(sur.surcharge)})
                  is added. No surcharge on check or ACH.
                </span>
              )}
            </form>
          )}
          {s.remitTo ? (
            <p className="text-sm whitespace-pre-wrap">{s.remitTo}</p>
          ) : (
            <p className="text-sm">Call {co.phone} to pay by check or ACH.</p>
          )}
        </section>
      )}
      <a className="text-sm underline" href={`/api/i/${token}`}>
        Download PDF
      </a>
    </div>
  );
}
