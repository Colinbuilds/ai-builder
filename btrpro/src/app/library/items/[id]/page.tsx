import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseCoverage } from "@/lib/sheets/coverage";
import { UnitPriceCell } from "@/components/price-cells";
import { SheetStatusBadge } from "@/components/sheet-status";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { CoverageForm } from "./coverage-form";

const SOURCE_LABEL: Record<string, string> = {
  PARSED_FROM_DESCRIPTION: "Parsed from the description",
  USER_ENTERED: "Entered by a user",
  MANUFACTURER_DOC: "From manufacturer data",
};

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await prisma.priceItem.findUnique({ where: { id }, include: { sheet: true } });
  if (!item) notFound();
  const parsed = parseCoverage(item.description, item.uom);
  const history = await prisma.auditLog.findMany({
    where: { entity: "PriceItem", entityId: id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <Link href={`/library?q=${encodeURIComponent(item.itemNumber)}`} className="text-sm text-muted-foreground">
          ← Price library
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{item.description}</h1>
        <p className="font-mono text-sm">{item.itemNumber}</p>
      </div>

      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Unit price</dt>
        <dd>
          <UnitPriceCell unitPrice={item.unitPrice} priceStatus={item.priceStatus} /> per {item.uom}
        </dd>
        <dt className="text-muted-foreground">Section</dt>
        <dd>{item.section}</dd>
        <dt className="text-muted-foreground">Sheet</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{item.sheet.code}</Badge> {item.sheet.name}
          {!item.sheet.isActive && <Badge variant="red">Replaced version</Badge>}
          <SheetStatusBadge sheet={item.sheet} />
        </dd>
        <dt className="text-muted-foreground">Sheet dates</dt>
        <dd>
          {formatDate(item.sheet.effectiveDate)} – {formatDate(item.sheet.expirationDate)}
        </dd>
        {item.sheet.warning && (
          <>
            <dt className="text-muted-foreground">Warning</dt>
            <dd>
              <Badge variant="amber" className="whitespace-normal">
                {item.sheet.warning}
              </Badge>
            </dd>
          </>
        )}
      </dl>

      <section className="rounded-md border p-4">
        <h2 className="font-semibold">Coverage</h2>
        {item.coverageQty != null ? (
          <p className="mt-1 text-sm">
            <span className="text-lg font-semibold tabular-nums">
              {item.coverageQty} {item.coverageUnit}
            </span>{" "}
            <span className="text-muted-foreground">· {SOURCE_LABEL[item.coverageSource ?? ""] ?? "Unknown source"}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm">
            <Badge variant="red">MISSING</Badge> No coverage on file. Any takeoff that needs it will stay MISSING until a
            value is entered from the manufacturer spec.
          </p>
        )}
        {parsed && item.coverageSource !== "PARSED_FROM_DESCRIPTION" && (
          <p className="mt-1 text-xs text-muted-foreground">
            The description reads as {parsed.qty} {parsed.unit} (&ldquo;{parsed.matched}&rdquo;).
          </p>
        )}
        {user.role !== "VIEWER" && (
          <CoverageForm id={item.id} qty={item.coverageQty} unit={item.coverageUnit ?? parsed?.unit ?? ""} />
        )}
      </section>

      {history.length > 0 && (
        <section className="text-sm">
          <h2 className="mb-1 font-semibold">Changes</h2>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {history.map((h) => (
              <li key={h.id}>
                {h.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} · {h.user?.name ?? "system"} ·{" "}
                {h.action.replace(/_/g, " ")}: {JSON.stringify(h.after)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
