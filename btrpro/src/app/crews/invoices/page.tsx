import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts } from "@/lib/costing/service";
import { REQUIRED_STAGES, STAGE_LABEL } from "@/lib/crew/service";
import { InvoiceReview } from "@/components/crew/office";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markPaidAction } from "../crew-portal-actions";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const TABS = [
  ["SUBMITTED", "To review"],
  ["APPROVED", "Approved, not paid"],
  ["PAID", "Paid"],
  ["REJECTED", "Sent back"],
] as const;

export default async function CrewInvoices({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  const want = (await searchParams).s;
  const s = TABS.find(([k]) => k === want)?.[0] ?? "SUBMITTED";
  const [rows, counts] = await Promise.all([
    prisma.crewInvoice.findMany({
      where: { status: s },
      include: { crew: { select: { id: true, name: true, kind: true } }, project: { select: { id: true, name: true, address: true, estimatorId: true, salespersonId: true } } },
      orderBy: { createdAt: s === "SUBMITTED" ? "asc" : "desc" },
      take: 200,
    }),
    prisma.crewInvoice.groupBy({ by: ["status"], _count: true }),
  ]);
  // billing visibility follows job costing: Admins, or the job's own estimator/salesperson
  const visible = rows.filter((r) => canSeeCosts(user, r.project));
  const photos = await prisma.jobPhoto.groupBy({
    by: ["crewId", "projectId", "stage", "review"],
    where: { OR: visible.map((r) => ({ crewId: r.crewId, projectId: r.projectId })) },
    _count: true,
  });
  const photoLine = (crewId: string, projectId: string) => {
    const mine = photos.filter((p) => p.crewId === crewId && p.projectId === projectId);
    const n = (stage: string) => mine.filter((p) => p.stage === stage).reduce((a, p) => a + p._count, 0);
    const issues = mine.filter((p) => p.review === "ISSUE").reduce((a, p) => a + p._count, 0);
    const unreviewed = mine.filter((p) => p.review === "PENDING").reduce((a, p) => a + p._count, 0);
    return { text: (["BEFORE", "PROGRESS", ...REQUIRED_STAGES] as const).map((st) => `${STAGE_LABEL[st]} ${n(st)}`).join(" · "), issues, unreviewed };
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Crew invoices</h1>
        <p className="text-sm text-muted-foreground">
          Sent by crews from their portal. Check the job photos for quality and cleanup, then approve — the invoice becomes a labor (crew) or subcontractor (sub) cost on the job.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/crews/invoices?s=${k}`} className={`rounded-md border px-3 py-1 ${s === k ? "border-btr-black bg-btr-black text-white" : "hover:bg-muted"}`}>
            {l} <span className="tabular-nums opacity-70">{counts.find((c) => c.status === k)?._count ?? 0}</span>
          </Link>
        ))}
      </nav>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
      <ul className="flex flex-col gap-3">
        {visible.map((r) => {
          const ph = photoLine(r.crewId, r.projectId);
          return (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-btr-line p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <Link href={`/crews/${r.crew.id}`} className="font-semibold hover:underline">
                    {r.crew.name}
                  </Link>{" "}
                  <Badge variant="outline">{r.crew.kind === "SUB" ? "Sub" : "Crew"}</Badge> ·{" "}
                  <Link href={`/projects/${r.project.id}`} className="text-btr-link hover:underline">
                    {r.project.name}
                  </Link>
                  {r.project.address && <span className="text-muted-foreground"> · {r.project.address}</span>}
                </div>
                <span className="text-lg font-semibold tabular-nums">{usd(r.amount)}</span>
              </div>
              <div className="text-muted-foreground">
                {r.invoiceNumber ? `Invoice ${r.invoiceNumber} · ` : ""}
                {r.invoiceDate.toLocaleDateString("en-US", { timeZone: "UTC" })} · sent {r.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })}
              </div>
              <p>{r.description}</p>
              <div className="flex flex-wrap items-center gap-3">
                {r.fileUrl && (
                  <a href={`/api/crew/invoice/${r.id}`} target="_blank" className="text-btr-link underline">
                    Open invoice file
                  </a>
                )}
                <Link href={`/projects/${r.project.id}/photos#crew`} className="text-btr-link underline">
                  Job photos
                </Link>
                <span className="text-muted-foreground">{ph.text}</span>
                {ph.issues > 0 && <Badge variant="red">{ph.issues} flagged</Badge>}
                {ph.unreviewed > 0 && <Badge variant="amber">{ph.unreviewed} not checked</Badge>}
              </div>
              {r.reviewNote && (
                <p>
                  <span className="font-medium">Note:</span> {r.reviewNote} {r.reviewedBy && <span className="text-muted-foreground">— {r.reviewedBy}</span>}
                </p>
              )}
              {r.status === "SUBMITTED" && <InvoiceReview id={r.id} />}
              {r.status === "APPROVED" && user.role === "ADMIN" && (
                <form action={markPaidAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button size="sm" variant="outline">
                    Mark paid
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
