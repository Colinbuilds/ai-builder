// Code & spec library: where the code in force, the manufacturer's installation rules and the standards live,
// plus BTRbot research that searches the live web (and the job's own spec book) and answers with sources.
// Answers cite the edition the jurisdiction actually adopted; anything BTRbot can't verify is marked so.
import { prisma } from "@/lib/db";
import { aiResearch } from "@/lib/ai/claude";

export type Ref = { kind: "CODE" | "MANUFACTURER" | "STANDARD" | "LOCAL"; title: string; url: string; jurisdiction?: string; note?: string };

/** Code editions in force (verified October 2026 — re-check when a jurisdiction adopts a new edition). */
export const ADOPTIONS: { jurisdiction: string; codes: string; source: string }[] = [
  {
    jurisdiction: "Omaha, NE",
    codes: "2018 IBC · 2018 IRC · 2018 IECC (commercial) · 2012 IMC · 2023 NEC · 2024 IFC (eff. Feb 2026)",
    source: "https://codes.submittal.app/cities/omaha/",
  },
];

/** Built-in references (team-added links are stored as LibraryLink). */
export const REFERENCES: Ref[] = [
  { kind: "CODE", title: "Omaha building codes (UpCodes)", url: "https://up.codes/codes/omaha", jurisdiction: "Omaha, NE" },
  { kind: "CODE", title: "Nebraska codes — ICC Digital Codes", url: "https://codes.iccsafe.org/codes/united-states/nebraska", jurisdiction: "Nebraska" },
  { kind: "CODE", title: "2018 IRC Chapter 9 — Roof Assemblies (free read)", url: "https://codes.iccsafe.org/content/IRC2018/chapter-9-roof-assemblies", jurisdiction: "Omaha, NE", note: "Omaha enforces the 2018 IRC" },
  { kind: "LOCAL", title: "Neb. Rev. Stat. § 52-137 — lien recording (120 days)", url: "https://nebraskalegislature.gov/laws/statutes.php?statute=52-137", jurisdiction: "Nebraska" },
  { kind: "STANDARD", title: "ASCE Hazard Tool — design wind speed by address (ASCE 7)", url: "https://ascehazardtool.org/" },
  { kind: "STANDARD", title: "NRCA — National Roofing Contractors Association", url: "https://www.nrca.net/" },
  { kind: "MANUFACTURER", title: "GAF Timberline installation instructions", url: "https://www.gaf.com/en-us/document-library/documents/installation-instructions-&-guides/timberline-layerlock-installation-instructions-trilingual-restl622.pdf" },
  { kind: "MANUFACTURER", title: "James Hardie — installation instructions & best practices", url: "https://www.jameshardiepros.com/" },
  { kind: "MANUFACTURER", title: "Mule-Hide — EPDM / TPO specifications and details", url: "https://www.mulehide.com/" },
  { kind: "MANUFACTURER", title: "Elevate (Holcim) — EPDM / TPO specifications", url: "https://www.holcimelevate.com/" },
  { kind: "MANUFACTURER", title: "Malarkey — shingle installation", url: "https://www.malarkeyroofing.com/" },
  { kind: "MANUFACTURER", title: "CertainTeed — roofing & siding installation", url: "https://www.certainteed.com/" },
  { kind: "MANUFACTURER", title: "LP SmartSide — installation", url: "https://lpcorp.com/" },
  { kind: "MANUFACTURER", title: "Norandex — vinyl siding", url: "https://www.norandex.com/" },
];

/** Official sources: code bodies, governments, standards groups, and the manufacturers BTR installs. */
export const OFFICIAL_DOMAINS = [
  "iccsafe.org",
  "up.codes",
  "cityofomaha.org",
  "dceservices.org",
  "nebraska.gov",
  "nebraskalegislature.gov",
  "osha.gov",
  "asce.org",
  "ascehazardtool.org",
  "nrca.net",
  "energycodes.gov",
  "gaf.com",
  "jameshardie.com",
  "jameshardiepros.com",
  "mulehide.com",
  "holcimelevate.com",
  "malarkeyroofing.com",
  "certainteed.com",
  "iko.com",
  "tamko.com",
  "atlasroofing.com",
  "owenscorning.com",
  "lpcorp.com",
  "norandex.com",
];

const TASK = (jurisdiction: string) =>
  [
    "TASK: answer a building-code, specification or manufacturer-requirement question for BTR Contracting (roofing / siding / exterior envelope).",
    `Jurisdiction: ${jurisdiction}. Use the code EDITION that jurisdiction has adopted (Omaha enforces the 2018 IBC and 2018 IRC, the 2018 IECC for commercial work), not simply the newest edition. Say which edition and section you're citing.`,
    "Research with web search / fetch. Prefer primary sources: the code text (ICC / UpCodes), the city or state, ASCE/NRCA/OSHA, and the manufacturer's current installation instructions or specifications. Manufacturer instructions govern warranty eligibility — call out where they're stricter than code.",
    "If job documents (spec book / plans text) are provided, check them first and cite the spec section; project specs override general practice.",
    "Never invent a section number, value or requirement. If you can't find or verify something, say it's unverified and what source would settle it.",
    "Answer format: the direct answer first (one or two sentences), then the requirements as short bullets with the edition/section or document for each, then 'Check:' items the estimator must confirm. Keep it tight.",
  ].join("\n");

/** Asks BTRbot, saves the answer with its sources. */
export async function askCodeQuestion(input: { question: string; jurisdiction: string; projectId?: string | null; officialOnly: boolean; useJobSpecs: boolean }, actor: { name: string }) {
  const q = input.question.trim();
  if (q.length < 8) throw new Error("Ask a full question (what, where, which product).");
  let context: string | undefined;
  if (input.projectId && input.useJobSpecs) {
    const docs = await prisma.document.findMany({ where: { projectId: input.projectId, type: { in: ["SPECS", "PLANS"] }, extractedText: { not: null } }, select: { fileName: true, extractedText: true }, take: 6 });
    if (docs.length) context = `JOB DOCUMENTS (text):\n${docs.map((d) => `=== ${d.fileName}\n${d.extractedText!.slice(0, 40_000)}`).join("\n\n").slice(0, 150_000)}`;
  }
  const r = await aiResearch({ task: TASK(input.jurisdiction), question: q, context, allowedDomains: input.officialOnly ? OFFICIAL_DOMAINS : undefined });
  return prisma.codeQuestion.create({
    data: { question: q, answer: r.text, sources: r.sources, jurisdiction: input.jurisdiction, projectId: input.projectId ?? null, officialOnly: input.officialOnly, createdBy: actor.name },
  });
}

export const isOfficial = (url: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return OFFICIAL_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
};
