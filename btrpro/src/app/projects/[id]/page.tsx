import Link from "next/link";
import { DeleteJob } from "@/components/projects/delete-job";
import { PortalCard } from "@/components/portal/forms";
import { portalUrl } from "@/lib/portal/customer";
import { JobTasks, type TaskRow } from "@/components/tasks/task-list";
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
import { Panel, axLink } from "@/components/shell/panel";
import { MilestonesCard } from "@/components/projects/milestones-card";
import { MILESTONES, milestoneOf, prettyStages } from "@/lib/projects/milestones";
import { totalsFor } from "@/lib/estimates/service";
import { STAGE_LABEL, type Stage } from "@/lib/projects/workflow";
import { Collapsible } from "@/components/collapsible";
import { MEASUREMENT_BY_KEY } from "@/lib/docs/measurements";
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

  const [companies, users, allContacts, properties] = await Promise.all([
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
    prisma.property.findMany({ select: { id: true, name: true, address: true, companyId: true }, orderBy: { name: "asc" } }),
  ]);
  const jobTasks = (await prisma.task.findMany({
    where: { projectId: id },
    include: { assignee: { select: { name: true } }, project: { select: { id: true, name: true } } },
    orderBy: [{ doneAt: { sort: "desc", nulls: "first" } }, { dueDate: { sort: "asc", nulls: "last" } }],
  })) as TaskRow[];
  const [estimates, latestReview, openRfis, proposals, orders, invoices, stageMoves, counts] = await Promise.all([
    prisma.estimate.findMany({ where: { projectId: id }, select: { id: true, name: true, scopeType: true, createdAt: true, locked: true }, orderBy: { createdAt: "desc" } }),
    prisma.planReview.findFirst({
      where: { projectId: id, status: "OK" },
      include: { document: { select: { fileName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.openItem.count({
      where: { projectId: id, resolved: false, text: { startsWith: "RFI (" } },
    }),
    prisma.proposal.findMany({ where: { projectId: id }, select: { id: true, number: true, title: true, status: true, basePrice: true, acceptedTotal: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.materialOrder.findMany({ where: { projectId: id }, select: { id: true, number: true, supplier: true, status: true, requestedDate: true }, orderBy: { createdAt: "desc" } }),
    prisma.invoice.count({ where: { projectId: id, status: { not: "VOID" } } }),
    prisma.projectActivity.findMany({ where: { projectId: id, kind: { in: ["stage", "import"] } }, select: { data: true, text: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.project.findUniqueOrThrow({ where: { id }, select: { _count: { select: { emails: true, documents: true, messages: true } } } }),
  ]);
  const [measures, measureDocs] = await Promise.all([
    prisma.measurement.findMany({ where: { projectId: id, status: { in: ["CONFIRMED", "USER_ENTERED", "EXTRACTED_PENDING"] } }, select: { key: true, value: true, unit: true, facet: true, status: true }, orderBy: { createdAt: "asc" } }),
    prisma.document.findMany({ where: { projectId: id, type: "EAGLEVIEW" }, select: { id: true, fileName: true, uploadedAt: true }, orderBy: { uploadedAt: "desc" } }),
  ]);
  const firstAppt = await prisma.scheduleEvent.findFirst({ where: { projectId: id, kind: "APPOINTMENT", status: { not: "CANCELLED" } }, orderBy: { startDate: "asc" }, select: { startDate: true, title: true } });
  const confirmed = measures.filter((m) => m.status !== "EXTRACTED_PENDING");
  const pendingMeasures = measures.length - confirmed.length;
  const estimateCount = estimates.length;
  const totals = canEdit ? await Promise.all(estimates.map((e) => totalsFor(e.id))) : [];
  const intakeByKey = new Map(project.intake.map((f) => [f.key, f]));
  const scopes = parseScopes(project.scopes);
  const onJob = new Set(project.contacts.map((c) => c.contactId));
  const primary = project.contacts.find((c) => c.isPrimary) ?? project.contacts[0] ?? null;
  const others = project.contacts.filter((c) => c !== primary);

  // when each milestone was first reached (Lead = created; later ones from stage moves)
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", year: "numeric" });
  const reachedAt: Record<string, Date> = { LEAD: project.createdAt };
  for (const a of stageMoves) {
    const to = ((a.data as { to?: string } | null)?.to ?? a.text.match(/→\s*([A-Z_]+)/)?.[1]) as Stage | undefined;
    const m = to && milestoneOf(to);
    if (m && !reachedAt[m.key]) reachedAt[m.key] = a.createdAt;
  }
  const current = milestoneOf(project.status);
  if (current && !reachedAt[current.key]) reachedAt[current.key] = project.statusChangedAt;
  const curIdx = current ? MILESTONES.indexOf(current) : -1;
  const reached = Object.fromEntries(
    Object.entries(reachedAt)
      .filter(([k]) => MILESTONES.findIndex((m) => m.key === k) <= curIdx)
      .map(([k, d]) => [k, day(d)]),
  );
  const since = current ? reachedAt[current.key] : project.statusChangedAt;
  const hrs = (Date.now() - since.getTime()) / 3_600_000;
  const inFor = hrs < 1 ? "<1 hour" : hrs < 48 ? `${Math.round(hrs)} hours` : `${Math.round(hrs / 24)} days`;
  const lastTouched = project.activity[0]?.createdAt ?? project.updatedAt;
  const touched = (() => {
    const m = (Date.now() - lastTouched.getTime()) / 60000;
    return m < 60 ? `${Math.max(1, Math.round(m))} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
  })();
  const base = `/projects/${id}`;
  const strip: [string, string, number | string][] = [
    ["Communications", `${base}/email`, counts._count.emails],
    ["Messages", `${base}/chat`, counts._count.messages],
    ["Estimates", `${base}/estimates`, estimateCount],
    ["Proposals", `${base}/proposals`, proposals.length],
    ["Invoices", `${base}/billing`, invoices],
    ["Orders", `${base}/orders`, orders.length],
    ["Photos", `${base}/photos`, project.photoFolderId ? "✓" : 0],
    ["Documents", `${base}/documents`, counts._count.documents],
  ];
  const Empty = ({ n, text, children }: { n: number; text: string; children?: React.ReactNode }) => (
    <div className="flex items-start gap-4">
      <span className="w-4 text-lg text-btr-blue tabular-nums">{n}</span>
      <div className="flex flex-col items-start gap-2 text-sm">
        <span className="text-muted-foreground">{text}</span>
        {children}
      </div>
    </div>
  );
  const blueBtn = "rounded-sm bg-btr-blue px-4 py-1.5 text-sm text-white shadow-sm hover:bg-btr-blue-dark";
  const Field = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1 text-[13px]">
      <span className="font-semibold">{k}:</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <MilestonesCard id={id} stage={project.status} reached={reached} inFor={inFor} canEdit={canEdit} />

      <Panel title="Job activity" right={<span className="text-muted-foreground">Last touched: <span className="font-semibold text-foreground">{touched}</span></span>} bodyClass="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 lg:grid-cols-8 lg:divide-y-0">
        {strip.map(([label, href, n]) => (
          <Link key={label} href={href} className="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px] hover:bg-muted/50">
            <span className={axLink}>{label}</span>
            <span className={`text-xl tabular-nums ${n ? "text-btr-blue" : "text-muted-foreground"}`}>{n}</span>
          </Link>
        ))}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Primary contact"
          right={
            <span className="text-muted-foreground">
              More contacts ({others.length})
            </span>
          }
        >
          {primary ? (
            <>
              <Field k="Name">
                <span className={axLink}>
                  {primary.contact.firstName} {primary.contact.lastName}
                </span>{" "}
                <span className="text-xs text-muted-foreground">({primary.role.replace(/_/g, " ").toLowerCase()})</span>
              </Field>
              <Field k="Company">{primary.contact.company?.name ?? project.clientCompany?.name ?? ""}</Field>
              <Field k="Phone">{primary.contact.phone ? <a className={axLink} href={`tel:${primary.contact.phone}`}>{primary.contact.phone}</a> : ""}</Field>
              <Field k="Email">{primary.contact.email ? <a className={axLink} href={`mailto:${primary.contact.email}`}>{primary.contact.email}</a> : ""}</Field>
              <Field k="Mailing">{primary.contact.address ?? "Same as location"}</Field>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No contacts on this job yet.</p>
          )}
          {others.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-[13px]">
              {others.map((pc) => (
                <li key={pc.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {pc.contact.firstName} {pc.contact.lastName}
                  </span>
                  <Badge variant="outline">{pc.role.replace(/_/g, " ").toLowerCase()}</Badge>
                  <span className="text-muted-foreground">{[pc.contact.company?.name, pc.contact.phone, pc.contact.email].filter(Boolean).join(" · ")}</span>
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
          )}
          {canEdit && (
            <div className="mt-2 border-t pt-2">
              <Collapsible title="Add a contact">
                <div className="flex flex-col gap-2 pt-2">
                  <AddContact
                    projectId={project.id}
                    contacts={allContacts
                      .filter((c) => !onJob.has(c.id))
                      .map((c) => ({ id: c.id, label: `${c.lastName}, ${c.firstName}${c.company ? ` — ${c.company.name}` : ""}` }))}
                  />
                  <Link href={`/customers/new?kind=contact&returnTo=/projects/${project.id}`} className={`text-sm ${axLink}`}>
                    New contact
                  </Link>
                </div>
              </Collapsible>
            </div>
          )}
        </Panel>
        <Panel title="Location info">
          <Field k="Address">
            {project.address ? (
              <a className={axLink} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`}>
                {project.address}
              </a>
            ) : (
              ""
            )}
          </Field>
          <Field k="Category">{project.market === "RESIDENTIAL" ? "Residential" : "Commercial"}{project.buildingUse ? ` · ${project.buildingUse}` : ""}</Field>
          <Field k="Work type">{project.constructionType === "NEW" ? "New construction" : project.constructionType === "REROOF" ? "Reroof / replacement" : (project.constructionType ?? "").toString().toLowerCase()}{project.isInsuranceClaim ? " · insurance" : ""}</Field>
          <Field k="Trade">{scopes.map((s) => SCOPE_LABEL[s]).join(", ")}</Field>
          <Field k="Lead source">{project.leadSource ?? ""}</Field>
          <Field k="First appt">{firstAppt ? `${firstAppt.startDate.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })} · ${firstAppt.title.replace(/^Initial appointment ?/, "")}` : ""}</Field>
          <Field k="Sales / est.">
            {project.salesperson?.name ?? "—"} / {project.estimator?.name ?? "—"}
          </Field>
          {project.bidDueDate && <Field k="Bid due">{formatDate(project.bidDueDate)}</Field>}
          {canEdit && project.contractAmount != null && (
            <Field k="Contract">
              {formatUsd(project.contractAmount)}
              {project.contractSignedAt ? `, signed ${formatDate(project.contractSignedAt)}` : ", not signed yet"}
            </Field>
          )}
          <div className="text-right">
            <a href="#details" className={`text-xs ${axLink}`}>
              Edit job details
            </a>
          </div>
        </Panel>
      </div>

      <Panel id="measurements" title="Measurements" right={<Link className={axLink} href={`${base}/documents`}>{canEdit ? "Add / confirm" : "Documents"}</Link>}>
        {measureDocs.length === 0 && confirmed.length === 0 ? (
          <Empty n={0} text={project.eagleViewOrderedAt ? `EagleView ordered ${formatDate(project.eagleViewOrderedAt)} — upload the report when it arrives.` : "No measurements yet. Upload the EagleView report (or plans) on Documents, or enter measurements by hand."} />
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {measureDocs.map((d) => (
              <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" className="flex items-center justify-between gap-2 rounded-md border border-btr-line px-3 py-2 hover:bg-muted/50">
                <span className={`font-medium ${axLink}`}>{d.fileName}</span>
                <span className="text-xs text-muted-foreground">{formatDate(d.uploadedAt)}</span>
              </a>
            ))}
            {confirmed.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                {confirmed.slice(0, 12).map((m, i) => (
                  <div key={i} className="flex justify-between gap-2 border-b border-dashed border-btr-line py-0.5">
                    <dt className="text-muted-foreground">
                      {MEASUREMENT_BY_KEY.get(m.key)?.label ?? m.key}
                      {m.facet ? ` (${m.facet})` : ""}
                    </dt>
                    <dd className="tabular-nums">
                      {m.value ?? "—"} {m.unit ?? ""}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {pendingMeasures > 0 && (
              <Link href={`${base}/documents`} className="text-btr-link underline">
                {pendingMeasures} read from documents, waiting to be confirmed
              </Link>
            )}
          </div>
        )}
      </Panel>

      <CatchUp
        projectId={project.id}
        aiReady={aiConfigured()}
        latest={
          latestSummary && {
            content: latestSummary.content,
            createdAt: fmt(latestSummary.createdAt),
            coversFrom: latestSummary.coversFrom ? fmt(latestSummary.coversFrom) : null,
            by: latestSummary.createdBy?.name ?? null,
          }
        }
      />

      <Panel id="readiness" title={readiness === "BID_READY" ? "Bid ready" : "Why not bid ready?"} right={<ReadinessBadge readiness={readiness} />}>
        {blockers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is missing or assumed.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {blockers.map((b) => (
              <li key={b.message} className="flex items-start gap-2">
                <Badge variant={b.severity === "blocks_number" ? "red" : "amber"}>{b.severity === "blocks_number" ? "Blocks the number" : "Assumption"}</Badge>
                <a href={b.href} className="underline-offset-2 hover:underline">
                  {b.message}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="intake" title="Missing-information checklist" bodyClass="p-0">
        <p className="px-4 pt-3 pb-2 text-sm text-muted-foreground">
          Values come only from documents, client answers, or approved assumptions. An assumption needs a basis and is NOT FOR FINAL BID.
        </p>
        <div className="overflow-x-auto">
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
                return <IntakeRow key={def.key} projectId={project.id} canEdit={canEdit} f={{ ...f, label: def.label, source: def.source }} />;
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {canEdit && (
        <Panel id="portal" title="Customer portal">
          <div className="text-sm">
            <PortalCard projectId={id} url={project.portalToken ? portalUrl(project.portalToken) : null} contactEmail={primary?.contact.email ?? null} />
          </div>
        </Panel>
      )}

      <Panel id="estimates" title="Estimates" right={<Link className={axLink} href={`${base}/estimates`}>Open estimates</Link>}>
        {estimateCount === 0 ? (
          <Empty n={0} text="No estimates have been created for this job. Start one from a product-system template (GAF HDZ, Hardie Cedarmill, Mulehide EPDM…) so the products are filled in for you.">
            {canEdit && (
              <Link href={`${base}/estimates`} className={blueBtn}>
                New estimate
              </Link>
            )}
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {estimates.map((e, i) => (
              <li key={e.id}>
                <Link href={`${base}/estimates/${e.id}`} className="flex flex-wrap items-center gap-3 border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="text-btr-blue">•</span>
                  <span className={`flex-1 font-medium ${axLink}`}>
                    {e.name} <span className="font-normal text-muted-foreground">· {e.scopeType.replace(/_/g, " ").toLowerCase()}</span>
                    {e.locked && <span className="font-normal text-muted-foreground"> · locked</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
                  {canEdit && totals[i] && (
                    <span className="w-32 text-right tabular-nums">
                      {formatUsd(totals[i].grandTotal)}
                      {totals[i].incomplete && <span className="block text-[10px] font-semibold text-btr-ink">INCOMPLETE cost</span>}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {proposals.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Proposals</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {proposals.map((p) => (
                <li key={p.id}>
                  <Link href={`${base}/proposals`} className="flex flex-wrap items-center gap-3 px-3 py-1 hover:bg-muted/50">
                    <span className={`flex-1 ${axLink}`}>
                      {p.number} · {p.title}
                    </span>
                    <Badge variant={p.status === "SIGNED" ? "green" : p.status === "DECLINED" || p.status === "VOID" ? "red" : "outline"}>{p.status.toLowerCase()}</Badge>
                    {canEdit && <span className="w-32 text-right tabular-nums">{formatUsd(p.acceptedTotal ?? p.basePrice)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Plan review" right={<Link className={axLink} href={latestReview ? `${base}/plans/${latestReview.id}` : `${base}/plans`}>{latestReview ? "Open the brief" : "Review plans"}</Link>}>
        {latestReview ? (
          <p className="text-sm text-muted-foreground">
            Latest brief: {latestReview.document.fileName}. {openRfis} open RFI{openRfis === 1 ? "" : "s"}.
          </p>
        ) : (
          <Empty n={0} text="New construction? Upload the plans and specs, and get a brief with scope, products, requirements and RFIs." />
        )}
      </Panel>

      <Panel title="Orders" right={<Link className={axLink} href={`${base}/orders`}>All orders</Link>}>
        {orders.length === 0 ? (
          <Empty n={0} text="No orders have been created for this job.">
            {canEdit && (
              <Link href={`${base}/orders`} className={blueBtn}>
                New order
              </Link>
            )}
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`${base}/orders`} className="flex flex-wrap items-center gap-3 border px-3 py-2 hover:bg-muted/50">
                  <span className={`flex-1 ${axLink}`}>
                    {o.number} · {o.supplier}
                  </span>
                  <Badge variant={o.status === "DELIVERED" ? "green" : o.status === "CANCELLED" ? "red" : "outline"}>{o.status.toLowerCase()}</Badge>
                  <span className="text-xs text-muted-foreground">{o.requestedDate ? `for ${formatDate(o.requestedDate)}` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Tasks">
        <JobTasks projectId={id} tasks={jobTasks} users={users} canEdit={canEdit} meId={user.id} />
      </Panel>

      <Panel id="history" title="History" bodyClass="max-h-96 overflow-y-auto p-0">
        <ol className="divide-y text-[13px]">
          {project.activity.map((a) => (
            <li key={a.id} className="flex gap-3 px-4 py-2">
              <span className="w-28 shrink-0 text-muted-foreground tabular-nums">
                {a.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <span>{prettyStages(a.text)}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel id="details" title="Job details">
        {canEdit ? (
          <ProjectForm
            action={updateDetailsAction}
            companies={companies}
            users={users}
            properties={properties}
            propertyId={project.propertyId}
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
            Salesperson {project.salesperson?.name ?? "—"} · Estimator {project.estimator?.name ?? "—"} · Lead source {project.leadSource ?? "—"}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Stage now: {STAGE_LABEL[project.status]}</p>
      </Panel>
      {user.role === "ADMIN" && <DeleteJob id={project.id} name={project.name} blocker={await deleteBlocker(project.id)} />}
    </div>
  );
}
