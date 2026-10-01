// TEST_ONLY estimating schedule: the sheet's tabs → rows, and the sync's add / update / keep-edited / remove rules.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Tab } from "@/lib/import/xlsx";
import { parseEstimatingWorkbook } from "@/lib/estimating/sheet";
import { applySheetRows, updateEntry } from "@/lib/estimating/schedule";

afterAll(() => prisma.$disconnect());

// Excel date serials: 46280 = 9/15/2026, 46290 = 9/25/2026, 46300 = 10/5/2026, 45000 = 3/15/2023
const current: Tab = {
  name: "BTR Current Estimating ",
  rows: [
    ["", "TEST_ONLY stray note above the table"],
    ["Standard"],
    ["ASAP"],
    [" ", "Customer ", "Project ", "Tasks", "Estimator", "Receive Date", "Due Date", "Status ", "Sent Date", "Waiting on ", "Folder Link", "Notes"],
    ["Commercial", "TEST_ONLY GC A, GC B", "TEST_ONLY Fire Station", "Siding L&M/Roofing L&M", "EO", "46280", "46300", "Sent for Review", "46290", "ABC/Millard", "Estimating", ""],
    ["Projects Misc. Tasks"],
    ["Commercial", "TEST_ONLY GC C", "TEST_ONLY Pricebook update", "Update pricing", "EO", "", "?", "Sent to Garrett", "", "", "", ""],
    ["New Build Residential"],
    ["Residential", "TEST_ONLY Builder", "TEST_ONLY 123 Lot 4", "Siding L/Roofing L&M", "BW", "46280", "46290", "Sent for Review", "", "Bobby", "", ""],
    ["Remodels"],
    ["Residential", "", "TEST_ONLY 9 Elm St", "R&R Roofing L&M", "BW", "46280", "46290", "Need PB", "", "", "", ""],
    ["Jobs We Are Passing On"],
    ["Commercial", "TEST_ONLY GC D", "TEST_ONLY Small Job", "Roofing L&M", "DP", "46280", "46290", "Passing", "", "", "", ""],
    ["Commercial", "TEST_ONLY GC E", "TEST_ONLY Old Open Item", "Siding L&M", "", "45000", "45000", "Working", "", "", "", ""],
  ],
  links: { "4,10": "https://drive.google.com/drive/folders/TEST_ONLY" },
};
const residential: Tab = {
  name: "BTR New Construction Residentia",
  rows: [
    ["TEST_ONLY Old Builder", "TEST_ONLY 1 Old St", "Hard Bid", "45000", "45000", "complete", "", "Trevin"],
    ["TEST_ONLY New Builder", "TEST_ONLY 2 New St", "Siding L", "BW", "46280", "46290", "Completed 9/25/2026", "", "Bobby/Biff"],
  ],
};
const lost: Tab = {
  name: "Commercial Lost Jobs ",
  rows: [
    ["General Contractor", "Project Name", "Scope", "Bid Date", "Reason", "Winning Sub", "Notes"],
    ["TEST_ONLY GC F", "TEST_ONLY Lost One", "Siding L&M", "45000", "Over Budget", "N/A", "followed up"],
  ],
};
const tract: Tab = { name: "Tract Builder Scopes", rows: [["TEST_ONLY Builder KC"], ["Roofing Labor & Material", "Certainteed Patriot"], ["Siding Labor"]] };

describe("estimating sheet parser", () => {
  const { rows, tabs } = parseEstimatingWorkbook([current, residential, lost, tract, { name: "Notes", rows: [["x"]] }]);
  const find = (p: string) => rows.find((r) => r.project === p)!;

  it("sorts the Current tab into its sections and skips the notes above the header", () => {
    expect(rows.some((r) => r.project.includes("stray"))).toBe(false);
    expect(find("TEST_ONLY Fire Station")).toMatchObject({ board: "CURRENT", market: "COMMERCIAL", estimator: "EO", status: "Sent for Review", waitingOn: "ABC/Millard", folderLink: "https://drive.google.com/drive/folders/TEST_ONLY" });
    expect(find("TEST_ONLY Fire Station").dueAt?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(find("TEST_ONLY Pricebook update")).toMatchObject({ board: "MISC", extra: { Due: "?" } });
    expect(find("TEST_ONLY 123 Lot 4")).toMatchObject({ board: "CURRENT", market: "RESIDENTIAL", kind: "NEW_BUILD" });
    expect(find("TEST_ONLY 9 Elm St")).toMatchObject({ board: "CURRENT", kind: "REMODEL" });
    expect(find("TEST_ONLY Small Job").board).toBe("PASSING");
    expect(find("TEST_ONLY Old Open Item").board).toBe("ARCHIVE");
  });

  it("reads old and new residential row layouts", () => {
    expect(find("TEST_ONLY 1 Old St")).toMatchObject({ board: "SENT", estimator: null, status: "complete", sentTo: "Trevin" });
    expect(find("TEST_ONLY 2 New St")).toMatchObject({ estimator: "BW", status: "Completed 9/25/2026", sentTo: "Bobby/Biff" });
  });

  it("reads lost reasons and tract builder scopes, and reports unknown tabs", () => {
    expect(find("TEST_ONLY Lost One")).toMatchObject({ board: "LOST", extra: { Reason: "Over Budget", "Winning sub": "N/A" } });
    expect(rows.find((r) => r.board === "TRACT")).toMatchObject({ customer: "TEST_ONLY Builder KC", scope: "Roofing Labor & Material — Certainteed Patriot\nSiding Labor" });
    expect(tabs.find((t) => t.tab === "Notes")?.skipped).toBeTruthy();
    expect(new Set(rows.map((r) => r.sourceKey)).size).toBe(rows.length);
  });
});

describe("sheet sync", () => {
  it("adds, updates, keeps rows edited in BTRpro, and removes rows gone from the sheet", async () => {
    await prisma.estimateLog.deleteMany({ where: { project: { startsWith: "TEST_ONLY" } } });
    const a = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const first = parseEstimatingWorkbook([current, lost]);
    const r1 = await applySheetRows(first.rows, first.tabs);
    expect(r1.added).toBe(first.rows.length);

    const fire = await prisma.estimateLog.findFirstOrThrow({ where: { project: "TEST_ONLY Fire Station" } });
    await updateEntry(fire.id, { status: "TEST_ONLY edited here" }, a);

    // the sheet changes: Lost tab row removed, Fire Station status changed in the sheet, Pricebook status changed
    const changed: Tab = { ...current, rows: current.rows.map((r) => (r[2] === "TEST_ONLY Fire Station" || r[2] === "TEST_ONLY Pricebook update" ? r.map((c, i) => (i === 7 ? "TEST_ONLY sheet status" : c)) : r)) };
    const second = parseEstimatingWorkbook([changed]);
    const r2 = await applySheetRows(second.rows, second.tabs);
    expect(r2.keptEdited).toBe(1);
    expect(r2.removed).toBe(1);
    expect((await prisma.estimateLog.findUniqueOrThrow({ where: { id: fire.id } })).status).toBe("TEST_ONLY edited here");
    expect((await prisma.estimateLog.findFirstOrThrow({ where: { project: "TEST_ONLY Pricebook update" } })).status).toBe("TEST_ONLY sheet status");
    expect(await prisma.estimateLog.count({ where: { project: "TEST_ONLY Lost One" } })).toBe(0);
  });
});
