// Labor (BUILD_PROMPT §6). Rates come only from the company Labor Standards library (starts empty),
// a stated historical/verified source, or a user-approved placeholder. Otherwise the line is MISSING.
import { prisma } from "@/lib/db";
import { refreshReadiness } from "@/lib/projects/service";
import { round } from "@/lib/calc/core";

type Actor = { id: string; name: string };

export type LaborCalcInput = { quantity: number | null; productionRate: number | null; hourlyRate: number | null; burdenPct: number | null };

/** labor hours = quantity ÷ production rate; total = hours × hourly rate × (1 + burden). */
export function computeLabor(i: LaborCalcInput) {
  const missing: string[] = [];
  if (i.quantity == null) missing.push("quantity");
  if (!i.productionRate) missing.push("production rate");
  if (i.hourlyRate == null) missing.push("hourly rate");
  if (i.burdenPct == null) missing.push("burden %");
  if (missing.length) return { laborHours: null, total: null, missing, formula: `MISSING: ${missing.join(", ")}` };
  const hours = round(i.quantity! / i.productionRate!, 2);
  const total = round(hours * i.hourlyRate! * (1 + i.burdenPct! / 100), 2);
  return {
    laborHours: hours,
    total,
    missing,
    formula: `${i.quantity} ÷ ${i.productionRate}/hr = ${hours} hrs × $${i.hourlyRate}/hr × ${round(1 + i.burdenPct! / 100, 4)} burden = $${total}`,
  };
}

export type LaborInput = {
  task: string;
  quantity: number | null;
  quantityUnit: string | null;
  quantitySource: string | null;
  standardId?: string | null;
  crewSize?: number | null;
  productionRate?: number | null;
  productionUnit?: string | null;
  hourlyRate?: number | null;
  burdenPct?: number | null;
  rateSource?: string | null; // historical job, verified source
  placeholder?: boolean; // user-approved placeholder (NOT FOR FINAL BID)
};

export async function addLaborLine(estimateId: string, input: LaborInput, actor: Actor) {
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  if (e.locked) throw new Error(`${e.name} is locked. Create a new revision to change it.`);
  if (!input.task.trim()) throw new Error("Name the labor task.");
  let fields = {
    crewSize: input.crewSize ?? null,
    productionRate: input.productionRate ?? null,
    productionUnit: input.productionUnit ?? input.quantityUnit ?? null,
    hourlyRate: input.hourlyRate ?? null,
    burdenPct: input.burdenPct ?? null,
  };
  let source = input.rateSource?.trim() || null;
  if (input.standardId) {
    const s = await prisma.laborStandard.findUniqueOrThrow({ where: { id: input.standardId } });
    fields = { crewSize: s.crewSize, productionRate: s.productionRate, productionUnit: s.unit, hourlyRate: s.hourlyRate, burdenPct: s.burdenPct };
    source = `Company labor standard: ${s.task} (${s.source})`;
  }
  const calc = computeLabor({ quantity: input.quantity, ...fields });
  const status = calc.missing.length ? "MISSING" : input.standardId ? "VERIFIED" : input.placeholder ? "PLACEHOLDER" : source ? "VERIFIED" : "MISSING";
  const note = status === "PLACEHOLDER" ? `PLACEHOLDER — NOT FOR FINAL BID. ${source ?? ""}`.trim() : !source && !calc.missing.length ? "No rate source — enter a standard, a verified source, or approve a placeholder." : source;
  const l = await prisma.laborLine.create({
    data: {
      estimateId,
      task: input.task.trim(),
      quantity: input.quantity,
      quantityUnit: input.quantityUnit,
      quantitySource: input.quantitySource,
      standardId: input.standardId ?? null,
      ...fields,
      laborHours: calc.laborHours,
      total: status === "MISSING" ? null : calc.total,
      sourceStatus: status,
      note: [note, calc.formula].filter(Boolean).join(" · "),
    },
  });
  await prisma.projectActivity.create({ data: { projectId: e.projectId, userId: actor.id, kind: "estimate", text: `${actor.name} added labor "${l.task}" (${status.toLowerCase()})` } });
  await refreshReadiness(e.projectId);
  return l;
}

export async function deleteLaborLine(id: string) {
  const l = await prisma.laborLine.findUniqueOrThrow({ where: { id }, include: { estimate: true } });
  if (l.estimate.locked) throw new Error(`${l.estimate.name} is locked.`);
  await prisma.laborLine.delete({ where: { id } });
  await refreshReadiness(l.estimate.projectId);
}

export async function saveLaborStandard(
  input: { id?: string; task: string; productionRate: number; unit: string; crewSize: number | null; hourlyRate: number | null; burdenPct: number | null; source: string },
  actor: Actor,
) {
  if (!input.task.trim() || !input.unit.trim()) throw new Error("Task and unit are required.");
  if (!(input.productionRate > 0)) throw new Error("Production rate must be above zero.");
  if (!input.source.trim()) throw new Error("Where does this rate come from? (BTR history, crew agreement, etc.)");
  const data = { ...input, task: input.task.trim(), unit: input.unit.trim(), source: input.source.trim(), enteredBy: actor.name };
  const { id, ...rest } = data;
  const s = id ? await prisma.laborStandard.update({ where: { id }, data: rest }) : await prisma.laborStandard.create({ data: rest });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "LaborStandard", entityId: s.id, action: id ? "update" : "create", after: rest } });
  return s;
}
