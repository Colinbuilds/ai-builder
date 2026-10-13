// TEST_ONLY Home Company Schedule: create a builder house with scopes, group it by address, block duplicates.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ProdError, stepProdLine } from "@/lib/production/board";
import { createHouse, homeSchedule, scopeOf, setScopeStatus, statusOf } from "@/lib/production/homes";

const actor = { id: "", name: "TEST_ONLY Office", role: "OFFICE" };
const BUILDER = "TEST_ONLY Home Co";

afterAll(async () => {
  const ids = (await prisma.prodLine.findMany({ where: { builder: BUILDER }, select: { id: true } })).map((l) => l.id);
  await prisma.task.deleteMany({ where: { auto: { in: ids.flatMap((id) => [`PROD:pay:${id}`, `PROD:bill:${id}`]) } } });
  await prisma.prodLine.deleteMany({ where: { builder: BUILDER } });
  await prisma.user.deleteMany({ where: { email: "test-only-office@example.test" } });
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
});
