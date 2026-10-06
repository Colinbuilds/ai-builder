// Progress billing schedule. A job is billed in draws (deposit → progress → final); each draw is a % of the
// contract (incl. approved change orders), a fixed amount, or whatever is left, and comes due on a job event.
// When a draw comes due the office gets a task; one click drafts the invoice (it still goes through the usual
// draft → check → send, and the contract cap in createInvoice).
import { prisma } from "@/lib/db";
import { round } from "@/lib/calc/core";
import { getSettings } from "@/lib/settings";
import { createInvoice, loadBilling, type BillActor } from "./service";

export class ScheduleError extends Error {}

export const TRIGGERS = {
  SIGNED: "Contract signed",
  MATERIALS_DELIVERED: "Materials delivered",
  STARTED: "Work starts",
  COMPLETED: "Job complete",
  DATE: "On a date",
  MANUAL: "When the PM says so",
} as const;
export type Trigger = keyof typeof TRIGGERS;
export const BASES = { PERCENT: "% of contract", AMOUNT: "Fixed amount", REMAINDER: "Whatever is left" } as const;
export type Basis = keyof typeof BASES;

type StepIn = { label: string; basis: Basis; pct?: number | null; amount?: number | null; trigger: Trigger; triggerDate?: Date | null };

/** Starting points; every draw can be changed. The deposit uses the company deposit % from Settings. */
export async function presets() {
  const s = await getSettings();
  const dep = s.depositPct;
  return {
    DEPOSIT_FINAL: {
      label: `Deposit${dep != null ? ` ${dep}%` : ""} + final`,
      steps: [
        { label: "Deposit", basis: "PERCENT", pct: dep, trigger: "SIGNED" },
        { label: "Final", basis: "REMAINDER", trigger: "COMPLETED" },
      ] as StepIn[],
    },
    THIRDS: {
      label: "Thirds: signing, material delivery, completion",
      steps: [
        { label: "Deposit (1/3)", basis: "PERCENT", pct: 33.33, trigger: "SIGNED" },
        { label: "Material delivery (1/3)", basis: "PERCENT", pct: 33.33, trigger: "MATERIALS_DELIVERED" },
        { label: "Final", basis: "REMAINDER", trigger: "COMPLETED" },
      ] as StepIn[],
    },
    START_HALF_FINAL: {
      label: "Deposit, start of work, final",
      steps: [
        { label: "Deposit", basis: "PERCENT", pct: dep, trigger: "SIGNED" },
        { label: "Start of work", basis: "PERCENT", pct: null, trigger: "STARTED" },
        { label: "Final", basis: "REMAINDER", trigger: "COMPLETED" },
      ] as StepIn[],
    },
  };
}

function check(x: StepIn) {
  if (!x.label.trim()) throw new ScheduleError("Name the draw (e.g. Material delivery).");
  if (!(x.basis in BASES)) throw new ScheduleError("Pick how the draw is figured.");
  if (!(x.trigger in TRIGGERS)) throw new ScheduleError("Pick when the draw comes due.");
  if (x.basis === "PERCENT" && (x.pct == null || !(x.pct > 0 && x.pct <= 100))) throw new ScheduleError(`${x.label}: enter the % of the contract (1–100).`);
  if (x.basis === "AMOUNT" && (x.amount == null || !(x.amount > 0))) throw new ScheduleError(`${x.label}: enter the amount.`);
  if (x.trigger === "DATE" && !x.triggerDate) throw new ScheduleError(`${x.label}: pick the date it's due.`);
}

/** Problems with the schedule as a whole (shown, not blocking). */
export function scheduleWarnings(steps: { basis: string; pct: number | null; status: string }[]) {
  const live = steps.filter((s) => s.status !== "SKIPPED");
  const w: string[] = [];
  const pct = round(live.filter((s) => s.basis === "PERCENT").reduce((a, s) => a + (s.pct ?? 0), 0), 2);
  const remainders = live.filter((s) => s.basis === "REMAINDER").length;
  if (remainders > 1) w.push("Only the last draw should be “whatever is left”.");
  if (!remainders && live.length && live.every((s) => s.basis === "PERCENT") && Math.abs(pct - 100) > 0.05) w.push(`The draws add up to ${pct}% of the contract, not 100%. Make the last one “whatever is left”.`);
  if (pct > 100) w.push(`The % draws add up to ${pct}% — more than the contract.`);
  return w;
}

export async function addSteps(projectId: string, steps: StepIn[], actor: { name: string }) {
  steps.forEach(check);
  const n = await prisma.billingStep.count({ where: { projectId } });
  await prisma.billingStep.createMany({
    data: steps.map((x, i) => ({ projectId, order: n + i, label: x.label.trim(), basis: x.basis, pct: x.basis === "PERCENT" ? x.pct! : null, amount: x.basis === "AMOUNT" ? x.amount! : null, trigger: x.trigger, triggerDate: x.trigger === "DATE" ? x.triggerDate! : null, createdBy: actor.name })),
  });
  await refreshSteps(projectId);
}

export async function applyPreset(projectId: string, key: string, actor: { name: string }) {
  const p = (await presets())[key as keyof Awaited<ReturnType<typeof presets>>];
  if (!p) throw new ScheduleError("Pick a schedule.");
  if (await prisma.billingStep.count({ where: { projectId, status: { not: "SKIPPED" } } })) throw new ScheduleError("This job already has a billing schedule. Change its draws below.");
  const missing = p.steps.find((s) => s.basis === "PERCENT" && s.pct == null);
  if (missing) throw new ScheduleError(`Set the ${missing.label.toLowerCase()} % ${missing.label === "Deposit" ? "(Settings → Company: deposit %) " : ""}or add the draws one by one.`);
  await addSteps(projectId, p.steps, actor);
}

/** Has the job reached this draw's event? */
async function reached(projectId: string, trigger: string, triggerDate: Date | null, now: Date) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true, contractSignedAt: true } });
  const after = (...st: string[]) => st.includes(p.status);
  switch (trigger) {
    case "SIGNED":
      return !!p.contractSignedAt || after("SOLD", "SCHEDULED", "IN_PRODUCTION", "COMPLETE", "INVOICED", "PAID", "CLOSED");
    case "MATERIALS_DELIVERED":
      return (await prisma.materialOrder.count({ where: { projectId, status: "DELIVERED" } })) > 0 || after("COMPLETE", "INVOICED", "PAID", "CLOSED");
    case "STARTED":
      return (
        after("IN_PRODUCTION", "COMPLETE", "INVOICED", "PAID", "CLOSED") ||
        (await prisma.scheduleEvent.count({ where: { projectId, kind: { in: ["INSTALL", "TEAR_OFF"] }, status: { not: "CANCELLED" }, startDate: { lte: now } } })) > 0 ||
        (await prisma.jobPhoto.count({ where: { projectId, stage: "BEFORE" } })) > 0
      );
    case "COMPLETED":
      return after("COMPLETE", "INVOICED", "PAID", "CLOSED") || (await prisma.jobPhoto.count({ where: { projectId, stage: "FINISHED" } })) > 0;
    case "DATE":
      return !!triggerDate && triggerDate <= now;
    default:
      return false; // MANUAL: the PM marks it ready
  }
}

/** Moves draws whose event has happened to READY (with a task for whoever bills), and voided invoices back. */
export async function refreshSteps(projectId: string, now = new Date()) {
  const steps = await prisma.billingStep.findMany({ where: { projectId, status: { in: ["PLANNED", "INVOICED"] } }, orderBy: { order: "asc" } });
  if (!steps.length) return;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, salespersonId: true } });
  for (const s of steps) {
    if (s.status === "INVOICED") {
      const inv = s.invoiceId ? await prisma.invoice.findUnique({ where: { id: s.invoiceId }, select: { status: true } }) : null;
      if (!inv || inv.status === "VOID") await prisma.billingStep.update({ where: { id: s.id }, data: { status: "READY", invoiceId: null } });
      continue;
    }
    if (await reached(projectId, s.trigger, s.triggerDate, now)) await markReady(s.id, project, now);
  }
}

async function markReady(id: string, project: { name: string; salespersonId: string | null }, now = new Date()) {
  const s = await prisma.billingStep.update({ where: { id }, data: { status: "READY", readyAt: now } });
  if (!(await prisma.task.findFirst({ where: { auto: `BILLSTEP:${id}` } })))
    await prisma.task.create({ data: { projectId: s.projectId, title: `Send progress invoice: ${s.label} — ${project.name}`, assigneeId: project.salespersonId, dueDate: now, auto: `BILLSTEP:${id}`, createdBy: "Billing schedule" } });
  await prisma.projectActivity.create({ data: { projectId: s.projectId, kind: "billing", text: `Draw ready to bill: ${s.label} (${TRIGGERS[s.trigger as Trigger] ?? s.trigger})` } });
}

export async function markStepReady(id: string) {
  const s = await prisma.billingStep.findUniqueOrThrow({ where: { id }, include: { project: { select: { name: true, salespersonId: true } } } });
  if (s.status !== "PLANNED") throw new ScheduleError("That draw isn't waiting.");
  await markReady(id, s.project);
}

/** What a draw bills right now: % × current contract, the fixed amount, or what's left (drafts count). */
export async function stepAmount(stepId: string) {
  const s = await prisma.billingStep.findUniqueOrThrow({ where: { id: stepId } });
  const { summary, invoices } = await loadBilling(s.projectId);
  if (summary.revenue == null) throw new ScheduleError("Contract amount is MISSING on this job. Set it before billing.");
  const onInvoices = round(invoices.filter((i) => i.status !== "VOID" && i.kind !== "RETAINAGE_RELEASE").reduce((a, i) => a + i.subtotal, 0), 2);
  if (s.basis === "PERCENT") return { amount: round((summary.revenue * s.pct!) / 100, 2), why: `${s.pct}% of $${summary.revenue.toFixed(2)} contract (incl. approved change orders)` };
  if (s.basis === "AMOUNT") return { amount: s.amount!, why: "fixed amount" };
  return { amount: round(summary.revenue - onInvoices, 2), why: `$${summary.revenue.toFixed(2)} contract − $${onInvoices.toFixed(2)} already invoiced` };
}

/** Drafts the invoice for a draw; it still gets checked and sent like any invoice. */
export async function invoiceStep(stepId: string, actor: BillActor) {
  const s = await prisma.billingStep.findUniqueOrThrow({ where: { id: stepId } });
  if (s.status === "INVOICED") throw new ScheduleError("That draw is already invoiced.");
  if (s.status === "SKIPPED") throw new ScheduleError("That draw was skipped.");
  const { amount, why } = await stepAmount(stepId);
  if (!(amount > 0.005)) throw new ScheduleError("Nothing is left to bill on this job.");
  const all = await prisma.billingStep.findMany({ where: { projectId: s.projectId, status: { not: "SKIPPED" } }, orderBy: { order: "asc" } });
  const n = all.findIndex((x) => x.id === s.id) + 1;
  const kind = s.basis === "REMAINDER" || n === all.length ? "FINAL" : n === 1 && s.trigger === "SIGNED" ? "DEPOSIT" : "PROGRESS";
  const inv = await createInvoice(s.projectId, { kind, lines: [{ description: `${s.label} — draw ${n} of ${all.length} (${why})`, amount }] }, actor);
  await prisma.billingStep.update({ where: { id: s.id }, data: { status: "INVOICED", invoiceId: inv.id, readyAt: s.readyAt ?? new Date() } });
  await prisma.task.updateMany({ where: { auto: `BILLSTEP:${s.id}`, doneAt: null }, data: { doneAt: new Date(), doneBy: actor.name } });
  return inv;
}

/** Percent-complete billing: bill the job up to X% complete, less everything already invoiced. */
export async function billToPercent(projectId: string, pct: number, actor: BillActor) {
  if (!(pct > 0 && pct <= 100)) throw new ScheduleError("Enter the % complete (1–100).");
  const { summary, invoices } = await loadBilling(projectId);
  if (summary.revenue == null) throw new ScheduleError("Contract amount is MISSING on this job. Set it before billing.");
  const onInvoices = round(invoices.filter((i) => i.status !== "VOID" && i.kind !== "RETAINAGE_RELEASE").reduce((a, i) => a + i.subtotal, 0), 2);
  const earned = round((summary.revenue * pct) / 100, 2);
  const amount = round(earned - onInvoices, 2);
  if (!(amount > 0.005)) throw new ScheduleError(`At ${pct}% complete the job has earned $${earned.toFixed(2)}, and $${onInvoices.toFixed(2)} is already invoiced. Nothing more to bill yet.`);
  return createInvoice(projectId, { kind: pct >= 100 ? "FINAL" : "PROGRESS", lines: [{ description: `Progress billing to ${pct}% complete: $${earned.toFixed(2)} of $${summary.revenue.toFixed(2)}, less $${onInvoices.toFixed(2)} billed to date`, amount }] }, actor);
}

/** Every draw ready to bill across the company (office desk). */
export async function readyDraws() {
  return prisma.billingStep.findMany({ where: { status: "READY" }, include: { project: { select: { id: true, name: true } } }, orderBy: { readyAt: "asc" } });
}

/** Background: check jobs with draws still waiting, every half hour. */
let watching = false;
export function startBillingWatcher(everyMs = 30 * 60_000) {
  if (watching) return;
  watching = true;
  const run = async () => {
    try {
      const jobs = await prisma.billingStep.findMany({ where: { status: { in: ["PLANNED", "INVOICED"] } }, select: { projectId: true }, distinct: ["projectId"] });
      for (const j of jobs) await refreshSteps(j.projectId);
    } catch (e) {
      console.error("[billing schedule] check failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(run, 180_000);
  setInterval(run, everyMs);
}
