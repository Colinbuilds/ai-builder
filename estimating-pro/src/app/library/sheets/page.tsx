import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listSheets } from "@/lib/price";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export default async function SheetsPage() {
  await requireUser();
  const sheets = await listSheets();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Price sheets</h1>
        <p className="text-sm text-muted-foreground">
          ABC Supply Branch #112 · 402-734-1414. Each sheet carries a credit-card surcharge of up to 3% (none on debit,
          ACH, check, or cash).
        </p>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Sheet</TH>
            <TH>Covers</TH>
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
              <TD>
                <div className="font-medium">
                  {s.isLoaded ? <Link href={`/library?sheet=${s.code}`}>{s.name}</Link> : s.name}
                </div>
                {s.warning && (
                  <Badge variant={s.isLoaded ? "amber" : "red"} className="mt-1 whitespace-normal">
                    {s.warning}
                  </Badge>
                )}
              </TD>
              <TD className="max-w-xs text-muted-foreground">{s.scope}</TD>
              <TD>{s.account ?? "—"}</TD>
              <TD>{s.salesRep ?? "—"}</TD>
              <TD>{formatDate(s.effectiveDate)}</TD>
              <TD>{formatDate(s.expirationDate)}</TD>
              <TD className="text-right tabular-nums">{s.isLoaded ? s._count.items : "Not loaded"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
