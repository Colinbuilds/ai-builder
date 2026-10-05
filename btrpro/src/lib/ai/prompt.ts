// The estimator system prompt. BTR's deployment uses CLAUDE.md verbatim (its company context, price sheets and
// locked takeoff rules are in there). Any other company gets prompts/estimator-core.md (the general rules)
// filled in from its profile, with its own saved estimating rules (CompanySetting "aiRules") at the end.
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { DEFAULT_PROFILE, getCompany, type Company } from "@/lib/company-profile";

let claudeMd: string | null = null;
let core: string | null = null;
/** BTR's estimator knowledge base — loaded verbatim, never paraphrased. */
export const btrPrompt = () => (claudeMd ??= readFileSync(path.join(process.cwd(), "CLAUDE.md"), "utf8"));
const corePrompt = () => (core ??= readFileSync(path.join(process.cwd(), "prompts/estimator-core.md"), "utf8"));

// CLAUDE.md sections that are BTR's own (company context, role, price sheets, locked rules, style); the rest are
// the general rules every company gets from the core prompt.
const COMPANY_SECTIONS = [1, 2, 5, 6, 10];

/** BTR's company-specific sections of CLAUDE.md — the starting text of BTR's saved rules in Settings. */
export function btrCompanyRules(): string {
  return btrPrompt()
    .split(/(?=^## \d+\. )/m)
    .filter((part) => COMPANY_SECTIONS.includes(Number(/^## (\d+)\. /.exec(part)?.[1])))
    .join("")
    .trim();
}

const isBtr = (co: Pick<Company, "name">) => co.name === DEFAULT_PROFILE.name;

export async function savedAiRules(): Promise<string | null> {
  const row = await prisma.companySetting.findUnique({ where: { key: "aiRules" } });
  return typeof row?.value === "string" && row.value.trim() ? row.value : null;
}

/** The prompt for a company and its saved rules. Pure, so tests can check it directly. */
export function buildSystemPrompt(co: Company, rules: string | null): string {
  if (!rules && isBtr(co)) return btrPrompt();
  const context = [
    `- **Company:** ${[co.name, co.address, co.phone, co.email].filter(Boolean).join(" · ")}`,
    `- **Home market:** ${co.jurisdiction || "MISSING"}${co.region.name !== "MISSING" ? ` (${co.region.name})` : ""}`,
    co.supplier.name && `- **Primary supplier:** ${[co.supplier.name, co.supplier.address, co.supplier.phone].filter(Boolean).join(", ")}`,
    `- **Tools used:** ${co.productName} (this app): job management, estimating, orders, billing.`,
    co.region.exemptForm && `- **Tax-exempt public jobs:** ${co.region.exemptForm.title} must be executed with the owner before materials are purchased.`,
    co.region.lien && `- **Lien deadline:** ${co.region.lien.summary} (${co.region.lien.statute}).`,
  ]
    .filter(Boolean)
    .join("\n");
  const fill: Record<string, string> = {
    productName: co.productName,
    companyName: co.name,
    assistantName: co.assistantName,
    jurisdiction: co.jurisdiction,
    companyContext: context,
    companyRules:
      rules?.trim() ||
      "No company estimating rules are saved yet (Settings → Company profile). Apply only the general rules above. Ask for the company's standards (waste factors, default products, supplier and price sheets) before applying any — never assume them.",
  };
  return corePrompt().replace(/\{\{(\w+)\}\}/g, (m, k: string) => fill[k] ?? m);
}

/** The system prompt for this deployment, read fresh each call (settings can change). */
export async function estimatorSystemPrompt(): Promise<string> {
  const [co, rules] = await Promise.all([getCompany(), savedAiRules()]);
  return buildSystemPrompt(co, rules);
}
