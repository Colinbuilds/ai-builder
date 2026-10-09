import type { Metadata } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { getMarketView } from "@/lib/market";
import { prisma } from "@/lib/db";
import { topBarCounts } from "@/lib/notifications";
import { recentJobs } from "@/lib/shell/recent";
import { TopBar, type Tool } from "@/components/shell/top-bar";
import { PagePanel } from "@/components/shell/page-panel";
import { databasePersistence } from "@/lib/setup-check";
import { appName, botName, brandCss, getCompany } from "@/lib/company-profile";
import { BrandProvider } from "@/components/brand";

function toolsFor(role: string, isOwner = false): { tools: Tool[]; admin: { href: string; label: string }[] } {
  const staff = role !== "VIEWER";
  const admin = role === "ADMIN";
  const tools: Tool[] = [
    ...(staff
      ? [
          {
            key: "new",
            label: "New",
            icon: "Plus" as const,
            orange: true,
            items: [
              { href: "/projects/new", label: "New job / lead" },
              { href: "/builders/add-house", label: "Builder house (PDF or pick the model)" },
              { href: "/receipts", label: "Scan a receipt" },
              { href: "/customers/new?kind=contact", label: "New contact" },
              { href: "/customers/new", label: "New customer account" },
              { href: "/today#add-task", label: "New task" },
              { href: "/ideas", label: `New idea for ${appName()}` },
              ...(admin ? [{ href: "/updates#post", label: "Company update" }] : []),
            ],
          },
        ]
      : []),
    { key: "dashboard", label: "Home", icon: "Gauge", href: "/" },
    {
      key: "jobs",
      label: "Jobs",
      icon: "Hammer",
      items: [
        { href: "/jobs", label: "All open jobs" },
        { href: "/jobs?mine=1", label: "My jobs" },
        { href: "/jobs?stage=LEAD", label: "Leads" },
        { href: "/leads/web", label: "Website requests (customer form)" },
        { href: "/jobs?watch=1", label: "Watch list" },
        { heading: "By milestone" },
        { href: "/jobs?m=LEAD", label: "Lead" },
        { href: "/jobs?m=PROSPECT", label: "Prospect" },
        { href: "/jobs?m=APPROVED", label: "Approved" },
        { href: "/jobs?m=COMPLETED", label: "Completed" },
        { href: "/jobs?m=INVOICED", label: "Invoiced" },
        { href: "/jobs?m=CLOSED", label: "Closed" },
        { href: "/jobs?stage=LOST", label: "Lost" },
      ],
    },
    { key: "schedule", label: "Schedule", icon: "CalendarDays", href: "/production" },
    { key: "estsched", label: "Estimating schedule", icon: "FileText", href: "/estimating/schedule" },
    {
      key: "contacts",
      label: "Contacts",
      icon: "BookUser",
      items: [
        { href: "/customers", label: "Customers & contacts" },
        { href: "/builders", label: "Builders" },
      ],
    },
    {
      key: "production",
      label: "Production",
      icon: "CalendarDays",
      items: [
        { href: "/schedule", label: "Calendar" },
        { href: "/builders/add-house", label: "Add a builder house" },
        { href: "/takeoff", label: "Blueprint measurer" },
        { href: "/billing/pay-apps", label: "Pay applications (AIA)" },
        { href: "/deliveries", label: "Deliveries" },
        { href: "/crews", label: "Crews & subs" },
        ...(staff
          ? [
              { href: "/crews/invoices", label: "Crew invoices" },
              { href: "/receipts", label: "Supplier receipts" },
              { href: "/bills", label: "Supplier bills (pay ABC)" },
              { href: "/desk/office", label: "Office desk" },
              { href: "/desk/purchasing", label: "Purchasing desk" },
            ]
          : []),
      ],
    },
    ...(staff
      ? [
          {
            key: "reports",
            label: "Reports",
            icon: "FileText" as const,
            items: [
              { href: "/overview", label: "Company overview (pipeline, leaderboard, activity)" },
              ...(admin || role === "OFFICE" ? [{ href: "/reports/scorecard", label: "Owner scorecard" }, { href: "/reports/wip", label: "WIP schedule (bank / surety)" }, { href: "/reports/cash", label: "13-week cash forecast" }, { href: "/reports/bonding", label: "Bonding capacity" }] : []),
              { href: "/reports/risk", label: "Risk desk (insurance, lien deadlines)" },
              { href: "/reports/extras", label: "Extra work desk (field tags → change orders)" },
              { href: "/safety", label: "Safety & prequal packet" },
              { href: "/playbook", label: "Playbook (how we do things, SOPs)" },
              { href: "/reports/customers", label: "Customer relationships (who went quiet)" },
              ...(isOwner ? [{ href: "/audit", label: "Owner audit" }] : []),
              { href: "/reports/sales", label: "Sales & pipeline" },
              { href: "/reports/win-loss", label: "Win / loss & win-back" },
              { href: "/reports/profit", label: "Profit" },
              { href: "/reports/commissions", label: "Commission calculator" },
              ...(admin || role === "OFFICE" ? [{ href: "/reports/ar", label: "Receivables (AR)" }] : []),
            ],
          },
        ]
      : []),
    {
      key: "tools",
      label: "Estimating",
      icon: "Wrench",
      items: [
        ...(staff ? [{ href: "/bids", label: "Public bids (county, city, SDI plan room)" }] : []),
        { href: "/library/codes", label: `Code & spec library (${botName()} research)` },
        { href: "/library", label: "Price library" },
        { href: "/library/sheets", label: "Price sheets" },
        { href: "/settings/templates", label: "Estimate templates" },
        { href: "/estimating/ventilation", label: "Ventilation calculator" },
        ...(staff ? [{ href: "/settings/labor", label: "Labor standards" }] : []),
        { href: "/settings/rules", label: "Rules" },
      ],
    },
  ];
  return {
    tools,
    admin: admin
      ? [
          { href: "/connections", label: "Connections (ABC, EagleView, QuickBooks)" },
          { href: "/settings/drive-jobs", label: "Move jobs from Drive" },
          ...(staff ? [{ href: "/ideas", label: "Ideas board (office requests)" }] : []),
          { href: "/admin/users", label: "Users" },
          { href: "/updates", label: "Company updates" },
          { href: "/settings/company", label: "Company settings" },
          { href: "/settings/profile", label: "Company profile & branding" },
          { href: "/settings/integrations", label: "Integrations" },
          { href: "/admin/setup", label: "Setup check" },
          { href: "/admin/backups", label: "Storage & backups" },
          { href: "/settings/import-jobs", label: "Import jobs (schedules)" },
          { href: "/settings/acculynx", label: "Import from AccuLynx (one-time)" },
        ]
      : staff
        ? [...(role === "OFFICE" || role === "PURCHASING" ? [{ href: "/connections", label: "Connections (ABC, EagleView, QuickBooks)" }] : []), { href: "/ideas", label: "Ideas board (office requests)" }]
        : [],
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const co = await getCompany();
  return {
    title: `${co.productName} — ${co.name}`,
    description: `${co.name} operations: estimating, jobs, orders, and job costing`,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, co] = await Promise.all([getCurrentUser(), getCompany()]);
  const db = user?.role === "ADMIN" ? databasePersistence() : null;
  const css = brandCss(co);
  return (
    <html lang="en">
      {/* brand colors from the company profile; nothing is injected for BTR's defaults */}
      {css && (
        <head>
          <style dangerouslySetInnerHTML={{ __html: css }} />
        </head>
      )}
      <body className="min-h-screen bg-[var(--canvas)] antialiased">
        <BrandProvider brand={{ productName: co.productName, assistantName: co.assistantName, companyName: co.name, shortName: co.shortName, address: co.address }}>
        {user && <Shell user={user} brand={{ productName: co.productName, logo: !!co.logo }} />}
        <main className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 sm:py-5">
          {db && !db.persistent && (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/50 dark:text-red-200">
              <b>Data is not being kept.</b> The database is on the server&apos;s temporary disk, so every redeploy or Railway variable change erases jobs, leads and customers. Add a Railway volume
              mounted at <code>/data</code> and remove the <code>DATABASE_URL</code> variable (or set it to <code>file:/data/btrpro.db</code>).{" "}
              <a href="/admin/setup" className="underline">
                Setup check
              </a>
            </div>
          )}
          <PagePanel>{children}</PagePanel>
        </main>
        </BrandProvider>
      </body>
    </html>
  );
}

async function Shell({ user, brand }: { user: { id: string; name: string; role: string; isOwner?: boolean }; brand: { productName: string; logo: boolean } }) {
  const [counts, recent, watching, view] = await Promise.all([
    topBarCounts(user.id),
    recentJobs(user.id),
    prisma.jobWatch.count({ where: { userId: user.id } }),
    getMarketView(),
  ]);
  const { tools, admin } = toolsFor(user.role, user.isOwner);
  return (
    <TopBar
      user={{ name: user.name, role: user.role }}
      counts={{ ...counts, watching }}
      recent={recent}
      tools={tools}
      view={view}
      adminLinks={admin}
      brand={brand}
    />
  );
}
