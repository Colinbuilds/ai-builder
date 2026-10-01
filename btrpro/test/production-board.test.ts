// TEST_ONLY production board + AIA pay applications
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Tab } from "@/lib/import/xlsx";
import { parseProductionWorkbook } from "@/lib/production/sheet";
import { applyProdRows, stepProdLine, syncCrewList } from "@/lib/production/board";
import { newPayApp, parseAiaTab, payAppPdf, payTotals, savePayAppLines, setPayAppStatus } from "@/lib/billing/payapps";

afterAll(() => prisma.$disconnect());
const HDR = ["Date Added", "Estimate #", "Builder", "Address ", "Model", "Type", "Crew ", "Super ", "Sales Rep", "Notes ", "Completed", "Pay out", "Sell", "Paid/Approved", "Billed ", "BTR Paid", "Billing Notes"];

describe("schedule sheets", () => {
  it("reads residential builder tabs with sections, and commercial project blocks", () => {
    const res: Tab = { name: "Hildy", rows: [HDR, ["Hildy Upcoming"], ["", "", "TEST_ONLY Hildy", "1 Test St", "", "Gutters", "", "TEST_ONLY Super", "House"], ["Hildy Siding"], ["46280", "est 1", "TEST_ONLY Hildy", "2 Test St", "Sienna", "Siding Labor", "TEST_ONLY Crew", "TEST_ONLY Super", "House", "", "", "4869.12", "6672.65"]] };
    const r = parseProductionWorkbook([res, { name: "Crew (data_source)", rows: [["x"]] }], "RESIDENTIAL").rows;
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ board: "UPCOMING", section: "Hildy Upcoming", location: "1 Test St" });
    expect(r[1]).toMatchObject({ board: "CURRENT", section: "Hildy Siding", model: "Sienna", payout: 4869.12, sell: 6672.65, estimateNo: "est 1" });
    const comm: Tab = {
      name: "Current - Jarrod",
      rows: [
        ["Project ", "Builder", "Address ", "Type", "Crew ", "Total Payout", "Total Paid to Date", "Payout this Week", "Remaining Payout", "Sell", "Super ", "Sales Rep", "Notes "],
        ["Jarrod"],
        ["TEST_ONLY GC - Rows", "", "", "", "", "100", "50", "0", "50"],
        ["", "TEST_ONLY GC - Rows", "Building 1", "Siding", "TEST_ONLY Crew", "100", "50", "", "50", "150", "TEST_ONLY Super", "House"],
        ["", "", "", "", "", "", "", "", "0"],
      ],
    };
    const c = parseProductionWorkbook([comm], "COMMERCIAL").rows;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ grp: "Jarrod", project: "TEST_ONLY GC - Rows", location: "Building 1", payout: 100, paidToDate: 50, sell: 150 });
  });

  it("Completed notifies the office that the crew can be paid; Crew paid clears it", async () => {
    await prisma.prodLine.deleteMany({ where: { builder: { startsWith: "TEST_ONLY" } } });
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const rows = parseProductionWorkbook([{ name: "Hildy", rows: [HDR, ["", "", "TEST_ONLY Hildy", "3 Test St", "", "Gutters", "TEST_ONLY Crew", "", "", "", "", "900", "1200"]] }], "RESIDENTIAL").rows;
    expect((await applyProdRows("RESIDENTIAL", rows)).added).toBe(1);
    const l = await prisma.prodLine.findFirstOrThrow({ where: { location: "3 Test St" } });
    await stepProdLine(l.id, "complete", a);
    expect(await prisma.task.count({ where: { auto: `PROD:pay:${l.id}`, doneAt: null } })).toBeGreaterThan(0);
    await stepProdLine(l.id, "approve", a);
    expect(await prisma.task.count({ where: { auto: `PROD:pay:${l.id}`, doneAt: null } })).toBe(0);
    // an edited line survives the next sync
    expect((await applyProdRows("RESIDENTIAL", rows)).keptEdited).toBe(1);
    expect(await syncCrewList(["TEST_ONLY Siding LLC - Sam", "TEST_ONLY Siding LLC - Sam"])).toBeLessThanOrEqual(1);
  });
});

describe("AIA pay applications", () => {
  it("reads the AIAs tab, makes the next application, enforces scheduled values, and prints G702/G703", async () => {
    const tab: Tab = {
      name: "AIAs",
      rows: [
        ["General Contractor", "Project", "Contract Total"],
        ["Jarrod"],
        ["TEST_ONLY GC", "TEST_ONLY Project", "3000", "1000", "0", "", "1000", "0.33", "2000", "0", "Procore"],
        ["ITEM", "DESCRIPTION OF WORK", "SCHEDULED"],
        ["1.", "Siding Labor", "1000", "1000", "", "", "1000", "1", "0"],
        ["2.", "Siding Material", "2000", "", "", "", "0", "0", "2000"],
        ["", "TOTALS", "3000"],
        ["TEST_ONLY Project echo"],
        ["Pending CCO Requests", "Change Order Description"],
      ],
    };
    const [c] = parseAiaTab(tab);
    expect(c).toMatchObject({ gc: "TEST_ONLY GC", superName: "Jarrod", submitVia: "Procore" });
    expect(c.lines).toHaveLength(2);
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const pc = await prisma.payContract.create({ data: { project: "TEST_ONLY Project", gc: "TEST_ONLY GC", lines: c.lines } });
    await expect(newPayApp(pc.id, new Date(), a)).rejects.toThrow(/retainage/);
    await prisma.payContract.update({ where: { id: pc.id }, data: { retainagePct: 10 } });
    const app = await newPayApp(pc.id, new Date("2026-10-20"), a);
    expect(app.number).toBe(1);
    await expect(savePayAppLines(app.id, [{ item: "2", thisPeriod: 2500, stored: 0 }])).rejects.toThrow(/more than the scheduled/);
    const saved = await savePayAppLines(app.id, [{ item: "2", thisPeriod: 500, stored: 250 }]);
    const t = payTotals(saved.lines as never, 10);
    expect(t).toMatchObject({ completed: 1750, retainage: 175, earnedLessRet: 1575, balance: 1250 });
    expect((await payAppPdf(app.id)).length).toBeGreaterThan(1000);
    await setPayAppStatus(app.id, "SUBMITTED");
    const next = await newPayApp(pc.id, new Date("2026-11-20"), a);
    expect(next.number).toBe(2);
    expect((next.lines as { item: string; previous: number }[]).find((l) => l.item === "2")?.previous).toBe(750);
  });
});
