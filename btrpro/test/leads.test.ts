// TEST_ONLY lead follow-through: call task marks first contact, standard lost reasons, win-back list.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { changeStage, createProject } from "@/lib/projects/service";
import { setTaskDone } from "@/lib/tasks/service";
import { winBackList } from "@/lib/reports/win-loss";

afterAll(() => prisma.$disconnect());

describe("leads", () => {
  it("finishing the call task records first contact", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await createProject({ name: "TEST_ONLY call me", scopes: [], isPublic: false, isTaxExempt: false }, a);
    const t = await prisma.task.create({ data: { projectId: p.id, title: "Call new lead: TEST_ONLY", assigneeId: a.id, auto: "LEAD:call", dueDate: new Date() } });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).firstContactAt).toBeNull();
    await setTaskDone(t.id, true, { ...a, role: "ADMIN" });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).firstContactAt).not.toBeNull();
  });

  it("a job lost on price goes on the win-back list with its reason", async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await createProject({ name: "TEST_ONLY lost on price", scopes: [], isPublic: false, isTaxExempt: false }, a);
    await changeStage(p.id, "LOST", { reason: "Price: TEST_ONLY $900 cheaper", lostCategory: "Price" }, a);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ lostCategory: "Price", lostReason: "Price: TEST_ONLY $900 cheaper" });
    expect((await winBackList()).some((j) => j.id === p.id)).toBe(true);
    const q = await createProject({ name: "TEST_ONLY lost DIY", scopes: [], isPublic: false, isTaxExempt: false }, a);
    await changeStage(q.id, "LOST", { reason: "Did it themselves", lostCategory: "Did it themselves" }, a);
    expect((await winBackList()).some((j) => j.id === q.id)).toBe(false);
  });
});
