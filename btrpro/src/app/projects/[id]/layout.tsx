import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseScopes, SCOPE_LABEL } from "@/lib/projects/intake";
import { refreshReadiness } from "@/lib/projects/service";
import { showForm17Banner } from "@/lib/projects/workflow";
import { unreadCounts } from "@/lib/comms/chat";
import { touchJob } from "@/lib/shell/recent";
import { Form17Banner } from "@/components/projects/form17-panel";
import { ReadinessBadge, StageBadge } from "@/components/projects/badges";
import { JobMenuBar } from "@/components/projects/job-menu";
import { PriorityPicker, WatchButton } from "@/components/projects/job-controls";
import { JobBody } from "@/components/projects/job-body";
import { MilestoneDot } from "@/components/shell/milestone-dot";
import { qboJobNumberAction } from "@/app/projects/actions";
import { canSeeCosts } from "@/lib/costing/service";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatUsd } from "@/lib/utils";
import { exemptForm } from "@/lib/company-profile";

const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function sinceText(d: Date) {
  const m = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)} days`;
}

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      clientCompany: true,
      salesperson: { select: { name: true } },
      _count: { select: { emails: true, documents: true, estimates: true, materialOrders: true, invoices: true, scheduleEvents: true } },
    },
  });
  if (!project) notFound();
  const canEdit = user.role !== "VIEWER";
  // Recomputed on every view so sheet expirations are picked up the day they happen.
  const [{ readiness }, unreadAll, proposals, lastProposal, watching] = await Promise.all([
    refreshReadiness(id),
    unreadCounts(user.id, [id]),
    prisma.proposal.count({ where: { projectId: id } }),
    prisma.proposal.findFirst({ where: { projectId: id, status: { in: ["SIGNED", "SENT", "VIEWED"] } }, orderBy: [{ signedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], select: { number: true, status: true, basePrice: true, acceptedTotal: true } }),
    prisma.jobWatch.findUnique({ where: { projectId_userId: { projectId: id, userId: user.id } } }),
    touchJob(id, user.id),
  ]);
  const unread = unreadAll[id];
  const scopes = parseScopes(project.scopes);
  const showCosts = canSeeCosts(user, project);
  // what the job is worth: the contract, else the signed proposal, else the latest one out for signature
  const jobValue =
    project.contractAmount != null
      ? { amount: project.contractAmount, note: project.contractSignedAt ? "contract" : "contract (not signed yet)" }
      : lastProposal
        ? { amount: lastProposal.acceptedTotal ?? lastProposal.basePrice, note: `${lastProposal.number} ${lastProposal.status.toLowerCase()}` }
        : null;
  const maps = project.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}` : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-3 -mt-4 shadow-sm sm:-mx-4 sm:-mt-5">
        {/* job header: milestone, name, address | priority, watch, salesperson */}
        <div className="flex flex-wrap items-stretch border-b bg-background">
          <div className="flex min-w-[min(100%,20rem)] flex-1 items-center gap-3 px-3 py-2">
            <Link href="/jobs" aria-label="Back to jobs" className="text-btr-blue">
              <ChevronLeft size={26} />
            </Link>
            <MilestoneDot stage={project.status} size={30} />
            <div className="min-w-0">
              <h1 className="text-lg leading-tight sm:truncate sm:text-xl">{project.name}</h1>
              {project.address &&
                (maps ? (
                  <a href={maps} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-btr-link hover:underline">
                    {project.address} <ExternalLink size={11} />
                  </a>
                ) : null)}
            </div>
            <div className="ml-2 hidden flex-wrap items-center gap-1.5 lg:flex">
              <StageBadge stage={project.status} />
              <ReadinessBadge readiness={readiness} />
              {project.qboJobNo ? (
                <span className="rounded-full border px-2 py-0.5 text-xs" title="QuickBooks estimate number for this job">
                  QB est #{project.qboJobNo}
                </span>
              ) : (
                user.role !== "VIEWER" && (
                  <form action={qboJobNumberAction}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <button className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted" title="Make the QuickBooks customer and estimate for this job and keep its number">
                      Get QuickBooks #
                    </button>
                  </form>
                )
              )}
            </div>
            {project.status === "LEAD" && !project.firstContactAt && (
              <span
                className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${Date.now() - project.createdAt.getTime() > 3_600_000 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"}`}
                title="Finish the 'Call new lead' task (or advance the job) once you've reached them"
              >
                Not contacted · {sinceText(project.createdAt)}
              </span>
            )}
          </div>
          <div className="flex w-full items-stretch divide-x border-t py-1.5 sm:w-auto sm:border-t-0 sm:border-l">
            <PriorityPicker projectId={id} priority={project.priority} canEdit={canEdit} />
            {canEdit && (
              <div className="flex flex-col justify-center px-3 text-xs" title={jobValue?.note}>
                <span className="text-muted-foreground">Job value</span>
                <span className="text-sm font-semibold text-btr-blue tabular-nums">{jobValue ? formatUsd(jobValue.amount) : "—"}</span>
              </div>
            )}
            <WatchButton projectId={id} watching={!!watching} />
            <div className="flex items-center gap-2 px-3 text-xs">
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                {project.salesperson ? initials(project.salesperson.name) : "—"}
              </span>
              <span className="hidden flex-col sm:flex">
                <span className="text-muted-foreground">Salesperson</span>
                <span className="text-btr-link">{project.salesperson?.name ?? "Unassigned"}</span>
              </span>
            </div>
          </div>
        </div>
        <JobMenuBar
          id={id}
          showCosts={showCosts}
          counts={{
            chat: unread?.unread ?? 0,
            mentioned: !!unread?.mentioned,
            email: project._count.emails,
            documents: project._count.documents,
            estimates: project._count.estimates,
            proposals,
            orders: project._count.materialOrders,
            invoices: project._count.invoices,
            events: project._count.scheduleEvents,
            photos: !!project.photoFolderId,
            house: project.builderHouse != null,
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Badge variant="outline">{project.market === "RESIDENTIAL" ? "Residential" : "Commercial"}</Badge>
        <span className="lg:hidden">
          <StageBadge stage={project.status} />
        </span>
        <span className="lg:hidden">
          <ReadinessBadge readiness={readiness} />
        </span>
        {project.priority === "HIGH" && <Badge variant="red">High priority</Badge>}
        {project.isInsuranceClaim && <Badge variant="blue">Insurance claim</Badge>}
        {project.clientCompany?.type === "BUILDER" && (
          <Link href={`/builders/${project.clientCompany.id}?tab=pricing`}>
            <Badge variant="blue">{project.clientCompany.name} pricing</Badge>
          </Link>
        )}
        {project.isPublic && <Badge variant="outline">Public</Badge>}
        {project.isTaxExempt && <Badge variant="outline">Tax-exempt</Badge>}
        {project.prevailingWage && <Badge variant="outline">Prevailing wage</Badge>}
        {project.bidBondRequired && <Badge variant="outline">Bid bond</Badge>}
        {project.perfBondRequired && <Badge variant="outline">P&amp;P bond</Badge>}
        <span className="text-muted-foreground">
          {[project.clientCompany?.name, scopes.map((s) => SCOPE_LABEL[s]).join(", ")].filter(Boolean).join(" · ")}
          {project.bidDueDate && ` · bid due ${formatDate(project.bidDueDate)}`}
          {project.acculynxJobNumber && ` · old job #${project.acculynxJobNumber}`}
        </span>
      </div>
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
      {showForm17Banner(project) && <Form17Banner id={project.id} canEdit={canEdit} form={exemptForm()} />}
      <JobBody id={id}>{children}</JobBody>
    </div>
  );
}
