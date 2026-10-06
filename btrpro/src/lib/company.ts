// BTR's company facts from CLAUDE.md §1 — the defaults for the white-label profile (company-profile.ts). Not pricing data.
// Client-safe (no DB); server code reads getCompany() instead of these.
export const BTR = {
  name: "BTR Contracting",
  address: "10852 Hanover St., Omaha, NE 68142",
  phone: "402-739-9811",
  email: "trevin@btrcontracting.com",
  // letterhead on proposals, as on BTR's own estimate form
  proposalAddress: ["9350 G Court", "Omaha, NE 68127"],
  officePhone: "(402) 739-9811",
  abcAccount: "2057372-2",
  // BTR's own addresses (office, bill-to, shop — from CLAUDE.md and ABC's delivery tickets). Material shipped to
  // one of these says nothing about which job it's for, so receipt matching ignores them.
  ownAddresses: ["10852 Hanover St", "9350 G Ct", "2755 River Rd"],
} as const;

export const SUPPLIER = {
  name: "ABC Supply Branch #112",
  address: "13251 Lynam Dr, Omaha NE",
  phone: "402-734-1414",
  surchargeNote: "Credit card surcharge up to 3% where permitted; no surcharge on debit/ACH/check/cash.",
} as const;

/** Warning shown wherever a sheet issued to a different ABC account is used. `co` is the white-label company (default BTR). */
export function accountWarning(account: string | null | undefined, co: { shortName: string; abcAccount: string } = { shortName: "BTR", abcAccount: BTR.abcAccount }): string | null {
  if (!account || account.includes(co.abcAccount)) return null;
  const own = co.shortName.endsWith("s") ? `${co.shortName}'` : `${co.shortName}'s`;
  return `Sheet is issued to account ${account}, not ${own} ${co.abcAccount}. Confirm pricing applies to ${co.shortName} before bid use.`;
}
