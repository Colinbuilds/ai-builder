// TEST_ONLY Home Company Schedule: create a builder house with scopes, group it by address, block duplicates.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ProdError, stepProdLine } from "@/lib/production/board";
import { createHouse, homeSchedule, materialsOf, saveScopeDetails, scopeOf, setScopeStatus, statusOf } from "@/lib/production/homes";
import type { PlanBookData, PlanOption } from "@/lib/builders/plans";

const actor = { id: "", name: "TEST_ONLY Office", role: "OFFICE" };
const BUILDER = "TEST_ONLY Home Co";
const PB_BUILDER = "TEST_ONLY Plan Book Homes";

// a made-up plan book: one model, elevation A, roofing and gutters (no real pricing)
const opt = (o: Partial<PlanOption>): PlanOption => ({ label: "A", kind: "ELEVATION", onlyWith: null, materials: [], materialCost: null, tax: null, squares: null, payout: null, sell: null, profit: null, ...o });
const BOOK: PlanBookData = {
  version: 1,
  warnings: [],
  rates: { roofing: { taxPct: null, markupPct: null, laborPerSq: null, laborMarkupPerSq: null, bootTrip: null, bootTripMarkup: null, fuelSurcharge: null, catalog: [] }, gutters: { catalog: [], dlwoDownspoutLf: null, dlwoPrice: null }, siding: { catalog: [], priced: false } },
  plans: [
    {
      name: "Test Model",
      sqft: null,
      oldRoofing: {},
      roofing: [opt({ materials: [{ name: "TEST_ONLY Shingle", qty: 30, cost: 300 }, { name: "TEST_ONLY Ridge", qty: 2, cost: 20 }], sell: 1000, payout: 400, profit: 280 })],
      gutters: [opt({ materials: [{ name: "TEST_ONLY Gutter", qty: 120, cost: 240 }], sell: 500, payout: 240, profit: 260 })],
    },
  ],
};

afterAll(async () => {
  const ids = (await prisma.prodLine.findMany({ where: { builder: BUILDER }, select: { id: true } })).map((l) => l.id);
  await prisma.task.deleteMany({ where: { auto: { in: ids.flatMap((id) => [`PROD:pay:${id}`, `PROD:bill:${id}`]) } } });
  await prisma.prodLine.deleteMany({ where: { builder: BUILDER } });
  await prisma.user.deleteMany({ where: { email: "test-only-office@example.test" } });
  await prisma.company.deleteMany({ where: { name: PB_BUILDER } });
  await prisma.$disconnect();
});

describe("home company schedule", () => {
  it("creates one new line per scope with the model and elevation", async () => {
    const lines = await createHouse({ builder: BUILDER, address: "1 Test Lot St", model: "Sienna", elevation: "B", scopes: ["Roofing", "Roof Seal", "Columns"], startDate: new Date("2026-11-02T12:00:00Z") }, actor);
    expect(lines.map((l) => l.type)).toEqual(["Roofing", "Roof Seal", "Columns"]);
    const saved = await prisma.prodLine.findMany({ where: { builder: BUILDER } });
    expect(saved).toHaveLength(3);
    for (const l of saved) expect(l).toMatchObject({ market: "RESIDENTIAL", board: "ADD", location: "1 Test Lot St", model: "Sienna", elevation: "B", source: "APP" });
    expect(saved.every((l) => l.startDate?.toISOString().startsWith("2026-11-02"))).toBe(true);
  });

  it("groups the scopes under one house and adds new scopes to it", async () => {
    await createHouse({ builder: BUILDER, address: "1 test lot st.", model: "Sienna", elevation: "B", scopes: ["Siding", "Gutters"] }, actor);
    const houses = await homeSchedule(BUILDER);
    expect(houses).toHaveLength(1);
    expect(houses[0]).toMatchObject({ address: "1 Test Lot St", model: "Sienna", elevation: "B" });
    expect(houses[0].lines.map((l) => l.type).sort()).toEqual(["Columns", "Gutters", "Roof Seal", "Roofing", "Siding"]);
  });

  it("refuses a scope already on the schedule at that address, and missing details", async () => {
    await expect(createHouse({ builder: BUILDER, address: "1 Test Lot St", model: "Sienna", elevation: "B", scopes: ["Roofing"] }, actor)).rejects.toThrow(/already has Roofing/);
    await expect(createHouse({ builder: BUILDER, address: "", model: "", elevation: "", scopes: [] }, actor)).rejects.toThrow(ProdError);
    await expect(createHouse({ builder: BUILDER, address: "2 Test Lot St", model: "Sienna", elevation: "A", scopes: ["Painting"] }, actor)).rejects.toThrow(/at least one scope/);
    await expect(createHouse({ builder: BUILDER, address: "2 Test Lot St", model: "Sienna", elevation: "A", scopes: ["Roofing"] }, { ...actor, role: "VIEWER" })).rejects.toThrow(/Viewers/);
  });

  it("reads synced sheet types as scopes", () => {
    expect(["Roofing L&M", "Siding Labor", "Gutters", "Roof seal", "Columns wrap", "Paint"].map(scopeOf)).toEqual(["Roofing", "Siding", "Gutters", "Roof Seal", "Columns", null]);
  });

  it("walks a scope through Waiting → In progress → Job Done → Sent to Billing, with office tasks", async () => {
    await prisma.user.upsert({ where: { email: "test-only-office@example.test" }, update: {}, create: { email: "test-only-office@example.test", name: "TEST_ONLY Office", role: "OFFICE", passwordHash: "x" } });
    const [house] = await homeSchedule(BUILDER);
    const roof = house.scopes.Roofing![0];
    expect(statusOf(roof)).toBe("WAITING");
    expect(statusOf(await setScopeStatus(roof.id, "IN_PROGRESS", actor))).toBe("IN_PROGRESS");
    expect((await prisma.prodLine.findUnique({ where: { id: roof.id } }))!.board).toBe("CURRENT");
    const done = await setScopeStatus(roof.id, "DONE", actor);
    expect(statusOf(done)).toBe("DONE");
    expect(done.completed).toMatch(/^Done/);
    expect(await prisma.task.count({ where: { auto: `PROD:pay:${roof.id}`, doneAt: null } })).toBeGreaterThan(0);
    expect(statusOf(await setScopeStatus(roof.id, "BILLING", actor))).toBe("BILLING");
    expect(await prisma.task.count({ where: { auto: `PROD:bill:${roof.id}`, doneAt: null } })).toBeGreaterThan(0);
    // moving back clears completed and closes both tasks
    const back = await setScopeStatus(roof.id, "WAITING", actor);
    expect(statusOf(back)).toBe("WAITING");
    expect(back.completed).toBeNull();
    expect(back.board).toBe("UPCOMING");
    expect(await prisma.task.count({ where: { auto: { in: [`PROD:pay:${roof.id}`, `PROD:bill:${roof.id}`] }, doneAt: null } })).toBe(0);
  });

  it("agrees with the main schedule's Completed and Billed buttons", async () => {
    const [house] = await homeSchedule(BUILDER);
    const seal = house.scopes["Roof Seal"]![0];
    await setScopeStatus(seal.id, "IN_PROGRESS", actor);
    expect(statusOf(await stepProdLine(seal.id, "complete", actor))).toBe("DONE");
    expect(statusOf(await stepProdLine(seal.id, "bill", actor))).toBe("BILLING");
    await expect(setScopeStatus(seal.id, "WAITING", actor)).rejects.toThrow(/already billed/);
    await expect(setScopeStatus(seal.id, "Finished", actor)).rejects.toThrow(/Pick Waiting/);
  });

  it("fills roofing and gutters from the builder's plan book; other scopes start empty", async () => {
    const co = await prisma.company.create({ data: { name: PB_BUILDER, type: "BUILDER" } });
    await prisma.builderPlanBook.create({ data: { companyId: co.id, label: "Test", data: BOOK as never, importedBy: "TEST_ONLY" } });
    const lines = await createHouse({ builder: PB_BUILDER, address: "9 Test Lot St", model: "test model", elevation: "Elevation a", scopes: ["Roofing", "Gutters", "Siding"] }, actor);
    const [roof, gut, siding] = ["Roofing", "Gutters", "Siding"].map((t) => lines.find((l) => l.type === t)!);
    expect(materialsOf(roof)).toEqual([{ name: "TEST_ONLY Shingle", qty: 30, unit: "EA" }, { name: "TEST_ONLY Ridge", qty: 2, unit: "EA" }]);
    expect(roof).toMatchObject({ sell: 1000, payout: 400 });
    expect(roof.materialsSrc).toMatch(/plan book: Test Model · Elev A/);
    expect(materialsOf(gut)).toEqual([{ name: "TEST_ONLY Gutter", qty: 120, unit: "LF" }]);
    expect(gut).toMatchObject({ sell: 500, payout: 240 });
    expect(materialsOf(siding)).toEqual([]);
    expect(siding).toMatchObject({ sell: null, payout: null, materialsSrc: null });
    // an elevation the book doesn't have is left empty, never guessed
    const [z] = await createHouse({ builder: PB_BUILDER, address: "10 Test Lot St", model: "Test Model", elevation: "Z", scopes: ["Roofing"] }, actor);
    expect(materialsOf(z)).toEqual([]);
    expect(z.sell).toBeNull();
    await prisma.prodLine.deleteMany({ where: { builder: PB_BUILDER } });
  });

  it("saves a scope's material list, sell and pay out", async () => {
    const [house] = await homeSchedule(BUILDER);
    const siding = house.scopes.Siding![0];
    const saved = await saveScopeDetails(siding.id, { materials: [{ name: "TEST_ONLY Lap siding", qty: "42", unit: "SQ" }, { name: "", qty: "", unit: "" }, { name: "TEST_ONLY Trim", qty: "1,200", unit: "LF" }], sell: "$6,672.65", payout: "4869.12" }, actor);
    expect(materialsOf(saved)).toEqual([{ name: "TEST_ONLY Lap siding", qty: 42, unit: "SQ" }, { name: "TEST_ONLY Trim", qty: 1200, unit: "LF" }]);
    expect(saved).toMatchObject({ sell: 6672.65, payout: 4869.12, materialsSrc: "Entered by TEST_ONLY Office" });
    await expect(saveScopeDetails(siding.id, { materials: [{ name: "TEST_ONLY Trim", qty: "0", unit: "LF" }], sell: "", payout: "" }, actor)).rejects.toThrow(/quantity above 0/);
    await expect(saveScopeDetails(siding.id, { materials: [{ name: "", qty: "4", unit: "" }], sell: "", payout: "" }, actor)).rejects.toThrow(/enter the material/);
    await expect(saveScopeDetails(siding.id, { materials: [], sell: "abc", payout: "" }, actor)).rejects.toThrow(/Sell: enter a dollar amount/);
    await expect(saveScopeDetails(siding.id, { materials: [], sell: "", payout: "" }, { ...actor, role: "VIEWER" })).rejects.toThrow(/Viewers/);
  });
});
