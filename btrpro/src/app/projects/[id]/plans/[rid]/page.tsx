import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listTemplates } from "@/lib/estimates/templates";
import {
  SCOPE_CATEGORIES,
  SCOPE_LABEL,
  briefSuggestions,
  type PlanBrief,
} from "@/lib/docs/plan-review";
import { INTAKE_BY_KEY } from "@/lib/projects/intake";
import { StartFromTemplate } from "@/components/estimates/templates";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function PlanBriefPage({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const user = await requireUser();
  const { id, rid } = await params;
  const r = await prisma.planReview.findUnique({
    where: { id: rid },
    include: { document: true },
  });
  if (!r || r.projectId !== id || r.status !== "OK" || !r.brief) notFound();
  const b = r.brief as unknown as PlanBrief;
  const project = await prisma.project.findUniqueOrThrow({
    where: { id },
    select: { clientCompanyId: true },
  });
  const templates = await listTemplates({ companyId: project.clientCompanyId });
  const suggestions = briefSuggestions(b, templates);
  const canEdit = user.role !== "VIEWER";
  const pg = (p: number) => (
    <a
      href={`/api/documents/${r.documentId}#page=${p}`}
      target="_blank"
      className="whitespace-nowrap underline"
    >
      p.{p}
    </a>
  );
  const Quote = ({ q }: { q: string }) => (
    <p className="text-xs text-muted-foreground italic">“{q}”</p>
  );
  const sent = r.pagesSent as number[] | null;
  const rfiText = b.rfis
    .map(
      (x, i) => `${i + 1}. ${x.question}${x.page ? ` (ref. p.${x.page})` : ""}`,
    )
    .join("\n");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/projects/${id}/plans`}
          className="text-sm text-muted-foreground"
        >
          ← Plan review
        </Link>
        <h2 className="text-lg font-semibold">
          Estimator brief: {r.document.fileName}
        </h2>
        <p className="text-xs text-muted-foreground">
          {r.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}{" "}
          ·{" "}
          {sent
            ? `${sent.length} of ${r.document.pages ?? "?"} pages read`
            : `all ${r.document.pages ?? ""} pages read`}{" "}
          · {r.message}
        </p>
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Read by AI from the documents. Check each item against its page before
          pricing. No quantities were taken off the drawings — measurements come
          from EagleView or the confirmed values on the{" "}
          <Link className="underline" href={`/projects/${id}/documents`}>
            Documents tab
          </Link>
          .
        </p>
      </div>

      <section className="flex flex-col gap-1">
        <h3 className="font-semibold">Summary</h3>
        {b.projectDescription && (
          <p className="text-sm font-medium">{b.projectDescription}</p>
        )}
        <p className="text-sm whitespace-pre-wrap">{b.summary}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Suggested templates</h3>
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No template matches the products specified. Start a blank estimate,
            or save one as a template once it&apos;s set up.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {suggestions.slice(0, 8).map((s) => (
              <li
                key={s.templateId}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge
                      variant={
                        s.strength === "EXACT"
                          ? "green"
                          : s.strength === "BRAND"
                            ? "blue"
                            : "outline"
                      }
                    >
                      {s.strength === "EXACT"
                        ? "Specified product"
                        : s.strength === "BRAND"
                          ? "Same brand"
                          : "Same material type"}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {s.reason}
                  </span>
                  {s.warning && (
                    <span className="text-xs text-destructive">
                      {s.warning}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <StartFromTemplate projectId={id} templateId={s.templateId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">
          RFIs — questions for the builder ({b.rfis.length})
        </h3>
        {b.rfis.length ? (
          <>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
              {b.rfis.map((x, i) => (
                <li key={i}>
                  {x.question}{" "}
                  {x.page && <span className="text-xs">({pg(x.page)})</span>}
                  <span className="block text-xs text-muted-foreground">
                    {x.reason}
                  </span>
                </li>
              ))}
            </ol>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Copy as an email
              </summary>
              <textarea
                readOnly
                className="mt-1 h-40 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
                defaultValue={rfiText}
              />
            </details>
            <p className="text-xs text-muted-foreground">
              These are also on the job as open items (owner: Estimator).
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">None raised.</p>
        )}
      </section>

      {b.conflicts.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">Conflicts between sheets</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {b.conflicts.map((c, i) => (
              <li key={i}>
                {c.text}{" "}
                {c.pages.map((p) => (
                  <span key={p} className="mr-1 text-xs">
                    {pg(p)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Scope called for</h3>
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH>Called for</TH>
              <TH>Product</TH>
              <TH>Where</TH>
              <TH>Page</TH>
            </TR>
          </THead>
          <TBody>
            {SCOPE_CATEGORIES.flatMap((cat) =>
              b.scopeItems
                .filter((s) => s.category === cat)
                .map((s, i) => (
                  <TR key={`${cat}${i}`}>
                    <TD className="text-sm font-medium whitespace-nowrap">
                      {SCOPE_LABEL[cat]}
                    </TD>
                    <TD className="max-w-md text-sm">
                      {s.description}
                      <Quote q={s.quote} />
                    </TD>
                    <TD className="text-sm">
                      {s.product ?? (
                        <span className="text-muted-foreground">not named</span>
                      )}
                      {s.orEqual && (
                        <span className="block text-xs text-muted-foreground">
                          or equal allowed
                        </span>
                      )}
                    </TD>
                    <TD className="text-sm">{s.location ?? "—"}</TD>
                    <TD className="text-sm">{pg(s.page)}</TD>
                  </TR>
                )),
            )}
            {b.scopeItems.length === 0 && (
              <TR>
                <TD
                  colSpan={5}
                  className="py-4 text-center text-muted-foreground"
                >
                  Nothing in our trades was found in the pages read.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Roof systems</h3>
          {b.roofSystems.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {b.roofSystems.map((x, i) => (
                <li key={i}>
                  {x.area && <span className="font-medium">{x.area}: </span>}
                  {x.system} {pg(x.page)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None stated.</p>
          )}
          <h3 className="mt-2 font-semibold">Pitches (to confirm)</h3>
          {b.pitches.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {b.pitches.map((x, i) => (
                <li key={i}>
                  {x.rise}/12{x.label && ` · ${x.label}`} {pg(x.page)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No pitches printed in the pages read.
            </p>
          )}
          {b.roofArea && (
            <p className="text-sm">
              Printed area: {b.roofArea.valueSf.toLocaleString()} SF (
              {b.roofArea.source === "ROOF_PLAN"
                ? "roof plan — to confirm"
                : "not a roof plan — rejected under ROOF-01"}
              ) {pg(b.roofArea.page)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Requirements</h3>
          {b.requirements.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {b.requirements.map((x, i) => (
                <li key={i}>
                  <Badge
                    variant={
                      x.kind === "IMPACT_RATING" || x.kind === "WARRANTY"
                        ? "blue"
                        : "outline"
                    }
                  >
                    {x.kind.replace(/_/g, " ").toLowerCase()}
                  </Badge>{" "}
                  {x.text} {pg(x.page)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None stated.</p>
          )}
          {b.facts.length > 0 && (
            <>
              <h3 className="mt-2 font-semibold">Facts (to confirm)</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {b.facts.map((f, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">
                      {f.key === "spec_section"
                        ? "Spec section"
                        : (INTAKE_BY_KEY.get(f.key)?.label ?? f.key)}
                      :
                    </span>{" "}
                    {f.value} {pg(f.page)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">By others / not in contract</h3>
          {b.byOthers.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {b.byOthers.map((x, i) => (
                <li key={i}>
                  {x.text} {pg(x.page)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None stated.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Alternates</h3>
          {b.alternates.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {b.alternates.map((x, i) => (
                <li key={i}>
                  {x.text} {pg(x.page)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None stated.</p>
          )}
        </div>
      </section>

      {b.sheetIndex.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">Sheets that matter</h3>
          <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {b.sheetIndex.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.sheet}</span> {s.title}{" "}
                {pg(s.page)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
