import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addLine, createEstimate, liveItems } from "@/lib/estimates/service";
import { saveBuilder, builderSheetWarning, type BuilderInput } from "@/lib/builders";
import { priceScopeFor, STANDARD_SCOPE } from "@/lib/pricing-scope";
import { searchPriceItems, getPriceItem } from "@/lib/price";
import { createOrder, addOrderLine } from "@/lib/orders/service";
import { previewInvoiceImport } from "@/lib/costing/service";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});
const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};
const base: BuilderInput = { name: "", phone: null, email: null, address: null, website: null, abcAccount: null, sheetPrefix: null, pricingFallback: null, poRequired: false, standardSpecs: null, billingTerms: null, notes: null };
const rnd = () => Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[0-9]/g, "Q");

/** A builder with its own sheet: the Vista shingle at a negotiated $120/SQ (BTR standard is $138). */
async function builderWithSheet(fallback: "STANDARD" | "MISSING") {
  const a = await admin();
  const prefix = `T${rnd()}`.slice(0, 4);
  const b = await saveBuilder(null, { ...base, name: `TEST_ONLY Builder ${prefix}`, sheetPrefix: prefix, pricingFallback: fallback }, a);
  const sheet = await prisma.priceSheet.create({
    data: { code: `${prefix}-SS`, name: `${b.name} - SS`, companyId: b.id, effectiveDate: new Date("2026-09-01"), expirationDate: new Date("2026-12-31"), isLoaded: true },
  });
  await prisma.priceItem.create({ data: { sheetId: sheet.id, section: "Shingles", itemNumber: "02MLVIA3AB", description: "Vista AR 252 3/SQ (builder)", unitPrice: 120, uom: "SQ", coverageQty: 3, coverageUnit: "BD/SQ" } });
  const job = await createProject({ name: `TEST_ONLY ${prefix} lot 12`, market: "RESIDENTIAL", scopes: ["STEEP"], address: "12 Lot Ln", isPublic: false, isTaxExempt: false, clientCompanyId: b.id } as never, a);
  const other = await createProject({ name: `TEST_ONLY standard job ${prefix}`, market: "RESIDENTIAL", scopes: ["STEEP"], address: "1 Other St", isPublic: false, isTaxExempt: false }, a, { firstName: "Pat", lastName: "Home" });
  return { a, b, job, other };
}

describe("builder setup", () => {
  it("requires a fallback choice and a unique 2–4 letter prefix that isn't a BTR sheet code", async () => {
    const a = await admin();
    await expect(saveBuilder(null, { ...base, name: "TEST_ONLY X" }, a)).rejects.toThrow(/Choose what happens/);
    await expect(saveBuilder(null, { ...base, name: "TEST_ONLY X", pricingFallback: "MISSING", sheetPrefix: "SS" }, a)).rejects.toThrow(/BTR standard sheet code/);
    await expect(saveBuilder(null, { ...base, name: "TEST_ONLY X", pricingFallback: "MISSING", sheetPrefix: "TOOLONG" }, a)).rejects.toThrow(/2–4 letters/);
    expect(builderSheetWarning("2182359-2", { name: "B", abcAccount: "2182359-2" })).toBeNull();
    expect(builderSheetWarning("2057372-2", { name: "B", abcAccount: "2182359-2" })).toMatch(/not B's/);
  });
});

describe("builder pricing", () => {
  it("builder jobs use the builder's price; standard jobs never see it", async () => {
    const { b, job, other } = await builderWithSheet("MISSING");
    const scope = await priceScopeFor(job.id);
    expect(scope).toMatchObject({ builderId: b.id, fallback: "MISSING" });
    expect((await liveItems(["02MLVIA3AB"], scope)).get("02MLVIA3AB")).toMatchObject({ unitPrice: 120, priceSource: "BUILDER" });
    expect(await priceScopeFor(other.id)).toEqual(STANDARD_SCOPE);
    expect((await liveItems(["02MLVIA3AB"])).get("02MLVIA3AB")).toMatchObject({ unitPrice: 138, priceSource: "STANDARD" });
    const lib = await searchPriceItems({ q: "Vista AR 252", pageSize: 50 });
    expect(lib.items.every((i) => !i.sheet.companyId)).toBe(true);
  });

  it("MISSING fallback: an item not on the builder sheet stays MISSING with a note", async () => {
    const { a, job } = await builderWithSheet("MISSING");
    const e = await createEstimate(job.id, "STEEP", a);
    const shingles = await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "02MLVIA3AB", itemName: "", quantity: 30, unit: "SQ" }, a);
    expect(shingles).toMatchObject({ unitCost: 120, total: 3600 });
    const starter = await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "04MLWSSAB", itemName: "Starter", quantity: 4, unit: "BD" }, a);
    expect(starter).toMatchObject({ sourceStatus: "MISSING_ITEM", unitCost: null });
    expect(starter.note).toMatch(/Not on TEST_ONLY Builder .*'s pricing sheet/);
  });

  it("STANDARD fallback: BTR price is used and flagged on the line", async () => {
    const { a, job } = await builderWithSheet("STANDARD");
    const e = await createEstimate(job.id, "STEEP", a);
    const starter = await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "04MLWSSAB", itemName: "Starter", quantity: 4, unit: "BD" }, a);
    expect(starter).toMatchObject({ unitCost: 126.5, total: 506 });
    expect(starter.note).toMatch(/BTR standard price used/);
    // the builder's own row still wins where it exists
    const shingles = await addLine(e.id, { section: "MATERIAL_ROOFING", itemNumber: "02MLVIA3AB", itemName: "", quantity: 1, unit: "SQ" }, a);
    expect(shingles).toMatchObject({ unitCost: 120, note: null });
    expect((await getPriceItem("02MLVIA3AB", undefined, await priceScopeFor(job.id)))?.unitPrice).toBe(120);
  });

  it("orders and invoice price checks use the builder's prices", async () => {
    const { a, job } = await builderWithSheet("MISSING");
    const o = await createOrder(job.id, null, a);
    const l = await addOrderLine(o.id, { itemNumber: "02MLVIA3AB", description: null, quantity: 1, unit: null }, a);
    expect(l.extended).toBe(120);
    await expect(addOrderLine(o.id, { itemNumber: "04MLWSSAB", description: null, quantity: 1, unit: null }, a)).rejects.toThrow(/isn't on TEST_ONLY Builder/);
    const prev = await previewInvoiceImport(job.id, "Invoice #,Item #,Description,Qty,UOM,Unit Price,Extended\nTEST-B1,02MLVIA3AB,Vista,10,SQ,138.00,1380.00");
    expect(prev.rows[0].priceFlag).toMatch(/billed \$138.00\/SQ vs \$120.00/);
  });
});
