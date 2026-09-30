import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { CompanySettingsForm } from "@/components/proposals/company-settings-form";
import { CommissionPlanForm } from "@/components/costing/forms";
import { prisma } from "@/lib/db";

export default async function CompanySettingsPage() {
  await requireUser(["ADMIN"]);
  const s = await getSettings();
  const users = await prisma.user.findMany({ where: { role: { not: "VIEWER" } }, include: { commissionPlan: true }, orderBy: { name: "asc" } });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Company settings</h1>
        <p className="text-sm text-muted-foreground">Used on proposals and job P&amp;Ls. Nothing is pre-filled; anything left blank is asked for when it&apos;s needed. Changes are logged.</p>
      </div>
      <CompanySettingsForm s={s} />
      <section className="flex flex-col gap-3 border-t pt-4">
        <div>
          <h2 className="font-semibold">Commission plans</h2>
          <p className="text-sm text-muted-foreground">Per salesperson. A job&apos;s commission (and net profit) shows MISSING until its salesperson has a plan. Leave % blank and save to remove a plan.</p>
        </div>
        {users.map((u) => (
          <div key={u.id} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{u.name}</span>
            <CommissionPlanForm userId={u.id} plan={u.commissionPlan ? { basis: u.commissionPlan.basis, pct: u.commissionPlan.pct, note: u.commissionPlan.note } : null} />
          </div>
        ))}
      </section>
    </div>
  );
}
