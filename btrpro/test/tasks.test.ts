import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { changeStage, createProject } from "@/lib/projects/service";
import {
  addTask,
  createStageTasks,
  reminders,
  setTaskDone,
} from "@/lib/tasks/service";
import { closeRate, pipeline } from "@/lib/reports/sales";

afterAll(() => prisma.$disconnect());
const DAY = 86_400_000;
const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};

describe("tasks", () => {
  it("moving a job to Submitted creates a follow-up for the salesperson, once", async () => {
    const a = await admin();
    const p = await createProject(
      {
        name: "TEST_ONLY Tasks job",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        salespersonId: a.id,
      },
      a,
    );
    await changeStage(p.id, "ESTIMATING", {}, a);
    await changeStage(
      p.id,
      "SUBMITTED",
      { override: true, reason: "TEST_ONLY" },
      a,
    ).catch(() => changeStage(p.id, "SUBMITTED", {}, a));
    const t = await prisma.task.findMany({ where: { projectId: p.id } });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      title: "Follow up on the bid / proposal",
      assigneeId: a.id,
      auto: "SUBMITTED:follow-up-bid",
    });
    expect(Math.round((t[0].dueDate!.getTime() - Date.now()) / DAY)).toBe(3);
    // re-entering the stage doesn't repeat it, even after it's done
    await setTaskDone(t[0].id, true, a);
    const again = await prisma.project.findUniqueOrThrow({
      where: { id: p.id },
    });
    await createStageTasks(again, "SUBMITTED", a);
    expect(await prisma.task.count({ where: { projectId: p.id } })).toBe(1);
  });

  it("Sold on a public tax-exempt job adds the Form 17 task; residential adds the deposit invoice", async () => {
    const a = await admin();
    const pub = {
      id: "x-pub",
      salespersonId: null,
      estimatorId: a.id,
      market: "COMMERCIAL",
      isPublic: true,
      isTaxExempt: true,
      form17Status: "PENDING",
    };
    const p1 = await createProject(
      {
        name: "TEST_ONLY Public",
        scopes: ["LOW_SLOPE"],
        isPublic: true,
        isTaxExempt: true,
        market: "COMMERCIAL",
      },
      a,
    );
    const made = await createStageTasks({ ...pub, id: p1.id }, "SOLD", a);
    expect(made.map((t) => t.auto)).toEqual([
      "SOLD:form17",
      "SOLD:order",
      "SOLD:schedule",
    ]);
    expect(made.find((t) => t.auto === "SOLD:form17")!.assigneeId).toBe(a.id); // no salesperson → estimator
    expect(made.find((t) => t.auto === "SOLD:schedule")!.assigneeId).toBeNull();
    const p2 = await createProject(
      {
        name: "TEST_ONLY Res",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        market: "RESIDENTIAL",
      },
      a,
    );
    const made2 = await createStageTasks(
      {
        id: p2.id,
        salespersonId: null,
        estimatorId: null,
        market: "RESIDENTIAL",
        isPublic: false,
        isTaxExempt: false,
        form17Status: "NOT_REQUIRED",
      },
      "SOLD",
      a,
    );
    expect(made2.map((t) => t.auto)).toContain("SOLD:deposit");
  });

  it("manual tasks need a title; viewers can't add them", async () => {
    const a = await admin();
    await expect(
      addTask(
        { projectId: null, title: " ", dueDate: null, assigneeId: null },
        a,
      ),
    ).rejects.toThrow(/What needs doing/);
    await expect(
      addTask(
        { projectId: null, title: "x", dueDate: null, assigneeId: null },
        { ...a, role: "VIEWER" },
      ),
    ).rejects.toThrow(/Viewers/);
  });
});

describe("reminders", () => {
  it("flags bids due soon and expired crew insurance", async () => {
    const a = await admin();
    const now = new Date();
    const p = await createProject(
      {
        name: "TEST_ONLY Bid tomorrow",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        bidDueDate: new Date(now.getTime() + DAY),
      },
      a,
    );
    const crew = await prisma.crew.create({
      data: {
        name: "TEST_ONLY Crew COI",
        coiExpires: new Date(now.getTime() - DAY),
      },
    });
    const r = await reminders({ id: a.id, role: "ADMIN" }, now);
    expect(r.find((x) => x.href === `/projects/${p.id}`)).toMatchObject({
      kind: "bid",
      urgent: true,
    });
    expect(r.find((x) => x.href === `/crews/${crew.id}`)).toMatchObject({
      kind: "coi",
      urgent: true,
    });
    expect(r.find((x) => x.text.includes("TEST_ONLY Crew COI"))!.text).toMatch(
      /expired/,
    );
  });
});

describe("sales dashboard", () => {
  it("close rate counts jobs moved to Sold vs Lost in the period", async () => {
    const a = await admin();
    const from = new Date(Date.now() - 1000);
    const won = await createProject(
      {
        name: "TEST_ONLY Won",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        salespersonId: a.id,
      },
      a,
    );
    const lost = await createProject(
      {
        name: "TEST_ONLY Lost",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        salespersonId: a.id,
      },
      a,
    );
    await prisma.project.update({
      where: { id: won.id },
      data: { contractAmount: 12000 },
    });
    for (const [id, to] of [
      [won.id, "SOLD"],
      [lost.id, "LOST"],
    ] as const)
      await prisma.projectActivity.create({
        data: {
          projectId: id,
          userId: a.id,
          kind: "stage",
          text: "TEST_ONLY",
          data: { from: "SUBMITTED", to },
        },
      });
    const c = await closeRate(from, new Date(Date.now() + 1000), null);
    expect(c).toMatchObject({ won: 1, lost: 1, rate: 50, sold: 12000 });
    expect(c.reps[0]).toMatchObject({
      name: a.name,
      won: 1,
      lost: 1,
      rate: 50,
      sold: 12000,
    });
    const pipe = await pipeline(null);
    expect(pipe.stages.map((s) => s.stage)).toEqual([
      "LEAD",
      "ESTIMATING",
      "SUBMITTED",
    ]);
  });
});
