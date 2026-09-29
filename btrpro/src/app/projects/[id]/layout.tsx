import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseScopes, SCOPE_LABEL } from "@/lib/projects/intake";
import { refreshReadiness } from "@/lib/projects/service";
import { showForm17Banner } from "@/lib/projects/workflow";
import { unreadCounts } from "@/lib/comms/chat";
import { Form17Banner } from "@/components/projects/form17-panel";
import { ReadinessBadge, StageBadge } from "@/components/projects/badges";
import { ProjectTabs } from "@/components/projects/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatUsd } from "@/lib/utils";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { clientCompany: true, _count: { select: { emails: true, documents: true, estimates: true } } },
  });
  if (!project) notFound();
  const canEdit = user.role !== "VIEWER";
  // Recomputed on every view so sheet expirations are picked up the day they happen.
  const { readiness } = await refreshReadiness(id);
  const unread = (await unreadCounts(user.id, [id]))[id];
  const scopes = parseScopes(project.scopes);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted-foreground">
          ← Jobs
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-1 text-2xl font-semibold">{project.name}</h1>
          <Badge variant="outline">{project.market === "RESIDENTIAL" ? "Residential" : "Commercial"}</Badge>
          <StageBadge stage={project.status} />
          <ReadinessBadge readiness={readiness} />
          {project.isInsuranceClaim && <Badge variant="blue">Insurance claim</Badge>}
          {project.isPublic && <Badge variant="outline">Public</Badge>}
          {project.isTaxExempt && <Badge variant="outline">Tax-exempt</Badge>}
          {project.prevailingWage && <Badge variant="outline">Prevailing wage</Badge>}
          {project.bidBondRequired && <Badge variant="outline">Bid bond</Badge>}
          {project.perfBondRequired && <Badge variant="outline">P&amp;P bond</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {[project.address, project.clientCompany?.name, scopes.map((s) => SCOPE_LABEL[s]).join(", ")].filter(Boolean).join(" · ")}
          {project.bidDueDate && ` · bid due ${formatDate(project.bidDueDate)}`}
          {project.acculynxJobNumber && ` · AccuLynx #${project.acculynxJobNumber}`}
        </p>
        {project.status === "LOST" && project.lostReason && <p className="text-sm">Lost: {project.lostReason}</p>}
        {project.isInsuranceClaim && (
          <p className="text-sm">
            <span className="font-medium">Claim:</span>{" "}
            {[
              project.insuranceCarrier,
              project.claimNumber && `#${project.claimNumber}`,
              project.dateOfLoss && `loss ${formatDate(project.dateOfLoss)}`,
              canEdit && project.deductible != null && `deductible ${formatUsd(project.deductible)}`,
              project.adjusterName && `adjuster ${project.adjusterName}`,
              project.adjusterPhone,
              project.adjusterEmail,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
      {showForm17Banner(project) && <Form17Banner id={project.id} canEdit={canEdit} />}
      <ProjectTabs
        id={project.id}
        counts={{ chat: unread?.unread ?? 0, mentioned: !!unread?.mentioned, email: project._count.emails, documents: project._count.documents, estimates: project._count.estimates }}
      />
      {children}
    </div>
  );
}
