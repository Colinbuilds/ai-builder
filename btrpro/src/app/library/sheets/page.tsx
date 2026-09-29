import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listSheets } from "@/lib/price";
import { SUPPLIER } from "@/lib/company";
import { SheetStatusBadge } from "@/components/sheet-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

type SP = Promise<{ applied?: string }>;

export default async function SheetsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const { applied } = await searchParams;
  const [sheets, drafts, history] = await Promise.all([
    listSheets(),
    prisma.sheetImport.findMany({
      where: { status: "DRAFT" },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.priceSheet.findMany({
      where: { isActive: false },
      include: { _count: { select: { items: true } } },
      orderBy: { replacedAt: "desc" },
      take: 20,
    }),
  ]);
  const isAdmin = user.role === "ADMIN";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Price sheets</h1>
          <p className="text-sm text-muted-foreground">
            {SUPPLIER.name} · {SUPPLIER.phone}. {SUPPLIER.surchargeNote}
          </p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link href="/library/sheets/upload">Upload a sheet</Link>
          </Button>
        )}
      </div>

      {applied && (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          New sheet version is live. The previous version is kept under Previous versions.
        </p>
      )}

      {drafts.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-semibold">Uploads waiting for review</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/library/sheets/imports/${d.id}`} className="font-medium underline">
                  {d.code} — {d.fileName}
                </Link>{" "}
                <span className="text-muted-foreground">
                  uploaded by {d.createdBy.name}, {d.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Sheet</TH>
            <TH>Date status</TH>
            <TH>Account</TH>
            <TH>Rep</TH>
            <TH>Effective</TH>
            <TH>Expires</TH>
            <TH className="text-right">Items</TH>
          </TR>
        </THead>
        <TBody>
          {sheets.map((s) => (
            <TR key={s.id}>
              <TD>
                <Badge variant="outline">{s.code}</Badge>
              </TD>
              <TD className="max-w-sm">
                <div className="font-medium">
                  {s.isLoaded ? <Link href={`/library?sheet=${s.code}`}>{s.name}</Link> : s.name}
                </div>
                <div className="text-xs text-muted-foreground">{s.scope}</div>
                {s.warning && (
                  <Badge variant={s.isLoaded ? "amber" : "red"} className="mt-1 whitespace-normal">
                    {s.warning}
                  </Badge>
                )}
              </TD>
              <TD className="max-w-60">{s.isLoaded ? <SheetStatusBadge sheet={s} withText /> : "—"}</TD>
              <TD>{s.account ?? "—"}</TD>
              <TD>{s.salesRep ?? "—"}</TD>
              <TD>{formatDate(s.effectiveDate)}</TD>
              <TD>{formatDate(s.expirationDate)}</TD>
              <TD className="text-right tabular-nums">{s.isLoaded ? s._count.items : "Not loaded"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {history.length > 0 && (
        <details className="rounded-md border p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Previous versions ({history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id}>
                <Badge variant="outline">{h.code}</Badge> {h.name} · effective {formatDate(h.effectiveDate)} ·{" "}
                {h._count.items} items · replaced{" "}
                {h.replacedAt?.toLocaleDateString("en-US", { timeZone: "America/Chicago" }) ?? "—"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
