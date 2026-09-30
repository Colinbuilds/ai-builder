// Acceptance tests 1–3 (BUILD_PROMPT.md), run against a DB seeded from the real /data files.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getPriceItem, searchPriceItems } from "@/lib/price";

afterAll(() => prisma.$disconnect());

// Other test files upload TEST_ONLY sheets into the same DB; count only what the seed created.
const seeded = { sheet: { importId: null, isActive: true, companyId: null } };

describe("seed", () => {
  it("loads exactly 527 items across 6 sheets, 8 of them CALL", async () => {
    expect(await prisma.priceItem.count({ where: seeded })).toBe(527);
    expect(await prisma.priceSheet.count({ where: { isLoaded: true, importId: null, companyId: null } })).toBe(6);
    expect(await prisma.priceItem.count({ where: { priceStatus: "CALL", ...seeded } })).toBe(8);
    expect(await prisma.priceItem.count({ where: { priceStatus: "CALL", unitPrice: { not: null } } })).toBe(0);
  });

  it("creates the LP SmartSide sheet as not loaded, with no items", async () => {
    const lp = await prisma.priceSheet.findFirst({ where: { code: "LP" }, include: { _count: { select: { items: true } } } });
    expect(lp?.isLoaded).toBe(false);
    expect(lp?._count.items).toBe(0);
  });

  it("carries the Hardie Statement account warning", async () => {
    const hs = await prisma.priceSheet.findFirst({ where: { code: "HS" } });
    expect(hs?.warning).toMatch(/2182359-2/);
  });

  it("seeds all 16 company rules with locked flags", async () => {
    expect(await prisma.rule.count()).toBe(16);
    expect((await prisma.rule.findUnique({ where: { id: "SID-01" } }))?.locked).toBe(true);
    expect((await prisma.rule.findUnique({ where: { id: "ROOF-03" } }))?.itemNumber).toBe("4292804534");
  });
});

describe("seeded coverage", () => {
  it("parses coverage for the 186 items with explicit patterns", async () => {
    expect(await prisma.priceItem.count({ where: { coverageSource: "PARSED_FROM_DESCRIPTION", ...seeded } })).toBe(186);
    expect(await getPriceItem("02MLVIA3AB")).toMatchObject({ coverageQty: 3, coverageUnit: "BD/SQ" });
    expect(await getPriceItem("04MLHR12AB")).toMatchObject({ coverageQty: 31, coverageUnit: "LF/BD" });
  });
});

describe("getPriceItem", () => {
  it("finds 1.25\" plastic cap nails", async () => {
    const it = await getPriceItem("4292804534");
    expect(it).toMatchObject({ description: '1.25" Plastic Cap Nails 2000/BX', unitPrice: 19.99, uom: "BX" });
    expect(it?.sheet.code).toBe("SS");
  });

  it("finds 1.25\" coil nails", async () => {
    const it = await getPriceItem("0150080011");
    expect(it).toMatchObject({ description: '1.25" Coil Nail', unitPrice: 40, uom: "BX" });
    expect(it?.sheet.code).toBe("SS");
  });

  it("returns null for an item number on no sheet", async () => {
    expect(await getPriceItem("NOT-A-REAL-ITEM")).toBeNull();
  });
});

describe("searchPriceItems", () => {
  it("matches all words across item #, description, and section", async () => {
    const r = await searchPriceItems({ q: "cap nails" });
    expect(r.items.map((i) => i.itemNumber)).toContain("4292804534");
  });

  it("is case-insensitive and filters by sheet", async () => {
    const r = await searchPriceItems({ q: "HIP & RIDGE", sheetCodes: ["SS"] });
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((i) => i.sheet.code === "SS")).toBe(true);
  });

  it("filters CALL items", async () => {
    const r = await searchPriceItems({ priceStatus: "CALL", sheetCodes: ["MH", "EL", "SS", "HP", "HS", "NX"] });
    expect(r.total).toBe(8);
  });
});
