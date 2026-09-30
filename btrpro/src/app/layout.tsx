import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { MarketSwitch } from "@/components/market-switch";
import { getMarketView } from "@/lib/market";
import { NavMenu, type NavGroup } from "@/components/nav-menu";

function navFor(role: string): NavGroup[] {
  const staff = role !== "VIEWER";
  return [
    { href: "/", label: "Jobs" },
    { href: "/today", label: "My day" },
    { href: "/customers", label: "Customers" },
    { href: "/builders", label: "Builders" },
    {
      label: "Operations",
      items: [
        { href: "/schedule", label: "Schedule" },
        { href: "/deliveries", label: "Deliveries" },
        { href: "/crews", label: "Crews & subs" },
      ],
    },
    {
      label: "Estimating",
      items: [
        { href: "/library", label: "Price library" },
        { href: "/library/sheets", label: "Price sheets" },
        { href: "/settings/templates", label: "Estimate templates" },
        ...(staff ? [{ href: "/settings/labor", label: "Labor standards" }] : []),
        { href: "/settings/rules", label: "Rules" },
      ],
    },
    { label: "Reports", items: [...(staff ? [{ href: "/reports/sales", label: "Sales & pipeline" }, { href: "/reports/profit", label: "Profit" }, { href: "/reports/commissions", label: "Commissions" }] : []), ...(role === "ADMIN" ? [{ href: "/reports/ar", label: "Receivables (AR)" }] : [])] },
    {
      label: "Admin",
      items:
        role === "ADMIN"
          ? [
              { href: "/admin/users", label: "Users" },
              { href: "/settings/import-jobs", label: "Import jobs" },
              { href: "/settings/acculynx", label: "Move off AccuLynx" },
              { href: "/settings/company", label: "Company settings" },
              { href: "/settings/integrations", label: "Integrations" },
            ]
          : [],
    },
  ];
}

export const metadata: Metadata = {
  title: "BTRpro — BTR Contracting",
  description: "BTR Contracting operations: estimating, jobs, orders, and job costing",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const view = await getMarketView();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {user && (
          <header className="border-b">
            <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm">
              <Link href="/" className="mr-2 font-semibold">
                BTRpro
              </Link>
              <NavMenu groups={navFor(user.role)} />
              <span className="ml-auto">
                <MarketSwitch view={view} />
              </span>
              <span className="text-muted-foreground">
                {user.name} · {user.role.toLowerCase()}
              </span>
              <form action={logout}>
                <Button variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
