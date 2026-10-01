import { requireUser } from "@/lib/auth";
import { profitReport } from "@/lib/costing/report";
import { CommissionCalculator } from "@/components/costing/commission-calculator";

export default async function CommissionCalculatorPage() {
  const user = await requireUser(["ADMIN", "ESTIMATOR"]);
  // sold jobs whose costs this user may see (Admins: all; others: their own), newest first
  const report = await profitReport({}, user);
  const jobs = report.rows
    .filter((r) => r.pnl.revenue != null)
    .slice(0, 300)
    .map((r) => ({
      id: r.id,
      name: r.name,
      salesperson: r.salesperson,
      contract: r.pnl.revenue!,
      actual: r.pnl.actual,
      projected: r.pnl.projected,
      hasCosts: r.pnl.hasCosts,
      closed: r.closed,
    }));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Commission calculator</h1>
        <p className="text-sm text-muted-foreground">
          Plans read overhead / company / rep: overhead comes off the contract price, and the profit left after job cost and overhead splits between the company and the rep. Nothing here is saved.
        </p>
      </div>
      <CommissionCalculator jobs={jobs} />
    </div>
  );
}
