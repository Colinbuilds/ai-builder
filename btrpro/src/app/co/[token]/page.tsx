import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BTR } from "@/lib/company";
import { getChangeOrderByToken } from "@/lib/billing/change-orders";
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
        <p className="text-2xl font-semibold">{usd(co.amount)}</p>
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
