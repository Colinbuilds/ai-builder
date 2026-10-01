import { prisma } from "@/lib/db";
import { sheetDateStatus } from "@/lib/sheets/date-status";
import { normEmail } from "@/lib/customers";

export class BuilderError extends Error {}
export const PREFIX_RE = /^[A-Z]{2,4}$/;

export type BuilderInput = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  abcAccount: string | null;
  sheetPrefix: string | null;
  pricingFallback: "STANDARD" | "MISSING" | null;
  poRequired: boolean;
  standardSpecs: string | null;
  billingTerms: string | null;
  notes: string | null;
};

export async function saveBuilder(id: string | null, input: BuilderInput, actor: { id: string; name: string; role: string }) {
  if (actor.role === "VIEWER") throw new BuilderError("Viewers can't edit builders.");
  if (!input.name.trim()) throw new BuilderError("Builder name is required.");
  if (!input.pricingFallback) throw new BuilderError("Choose what happens when an item isn't on this builder's pricing: use BTR standard pricing (flagged), or leave it MISSING.");
  const prefix = input.sheetPrefix?.trim().toUpperCase() || null;
  if (prefix && !PREFIX_RE.test(prefix)) throw new BuilderError("Sheet prefix must be 2–4 letters, e.g. LEG for Legacy Homes.");
  if (prefix) {
    const clash = await prisma.company.findFirst({ where: { sheetPrefix: prefix, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw new BuilderError(`Prefix ${prefix} is already used by ${clash.name}.`);
    const standard = await prisma.priceSheet.findFirst({ where: { code: prefix, companyId: null } });
    if (standard) throw new BuilderError(`${prefix} is a BTR standard sheet code. Pick another prefix.`);
  }
  const before = id ? await prisma.company.findUnique({ where: { id } }) : null;
  if (before?.sheetPrefix && before.sheetPrefix !== prefix && (await prisma.priceSheet.count({ where: { companyId: id } })))
    throw new BuilderError("This builder already has price sheets under its prefix; the prefix can't change now.");
  const data = {
    name: input.name.trim(),
    type: "BUILDER" as const,
    phone: input.phone,
    email: normEmail(input.email),
    address: input.address,
    website: input.website,
    abcAccount: input.abcAccount,
    sheetPrefix: prefix,
    pricingFallback: input.pricingFallback,
    poRequired: input.poRequired,
    standardSpecs: input.standardSpecs,
    billingTerms: input.billingTerms,
    notes: input.notes,
  };
  const c = id ? await prisma.company.update({ where: { id }, data }) : await prisma.company.create({ data });
  if (before && before.pricingFallback !== c.pricingFallback)
    await prisma.auditLog.create({ data: { userId: actor.id, entity: "Company", entityId: c.id, action: "pricing_fallback", before: { fallback: before.pricingFallback }, after: { fallback: c.pricingFallback } } });
  return c;
}

export async function listBuilders() {
  const builders = await prisma.company.findMany({
    where: { type: "BUILDER" },
    include: {
      priceSheets: { where: { isActive: true }, include: { _count: { select: { items: true } } } },
      projects: { select: { status: true } },
    },
    orderBy: { name: "asc" },
  });
  return builders.map((b) => ({
    ...b,
    sheets: b.priceSheets.map((s) => ({ ...s, date: sheetDateStatus(s) })),
    openJobs: b.projects.filter((p) => !["CLOSED", "LOST", "PAID"].includes(p.status)).length,
  }));
}

/** Sheet warning for a builder sheet: its account should be the builder's ABC account when one is on file. */
export function builderSheetWarning(sheetAccount: string | null | undefined, builder: { name: string; abcAccount: string | null }) {
  if (!sheetAccount || !builder.abcAccount) return null;
  const digits = (s: string) => s.replace(/\D/g, "");
  return digits(sheetAccount).includes(digits(builder.abcAccount)) ? null : `Sheet is issued to account ${sheetAccount}, not ${builder.name}'s ${builder.abcAccount}. Confirm before use.`;
}
