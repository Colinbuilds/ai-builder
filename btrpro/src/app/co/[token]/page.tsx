import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BTR } from "@/lib/company";
import { getChangeOrderByToken } from "@/lib/billing/change-orders";
import { prisma } from "@/lib/db";
import { CoSignForm } from "@/components/billing/change-order-forms";

export const metadata: Metadata = {
  title: `Change order — ${BTR.name}`,
  robots: { index: false },
};
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function PublicChangeOrder({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const co = await getChangeOrderByToken(token);
  if (!co) notFound();
  const lines = (co.lines as { vendor: string; item: string; qty: string; amount: number }[] | null) ?? [];
  // contract before this change: original contract + change orders already approved (not this one)
  const earlier = await prisma.changeOrder.findMany({ where: { projectId: co.projectId, status: "APPROVED", id: { not: co.id } }, select: { kind: true, amount: true } });
  const before = co.project.contractAmount == null ? null : Math.round((co.project.contractAmount + earlier.reduce((a, c) => a + (c.kind === "CREDIT" ? -c.amount : c.amount), 0)) * 100) / 100;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
      <header className="border-b pb-3">
        <p className="text-xl font-semibold">{BTR.name}</p>
        <p className="text-sm text-muted-foreground">
          {BTR.address} · {BTR.phone} · {BTR.email}
        </p>
      </header>
      <div>
        <h1 className="text-2xl font-semibold">
          {co.kind === "SUPPLEMENT" ? "Supplement" : "Change order"} {co.number}
        </h1>
        <p>
          {co.project.name}
          {co.project.address && ` · ${co.project.address}`}
        </p>
      </div>
      <section className="flex flex-col gap-2">
        <p className="whitespace-pre-wrap">{co.description}</p>
        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-1 font-medium">Vendor</th>
                <th className="py-1 font-medium">Item</th>
                <th className="py-1 text-right font-medium">Qty</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1 pr-2">{l.vendor}</td>
                  <td className="py-1 pr-2">{l.item}</td>
                  <td className="py-1 pr-2 text-right">{l.qty}</td>
                  <td className="py-1 text-right tabular-nums">{usd(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-2xl font-semibold">{usd(co.amount)}</p>
        {before != null && co.status === "PENDING" && (
          <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-4 text-sm">
            <dt>Previous contract price</dt>
            <dd className="text-right tabular-nums">{usd(before)}</dd>
            <dt className="font-semibold">Contract price with this change</dt>
            <dd className="text-right font-semibold tabular-nums">{usd(before + co.amount)}</dd>
          </dl>
        )}
        <p className="text-sm text-muted-foreground">
          Added to your contract when you sign.
        </p>
      </section>
      {co.status === "APPROVED" ? (
        <p className="rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
          {co.signedAt
            ? `Signed by ${co.signerName} on ${co.signedAt.toLocaleString("en-US")}.`
            : "Approved."}{" "}
          Thank you!
        </p>
      ) : co.status === "REJECTED" ? (
        <p className="rounded-md border p-4">
          This change order was declined. Call {BTR.phone} if you&apos;d like to
          talk it over.
        </p>
      ) : (
        <CoSignForm
          token={token}
          amount={usd(co.amount)}
          defaultEmail={co.sentTo ?? ""}
        />
      )}
    </div>
  );
}
