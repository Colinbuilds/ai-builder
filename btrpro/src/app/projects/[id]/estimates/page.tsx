import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseScopes } from "@/lib/projects/intake";
import { totalsFor } from "@/lib/estimates/service";
import { NewEstimate } from "@/components/estimates/new-estimate";
import { listTemplates } from "@/lib/estimates/templates";

async function templateOpts(projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { clientCompanyId: true },
  });
  return (await listTemplates({ companyId: p?.clientCompanyId })).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    group: t.group,
    module: t.module,
    impactClass: t.impactClass,
  }));
}
import { Badge } from "@/components/ui/badge";
import { getSettings } from "@/lib/settings";
import { estimatePricing } from "@/lib/proposals/price";
import { formatUsd } from "@/lib/utils";

export default async function EstimatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { template } = await searchParams;
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  const estimates = await prisma.estimate.findMany({
    where: { projectId: id },
    orderBy: { revision: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  const [totals, proposals, settings] = await Promise.all([
    Promise.all(estimates.map((e) => totalsFor(e.id))),
    prisma.proposal.findMany({ where: { projectId: id, status: { not: "VOID" } }, orderBy: { createdAt: "desc" }, select: { estimateId: true, number: true, basePrice: true, taxAmount: true, costTotal: true, status: true } }),
    getSettings(),
  ]);
  const scopes = parseScopes(project.scopes);
  const canEdit = user.role !== "VIEWER";
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex flex-col gap-2">
          <NewEstimate
            projectId={id}
            defaultScope={
              scopes.length === 1
                ? scopes[0]
                : scopes.length
                  ? "MIXED"
                  : "STEEP"
            }
            templates={await templateOpts(id)}
            initialTemplate={template}
          />
          {estimates.length >= 2 && (
            <Link
              className="text-sm underline"
              href={`/projects/${id}/estimates/compare?a=${estimates[1].id}&b=${estimates[0].id}`}
            >
              Compare {estimates[1].name} → {estimates[0].name}
            </Link>
          )}
        </div>
      )}
      {estimates.length === 0 && <p className="rounded-lg border border-btr-line p-6 text-center text-sm text-muted-foreground">No estimates yet.</p>}
      <div className="flex flex-col gap-3">
        {estimates.map((e, i) => {
          const t = totals[i];
          const prop = proposals.find((p) => p.estimateId === e.id) ?? null;
          const pr = canEdit ? estimatePricing(t, { taxExempt: project.isTaxExempt, taxPct: settings.salesTaxPct, markupPct: settings.markupPct }, prop) : null;
          const sections: [string, number][] = [
            ["Materials", t.materials],
            ["General conditions", t.generalConditions],
            ["Labor", t.labor],
            ...(t.contingency ? ([["Contingency", t.contingency]] as [string, number][]) : []),
          ];
          return (
            <section key={e.id} className="overflow-hidden rounded-lg border border-btr-line bg-background">
              <div className="flex flex-wrap items-center gap-2 border-b border-btr-line px-4 py-2.5">
                <Badge variant={e.locked ? "outline" : "blue"}>{e.locked ? "Locked" : "Current"}</Badge>
                <Link href={`/projects/${id}/estimates/${e.id}`} className="font-semibold text-btr-link hover:underline">
                  {e.name}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {e.scopeType.replace("_", " ").toLowerCase()} · {e.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })} · {e.createdBy?.name ?? "—"}
                </span>
                {canEdit && t.incomplete && <Badge variant="red">INCOMPLETE</Badge>}
              </div>
              {canEdit && (
                <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                    {sections.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="text-right tabular-nums">{formatUsd(v)}</dd>
                      </div>
                    ))}
                    <dt className="border-t pt-1 font-semibold">Cost</dt>
                    <dd className="border-t pt-1 text-right font-semibold tabular-nums">{formatUsd(t.grandTotal)}</dd>
                  </dl>
                  {pr ? (
                    <div className={`flex flex-col gap-1 rounded-md p-3 text-sm ${pr.preview ? "border border-dashed border-btr-line" : "bg-btr-black text-white"}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={pr.preview ? "text-muted-foreground" : "text-white/70"}>Price</span>
                        <span className="text-xl font-semibold tabular-nums">{formatUsd(pr.price)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className={pr.preview ? "text-muted-foreground" : "text-white/70"}>Sales tax</span>
                        <span className="tabular-nums">{formatUsd(pr.tax)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className={pr.preview ? "text-muted-foreground" : "text-white/70"}>Gross profit · margin</span>
                        <span className="tabular-nums">
                          {formatUsd(pr.profit)} · {pr.marginPct}%
                        </span>
                      </div>
                      <span className={`text-xs ${pr.preview ? "text-muted-foreground" : "text-white/60"}`}>
                        {pr.source}
                        {t.incomplete ? " — cost is INCOMPLETE, so this isn't final" : ""}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Price shows once a proposal is made, or set a company markup under Settings → Company to preview it.</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
