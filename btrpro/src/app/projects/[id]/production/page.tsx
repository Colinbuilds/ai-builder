import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeCosts } from "@/lib/costing/service";
import { crewsWithCompliance, workOrderUrl } from "@/lib/production/service";
import { EventControls, EventForm, NewWorkOrder, TimeActions, TimeForm, WorkOrderEditor, WorkOrderStatus } from "@/components/production/forms";
import { EVENT_KINDS } from "@/lib/production/rules";
import { crewWarning } from "@/components/production/compliance-badge";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const d = (x: Date) => x.toISOString().slice(0, 10);

export default async function Production({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [p, crews] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        scheduleEvents: { include: { crew: { select: { name: true } } }, orderBy: { startDate: "asc" } },
        workOrders: { include: { crew: { select: { name: true, kind: true } } }, orderBy: { createdAt: "desc" } },
        timeEntries: { include: { crew: { select: { name: true } } }, orderBy: { date: "desc" } },
      },
    }),
    crewsWithCompliance(),
  ]);
  const canEdit = user.role !== "VIEWER";
  const money = canSeeCosts(user, p);
  const crewOpts = crews.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, kind: c.kind, warn: crewWarning(c.compliance), payType: c.payType, defaultRate: c.defaultRate, rateUnit: c.rateUnit, burdenPct: c.burdenPct }));
  const unapproved = p.timeEntries.filter((t) => !t.approvedAt);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Schedule</h2>
        {p.scheduleEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled for this job.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Crew</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.scheduleEvents.map((e) => (
                <TR key={e.id} className={e.status === "CANCELLED" ? "opacity-50" : ""}>
                  <TD className="whitespace-nowrap">
                    {formatDate(e.startDate)}
                    {d(e.endDate) !== d(e.startDate) && ` – ${formatDate(e.endDate)}`}
                  </TD>
                  <TD>
                    {EVENT_KINDS[e.kind]}: {e.title}
                    {e.weatherNote && <span className="block text-xs text-amber-700">{e.weatherNote}</span>}
                    {e.override && <span className="block text-xs text-red-700">Override: {e.override}</span>}
                  </TD>
                  <TD>{e.crew?.name ?? "—"}</TD>
                  <TD>{e.status.toLowerCase()}</TD>
                  <TD>{canEdit && <EventControls id={e.id} projectId={id} status={e.status} start={d(e.startDate)} end={d(e.endDate)} crewId={e.crewId} crews={crewOpts} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {canEdit && <EventForm projectId={id} crews={crewOpts} defaultTitle={p.name} />}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Work orders</h2>
        {p.workOrders.map((w) => (
          <div key={w.id} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{w.number}</span>
              <Badge variant={w.status === "COMPLETE" ? "green" : w.status === "DRAFT" ? "outline" : w.status === "CANCELLED" ? "default" : "blue"}>{w.status.toLowerCase().replace("_", " ")}</Badge>
              <span className="text-sm">
                {w.crew.name}
                {w.crew.kind === "SUB" && " (sub)"}
                {w.startDate && ` · starts ${formatDate(w.startDate)}`}
                {money && w.amount != null && ` · ${usd(w.amount)}`}
                {money && w.payFormula && <span className="text-xs text-muted-foreground"> ({w.payFormula})</span>}
                {w.viewedAt && <span className="text-xs text-muted-foreground"> · crew opened it {formatDate(w.viewedAt)}</span>}
                {w.completedBy && <span className="text-xs text-muted-foreground"> · completed by {w.completedBy}</span>}
              </span>
              {canEdit && w.status !== "DRAFT" && <WorkOrderStatus projectId={id} id={w.id} status={w.status} />}
            </div>
            {w.status === "DRAFT" && canEdit ? (
              <WorkOrderEditor projectId={id} w={{ ...w, scope: (w.scope as string[] | null) ?? [], exclusions: (w.exclusions as string[] | null) ?? [] }} showPay={money} />
            ) : (
              w.status !== "CANCELLED" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="break-all text-muted-foreground">{workOrderUrl(w.token)}</span>
                  <CopyButton text={workOrderUrl(w.token)} />
                </div>
              )
            )}
          </div>
        ))}
        {canEdit && <NewWorkOrder projectId={id} crews={crewOpts} />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Time &amp; piece work</h2>
        {unapproved.length > 0 && <p className="text-sm text-amber-700">{unapproved.length} entr{unapproved.length === 1 ? "y" : "ies"} waiting for approval. Approved time posts to Job costing.</p>}
        {p.timeEntries.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Crew</TH>
                <TH>Work</TH>
                {money && <TH className="text-right">Amount</TH>}
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.timeEntries.map((t) => (
                <TR key={t.id}>
                  <TD>{formatDate(t.date)}</TD>
                  <TD>{t.crew.name}</TD>
                  <TD>
                    {t.basis === "HOURLY" ? `${t.hours} h` : `${t.qty} ${t.unit}`}
                    {t.note && <span className="block text-xs text-muted-foreground">{t.note}</span>}
                    <span className="block text-xs text-muted-foreground">
                      entered by {t.enteredBy}
                      {t.approvedBy && ` · approved by ${t.approvedBy}`}
                    </span>
                  </TD>
                  {money && (
                    <TD className="text-right">
                      <span className="tabular-nums">{usd(t.amount)}</span>
                      <span className="block text-xs text-muted-foreground">{t.formula}</span>
                    </TD>
                  )}
                  <TD>{canEdit && <TimeActions projectId={id} id={t.id} approved={!!t.approvedAt} canApprove={money} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {canEdit && <TimeForm projectId={id} crews={crewOpts} />}
      </section>
    </div>
  );
}
