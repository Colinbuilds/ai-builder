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
  qboItemId: string | null; // QuickBooks item used for invoice lines
  priceSheetFolder: string | null; // Google Drive folder the current ABC price sheets are dropped into
  priceSheetSyncUserId: string | null; // whose Drive connection reads that folder (the Admin who set it)
  acculynxCutoverDate: string | null; // YYYY-MM-DD; after it the AccuLynx copy output is retired
  priceSheetLastCheck: string | null; // ISO time of the last check
};
const KEYS: (keyof CompanySettings)[] = ["markupPct", "salesTaxPct", "depositPct", "proposalValidDays", "proposalTerms", "warrantyText", "overheadPct", "costVarianceThresholdPct", "supplierOrderEmail", "invoiceNetDays", "remitTo", "cardSurchargePct", "qboItemId", "priceSheetFolder", "priceSheetSyncUserId", "priceSheetLastCheck", "acculynxCutoverDate"];

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
      await prisma.auditLog.create({ data: { userId: user.id, entity: "CompanySetting", entityId: k, action: "update", before: { value: before?.value ?? null }, after: { value: v ?? null } } });
  }
}
