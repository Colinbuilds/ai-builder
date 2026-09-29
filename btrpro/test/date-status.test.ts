// Acceptance test 8, using the real sheet dates from /data.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sheetDateStatus, todayInOmaha } from "@/lib/sheets/date-status";

const meta: Record<string, { effective: string; expiration: string }> = JSON.parse(
  readFileSync(new URL("../data/price_sheets_meta.json", import.meta.url), "utf8"),
).sheets;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const statusOn = (code: string, today: string) =>
  sheetDateStatus({ effectiveDate: d(meta[code].effective), expirationDate: d(meta[code].expiration) }, d(today));

describe("sheet date status", () => {
  it("all 6 sheets are STALE on 2026-09-29", () => {
    for (const code of ["MH", "EL", "SS", "HP", "HS"]) {
      expect(statusOn(code, "2026-09-29")).toMatchObject({ status: "STALE", ageDays: 133 });
    }
    expect(statusOn("NX", "2026-09-29")).toMatchObject({ status: "STALE", ageDays: 120 });
  });

  it("MH/EL/SS/HS become EXPIRING on 2026-12-05; HP and NX stay STALE", () => {
    for (const code of ["MH", "EL", "SS", "HS"]) expect(statusOn(code, "2026-12-05").status).toBe("EXPIRING");
    expect(statusOn("HP", "2026-12-05").status).toBe("STALE");
    expect(statusOn("NX", "2026-12-05").status).toBe("STALE");
  });

  it("is still valid on the expiration date and EXPIRED the day after", () => {
    expect(statusOn("MH", "2026-12-31").status).toBe("EXPIRING");
    expect(statusOn("MH", "2027-01-01").status).toBe("EXPIRED");
  });

  it("is CURRENT within the first quarter", () => {
    expect(statusOn("NX", "2026-08-30").status).toBe("CURRENT");
  });

  it("is UNKNOWN when a date is missing", () => {
    expect(sheetDateStatus({ effectiveDate: null, expirationDate: d("2027-01-01") }).status).toBe("UNKNOWN");
  });

  it("uses the Omaha calendar date, not UTC", () => {
    // 2026-09-30 03:00 UTC is still Sept 29 in Omaha (CDT, UTC-5)
    expect(todayInOmaha(new Date("2026-09-30T03:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-29");
  });
});
