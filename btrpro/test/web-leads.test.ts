// TEST_ONLY customer request form: validation, submit → job, renderings (fake model), assign, inspection.
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addRendering, assignWebLead, checkLead, leadByToken, scheduleInspection, setFavorite, submitWebLead, type LeadInput, type Rendering } from "@/lib/leads/web";
import { lookLabel, renderPrompt, setRendererForTests } from "@/lib/render";

const base: LeadInput = {
  firstName: "TEST_ONLY Web",
  lastName: "Customer",
  phone: "402-555-0187",
  email: "test-only-web@example.com",
  contactPref: "CALL",
  textOk: true,
  street: "123 TEST_ONLY St",
  city: "Omaha",
  state: "ne",
  zip: "68142",
  propertyType: "HOME",
  relationship: "OWNER",
  wants: ["ROOF_REPLACE", "GUTTERS"],
  description: "Hail in June, shingles missing on the back slope.",
  stories: "2 stories",
  currentRoof: "Asphalt shingles",
  roofAge: "18 years",
  insurance: true,
  insuranceCarrier: "TEST_ONLY Mutual",
  claimNumber: "C-1",
  dateOfLoss: "2026-06-12",
  timeline: "ASAP",
  heardFrom: "Neighbor",
  inspectionTimes: "weekday mornings",
};
const photo = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#8899aa" } }).jpeg().toBuffer()), name: "front.jpg" });

afterAll(async () => {
  setRendererForTests(null);
  const leads = await prisma.webLead.findMany({ where: { firstName: { startsWith: "TEST_ONLY" } }, select: { projectId: true } });
  await prisma.webLead.deleteMany({ where: { firstName: { startsWith: "TEST_ONLY" } } });
  await prisma.project.deleteMany({ where: { id: { in: leads.map((l) => l.projectId!).filter(Boolean) } } });
  await prisma.contact.deleteMany({ where: { firstName: { startsWith: "TEST_ONLY" } } });
  await prisma.$disconnect();
});

describe("request form", () => {
  it("asks for everything a new job needs", () => {
    expect(checkLead(base, 1)).toEqual([]);
    const p = checkLead({ ...base, phone: "555", email: "nope", zip: "6814", wants: [], description: "roof" }, 0);
    expect(p.join(" ")).toMatch(/10-digit phone.*valid email.*ZIP.*at least one thing.*Describe.*at least one photo/);
  });

  it("builds the rendering instruction and keeps masonry", () => {
    const c = { roofStyle: "shingle", roofColor: "charcoal", sidingStyle: "lap", sidingColor: "navy", trim: "white" };
    expect(lookLabel(c)).toBe("Charcoal / black architectural shingles · Navy blue horizontal lap · White trim");
    const p = renderPrompt(c);
    expect(p).toMatch(/charcoal black dimensional architectural asphalt shingles/);
    expect(p).toMatch(/Leave any brick, stone or stucco exactly as it is/);
    expect(p).toMatch(/Change nothing else/);
    expect(() => renderPrompt({})).toThrow(/Pick a roof or siding/);
  });

  it("turns a submission into a lead job, assigns it, and books the inspection", async () => {
    const ip = `TEST_ONLY-${Math.random()}`;
    // an earlier contact with this phone and no email: the form's email is filled in, not dropped
    await prisma.contact.create({ data: { firstName: "TEST_ONLY Web", lastName: "Old", phone: "(402) 555-0142", phoneKey: "4025550142" } });
    const lead = await submitWebLead(base, [await photo()], { ip });
    expect(lead.phone).toBe("(402) 555-0187");
    expect(lead.state).toBe("NE");
    const job = await prisma.project.findUniqueOrThrow({ where: { id: lead.projectId! }, include: { contacts: { include: { contact: true } }, documents: true } });
    expect(job).toMatchObject({ status: "LEAD", market: "RESIDENTIAL", address: "123 TEST_ONLY St, Omaha, NE 68142", isInsuranceClaim: true, insuranceCarrier: "TEST_ONLY Mutual", priority: "HIGH" });
    expect(job.workTypes).toEqual(["REROOF", "GUTTERS"]);
    expect(job.scopes).toEqual(["STEEP"]);
    expect(job.leadSource).toMatch(/Website request form — heard from: Neighbor/);
    expect(job.contacts[0].contact.email).toBe("test-only-web@example.com");
    expect(job.documents.filter((d) => d.type === "PHOTO")).toHaveLength(1);
    expect(await prisma.task.count({ where: { auto: `WEBLEAD:${lead.id}`, doneAt: null } })).toBeGreaterThan(0);

    // renderings off → the pick is saved for the salesperson
    await addRendering(lead.token, 0, { roofColor: "slate", roofStyle: "shingle" });
    let l = (await leadByToken(lead.token))!;
    expect((l.renderings as Rendering[])[0]).toMatchObject({ url: "", label: "Slate gray architectural shingles" });
    // with a rendering model (fake) → image saved on the request and the job
    setRendererForTests(async (jpeg) => jpeg);
    await addRendering(lead.token, 0, { sidingColor: "navy", sidingStyle: "lap" });
    await setFavorite(lead.token, 1);
    l = (await leadByToken(lead.token))!;
    const r = l.renderings as Rendering[];
    expect(r[1].url).not.toBe("");
    expect(r[1].favorite).toBe(true);
    expect(l.renderCount).toBe(2);
    expect(await prisma.document.count({ where: { projectId: lead.projectId!, fileName: { startsWith: "Customer rendering" } } })).toBe(1);
    await expect(addRendering(lead.token, 5, { roofColor: "slate" })).rejects.toThrow(/Pick one of your photos/);

    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await assignWebLead(lead.id, admin.id, admin);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: lead.projectId! } })).salespersonId).toBe(admin.id);
    expect(await prisma.task.count({ where: { auto: `WEBLEAD:${lead.id}`, doneAt: null } })).toBe(0);
    expect(await prisma.task.count({ where: { auto: `WEBLEAD-CALL:${lead.id}`, doneAt: null, assigneeId: admin.id } })).toBe(1);

    await scheduleInspection(lead.id, { date: "2026-10-09", time: "14:30" }, admin);
    l = (await leadByToken(lead.token))!;
    expect(l).toMatchObject({ status: "SCHEDULED", inspectionWhen: "2:30 PM" });
    const ev = await prisma.scheduleEvent.findFirstOrThrow({ where: { projectId: lead.projectId!, kind: "INSPECTION" } });
    expect(ev.title).toMatch(/^Inspection 2:30 PM — TEST_ONLY Web Customer/);
    expect(await prisma.task.count({ where: { auto: `WEBLEAD-CALL:${lead.id}`, doneAt: null } })).toBe(0);
  });

  it("limits repeat submissions from one connection", async () => {
    const ip = `TEST_ONLY-${Math.random()}`;
    for (let i = 0; i < 5; i++) await submitWebLead({ ...base, timeline: null, insurance: false }, [await photo()], { ip });
    await expect(submitWebLead(base, [await photo()], { ip })).rejects.toThrow(/several requests/);
  });
});
