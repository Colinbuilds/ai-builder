// Tasks and reminders (§13): assigned to-dos with due dates, some created automatically when a job
// changes stage, plus reminders computed from the data (bids due, expiring crew insurance, overdue invoices).
import { prisma } from "@/lib/db";
import { balanceDue } from "@/lib/billing/math";
import { exemptForm } from "@/lib/company-profile";

type Actor = { id: string | null; name: string; role?: string };
type StageProject = {
  id: string;
  salespersonId: string | null;
  estimatorId: string | null;
  market: string;
  isPublic: boolean;
  isTaxExempt: boolean;
  form17Status: string;
};
type Rule = {
  key: string;
  title: string;
  days: number;
  // "office" tasks stay unassigned and show on the Office desk
  who: "sales" | "estimator" | "office" | "none";
  when?: (p: StageProject) => boolean;
};

const DAY = 86_400_000;

// What has to happen next when a job enters each stage.
export const STAGE_TASKS: Record<string, Rule[]> = {
  // follow-up schedule after the proposal goes out; stops automatically when the job is signed or lost
  SUBMITTED: [
    { key: "fu-2", title: "Call: follow up on the proposal", days: 2, who: "sales" },
    { key: "fu-5", title: "Text: any questions on the proposal?", days: 5, who: "sales" },
    { key: "fu-10", title: "Call again: second follow-up on the proposal", days: 10, who: "sales" },
    { key: "fu-21", title: "Email: checking in on the proposal", days: 21, who: "sales" },
  ],
  SOLD: [
    {
      key: "form17",
      title: `Office: get ${exemptForm().short} executed with the owner (before ordering materials)`,
      days: 1,
      who: "office",
      when: (p) => p.isPublic && p.isTaxExempt && p.form17Status !== "EXECUTED",
    },
    {
      key: "deposit",
      title: "Send the deposit invoice",
      days: 1,
      who: "sales",
      when: (p) => p.market === "RESIDENTIAL",
    },
    {
      key: "order",
      title: "Order materials from ABC",
      days: 2,
      who: "estimator",
    },
    {
      key: "schedule",
      title: "Put the install on the schedule and assign a crew",
      days: 3,
      who: "none",
    },
  ],
  SCHEDULED: [
    {
      key: "delivery",
      title: "Confirm delivery date and drop location with ABC",
      days: 1,
      who: "estimator",
    },
    {
      key: "work-order",
      title: "Send the work order to the crew",
      days: 1,
      who: "none",
    },
  ],
  COMPLETE: [
    {
      key: "final-invoice",
      title: "Send the final invoice",
      days: 1,
      who: "sales",
    },
    {
      key: "warranty",
      title: "Register the manufacturer warranty",
      days: 3,
      who: "sales",
    },
    {
      key: "close-costs",
      title: "Enter the last bills and close job costing",
      days: 14,
      who: "estimator",
    },
  ],
  INVOICED: [
    { key: "collect", title: "Follow up on payment", days: 30, who: "sales" },
  ],
};

/** Creates the stage's tasks once per job (a rule already on the job, done or not, isn't repeated). */
export async function createStageTasks(
  p: StageProject,
  stage: string,
  actor: Actor,
  now = new Date(),
) {
  const rules = (STAGE_TASKS[stage] ?? []).filter((r) => !r.when || r.when(p));
  if (!rules.length) return [];
  const have = new Set(
    (
      await prisma.task.findMany({
        where: {
          projectId: p.id,
          auto: { in: rules.map((r) => `${stage}:${r.key}`) },
        },
        select: { auto: true },
      })
    ).map((t) => t.auto),
  );
  const made = [];
  for (const r of rules) {
    const auto = `${stage}:${r.key}`;
    if (have.has(auto)) continue;
    const assigneeId =
      r.who === "sales"
        ? (p.salespersonId ?? p.estimatorId)
        : r.who === "estimator"
          ? (p.estimatorId ?? p.salespersonId)
          : null;
    made.push(
      await prisma.task.create({
        data: {
          projectId: p.id,
          title: r.title,
          dueDate: new Date(now.getTime() + r.days * DAY),
          assigneeId,
          auto,
          createdBy: `${actor.name} (moved to ${stage.toLowerCase().replace("_", " ")})`,
        },
      }),
    );
  }
  return made;
}

export class TaskError extends Error {}

export async function addTask(
  input: {
    projectId: string | null;
    title: string;
    dueDate: Date | null;
    assigneeId: string | null;
    notes?: string | null;
  },
  actor: Actor,
) {
  if (actor.role === "VIEWER") throw new TaskError("Viewers can't add tasks.");
  if (!input.title.trim()) throw new TaskError("What needs doing?");
  const t = await prisma.task.create({
    data: {
      projectId: input.projectId,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      dueDate: input.dueDate,
      assigneeId: input.assigneeId,
      createdBy: actor.name,
    },
  });
  if (input.projectId)
    await prisma.projectActivity.create({
      data: {
        projectId: input.projectId,
        userId: actor.id,
        kind: "task",
        text: `${actor.name} added a task: ${t.title}`,
      },
    });
  return t;
}

export async function setTaskDone(id: string, done: boolean, actor: Actor) {
  if (actor.role === "VIEWER")
    throw new TaskError("Viewers can't change tasks.");
  const t = await prisma.task.update({
    where: { id },
    data: done
      ? { doneAt: new Date(), doneBy: actor.name }
      : { doneAt: null, doneBy: null },
  });
  // finishing the "call new lead" task means the customer was reached
  if (t.projectId && done && t.auto === "LEAD:call")
    await prisma.project.updateMany({ where: { id: t.projectId, firstContactAt: null }, data: { firstContactAt: new Date() } });
  if (t.projectId && done)
    await prisma.projectActivity.create({
      data: {
        projectId: t.projectId,
        userId: actor.id,
        kind: "task",
        text: `${actor.name} finished: ${t.title}`,
      },
    });
  return t;
}

export async function updateTask(
  id: string,
  input: { dueDate?: Date | null; assigneeId?: string | null },
  actor: Actor,
) {
  if (actor.role === "VIEWER")
    throw new TaskError("Viewers can't change tasks.");
  return prisma.task.update({ where: { id }, data: input });
}

export async function deleteTask(id: string, actor: Actor) {
  if (actor.role === "VIEWER")
    throw new TaskError("Viewers can't delete tasks.");
  await prisma.task.delete({ where: { id } });
}

export type Reminder = {
  kind: "bid" | "coi" | "invoice" | "proposal" | "unassigned";
  text: string;
  href: string;
  due: Date | null;
  urgent: boolean;
};

/** Things that need attention, computed from the data (nothing stored). */
export async function reminders(
  user: { id: string; role: string },
  now = new Date(),
): Promise<Reminder[]> {
  const out: Reminder[] = [];
  const admin = user.role === "ADMIN";
  const mine = admin
    ? {}
    : { OR: [{ salespersonId: user.id }, { estimatorId: user.id }] };
  const soon = new Date(now.getTime() + 7 * DAY);
  const bids = await prisma.project.findMany({
    where: {
      ...mine,
      status: { in: ["LEAD", "ESTIMATING"] },
      bidDueDate: { not: null, lte: soon },
    },
    select: { id: true, name: true, bidDueDate: true },
    orderBy: { bidDueDate: "asc" },
  });
  for (const b of bids)
    out.push({
      kind: "bid",
      text: `Bid due${b.bidDueDate! < now ? " (past due)" : ""}: ${b.name}`,
      href: `/projects/${b.id}`,
      due: b.bidDueDate,
      urgent: b.bidDueDate!.getTime() - now.getTime() < 2 * DAY,
    });
  const myJobs = admin
    ? null
    : (
        await prisma.project.findMany({ where: mine, select: { id: true } })
      ).map((p) => p.id);
  const stale = await prisma.proposal.findMany({
    where: {
      status: { in: ["SENT", "VIEWED"] },
      sentAt: { lte: new Date(now.getTime() - 7 * DAY) },
      ...(myJobs ? { projectId: { in: myJobs } } : {}),
    },
    select: { number: true, sentAt: true, projectId: true },
  });
  const names = new Map(
    (
      await prisma.project.findMany({
        where: { id: { in: stale.map((x) => x.projectId) } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );
  for (const pr of stale)
    out.push({
      kind: "proposal",
      text: `Proposal ${pr.number} sent ${Math.floor((now.getTime() - pr.sentAt!.getTime()) / DAY)} days ago, not signed: ${names.get(pr.projectId) ?? ""}`,
      href: `/projects/${pr.projectId}/proposals`,
      due: null,
      urgent: false,
    });
  if (admin) {
    const month = new Date(now.getTime() + 30 * DAY);
    const crews = await prisma.crew.findMany({
      where: {
        active: true,
        OR: [
          { coiExpires: { lte: month } },
          { workersCompExpires: { lte: month } },
          { licenseExpires: { lte: month } },
        ],
      },
    });
    for (const c of crews)
      for (const [label, d] of [
        ["Insurance (COI)", c.coiExpires],
        ["Workers' comp", c.workersCompExpires],
        ["License", c.licenseExpires],
      ] as const)
        if (d && d <= month)
          out.push({
            kind: "coi",
            text: `${label} for ${c.name} ${d < now ? "expired" : "expires"} ${d.toLocaleDateString("en-US", { timeZone: "UTC" })}`,
            href: `/crews/${c.id}`,
            due: d,
            urgent: d < now,
          });
    const late = await prisma.invoice.findMany({
      where: { status: { in: ["SENT", "PARTIAL"] }, dueDate: { lt: now } },
      include: { payments: true, project: { select: { name: true } } },
    });
    const owing = late.filter((i) => balanceDue(i) > 0.005);
    if (owing.length)
      out.push({
        kind: "invoice",
        text: `${owing.length} invoice${owing.length === 1 ? "" : "s"} past due ($${owing.reduce((a, i) => a + balanceDue(i), 0).toFixed(2)})`,
        href: "/reports/ar",
        due: null,
        urgent: owing.some(
          (i) => now.getTime() - i.dueDate.getTime() > 30 * DAY,
        ),
      });
    const unassigned = await prisma.task.count({
      where: { doneAt: null, assigneeId: null },
    });
    if (unassigned)
      out.push({
        kind: "unassigned",
        text: `${unassigned} open task${unassigned === 1 ? "" : "s"} with nobody assigned`,
        href: "/today?who=unassigned",
        due: null,
        urgent: false,
      });
  }
  return out.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity),
  );
}
