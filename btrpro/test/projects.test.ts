// Project services against the seeded test DB, including acceptance test 11 (Form 17 banner).
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { changeStage, createProject, executeForm17, refreshReadiness, updateIntakeField, updateProjectDetails } from "@/lib/projects/service";
import { showForm17Banner } from "@/lib/projects/workflow";
import { companyKey, phoneKey } from "@/lib/customers";

afterAll(() => prisma.$disconnect());
const actor = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name };
};

describe("createProject", () => {
  it("builds the intake checklist from the job's scopes and fills synced fields", async () => {
    const p = await createProject(
      { name: "TEST_ONLY Reroof", address: "123 Test St, Omaha NE", constructionType: "REROOF", scopes: ["STEEP"], isPublic: false, isTaxExempt: false },
      await actor(),
    );
    const intake = await prisma.intakeField.findMany({ where: { projectId: p.id } });
    expect(intake).toHaveLength(20);
    const f = (k: string) => intake.find((x) => x.key === k)!;
    expect(f("location")).toMatchObject({ status: "VERIFIED", value: "123 Test St, Omaha NE" });
    expect(f("construction_type")).toMatchObject({ status: "VERIFIED", value: "Reroof" });
    expect(f("roof_area").status).toBe("MISSING");
    expect(f("siding_type").status).toBe("NOT_APPLICABLE");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).readiness).toBe("NOT_READY");
    expect(await prisma.projectActivity.count({ where: { projectId: p.id, kind: "created" } })).toBe(1);
  });

  it("requires a value and a note for assumptions", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Assume", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
    await expect(updateIntakeField(p.id, "roof_slope", { value: "6/12", unit: null, status: "ASSUMED", note: null }, a)).rejects.toThrow(
      /NOT FOR FINAL BID/,
    );
    await updateIntakeField(p.id, "roof_slope", { value: "6/12", unit: null, status: "ASSUMED", note: "From street photos" }, a);
    const f = await prisma.intakeField.findUniqueOrThrow({ where: { projectId_key: { projectId: p.id, key: "roof_slope" } } });
    expect(f).toMatchObject({ status: "ASSUMED", value: "6/12", note: "From street photos", approvedBy: a.name });
  });
});

describe("acceptance test 11 — Form 17", () => {
  it("a public + tax-exempt job shows the Form 17 banner until it's marked EXECUTED, and can't be scheduled before", async () => {
    const a = await actor();
    const p = await createProject(
      { name: "TEST_ONLY County Garage", scopes: ["LOW_SLOPE"], isPublic: true, isTaxExempt: true },
      a,
    );
    let row = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.form17Status).toBe("PENDING");
    expect(showForm17Banner(row)).toBe(true);

    await updateProjectDetails(p.id, { contractAmount: 1, contractSignedAt: new Date() }, a);
    await prisma.project.update({ where: { id: p.id }, data: { status: "SOLD" } });
    await expect(changeStage(p.id, "SCHEDULED", {}, a)).rejects.toThrow(/Form 17/);

    await executeForm17(p.id, { executedAt: new Date("2026-09-29T00:00:00Z"), note: "Signed by county facilities director" }, a);
    row = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.form17Status).toBe("EXECUTED");
    expect(showForm17Banner(row)).toBe(false);
    await changeStage(p.id, "SCHEDULED", {}, a);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("SCHEDULED");
  });

  it("turning off tax-exempt clears the requirement; turning it back on makes it pending again", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Park", scopes: ["STEEP"], isPublic: true, isTaxExempt: false }, a);
    expect(p.form17Status).toBe("NOT_REQUIRED");
    expect((await updateProjectDetails(p.id, { isTaxExempt: true }, a)).form17Status).toBe("PENDING");
    expect((await updateProjectDetails(p.id, { isTaxExempt: false }, a)).form17Status).toBe("NOT_REQUIRED");
  });
});

describe("readiness from the database", () => {
  it("reaches BUDGET or BID_READY only once intake and estimate lines are clean", async () => {
    const a = await actor();
    const p = await createProject({ name: "TEST_ONLY Readiness", scopes: ["SIDING"], constructionType: "NEW", address: "1 A St", buildingUse: "Residential", isPublic: false, isTaxExempt: false }, a);
    const missing = await prisma.intakeField.findMany({ where: { projectId: p.id, status: "MISSING" } });
    for (const f of missing) await updateIntakeField(p.id, f.key, { value: "TEST_ONLY", unit: null, status: "VERIFIED", note: null }, a);

    const est = await prisma.estimate.create({ data: { projectId: p.id, name: "Rev 1", scopeType: "SIDING", wasteApproved: true } });
    const plank = await prisma.priceItem.findFirstOrThrow({ where: { itemNumber: "25H5KEC8", sheet: { isActive: true } } });
    await prisma.estimateLine.create({
      data: { estimateId: est.id, section: "MATERIAL_SIDING", itemName: plank.description, priceItemId: plank.id, sourceStatus: "PENDING_AI" },
    });
    await prisma.laborLine.create({ data: { estimateId: est.id, task: "TEST_ONLY install", sourceStatus: "VERIFIED" } });
    expect((await refreshReadiness(p.id)).readiness).toBe("NOT_READY");
    await prisma.estimateLine.updateMany({ where: { estimateId: est.id }, data: { sourceStatus: "PLACEHOLDER" } });
    expect((await refreshReadiness(p.id)).readiness).toBe("BUDGET");
    await prisma.estimateLine.updateMany({ where: { estimateId: est.id }, data: { sourceStatus: "VERIFIED" } });
    expect((await refreshReadiness(p.id)).readiness).toBe("BID_READY");
  });
});

describe("customers", () => {
  it("normalizes phone numbers for duplicate detection", () => {
    expect(phoneKey("(402) 739-9811")).toBe("4027399811");
    expect(phoneKey("+1 402.739.9811")).toBe("4027399811");
    expect(phoneKey("ext 12")).toBeNull();
  });
  it("matches company names regardless of order, punctuation, and suffixes", () => {
    expect(companyKey("The Weitz Company, LLC")).toBe(companyKey("weitz co"));
    expect(companyKey("Sarpy County Facilities, TEST_ONLY")).toBe(companyKey("TEST_ONLY Sarpy County Facilities"));
    expect(companyKey("Kiewit Building Group")).not.toBe(companyKey("Kiewit"));
  });
});

describe("residential jobs", () => {
  it("adds the homeowner as the primary contact and reuses an existing contact with the same phone", async () => {
    const a = await actor();
    const base = { market: "RESIDENTIAL" as const, scopes: ["STEEP" as const], isPublic: false, isTaxExempt: false };
    const p1 = await createProject({ ...base, name: "TEST_ONLY Johnson hail", isInsuranceClaim: true, claimNumber: "TEST-1" }, a, {
      firstName: "Dana",
      lastName: "Johnson",
      phone: "(402) 555-0142",
    });
    const pc = await prisma.projectContact.findFirstOrThrow({ where: { projectId: p1.id }, include: { contact: true } });
    expect(pc).toMatchObject({ role: "HOMEOWNER", isPrimary: true, contact: { firstName: "Dana", phoneKey: "4025550142" } });

    const p2 = await createProject({ ...base, name: "TEST_ONLY Johnson gutters" }, a, { firstName: "D", lastName: "Johnson", phone: "402.555.0142" });
    const pc2 = await prisma.projectContact.findFirstOrThrow({ where: { projectId: p2.id } });
    expect(pc2.contactId).toBe(pc.contactId);
  });

  it("can't be tax-exempt", async () => {
    await expect(
      createProject({ name: "TEST_ONLY x", market: "RESIDENTIAL", scopes: ["STEEP"], isPublic: false, isTaxExempt: true }, await actor()),
    ).rejects.toThrow(/can't be tax-exempt/);
  });
});
