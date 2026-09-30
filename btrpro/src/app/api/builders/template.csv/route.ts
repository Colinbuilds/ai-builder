import { NextResponse } from "next/server";

// Same layout as data/price_items.csv, so builder price lists typed up by hand import like any sheet.
export function GET() {
  const csv = [
    "sheet_code,sheet_name,section,item_number,description,unit_price,uom,price_status,effective_date,expiration_date",
    "LEG-SS,Legacy Homes - Steep Slope,Shingles,EXAMPLE1,EXAMPLE ROW - DELETE BEFORE UPLOAD,,SQ,CALL,2026-10-01,2026-12-31",
  ].join("\r\n");
  return new NextResponse(csv + "\r\n", { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="builder-pricing-template.csv"' } });
}
