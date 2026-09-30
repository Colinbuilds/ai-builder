import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { MarketSwitch } from "@/components/market-switch";
import { getMarketView } from "@/lib/market";

export const metadata: Metadata = {
  title: "BTRpro — BTR Contracting",
  description: "Roofing and exterior estimating for BTR Contracting",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const view = await getMarketView();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {user && (
          <header className="border-b">
            <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
              <Link href="/" className="font-semibold">
                BTRpro
              </Link>
              <Link href="/" className="text-muted-foreground hover:text-foreground">
                Jobs
              </Link>
              <Link href="/customers" className="text-muted-foreground hover:text-foreground">
                Customers
              </Link>
              <Link href="/library" className="text-muted-foreground hover:text-foreground">
                Price library
              </Link>
              <Link href="/library/sheets" className="text-muted-foreground hover:text-foreground">
                Sheets
              </Link>
              {user.role !== "VIEWER" && (
                <Link href="/settings/labor" className="text-muted-foreground hover:text-foreground">
                  Labor
                </Link>
              )}
              <Link href="/settings/rules" className="text-muted-foreground hover:text-foreground">
                Rules
              </Link>
              {user.role === "ADMIN" && (
                <>
                  <Link href="/admin/users" className="text-muted-foreground hover:text-foreground">
                    Users
                  </Link>
                  <Link href="/settings/integrations" className="text-muted-foreground hover:text-foreground">
                    Integrations
                  </Link>
                </>
              )}
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
