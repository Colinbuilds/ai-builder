// Fixed company facts from CLAUDE.md §1. Not pricing data.
export const BTR = {
  name: "BTR Contracting",
  address: "10852 Hanover St., Omaha, NE 68142",
  phone: "402-739-9811",
  email: "trevin@btrcontracting.com",
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

/** Warning shown wherever a sheet issued to a different ABC account is used. */
export function accountWarning(account: string | null | undefined): string | null {
  if (!account || account.includes(BTR.abcAccount)) return null;
  return `Sheet is issued to account ${account}, not BTR's ${BTR.abcAccount}. Confirm pricing applies to BTR before bid use.`;
}
