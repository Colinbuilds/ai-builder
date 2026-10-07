// TEST_ONLY "What do you need to do?" box: plain-language request → the right screen, already pointed at it.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { goto, whenFrom } from "@/lib/shell/goto";
import { importPlanBook } from "@/lib/builders/planbook";
import { createProject } from "@/lib/projects/service";
import { toXlsx, workbook } from "./fixtures/plan-book";

const NAME = "ZQ Testbuild Homes";
afterAll(async () => {
  const co = await prisma.company.findMany({ where: { name: NAME }, select: { id: true } });
  await prisma.project.deleteMany({ where: { name: { startsWith: "TEST_ONLY goto" } } });
  await prisma.company.deleteMany({ where: { id: { in: co.map((c) => c.id) } } });
  await prisma.$disconnect();
});

describe("dates", () => {
  // Wednesday 2026-10-07, 10am Central
  const now = new Date("2026-10-07T15:00:00Z");
  it("reads today / tomorrow / next week / a weekday / m/d", () => {
    expect(whenFrom("schedule it today", now)?.date).toBe("2026-10-07");
    expect(whenFrom("tomorrow", now)?.date).toBe("2026-10-08");
    expect(whenFrom("for next week", now)?.date).toBe("2026-10-12"); // the Monday
    expect(whenFrom("on friday", now)?.date).toBe("2026-10-09");
    expect(whenFrom("monday", now)?.date).toBe("2026-10-12");
    expect(whenFrom("start 10/20", now)?.date).toBe("2026-10-20");
    expect(whenFrom("invoice the smith job", now)).toBeNull();
    // sizes aren't dates
    expect(whenFrom("order 3/4 plywood for 1234 maple", now)).toBeNull();
    expect(whenFrom("need 1/2 inch osb", now)).toBeNull();
    expect(whenFrom("schedule it 13/45", now)).toBeNull();
    expect(whenFrom("schedule for 10/14", now)?.date).toBe("2026-10-14");
  });
});

describe("going places", () => {
  it("“schedule a model for ZQ MC next week” → that builder's Metro City models, start date filled in", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: admin.id, name: "TEST_ONLY goto", role: "ADMIN" };
    const co = await prisma.company.create({ data: { name: NAME, type: "BUILDER" } });
    const { book } = await importPlanBook(co.id, { bytes: await toXlsx(workbook()), label: "Metro City" }, actor);
    const now = new Date("2026-10-07T15:00:00Z");

    const r = await goto("I need to schedule a model for ZQ MC next week", actor, now);
    expect(r.by).toBe("MATCH");
    expect(r.when?.date).toBe("2026-10-12");
    expect(r.hits[0]).toMatchObject({ tag: `${NAME} · Metro City models`, href: `/builders/${co.id}/plans?go=1&when=2026-10-12#book-${book.id}` });
    expect(r.hits.some((h) => h.href === "/builders/add-house")).toBe(true);

    // naming the model goes one step further: straight to its Add this house tab
    const m = await goto("schedule an aspen for testbuild tomorrow", actor, now);
    expect(m.hits[0].href).toBe(`/builders/${co.id}/plans/${encodeURIComponent("TEST_ONLY Aspen")}?book=${book.id}&t=schedule&when=2026-10-08`);

    // a job by its address, with what to do there
    const job = await createProject({ name: "TEST_ONLY goto Smith Reroof", address: "4417 Quillwort Ave, Omaha NE", scopes: ["STEEP"], isPublic: false, isTaxExempt: false }, actor);
    const inv = await goto("invoice 4417 quillwort", actor, now);
    expect(inv.hits[0]).toMatchObject({ label: "Invoice it", href: `/projects/${job.id}/billing` });
    expect((await goto("photos for quillwort", actor, now)).hits[0].href).toBe(`/projects/${job.id}/photos`);

    // plain requests
    expect((await goto("scan a receipt", actor, now)).hits[0].href).toBe("/receipts");
    expect((await goto("new lead", actor, now)).hits[0].href).toBe("/projects/new");
    expect((await goto("", actor, now)).hits).toEqual([]);
  });
});

describe("builder names don't hijack requests", () => {
  it("a builder called “… Receipt Homes” doesn't catch “scan a receipt”", async () => {
    const co = await prisma.company.create({ data: { name: "ZQ Receipt Homes", type: "BUILDER" } });
    try {
      const actor = { id: "x", role: "ADMIN" };
      expect((await goto("scan a receipt", actor)).hits[0].href).toBe("/receipts");
      expect((await goto("zq receipt homes pricing", actor)).hits.some((h) => h.href.includes(co.id))).toBe(true);
    } finally {
      await prisma.company.delete({ where: { id: co.id } });
    }
  });
});

describe("review fixes", () => {
  it("date numbers don't search for jobs; two different builders both stay", async () => {
    const actor = { id: "x", role: "ADMIN" };
    const a = await prisma.company.create({ data: { name: "QQ Alpha Homes", type: "BUILDER" } });
    const b = await prisma.company.create({ data: { name: "QQ Bravo Homes (Metro)", type: "BUILDER" } });
    const job = await prisma.project.create({ data: { name: "TEST_ONLY goto 1014 Elm", address: "1014 Elm", status: "LEAD" } });
    try {
      const r = await goto("move the alpha lot to bravo next week", actor);
      expect(r.hits.some((h) => h.href.includes(a.id))).toBe(true);
      expect(r.hits.some((h) => h.href.includes(b.id))).toBe(true);
      const d = await goto("schedule alpha for 10/14", actor);
      expect(d.hits.some((h) => h.href.includes(job.id))).toBe(false);
    } finally {
      await prisma.project.delete({ where: { id: job.id } });
      await prisma.company.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });
});

describe("help", () => {
  it("“how do I add a house” offers the guides", async () => {
    const r = await goto("how do I add a house", { id: "x", role: "ADMIN" });
    expect(r.hits.some((h) => h.href === "/help")).toBe(true);
  });
});
