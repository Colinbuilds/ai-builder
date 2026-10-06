// Names for copy in modules shared by server and browser code (no DB imports). On the server they come from the
// company profile last read (company-profile.ts); in the browser, from the BrandProvider the root layout renders.
// With neither, they're BTR's.
import { REGIONS, type Region } from "@/lib/region";

type Live = { productName: string; assistantName: string; name: string; shortName: string; region?: Region };
type BrandGlobal = { productName: string; assistantName: string; companyName: string; shortName: string };
const g = globalThis as unknown as { __company?: Live; __brand?: BrandGlobal };
const BTR_NAMES: Live = { productName: "BTRpro", assistantName: "BTRbot", name: "BTR Contracting", shortName: "BTR" };

function live(): Live {
  if (g.__company) return g.__company;
  const b = g.__brand;
  return b ? { productName: b.productName, assistantName: b.assistantName, name: b.companyName, shortName: b.shortName } : BTR_NAMES;
}

/** Product and assistant names ("BTRpro" / "BTRbot" by default). */
export const appName = () => live().productName;
export const botName = () => live().assistantName;
/** Company name ("BTR Contracting") and short name ("BTR"). */
export const companyName = () => live().name;
export const shortName = () => live().shortName;

/** The state's tax-exempt purchasing form: "Form 17" / "Nebraska Form 17" / the full title for BTR. */
export const exemptForm = () =>
  (g.__company?.region ? g.__company.region.exemptForm : REGIONS.NE.exemptForm) ?? {
    short: "tax-exempt form",
    named: "The tax-exempt purchasing form",
    title: "tax-exempt purchasing form (none set for this state — confirm with the owner)",
  };

/** Browser side: the root layout's BrandProvider hands the names over before children render. */
export function setBrowserBrand(b: BrandGlobal) {
  g.__brand = b;
}
