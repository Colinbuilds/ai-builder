import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { getPortal, revokePortal, sharePortal } from "@/lib/portal/customer";
import {
  crewPortal,
  logCrewWork,
  shareCrewLink,
  uploadDeliveryTicket,
} from "@/lib/portal/crew";
import { createInvoice, sendInvoice } from "@/lib/billing/service";
import {
  companyCamPhotos,
  parseCompanyCamLink,
} from "@/lib/integrations/companycam";

process.env.UPLOAD_DIR = "prisma/test-uploads";
afterAll(() => prisma.$disconnect());
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COMPANYCAM_TOKEN;
});
const admin = async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return { id: u.id, name: u.name, role: "ADMIN" as const };
};
const noon = (days: number) => {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + days, 12),
  );
};

describe("customer portal", () => {
  it("shows sent invoices and the schedule, never drafts; the link can be turned off", async () => {
    const a = await admin();
    const p = await createProject(
      {
        name: "TEST_ONLY Portal job",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        market: "RESIDENTIAL",
      },
      a,
    );
    await prisma.project.update({
      where: { id: p.id },
      data: {
        status: "SCHEDULED",
        contractAmount: 9000,
        contractSignedAt: new Date(),
      },
    });
    const sent = await createInvoice(
      p.id,
      {
        kind: "DEPOSIT",
        lines: [{ description: "TEST_ONLY deposit", amount: 3000 }],
      },
      a,
    );
    await sendInvoice(sent.id, { name: null, email: null }, a);
    await createInvoice(
      p.id,
      {
        kind: "PROGRESS",
        lines: [{ description: "TEST_ONLY draft", amount: 1000 }],
      },
      a,
    );
    await prisma.scheduleEvent.create({
      data: {
        projectId: p.id,
        kind: "INSTALL",
        title: "TEST_ONLY install",
        startDate: noon(3),
        endDate: noon(4),
        createdBy: "t",
      },
    });
    const { url } = await sharePortal(p.id, a);
    const token = url.split("/portal/")[1];
    const view = await getPortal(token);
    expect(view!.project.stage).toBe("Scheduled");
    expect(view!.invoices.map((i) => [i.number, i.balance])).toEqual([
      [sent.number, 3000],
    ]);
    expect(view!.schedule).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(
      /costBaseline|markupPct|costTotal/,
    );
    expect((await sharePortal(p.id, a)).url).toBe(url); // same link when shared again
    await revokePortal(p.id, a);
    expect(await getPortal(token)).toBeNull();
  });
});

describe("crew phone link", () => {
  it("lists the crew's jobs, logs work at the crew's rate for approval, and refuses other jobs", async () => {
    const a = await admin();
    const crew = await prisma.crew.create({
      data: {
        name: "TEST_ONLY Piece Crew",
        payType: "PIECE",
        defaultRate: 70,
        rateUnit: "SQ",
      },
    });
    const mine = await createProject(
      {
        name: "TEST_ONLY Crew job",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
        address: "9 TEST_ONLY Ln",
      },
      a,
    );
    const other = await createProject(
      {
        name: "TEST_ONLY Not theirs",
        scopes: ["STEEP"],
        isPublic: false,
        isTaxExempt: false,
      },
      a,
    );
    await prisma.scheduleEvent.create({
      data: {
        projectId: mine.id,
        crewId: crew.id,
        kind: "INSTALL",
        title: "TEST_ONLY tear-off & install",
        startDate: noon(0),
        endDate: noon(1),
        createdBy: "t",
      },
    });
    const url = await shareCrewLink(crew.id, a);
    const token = url.split("/c/")[1];
    const view = await crewPortal(token);
    expect(view!.jobs.map((j) => j.name)).toEqual(["TEST_ONLY Crew job"]);
    const t = await logCrewWork(token, {
      projectId: mine.id,
      date: noon(0),
      amount: 32.5,
      note: null,
    });
    expect(t).toMatchObject({
      basis: "PIECE",
      qty: 32.5,
      unit: "SQ",
      rate: 70,
      amount: 2275,
      approvedAt: null,
    });
    await expect(
      logCrewWork(token, {
        projectId: other.id,
        date: noon(0),
        amount: 1,
        note: null,
      }),
    ).rejects.toThrow(/isn't assigned to your crew/);
    await expect(
      uploadDeliveryTicket(token, other.id, {
        bytes: new Uint8Array([1]),
        name: "t.jpg",
        type: "image/jpeg",
      }),
    ).rejects.toThrow(/isn't assigned/);
    const doc = await uploadDeliveryTicket(token, mine.id, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      name: "ticket.jpg",
      type: "image/jpeg",
    });
    expect(doc.fileName).toMatch(
      /^Delivery ticket .* \(TEST_ONLY Piece Crew\)\.jpg$/,
    );
    const url2 = await shareCrewLink(crew.id, a, true);
    expect(url2).not.toBe(url);
    expect(await crewPortal(token)).toBeNull();
  });
});

describe("CompanyCam", () => {
  it("reads project links and maps photos", async () => {
    expect(
      parseCompanyCamLink("https://app.companycam.com/projects/58213/photos"),
    ).toBe("58213");
    expect(parseCompanyCamLink("58213")).toBe("58213");
    expect(parseCompanyCamLink("nope")).toBeNull();
    expect(await companyCamPhotos("58213")).toEqual([]); // no token → nothing fetched
    process.env.COMPANYCAM_TOKEN = "TEST_ONLY";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 1,
              captured_at: 1790000000,
              creator_name: "TEST_ONLY",
              uris: [
                { type: "thumbnail", uri: "https://t/1" },
                { type: "web", uri: "https://w/1" },
              ],
            },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const photos = await companyCamPhotos("58213");
    expect(photos).toEqual([
      {
        id: "1",
        thumb: "https://t/1",
        web: "https://w/1",
        takenAt: new Date(1790000000 * 1000),
        by: "TEST_ONLY",
      },
    ]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      "/projects/58213/photos",
    );
  });
});
