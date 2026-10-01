// Upload → draft → Admin review → apply as a new sheet version.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { accountWarning } from "@/lib/company";
import { builderSheetWarning } from "@/lib/builders";
import { parseCoverage } from "./coverage";
import { extractSheetText } from "./extract";
import { parsePriceCsv, parseSheetText, UOMS, type ParsedHeader, type ParsedRow } from "./parse";
import { diffSheet, validateRows } from "./diff";

export const SHEET_CODE_RE = /^[A-Z]{2,4}$/;

export async function createImport(opts: {
  bytes: Uint8Array;
  fileName: string;
  code: string;
  name: string;
  scope?: string | null;
  userId: string;
  companyId?: string | null;
}) {
  const { format, text } = await extractSheetText(opts.bytes, opts.fileName);
  const parsed = (format === "CSV" && parsePriceCsv(text)) || parseSheetText(text);
  const fileUrl = await saveUpload(opts.bytes, opts.fileName, "price-sheets");
  return prisma.sheetImport.create({
    data: {
      code: opts.code,
      name: opts.name,
      scope: opts.scope ?? null,
      fileName: opts.fileName,
      fileUrl,
      format,
      extractedText: text,
      header: parsed.header,
      rows: parsed.rows,
      unparsed: parsed.unparsed,
      createdById: opts.userId,
      companyId: opts.companyId ?? null,
    },
  });
}

export type ReviewedImport = {
  name: string;
  scope: string | null;
  header: ParsedHeader;
  rows: ParsedRow[];
};

export class ImportError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("\n"));
  }
}

const dateOrNull = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);

/** Validates the reviewed rows and makes them the live version of the sheet. */
export async function applyImport(importId: string, reviewed: ReviewedImport, userId: string) {
  const rows = reviewed.rows.map((r) => ({
    ...r,
    itemNumber: r.itemNumber.trim().toUpperCase(),
    description: r.description.trim(),
    section: r.section.trim(),
    uom: r.uom.trim().toUpperCase(),
    unitPrice: r.priceStatus === "CALL" ? null : r.unitPrice,
  }));
  const problems = validateRows(rows, UOMS);
  const effective = dateOrNull(reviewed.header.effective);
  const expiration = dateOrNull(reviewed.header.expiration);
  if (!effective) problems.unshift("Effective date is required.");
  if (!expiration) problems.unshift("Expiration date is required.");
  if (effective && expiration && expiration < effective) problems.unshift("Expiration date is before the effective date.");
  if (!reviewed.name.trim()) problems.unshift("Sheet name is required.");
  if (!rows.length) problems.unshift("There are no rows to save.");
  if (problems.length) throw new ImportError(problems);

  return prisma.$transaction(async (tx) => {
    const imp = await tx.sheetImport.findUnique({ where: { id: importId } });
    if (!imp || imp.status !== "DRAFT") throw new ImportError(["This upload was already applied or discarded."]);

    const builder = imp.companyId ? await tx.company.findUniqueOrThrow({ where: { id: imp.companyId } }) : null;
    const previous = await tx.priceSheet.findMany({
      where: { code: imp.code, isActive: true, companyId: imp.companyId ?? null },
      include: { items: true },
    });
    const prevItems = previous.flatMap((s) => s.items);
    const prevBy = new Map(prevItems.map((i) => [i.itemNumber, i]));
    const diff = diffSheet(
      prevItems.map((i) => ({ ...i, priceStatus: i.priceStatus })),
      rows,
    );

    const sheet = await tx.priceSheet.create({
      data: {
        code: imp.code,
        name: reviewed.name.trim(),
        scope: reviewed.scope?.trim() || previous[0]?.scope || null,
        sourceFile: imp.fileName,
        account: reviewed.header.account?.trim() || null,
        salesRep: reviewed.header.salesRep?.trim() || null,
        effectiveDate: effective,
        expirationDate: expiration,
        // BTR sheets must be on BTR's account; a builder's sheet on the builder's account
        warning: builder ? builderSheetWarning(reviewed.header.account, builder) : accountWarning(reviewed.header.account),
        isLoaded: true,
        importId: imp.id,
        companyId: imp.companyId ?? null,
      },
    });

    await tx.priceItem.createMany({
      data: rows.map((r) => {
        const prev = prevBy.get(r.itemNumber);
        // Keep a user/manufacturer coverage value when the product itself didn't change.
        const carry =
          prev?.coverageSource &&
          prev.coverageSource !== "PARSED_FROM_DESCRIPTION" &&
          prev.description === r.description &&
          prev.uom === r.uom;
        const c = carry ? null : parseCoverage(r.description, r.uom);
        return {
          sheetId: sheet.id,
          section: r.section,
          itemNumber: r.itemNumber,
          description: r.description,
          unitPrice: r.unitPrice,
          uom: r.uom,
          priceStatus: r.priceStatus,
          coverageQty: carry ? prev!.coverageQty : (c?.qty ?? null),
          coverageUnit: carry ? prev!.coverageUnit : (c?.unit ?? null),
          coverageSource: carry ? prev!.coverageSource : c ? "PARSED_FROM_DESCRIPTION" : null,
          tags: prev?.tags ?? Prisma.JsonNull,
        };
      }),
    });

    await tx.priceSheet.updateMany({
      where: { id: { in: previous.map((s) => s.id) } },
      data: { isActive: false, replacedAt: new Date() },
    });
    await tx.sheetImport.update({
      where: { id: imp.id },
      data: { status: "APPLIED", appliedAt: new Date(), header: reviewed.header, rows },
    });
    const summary = {
      code: imp.code,
      items: rows.length,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      replaced: previous.map((s) => s.id),
    };
    await tx.auditLog.create({
      data: { userId, entity: "PriceSheet", entityId: sheet.id, action: "apply_import", after: summary },
    });
    return { sheet, summary };
  });
}
