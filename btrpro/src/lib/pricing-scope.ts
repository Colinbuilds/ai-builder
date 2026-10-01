import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Which price sheets a job is priced from. Standard jobs use BTR's own ABC sheets. A job whose client is a
 * home builder uses that builder's negotiated sheets; for items not on them, the builder's setting decides:
 * STANDARD = BTR's price, flagged on the line · MISSING (or not set yet) = the item stays MISSING.
 * Builder prices never leak onto any other job.
 */
export type PriceScope = { builderId: string | null; builderName: string | null; fallback: "STANDARD" | "MISSING" | null };
export const STANDARD_SCOPE: PriceScope = { builderId: null, builderName: null, fallback: null };

export async function priceScopeFor(projectId: string): Promise<PriceScope> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { clientCompany: { select: { id: true, name: true, type: true, pricingFallback: true } } } });
  const c = p?.clientCompany;
  if (!c || c.type !== "BUILDER") return STANDARD_SCOPE;
  return { builderId: c.id, builderName: c.name, fallback: c.pricingFallback === "STANDARD" ? "STANDARD" : c.pricingFallback === "MISSING" ? "MISSING" : null };
}

/** Sheet filter for searching items within a scope. */
export function sheetWhere(scope: PriceScope): Prisma.PriceSheetWhereInput {
  if (!scope.builderId) return { isActive: true, companyId: null };
  if (scope.fallback === "STANDARD") return { isActive: true, OR: [{ companyId: scope.builderId }, { companyId: null }] };
  return { isActive: true, companyId: scope.builderId };
}

export const notOnBuilderNote = (scope: PriceScope) =>
  scope.fallback === "STANDARD"
    ? `Not on ${scope.builderName}'s pricing — BTR standard price used (builder is set to fall back).`
    : `Not on ${scope.builderName}'s pricing sheet${scope.fallback == null ? " (no fallback chosen for this builder)" : ""}. Get the builder price or change the builder's fallback.`;
