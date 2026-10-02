import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { CLAUSES, type ContractFindings } from "@/lib/docs/contract-review";

const TONE = { HIGH: "border-red-300 bg-red-50 dark:bg-red-950/30", MEDIUM: "border-amber-300 bg-amber-50 dark:bg-amber-950/30", LOW: "bg-background" } as const;
const TERM_LABEL: Record<string, string> = {
  contract_sum: "Contract sum",
  retainage: "Retainage",
  payment_terms: "Payment terms",
  warranty: "Warranty",
  liquidated_damages: "Liquidated damages",
  insurance: "Insurance",
  change_order_notice: "Change-order / claim notice",
};

export default async function ContractReviewPage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  await requireUser(STAFF_ROLES);
  const { id, rid } = await params;
  const r = await prisma.contractReview.findUnique({ where: { id: rid } });
  if (!r || r.projectId !== id) notFound();
  const doc = await prisma.document.findUnique({ where: { id: r.documentId }, select: { id: true, fileName: true } });
  const findings = r.findings as ContractFindings["findings"];
  const terms = r.terms as ContractFindings["terms"];
  const missing = r.missing as string[];
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <Link href={`/projects/${id}/documents`} className="text-sm text-btr-link hover:underline">
          ← Documents
        </Link>
        <h1 className="text-2xl font-semibold">Contract review</h1>
        <p className="text-sm text-muted-foreground">
          {doc && (
            <a href={`/api/documents/${doc.id}`} target="_blank" className="text-btr-link hover:underline">
              {doc.fileName}
            </a>
          )}{" "}
          · BTRbot, {r.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} · a checklist for whoever signs, not legal advice — send HIGH items to the attorney.
        </p>
      </div>
      <p className="rounded-md border bg-background p-3 text-sm">{r.summary}</p>

      <section className="grid gap-2 sm:grid-cols-2">
        {Object.entries(terms).map(([k, v]) => (
          <div key={k} className="rounded-md border bg-background px-3 py-2 text-sm">
            <div className="text-xs text-muted-foreground">{TERM_LABEL[k] ?? k}</div>
            <div>{v ?? <span className="text-muted-foreground">not stated</span>}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">
          Clauses to look at ({findings.filter((f) => f.risk === "HIGH").length} high, {findings.filter((f) => f.risk === "MEDIUM").length} medium)
        </h2>
        {findings.map((f, i) => (
          <div key={i} className={`rounded-md border p-3 text-sm ${TONE[f.risk]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>
                {f.risk} · {CLAUSES[f.clause] ?? f.clause}
              </b>
              {f.where && <span className="text-xs text-muted-foreground">{f.where}</span>}
            </div>
            <blockquote className="mt-1 border-l-2 pl-2 text-xs italic">&ldquo;{f.quote}&rdquo;</blockquote>
            <p className="mt-1">{f.plain}</p>
            {f.ask && (
              <p className="mt-1">
                <b>Ask for:</b> {f.ask}
              </p>
            )}
          </div>
        ))}
        {!findings.length && <p className="text-sm text-muted-foreground">No risky clauses found.</p>}
      </section>

      {missing.length > 0 && (
        <section className="flex flex-col gap-1 rounded-md border bg-background p-3 text-sm">
          <h2 className="font-semibold">Missing protections</h2>
          <ul className="list-disc pl-5">
            {missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
