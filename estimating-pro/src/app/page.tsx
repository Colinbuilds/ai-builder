import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listSheets } from "@/lib/price";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SheetDateBanner } from "@/components/sheet-banner";

// Dashboard. The project list, readiness badges, and job chat arrive in Phases 3–4.
export default async function Home() {
  const user = await requireUser();
  const [sheets, callCount, ruleCount] = await Promise.all([
    listSheets(),
    prisma.priceItem.count({ where: { priceStatus: "CALL", sheet: { isActive: true } } }),
    prisma.rule.count({ where: { active: true } }),
  ]);
  const loaded = sheets.filter((s) => s.isLoaded);
  const itemCount = loaded.reduce((n, s) => n + s._count.items, 0);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <SheetDateBanner />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Price items</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{itemCount}</p>
            <p className="text-sm text-muted-foreground">
              across {loaded.length} sheets · <Link href="/library?status=CALL">{callCount} CALL for price</Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sheets not loaded</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{sheets.length - loaded.length}</p>
            <p className="text-sm text-muted-foreground">
              {sheets
                .filter((s) => !s.isLoaded)
                .map((s) => s.name)
                .join(", ") || "None"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Company rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{ruleCount}</p>
            <p className="text-sm text-muted-foreground">seeded from company_rules.json</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
