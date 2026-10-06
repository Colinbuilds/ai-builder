// White-label company profile. One deployment runs one company; its profile lives in CompanySetting
// ("companyProfile", a partial object) so no schema change is needed. Anything left unset is BTR's value, so a
// deployment with no profile behaves exactly as BTRpro always has.
import { prisma } from "@/lib/db";
import { BTR, SUPPLIER } from "@/lib/company";
import { regionFor, type Region } from "@/lib/region";
import { readUpload, saveUpload } from "@/lib/storage";
import { saveSettings } from "@/lib/settings";

export { appName, botName, companyName, shortName, exemptForm } from "@/lib/brand-names";

export type CompanyProfile = {
  name: string;
  shortName: string; // "BTR" in copy like "BTR's account"
  productName: string;
  assistantName: string;
  address: string;
  phone: string;
  email: string;
  proposalAddress: string[]; // letterhead lines on proposals
  officePhone: string;
  abcAccount: string; // primary supplier account number on orders and price sheets
  ownAddresses: string[]; // office / shop / bill-to; receipt matching ignores material shipped to these
  supplier: { name: string; address: string; phone: string; surchargeNote: string };
  state: string; // two-letter; picks the region rules
  jurisdiction: string; // default jurisdiction for code questions
  lienDays: number | null; // overrides the state's lien deadline
  brandColor: string | null; // #rrggbb accent (buttons, links); null = BTR blue
  headerColor: string | null; // #rrggbb top bar; null = BTR black
  logo: string | null; // uploaded PNG/JPEG (storage url); null = the BTR wordmark / logo
};

/** The CRM sold to other companies. BTR's deployment keeps BTRpro / BTRbot. */
export const PRODUCT = { name: "Joblight", assistant: "Lumen" } as const;

export const DEFAULT_PROFILE: CompanyProfile = {
  name: BTR.name,
  shortName: "BTR",
  productName: "BTRpro",
  assistantName: "BTRbot",
  address: BTR.address,
  phone: BTR.phone,
  email: BTR.email,
  proposalAddress: [...BTR.proposalAddress],
  officePhone: BTR.officePhone,
  abcAccount: BTR.abcAccount,
  ownAddresses: [...BTR.ownAddresses],
  supplier: { ...SUPPLIER },
  state: "NE",
  jurisdiction: "Omaha, NE",
  lienDays: null,
  brandColor: null,
  headerColor: null,
  logo: null,
};

export type Company = CompanyProfile & { region: Region };

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const lines = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : typeof v === "string" ? v.split("\n").map((x) => x.trim()).filter(Boolean) : []);

/**
 * Saved partial profile → full profile. Unset or invalid fields fall back to BTR's values while the company is BTR
 * (no other name saved). For another company, BTR's contact facts, supplier and state never fill in: they're blank,
 * and whatever needs them says MISSING. Product and assistant names: BTRpro / BTRbot for BTR, the product's own
 * Joblight / Lumen for every other company (each can rename them).
 */
export function resolveProfile(saved: unknown): Company {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const isBtr = !str(s.name) || str(s.name) === DEFAULT_PROFILE.name;
  const d: CompanyProfile = isBtr
    ? DEFAULT_PROFILE
    : { ...DEFAULT_PROFILE, productName: PRODUCT.name, assistantName: PRODUCT.assistant, address: "", phone: "", email: "", proposalAddress: [], officePhone: "", abcAccount: "", ownAddresses: [], supplier: { name: "", address: "", phone: "", surchargeNote: "" }, state: "", jurisdiction: "" };
  const sup = (s.supplier && typeof s.supplier === "object" ? s.supplier : {}) as Record<string, unknown>;
  const pa = lines(s.proposalAddress);
  const own = lines(s.ownAddresses);
  const lien = Number(s.lienDays);
  const p: CompanyProfile = {
    name: str(s.name) ?? d.name,
    shortName: str(s.shortName) ?? (str(s.name) ?? d.shortName),
    productName: str(s.productName) ?? d.productName,
    assistantName: str(s.assistantName) ?? d.assistantName,
    address: str(s.address) ?? d.address,
    phone: str(s.phone) ?? d.phone,
    email: str(s.email) ?? d.email,
    proposalAddress: pa.length ? pa : d.proposalAddress,
    officePhone: str(s.officePhone) ?? str(s.phone) ?? d.officePhone,
    abcAccount: str(s.abcAccount) ?? d.abcAccount,
    ownAddresses: own.length ? own : d.ownAddresses,
    supplier: {
      name: str(sup.name) ?? d.supplier.name,
      address: str(sup.address) ?? d.supplier.address,
      phone: str(sup.phone) ?? d.supplier.phone,
      surchargeNote: str(sup.surchargeNote) ?? d.supplier.surchargeNote,
    },
    state: (str(s.state) ?? d.state).toUpperCase(),
    jurisdiction: str(s.jurisdiction) ?? (d.jurisdiction || (str(s.state) ?? "").toUpperCase()),
    lienDays: Number.isFinite(lien) && lien > 0 ? Math.round(lien) : null,
    brandColor: str(s.brandColor) && HEX.test(String(s.brandColor).trim()) ? String(s.brandColor).trim() : null,
    headerColor: str(s.headerColor) && HEX.test(String(s.headerColor).trim()) ? String(s.headerColor).trim() : null,
    logo: str(s.logo) ?? null,
  };
  return { ...p, region: regionFor(p.state, { lienDays: p.lienDays }) };
}

const g = globalThis as unknown as { __company?: Company };

/** The company this deployment runs for. Reads settings on every call (one row by key). */
export async function getCompany(): Promise<Company> {
  const row = await prisma.companySetting.findUnique({ where: { key: "companyProfile" } });
  return (g.__company = resolveProfile(row?.value ?? null));
}

/**
 * Last profile read in this process, for sync code (error messages, labels inside sync helpers). Every page
 * render reads the profile first, so this is current in practice; before the first read it is BTR's.
 */
export function companySync(): Company {
  return (g.__company ??= resolveProfile(null));
}

export function resetCompanyCacheForTests() {
  g.__company = undefined;
}

/** CSS variables for the brand colors. Empty when none are set, so BTR's stylesheet is untouched. */
export function brandCss(c: Pick<CompanyProfile, "brandColor" | "headerColor">): string {
  const vars: string[] = [];
  if (c.brandColor && HEX.test(c.brandColor)) {
    const b = c.brandColor;
    vars.push(`--btr-blue:${b}`, `--btr-blue-dark:color-mix(in srgb,${b} 82%,black)`, `--btr-blue-soft:color-mix(in srgb,${b} 12%,white)`, `--btr-link:color-mix(in srgb,${b} 82%,black)`);
  }
  if (c.headerColor && HEX.test(c.headerColor)) vars.push(`--btr-black:${c.headerColor}`);
  return vars.length ? `:root{${vars.join(";")}}` : "";
}

/** "BTR's" / "Acme's" — possessive short name for copy. */
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The uploaded logo's bytes and type, or null when none is set (callers then use BTR's logo). */
export async function companyLogo(c: Pick<CompanyProfile, "logo">): Promise<{ bytes: Buffer; type: "png" | "jpg" } | null> {
  if (!c.logo) return null;
  try {
    const bytes = await readUpload(c.logo);
    if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { bytes, type: "png" };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: "jpg" };
  } catch {
    // a missing upload falls back to the default logo
  }
  return null;
}

export class ProfileError extends Error {}
const TEXT_FIELDS = ["name", "shortName", "productName", "assistantName", "address", "phone", "email", "officePhone", "abcAccount", "state", "jurisdiction", "brandColor", "headerColor"] as const;
const LOGO_MAX = 2_000_000;

/**
 * Saves the profile from the Settings form. Blank fields are left out, so they fall back to BTR's values;
 * an all-blank form clears the profile entirely. `aiRules` blank = the built-in prompt (CLAUDE.md for BTR).
 */
export async function saveCompanyProfile(
  input: Partial<Record<(typeof TEXT_FIELDS)[number] | "proposalAddress" | "ownAddresses" | "lienDays" | "supplierName" | "supplierAddress" | "supplierPhone" | "supplierNote" | "aiRules", string>>,
  logo: { bytes: Uint8Array; name: string } | null,
  opts: { removeLogo?: boolean },
  user: { id: string; name: string },
) {
  const t = (k: keyof typeof input) => (input[k] ?? "").trim();
  const problems: string[] = [];
  const out: Record<string, string | number | string[] | Record<string, string>> = {};
  for (const k of TEXT_FIELDS) if (t(k)) out[k] = t(k);
  if (out.state && !/^[A-Za-z]{2}$/.test(String(out.state))) problems.push("State is the two-letter code (e.g. NE).");
  if (out.state) out.state = String(out.state).toUpperCase();
  for (const k of ["brandColor", "headerColor"] as const) if (out[k] && !HEX.test(String(out[k]))) problems.push("Colors are #rrggbb (e.g. #1f6fd1).");
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(out.email))) problems.push("Email doesn't look right.");
  if (t("lienDays")) {
    const d = Number(t("lienDays"));
    if (!Number.isInteger(d) || d < 1 || d > 730) problems.push("Lien days is a whole number of days (1–730).");
    else out.lienDays = d;
  }
  const pa = lines(t("proposalAddress"));
  if (pa.length) out.proposalAddress = pa;
  const own = lines(t("ownAddresses"));
  if (own.length) out.ownAddresses = own;
  const sup: Record<string, string> = {};
  if (t("supplierName")) sup.name = t("supplierName");
  if (t("supplierAddress")) sup.address = t("supplierAddress");
  if (t("supplierPhone")) sup.phone = t("supplierPhone");
  if (t("supplierNote")) sup.surchargeNote = t("supplierNote");
  if (Object.keys(sup).length) out.supplier = sup;

  const current = await prisma.companySetting.findUnique({ where: { key: "companyProfile" } });
  const prevLogo = str((current?.value as Record<string, unknown> | null)?.logo);
  if (logo && logo.bytes.length) {
    const b = Buffer.from(logo.bytes);
    const png = b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpg = b[0] === 0xff && b[1] === 0xd8;
    if (!png && !jpg) problems.push("The logo must be a PNG or JPEG.");
    else if (b.length > LOGO_MAX) problems.push("The logo must be under 2 MB.");
    else if (!problems.length) out.logo = await saveUpload(logo.bytes, logo.name, "brand");
  } else if (prevLogo && !opts.removeLogo) out.logo = prevLogo;
  if (problems.length) throw new ProfileError(problems.join(" "));

  await saveSettings({ companyProfile: Object.keys(out).length ? (out as never) : null, aiRules: t("aiRules") || null }, user);
  return getCompany();
}
