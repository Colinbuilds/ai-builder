import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emailConfigured } from "@/lib/email/send";
import { proposalUrl } from "@/lib/proposals/service";
import type { Alternate } from "@/lib/proposals/price";
import { voidProposalAction } from "@/app/proposal-actions";
import { SendProposal } from "@/components/proposals/send-proposal";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/utils";

const when = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string; pid: string }>;
}) {
  await requireUser(["ADMIN", "ESTIMATOR"]);
  const { id, pid } = await params;
  const p = await prisma.proposal.findUnique({ where: { id: pid } });
  if (!p || p.projectId !== id) notFound();
  const alts = (p.alternates as Alternate[] | null) ?? [];
  const scope = p.scope as { weWill: string[]; weWillNot: string[] };
  const url = proposalUrl(p.token);
  const live = ["DRAFT", "SENT", "VIEWED"].includes(p.status);
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Link
        href={`/projects/${id}/proposals`}
        className="text-sm text-muted-foreground"
      >
        ← Proposals
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">Proposal {p.number}</h2>
        <Badge
          variant={
            p.status === "SIGNED"
              ? "green"
              : p.status === "DECLINED" || p.status === "VOID"
                ? "red"
                : "blue"
          }
        >
          {p.status.toLowerCase()}
        </Badge>
        <a
          className="text-sm underline"
          href={`/api/proposals/${p.id}/pdf`}
          target="_blank"
        >
          PDF
        </a>
        {live && (
          <form action={voidProposalAction}>
            <input type="hidden" name="id" value={p.id} />
            <Button size="sm" variant="ghost">
              Void
            </Button>
          </form>
        )}
      </div>
      <section className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Estimate cost</div>
          <div className="font-semibold">{formatUsd(p.costTotal)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Tax</div>
          <div className="font-semibold">{formatUsd(p.taxAmount)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Markup</div>
          <div className="font-semibold">{p.markupPct}%</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Price to customer</div>
          <div className="text-lg font-semibold">{formatUsd(p.basePrice)}</div>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-4">
          {p.priceNote}
        </p>
        {alts.length > 0 && (
          <p className="sm:col-span-4">
            Options:{" "}
            {alts.map((a) => `${a.name} (+${formatUsd(a.price)})`).join(" · ")}
          </p>
        )}
      </section>
      <section className="flex flex-col gap-2 text-sm">
        <h3 className="font-semibold">Customer link</h3>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-xs break-all">
            {url}
          </code>
          <CopyButton text={url} label="Copy link" />
          <a className="underline" href={`/p/${p.token}`} target="_blank">
            Preview as customer
          </a>
        </div>
        {live && (
          <SendProposal
            id={p.id}
            name={p.recipientName}
            email={p.recipientEmail}
            canEmail={emailConfigured()}
          />
        )}
      </section>
      <section className="grid gap-1 text-sm sm:grid-cols-2">
        <span>Created: {when(p.createdAt)}</span>
        <span>Sent: {when(p.sentAt)}</span>
        <span>Opened by customer: {when(p.viewedAt)}</span>
        <span>Valid until: {when(p.validUntil)}</span>
        {p.signedAt && (
          <span className="sm:col-span-2">
            Signed {when(p.signedAt)} by {p.signerName} ({p.signerEmail}) from{" "}
            {p.signerIp ?? "?"} — accepted{" "}
            {formatUsd(p.acceptedTotal ?? p.basePrice)}
            {((p.selectedAlternates as string[] | null) ?? []).length
              ? ` incl. ${(p.selectedAlternates as string[]).join(", ")}`
              : ""}
          </span>
        )}
        {p.declinedAt && (
          <span className="text-destructive sm:col-span-2">
            Declined {when(p.declinedAt)}
            {p.declineReason ? `: ${p.declineReason}` : ""}
          </span>
        )}
      </section>
      <section className="grid gap-4 text-sm md:grid-cols-2">
        <div>
          <h3 className="font-semibold">We Will</h3>
          <ul className="list-disc pl-5">
            {scope.weWill.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">We Will Not</h3>
          <ul className="list-disc pl-5">
            {scope.weWillNot.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
