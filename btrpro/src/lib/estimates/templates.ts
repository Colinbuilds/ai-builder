import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createEstimate, EstimateError } from "./service";
import { defaultConfig, MODULES_FOR_SCOPE, type Module, type TakeoffConfig } from "./takeoff";
import { liveItems } from "./service";
import { priceScopeFor } from "@/lib/pricing-scope";

type Actor = { id: string; name: string; role?: string };
export const CATEGORY_LABEL: Record<string, string> = { SHINGLE: "Asphalt shingles", FLAT: "Flat roof", SIDING: "Siding", DECK: "Roof deck", OTHER: "Other" };
export const CATEGORY_ORDER = ["SHINGLE", "FLAT", "SIDING", "DECK", "OTHER"];

export async function listTemplates(opts: { includeInactive?: boolean; companyId?: string | null } = {}) {
  return prisma.estimateTemplate.findMany({
    where: { ...(opts.includeInactive ? {} : { active: true }), OR: [{ companyId: null }, ...(opts.companyId ? [{ companyId: opts.companyId }] : [])] },
    orderBy: [{ category: "asc" }, { group: "asc" }, { brand: "asc" }, { name: "asc" }],
  });
}

/** Every item number a template uses, for showing live prices next to it. */
export function templateItemNumbers(config: unknown): string[] {
  return (JSON.stringify(config).match(/"itemNumber":"([^"]+)"/g) ?? []).map((m) => m.slice(14, -1));
}

/** Fills one module of an estimate's takeoff with the template's product picks (quantities still come from measurements). */
export async function applyTemplate(estimateId: string, templateId: string, actor: Actor) {
  const [e, t] = await Promise.all([
    prisma.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { project: true } }),
    prisma.estimateTemplate.findUniqueOrThrow({ where: { id: templateId } }),
  ]);
  if (e.locked) throw new EstimateError("This revision is locked. Start a new revision to change products.");
  const module = t.module as Module;
  if (!MODULES_FOR_SCOPE[e.scopeType].includes(module)) throw new EstimateError(`"${t.name}" is a ${module} template; this estimate is ${e.scopeType.replace("_", " ").toLowerCase()}.`);
  const cur = (e.takeoff as TakeoffConfig) ?? {};
  const merged = { ...defaultConfig(module, e.project.market), ...(t.config as object) };
  await prisma.estimate.update({ where: { id: estimateId }, data: { takeoff: { ...cur, [module]: merged } as Prisma.InputJsonValue } });
  // on a builder job, say which picks aren't on the builder's pricing
  const scope = await priceScopeFor(e.projectId);
  const nums = templateItemNumbers(t.config);
  const found = await liveItems(nums, scope);
  const missing = nums.filter((n) => !found.has(n));
  await prisma.projectActivity.create({
    data: { projectId: e.projectId, userId: actor.id, kind: "estimate", text: `${actor.name} applied template "${t.name}" to ${e.name}${missing.length ? ` — ${missing.length} product(s) not on ${scope.builderName ?? "the loaded sheets"}: ${missing.join(", ")}` : ""}` },
  });
  return { module, missing };
}

export async function createEstimateFromTemplate(projectId: string, templateId: string, actor: Actor) {
  const t = await prisma.estimateTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const e = await createEstimate(projectId, t.scopeType as never, actor);
  const r = await applyTemplate(e.id, t.id, actor);
  return { estimate: e, ...r };
}

/** Saves one module of an estimate's takeoff as a new template (or over an existing one you own). */
export async function saveAsTemplate(
  estimateId: string,
  input: { module: Module; name: string; category: string; group: string; brand: string | null; impactClass: string | null; impactSource: string | null; notes: string | null; replaceId?: string | null; companyId?: string | null },
  actor: Actor,
) {
  if (actor.role === "VIEWER") throw new EstimateError("Viewers can't save templates.");
  if (!input.name.trim() || !input.group.trim()) throw new EstimateError("Name the template and its group (e.g. Class 4, EPDM, Vinyl).");
  if (input.impactClass && !input.impactSource?.trim()) throw new EstimateError("Say where the impact class comes from (spec sheet, UL listing).");
  const e = await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } });
  const config = ((e.takeoff as TakeoffConfig) ?? {})[input.module];
  if (!config) throw new EstimateError("That estimate has no takeoff for this scope yet.");
  const data = {
    name: input.name.trim(),
    category: input.category,
    group: input.group.trim(),
    brand: input.brand?.trim() || null,
    impactClass: input.impactClass,
    impactSource: input.impactSource?.trim() || null,
    scopeType: input.module === "steep" ? "STEEP" : input.module === "lowSlope" ? "LOW_SLOPE" : input.module === "siding" ? "SIDING" : "DECK",
    module: input.module,
    config: config as Prisma.InputJsonValue,
    notes: input.notes?.trim() || null,
    companyId: input.companyId ?? null,
  };
  if (input.replaceId) {
    const before = await prisma.estimateTemplate.findUniqueOrThrow({ where: { id: input.replaceId } });
    if (before.builtIn && actor.role !== "ADMIN") throw new EstimateError("Only an Admin can change a built-in template.");
    const t = await prisma.estimateTemplate.update({ where: { id: input.replaceId }, data });
    await prisma.auditLog.create({ data: { userId: actor.id, entity: "EstimateTemplate", entityId: t.id, action: "update", before: { config: before.config as Prisma.InputJsonValue }, after: { config: data.config } } });
    return t;
  }
  return prisma.estimateTemplate.create({ data: { ...data, key: `user-${randomBytes(6).toString("hex")}`, createdBy: actor.name } });
}

export async function updateTemplateMeta(id: string, input: { name: string; group: string; impactClass: string | null; impactSource: string | null; notes: string | null; active: boolean }, actor: Actor) {
  if (actor.role !== "ADMIN") throw new EstimateError("Only an Admin edits templates.");
  if (input.impactClass && !input.impactSource?.trim()) throw new EstimateError("Say where the impact class comes from (spec sheet, UL listing).");
  const before = await prisma.estimateTemplate.findUniqueOrThrow({ where: { id } });
  const t = await prisma.estimateTemplate.update({ where: { id }, data: { ...input, name: input.name.trim(), group: input.group.trim(), impactSource: input.impactSource?.trim() || null, notes: input.notes?.trim() || null } });
  await prisma.auditLog.create({ data: { userId: actor.id, entity: "EstimateTemplate", entityId: id, action: "meta", before: { impactClass: before.impactClass, active: before.active, group: before.group }, after: { impactClass: t.impactClass, active: t.active, group: t.group } } });
  return t;
}
