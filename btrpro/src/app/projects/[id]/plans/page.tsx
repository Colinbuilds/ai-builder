import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiConfigured } from "@/lib/ai/claude";
import { PlanReviewButton } from "@/components/docs/plan-review-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const when = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function PlanReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const canEdit = user.role === "ADMIN" || user.role === "ESTIMATOR";
  const [docs, reviews] = await Promise.all([
    prisma.document.findMany({
      where: { projectId: id, type: { in: ["PLANS", "SPECS"] } },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.planReview.findMany({
      where: { projectId: id },
      include: { document: { select: { fileName: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const ai = aiConfigured();
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Plan &amp; spec review</h2>
        <p className="text-sm text-muted-foreground">
          For new construction: upload the plan set and project manual on the
          Documents tab, then review them here. You get an estimator brief —
          roof systems and pitches, wall claddings, trim, soffit, products
          specified, warranty and impact requirements, work by others, conflicts
          between sheets, and RFIs to send the builder — each with the page it
          came from. Big sets are trimmed to the roof plans, elevations,
          sections and Division 07. Nothing is measured off the drawings:
          pitches and a printed roof-plan area go to the confirmation queue, and
          RFIs become open items.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Plans and specs on this job</h3>
        <Table>
          <THead>
            <TR>
              <TH>File</TH>
              <TH>Type</TH>
              <TH>Pages</TH>
              <TH>Review</TH>
            </TR>
          </THead>
          <TBody>
            {docs.map((d) => (
              <TR key={d.id}>
                <TD className="max-w-xs">
                  <a
                    href={`/api/documents/${d.id}`}
                    target="_blank"
                    className="font-medium break-words hover:underline"
                  >
                    {d.fileName}
                  </a>
                </TD>
                <TD>{d.type === "SPECS" ? "Specs" : "Plans"}</TD>
                <TD className="tabular-nums">{d.pages ?? "—"}</TD>
                <TD>
                  {canEdit ? (
                    <PlanReviewButton
                      id={d.id}
                      projectId={id}
                      pages={d.pages}
                      disabled={!ai}
                    />
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
            ))}
            {docs.length === 0 && (
              <TR>
                <TD
                  colSpan={4}
                  className="py-6 text-center text-muted-foreground"
                >
                  No plans or specs yet.{" "}
                  <Link
                    className="underline"
                    href={`/projects/${id}/documents`}
                  >
                    Upload them on the Documents tab
                  </Link>{" "}
                  (or set a document&apos;s type to Plans / Specs).
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
        {!ai && (
          <p className="text-xs text-muted-foreground">
            AI reading is off: ANTHROPIC_API_KEY isn&apos;t set.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Reviews</h3>
        {reviews.length === 0 && (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
        <ul className="flex flex-col gap-2">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {r.status === "OK" ? (
                  <Link
                    href={`/projects/${id}/plans/${r.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.document.fileName}
                  </Link>
                ) : (
                  <span className="font-medium">{r.document.fileName}</span>
                )}
                <Badge variant={r.status === "OK" ? "green" : "red"}>
                  {r.status === "OK" ? "Brief ready" : "Failed"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {when(r.createdAt)}
                </span>
              </div>
              {r.message && (
                <p
                  className={`mt-1 text-xs ${r.status === "OK" ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {r.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
