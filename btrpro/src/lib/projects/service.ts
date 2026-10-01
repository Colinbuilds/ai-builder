// Project data operations. Every change writes to the job's activity timeline and recomputes readiness.
import { prisma } from "@/lib/db";
import { createStageTasks } from "@/lib/tasks/service";
import { normEmail, phoneKey } from "@/lib/customers";
import { sheetDateStatus } from "@/lib/sheets/date-status";
import { INTAKE_BY_KEY, INTAKE_FIELDS, parseScopes, reconcileIntake, type Scope } from "./intake";
import { computeReadiness, type ReadinessInput } from "./readiness";
import { checkStageChange, nextForm17Status, type Stage } from "./workflow";

type Actor = { id: string | null; name: string };
type ConstructionType = "NEW" | "REROOF";

export class ProjectError extends Error {
  constructor(public problems: string[], public overridable = false) {
    super(problems.join("\n"));
  }
}

const activity = (projectId: string, userId: string | null, kind: string, text: string, data?: object) =>
  prisma.projectActivity.create({ data: { projectId, userId, kind, text, data } });

// Project columns that are also intake fields: filling one fills the other.
const SYNCED: Record<string, "address" | "buildingUse" | "constructionType"> = {
  location: "address",
  building_use: "buildingUse",
  construction_type: "constructionType",
};
const CONSTRUCTION_LABEL: Record<ConstructionType, string> = { NEW: "New construction", REROOF: "Reroof" };

export type ProjectInput = {
  name: string;
  market?: "RESIDENTIAL" | "COMMERCIAL";
  address?: string | null;
  buildingUse?: string | null;
  constructionType?: ConstructionType | null;
  scopes: Scope[];
  workTypes?: string[];
  isPublic: boolean;
  isTaxExempt: boolean;
  bidDueDate?: Date | null;
  acculynxJobNumber?: string | null;
  leadSource?: string | null;
  clientCompanyId?: string | null;
  salespersonId?: string | null;
  estimatorId?: string | null;
  // residential
  isInsuranceClaim?: boolean;
  insuranceCarrier?: string | null;
  claimNumber?: string | null;
  dateOfLoss?: Date | null;
  adjusterName?: string | null;
  adjusterPhone?: string | null;
  adjusterEmail?: string | null;
  deductible?: number | null;
  // commercial
  bidBondRequired?: boolean;
  perfBondRequired?: boolean;
  prevailingWage?: boolean;
  retainagePct?: number | null;
};

export type HomeownerInput = { firstName: string; lastName: string; phone?: string | null; email?: string | null; role?: "HOMEOWNER" | "OWNER_REP" };

export async function createProject(input: ProjectInput, actor: Actor, homeowner?: HomeownerInput | null) {
  if (!input.name.trim()) throw new ProjectError(["Project name is required."]);
  if (input.market === "RESIDENTIAL" && input.isTaxExempt) throw new ProjectError(["Residential jobs can't be tax-exempt."]);
  const project = await prisma.project.create({
    data: {
      ...input,
      name: input.name.trim(),
      scopes: input.scopes,
      form17Status: nextForm17Status(input.isPublic, input.isTaxExempt, "NOT_REQUIRED"),
      status: "LEAD",
    },
  });
  const states = reconcileIntake([], { scopes: input.scopes, constructionType: input.constructionType ?? null });
  const synced: Record<string, string | null | undefined> = {
    location: input.address,
    building_use: input.buildingUse,
    construction_type: input.constructionType ? CONSTRUCTION_LABEL[input.constructionType] : null,
  };
  await prisma.intakeField.createMany({
    data: states.map((s) => {
      const v = synced[s.key]?.trim();
      return {
        projectId: project.id,
        key: s.key,
        unit: INTAKE_BY_KEY.get(s.key)?.unit ?? null,
        status: v ? "VERIFIED" : s.status,
        value: v || null,
        autoNa: v ? false : s.autoNa,
        approvedBy: v ? actor.name : null,
      };
    }),
  });
  await activity(project.id, actor.id, "created", `${actor.name} created the job`, { scopes: input.scopes, market: project.market });
  if (homeowner?.firstName.trim() && homeowner.lastName.trim()) {
    // Reuse an existing contact with the same phone or email rather than creating a duplicate.
    const pk = phoneKey(homeowner.phone);
    const email = normEmail(homeowner.email);
    const existing =
      (pk || email) &&
      (await prisma.contact.findFirst({ where: { OR: [...(pk ? [{ phoneKey: pk }] : []), ...(email ? [{ email }] : [])] } }));
    const contact =
      existing ||
      (await prisma.contact.create({
        data: {
          firstName: homeowner.firstName.trim(),
          lastName: homeowner.lastName.trim(),
          phone: homeowner.phone?.trim() || null,
          phoneKey: pk,
          email,
          address: input.address ?? null,
        },
      }));
    await prisma.projectContact.create({ data: { projectId: project.id, contactId: contact.id, role: homeowner.role ?? "HOMEOWNER", isPrimary: true } });
    await activity(
      project.id,
      actor.id,
      "contact",
      `${existing ? "Linked existing" : "Added"} ${homeowner.role === "OWNER_REP" ? "contact" : "homeowner"} ${contact.firstName} ${contact.lastName}`,
    );
  }
  if (project.form17Status === "PENDING")
    await activity(project.id, null, "form17", "Public, tax-exempt job: Nebraska Form 17 required before materials are purchased (PUB-01)");
  await refreshReadiness(project.id);
  return project;
}

export async function updateProjectDetails(id: string, patch: Partial<ProjectInput> & { contractAmount?: number | null; contractSignedAt?: Date | null }, actor: Actor) {
  const before = await prisma.project.findUniqueOrThrow({ where: { id } });
  const isPublic = patch.isPublic ?? before.isPublic;
  const isTaxExempt = patch.isTaxExempt ?? before.isTaxExempt;
  if ((patch.market ?? before.market) === "RESIDENTIAL" && isTaxExempt) throw new ProjectError(["Residential jobs can't be tax-exempt."]);
  const data = {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.scopes ? { scopes: patch.scopes } : {}),
    form17Status: nextForm17Status(isPublic, isTaxExempt, before.form17Status),
  };
  if (data.name === "") throw new ProjectError(["Project name is required."]);
  const after = await prisma.project.update({ where: { id }, data });

  // Keep intake in step with the project columns and scopes.
  const syncVals: [string, string | null][] = [];
  if (patch.address !== undefined) syncVals.push(["location", patch.address]);
  if (patch.buildingUse !== undefined) syncVals.push(["building_use", patch.buildingUse]);
  if (patch.constructionType !== undefined)
    syncVals.push(["construction_type", patch.constructionType ? CONSTRUCTION_LABEL[patch.constructionType] : null]);
  for (const [key, v] of syncVals) {
    const value = v?.trim() || null;
    await prisma.intakeField.update({
      where: { projectId_key: { projectId: id, key } },
      data: value ? { value, status: "VERIFIED", autoNa: false, approvedBy: actor.name } : { value: null, status: "MISSING" },
    });
  }
  await reconcileProjectIntake(id);

  const changed = Object.keys(patch).filter(
    (k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k]),
  );
  if (changed.length) await activity(id, actor.id, "details", `${actor.name} updated ${changed.join(", ")}`);
  if (before.form17Status !== after.form17Status)
    await activity(id, actor.id, "form17", `Form 17 status: ${before.form17Status} → ${after.form17Status}`);
  await refreshReadiness(id);
  return after;
}

async function reconcileProjectIntake(projectId: string) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { intake: true } });
  const next = reconcileIntake(p.intake, { scopes: parseScopes(p.scopes), constructionType: p.constructionType });
  for (const n of next) {
    const cur = p.intake.find((f) => f.key === n.key);
    if (!cur) {
      await prisma.intakeField.create({ data: { projectId, key: n.key, status: n.status, autoNa: n.autoNa } });
    } else if (cur.status !== n.status || cur.autoNa !== n.autoNa) {
      await prisma.intakeField.update({ where: { id: cur.id }, data: { status: n.status, autoNa: n.autoNa } });
    }
  }
}

export async function updateIntakeField(
  projectId: string,
  key: string,
  input: { value: string | null; unit: string | null; status: "VERIFIED" | "MISSING" | "ASSUMED" | "NOT_APPLICABLE"; note: string | null },
  actor: Actor,
) {
  const def = INTAKE_BY_KEY.get(key);
  if (!def) throw new ProjectError([`Unknown intake field ${key}.`]);
  const value = input.value?.trim() || null;
  const note = input.note?.trim() || null;
  if ((input.status === "VERIFIED" || input.status === "ASSUMED") && !value)
    throw new ProjectError([`${def.label}: enter a value to mark it ${input.status.toLowerCase()}.`]);
  if (input.status === "ASSUMED" && !note)
    throw new ProjectError([`${def.label}: say what the assumption is based on. Assumptions are NOT FOR FINAL BID.`]);
  if (input.status === "NOT_APPLICABLE" && def.key in SYNCED)
    throw new ProjectError([`${def.label} always applies.`]);

  const before = await prisma.intakeField.findUniqueOrThrow({ where: { projectId_key: { projectId, key } } });
  await prisma.intakeField.update({
    where: { id: before.id },
    data: {
      value: input.status === "MISSING" ? null : value,
      unit: input.unit?.trim() || def.unit || null,
      status: input.status,
      note,
      autoNa: false,
      approvedBy: input.status === "MISSING" ? null : actor.name,
    },
  });
  const col = SYNCED[key];
  if (col && col !== "constructionType") await prisma.project.update({ where: { id: projectId }, data: { [col]: value } });
  if (col === "constructionType") {
    const ct = /re-?roof/i.test(value ?? "") ? "REROOF" : /new/i.test(value ?? "") ? "NEW" : null;
    await prisma.project.update({ where: { id: projectId }, data: { constructionType: ct } });
    await reconcileProjectIntake(projectId);
  }
  const shown = input.status === "MISSING" ? "MISSING" : `${input.status}${value ? ` = ${value}` : ""}`;
  await activity(projectId, actor.id, "intake", `${actor.name} set ${def.label}: ${shown}`, {
    key,
    before: { value: before.value, status: before.status },
  });
  return refreshReadiness(projectId);
}

export async function loadReadinessInput(projectId: string): Promise<ReadinessInput> {
  const [p, estimate, expired] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { intake: true } }),
    prisma.estimate.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { lines: { include: { priceItem: { include: { sheet: true } } } }, laborLines: true },
    }),
    prisma.priceSheet.findMany({ where: { isActive: true, isLoaded: true } }),
  ]);
  return {
    projectId,
    intake: p.intake
      .filter((f) => f.status !== "NOT_APPLICABLE")
      .map((f) => ({ key: f.key, label: INTAKE_BY_KEY.get(f.key)?.label ?? f.key, status: f.status })),
    estimate: estimate && {
      id: estimate.id,
      name: estimate.name,
      wasteApproved: estimate.wasteApproved,
      lines: estimate.lines.map((l) => ({
        id: l.id,
        itemName: l.itemName,
        sourceStatus: l.sourceStatus,
        sheetStatus: l.priceItem ? sheetDateStatus(l.priceItem.sheet).status : null,
      })),
      labor: estimate.laborLines.map((l) => ({ id: l.id, task: l.task, sourceStatus: l.sourceStatus })),
    },
    // only the sheets this job can be priced from: BTR standard, plus its builder's own
    expiredSheets: expired.filter((s) => (!s.companyId || s.companyId === p.clientCompanyId) && sheetDateStatus(s).status === "EXPIRED").map((s) => `${s.code} ${s.name}`),
  };
}

export async function refreshReadiness(projectId: string) {
  const result = computeReadiness(await loadReadinessInput(projectId));
  await prisma.project.update({ where: { id: projectId }, data: { readiness: result.readiness } });
  return result;
}

export async function changeStage(projectId: string, to: Stage, opts: { reason?: string; override?: boolean; lostCategory?: string | null }, actor: Actor) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const { readiness } = await refreshReadiness(projectId);
  const gate = checkStageChange({
    from: p.status,
    to,
    readiness,
    form17Status: p.form17Status,
    contractAmount: p.contractAmount,
    contractSignedAt: p.contractSignedAt,
    reason: opts.reason,
    override: opts.override,
  });
  if (!gate.ok) throw new ProjectError(gate.problems, gate.overridable);
  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: to,
      statusChangedAt: new Date(),
      lostReason: to === "LOST" ? opts.reason!.trim() : null,
      lostCategory: to === "LOST" ? (opts.lostCategory ?? "Other") : null,
      // leaving Lead means someone reached the customer
      ...(p.status === "LEAD" && to !== "LOST" && !p.firstContactAt ? { firstContactAt: new Date() } : {}),
    },
  });
  // follow-up reminders stop once the job leaves Submitted (signed, lost or moved back)
  if (p.status === "SUBMITTED" && to !== "SUBMITTED")
    await prisma.task.updateMany({ where: { projectId, doneAt: null, auto: { startsWith: "SUBMITTED:fu-" } }, data: { doneAt: new Date(), doneBy: `Auto — job moved to ${to.toLowerCase().replace("_", " ")}` } });
  const why = opts.reason?.trim() ? ` — ${opts.reason.trim()}` : "";
  await activity(projectId, actor.id, "stage", `${actor.name} moved the job ${p.status} → ${to}${why}`, { from: p.status, to });
  await createStageTasks(p, to, actor);
  if (gate.overridden) {
    await activity(projectId, actor.id, "override", `${actor.name} submitted while NOT READY FOR HARD BID${why}`);
    await prisma.auditLog.create({
      data: { userId: actor.id, entity: "Project", entityId: projectId, action: "override_readiness", after: { to, reason: opts.reason } },
    });
  }
}

export async function executeForm17(projectId: string, input: { executedAt: Date; note: string | null }, actor: Actor) {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (p.form17Status !== "PENDING") throw new ProjectError(["Form 17 isn't pending on this job."]);
  await prisma.project.update({
    where: { id: projectId },
    data: { form17Status: "EXECUTED", form17ExecutedAt: input.executedAt, form17ExecutedBy: actor.name, form17Note: input.note },
  });
  await activity(projectId, actor.id, "form17", `${actor.name} recorded Form 17 as executed with the owner`, { note: input.note });
  await prisma.auditLog.create({
    data: { userId: actor.id, entity: "Project", entityId: projectId, action: "form17_executed", after: { executedAt: input.executedAt, note: input.note } },
  });
}

export { INTAKE_FIELDS };
