// Whether `prisma/seed.ts` loads BTR's data from /data (price sheets, company rules, estimate templates, labor
// rates, crews, companies, Drive folders). Only BTR's deployment gets it; another company starts empty.
//  1. SEED_COMPANY set: "btr" loads it, anything else ("blank", a company name) doesn't.
//  2. A saved company profile with another company's name: never.
//  3. Otherwise a database that already has users or price sheets is BTR's live one (it predates white-label),
//     so it keeps loading; a brand-new empty database starts blank. Rebuilding BTR from an empty database needs
//     SEED_COMPANY=btr.
export function seedsBtrData(x: { env: string | undefined; profileName: string | null; hasData: boolean }): boolean {
  const env = x.env?.trim().toLowerCase();
  if (env) return env === "btr";
  if (x.profileName && x.profileName !== "BTR Contracting") return false;
  return x.hasData;
}
