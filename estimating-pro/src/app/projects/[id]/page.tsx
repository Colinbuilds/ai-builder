import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { INTAKE_FIELDS, parseScopes, SCOPE_LABEL } from "@/lib/projects/intake";
import { computeReadiness } from "@/lib/projects/readiness";
import { loadReadinessInput, refreshReadiness } from "@/lib/projects/service";
import { showForm17Banner } from "@/lib/projects/workflow";
import { ProjectForm } from "@/components/projects/project-form";
import { StageControl } from "@/components/projects/stage-control";
import { Form17Banner } from "@/components/projects/form17-panel";
import { IntakeRow } from "@/components/projects/intake-row";
import { AddContact } from "@/components/projects/add-contact";
import { ReadinessBadge, StageBadge } from "@/components/projects/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatUsd } from "@/lib/utils";
import { updateDetailsAction, removeProjectContactAction } from "../actions";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      intake: true,
      clientCompany: true,
      salesperson: { select: { name: true } },
      estimator: { select: { name: true } },
      contacts: { include: { contact: { include: { company: true } } }, orderBy: [{ isPrimary: "desc" }] },
      activity: { include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!project) notFound();
  const canEdit = user.role !== "VIEWER";

  // Readiness is recomputed on every view so sheet expirations are picked up the day they happen.
  const { readiness, blockers } = computeReadiness(await loadReadinessInput(id));
  if (readiness !== project.readiness) await refreshReadiness(id);

  const [companies, users, allContacts] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: { not: "VIEWER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.contact.findMany({ include: { company: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
  ]);
  const intakeByKey = new Map(project.intake.map((f) => [f.key, f]));
  const scopes = parseScopes(project.scopes);
  const onJob = new Set(project.contacts.map((c) => c.contactId));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted-foreground">
          ← Jobs
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <StageBadge stage={project.status} />
          <ReadinessBadge readiness={readiness} />
          {project.isPublic && <Badge variant="outline">Public</Badge>}
          {project.isTaxExempt && <Badge variant="outline">Tax-exempt</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {[project.address, project.clientCompany?.name, scopes.map((s) => SCOPE_LABEL[s]).join(", ")].filter(Boolean).join(" · ")}
          {project.bidDueDate && ` · bid due ${formatDate(project.bidDueDate)}`}
          {project.acculynxJobNumber && ` · AccuLynx #${project.acculynxJobNumber}`}
        </p>
        {project.status === "LOST" && project.lostReason && <p className="text-sm">Lost: {project.lostReason}</p>}
      </div>

      {showForm17Banner(project) && <Form17Banner id={project.id} canEdit={canEdit} />}
      {project.form17Status === "EXECUTED" && (
        <p className="text-sm text-green-800 dark:text-green-300">
          Form 17 executed {formatDate(project.form17ExecutedAt)} (recorded by {project.form17ExecutedBy})
          {project.form17Note && ` — ${project.form17Note}`}
        </p>
      )}

      {canEdit && (
        <section className="rounded-md border p-4">
          <StageControl key={project.status} id={project.id} current={project.status} />
        </section>
      )}

      <section id="readiness" className="rounded-md border p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{readiness === "BID_READY" ? "Bid ready" : "Why not bid ready?"}</h2>
          <ReadinessBadge readiness={readiness} />
        </div>
        {blockers.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing is missing or assumed.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {blockers.map((b) => (
              <li key={b.message} className="flex items-start gap-2">
                <Badge variant={b.severity === "blocks_number" ? "red" : "amber"}>
                  {b.severity === "blocks_number" ? "Blocks the number" : "Assumption"}
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
          Values come only from documents, client answers, or approved assumptions. An assumption needs a basis and is NOT FOR
          FINAL BID.
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

      <section id="estimates" className="rounded-md border p-4 text-sm">
        <h2 className="font-semibold">Estimates</h2>
        <p className="mt-1 text-muted-foreground">The estimate builder arrives in Phase 7. Readiness already checks estimate lines, waste, labor, and sheet dates.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Contacts</h2>
          {project.contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts on this job yet.</p>}
          <ul className="flex flex-col gap-2 text-sm">
            {project.contacts.map((pc) => (
              <li key={pc.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {pc.contact.firstName} {pc.contact.lastName}
                </span>
                <Badge variant="outline">{pc.role.replace(/_/g, " ").toLowerCase()}</Badge>
                {pc.isPrimary && <Badge variant="blue">primary</Badge>}
                <span className="text-muted-foreground">
                  {[pc.contact.company?.name, pc.contact.phone, pc.contact.email].filter(Boolean).join(" · ")}
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
                  .map((c) => ({ id: c.id, label: `${c.lastName}, ${c.firstName}${c.company ? ` — ${c.company.name}` : ""}` }))}
              />
              <Link href={`/customers/new?kind=contact&returnTo=/projects/${project.id}`} className="text-sm underline">
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
                  {a.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
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
              contractSignedAt: iso(project.contractSignedAt),
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Salesperson {project.salesperson?.name ?? "—"} · Estimator {project.estimator?.name ?? "—"} · Lead source{" "}
            {project.leadSource ?? "—"}
          </p>
        )}
        {canEdit && project.contractAmount != null && (
          <p className="text-sm text-muted-foreground">
            Contract {formatUsd(project.contractAmount)}
            {project.contractSignedAt ? `, signed ${formatDate(project.contractSignedAt)}` : ", not signed yet"}
          </p>
        )}
      </section>
    </div>
  );
}
