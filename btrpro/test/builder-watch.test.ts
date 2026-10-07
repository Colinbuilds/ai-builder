// TEST_ONLY nightly builder checks: plan-book sync from the Google Sheet, and houses running over plan.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { importPlanBook, saveTakeoffEdit } from "@/lib/builders/planbook";
import { createHouseJob } from "@/lib/builders/house";
import { housesOverPlan, syncPlanBooks } from "@/lib/builders/watch";
import { toXlsx, workbook } from "./fixtures/plan-book";

const NAME = "TEST_ONLY Watch Homes";
afterAll(async () => {
  const co = await prisma.company.findMany({ where: { name: NAME }, select: { id: true } });
  await prisma.task.deleteMany({ where: { OR: [{ auto: { startsWith: "PLANBOOK:held:" } }, { auto: { startsWith: "HOUSE:over:" } }] } });
  await prisma.prodLine.deleteMany({ where: { builder: NAME } });
  await prisma.project.deleteMany({ where: { clientCompanyId: { in: co.map((c) => c.id) } } });
  await prisma.company.deleteMany({ where: { name: NAME } });
  await prisma.$disconnect();
});

describe("nightly builder checks", () => {
  it("re-imports a plan book when its sheet changed, but holds it when BTRpro has edits", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: admin.id, name: "TEST_ONLY watch", role: "ADMIN" };
    const co = await prisma.company.create({ data: { name: NAME, type: "BUILDER" } });
    const bytes = await toXlsx(workbook());
    const link = "https://docs.google.com/spreadsheets/d/TEST_ONLY_watch_sheet/edit";
    const { book } = await importPlanBook(co.id, { bytes, link, label: "Metro" }, actor);
    let modified = new Date(book.importedAt.getTime() - 60_000);
    const deps = { modified: async () => modified, download: async () => bytes };
    // first look: the sheet is older than the import — just remember its time
    let r = await syncPlanBooks(deps);
    expect(r.updated).not.toContain(`${NAME} Metro`);
    expect((await prisma.builderPlanBook.findUniqueOrThrow({ where: { id: book.id } })).sourceModifiedAt?.getTime()).toBe(modified.getTime());
    // the sheet changes → a new version
    modified = new Date(Date.now() + 60_000);
    r = await syncPlanBooks(deps);
    expect(r.updated).toContain(`${NAME} Metro`);
    const active = await prisma.builderPlanBook.findFirstOrThrow({ where: { companyId: co.id, active: true } });
    expect(active.id).not.toBe(book.id);
    expect(active.importedBy).toBe("Sheet sync");
    // an edit in BTRpro, then the sheet changes again → held, the office is told once
    await saveTakeoffEdit(active.id, "TEST_ONLY Aspen", "ROOFING", "A", [{ name: "TEST_ONLY Shingle", qty: 31 }, { name: "TEST_ONLY Starter", qty: 2 }], 30, actor);
    modified = new Date(Date.now() + 120_000);
    r = await syncPlanBooks(deps);
    expect(r.heldForEdits).toContain(`${NAME} Metro`);
    expect((await prisma.builderPlanBook.findFirstOrThrow({ where: { companyId: co.id, active: true } })).id).toBe(active.id);
    expect(await prisma.task.count({ where: { auto: { startsWith: `PLANBOOK:held:${active.id}` } } })).toBeGreaterThan(0);

    // a house whose costs run past the plan
    const { project } = await createHouseJob(active.id, "TEST_ONLY Aspen", { elevation: "A", garage: "2", basement: "STANDARD", porch: false }, { address: "TEST_ONLY 9 Watch Ln", trades: ["ROOFING"] }, actor);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const planned = p.contractAmount!; // sell is above cost; costs of the full sell are surely over plan
    await prisma.jobCost.create({ data: { projectId: project.id, category: "MATERIALS", date: new Date(), vendor: "TEST_ONLY", description: "TEST_ONLY shingles", amount: planned } as never });
    expect(await housesOverPlan()).toContain(p.name);
    expect(await housesOverPlan()).not.toContain(p.name); // only once
  });
});
