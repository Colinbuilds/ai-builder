import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getByToken, markViewed } from "@/lib/proposals/service";
import type { Alternate } from "@/lib/proposals/price";
import { BTR } from "@/lib/company";
import { SignForm } from "@/components/proposals/sign-form";

export const metadata: Metadata = { title: `Proposal — ${BTR.name}`, robots: { index: false } };
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function PublicProposal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await getByToken(token);
  if (!p) notFound();
  await markViewed(token);
  const alts = (p.alternates as Alternate[] | null) ?? [];
  const scope = p.scope as { weWill: string[]; weWillNot: string[] };
  const expired = !!p.validUntil && p.validUntil < new Date();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
      <header className="border-b pb-3">
        <p className="text-xl font-semibold">{BTR.name}</p>
        <p className="text-sm text-muted-foreground">
          {BTR.address} · {BTR.phone} · {BTR.email}
        </p>
      </header>
      <div>
        <h1 className="text-2xl font-semibold">Proposal {p.number}</h1>
        <p>{p.title}</p>
        <p className="text-sm text-muted-foreground">
          {p.recipientName && `Prepared for ${p.recipientName} · `}
          {p.createdAt.toLocaleDateString("en-US")}
          {p.validUntil && ` · valid until ${p.validUntil.toLocaleDateString("en-US")}`}
        </p>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Scope of work</h2>
          <ul className="list-disc pl-5 text-sm">{scope.weWill.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        <div>
          <h2 className="font-semibold">Not included</h2>
          <ul className="list-disc pl-5 text-sm">{scope.weWillNot.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </section>
      <section>
        <h2 className="font-semibold">Price</h2>
        <p className="text-2xl font-semibold">{usd(p.basePrice)}</p>
        {p.depositPct && <p className="text-sm text-muted-foreground">Deposit due at signing: {p.depositPct}%</p>}
      </section>
      <section>
        <h2 className="font-semibold">Terms</h2>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{p.terms}</p>
      </section>
      {p.status === "SIGNED" ? (
        <section className="rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
          <p className="font-semibold">Signed by {p.signerName} on {p.signedAt?.toLocaleString("en-US")}. Thank you!</p>
          <p className="text-sm">Accepted total: {usd(p.acceptedTotal ?? p.basePrice)}</p>
          <a className="text-sm underline" href={`/api/p/${token}/pdf`}>
            Download your signed copy
          </a>
        </section>
      ) : p.status === "DECLINED" ? (
        <p className="rounded-md border p-4">You declined this proposal. Call {BTR.phone} if you&apos;d like to talk it over.</p>
      ) : expired ? (
        <p className="rounded-md border p-4">This proposal has expired. Call {BTR.phone} for an updated one.</p>
      ) : (
        <SignForm token={token} base={p.basePrice} alternates={alts} depositPct={p.depositPct} defaultName={p.recipientName ?? ""} defaultEmail={p.recipientEmail ?? ""} />
      )}
    </div>
  );
}
