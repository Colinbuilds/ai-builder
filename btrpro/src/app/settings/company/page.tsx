import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { CompanySettingsForm } from "@/components/proposals/company-settings-form";

export default async function CompanySettingsPage() {
  await requireUser(["ADMIN"]);
  const s = await getSettings();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Company settings</h1>
        <p className="text-sm text-muted-foreground">Used on proposals and job P&amp;Ls. Nothing is pre-filled; anything left blank is asked for when it&apos;s needed. Changes are logged.</p>
      </div>
      <CompanySettingsForm s={s} />
    </div>
  );
}
