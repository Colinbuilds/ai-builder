import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { saveSettings } from "@/lib/settings";
import { pdfPages, columnSplit } from "@/lib/sheets/extract";
import { parseSheetText } from "@/lib/sheets/parse";
import { judgeSheet, sheetForFileName, syncPriceSheets } from "@/lib/sheets/drive-sync";

process.env.UPLOAD_DIR = "prisma/test-uploads";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:00:00Z"));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  vi.useRealTimers();
  return prisma.$disconnect();
});

describe("reading ABC two-column price lists", () => {
  it("splits side-by-side item lists and reads each column top to bottom", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const t = (s: string, x: number, y: number) => page.drawText(s, { x, y, size: 8, font });
    t("Customer Price List 2057372-2 - BTR Contracting-Shop Effective Date: 8/4/2026 Expiration Date: 12/31/2026", 40, 760);
    t("Sales Rep: Michael Poe", 40, 748);
    t("1", 40, 730);
    t("Malarkey", 55, 730);
    t("3", 320, 730);
    t("Tamko", 335, 730);
    const left = [
      ["02MLHLXAAB", "Highlander Nex AR 242 3/SQ", "$96.0000", "SQ"],
      ["02MLVIA3AB", "Vista AR 252 3/SQ", "$129.0000", "SQ"],
      ["03MLLAAB", "Legacy IR 4/SQ", "$183.0000", "SQ"],
    ];
    const right = [
      ["02TKFH2RB", "Heritage 30 AR 3/SQ", "$122.0000", "SQ"],
      ["02TKTXTAB", "Titan XT 3/SQ", "$129.0000", "SQ"],
      ["04TK10SS", "10\" Starter Shingle 100LF/BD", "$67.0000", "BD"],
    ];
    left.forEach((r, i) => {
      const y = 715 - i * 12;
      t(r[0], 40, y);
      t(r[1], 100, y);
      t(r[2], 230, y);
      t(r[3], 285, y);
      const q = right[i];
      t(q[0], 320, y);
      t(q[1], 380, y);
      t(q[2], 510, y);
      t(q[3], 565, y);
    });
    const text = (await pdfPages(await doc.save())).join("\n");
    const parsed = parseSheetText(text);
    expect(parsed.header).toMatchObject({ effective: "2026-08-04", expiration: "2026-12-31" });
    expect(parsed.rows.map((r) => [r.itemNumber, r.unitPrice, r.uom])).toEqual([
      ["02MLHLXAAB", 96, "SQ"],
      ["02MLVIA3AB", 129, "SQ"],
      ["03MLLAAB", 183, "SQ"],
      ["02TKFH2RB", 122, "SQ"],
      ["02TKTXTAB", 129, "SQ"],
      ["04TK10SS", 67, "BD"],
    ]);
  });

  it("leaves a normal one-column table alone (price column on the right isn't a second list)", () => {
    const lines = [0, 1, 2, 3].map((i) => ({ parts: [{ x: 40, s: `02MLVIA3A${i}` }, { x: 110, s: "Vista AR" }, { x: 420, s: "$129.00" }, { x: 520, s: "SQ" }] }));
    expect(columnSplit(lines, 612)).toBeNull();
  });
});

describe("deciding what to do with a sheet", () => {
  const header = { effective: "2026-08-04", expiration: "2026-12-31", account: null, salesRep: null };
  const row = (n: string, p: number) => ({ section: "S", itemNumber: n, description: `Item ${n}`, unitPrice: p, priceStatus: "LISTED" as const, uom: "EA", line: 1 });
  const liveItems = Array.from({ length: 20 }, (_, i) => ({ itemNumber: `IT${1000 + i}`, description: `Item IT${1000 + i}`, unitPrice: 10, priceStatus: "LISTED" as const, uom: "EA" }));
  it("applies a clean, newer sheet; skips one that isn't newer; holds doubtful ones", () => {
    const rows = liveItems.map((i) => row(i.itemNumber, 10.5));
    expect(judgeSheet({ header, rows, unparsed: [] }, { effectiveDate: new Date("2026-05-19"), items: liveItems }).action).toBe("APPLY");
    expect(judgeSheet({ header, rows, unparsed: [] }, { effectiveDate: new Date("2026-08-04"), items: liveItems }).action).toBe("SKIP");
    const halfGone = judgeSheet({ header, rows: rows.slice(0, 8), unparsed: [] }, { effectiveDate: new Date("2026-05-19"), items: liveItems });
    expect(halfGone).toMatchObject({ action: "HOLD" });
    expect(halfGone.reasons[0]).toMatch(/12 of 20 live items are missing/);
    const jumped = judgeSheet({ header, rows: liveItems.map((i, k) => row(i.itemNumber, k < 5 ? 20 : 10)), unparsed: [] }, { effectiveDate: new Date("2026-05-19"), items: liveItems });
    expect(jumped.reasons.join()).toMatch(/5 prices moved more than 25%/);
    expect(judgeSheet({ header: { ...header, effective: null }, rows, unparsed: [] }, null).reasons).toContain("no effective date found on the sheet");
  });
  it("knows the sheets by file name", () => {
    expect(sheetForFileName("BTR - Steep slope  (1).pdf")?.code).toBe("SS");
    expect(sheetForFileName("BTR - NDX Vinyl .pdf")?.code).toBe("NX");
    expect(sheetForFileName("BTR - Primed .pdf")?.code).toBe("HP");
    expect(sheetForFileName("BTR - Central States Metal  (1).pdf")?.code).toBe("CSM");
    expect(sheetForFileName("Cont Accessory Price List Sept 1 2026 (2).pdf")).toBeNull();
  });
});

describe("syncing the Drive folder", () => {
  const csv = (eff: string, items: [string, number][]) =>
    "sheet_code,sheet_name,section,item_number,description,unit_price,uom,price_status,effective_date,expiration_date\n" +
    items.map(([n, p]) => `CSM,BTR - Central States Metal,Panels,${n},TEST_ONLY panel ${n},${p},LF,LISTED,${eff},2026-12-31`).join("\n");
  const files: Record<string, { name: string; modifiedTime: string; body: string }> = {};
  function fakeDrive() {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("?alt=media")) {
        const id = url.split("/files/")[1].split("?")[0];
        return new Response(files[id].body, { status: 200 });
      }
      return new Response(JSON.stringify({ files: Object.entries(files).map(([id, f]) => ({ id, name: f.name, mimeType: "text/csv", modifiedTime: f.modifiedTime })) }), { status: 200 });
    });
  }

  it("puts a newer clean sheet live, ignores what it already saw or older files, flags unknown names, and holds big removals", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await prisma.integrationConnection.deleteMany({ where: { provider: "GOOGLE_DRIVE", userId: admin.id } });
    await prisma.integrationConnection.create({ data: { provider: "GOOGLE_DRIVE", userId: admin.id, accessToken: encrypt("TEST_ONLY"), expiresAt: new Date(Date.now() + 3600_000) } });
    await saveSettings({ priceSheetFolder: "https://drive.google.com/drive/folders/TESTONLYFOLDER123456", priceSheetSyncUserId: admin.id }, admin);
    const ten: [string, number][] = Array.from({ length: 10 }, (_, i) => [`CSMTEST${i}`, 5 + i]);
    files.a = { name: "BTR - Central States Metal TEST_ONLY.csv", modifiedTime: "2026-09-01T00:00:00Z", body: csv("2026-07-28", ten) };
    files.b = { name: "Cont Accessory Price List TEST_ONLY.pdf", modifiedTime: "2026-09-02T00:00:00Z", body: "x" };
    fakeDrive();
    const r1 = await syncPriceSheets();

    expect(r1).toMatchObject({ checked: 2, applied: ["CSM (BTR - Central States Metal TEST_ONLY.csv)"], unmatched: ["Cont Accessory Price List TEST_ONLY.pdf"] });
    const live = await prisma.priceSheet.findFirstOrThrow({ where: { code: "CSM", isActive: true }, include: { _count: { select: { items: true } } } });
    expect(live._count.items).toBe(10);
    expect(live.effectiveDate?.toISOString().slice(0, 10)).toBe("2026-07-28");
    expect((await syncPriceSheets()).checked).toBe(0);
    // an older copy uploaded later is ignored
    files.c = { name: "BTR - Central States Metal old TEST_ONLY.csv", modifiedTime: "2026-09-03T00:00:00Z", body: csv("2026-05-01", ten) };
    expect((await syncPriceSheets()).skipped).toBe(1);
    // a newer one missing most items is held for review, not applied
    files.d = { name: "BTR - Central States Metal Oct TEST_ONLY.csv", modifiedTime: "2026-10-01T00:00:00Z", body: csv("2026-10-01", ten.slice(0, 3)) };
    const r4 = await syncPriceSheets();
    expect(r4.held).toEqual(["BTR - Central States Metal Oct TEST_ONLY.csv"]);
    expect((await prisma.priceSheet.findFirstOrThrow({ where: { code: "CSM", isActive: true } })).id).toBe(live.id);
    const held = await prisma.driveSheetFile.findFirstOrThrow({ where: { driveFileId: "d" } });
    expect(held.message).toMatch(/7 of 10 live items are missing/);
    await saveSettings({ priceSheetFolder: null, priceSheetSyncUserId: null }, admin);
  });
});
