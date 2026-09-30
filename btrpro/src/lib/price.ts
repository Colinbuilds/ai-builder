import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sheetWhere, STANDARD_SCOPE, type PriceScope } from "@/lib/pricing-scope";

const withSheet = {
  sheet: { select: { code: true, name: true, effectiveDate: true, expirationDate: true, warning: true, companyId: true } },
} satisfies Prisma.PriceItemInclude;

export type PriceItemWithSheet = Prisma.PriceItemGetPayload<{ include: typeof withSheet }>;

/** Look up an item by exact supplier item number on the active sheets of a pricing scope (BTR standard by default). */
export async function getPriceItem(itemNumber: string, sheetCode?: string, scope: PriceScope = STANDARD_SCOPE): Promise<PriceItemWithSheet | null> {
  const rows = await prisma.priceItem.findMany({
    where: { itemNumber: itemNumber.trim(), sheet: { ...sheetWhere(scope), ...(sheetCode ? { code: sheetCode } : {}) } },
    include: withSheet,
  });
  // the builder's own row wins over a standard one
  return rows.find((r) => r.sheet.companyId) ?? rows[0] ?? null;
}

export type PriceSearch = {
  q?: string;
  sheetCodes?: string[];
  section?: string;
  priceStatus?: "LISTED" | "CALL";
  page?: number;
  pageSize?: number;
  // which sheets: BTR standard by default; a builder job's scope, or one builder's own sheets
  scope?: PriceScope;
};

// SQLite LIKE is already case-insensitive; Postgres needs mode: "insensitive" (unsupported on SQLite).
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};

/** Search item #, description, and section. All words must match (in any of those fields). */
export async function searchPriceItems({ q, sheetCodes, section, priceStatus, page = 1, pageSize = 50, scope = STANDARD_SCOPE }: PriceSearch) {
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean);
  const where: Prisma.PriceItemWhereInput = {
    sheet: { ...sheetWhere(scope), ...(sheetCodes?.length ? { code: { in: sheetCodes } } : {}) },
    ...(section ? { section } : {}),
    ...(priceStatus ? { priceStatus } : {}),
    AND: words.map((w) => ({
      OR: [
        { itemNumber: { contains: w, ...ci } },
        { description: { contains: w, ...ci } },
        { section: { contains: w, ...ci } },
      ],
    })),
  };
  const [total, items] = await Promise.all([
    prisma.priceItem.count({ where }),
    prisma.priceItem.findMany({
      where,
      include: withSheet,
      orderBy: [{ sheet: { code: "asc" } }, { section: "asc" }, { itemNumber: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, items, page, pageSize };
}

/** BTR standard sheets (or one builder's own sheets). */
export async function listSheets(companyId: string | null = null) {
  return prisma.priceSheet.findMany({
    where: { isActive: true, companyId },
    include: { _count: { select: { items: true } } },
    orderBy: [{ isLoaded: "desc" }, { code: "asc" }],
  });
}

export async function listSections(sheetCodes?: string[]) {
  const rows = await prisma.priceItem.findMany({
    where: { sheet: { isActive: true, companyId: null, ...(sheetCodes?.length ? { code: { in: sheetCodes } } : {}) } },
    distinct: ["section"],
    select: { section: true },
    orderBy: { section: "asc" },
  });
  return rows.map((r) => r.section);
}
