// TEST_ONLY production follow-through: ready checklist, punch list, crew-reported issues, final walkthrough.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { addPunch, completeJob, readyChecklist, reportIssue, resolveIssue, setPunchDone, setReadyCheck, walkthrough } from "@/lib/production/field";

afterAll(() => prisma.$disconnect());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function setup() {
  const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const crew = await prisma.crew.create({ data: { name: `TEST_ONLY field ${Math.random().toString(36).slice(2, 7)}`, kind: "SUB" } });
  const job = await createProject({ name: "TEST_ONLY field job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
  return { a, crew, job };
}

describe("ready to schedule", () => {
  it("warns on what's missing and keeps manual checks", async () => {
    const { a, job } = await setup();
    let items = await readyChecklist(job.id);
    expect(items.find((i) => i.key === "contract")?.ok).toBe(false);
    expect(items.find((i) => i.key === "crew")?.detail).toMatch(/No install/);
    expect(items.find((i) => i.key === "permit")?.ok).toBe(false);
    await setReadyCheck(job.id, "permit", true, a);
    items = await readyChecklist(job.id);
    expect(items.find((i) => i.key === "permit")?.ok).toBe(true);
    await expect(setReadyCheck(job.id, "bogus", true, a)).rejects.toThrow(/Unknown/);
  });
});

describe("field issues", () => {
  it("a crew report needs a note and photo, makes a task, and resolving closes it", async () => {
    const { a, crew, job } = await setup();
    const who = { crewId: crew.id, name: crew.name };
    await expect(reportIssue(who, job.id, "rot", [{ bytes: PNG, name: "a.png" }])).rejects.toThrow(/assigned/);
    await prisma.workOrder.create({ data: { projectId: job.id, crewId: crew.id, number: `WO-T-${Math.random().toString(36).slice(2, 8)}`, token: Math.random().toString(36).slice(2), createdBy: "t" } });
    await expect(reportIssue(who, job.id, "", [{ bytes: PNG, name: "a.png" }])).rejects.toThrow(/Say what/);
    await expect(reportIssue(who, job.id, "rot", [])).rejects.toThrow(/photo/);
    const issue = await reportIssue(who, job.id, "TEST_ONLY rotted decking, about 6 sheets", [{ bytes: PNG, name: "a.png" }]);
    expect(await prisma.task.count({ where: { auto: `ISSUE:${issue.id}`, doneAt: null } })).toBe(1);
    expect(await prisma.projectActivity.count({ where: { projectId: job.id, kind: "crew" } })).toBe(1);
    await resolveIssue(issue.id, "PRICED", "CO-1 $540", a);
    expect(await prisma.task.count({ where: { auto: `ISSUE:${issue.id}`, doneAt: null } })).toBe(0);
    expect((await prisma.fieldIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("PRICED");
  });
});

describe("final walkthrough", () => {
  it("open punch items and unapproved photos hold it; a note completes anyway", async () => {
    const { a, crew, job } = await setup();
    await prisma.project.update({ where: { id: job.id }, data: { status: "IN_PRODUCTION", contractAmount: 10000, contractSignedAt: new Date() } });
    const punch = await addPunch(job.id, "TEST_ONLY reseal pipe boot", crew.id, a);
    let w = await walkthrough(job.id);
    expect(w.ready).toBe(false);
    await expect(completeJob(job.id, null, a)).rejects.toThrow(/punch list cleared/);
    await setPunchDone(punch.id, true, a);
    for (const stage of ["FINISHED", "CLEANUP"]) await prisma.jobPhoto.create({ data: { projectId: job.id, crewId: crew.id, uploadedBy: "t", stage, fileUrl: "local:x", contentType: "image/png", review: "OK" } });
    w = await walkthrough(job.id);
    expect(w.ready).toBe(true);
    await completeJob(job.id, null, a);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETE");
    expect(await prisma.task.count({ where: { projectId: job.id, auto: "COMPLETE:warranty" } })).toBe(1);
  });

  it("completes with open items when a note says why", async () => {
    const { a, job } = await setup();
    await prisma.project.update({ where: { id: job.id }, data: { status: "IN_PRODUCTION", contractAmount: 10000, contractSignedAt: new Date() } });
    await completeJob(job.id, "TEST_ONLY homeowner walked it with us", a);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETE");
  });
});
