import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ParsedHeader, ParsedRow } from "@/lib/sheets/parse";
import type { DiffItem } from "@/lib/sheets/diff";
import { discardImport } from "../../actions";
import { Button } from "@/components/ui/button";
import { ReviewGrid } from "./review-grid";

export default async function ReviewImportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN", "PURCHASING"]);
  const { id } = await params;
  const imp = await prisma.sheetImport.findUnique({ where: { id } });
  if (!imp) notFound();
  const builder = imp.companyId ? await prisma.company.findUnique({ where: { id: imp.companyId }, select: { name: true } }) : null;
  const current = await prisma.priceSheet.findFirst({
    where: { code: imp.code, isActive: true },
    include: { items: { orderBy: { itemNumber: "asc" } } },
  });
  const oldItems: DiffItem[] = (current?.items ?? []).map((i) => ({
    itemNumber: i.itemNumber,
    description: i.description,
    unitPrice: i.unitPrice,
    priceStatus: i.priceStatus,
    uom: i.uom,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Review upload: {imp.code} — {imp.fileName}
            {builder && <span className="ml-2 text-base font-normal text-blue-700">{builder.name} pricing</span>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Read as {imp.format === "ZIP_TXT" ? "a ZIP container of .txt files" : imp.format}. Nothing is live until
            you apply it. {current?.isLoaded ? `Compared against the live version (${current.items.length} items).` : "No live version to compare against."}
          </p>
        </div>
        {imp.status === "DRAFT" && (
          <form action={discardImport}>
            <input type="hidden" name="id" value={imp.id} />
            <Button variant="outline">Discard upload</Button>
          </form>
        )}
      </div>
      {imp.status !== "DRAFT" ? (
        <p className="text-sm">This upload was {imp.status.toLowerCase()}.</p>
      ) : (
        <ReviewGrid
          importId={imp.id}
          initialName={imp.name}
          initialScope={imp.scope ?? ""}
          initialHeader={imp.header as ParsedHeader}
          initialRows={imp.rows as ParsedRow[]}
          unparsed={imp.unparsed as { line: number; text: string }[]}
          oldItems={oldItems}
        />
      )}
    </div>
  );
}
