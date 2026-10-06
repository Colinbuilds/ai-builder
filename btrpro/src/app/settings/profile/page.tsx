import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCompany } from "@/lib/company-profile";
import { REGIONS } from "@/lib/region";
import { btrCompanyRules, savedAiRules } from "@/lib/ai/prompt";
import { ProfileForm } from "./profile-form";

export default async function CompanyProfilePage() {
  await requireUser(["ADMIN"]);
  const [co, row, rules] = await Promise.all([getCompany(), prisma.companySetting.findUnique({ where: { key: "companyProfile" } }), savedAiRules()]);
  const saved = (row?.value ?? {}) as Record<string, unknown>;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Company profile &amp; branding</h1>
        <p className="text-sm text-muted-foreground">
          Who this deployment runs for: names, letterhead, colors, logo, state rules and the estimating rules {co.assistantName} follows. While the company name is BTR Contracting, blank fields use BTR&apos;s values (shown
          greyed out); for another company they stay blank and show as MISSING where needed. Changes are logged.
        </p>
      </div>
      <ProfileForm
        saved={saved}
        current={{ ...co, region: undefined }}
        hasLogo={!!co.logo}
        states={Object.values(REGIONS).map((r) => ({ code: r.state, name: r.name, lienDays: r.lien?.days ?? null, form: r.exemptForm?.short ?? null }))}
        region={{ name: co.region.name, lien: co.region.lien ? `${co.region.lien.days} days (${co.region.lien.statute})` : null, form: co.region.exemptForm?.title ?? null }}
        rules={rules ?? (co.name === "BTR Contracting" ? btrCompanyRules() : "")}
        rulesSaved={!!rules}
      />
    </div>
  );
}
