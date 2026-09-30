import type { Metadata } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { getMarketView } from "@/lib/market";
import { prisma } from "@/lib/db";
import { topBarCounts } from "@/lib/notifications";
import { recentJobs } from "@/lib/shell/recent";
import { TopBar, type Tool } from "@/components/shell/top-bar";
import { PagePanel } from "@/components/shell/page-panel";

function toolsFor(role: string): { tools: Tool[]; admin: { href: string; label: string }[] } {
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
              { href: "/customers/new?kind=contact", label: "New contact" },
              { href: "/customers/new", label: "New customer account" },
              { href: "/today#add-task", label: "New task" },
              ...(admin ? [{ href: "/updates#post", label: "Company update" }] : []),
            ],
          },
        ]
      : []),
    { key: "recent", label: "Recent", icon: "History", orange: true },
    { key: "dashboard", label: "Dashboard", icon: "Gauge", href: "/" },
    {
      key: "contacts",
      label: "Contacts",
      icon: "BookUser",
      items: [
        { href: "/customers", label: "Customers & contacts" },
        { href: "/builders", label: "Builders" },
      ],
    },
    { key: "leads", label: "Leads", icon: "User", href: "/jobs?stage=LEAD" },
    {
      key: "jobs",
      label: "Jobs",
      icon: "Hammer",
      items: [
        { href: "/jobs", label: "All open jobs" },
        { href: "/jobs?mine=1", label: "My jobs" },
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
    { key: "today", label: "My day", icon: "CalendarDays", href: "/today" },
    {
      key: "production",
      label: "Production",
      icon: "CalendarDays",
      items: [
        { href: "/schedule", label: "Schedule" },
        { href: "/deliveries", label: "Deliveries" },
        { href: "/crews", label: "Crews & subs" },
      ],
    },
    ...(staff
      ? [
          {
            key: "reports",
            label: "Reports",
            icon: "FileText" as const,
            items: [
              { href: "/reports/sales", label: "Sales & pipeline" },
              { href: "/reports/profit", label: "Profit" },
              { href: "/reports/commissions", label: "Commissions" },
              ...(admin ? [{ href: "/reports/ar", label: "Receivables (AR)" }] : []),
            ],
          },
        ]
      : []),
    {
      key: "tools",
      label: "Estimating",
      icon: "Wrench",
      items: [
        { href: "/library", label: "Price library" },
        { href: "/library/sheets", label: "Price sheets" },
        { href: "/settings/templates", label: "Estimate templates" },
        ...(staff ? [{ href: "/settings/labor", label: "Labor standards" }] : []),
        { href: "/settings/rules", label: "Rules" },
      ],
    },
  ];
  return {
    tools,
    admin: admin
      ? [
          { href: "/admin/users", label: "Users" },
          { href: "/updates", label: "Company updates" },
          { href: "/settings/company", label: "Company settings" },
          { href: "/settings/integrations", label: "Integrations" },
          { href: "/settings/import-jobs", label: "Import jobs (schedules)" },
          { href: "/settings/acculynx", label: "Import from AccuLynx (one-time)" },
        ]
      : [],
  };
}

export const metadata: Metadata = {
  title: "BTRpro — BTR Contracting",
  description:
    "BTR Contracting operations: estimating, jobs, orders, and job costing",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--canvas)] antialiased">
        {user && <Shell user={user} />}
        <main className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 sm:py-5">
          <PagePanel>{children}</PagePanel>
        </main>
      </body>
    </html>
  );
}

async function Shell({ user }: { user: { id: string; name: string; role: string } }) {
  const [counts, recent, watching, view] = await Promise.all([
    topBarCounts(user.id),
    recentJobs(user.id),
    prisma.jobWatch.count({ where: { userId: user.id } }),
    getMarketView(),
  ]);
  const { tools, admin } = toolsFor(user.role);
  return (
    <TopBar
      user={{ name: user.name, role: user.role }}
      counts={{ ...counts, watching }}
      recent={recent}
      tools={tools}
      view={view}
      adminLinks={admin}
    />
  );
}
