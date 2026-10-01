// TEST_ONLY PM assignments and crew scopes
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mineWhere, pmScope, saveCrewScopes, savePm, scopesFromType } from "@/lib/production/assign";
import { dashboardSchedules } from "@/lib/dashboard-schedules";

describe("who does what", () => {
  afterAll(async () => {
    await prisma.prodLine.deleteMany({ where: { builder: { startsWith: "WDW_TEST_ONLY" } } });
    await prisma.crew.deleteMany({ where: { name: "WDW_TEST_ONLY Crew Z" } });
    await prisma.user.deleteMany({ where: { email: "test_only_pm@example.com" } });
  });

  it("reads work scopes from the schedule's Type column", () => {
    expect(scopesFromType("Siding Labor")).toEqual(["Siding"]);
    expect(scopesFromType("Roofing L&M")).toEqual(["Roofing (steep slope)"]);
    expect(scopesFromType("EPDM roof")).toEqual(["Roofing (low slope / EPDM / TPO)"]);
    expect(scopesFromType("Soffit/Fascia + Gutters")).toEqual(["Gutters", "Soffit & fascia"]);
  });

  it("a PM sees only their builders and crews", async () => {
    const u = await prisma.user.create({ data: { name: "TEST_ONLY Pat", email: "test_only_pm@example.com", passwordHash: "x", role: "ESTIMATOR" } });
    expect(await pmScope(u.id)).toBeNull();
    await prisma.prodLine.createMany({
      data: [
        { market: "RESIDENTIAL", board: "CURRENT", builder: "WDW_TEST_ONLY Hildy Homes", location: "1 Test St", crew: "TEST_ONLY Crew A" },
        { market: "RESIDENTIAL", board: "CURRENT", builder: "WDW_TEST_ONLY Other", location: "2 Test St", crew: "TEST_ONLY Crew B" },
        { market: "RESIDENTIAL", board: "CURRENT", builder: "WDW_TEST_ONLY Other", location: "3 Test St", crew: "TEST_ONLY Crew C", superName: "TEST_ONLY Pat" },
      ],
    });
    await savePm(u.id, { scheduleName: "TEST_ONLY Pat", builders: ["WDW_TEST_ONLY Hildy", " "], crews: [] });
    const s = (await pmScope(u.id))!;
    expect(s.builders).toEqual(["WDW_TEST_ONLY Hildy"]);
    const mine = await prisma.prodLine.findMany({ where: { AND: [{ builder: { startsWith: "WDW_TEST_ONLY" } }, mineWhere(s)] }, orderBy: { location: "asc" } });
    expect(mine.map((l) => l.location)).toEqual(["1 Test St", "3 Test St"]);

    const sq = await dashboardSchedules({ userId: u.id, userName: u.name, view: "ALL" });
    expect(sq.pm).toBe(true);
    expect(sq.pc).toBe("mine");
    expect(sq.esTabs[0][0]).toBe("mine");
    expect(sq.lines.every((l) => l.location !== "2 Test St")).toBe(true);
  });

  it("saves crew scopes and keeps the trade text in step", async () => {
    const c = await prisma.crew.create({ data: { name: "WDW_TEST_ONLY Crew Z" } });
    await saveCrewScopes(c.id, ["Siding", "Gutters", "Siding", ""]);
    const back = await prisma.crew.findUniqueOrThrow({ where: { id: c.id } });
    expect(back.scopes).toEqual(["Siding", "Gutters"]);
    expect(back.trade).toBe("Siding, Gutters");
  });
});
