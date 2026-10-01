// TEST_ONLY crews, jobs and photos.
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { checkCrewLogin, setCrewLogin } from "@/lib/crew/login";
import { addJobPhotos, crewJobs, reviewCrewInvoice, reviewPhoto, submitCrewInvoice } from "@/lib/crew/service";
import { signCrewSession, signSession, verifyCrewSession, verifySession } from "@/lib/session";

afterAll(() => prisma.$disconnect());

const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};
const jpg = () => sharp({ create: { width: 24, height: 16, channels: 3, background: "#888" } }).jpeg().toBuffer().then((b) => new Uint8Array(b));
const noon = (d: number) => new Date(Date.UTC(2026, 9, 1 + d, 12));

async function setup(kind: "CREW" | "SUB" = "CREW") {
  const a = await admin();
  const crew = await prisma.crew.create({ data: { name: `TEST_ONLY ${kind} ${Math.random().toString(36).slice(2, 7)}`, kind } });
  const job = await createProject({ name: "TEST_ONLY crew portal job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false, address: "12 TEST_ONLY St" }, a);
  const other = await createProject({ name: "TEST_ONLY someone else's job", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, a);
  await prisma.scheduleEvent.create({ data: { projectId: job.id, crewId: crew.id, kind: "INSTALL", title: "TEST_ONLY install", startDate: noon(0), endDate: noon(1), createdBy: "t" } });
  return { a, crew, job, other };
}

describe("crew portal login", () => {
  it("only an Admin sets it; the password is checked and never loaded by default", async () => {
    const { a, crew } = await setup();
    const email = `test_only_${crew.id}@example.com`;
    await expect(setCrewLogin(crew.id, { email, password: "longenough" }, { ...a, role: "ESTIMATOR" })).rejects.toThrow(/Admin/);
    await expect(setCrewLogin(crew.id, { email, password: "short" }, a)).rejects.toThrow(/8 characters/);
    await setCrewLogin(crew.id, { email: email.toUpperCase(), password: "longenough" }, a);
    expect((await checkCrewLogin(email, "longenough"))?.id).toBe(crew.id);
    expect(await checkCrewLogin(email, "wrong-password")).toBeNull();
    const loaded = (await prisma.crew.findUniqueOrThrow({ where: { id: crew.id } })) as Record<string, unknown>;
    expect(loaded.passwordHash).toBeUndefined();
    const other = await prisma.crew.create({ data: { name: "TEST_ONLY other crew" } });
    await expect(setCrewLogin(other.id, { email, password: "longenough" }, a)).rejects.toThrow(/already the login/);
    await setCrewLogin(crew.id, { email, password: null }, a);
    expect(await checkCrewLogin(email, "longenough")).toBeNull();
  });

  it("crew and staff sessions can't stand in for each other", async () => {
    const crewToken = await signCrewSession("crew_1");
    const staffToken = await signSession({ sub: "user_1", role: "ADMIN", name: "x" });
    expect(await verifySession(crewToken)).toBeNull();
    expect(await verifyCrewSession(staffToken)).toBeNull();
    expect((await verifyCrewSession(crewToken))?.crewId).toBe("crew_1");
    expect((await verifySession(staffToken))?.sub).toBe("user_1");
  });
});

describe("crew photos and invoices", () => {
  it("photos only on their own jobs, and only real images", async () => {
    const { crew, job, other } = await setup();
    const img = await jpg();
    await expect(addJobPhotos({ crewId: crew.id, name: crew.name }, other.id, "BEFORE", [{ bytes: img, name: "a.jpg" }], null)).rejects.toThrow(/isn't assigned/);
    await expect(addJobPhotos({ crewId: crew.id, name: crew.name }, job.id, "BEFORE", [{ bytes: new TextEncoder().encode("<html>"), name: "x.jpg" }], null)).rejects.toThrow(/isn't a photo/);
    await expect(addJobPhotos({ crewId: crew.id, name: crew.name }, job.id, "SELFIE", [{ bytes: img, name: "a.jpg" }], null)).rejects.toThrow(/what the photos show/);
    const saved = await addJobPhotos({ crewId: crew.id, name: crew.name }, job.id, "BEFORE", [{ bytes: img, name: "a.jpg" }], "TEST_ONLY note");
    expect(saved[0].contentType).toBe("image/jpeg");
    const [j] = (await crewJobs(crew.id)).filter((x) => x.id === job.id);
    expect(j.photos.BEFORE).toBe(1);
    expect(j.missing).toEqual(["FINISHED", "CLEANUP"]);
  });

  it("an invoice needs finished + cleanup photos, then the office approves it into costs", async () => {
    const { a, crew, job } = await setup("SUB");
    const inv = { projectId: job.id, invoiceNumber: "TEST-101", invoiceDate: noon(2), amount: 4200, description: "TEST_ONLY tear-off and install", file: null };
    await expect(submitCrewInvoice(crew.id, inv)).rejects.toThrow(/finished work and site cleanup photos/);
    const img = await jpg();
    await addJobPhotos({ crewId: crew.id, name: crew.name }, job.id, "FINISHED", [{ bytes: img, name: "f.jpg" }], null);
    await expect(submitCrewInvoice(crew.id, inv)).rejects.toThrow(/site cleanup photos/);
    const [cleanup] = await addJobPhotos({ crewId: crew.id, name: crew.name }, job.id, "CLEANUP", [{ bytes: img, name: "c.jpg" }], null);
    const sent = await submitCrewInvoice(crew.id, inv);
    expect(sent.status).toBe("SUBMITTED");
    await expect(submitCrewInvoice(crew.id, inv)).rejects.toThrow(/already sent invoice TEST-101/);

    await expect(reviewPhoto(cleanup.id, "ISSUE", null, a)).rejects.toThrow(/what's wrong/);
    expect((await reviewPhoto(cleanup.id, "ISSUE", "TEST_ONLY nails left in the driveway", a)).review).toBe("ISSUE");

    await expect(reviewCrewInvoice(sent.id, "REJECTED", null, a)).rejects.toThrow(/reason/);
    const cost = await reviewCrewInvoice(sent.id, "APPROVED", null, a);
    expect(cost).toMatchObject({ category: "SUBCONTRACTOR", amount: 4200, vendor: crew.name, reference: "TEST-101", kind: "SUB_BILL" });
    await expect(reviewCrewInvoice(sent.id, "APPROVED", null, a)).rejects.toThrow(/already approved/);
  });
});
