// TEST_ONLY builder start sheets by email: houses@ reads them; receipts@ hands them over and keeps the receipts.
import { afterAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/db";
import { isHousesAddress, startsFromEmail } from "@/lib/builders/starts-inbox";

const NAME = "TEST_ONLY Inbox Homes";
afterAll(async () => {
  await prisma.builderStart.deleteMany({ where: { fileName: { startsWith: "TEST_ONLY" } } });
  await prisma.contact.deleteMany({ where: { email: "super@inbox-homes.test" } });
  await prisma.company.deleteMany({ where: { name: NAME } });
  await prisma.$disconnect();
});

const LINES = [
  "Selected Option Summary",
  `${NAME.toUpperCase()} - METRO Date - . . . 01/02/26`,
  "Revision # 002",
  "Subdivision Name: TEST_ONLY Ridge",
  "Subdivision Number: 000000000 Plan/Elevation/Swing: TEST_ONLY-ASPEN / B2 / R",
  "Lot Address: 77 TEST_ONLY LN Milestone 1 - Start Date: Permit Number: TEST-0077",
  "Lot City, St Zip: TESTVILLE , NE 68000",
  "Lot/Block/Phase: 77 / /",
];
async function pdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 750 - i * 16, size: 10, font }));
  return Buffer.from(await doc.save());
}
const mail = async (from: string, files: { name: string; lines: string[] }[]) => ({
  externalId: null,
  threadId: null,
  from,
  to: "houses@in.test",
  subject: "Start",
  sentAt: new Date(),
  bodyText: "",
  attachments: await Promise.all(files.map(async (f) => ({ name: f.name, contentType: "application/pdf", bytes: await pdf(f.lines) }))),
});

describe("start sheets by email", () => {
  it("houses@ takes them from staff and from the builder's own email domain, not from strangers", async () => {
    expect(isHousesAddress(["BTR <houses@in.test>"])).toBe(true);
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const co = await prisma.company.create({ data: { name: NAME, type: "BUILDER" } });
    await prisma.contact.create({ data: { firstName: "TEST_ONLY", lastName: "Super", email: "super@inbox-homes.test", companyId: co.id } });

    const staff = await startsFromEmail((await mail(admin.email, [{ name: "TEST_ONLY a.pdf", lines: LINES }])) as never);
    expect(staff.ids).toHaveLength(1);
    const s = await prisma.builderStart.findUniqueOrThrow({ where: { id: staff.ids[0] } });
    expect(s.data).toMatchObject({ lot: "77", permit: "TEST-0077", planCode: "TEST_ONLY-ASPEN" });

    const fromBuilder = await startsFromEmail((await mail("Jo <jo@inbox-homes.test>", [{ name: "TEST_ONLY b.pdf", lines: LINES.map((l) => l.replace("77", "78")) }])) as never);
    expect(fromBuilder.ids).toHaveLength(1);

    const stranger = await startsFromEmail((await mail("x@gmail.com", [{ name: "TEST_ONLY c.pdf", lines: LINES }])) as never);
    expect(stranger.ids).toHaveLength(0);
    expect(stranger.ignored).toMatch(/isn't staff/);
  });

  it("receipts@ only takes the start sheets and leaves other PDFs for the receipt reader", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const r = await startsFromEmail((await mail(admin.email, [{ name: "TEST_ONLY start.pdf", lines: LINES.map((l) => l.replace("77", "79")) }, { name: "TEST_ONLY receipt.pdf", lines: ["ABC SUPPLY", "INVOICE 12345", "TOTAL 99.00"] }])) as never, { onlyStartSheets: true });
    expect(r.consumed).toEqual(["TEST_ONLY start.pdf"]);
  });
});
