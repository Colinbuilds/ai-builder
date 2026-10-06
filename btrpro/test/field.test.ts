// TEST_ONLY production follow-through: ready checklist, crew-reported issues.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { readyChecklist, reportIssue, resolveIssue, setReadyCheck } from "@/lib/production/field";

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

describe("office desk", () => {
  it("lists sold tax-exempt public jobs still missing Form 17", async () => {
    const { officeDesk } = await import("@/lib/desks");
    const { job } = await setup();
    await prisma.project.update({ where: { id: job.id }, data: { status: "SOLD", isPublic: true, isTaxExempt: true, form17Status: "PENDING" } });
    expect((await officeDesk()).form17.some((p) => p.id === job.id)).toBe(true);
    await prisma.project.update({ where: { id: job.id }, data: { form17Status: "EXECUTED" } });
    expect((await officeDesk()).form17.some((p) => p.id === job.id)).toBe(false);
  });
});

describe("extra work tags", () => {
  it("logs hours, materials and a signature, prices into a change order, and ages on the desk", async () => {
    const { logExtraWork, priceTag, extrasDesk, tagSummary } = await import("@/lib/production/field");
    const { a, crew, job } = await setup();
    const who = { crewId: crew.id, name: crew.name };
    await prisma.workOrder.create({ data: { projectId: job.id, crewId: crew.id, number: `WO-T-${Math.random().toString(36).slice(2, 8)}`, token: Math.random().toString(36).slice(2), createdBy: "t" } });
    const base = { note: "TEST_ONLY added cricket behind chimney", workDate: new Date(Date.now() - 10 * 86_400_000), men: 2, hours: 6, materials: "2 sheets OSB", directedBy: "TEST_ONLY super", signerName: null, signatureImage: null };
    await expect(logExtraWork(who, job.id, base, [])).rejects.toThrow(/photo or get the super/);
    await expect(logExtraWork(who, job.id, { ...base, signatureImage: "data:image/png;base64,AAAA" }, [])).rejects.toThrow(/name/);
    await expect(logExtraWork(who, job.id, { ...base, hours: -1 }, [{ bytes: PNG, name: "a.png" }])).rejects.toThrow(/man-hours/);
    const tag = await logExtraWork(who, job.id, { ...base, signerName: "TEST_ONLY Sam", signatureImage: "data:image/png;base64,AAAA" }, []);
    expect(tag.kind).toBe("EXTRA");
    expect(tag.signedAt).not.toBeNull();
    expect(tagSummary(tag)).toMatch(/2 workers, 6 man-hours.*Materials: 2 sheets OSB.*Signed on site by TEST_ONLY Sam/);

    let d = await extrasDesk();
    const row = d.rows.find((r) => r.id === tag.id)!;
    expect(row.stage).toBe("UNPRICED");
    expect(row.days).toBe(10);
    expect(d.oldestUnpriced).toBeGreaterThanOrEqual(10);

    const co = await priceTag(tag.id, { amount: 640, costImpact: 300, description: null }, a);
    expect(co.status).toBe("PENDING");
    expect(co.description).toMatch(/cricket/);
    expect(await prisma.task.count({ where: { auto: `ISSUE:${tag.id}`, doneAt: null } })).toBe(0);
    await expect(priceTag(tag.id, { amount: 1, costImpact: null, description: null }, a)).rejects.toThrow(/already/);
    d = await extrasDesk();
    expect(d.rows.find((r) => r.id === tag.id)?.stage).toBe("AWAITING_SIGNATURE");

    await prisma.changeOrder.update({ where: { id: co.id }, data: { status: "APPROVED" } });
    expect((await extrasDesk()).rows.some((r) => r.id === tag.id)).toBe(false);
  });
});
