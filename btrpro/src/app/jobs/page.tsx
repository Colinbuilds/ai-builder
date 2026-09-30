import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAGES, STAGE_LABEL, showForm17Banner, type Stage } from "@/lib/projects/workflow";
import { SheetDateBanner } from "@/components/sheet-banner";
import { ReadinessBadge, StageBadge } from "@/components/projects/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatUsd } from "@/lib/utils";
import { getMarketView } from "@/lib/market";
import { unreadCounts } from "@/lib/comms/chat";
import { BulkDelete } from "@/components/projects/delete-job";
import { MILESTONES } from "@/lib/projects/milestones";
import { MilestoneDot } from "@/components/shell/milestone-dot";

type SP = Promise<{ stage?: string; q?: string; mine?: string; deleted?: string; m?: string; watch?: string; unassigned?: string; due?: string }>;
const OPEN: Stage[] = ["LEAD", "ESTIMATING", "SUBMITTED", "SOLD", "SCHEDULED", "IN_PRODUCTION", "COMPLETE", "INVOICED"];

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = await getMarketView();
  const stage = STAGES.includes(sp.stage as Stage) ? (sp.stage as Stage) : null;
  const milestone = MILESTONES.find((m) => m.key === sp.m) ?? null;
  const where: Prisma.ProjectWhereInput = {
    ...(view !== "ALL" ? { market: view } : {}),
    status: stage ? stage : milestone ? { in: milestone.stages } : sp.stage === "all" || sp.q ? undefined : { in: OPEN },
    ...(sp.watch ? { watchers: { some: { userId: user.id } } } : {}),
    ...(sp.unassigned ? { salespersonId: null } : {}),
    ...(sp.due === "week" ? { status: { in: ["LEAD", "ESTIMATING"] as Stage[] }, bidDueDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lt: new Date(Date.now() + 7 * 86_400_000) } } : {}),
    ...(sp.q ? { OR: [{ name: { contains: sp.q } }, { address: { contains: sp.q } }, { acculynxJobNumber: { contains: sp.q } }] } : {}),
    ...(sp.mine ? { OR: [{ salespersonId: user.id }, { estimatorId: user.id }] } : {}),
  };
  const [projects, counts] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        clientCompany: { select: { name: true } },
        estimator: { select: { name: true } },
        contacts: { where: { isPrimary: true }, include: { contact: true }, take: 1 },
      },
      orderBy: [{ bidDueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.project.groupBy({ by: ["status"], _count: true, where: view !== "ALL" ? { market: view } : {} }),
  ]);
  const unread = await unreadCounts(user.id, projects.map((p) => p.id));
  const count = (s: Stage) => counts.find((c) => c.status === s)?._count ?? 0;
  const today = new Date();
  const admin = user.role === "ADMIN";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-light">
          {sp.watch ? "Watch list" : milestone ? `${milestone.label} jobs` : view === "RESIDENTIAL" ? "Residential jobs" : view === "COMMERCIAL" ? "Commercial jobs" : "Jobs"}
        </h1>
        {user.role !== "VIEWER" && (
          <Button asChild>
            <Link href="/projects/new">New job</Link>
          </Button>
        )}
      </div>
      <SheetDateBanner />

      <div className="flex flex-wrap gap-2 text-sm">
        {MILESTONES.map((m) => {
          const n = m.stages.reduce((a, st) => a + count(st), 0);
          const on = milestone?.key === m.key || (stage != null && m.stages.includes(stage));
          return (
            <Link
              key={m.key}
              href={`/jobs?m=${m.key}`}
              className={`flex items-center gap-2 rounded-full border bg-background py-1 pr-3 pl-1 ${on ? "ring-2 ring-[#3b7bc8]" : "hover:bg-accent"}`}
            >
              <MilestoneDot stage={m.stages[0]} size={22} />
              {m.label} <span className="tabular-nums text-muted-foreground">{n}</span>
            </Link>
          );
        })}
        <Link href="/jobs?stage=LOST" className={`flex items-center gap-2 rounded-full border bg-background py-1 pr-3 pl-1 ${stage === "LOST" ? "ring-2 ring-[#3b7bc8]" : "hover:bg-accent"}`}>
          <MilestoneDot stage="LOST" size={22} /> Lost <span className="tabular-nums text-muted-foreground">{count("LOST")}</span>
        </Link>
      </div>

      <form className="flex flex-wrap items-center gap-2" method="get">
        <Input name="q" defaultValue={sp.q} placeholder="Job name, address, job #" className="w-72" />
        <Select name="stage" defaultValue={sp.stage ?? ""}>
          <option value="">Open jobs</option>
          <option value="all">All jobs</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="mine" defaultChecked={!!sp.mine} /> Mine
        </label>
        <Button variant="outline">Filter</Button>
      </form>

      {sp.deleted && <p className="rounded-md border p-2 text-sm">Job deleted.</p>}
      {admin && <BulkDelete />}
      <Table>
        <THead>
          <TR>
            {admin && <TH className="w-8" />}
            <TH>Job</TH>
            <TH>{view === "RESIDENTIAL" ? "Homeowner" : view === "COMMERCIAL" ? "Client" : "Customer"}</TH>
            <TH>Stage</TH>
            <TH>{view === "RESIDENTIAL" ? "Claim" : "Bid due"}</TH>
            <TH>Readiness</TH>
            <TH>Estimator</TH>
          </TR>
        </THead>
        <TBody>
          {projects.map((p) => {
            const overdue = p.bidDueDate && p.bidDueDate < today && ["LEAD", "ESTIMATING"].includes(p.status);
            return (
              <TR key={p.id}>
                {admin && (
                  <TD>
                    <input type="checkbox" name="ids" value={p.id} form="bulk-delete" aria-label={`Select ${p.name}`} />
                  </TD>
                )}
                <TD>
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    {view === "ALL" && <Badge variant="outline">{p.market === "RESIDENTIAL" ? "Res" : "Com"}</Badge>}
                    {p.address}
                    {showForm17Banner(p) && <Badge variant="red">Form 17 pending</Badge>}
                    {unread[p.id] && (
                      <Link href={`/projects/${p.id}/chat`}>
                        <Badge variant={unread[p.id].mentioned ? "red" : "blue"}>
                          {unread[p.id].unread} new message{unread[p.id].unread === 1 ? "" : "s"}
                          {unread[p.id].mentioned ? " · @you" : ""}
                        </Badge>
                      </Link>
                    )}
                    {p.bidBondRequired && <Badge variant="outline">Bid bond</Badge>}
                  </div>
                </TD>
                <TD>
                  {p.clientCompany?.name ??
                    (p.contacts[0] ? `${p.contacts[0].contact.firstName} ${p.contacts[0].contact.lastName}` : "—")}
                  {p.market === "RESIDENTIAL" && p.contacts[0]?.contact.phone && (
                    <div className="text-xs text-muted-foreground">{p.contacts[0].contact.phone}</div>
                  )}
                </TD>
                <TD>
                  <span className="flex items-center gap-1.5">
                    <MilestoneDot stage={p.status} size={18} />
                    <StageBadge stage={p.status} />
                    {p.priority === "HIGH" && <Badge variant="red">High</Badge>}
                  </span>
                </TD>
                {p.market === "RESIDENTIAL" ? (
                  <TD className="text-xs">
                    {p.isInsuranceClaim ? (
                      <>
                        {p.insuranceCarrier ?? "Insurance"} {p.claimNumber && `#${p.claimNumber}`}
                        {p.deductible != null && user.role !== "VIEWER" && (
                          <div className="text-muted-foreground">Ded. {formatUsd(p.deductible)}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Retail</span>
                    )}
                  </TD>
                ) : (
                  <TD className={overdue ? "font-semibold text-destructive" : ""}>{formatDate(p.bidDueDate)}</TD>
                )}
                <TD>
                  <ReadinessBadge readiness={p.readiness} />
                </TD>
                <TD>{p.estimator?.name ?? "—"}</TD>
              </TR>
            );
          })}
          {projects.length === 0 && (
            <TR>
              <TD colSpan={admin ? 7 : 6} className="py-8 text-center text-muted-foreground">
                No jobs here yet.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
