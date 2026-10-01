import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { aiConfigured } from "@/lib/ai/claude";
import { billSummary, syncPaidFromQuickBooks } from "@/lib/bills/service";
import { billsAddress } from "@/lib/bills/inbox";
import { ScanBillForm } from "@/components/bills/forms";
import { AutoRefresh } from "@/components/receipts/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { STATUS } from "@/components/bills/status";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) : "—");
const TABS: [string, string, string[]][] = [
  ["look", "Needs a look", ["NEEDS_LOOK"]],
  ["ready", "Ready to approve", ["READY"]],
  ["unpaid", "Approved, unpaid", ["APPROVED"]],
  ["disputed", "Disputed", ["DISPUTED"]],
  ["paid", "Paid", ["PAID"]],
  ["all", "All", ["NEEDS_LOOK", "READY", "APPROVED", "PAID", "DISPUTED", "VOID"]],
];

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser(STAFF_ROLES);
  const tab = (await searchParams).tab ?? "look";
  await syncPaidFromQuickBooks(25).catch(() => 0);
  const [summary, reading] = await Promise.all([billSummary(), prisma.receiptScan.count({ where: { status: "READING", subject: "Supplier bill" } })]);
  const statuses = TABS.find((t) => t[0] === tab)?.[2] ?? ["NEEDS_LOOK"];
  const bills = await prisma.supplierBill.findMany({
    where: { status: { in: statuses } },
    orderBy: tab === "unpaid" ? [{ dueDate: { sort: "asc", nulls: "last" } }] : [{ createdAt: "desc" }],
    take: 200,
  });
  const jobs = new Map((await prisma.project.findMany({ where: { id: { in: bills.map((b) => b.projectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const inbox = billsAddress();
  const now = new Date();
  const counts: Record<string, number> = { look: summary.needsLook, ready: summary.ready, unpaid: summary.approved, disputed: summary.disputed };
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      {reading > 0 && <AutoRefresh every={5000} />}
      <div>
        <h1 className="text-2xl font-semibold">Supplier bills</h1>
        <p className="text-sm text-muted-foreground">
          On-account invoices (ABC and others). Each one is checked against our PO, the delivery tickets and the price sheets. Approving files it to the job&apos;s costs
          and sends it to QuickBooks as a bill.
          {inbox && (
            <>
              {" "}Have suppliers email invoices to <span className="font-mono font-medium text-foreground">{inbox}</span>, or forward them there.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Needs a look", String(summary.needsLook)],
          ["Ready to approve", String(summary.ready)],
          ["Due this week", usd(summary.dueThisWeek)],
          ["Past due", usd(summary.pastDue)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className={`text-xl font-semibold tabular-nums ${k === "Past due" && summary.pastDue > 0 ? "text-red-600" : ""}`}>{v}</div>
          </div>
        ))}
      </div>
      {summary.noDueDate > 0 && <p className="text-xs text-muted-foreground">{summary.noDueDate} open bill{summary.noDueDate === 1 ? " has" : "s have"} no due date (none printed and no supplier terms set under Company settings).</p>}

      {aiConfigured() ? <ScanBillForm /> : <p className="rounded-lg border p-3 text-sm">Reading invoices needs BTRbot turned on (ANTHROPIC_API_KEY on the server).</p>}
      {reading > 0 && <p className="text-sm text-muted-foreground">Reading {reading} emailed invoice{reading === 1 ? "" : "s"}…</p>}

      <nav className="flex flex-wrap gap-1 text-sm">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/bills?tab=${k}`} className={`rounded-md border px-3 py-1 ${tab === k ? "border-btr-black bg-btr-black text-white" : "hover:bg-accent"}`}>
            {label}
            {counts[k] ? <span className="ml-1 tabular-nums opacity-70">{counts[k]}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Vendor · invoice</th>
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/bills/${b.id}`} className="font-medium text-btr-link hover:underline">
                    {b.vendor}
                    {b.invoiceNumber ? ` · ${b.invoiceNumber}` : ""}
                  </Link>
                </td>
                <td className="px-3 py-2">{b.projectId ? jobs.get(b.projectId) : <span className="text-amber-700">pick job</span>}</td>
                <td className="px-3 py-2 tabular-nums">{day(b.invoiceDate)}</td>
                <td className={`px-3 py-2 tabular-nums ${b.dueDate && b.dueDate < now && b.status !== "PAID" ? "font-medium text-red-600" : ""}`}>{day(b.dueDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(b.total)}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS[b.status]?.[1] ?? "outline"}>{STATUS[b.status]?.[0] ?? b.status}</Badge>
                </td>
              </tr>
            ))}
            {bills.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
