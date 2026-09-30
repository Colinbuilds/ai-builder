import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import {
  autoMap,
  importAccuLynx,
  milestoneStage,
  previewAccuLynx,
  readRows,
  storeAccuLynxExport,
} from "@/lib/import/acculynx";

process.env.UPLOAD_DIR = "prisma/test-uploads";
afterAll(() => prisma.$disconnect());

// TEST_ONLY export shaped like an AccuLynx jobs list.
const HEADER = [
  "Job Number",
  "Job Name",
  "Milestone",
  "Street",
  "City",
  "State",
  "Zip",
  "Contact Name",
  "Primary Phone",
  "Email",
  "Sales Owner",
  "Lead Source",
  "Trade Types",
  "Created Date",
  "Approved Job Value",
  "Insurance Company",
  "Claim Number",
];
const csv = (rows: string[][]) =>
  [HEADER, ...rows]
    .map((r) =>
      r
        .map((c) => (/[,"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(","),
    )
    .join("\n");

describe("AccuLynx export parsing", () => {
  it("matches columns by name and maps milestones", () => {
    const m = autoMap(HEADER);
    expect(m).toMatchObject({
      jobNumber: 0,
      jobName: 1,
      milestone: 2,
      street: 3,
      contactName: 7,
      phone: 8,
      salesperson: 10,
      amount: 14,
      carrier: 15,
      claim: 16,
    });
    expect(milestoneStage("Approved")).toBe("SOLD");
    expect(milestoneStage("Prospect")).toBe("ESTIMATING");
    expect(milestoneStage("Cancelled")).toBe("LOST");
    expect(milestoneStage("Completed")).toBe("COMPLETE");
    expect(milestoneStage("Something custom")).toBeNull();
  });

  it("builds the address and splits contact names", () => {
    const { rows } = readRows(
      [
        [
          "AX-1",
          "",
          "Lead",
          "12 TEST_ONLY St",
          "Omaha",
          "NE",
          "68142",
          "Walker, Pat",
          "",
          "",
          "",
          "",
          "Roofing",
          "3/4/26",
          "$12,500.00",
          "",
          "",
        ],
      ],
      autoMap(HEADER),
    );
    expect(rows[0]).toMatchObject({
      jobNumber: "AX-1",
      address: "12 TEST_ONLY St, Omaha, NE 68142",
      contact: { firstName: "Pat", lastName: "Walker" },
      amount: 12500,
      name: "Walker — 12 TEST_ONLY St",
    });
    expect(rows[0].created?.toISOString().slice(0, 10)).toBe("2026-03-04");
  });
});

describe("AccuLynx import", () => {
  it("creates jobs with customers, links a schedule job by address, and updates on re-import", async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const actor = { id: u.id, name: u.name };
    const fromSchedule = await createProject(
      {
        name: "TEST_ONLY 55 Linkme Ave — Siding",
        scopes: ["SIDING"],
        isPublic: false,
        isTaxExempt: false,
        address: "55 TEST_ONLY Linkme Ave",
        market: "RESIDENTIAL",
      },
      actor,
    );
    const rows = [
      [
        "AXT-100",
        "TEST_ONLY Smith reroof",
        "Approved",
        "100 TEST_ONLY Rd",
        "Omaha",
        "NE",
        "68144",
        "Sam TestSmith",
        "402-555-0100",
        "sam.testsmith@test.local",
        u.name,
        "Door knock",
        "Roofing",
        "8/1/26",
        "$18,250.00",
        "TEST_ONLY Mutual",
        "CLM-1",
      ],
      [
        "AXT-101",
        "TEST_ONLY Linked job",
        "Completed",
        "55 TEST_ONLY Linkme Ave",
        "Omaha",
        "NE",
        "68130",
        "Lee TestLinked",
        "",
        "",
        "Someone Unknown",
        "",
        "Siding",
        "",
        "$9,000.00",
        "",
        "",
      ],
      [
        "AXT-102",
        "TEST_ONLY Dead lead",
        "Cancelled",
        "7 TEST_ONLY Ct",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ];
    const file = await storeAccuLynxExport(
      new TextEncoder().encode(csv(rows)),
      "TEST_ONLY acculynx.csv",
    );
    const pv = await previewAccuLynx(file.fileUrl, file.fileName);
    expect(pv).toMatchObject({ total: 3, links: 1, updates: 0 });
    const r = await importAccuLynx(
      {
        ...file,
        map: pv.map,
        stages: { Cancelled: "SKIP" },
        market: "RESIDENTIAL",
      },
      actor,
    );
    expect(r).toMatchObject({ created: 1, linked: 1, skipped: 1 });
    const smith = await prisma.project.findFirstOrThrow({
      where: { acculynxJobNumber: "AXT-100" },
      include: { contacts: { include: { contact: true } } },
    });
    expect(smith).toMatchObject({
      status: "SOLD",
      contractAmount: 18250,
      salespersonId: u.id,
      leadSource: "Door knock",
      isInsuranceClaim: true,
      insuranceCarrier: "TEST_ONLY Mutual",
      claimNumber: "CLM-1",
      scopes: ["STEEP"],
    });
    expect(smith.contacts[0].contact).toMatchObject({
      firstName: "Sam",
      lastName: "TestSmith",
      email: "sam.testsmith@test.local",
    });
    const linked = await prisma.project.findUniqueOrThrow({
      where: { id: fromSchedule.id },
    });
    expect(linked).toMatchObject({
      acculynxJobNumber: "AXT-101",
      status: "COMPLETE",
      contractAmount: 9000,
    });
    expect(
      await prisma.project.count({
        where: { address: { startsWith: "55 TEST_ONLY Linkme" } },
      }),
    ).toBe(1);
    // re-import: nothing new; a later milestone moves the job forward
    rows[0][2] = "Invoiced";
    const again = await storeAccuLynxExport(
      new TextEncoder().encode(csv(rows)),
      "TEST_ONLY acculynx.csv",
    );
    const r2 = await importAccuLynx(
      {
        ...again,
        map: pv.map,
        stages: { Cancelled: "SKIP" },
        market: "RESIDENTIAL",
      },
      actor,
    );
    expect(r2).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: smith.id } }))
        .status,
    ).toBe("INVOICED");
  });
});
