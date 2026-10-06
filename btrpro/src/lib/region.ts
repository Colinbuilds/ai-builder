// Region rules as data: things that change with the state a company works in. Only states whose rules have been
// checked against the statute are listed; any other state gets nulls, and whatever needs a value says MISSING
// instead of guessing. The company profile can override the lien days.
export type Region = {
  state: string; // two-letter code
  name: string;
  /** Mechanic's / construction lien recording deadline after last furnishing labor or materials. */
  lien: { days: number; statute: string; url: string; summary: string } | null;
  /** Paperwork that lets a contractor buy materials tax-free for a tax-exempt public owner. */
  exemptForm: { short: string; named: string; title: string } | null;
  /** Which code editions the home jurisdiction enforces, told to the AI on code questions. */
  codeNote: string | null;
};

export const REGIONS: Record<string, Region> = {
  NE: {
    state: "NE",
    name: "Nebraska",
    lien: {
      days: 120,
      statute: "Neb. Rev. Stat. § 52-137",
      url: "https://nebraskalegislature.gov/laws/statutes.php?statute=52-137",
      summary: "record within 120 days of last work, or the lien right is gone",
    },
    exemptForm: { short: "Form 17", named: "Nebraska Form 17", title: "Nebraska Form 17 Purchasing Agent Appointment" },
    codeNote: "Omaha enforces the 2018 IBC and 2018 IRC, the 2018 IECC for commercial work",
  },
};

export function regionFor(state: string | null | undefined, overrides: { lienDays?: number | null } = {}): Region {
  const code = (state ?? "").trim().toUpperCase();
  const base: Region = REGIONS[code] ?? { state: code, name: code || "MISSING", lien: null, exemptForm: null, codeNote: null };
  if (overrides.lienDays != null && overrides.lienDays > 0) {
    const lien = base.lien && base.lien.days === overrides.lienDays ? base.lien : { days: overrides.lienDays, statute: "company setting", url: "", summary: `record within ${overrides.lienDays} days of last work (company setting)` };
    return { ...base, lien };
  }
  return base;
}
