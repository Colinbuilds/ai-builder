// Upload → apply → re-upload, against the seeded test DB. Uses a TEST_ONLY sheet code so the real sheets stay intact.
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { applyImport, createImport, ImportError } from "@/lib/sheets/imports";
import type { ParsedHeader, ParsedRow } from "@/lib/sheets/parse";

process.env.UPLOAD_DIR = "prisma/test-uploads";
afterAll(() => prisma.$disconnect());

const zip = readFileSync(new URL("fixtures/TEST_ONLY_steep_slope_zip.pdf", import.meta.url));
const admin = () => prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

async function upload(code: string) {
  const u = await admin();
  return createImport({ bytes: zip, fileName: "BTR Steep slope.pdf", code, name: "TEST_ONLY Sheet", userId: u.id });
}

describe("sheet import", () => {
  it("parses an upload into a draft without touching live data", async () => {
    const before = await prisma.priceItem.count();
    const imp = await upload("ZZ");
    expect(imp.status).toBe("DRAFT");
    expect(imp.format).toBe("ZIP_TXT");
    expect((imp.rows as ParsedRow[]).length).toBe(17);
    expect(await prisma.priceItem.count()).toBe(before);
  });

  it("applies a reviewed upload, then replaces it with a new version", async () => {
    const u = await admin();
    const first = await upload("ZY");
    const r1 = await applyImport(
      first.id,
      { name: "TEST_ONLY Sheet", scope: null, header: first.header as ParsedHeader, rows: first.rows as ParsedRow[] },
      u.id,
    );
    expect(r1.summary).toMatchObject({ items: 17, added: 17, removed: 0 });
    const vista = await prisma.priceItem.findFirstOrThrow({ where: { sheetId: r1.sheet.id, itemNumber: "02MLVIA3AB" } });
    expect(vista).toMatchObject({ coverageQty: 3, coverageUnit: "BD/SQ", coverageSource: "PARSED_FROM_DESCRIPTION" });
    // a user enters coverage for an item the parser can't read
    await prisma.priceItem.updateMany({
      where: { sheetId: r1.sheet.id, itemNumber: "0150080011" },
      data: { coverageQty: 120, coverageUnit: "EA/BX", coverageSource: "USER_ENTERED" },
    });

    const second = await upload("ZY");
    const rows = (second.rows as ParsedRow[])
      .filter((r) => r.itemNumber !== "0150080010")
      .map((r) => (r.itemNumber === "4292804534" ? { ...r, unitPrice: 21.99 } : r));
    const r2 = await applyImport(
      second.id,
      { name: "TEST_ONLY Sheet", scope: null, header: second.header as ParsedHeader, rows },
      u.id,
    );
    expect(r2.summary).toMatchObject({ items: 16, added: 0, removed: 1, changed: 1 });

    const live = await prisma.priceSheet.findMany({ where: { code: "ZY", isActive: true } });
    expect(live.map((s) => s.id)).toEqual([r2.sheet.id]);
    expect((await prisma.priceSheet.findUniqueOrThrow({ where: { id: r1.sheet.id } })).replacedAt).not.toBeNull();
    const coil = await prisma.priceItem.findFirstOrThrow({ where: { sheetId: r2.sheet.id, itemNumber: "0150080011" } });
    expect(coil).toMatchObject({ coverageQty: 120, coverageSource: "USER_ENTERED" });
    expect(await prisma.auditLog.count({ where: { action: "apply_import" } })).toBeGreaterThanOrEqual(2);
  });

  it("refuses to apply twice, or without dates", async () => {
    const u = await admin();
    const imp = await upload("ZX");
    const header = { ...(imp.header as ParsedHeader), expiration: null };
    await expect(
      applyImport(imp.id, { name: "x", scope: null, header, rows: imp.rows as ParsedRow[] }, u.id),
    ).rejects.toThrow(/Expiration date is required/);
    const ok = { name: "x", scope: null, header: imp.header as ParsedHeader, rows: imp.rows as ParsedRow[] };
    await applyImport(imp.id, ok, u.id);
    await expect(applyImport(imp.id, ok, u.id)).rejects.toBeInstanceOf(ImportError);
  });

  it("warns when a sheet is issued to another account", async () => {
    const u = await admin();
    const imp = await upload("ZW");
    const header = { ...(imp.header as ParsedHeader), account: "2182359-2 Jims Roofing & Contrctng" };
    const { sheet } = await applyImport(imp.id, { name: "x", scope: null, header, rows: imp.rows as ParsedRow[] }, u.id);
    expect(sheet.warning).toMatch(/not BTR's 2057372-2/);
  });
});
