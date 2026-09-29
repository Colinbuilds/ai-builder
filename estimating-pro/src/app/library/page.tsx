import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listSections, listSheets, searchPriceItems } from "@/lib/price";
import { UnitPriceCell } from "@/components/price-cells";
import { SheetStatusBadge } from "@/components/sheet-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type SP = Promise<Record<string, string | undefined>>;

export default async function LibraryPage({ searchParams }: { searchParams: SP }) {
  await requireUser();
  const sp = await searchParams;
  const sheet = sp.sheet || undefined;
  const section = sp.section || undefined;
  const status = sp.status === "CALL" || sp.status === "LISTED" ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [sheets, sections, result] = await Promise.all([
    listSheets(),
    listSections(sheet ? [sheet] : undefined),
    searchPriceItems({ q: sp.q, sheetCodes: sheet ? [sheet] : undefined, section, priceStatus: status, page }),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    u.set("page", String(p));
    return `?${u}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Price library</h1>
        <p className="text-sm text-muted-foreground">
          Search every loaded BTR price sheet. Prices and UOMs are shown exactly as listed on the sheet.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" defaultValue={sp.q} placeholder="Item #, description, or section" className="w-72" />
        <Select name="sheet" defaultValue={sheet ?? ""}>
          <option value="">All sheets</option>
          {sheets
            .filter((s) => s.isLoaded)
            .map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
        </Select>
        <Select name="section" defaultValue={section ?? ""} className="max-w-64">
          <option value="">All sections</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status ?? ""}>
          <option value="">Any price status</option>
          <option value="LISTED">Listed price</option>
          <option value="CALL">CALL for price</option>
        </Select>
        <Button type="submit">Search</Button>
        <Button variant="ghost" asChild>
          <Link href="/library">Clear</Link>
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {result.total} item{result.total === 1 ? "" : "s"}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>

      <Table>
        <THead>
          <TR>
            <TH>Item #</TH>
            <TH>Description</TH>
            <TH>Section</TH>
            <TH className="text-right">Unit price</TH>
            <TH>UOM</TH>
            <TH>Coverage</TH>
            <TH>Sheet</TH>
          </TR>
        </THead>
        <TBody>
          {result.items.map((it) => (
            <TR key={it.id}>
              <TD className="font-mono text-xs">
                <Link href={`/library/items/${it.id}`} className="underline-offset-2 hover:underline">
                  {it.itemNumber}
                </Link>
              </TD>
              <TD>{it.description}</TD>
              <TD className="text-muted-foreground">{it.section}</TD>
              <TD className="text-right">
                <UnitPriceCell unitPrice={it.unitPrice} priceStatus={it.priceStatus} />
              </TD>
              <TD>{it.uom}</TD>
              <TD className="whitespace-nowrap text-xs">
                {it.coverageQty != null ? (
                  `${it.coverageQty} ${it.coverageUnit}`
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TD>
              <TD>
                <span className="flex items-center gap-1">
                  <Badge variant="outline">{it.sheet.code}</Badge>
                  <SheetStatusBadge sheet={it.sheet} />
                  {it.sheet.warning && (
                    <Badge variant="amber" title={it.sheet.warning}>
                      Confirm account
                    </Badge>
                  )}
                </span>
              </TD>
            </TR>
          ))}
          {result.items.length === 0 && (
            <TR>
              <TD colSpan={7} className="py-8 text-center text-muted-foreground">
                No items match. If the product isn&apos;t on a loaded sheet, it stays MISSING until a sheet with it is
                uploaded.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>

      {pages > 1 && (
        <div className="flex gap-2">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={qs(page - 1)}>Previous</Link>
            </Button>
          )}
          {page < pages && (
            <Button variant="outline" size="sm" asChild>
              <Link href={qs(page + 1)}>Next</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
