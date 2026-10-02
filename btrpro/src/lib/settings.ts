import { prisma } from "@/lib/db";

// Company settings (Admin). Nothing is assumed: an unset value stays null and whatever needs it says so.
export type CompanySettings = {
  markupPct: number | null;
  salesTaxPct: number | null; // applied to materials unless the job is tax-exempt
  depositPct: number | null;
  proposalValidDays: number | null;
  proposalTerms: string | null;
  warrantyText: string | null;
  overheadPct: number | null; // company overhead as % of revenue; net profit is MISSING until set
  costVarianceThresholdPct: number | null; // flag a cost category when it runs this far over estimate
  supplierOrderEmail: string | null; // where material orders are emailed (ABC branch order desk)
  invoiceNetDays: number | null; // due date = issue date + this many days
  remitTo: string | null; // payment instructions printed on invoices (check address, ACH)
  cardSurchargePct: number | null; // card surcharge on customer card payments, only where permitted; null = none
  qboItemId: string | null; // QuickBooks item used for invoice and estimate lines
  qboExpenseAccountId: string | null; // QuickBooks expense account receipts are booked to (job materials / COGS)
  qboPaymentAccountId: string | null; // QuickBooks account receipts were paid from (credit card, bank, or A/P)
  receiptMarkupPct: number | null; // markup billed on receipt materials (change orders / invoices); blank = 15%
  priceSheetFolder: string | null; // Google Drive folder the current ABC price sheets are dropped into
  priceSheetSyncUserId: string | null; // whose Drive connection reads that folder (the Admin who set it)
  companyCamDriveFolder: string | null; // Drive folder CompanyCam syncs project photo folders into
  iceWaterEavesFt: number | null; // company standard: ice & water width up from the eaves, in feet
  iceWaterValleysFt: number | null; // company standard: ice & water width in valleys, in feet
  priceSheetLastCheck: string | null; // ISO time of the last check
  takeoffAllowancePct: number | null; // added on top of plan-takeoff totals so they land slightly over; blank = 1%
  billOwnerOver: number | null; // supplier bills over this total need an owner's approval; blank = none
  billNetDays: number | null; // supplier terms when the invoice prints no due date: due = invoice date + days; blank = MISSING
  estimatingSheet: string | null; // the team's Google estimating schedule; blank = the BTR Estimating Schedule
  estimatingSyncedAt: string | null; // ISO time of the last sheet sync
  estimatingSheetOff: boolean | null; // true once BTRpro is the estimating schedule (stops the sheet sync)
  prodResSheet: string | null; // BTR Residential Schedule_Live_ link; blank = the default
  prodCommSheet: string | null; // BTR Commercial Schedule_Live_ link; blank = the default
  prodSyncedAt: string | null;
  prodSheetOff: boolean | null; // true once BTRpro is the production schedule
  abcBillTo: string | null; // ABC Supply bill-to account number (invoice history is read for it)
  abcSyncedAt: string | null; // ISO time of the last ABC background sync
  abcSyncError: string | null; // last ABC sync problem, cleared on success
  jobsDriveId: string | null; // the shared drive (or folder) holding one folder per job; blank = BTR's jobs drive
  driveImportMonths: number | null; // how far back the Drive job import looks; blank = 12
  driveImportOn: boolean | null; // true while the background import is running
  driveImportScannedAt: string | null;
  cashOnHand: number | null; // bank balance for the 13-week forecast
  cashAsOf: string | null; // when that balance was read (ISO date)
  weeklyPayroll: number | null; // in-house payroll per week (office + W-2 crews), all-in
  monthlyOverhead: number | null; // rent, insurance, trucks, software… per month
  cashFloor: number | null; // the lowest balance you're comfortable with
  suretyName: string | null; // bonding company / agent
  bondSingleLimit: number | null; // largest single bonded job the surety will write (from their letter)
  bondAggregateLimit: number | null; // total bonded work-in-progress allowed (from their letter)
  workingCapital: number | null; // current assets − current liabilities, from the last CPA statement
  netWorth: number | null; // equity, from the last CPA statement
  financialsAsOf: string | null; // date of that statement (ISO)
  bidRadiusMiles: number | null; // public bids: straight-line miles from Omaha or Lincoln (blank = 125, about 2 hours' drive)
  bidsCheckedAt: string | null; // ISO time of the last full bid-board check
};
const KEYS: (keyof CompanySettings)[] = ["markupPct", "salesTaxPct", "depositPct", "proposalValidDays", "proposalTerms", "warrantyText", "overheadPct", "costVarianceThresholdPct", "supplierOrderEmail", "invoiceNetDays", "remitTo", "cardSurchargePct", "qboItemId", "qboExpenseAccountId", "qboPaymentAccountId", "receiptMarkupPct", "priceSheetFolder", "priceSheetSyncUserId", "priceSheetLastCheck", "iceWaterEavesFt", "iceWaterValleysFt", "companyCamDriveFolder", "takeoffAllowancePct", "billOwnerOver", "billNetDays", "estimatingSheet", "estimatingSyncedAt", "estimatingSheetOff", "prodResSheet", "prodCommSheet", "prodSyncedAt", "prodSheetOff", "abcBillTo", "abcSyncedAt", "abcSyncError", "jobsDriveId", "driveImportMonths", "driveImportOn", "driveImportScannedAt", "cashOnHand", "cashAsOf", "weeklyPayroll", "monthlyOverhead", "cashFloor", "suretyName", "bondSingleLimit", "bondAggregateLimit", "workingCapital", "netWorth", "financialsAsOf", "bidRadiusMiles", "bidsCheckedAt"];

export async function getSettings(): Promise<CompanySettings> {
  const rows = await prisma.companySetting.findMany({ where: { key: { in: KEYS } } });
  const out = Object.fromEntries(KEYS.map((k) => [k, null])) as CompanySettings;
  for (const r of rows) (out as Record<string, unknown>)[r.key] = r.value;
  return out;
}

export async function saveSettings(patch: Partial<CompanySettings>, user: { id: string; name: string }) {
  for (const [k, v] of Object.entries(patch)) {
    if (!KEYS.includes(k as keyof CompanySettings)) continue;
    const before = await prisma.companySetting.findUnique({ where: { key: k } });
    if (v == null || v === "") await prisma.companySetting.deleteMany({ where: { key: k } });
    else await prisma.companySetting.upsert({ where: { key: k }, update: { value: v, updatedBy: user.name }, create: { key: k, value: v, updatedBy: user.name } });
    if (JSON.stringify(before?.value ?? null) !== JSON.stringify(v ?? null))
      // background syncs save as a system actor with no user id
      await prisma.auditLog.create({ data: { userId: user.id || null, entity: "CompanySetting", entityId: k, action: "update", before: { value: before?.value ?? null }, after: { value: v ?? null } } });
  }
}
