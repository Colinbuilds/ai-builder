import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import {
  deleteBlocker,
  deleteProject,
  deleteProjects,
} from "@/lib/projects/delete";
import {
  createInvoice,
  recordPayment,
  sendInvoice,
} from "@/lib/billing/service";

afterAll(() => prisma.$disconnect());

const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};
const job = async (name: string) => {
  const a = await admin();
  return createProject(
    {
      name,
      scopes: ["STEEP"],
      address: "1 TEST_ONLY Rd",
      isPublic: false,
      isTaxExempt: false,
    },
    a,
  );
};

describe("deleting jobs", () => {
  it("deletes a job and everything on it after the name is typed; logs it", async () => {
    const a = await admin();
    const p = await job("TEST_ONLY Delete me");
    await prisma.task.create({
      data: { projectId: p.id, title: "TEST_ONLY task" },
    });
    await prisma.proposal.create({
      data: {
        projectId: p.id,
        estimateId: "x",
        number: `TEST-${p.id}`,
        title: "t",
        token: `tok-${p.id}`,
        costTotal: 1,
        markupPct: 0,
        basePrice: 1,
        scope: { weWill: [], weWillNot: [] },
        terms: "TEST_ONLY",
      },
    });
    expect(await prisma.proposal.count({ where: { projectId: p.id } })).toBe(1);
    await expect(deleteProject(p.id, "wrong name", a)).rejects.toThrow(
      /Type the job's name/,
    );
    await expect(
      deleteProject(p.id, "TEST_ONLY Delete me", { ...a, role: "ESTIMATOR" }),
    ).rejects.toThrow(/Only an Admin/);
    await deleteProject(p.id, "  test_only delete ME ", a);
    expect(await prisma.project.findUnique({ where: { id: p.id } })).toBeNull();
    expect(await prisma.task.count({ where: { projectId: p.id } })).toBe(0);
    expect(await prisma.intakeField.count({ where: { projectId: p.id } })).toBe(
      0,
    );
    expect(await prisma.proposal.count({ where: { projectId: p.id } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "Project", entityId: p.id, action: "delete" },
    });
    expect((log.before as { name: string }).name).toBe("TEST_ONLY Delete me");
  });

  it("keeps jobs with money received; bulk delete skips them with the reason", async () => {
    const a = await admin();
    const paid = await job("TEST_ONLY Paid job");
    await prisma.project.update({
      where: { id: paid.id },
      data: {
        status: "SOLD",
        contractAmount: 1000,
        contractSignedAt: new Date(),
      },
    });
    const inv = await createInvoice(
      paid.id,
      { kind: "PROGRESS", lines: [{ description: "TEST_ONLY", amount: 500 }] },
      a,
    );
    await sendInvoice(inv.id, { name: null, email: null }, a);
    await recordPayment(
      inv.id,
      { date: new Date(), amount: 100, method: "CASH", reference: null },
      a,
    );
    expect(await deleteBlocker(paid.id)).toMatch(/payment/);
    const junk = await job("TEST_ONLY Junk import");
    const r = await deleteProjects([paid.id, junk.id], a);
    expect(r.deleted).toEqual(["TEST_ONLY Junk import"]);
    expect(r.skipped[0]).toMatch(/TEST_ONLY Paid job: 1 payment is recorded/);
    expect(
      await prisma.project.findUnique({ where: { id: paid.id } }),
    ).not.toBeNull();
  });
});
