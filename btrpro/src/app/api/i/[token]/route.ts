import { NextResponse } from "next/server";
import { getInvoiceByToken, invoicePdf } from "@/lib/billing/service";

// Customer's copy, authorized by the invoice's secret link.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const inv = await getInvoiceByToken((await params).token);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(await invoicePdf(inv.id)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${inv.number}.pdf"`,
    },
  });
}
