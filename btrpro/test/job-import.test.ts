import { afterAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { readXlsx } from "@/lib/import/xlsx";
import {
  matchAccount,
  parseDate,
  parseMoney,
  parseSchedule,
  scopesFor,
} from "@/lib/import/schedule";
import {
  importSchedule,
  previewSchedule,
  storeUploadedSchedule,
} from "@/lib/import/service";

process.env.UPLOAD_DIR = "prisma/test-uploads";
afterAll(() => prisma.$disconnect());

const H = [
  "Date Added",
  "Estimate #",
  "Builder",
  "Address ",
  "Model",
  "Type",
  "Crew ",
  "Super ",
  "Sales Rep",
  "Notes ",
  "Completed",
  "Pay out",
  "Sell",
  "Paid/Approved",
  "Billed ",
  "BTR Paid",
  "Billing Notes",
];
const row = (o: Partial<Record<string, string>>) =>
  H.map((h) => o[h.trim()] ?? "");
// TEST_ONLY rows shaped like the Residential "Live" schedule.
const RES = [
  {
    name: "Hildy",
    rows: [
      H,
      ["Hildy Upcoming"],
      [],
      row({
        "Date Added": "7/9/26",
        "Estimate #": "est 9001",
        Builder: "TEST_ONLY Hildy Homes",
        Address: "100 TEST_ONLY Ln Lot 1",
        Model: "Sienna",
        Type: "Siding Labor",
        "Sales Rep": "House",
        "Pay out": "$4,000.00",
        Sell: "$6,000.50",
      }),
    ],
  },
  {
    name: "DR Horton",
    rows: [
      H,
      ["DR Horton Base Plans"],
      row({
        Builder: "TEST_ONLY DR Horton",
        Address: "Plan 1234",
        Type: "Siding",
        Sell: "$1.00",
      }),
      ["DR Horton Upcoming"],
      row({
        "Estimate #": "203722",
        Builder: "TEST_ONLY DR Horton Westbrook Hills",
        Address: "200 TEST_ONLY St",
        Type: "siding",
        Sell: "4171.2",
      }),
    ],
  },
  {
    name: "Completed-billed ",
    rows: [
      H,
      row({
        Builder: "TEST_ONLY Hildy Homes",
        Address: "100 TEST_ONLY Ln Lot 1",
        Type: "Siding Labor",
        Completed: "OK to pay in full 3/10 RP",
        Billed: "x 3/10/26",
        Sell: "$6,000.50",
      }),
      row({
        Builder: "TEST_ONLY Walker",
        Address: "300 TEST_ONLY Ave",
        Type: "R&R Roofing",
        Completed: "yes 8/25",
        Sell: "$15,000.00",
      }),
    ],
  },
  {
    name: "Weekly Billing ",
    rows: [
      H,
      row({
        Builder: "TEST_ONLY Walker",
        Address: "300 TEST_ONLY Ave",
        Type: "R&R Roofing",
      }),
    ],
  },
  { name: "Crew (data_source)", rows: [["Someone"]] },
];

const CH = [
  "Project ",
  "Builder",
  "Address ",
  "Type",
  "Crew ",
  "Total Payout",
  "Total Paid to Date",
  "Payout this Week",
  "Remaining Payout",
  "Sell",
  "Super ",
  "Sales Rep",
  "Notes ",
];
const COM = [
  {
    name: "Current - Jarrod",
    rows: [
      CH,
      ["Jarrod"],
      ["TEST_ONLY Kennedy - Rows Phase II", "", "", "", "", "$97,549.44"],
      [],
      [
        "",
        "TEST_ONLY Kennedy - Rows Phase II",
        "Siding Labor 6 Plex 1",
        "Siding",
        "",
        "$17,976.74",
        "",
        "",
        "",
        "$23,859.40",
        "Jarrod Geiser",
        "House",
      ],
      [
        "",
        "TEST_ONLY Kennedy - Rows Phase II",
        "Siding Labor 6 Plex 2",
        "Siding",
        "",
        "$17,976.74",
        "",
        "",
        "",
        "$23,859.40",
        "Jarrod Geiser",
        "House",
      ],
      [
        "",
        "TEST_ONLY Kennedy - Rows Phase II",
        "Deduct - Material",
        "Siding",
        "",
        "-$309.21",
      ],
    ],
  },
  {
    name: "Upcoming Comm.",
    rows: [
      [
        "Estimate #",
        "Builder",
        "Building Type",
        "Type ",
        "Crew",
        "Total Payout",
        "Total Paid to Date",
        "Payout This Week",
        "Remaining Payout",
        "Sell",
        "Super ",
        "Sales Rep",
        "Notes ",
      ],
      ["Commercial roofing/siding/gutter/deck projects"],
      [
        "est 9002",
        "TEST_ONLY Reid ",
        "TEST_ONLY Apartments",
        "Roofing",
        "",
        "$2,000.00",
        "",
        "",
        "$2,000.00",
        "$5,018.08",
        "",
        "House",
        "",
      ],
    ],
  },
];

/** Writes tabs as a real .xlsx (shared strings), like Drive's export. */
async function xlsx(tabs: { name: string; rows: string[][] }[]) {
  const zip = new JSZip();
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const col = (i: number) =>
    String.fromCharCode(65 + (i % 26)).padStart(i >= 26 ? 2 : 1, "A");
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns:r="r"><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships>${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  tabs.forEach((t, ti) => {
    const rows = t.rows
      .map((r, ri) => {
        const cells = r
          .map((v, ci) => {
            if (!v) return "";
            const ref = `${col(ci)}${ri + 1}`;
            if (/^-?\d+(\.\d+)?$/.test(v))
              return `<c r="${ref}"><v>${v}</v></c>`;
            strings.push(v);
            return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    zip.file(
      `xl/worksheets/sheet${ti + 1}.xml`,
      `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  zip.file(
    "xl/sharedStrings.xml",
    `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("schedule parsing", () => {
  it("reads money, dates and scopes as written", () => {
    expect(parseMoney("$4,869.12")).toBe(4869.12);
    expect(parseMoney("-$309.21")).toBe(-309.21);
    expect(parseMoney(" $ (22,024)")).toBe(-22024);
    expect(parseMoney("$ -   ")).toBeNull();
    expect(parseDate("7/9/26")?.toISOString().slice(0, 10)).toBe("2026-07-09");
    expect(parseDate("12/2-12-5")).toBeNull();
    expect(parseDate("46000")?.getUTCFullYear()).toBe(2025);
    expect(scopesFor("Siding L&M")).toEqual(["SIDING"]);
    expect(scopesFor("R&R Roofing")).toEqual(["STEEP"]);
    expect(scopesFor("EPDM")).toEqual(["LOW_SLOPE"]);
    expect(scopesFor("Gutters")).toEqual([]);
  });

  it("reads an .xlsx and turns residential rows into jobs, skipping base plans and repeat tabs", async () => {
    const tabs = await readXlsx(await xlsx(RES));
    expect(tabs.map((t) => t.name)).toContain("Hildy");
    const p = parseSchedule(tabs, { market: "RESIDENTIAL" });
    expect(p.tabs.find((t) => t.name === "Weekly Billing ")?.used).toBe(false);
    expect(p.skipped.some((s) => /Base-plan/.test(s.reason))).toBe(true);
    expect(p.jobs).toHaveLength(3);
    const hildy = p.jobs.find((j) => j.address === "100 TEST_ONLY Ln Lot 1")!;
    expect(hildy.stage).toBe("INVOICED"); // moved from Upcoming (Hildy tab) to Completed-billed
    expect(hildy.sources).toHaveLength(2);
    expect(hildy.estimateNo).toBe("est 9001");
    expect(hildy.sell).toBe(6000.5);
    const drh = p.jobs.find((j) => j.address === "200 TEST_ONLY St")!;
    expect(drh).toMatchObject({
      stage: "SOLD",
      builderJobNo: "203722",
      estimateNo: null,
      sell: 4171.2,
    });
  });

  it("groups commercial lines into one job per GC - project", () => {
    const p = parseSchedule(COM, { market: "COMMERCIAL" });
    expect(p.jobs).toHaveLength(2);
    const k = p.jobs.find((j) => j.name === "Rows Phase II")!;
    expect(k).toMatchObject({
      account: "TEST_ONLY Kennedy",
      stage: "IN_PRODUCTION",
      scopes: ["SIDING"],
    });
    expect(k.sell).toBeCloseTo(47718.8, 2);
    expect(k.details.filter((d) => /Plex/.test(d))).toHaveLength(2);
    expect(p.jobs.find((j) => j.account === "TEST_ONLY Reid")).toMatchObject({
      name: "TEST_ONLY Apartments",
      stage: "SOLD",
      estimateNo: "est 9002",
    });
  });

  it("matches builder names to accounts", () => {
    const A = [
      { id: "1", name: "DR Horton (Omaha)", type: "BUILDER" },
      { id: "2", name: "DR Horton (Kansas City)", type: "BUILDER" },
      { id: "3", name: "Hildy Homes", type: "BUILDER" },
      { id: "4", name: "Signature Companies", type: "GC" },
      { id: "5", name: "Signature Construction", type: "GC" },
      { id: "6", name: "The Home Company", type: "BUILDER" },
    ];
    expect(matchAccount("DR Horton Westbrook Hills", A)).toMatchObject({
      account: { id: "1" },
    });
    expect(matchAccount("DR Horton Westbrook Hills", A).ambiguous).toHaveLength(
      2,
    );
    expect(matchAccount("DR Horton Kansas City Lot 4", A).account?.id).toBe(
      "2",
    );
    expect(matchAccount("Hildy", A).account?.id).toBe("3");
    expect(matchAccount("Hildy Homes", A).account?.id).toBe("3");
    expect(matchAccount("Signature Companies", A).account?.id).toBe("4");
    expect(matchAccount("Home company", A).account?.id).toBe("6");
    expect(matchAccount("Charleson", A).account).toBeNull();
  });
});

describe("schedule import", () => {
  it("creates jobs under their accounts, then re-imports without duplicating", async () => {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "ADMIN" },
    });
    const actor = { id: admin.id, name: admin.name };
    const hildy = await prisma.company.create({
      data: { name: "TEST_ONLY Hildy Homes", type: "BUILDER" },
    });
    const drh = await prisma.company.create({
      data: { name: "TEST_ONLY DR Horton", type: "BUILDER" },
    });

    // First pass: only the upcoming tabs.
    const first = await storeUploadedSchedule(
      await xlsx(RES.slice(0, 2)),
      "TEST_ONLY Residential Schedule.xlsx",
    );
    const pv = await previewSchedule(
      first.fileUrl,
      first.fileName,
      "RESIDENTIAL",
    );
    expect(
      pv.accounts.find((a) => a.text === "TEST_ONLY Hildy Homes")?.matchId,
    ).toBe(hildy.id);
    expect(
      pv.accounts.find((a) => a.text === "TEST_ONLY DR Horton Westbrook Hills")
        ?.matchId,
    ).toBe(drh.id);
    const mapping = Object.fromEntries(
      pv.accounts.map((a) => [a.text, a.matchId ?? `NEW:${a.suggestedType}`]),
    );
    const r1 = await importSchedule(
      {
        ...first,
        market: "RESIDENTIAL",
        mapping,
        source: "TEST_ONLY schedule",
      },
      actor,
    );
    expect(r1).toMatchObject({ created: 2, updated: 0 });
    const job = await prisma.project.findFirstOrThrow({
      where: { address: "100 TEST_ONLY Ln Lot 1" },
    });
    expect(job).toMatchObject({
      clientCompanyId: hildy.id,
      status: "SOLD",
      contractAmount: 6000.5,
      constructionType: "NEW",
      market: "RESIDENTIAL",
      acculynxJobNumber: "est 9001",
    });
    expect(job.createdAt.toISOString().slice(0, 10)).toBe("2026-07-09");

    // Second pass: the full schedule. The Hildy job moved to Completed-billed; Walker is a new customer account.
    const full = await storeUploadedSchedule(
      await xlsx(RES),
      "TEST_ONLY Residential Schedule.xlsx",
    );
    const pv2 = await previewSchedule(
      full.fileUrl,
      full.fileName,
      "RESIDENTIAL",
    );
    expect(pv2.alreadyImported).toBe(2);
    const walker = pv2.accounts.find((a) => a.text === "TEST_ONLY Walker")!;
    expect(walker.matchId).toBeNull();
    const mapping2 = Object.fromEntries(
      pv2.accounts.map((a) => [a.text, a.matchId ?? "NEW:OWNER"]),
    );
    const r2 = await importSchedule(
      {
        ...full,
        market: "RESIDENTIAL",
        mapping: mapping2,
        source: "TEST_ONLY schedule",
      },
      actor,
    );
    expect(r2).toMatchObject({
      created: 1,
      updated: 1,
      unchanged: 1,
      accountsCreated: 1,
    });
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("INVOICED");
    expect(
      await prisma.project.count({
        where: { address: "100 TEST_ONLY Ln Lot 1" },
      }),
    ).toBe(1);
    const w = await prisma.company.findFirstOrThrow({
      where: { name: "TEST_ONLY Walker" },
    });
    expect(w.type).toBe("OWNER");
    expect(
      await prisma.project.count({ where: { clientCompanyId: w.id } }),
    ).toBe(1);

    // Skipping an account imports nothing for it.
    const r3 = await importSchedule(
      {
        ...full,
        market: "RESIDENTIAL",
        mapping: { ...mapping2, "TEST_ONLY Walker": "SKIP" },
        source: "x",
      },
      actor,
    );
    expect(r3.skipped).toBe(1);
  });
});

describe("schedule re-import and Lost jobs", () => {
  it("never moves a job marked Lost back into the pipeline", async () => {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: "ADMIN" },
    });
    const actor = { id: admin.id, name: admin.name };
    const tabs = [
      {
        name: "Hildy",
        rows: [
          H,
          ["Hildy Upcoming"],
          row({
            Builder: "TEST_ONLY Lostcheck Homes",
            Address: "900 TEST_ONLY Lost Rd",
            Type: "Siding",
            Sell: "$1,000.00",
          }),
        ],
      },
    ];
    const f = await storeUploadedSchedule(
      await xlsx(tabs),
      "TEST_ONLY Lost Schedule.xlsx",
    );
    const mapping = { "TEST_ONLY Lostcheck Homes": "NEW:BUILDER" };
    await importSchedule(
      { ...f, market: "RESIDENTIAL", mapping, source: "TEST_ONLY" },
      actor,
    );
    const job = await prisma.project.findFirstOrThrow({
      where: { address: "900 TEST_ONLY Lost Rd" },
    });
    await prisma.project.update({
      where: { id: job.id },
      data: { status: "LOST", lostReason: "TEST_ONLY builder cancelled" },
    });
    const again = await storeUploadedSchedule(
      await xlsx(tabs),
      "TEST_ONLY Lost Schedule.xlsx",
    );
    await importSchedule(
      { ...again, market: "RESIDENTIAL", mapping, source: "TEST_ONLY" },
      actor,
    );
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("LOST");
  });
});
