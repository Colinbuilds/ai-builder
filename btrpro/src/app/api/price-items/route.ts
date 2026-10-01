import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchPriceItems } from "@/lib/price";
import { priceScopeFor } from "@/lib/pricing-scope";
import { sheetDateStatus } from "@/lib/sheets/date-status";

// Item picker search across live sheets (item #, description, section).
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const u = new URL(req.url);
  const sheets = u.searchParams.get("sheets")?.split(",").filter(Boolean);
  // a job's pricing (builder sheets on builder jobs), or one builder's own sheets on the builder page
  const projectId = u.searchParams.get("projectId");
  const builderId = u.searchParams.get("builderId");
  const scope = projectId ? await priceScopeFor(projectId) : builderId ? { builderId, builderName: null, fallback: "MISSING" as const } : undefined;
  const r = await searchPriceItems({ q: u.searchParams.get("q") ?? "", sheetCodes: sheets, pageSize: Math.min(Number(u.searchParams.get("limit")) || 20, 50), scope });
  return NextResponse.json(
    r.items.map((i) => ({
      itemNumber: i.itemNumber,
      description: i.description,
      uom: i.uom,
      unitPrice: i.unitPrice,
      priceStatus: i.priceStatus,
      sheetCode: i.sheet.code,
      builderPrice: !!i.sheet.companyId,
      sheetStatus: sheetDateStatus(i.sheet).status,
      warning: i.sheet.warning,
      coverageQty: i.coverageQty,
      coverageUnit: i.coverageUnit,
    })),
  );
}
