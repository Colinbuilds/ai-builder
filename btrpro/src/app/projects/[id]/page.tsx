import Link from "next/link";
import { DeleteJob } from "@/components/projects/delete-job";
import { deleteBlocker } from "@/lib/projects/delete";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { INTAKE_FIELDS, parseScopes, SCOPE_LABEL } from "@/lib/projects/intake";
import { computeReadiness } from "@/lib/projects/readiness";
import { loadReadinessInput } from "@/lib/projects/service";
import { aiConfigured } from "@/lib/ai/claude";
import { CatchUp } from "@/components/comms/catch-up";
import { ProjectForm } from "@/components/projects/project-form";
import { StageControl } from "@/components/projects/stage-control";
import { IntakeRow } from "@/components/projects/intake-row";
import { AddContact } from "@/components/projects/add-contact";
import { ReadinessBadge } from "@/components/projects/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatUsd } from "@/lib/utils";
import { updateDetailsAction, removeProjectContactAction } from "../actions";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const fmt = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      intake: true,
      clientCompany: true,
      salesperson: { select: { name: true } },
      estimator: { select: { name: true } },
      contacts: {
        include: { contact: { include: { company: true } } },
        orderBy: [{ isPrimary: "desc" }],
      },
      activity: {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!project) notFound();
  const canEdit = user.role !== "VIEWER";

  // Readiness is recomputed on every view so sheet expirations are picked up the day they happen.
  const { readiness, blockers } = computeReadiness(
    await loadReadinessInput(id),
  );
  const latestSummary = await prisma.jobSummary.findFirst({
    where: { projectId: id, kind: "CATCH_UP", createdById: user.id },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const [companies, users, allContacts] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { not: "VIEWER" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.contact.findMany({
      include: { company: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);
  const [estimateCount, latestReview, openRfis] = await Promise.all([
    prisma.estimate.count({ where: { projectId: id } }),
    prisma.planReview.findFirst({
      where: { projectId: id, status: "OK" },
      include: { document: { select: { fileName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.openItem.count({
      where: { projectId: id, resolved: false, text: { startsWith: "RFI (" } },
    }),
  ]);
  const intakeByKey = new Map(project.intake.map((f) => [f.key, f]));
  const scopes = parseScopes(project.scopes);
  const onJob = new Set(project.contacts.map((c) => c.contactId));

  return (
    <div className="flex flex-col gap-6">
      <CatchUp
        projectId={project.id}
        aiReady={aiConfigured()}
        latest={
          latestSummary && {
            content: latestSummary.content,
            createdAt: fmt(latestSummary.createdAt),
            coversFrom: latestSummary.coversFrom
              ? fmt(latestSummary.coversFrom)
              : null,
            by: latestSummary.createdBy?.name ?? null,
          }
        }
      />

      {canEdit && (
        <section className="rounded-md border p-4">
          <StageControl
            key={project.status}
            id={project.id}
            current={project.status}
          />
        </section>
      )}

      <section id="readiness" className="rounded-md border p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">
            {readiness === "BID_READY" ? "Bid ready" : "Why not bid ready?"}
          </h2>
          <ReadinessBadge readiness={readiness} />
        </div>
        {blockers.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is missing or assumed.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {blockers.map((b) => (
              <li key={b.message} className="flex items-start gap-2">
                <Badge
                  variant={b.severity === "blocks_number" ? "red" : "amber"}
                >
                  {b.severity === "blocks_number"
                    ? "Blocks the number"
                    : "Assumption"}
                </Badge>
                <a href={b.href} className="underline-offset-2 hover:underline">
                  {b.message}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="intake" className="flex flex-col gap-2">
        <h2 className="font-semibold">Missing-information checklist</h2>
        <p className="text-sm text-muted-foreground">
          Values come only from documents, client answers, or approved
          assumptions. An assumption needs a basis and is NOT FOR FINAL BID.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="border-b text-left text-muted-foreground">
                <th className="h-9 px-3 font-medium">Field</th>
                <th className="px-3 font-medium">Status</th>
                <th className="px-3 font-medium">Value · source</th>
                {canEdit && <th className="px-3 font-medium">By</th>}
              </tr>
            </thead>
            <tbody>
              {INTAKE_FIELDS.map((def) => {
                const f = intakeByKey.get(def.key);
                if (!f) return null;
                return (
                  <IntakeRow
                    key={def.key}
                    projectId={project.id}
                    canEdit={canEdit}
                    f={{ ...f, label: def.label, source: def.source }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="estimates"
        className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Estimates</h2>
          <p className="text-muted-foreground">
            {estimateCount
              ? `${estimateCount} revision${estimateCount === 1 ? "" : "s"}.`
              : "None yet."}{" "}
            Start one from a product-system template (GAF HDZ, Hardie Cedarmill,
            Mulehide EPDM…) so the products are filled in for you.
          </p>
          <Link
            className="self-start underline"
            href={`/projects/${id}/estimates`}
          >
            {estimateCount ? "Open estimates" : "Start an estimate"} →
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Plan review</h2>
          {latestReview ? (
            <p className="text-muted-foreground">
              Latest brief: {latestReview.document.fileName}. {openRfis} open
              RFI{openRfis === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className="text-muted-foreground">
              New construction? Upload the plans and specs, and get a brief with
              scope, products, requirements and RFIs.
            </p>
          )}
          <Link
            className="self-start underline"
            href={
              latestReview
                ? `/projects/${id}/plans/${latestReview.id}`
                : `/projects/${id}/plans`
            }
          >
            {latestReview ? "Open the brief" : "Review plans"} →
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Contacts</h2>
          {project.contacts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No contacts on this job yet.
            </p>
          )}
          <ul className="flex flex-col gap-2 text-sm">
            {project.contacts.map((pc) => (
              <li key={pc.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {pc.contact.firstName} {pc.contact.lastName}
                </span>
                <Badge variant="outline">
                  {pc.role.replace(/_/g, " ").toLowerCase()}
                </Badge>
                {pc.isPrimary && <Badge variant="blue">primary</Badge>}
                <span className="text-muted-foreground">
                  {[
                    pc.contact.company?.name,
                    pc.contact.phone,
                    pc.contact.email,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {canEdit && (
                  <form action={removeProjectContactAction}>
                    <input type="hidden" name="id" value={pc.id} />
                    <Button variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <>
              <AddContact
                projectId={project.id}
                contacts={allContacts
                  .filter((c) => !onJob.has(c.id))
                  .map((c) => ({
                    id: c.id,
                    label: `${c.lastName}, ${c.firstName}${c.company ? ` — ${c.company.name}` : ""}`,
                  }))}
              />
              <Link
                href={`/customers/new?kind=contact&returnTo=/projects/${project.id}`}
                className="text-sm underline"
              >
                New contact
              </Link>
            </>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Activity</h2>
          <ol className="flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
            {project.activity.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {a.createdAt.toLocaleString("en-US", {
                    timeZone: "America/Chicago",
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span>{a.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Job details</h2>
        {canEdit ? (
          <ProjectForm
            action={updateDetailsAction}
            companies={companies}
            users={users}
            showContract
            submitLabel="Save details"
            values={{
              ...project,
              scopes,
              bidDueDate: iso(project.bidDueDate),
              dateOfLoss: iso(project.dateOfLoss),
              contractSignedAt: iso(project.contractSignedAt),
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Salesperson {project.salesperson?.name ?? "—"} · Estimator{" "}
            {project.estimator?.name ?? "—"} · Lead source{" "}
            {project.leadSource ?? "—"}
          </p>
        )}
        {canEdit && project.contractAmount != null && (
          <p className="text-sm text-muted-foreground">
            Contract {formatUsd(project.contractAmount)}
            {project.contractSignedAt
              ? `, signed ${formatDate(project.contractSignedAt)}`
              : ", not signed yet"}
          </p>
        )}
      </section>
      {user.role === "ADMIN" && <DeleteJob id={project.id} name={project.name} blocker={await deleteBlocker(project.id)} />}
    </div>
  );
}
