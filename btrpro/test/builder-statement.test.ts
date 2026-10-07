// TEST_ONLY builder statement: schedule lines (billed as text) and invoices, by month, with what's still owed.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { builderStatement, dateIn, statementCsv } from "@/lib/builders/statement";

const NAME = "QS Statement Homes";
afterAll(async () => {
  await prisma.prodLine.deleteMany({ where: { builder: { startsWith: NAME } } });
  await prisma.company.deleteMany({ where: { name: NAME } });
  await prisma.$disconnect();
});

describe("builder statement", () => {
  it("reads billed / paid dates out of the schedule's text", () => {
    expect(dateIn("x 10/1/26")?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(dateIn("Billed 9-17-2026 Jo")?.toISOString().slice(0, 10)).toBe("2026-09-17");
    expect(dateIn("x")).toBeNull();
    expect(dateIn("13/40/26")).toBeNull();
  });
  it("billed this month, paid this month, still owed — subdivisions roll up to the builder", async () => {
    const co = await prisma.company.create({ data: { name: NAME, type: "BUILDER" } });
    const mk = (builder: string, location: string, sell: number, billed: string | null, btrPaid: string | null) =>
      prisma.prodLine.create({ data: { market: "RESIDENTIAL", board: "CURRENT", builder, location, type: "Roofing", sell, billed, btrPaid } });
    await mk(`${NAME} Lakeview`, "TEST_ONLY 1 Elm", 1000, "x 10/2/26", null); // billed Oct, owed
    await mk(NAME, "TEST_ONLY 2 Elm", 500, "x 9/10/26", "Paid 10/5/26"); // billed Sep, paid Oct
    await mk(NAME, "TEST_ONLY 3 Elm", 250, "x 7/1/26", null); // old, owed 90+ by end of Oct
    await mk(NAME, "TEST_ONLY 4 Elm", 99, null, null); // not billed: not on the statement
    await mk("TEST_ONLY Other Builder", "TEST_ONLY 5 Elm", 777, "x 10/3/26", null); // someone else
    const s = await builderStatement(co.id, "2026-10");
    expect(s.billed.map((r) => r.where)).toEqual(["TEST_ONLY 1 Elm"]);
    expect(s.paid.map((r) => r.where)).toEqual(["TEST_ONLY 2 Elm"]);
    expect(s.open.map((r) => r.where)).toEqual(["TEST_ONLY 3 Elm", "TEST_ONLY 1 Elm"]);
    expect(s.totals).toEqual({ billed: 1000, paid: 500, open: 1250 });
    expect(s.aging["90+"]).toBe(250);
    expect(s.open[1].what).toBe(`${NAME} Lakeview · Roofing`);
    expect(statementCsv(s).split("\n")).toHaveLength(1 + 1 + 1 + 2);
    // September: the Oct-billed house isn't owed yet then
    const sep = await builderStatement(co.id, "2026-09");
    expect(sep.open.map((r) => r.where)).toEqual(["TEST_ONLY 3 Elm", "TEST_ONLY 2 Elm"]);
  });
});
