import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const withSheet = {
  sheet: { select: { code: true, name: true, effectiveDate: true, expirationDate: true, warning: true } },
} satisfies Prisma.PriceItemInclude;

export type PriceItemWithSheet = Prisma.PriceItemGetPayload<{ include: typeof withSheet }>;

/** Look up an item by exact supplier item number across active sheets. Returns null if not on any sheet. */
export async function getPriceItem(itemNumber: string, sheetCode?: string): Promise<PriceItemWithSheet | null> {
  return prisma.priceItem.findFirst({
    where: { itemNumber: itemNumber.trim(), sheet: { isActive: true, ...(sheetCode ? { code: sheetCode } : {}) } },
    include: withSheet,
  });
}

export type PriceSearch = {
  q?: string;
  sheetCodes?: string[];
  section?: string;
  priceStatus?: "LISTED" | "CALL";
  page?: number;
  pageSize?: number;
};

// SQLite LIKE is already case-insensitive; Postgres needs mode: "insensitive" (unsupported on SQLite).
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};

/** Search item #, description, and section. All words must match (in any of those fields). */
export async function searchPriceItems({ q, sheetCodes, section, priceStatus, page = 1, pageSize = 50 }: PriceSearch) {
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean);
  const where: Prisma.PriceItemWhereInput = {
    sheet: { isActive: true, ...(sheetCodes?.length ? { code: { in: sheetCodes } } : {}) },
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

export async function listSheets() {
  return prisma.priceSheet.findMany({
    where: { isActive: true },
    include: { _count: { select: { items: true } } },
    orderBy: [{ isLoaded: "desc" }, { code: "asc" }],
  });
}

export async function listSections(sheetCodes?: string[]) {
  const rows = await prisma.priceItem.findMany({
    where: { sheet: { isActive: true, ...(sheetCodes?.length ? { code: { in: sheetCodes } } : {}) } },
    distinct: ["section"],
    select: { section: true },
    orderBy: { section: "asc" },
  });
  return rows.map((r) => r.section);
}
