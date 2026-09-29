// Sheet date status (BUILD_PROMPT §1), checked against today's date in Omaha.
export type SheetDateStatus = "EXPIRED" | "EXPIRING" | "STALE" | "CURRENT" | "UNKNOWN";

const DAY = 86_400_000;
export const EXPIRING_WITHIN_DAYS = 30;
export const STALE_AFTER_DAYS = 90;

/** Today's calendar date in America/Chicago, as UTC midnight (same convention as stored sheet dates). */
export function todayInOmaha(now = new Date()): Date {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00Z`);
}

const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);

export type SheetDates = { effectiveDate: Date | null; expirationDate: Date | null };

export function sheetDateStatus(sheet: SheetDates, today: Date = todayInOmaha()) {
  const { effectiveDate, expirationDate } = sheet;
  const ageDays = effectiveDate ? days(effectiveDate, today) : null;
  const daysToExpire = expirationDate ? days(today, expirationDate) : null;
  let status: SheetDateStatus;
  if (ageDays == null || daysToExpire == null) status = "UNKNOWN";
  else if (daysToExpire < 0) status = "EXPIRED";
  else if (daysToExpire <= EXPIRING_WITHIN_DAYS) status = "EXPIRING";
  else if (ageDays > STALE_AFTER_DAYS) status = "STALE";
  else status = "CURRENT";
  return { status, ageDays, daysToExpire };
}

export function describeDateStatus({ status, ageDays, daysToExpire }: ReturnType<typeof sheetDateStatus>) {
  switch (status) {
    case "EXPIRED":
      return `Expired ${-daysToExpire!} days ago. Upload current pricing before bidding.`;
    case "EXPIRING":
      return `Expires in ${daysToExpire} days. Request updated pricing.`;
    case "STALE":
      return `Effective ${ageDays} days ago (over a quarter). Upload updated quarterly pricing before finalizing bid numbers.`;
    case "UNKNOWN":
      return "Effective or expiration date missing. Confirm the sheet dates.";
    default:
      return `Current, expires in ${daysToExpire} days.`;
  }
}

export const dateStatusVariant = (s: SheetDateStatus) =>
  s === "CURRENT" ? "green" : s === "EXPIRED" || s === "UNKNOWN" ? "red" : "amber";
