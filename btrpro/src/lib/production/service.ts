import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { nextInSequence } from "@/lib/numbering";
import { BTR } from "@/lib/company";
import { changeStage, ProjectError } from "@/lib/projects/service";
import { addCost, canSeeCosts } from "@/lib/costing/service";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import {
  compliance,
  crewConflicts,
  day,
  timeAmount,
  workOrderPay,
} from "./rules";

export type ProdActor = {
  id: string;
  name: string;
  role: "ADMIN" | "ESTIMATOR" | "VIEWER";
};
export class ProductionError extends Error {
  constructor(
    message: string,
    public needsOverride = false,
  ) {
    super(message);
  }
}
const guard = (a: ProdActor) => {
  if (a.role === "VIEWER")
    throw new ProductionError(
      "Viewers can't change the schedule, crews, or work orders.",
    );
};
const act = (
  projectId: string,
  a: { id: string | null; name: string },
  text: string,
) =>
  prisma.projectActivity.create({
    data: { projectId, userId: a.id, kind: "production", text },
  });

// ---------- crews & subs ----------

export type CrewInput = {
  name: string;
  kind: "CREW" | "SUB";
  trade: string | null;
  leadName: string | null;
  phone: string | null;
  email: string | null;
  payType: "HOURLY" | "PIECE" | null;
  defaultRate: number | null;
  rateUnit: string | null;
  burdenPct: number | null;
  coiExpires: Date | null;
  workersCompExpires: Date | null;
  licenseNumber: string | null;
  licenseExpires: Date | null;
  notes: string | null;
  active: boolean;
};

export async function saveCrew(
  id: string | null,
  input: CrewInput,
  actor: ProdActor,
) {
  guard(actor);
  if (!input.name.trim()) throw new ProductionError("Name the crew or sub.");
  if (
    input.defaultRate != null &&
    (!Number.isFinite(input.defaultRate) || input.defaultRate < 0)
  )
    throw new ProductionError("Rate must be a number.");
  if (input.payType === "PIECE" && input.defaultRate != null && !input.rateUnit)
    throw new ProductionError("Piece rate needs a unit (SQ, SF, LF…).");
  const data = {
    ...input,
    name: input.name.trim(),
    rateUnit: input.payType === "HOURLY" ? "H" : input.rateUnit,
  };
  const before = id ? await prisma.crew.findUnique({ where: { id } }) : null;
  const c = id
    ? await prisma.crew.update({ where: { id }, data })
    : await prisma.crew.create({ data });
  if (
    before &&
    (before.defaultRate !== c.defaultRate || before.burdenPct !== c.burdenPct)
  )
    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        entity: "Crew",
        entityId: c.id,
        action: "rate",
        before: { rate: before.defaultRate, burden: before.burdenPct },
        after: { rate: c.defaultRate, burden: c.burdenPct },
      },
    });
  return c;
}

export async function crewsWithCompliance(today = new Date()) {
  const crews = await prisma.crew.findMany({
    orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }],
  });
  return crews.map((c) => ({ ...c, compliance: compliance(c, today) }));
}

// ---------- schedule ----------

export type EventInput = {
  projectId: string | null;
  kind: "INSTALL" | "TEAR_OFF" | "INSPECTION" | "DUMPSTER" | "REPAIR" | "OTHER";
  title: string;
  startDate: Date;
  endDate: Date;
  crewId: string | null;
  status?: string;
  weatherNote?: string | null;
  notes?: string | null;
  override?: string | null;
};

/** Warnings that need a stated reason to schedule anyway: double-booked crew, sub without current insurance. */
async function scheduleWarnings(e: EventInput & { id?: string }) {
  const warnings: string[] = [];
  if (!e.crewId) return warnings;
  const crew = await prisma.crew.findUniqueOrThrow({ where: { id: e.crewId } });
  if (!crew.active) warnings.push(`${crew.name} is marked inactive.`);
  const comp = compliance(crew, e.startDate);
  for (const i of comp.items)
    if (i.status === "EXPIRED" || i.status === "MISSING")
      warnings.push(
        `${crew.name}: ${i.label} ${i.status === "MISSING" ? "not on file" : `expired ${day(i.date!)}`}.`,
      );
  const others = await prisma.scheduleEvent.findMany({
    where: { crewId: e.crewId, status: { notIn: ["CANCELLED", "DONE"] } },
    include: { project: { select: { name: true } } },
  });
  for (const c of crewConflicts(
    { ...e, status: e.status ?? "TENTATIVE" },
    others,
  ))
    warnings.push(
      `${crew.name} is already on "${c.title}"${c.project ? ` (${c.project.name})` : ""} ${day(c.startDate)}${day(c.endDate) !== day(c.startDate) ? ` – ${day(c.endDate)}` : ""}.`,
    );
  return warnings;
}

export async function scheduleEvent(input: EventInput, actor: ProdActor) {
  guard(actor);
  if (!input.title.trim()) throw new ProductionError("Give the event a title.");
  if (
    Number.isNaN(input.startDate.getTime()) ||
    Number.isNaN(input.endDate.getTime())
  )
    throw new ProductionError("Pick the dates.");
  if (day(input.endDate) < day(input.startDate))
    throw new ProductionError("The end date is before the start date.");
  const warnings = await scheduleWarnings(input);
  if (warnings.length && !input.override?.trim())
    throw new ProductionError(warnings.join(" "), true);
  // Putting an install on the calendar schedules the job; the stage gates (signed contract, Form 17) apply.
  if (
    input.projectId &&
    (input.kind === "INSTALL" || input.kind === "TEAR_OFF")
  ) {
    const p = await prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
    });
    if (p.status === "SOLD") {
      try {
        await changeStage(input.projectId, "SCHEDULED", {}, actor);
      } catch (e) {
        if (e instanceof ProjectError)
          throw new ProductionError(
            `Can't schedule the install yet: ${e.problems.join(" ")}`,
          );
        throw e;
      }
    } else if (["LEAD", "ESTIMATING", "SUBMITTED", "LOST"].includes(p.status))
      throw new ProductionError(
        `The job is ${p.status.toLowerCase()}, not sold. Installs are scheduled on sold jobs.`,
      );
  }
  const e = await prisma.scheduleEvent.create({
    data: {
      projectId: input.projectId,
      kind: input.kind,
      title: input.title.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      crewId: input.crewId,
      status: input.status ?? "TENTATIVE",
      weatherNote: input.weatherNote?.trim() || null,
      notes: input.notes?.trim() || null,
      override: warnings.length
        ? `${input.override!.trim()} (warnings: ${warnings.join(" ")})`
        : null,
      createdBy: actor.name,
    },
  });
  if (input.projectId)
    await act(
      input.projectId,
      actor,
      `${actor.name} scheduled ${e.kind.toLowerCase().replace("_", " ")} "${e.title}" ${day(e.startDate)}${day(e.endDate) !== day(e.startDate) ? ` – ${day(e.endDate)}` : ""}${warnings.length ? ` despite: ${warnings.join(" ")} Reason: ${input.override}` : ""}`,
    );
  return e;
}

export async function updateEvent(
  id: string,
  patch: {
    startDate?: Date;
    endDate?: Date;
    crewId?: string | null;
    status?: string;
    weatherNote?: string | null;
    override?: string | null;
  },
  actor: ProdActor,
) {
  guard(actor);
  const e = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id } });
  const next = { ...e, ...patch };
  if (day(next.endDate) < day(next.startDate))
    throw new ProductionError("The end date is before the start date.");
  const moved = patch.startDate || patch.endDate || patch.crewId !== undefined;
  if (moved && next.status !== "CANCELLED") {
    const warnings = await scheduleWarnings({
      ...next,
      id,
      kind: next.kind,
      override: null,
    });
    if (warnings.length && !patch.override?.trim())
      throw new ProductionError(warnings.join(" "), true);
  }
  const { override, ...rest } = patch;
  await prisma.scheduleEvent.update({
    where: { id },
    data: { ...rest, ...(override ? { override } : {}) },
  });
  if (e.projectId) {
    const what =
      patch.status && patch.status !== e.status
        ? `marked "${e.title}" ${patch.status.toLowerCase()}`
        : `moved "${e.title}" to ${day(next.startDate)}${day(next.endDate) !== day(next.startDate) ? ` – ${day(next.endDate)}` : ""}`;
    await act(
      e.projectId,
      actor,
      `${actor.name} ${what}${patch.weatherNote ? ` (${patch.weatherNote})` : ""}`,
    );
  }
}

/** Calendar items between two dates: scheduled events plus material deliveries. */
export async function calendar(from: Date, to: Date, crewId?: string | null) {
  const [events, orders] = await Promise.all([
    prisma.scheduleEvent.findMany({
      where: {
        startDate: { lte: to },
        endDate: { gte: from },
        ...(crewId ? { crewId } : {}),
      },
      include: {
        project: {
          select: { id: true, name: true, address: true, market: true },
        },
        crew: { select: { id: true, name: true, kind: true } },
      },
      orderBy: { startDate: "asc" },
    }),
    crewId
      ? Promise.resolve([])
      : prisma.materialOrder.findMany({
          where: {
            status: { in: ["SENT", "CONFIRMED", "PARTIAL", "DELIVERED"] },
            OR: [
              { confirmedDate: { gte: from, lte: to } },
              { confirmedDate: null, requestedDate: { gte: from, lte: to } },
            ],
          },
          include: {
            project: {
              select: { id: true, name: true, address: true, market: true },
            },
          },
        }),
  ]);
  const live = events.filter((e) => e.status !== "CANCELLED");
  // a double-booking someone approved with a reason (on either event) is "accepted", not an open problem
  const conflictOf = (
    e: (typeof events)[number],
  ): "OPEN" | "ACCEPTED" | null => {
    if (e.status === "CANCELLED") return null;
    const cs = crewConflicts(e, live);
    if (!cs.length) return null;
    return cs.every((c) => c.override || e.override) ? "ACCEPTED" : "OPEN";
  };
  return {
    events: events.map((e) => ({ ...e, conflict: conflictOf(e) })),
    deliveries: orders.map((o) => ({
      ...o,
      when: o.confirmedDate ?? o.requestedDate!,
    })),
  };
}

// ---------- work orders ----------

async function nextWo() {
  const year = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const used = await prisma.workOrder.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  return nextInSequence(
    prefix,
    used.map((x) => x.number),
  );
}

export async function createWorkOrder(
  projectId: string,
  crewId: string,
  actor: ProdActor,
) {
  guard(actor);
  const [p, crew] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        estimates: {
          orderBy: { createdAt: "desc" },
          include: { scopeItems: { orderBy: { sortOrder: "asc" } } },
        },
      },
    }),
    prisma.crew.findUniqueOrThrow({ where: { id: crewId } }),
  ]);
  const baselineId = (p.costBaseline as { estimateId?: string } | null)
    ?.estimateId;
  const est = p.estimates.find((e) => e.id === baselineId) ?? p.estimates[0];
  const scope =
    est?.scopeItems.filter((s) => s.type === "WE_WILL").map((s) => s.text) ??
    [];
  const exclusions =
    est?.scopeItems
      .filter((s) => s.type === "WE_WILL_NOT")
      .map((s) => s.text) ?? [];
  const w = await prisma.workOrder.create({
    data: {
      projectId,
      crewId,
      number: await nextWo(),
      scope,
      exclusions,
      payBasis:
        crew.payType === "HOURLY"
          ? "HOURLY"
          : crew.payType === "PIECE"
            ? "PIECE"
            : crew.kind === "SUB"
              ? "LUMP"
              : null,
      payUnit: crew.payType === "PIECE" ? crew.rateUnit : null,
      payRate: crew.payType === "PIECE" ? crew.defaultRate : null,
      token: randomBytes(18).toString("base64url"),
      createdBy: actor.name,
    },
  });
  await act(
    projectId,
    actor,
    `${actor.name} started work order ${w.number} for ${crew.name}${scope.length ? "" : " — the estimate has no scope lines yet"}`,
  );
  return w;
}

export async function updateWorkOrder(
  id: string,
  d: {
    instructions: string | null;
    startDate: Date | null;
    payBasis: string | null;
    payQty: number | null;
    payUnit: string | null;
    payRate: number | null;
    amount: number | null;
    scope: string[];
    exclusions: string[];
  },
  actor: ProdActor,
) {
  guard(actor);
  const w = await prisma.workOrder.findUniqueOrThrow({ where: { id } });
  if (w.status !== "DRAFT")
    throw new ProductionError(
      `${w.number} was already sent. Cancel it and send a new one to change the scope or pay.`,
    );
  const pay = workOrderPay(d);
  await prisma.workOrder.update({
    where: { id },
    data: {
      ...d,
      scope: d.scope,
      exclusions: d.exclusions,
      amount: d.payBasis === "LUMP" ? d.amount : pay.amount,
      payFormula: pay.formula,
    },
  });
}

export const workOrderUrl = (token: string) =>
  `${process.env.APP_URL ?? ""}/w/${token}`;

export async function sendWorkOrder(id: string, actor: ProdActor) {
  guard(actor);
  const w = await prisma.workOrder.findUniqueOrThrow({
    where: { id },
    include: { crew: true, project: true },
  });
  if (w.status !== "DRAFT")
    throw new ProductionError(`${w.number} was already sent.`);
  if (w.project.costClosedAt && actor.role !== "ADMIN")
    throw new ProductionError("Job costing is closed on this job. An Admin has to reopen it before new work is committed.");
  const scope = (w.scope as string[] | null) ?? [];
  const problems: string[] = [];
  if (!scope.length) problems.push("Add the scope (what the crew will do).");
  if (!w.startDate) problems.push("Set the start date.");
  if (w.payBasis !== "HOURLY" && w.amount == null)
    problems.push("Set the pay (qty × rate, or the agreed amount).");
  const comp = compliance(w.crew, w.startDate ?? new Date());
  if (comp.status === "EXPIRED" || comp.status === "MISSING")
    problems.push(
      `${w.crew.name}'s insurance isn't current: ${comp.items
        .filter((i) => i.status === "EXPIRED" || i.status === "MISSING")
        .map((i) => i.label)
        .join(", ")}. Get a current certificate before sending work.`,
    );
  if (problems.length) throw new ProductionError(problems.join(" "));
  let commitmentId: string | null = null;
  if (w.amount != null) {
    commitmentId = (
      await prisma.costCommitment.create({
        data: {
          projectId: w.projectId,
          category: w.crew.kind === "SUB" ? "SUBCONTRACTOR" : "LABOR",
          vendor: w.crew.name,
          description: `Work order ${w.number}`,
          amount: w.amount,
          reference: w.number,
          enteredBy: actor.name,
        },
      })
    ).id;
  }
  await prisma.workOrder.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date(), commitmentId },
  });
  let emailed = false;
  if (w.crew.email && emailConfigured()) {
    await sendEmail({
      to: w.crew.email,
      subject: `Work order ${w.number} — ${w.project.name} — start ${w.startDate!.toLocaleDateString("en-US", { timeZone: "UTC" })}`,
      text: `${w.crew.leadName ?? w.crew.name},\n\nYour work order for ${w.project.name} (${w.project.address ?? "address on the order"}) is here:\n${workOrderUrl(w.token)}\n\n${BTR.name} · ${BTR.phone}`,
    }).then(
      () => (emailed = true),
      (e) => console.error("work order email failed", e),
    );
  }
  await act(
    w.projectId,
    actor,
    `${actor.name} sent work order ${w.number} to ${w.crew.name}${w.amount != null ? ` ($${w.amount.toFixed(2)})` : ""}${emailed ? " by email" : ""}`,
  );
  return { url: workOrderUrl(w.token), emailed };
}

export async function getWorkOrderByToken(token: string) {
  const w = await prisma.workOrder.findUnique({
    where: { token },
    include: {
      crew: true,
      project: {
        include: {
          contacts: { where: { isPrimary: true }, include: { contact: true } },
          materialOrders: {
            where: { status: { not: "CANCELLED" } },
            include: { lines: { orderBy: { sortOrder: "asc" } } },
            orderBy: { createdAt: "asc" },
          },
          scheduleEvents: {
            where: { status: { not: "CANCELLED" } },
            orderBy: { startDate: "asc" },
          },
        },
      },
    },
  });
  if (!w || w.status === "DRAFT" || w.status === "CANCELLED") return null;
  return w;
}

export async function markWorkOrderViewed(token: string) {
  await prisma.workOrder.updateMany({
    where: { token, viewedAt: null },
    data: { viewedAt: new Date() },
  });
}

export async function setWorkOrderStatus(
  id: string,
  status: "IN_PROGRESS" | "COMPLETE" | "CANCELLED",
  by: { id: string | null; name: string; role?: string },
  reason?: string,
) {
  const w = await prisma.workOrder.findUniqueOrThrow({ where: { id } });
  if (w.status === "CANCELLED")
    throw new ProductionError(`${w.number} was cancelled. Make a new work order instead.`);
  if (w.status === "DRAFT" && status !== "CANCELLED")
    throw new ProductionError("Send the work order first.");
  if (w.status === "COMPLETE" && status !== "COMPLETE" && by.role !== "ADMIN")
    throw new ProductionError("It's already marked complete.");
  if (status === "CANCELLED" && w.status !== "DRAFT" && !reason?.trim())
    throw new ProductionError("Say why it's cancelled.");
  await prisma.workOrder.update({
    where: { id },
    data: {
      status,
      ...(status === "COMPLETE"
        ? { completedAt: new Date(), completedBy: by.name }
        : {}),
    },
  });
  if (status === "CANCELLED" && w.commitmentId)
    await prisma.costCommitment.update({
      where: { id: w.commitmentId },
      data: { status: "CANCELLED" },
    });
  await act(
    w.projectId,
    by,
    `${by.name} marked work order ${w.number} ${status.toLowerCase().replace("_", " ")}${reason ? `: ${reason}` : ""}`,
  );
}

// ---------- timesheets ----------

export async function addTimeEntry(
  projectId: string,
  input: {
    crewId: string;
    date: Date;
    basis: "HOURLY" | "PIECE";
    hours?: number | null;
    qty?: number | null;
    unit?: string | null;
    rate: number | null;
    burdenPct?: number | null;
    note?: string | null;
  },
  actor: { id: string | null; name: string; role: string },
) {
  if (actor.role === "VIEWER")
    throw new ProductionError("Viewers can't log time.");
  const crew = await prisma.crew.findUniqueOrThrow({
    where: { id: input.crewId },
  });
  if (Number.isNaN(input.date.getTime()))
    throw new ProductionError("Pick the date worked.");
  const rate = input.rate ?? crew.defaultRate;
  if (rate == null)
    throw new ProductionError(
      `No rate entered and ${crew.name} has no default rate on file.`,
    );
  const burden =
    input.basis === "HOURLY" ? (input.burdenPct ?? crew.burdenPct) : null;
  let calc;
  try {
    calc = timeAmount({
      basis: input.basis,
      hours: input.hours,
      qty: input.qty,
      unit: input.unit?.toUpperCase() ?? null,
      rate,
      burdenPct: burden,
    });
  } catch (e) {
    throw new ProductionError(e instanceof Error ? e.message : String(e));
  }
  return prisma.timeEntry.create({
    data: {
      projectId,
      crewId: crew.id,
      date: input.date,
      basis: input.basis,
      hours: input.basis === "HOURLY" ? input.hours : null,
      qty: input.basis === "PIECE" ? input.qty : null,
      unit: input.basis === "PIECE" ? input.unit!.toUpperCase() : "H",
      rate,
      burdenPct: burden,
      amount: calc.amount,
      formula: calc.formula,
      note: input.note?.trim() || null,
      enteredBy: actor.name,
    },
  });
}

/** Approving posts the entry to job costing (labor or subcontractor), billed against the crew's work order when there is one. */
export async function approveTime(id: string, actor: ProdActor) {
  guard(actor);
  const t = await prisma.timeEntry.findUniqueOrThrow({
    where: { id },
    include: {
      crew: true,
      project: { select: { estimatorId: true, salespersonId: true } },
    },
  });
  if (!canSeeCosts(actor, t.project))
    throw new ProductionError(
      "Only an Admin or this job's estimator/salesperson can approve time.",
    );
  if (t.approvedAt) throw new ProductionError("Already approved.");
  const wo = await prisma.workOrder.findFirst({
    where: {
      projectId: t.projectId,
      crewId: t.crewId,
      commitmentId: { not: null },
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
  });
  const cost = await addCost(
    t.projectId,
    {
      category: t.crew.kind === "SUB" ? "SUBCONTRACTOR" : "LABOR",
      date: t.date,
      vendor: t.crew.name,
      reference: wo?.number ?? null,
      description: `${t.basis === "HOURLY" ? "Crew hours" : "Piece work"}: ${t.formula}${t.note ? ` — ${t.note}` : ""}`,
      amount: t.amount,
      kind: t.basis === "HOURLY" ? "CREW_HOURS" : "PAY",
      hours: t.hours,
      rate: t.rate,
      burdenPct: t.burdenPct,
      commitmentId: wo?.commitmentId ?? null,
    },
    { id: actor.id, name: actor.name, role: actor.role },
  );
  await prisma.timeEntry.update({
    where: { id },
    data: {
      approvedAt: new Date(),
      approvedBy: actor.name,
      jobCostId: cost.id,
    },
  });
  return cost;
}

export async function deleteTimeEntry(id: string, actor: ProdActor) {
  guard(actor);
  const t = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
  if (t.approvedAt)
    throw new ProductionError(
      "Approved time is in job costing. Remove the cost there (with a reason) instead.",
    );
  await prisma.timeEntry.delete({ where: { id } });
}
