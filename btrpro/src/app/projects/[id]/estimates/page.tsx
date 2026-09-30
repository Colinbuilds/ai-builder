import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseScopes } from "@/lib/projects/intake";
import { totalsFor } from "@/lib/estimates/service";
import { NewEstimate } from "@/components/estimates/new-estimate";
import { listTemplates } from "@/lib/estimates/templates";

async function templateOpts(projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { clientCompanyId: true } });
  return (await listTemplates({ companyId: p?.clientCompanyId })).map((t) => ({ id: t.id, name: t.name, category: t.category, group: t.group, module: t.module, impactClass: t.impactClass }));
}
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";

export default async function EstimatesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  const estimates = await prisma.estimate.findMany({ where: { projectId: id }, orderBy: { revision: "desc" }, include: { createdBy: { select: { name: true } } } });
  const totals = await Promise.all(estimates.map((e) => totalsFor(e.id)));
  const scopes = parseScopes(project.scopes);
  const canEdit = user.role !== "VIEWER";
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">New estimate</span>
          <NewEstimate projectId={id} defaultScope={scopes.length === 1 ? scopes[0] : scopes.length ? "MIXED" : "STEEP"} templates={await templateOpts(id)} />
          {estimates.length >= 2 && (
            <Link className="text-sm underline" href={`/projects/${id}/estimates/compare?a=${estimates[1].id}&b=${estimates[0].id}`}>
              Compare {estimates[1].name} → {estimates[0].name}
            </Link>
          )}
        </div>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Revision</TH>
            <TH>Scope</TH>
            <TH>Started</TH>
            {canEdit && <TH className="text-right">Total</TH>}
            <TH>State</TH>
          </TR>
        </THead>
        <TBody>
          {estimates.map((e, i) => (
            <TR key={e.id}>
              <TD>
                <Link href={`/projects/${id}/estimates/${e.id}`} className="font-medium hover:underline">
                  {e.name}
                </Link>
              </TD>
              <TD>{e.scopeType.replace("_", " ").toLowerCase()}</TD>
              <TD className="text-sm text-muted-foreground">
                {e.createdAt.toLocaleDateString("en-US", { timeZone: "America/Chicago" })} · {e.createdBy?.name ?? "—"}
              </TD>
              {canEdit && (
                <TD className="text-right tabular-nums">
                  {formatUsd(totals[i].grandTotal)} {totals[i].incomplete && <Badge variant="red">INCOMPLETE</Badge>}
                </TD>
              )}
              <TD>{e.locked ? <Badge variant="outline">Locked</Badge> : <Badge variant="blue">Current</Badge>}</TD>
            </TR>
          ))}
          {estimates.length === 0 && (
            <TR>
              <TD colSpan={5} className="py-6 text-center text-muted-foreground">
                No estimates yet.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
