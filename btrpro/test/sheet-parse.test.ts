import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractSheetText } from "@/lib/sheets/extract";
import { parseHeader, parsePriceCsv, parseSheetText } from "@/lib/sheets/parse";
import { diffSheet, validateRows, type DiffItem } from "@/lib/sheets/diff";
import { UOMS } from "@/lib/sheets/parse";

type Raw = { sheet_code: string; section: string; item_number: string; description: string; unit_price: number | null; uom: string; price_status: string };
const items: Raw[] = JSON.parse(readFileSync(new URL("../data/price_items.json", import.meta.url), "utf8")).items;
const fixtureRows = items.filter(
  (i) => i.sheet_code === "SS" && ["Malarkey", "Roofing Nails", "Plastic Cap Nails"].includes(i.section),
);
const fixture = (f: string) => readFileSync(new URL(`fixtures/${f}`, import.meta.url));

function expectMatchesData(rows: ReturnType<typeof parseSheetText>["rows"]) {
  expect(rows.map((r) => r.itemNumber)).toEqual(fixtureRows.map((i) => i.item_number));
  rows.forEach((r, k) => {
    const src = fixtureRows[k];
    expect(r).toMatchObject({ section: src.section, description: src.description, unitPrice: src.unit_price, uom: src.uom });
  });
}

describe("extract + parse TEST_ONLY fixtures built from real SS rows", () => {
  it("detects a ZIP container disguised as .pdf and parses its .txt pages", async () => {
    const { format, text } = await extractSheetText(fixture("TEST_ONLY_steep_slope_zip.pdf"), "x.pdf");
    expect(format).toBe("ZIP_TXT");
    const r = parseSheetText(text);
    expectMatchesData(r.rows);
    expect(r.header).toEqual({
      effective: "2026-05-19",
      expiration: "2026-12-31",
      account: "2057372-2 BTR Contracting-Shop",
      salesRep: "Michael Poe",
    });
  });

  it("reads a real PDF, rejoining descriptions that wrap inside a table cell", async () => {
    const { format, text } = await extractSheetText(fixture("TEST_ONLY_steep_slope.pdf"), "x.pdf");
    expect(format).toBe("PDF");
    const r = parseSheetText(text);
    expectMatchesData(r.rows);
    expect(r.rows.some((x) => x.wrapped)).toBe(true);
    expect(r.rows.some((x) => x.description.includes("Page"))).toBe(false); // footer never glued onto a row
  });
});

describe("parseSheetText", () => {
  it("parses CALL rows with no price and prices with commas", () => {
    const r = parseSheetText("4. Soffit\n25H5SSC6AW Soffit CM Solid 16\"X12' CALL PNL\n99TEST0001 TEST_ONLY big item $1,234.50 EA");
    expect(r.rows).toEqual([
      expect.objectContaining({ section: "Soffit", itemNumber: "25H5SSC6AW", unitPrice: null, priceStatus: "CALL", uom: "PNL" }),
      expect.objectContaining({ itemNumber: "99TEST0001", unitPrice: 1234.5, priceStatus: "LISTED", uom: "EA" }),
    ]);
  });

  it("accepts 'CALL FOR PRICE'", () => {
    const r = parseSheetText("08FSHDF9 Elevt 9\" Heavy Duty Fastener 5C CALL FOR PRICE BX");
    expect(r.rows[0]).toMatchObject({ itemNumber: "08FSHDF9", priceStatus: "CALL", uom: "BX" });
  });

  it("reports a row that never gets a UOM instead of guessing one", () => {
    const r = parseSheetText("99TEST0002 TEST_ONLY no uom $5.00\n99TEST0003 TEST_ONLY ok $6.00 EA");
    expect(r.rows.map((x) => x.itemNumber)).toEqual(["99TEST0003"]);
    expect(r.unparsed.map((u) => u.text)).toContain("99TEST0002 TEST_ONLY no uom $5.00");
  });

  it("parses header dates in several formats", () => {
    expect(parseHeader("Effective: 06/01/26\nExpires: 2028-12-31")).toMatchObject({
      effective: "2026-06-01",
      expiration: "2028-12-31",
    });
    expect(parseHeader("no dates here")).toMatchObject({ effective: null, expiration: null });
  });
});

describe("parsePriceCsv", () => {
  it("round-trips data/price_items.csv", () => {
    const r = parsePriceCsv(readFileSync(new URL("../data/price_items.csv", import.meta.url), "utf8"))!;
    expect(r.rows).toHaveLength(527);
    expect(r.rows.filter((x) => x.priceStatus === "CALL")).toHaveLength(8);
    expect(r.rows.find((x) => x.itemNumber === "4292804534")).toMatchObject({ unitPrice: 19.99, uom: "BX" });
  });
  it("returns null for a CSV without the expected columns", () => {
    expect(parsePriceCsv("a,b\n1,2")).toBeNull();
  });
});

describe("diffSheet", () => {
  const toDiff = (i: Raw): DiffItem => ({
    itemNumber: i.item_number,
    description: i.description,
    unitPrice: i.unit_price,
    priceStatus: i.price_status === "LISTED" ? "LISTED" : "CALL",
    uom: i.uom,
  });
  const old = fixtureRows.map(toDiff);

  it("finds added, removed, and price changes with % change", () => {
    const next = old
      .filter((i) => i.itemNumber !== "0150080010")
      .map((i) => (i.itemNumber === "4292804534" ? { ...i, unitPrice: 21.99 } : i));
    next.push({ itemNumber: "99TEST0004", description: "TEST_ONLY new", unitPrice: 1, priceStatus: "LISTED", uom: "EA" });
    const d = diffSheet(old, next);
    expect(d.added.map((i) => i.itemNumber)).toEqual(["99TEST0004"]);
    expect(d.removed.map((i) => i.itemNumber)).toEqual(["0150080010"]);
    expect(d.changed).toEqual([expect.objectContaining({ itemNumber: "4292804534", fields: ["price"], pctChange: 10 })]);
    expect(d.unchanged).toBe(old.length - 2);
  });

  it("flags UOM changes rather than converting", () => {
    const d = diffSheet(old, old.map((i) => (i.itemNumber === "0150080011" ? { ...i, uom: "PA" } : i)));
    expect(d.changed[0]).toMatchObject({ itemNumber: "0150080011", fields: ["uom"] });
  });

  it("validateRows blocks duplicates, bad UOMs, and missing prices", () => {
    const errs = validateRows(
      [
        { itemNumber: "A1234", description: "x", unitPrice: 1, priceStatus: "LISTED", uom: "EA" },
        { itemNumber: "A1234", description: "x", unitPrice: null, priceStatus: "LISTED", uom: "FT" },
      ],
      UOMS,
    );
    expect(errs.join("\n")).toMatch(/more than once/);
    expect(errs.join("\n")).toMatch(/UOM "FT"/);
    expect(errs.join("\n")).toMatch(/price must be a number/);
  });
});
