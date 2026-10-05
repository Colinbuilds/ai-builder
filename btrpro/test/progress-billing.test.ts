// TEST_ONLY progress billing schedule: draws come due on job events, invoice amounts, % complete billing.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addChangeOrder, decideChangeOrder } from "@/lib/costing/service";
import { voidInvoice, type BillActor } from "@/lib/billing/service";
import { addSteps, billToPercent, invoiceStep, markStepReady, readyDraws, refreshSteps, scheduleWarnings } from "@/lib/billing/schedule";

afterAll(() => prisma.$disconnect());
const admin = async (): Promise<BillActor & { id: string }> => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" };
};
async function soldJob(contract: number) {
  const a = await admin();
  const p = await createProject({ name: "TEST_ONLY progress billing", scopes: ["STEEP"], isPublic: false, isTaxExempt: false, market: "RESIDENTIAL" }, a);
  await prisma.project.update({ where: { id: p.id }, data: { status: "SOLD", contractAmount: contract, contractSignedAt: new Date() } });
  return { a, p };
}

describe("progress billing schedule", () => {
  it("brings each draw due on its job event and bills the right amount", async () => {
    const { a, p } = await soldJob(30_000);
    await expect(addSteps(p.id, [{ label: "Deposit", basis: "PERCENT", pct: 0, trigger: "SIGNED" }], a)).rejects.toThrow(/% of the contract/);
    await addSteps(
      p.id,
      [
        { label: "Deposit", basis: "PERCENT", pct: 30, trigger: "SIGNED" },
        { label: "Material delivery", basis: "PERCENT", pct: 40, trigger: "MATERIALS_DELIVERED" },
        { label: "Punch walk", basis: "AMOUNT", amount: 1000, trigger: "MANUAL" },
        { label: "Final", basis: "REMAINDER", trigger: "COMPLETED" },
      ],
      a,
    );
    let steps = await prisma.billingStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } });
    // signed already → deposit is ready, with a task; the rest wait
    expect(steps.map((s) => s.status)).toEqual(["READY", "PLANNED", "PLANNED", "PLANNED"]);
    expect(await prisma.task.count({ where: { auto: `BILLSTEP:${steps[0].id}` } })).toBe(1);
    expect((await readyDraws()).some((d) => d.id === steps[0].id)).toBe(true);

    const dep = await invoiceStep(steps[0].id, a);
    expect(dep).toMatchObject({ kind: "DEPOSIT", subtotal: 9000 });
    expect(await prisma.task.count({ where: { auto: `BILLSTEP:${steps[0].id}`, doneAt: null } })).toBe(0);
    await expect(invoiceStep(steps[0].id, a)).rejects.toThrow(/already invoiced/);

    // materials delivered → draw 2 comes due; a change order raises the contract it's figured on
    await prisma.materialOrder.create({ data: { projectId: p.id, number: `PO-TEST-${Math.random().toString(36).slice(2, 8)}`, status: "DELIVERED", supplier: "TEST_ONLY ABC", createdBy: "t" } as never });
    const co = await addChangeOrder(p.id, { kind: "CHANGE_ORDER", description: "TEST_ONLY extra layer", amount: 2000, costImpact: null, source: null }, a);
    await decideChangeOrder(co.id, "APPROVED", a);
    await refreshSteps(p.id);
    steps = await prisma.billingStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } });
    expect(steps[1].status).toBe("READY");
    const d2 = await invoiceStep(steps[1].id, a);
    expect(d2).toMatchObject({ kind: "PROGRESS", subtotal: 12800 }); // 40% of 32,000

    // manual draw: the PM marks it ready
    await markStepReady(steps[2].id);
    expect((await invoiceStep(steps[2].id, a)).subtotal).toBe(1000);

    // voiding a draw's invoice puts the draw back to ready
    await voidInvoice(d2.id, "TEST_ONLY wrong", a);
    await refreshSteps(p.id);
    expect((await prisma.billingStep.findUniqueOrThrow({ where: { id: steps[1].id } })).status).toBe("READY");
    await invoiceStep(steps[1].id, a);

    // job complete → final bills exactly what's left
    await prisma.project.update({ where: { id: p.id }, data: { status: "COMPLETE" } });
    await refreshSteps(p.id);
    const fin = await invoiceStep(steps[3].id, a);
    expect(fin).toMatchObject({ kind: "FINAL", subtotal: 32_000 - 9000 - 12_800 - 1000 });
  });

  it("bills by % complete and warns when draws don't add up", async () => {
    const { a, p } = await soldJob(50_000);
    const inv = await billToPercent(p.id, 40, a);
    expect(inv.subtotal).toBe(20_000);
    expect((await billToPercent(p.id, 65, a)).subtotal).toBe(12_500);
    await expect(billToPercent(p.id, 60, a)).rejects.toThrow(/Nothing more to bill/);
    expect(scheduleWarnings([{ basis: "PERCENT", pct: 50, status: "PLANNED" }, { basis: "PERCENT", pct: 40, status: "PLANNED" }])[0]).toMatch(/90% of the contract/);
    expect(scheduleWarnings([{ basis: "PERCENT", pct: 50, status: "PLANNED" }, { basis: "REMAINDER", pct: null, status: "PLANNED" }])).toEqual([]);
  });
});
