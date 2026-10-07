// TEST_ONLY crews see their production schedule lines and mark them done from the phone.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { crewJobs, crewLine, crewMarkDone, crewScheduleLines } from "@/lib/crew/service";

const NAME = "TEST_ONLY Phone Crew";
afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { contains: NAME } } });
  await prisma.prodLine.deleteMany({ where: { builder: "TEST_ONLY Phone Builder" } });
  await prisma.project.deleteMany({ where: { name: "TEST_ONLY phone house" } });
  await prisma.crew.deleteMany({ where: { name: NAME } });
  await prisma.$disconnect();
});

describe("crew schedule on the phone", () => {
  it("shows the crew's open lines (any case), not others', and Done tells the office", async () => {
    const crew = await prisma.crew.create({ data: { name: NAME, trade: "ROOFING" } as never });
    const job = await prisma.project.create({ data: { name: "TEST_ONLY phone house", status: "SOLD", market: "RESIDENTIAL" } });
    const mine = await prisma.prodLine.create({ data: { market: "RESIDENTIAL", board: "UPCOMING", builder: "TEST_ONLY Phone Builder", location: "TEST_ONLY 1 Oak", crew: NAME.toUpperCase(), type: "Roofing", startDate: new Date("2026-10-12T12:00:00Z"), projectId: job.id, payout: 1000 } });
    const other = await prisma.prodLine.create({ data: { market: "RESIDENTIAL", board: "UPCOMING", builder: "TEST_ONLY Phone Builder", location: "TEST_ONLY 2 Oak", crew: "TEST_ONLY Someone Else", type: "Roofing" } });
    // finished on the sheet by text only ("Paid out in full") isn't open work
    await prisma.prodLine.create({ data: { market: "RESIDENTIAL", board: "CURRENT", builder: "TEST_ONLY Phone Builder", location: "TEST_ONLY 3 Oak", crew: NAME, type: "Roofing", completed: "Paid out in full" } });
    const lines = await crewScheduleLines(crew);
    expect(lines.map((l) => l.id)).toEqual([mine.id]);
    await expect(crewLine(crew, other.id)).rejects.toThrow(/isn't on your crew's schedule/);
    // the house job is open for this crew's photos
    expect((await crewJobs(crew.id)).map((j) => j.id)).toContain(job.id);
    await Promise.all([crewMarkDone(crew, mine.id), crewMarkDone(crew, mine.id)]); // a double tap
    const done = await prisma.prodLine.findUniqueOrThrow({ where: { id: mine.id } });
    expect(done.completedAt).not.toBeNull();
    expect(done.completed).toMatch(/Done .*TEST_ONLY/);
    expect(await crewScheduleLines(crew)).toEqual([]);
    const office = (await prisma.user.count({ where: { role: "OFFICE" } })) || (await prisma.user.count({ where: { role: "ADMIN" } }));
    expect(await prisma.task.count({ where: { auto: `PROD:pay:${mine.id}` } })).toBe(office); // once per office person, not twice
  });
});
